import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { checkPassword, endSession, requireStaff, startSession, type Env } from "./auth.ts";
import { db } from "./db.ts";
import type { EmailSender } from "./email.ts";
import { changeOrderStatus, findOrder, listOrders, placeOrder, UnknownMenuItemError } from "./order-store.ts";
import { newOrder, nextStatuses, orderStatuses, pickupProblem } from "./orders.ts";

// What the app needs from the outside world, passed in rather than imported, so tests can pass fakes.
export type Dependencies = { email: EmailSender };

type MenuItem = { id: number; name: string; category: string; price_cents: number };
const statusChange = z.object({ status: z.enum(orderStatuses) });
const login = z.object({ email: z.email(), password: z.string().min(1) });

export function createApp({ email }: Dependencies) {
  const app = new Hono<Env>();

  // Log one line per request: method, path, status, and how long it took.
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    console.log(JSON.stringify({ method: c.req.method, path: c.req.path, status: c.res.status, ms }));
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // ---- Menu (public) ----

  app.get("/menu", async (c) => {
    const category = c.req.query("category");
    const result = category
      ? await db.query<MenuItem>(
          "SELECT id, name, category, price_cents FROM menu_items WHERE category = $1 ORDER BY id",
          [category],
        )
      : await db.query<MenuItem>("SELECT id, name, category, price_cents FROM menu_items ORDER BY id");
    return c.json({ items: result.rows });
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

  // ---- Orders ----

  app.post("/orders", async (c) => {
    const parsed = newOrder.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
      return c.json({ error: "Invalid order", issues }, 400);
    }
    const problem = pickupProblem(new Date(parsed.data.pickupAt), new Date());
    if (problem) return c.json({ error: problem }, 400);

    try {
      const id = await placeOrder(parsed.data);
      return c.json({ order: await findOrder(id) }, 201);
    } catch (err) {
      if (err instanceof UnknownMenuItemError) return c.json({ error: err.message }, 400);
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
    const change = Number.isInteger(id) ? await changeOrderStatus(id, to) : { result: "not_found" as const };

    if (change.result === "not_found") return c.json({ error: "Order not found" }, 404);
    if (change.result === "not_allowed") {
      const allowed = nextStatuses[change.current];
      const options = allowed.length ? `it can only become ${allowed.join(" or ")}` : "that's final";
      return c.json({ error: `Order ${id} is ${change.current}; ${options}` }, 409);
    }

    if (to === "ready") {
      // The status change has already succeeded. A failed email shouldn't undo it or fail the request.
      await email
        .send({ to: change.customerEmail, subject: "Your River Bend order is ready", text: `Order #${id} is ready for pickup.` })
        .catch((err) => console.error("Couldn't send the ready email", err));
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
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  return app;
}
