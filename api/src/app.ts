import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { checkPassword, endSession, requireStaff, startSession, type Env } from "./auth.ts";
import { TtlCache } from "./cache.ts";
import { db } from "./db.ts";
import { Metrics } from "./metrics.ts";
import {
  changeOrderStatus,
  findOrder,
  IdempotencyKeyReusedError,
  listOrders,
  placeOrder,
  UnknownMenuItemError,
} from "./order-store.ts";
import { newOrder, nextStatuses, orderStatuses, pickupProblem } from "./orders.ts";

// Settings the app needs from outside, with defaults, so tests can control time and the cache.
export type Options = { menuCacheMs?: number; now?: () => number };

type MenuItem = { id: number; name: string; category: string; price_cents: number };
const statusChange = z.object({ status: z.enum(orderStatuses) });
const priceChange = z.object({ price_cents: z.number().int().positive() });
const login = z.object({ email: z.email(), password: z.string().min(1) });
const idempotencyKey = z.string().min(8).max(100).optional();

export function createApp({ menuCacheMs = 60_000, now = Date.now }: Options = {}) {
  const app = new Hono<Env>();
  const metrics = new Metrics();
  const menuCache = new TtlCache<MenuItem[]>(menuCacheMs, now);

  // Every request gets an id, sent back in a header and written on every log line, so one request
  // can be followed through all the logs it touches. A caller's own id is kept if it sends one.
  app.use(async (c, next) => {
    const incoming = c.req.header("X-Request-Id");
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    c.set("requestId", requestId);
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    c.header("X-Request-Id", requestId);
    metrics.record(c.req.method, c.req.routePath, c.res.status, ms);
    console.log(JSON.stringify({ requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms }));
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // For monitoring tools to collect. Staff only: request counts are business information.
  app.get("/metrics", requireStaff, (c) => c.text(metrics.text()));

  // ---- Menu (public) ----

  app.get("/menu", async (c) => {
    // The menu changes rarely and is read constantly: a good thing to cache (lesson 2).
    const menu = await menuCache.get("all", async () => {
      const result = await db.query<MenuItem>("SELECT id, name, category, price_cents FROM menu_items ORDER BY id");
      return result.rows;
    });
    const category = c.req.query("category");
    return c.json({ items: category ? menu.filter((m) => m.category === category) : menu });
  });

  app.get("/menu/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Menu item not found" }, 404);
    const result = await db.query<MenuItem>(
      "SELECT id, name, category, price_cents FROM menu_items WHERE id = $1",
      [id],
    );
    const item = result.rows[0];
    if (!item) return c.json({ error: "Menu item not found" }, 404);
    return c.json({ item });
  });

  app.patch("/menu/:id", requireStaff, async (c) => {
    const parsed = priceChange.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "price_cents must be a positive whole number" }, 400);
    const id = Number(c.req.param("id"));
    const result = Number.isInteger(id)
      ? await db.query<MenuItem>(
          "UPDATE menu_items SET price_cents = $1 WHERE id = $2 RETURNING id, name, category, price_cents",
          [parsed.data.price_cents, id],
        )
      : null;
    if (!result?.rows[0]) return c.json({ error: "Menu item not found" }, 404);
    menuCache.clear(); // the source of truth changed, so drop the copy
    return c.json({ item: result.rows[0] });
  });

  // ---- Orders ----

  app.post("/orders", async (c) => {
    const key = idempotencyKey.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) return c.json({ error: "Idempotency-Key must be 8 to 100 characters" }, 400);
    const parsed = newOrder.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
      return c.json({ error: "Invalid order", issues }, 400);
    }
    const problem = pickupProblem(new Date(parsed.data.pickupAt), new Date(now()));
    if (problem) return c.json({ error: problem }, 400);

    try {
      const { id, replayed } = await placeOrder(parsed.data, key.data);
      if (replayed) c.header("Idempotent-Replayed", "true");
      return c.json({ order: await findOrder(id) }, 201);
    } catch (err) {
      if (err instanceof UnknownMenuItemError) return c.json({ error: err.message }, 400);
      if (err instanceof IdempotencyKeyReusedError) return c.json({ error: err.message }, 422);
      throw err;
    }
  });

  // ---- Staff only ----

  app.get("/orders", requireStaff, async (c) => {
    return c.json({ orders: await listOrders(c.req.query("status") ?? "placed") });
  });

  app.get("/orders/:id", requireStaff, async (c) => {
    const id = Number(c.req.param("id"));
    const order = Number.isInteger(id) ? await findOrder(id) : null;
    if (!order) return c.json({ error: "Order not found" }, 404);
    return c.json({ order });
  });

  app.patch("/orders/:id", requireStaff, async (c) => {
    const parsed = statusChange.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: `status must be one of ${orderStatuses.join(", ")}` }, 400);
    const id = Number(c.req.param("id"));
    const to = parsed.data.status;
    // Moving to "ready" also queues the customer's email (lesson 2). Nothing is sent from here.
    const change = Number.isInteger(id) ? await changeOrderStatus(id, to) : { result: "not_found" as const };

    if (change.result === "not_found") return c.json({ error: "Order not found" }, 404);
    if (change.result === "not_allowed") {
      const allowed = nextStatuses[change.current];
      const options = allowed.length ? `it can only become ${allowed.join(" or ")}` : "that's final";
      return c.json({ error: `Order ${id} is ${change.current}; ${options}` }, 409);
    }
    return c.json({ order: await findOrder(id) });
  });

  // ---- Sign in ----

  app.post("/auth/login", async (c) => {
    const parsed = login.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Email and password are required" }, 400);
    const result = await db.query<{ id: number; password_hash: string }>(
      "SELECT id, password_hash FROM staff WHERE email = $1",
      [parsed.data.email.toLowerCase()],
    );
    const staff = result.rows[0];
    // The same answer whether the email or the password was wrong, so nobody can probe for accounts.
    if (!staff || !(await checkPassword(parsed.data.password, staff.password_hash))) {
      return c.json({ error: "Email or password is incorrect" }, 401);
    }
    await startSession(c, staff.id);
    return c.json({ ok: true });
  });

  app.post("/auth/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  });

  app.get("/auth/me", requireStaff, (c) => c.json({ staff: c.get("staff") }));

  // ---- Errors ----

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    // The request id ties this error to the request's log line, and the client can quote it.
    console.error(JSON.stringify({ requestId: c.get("requestId"), error: err.message, stack: err.stack }));
    return c.json({ error: "Something went wrong", requestId: c.get("requestId") }, 500);
  });

  return app;
}
