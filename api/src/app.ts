import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { checkPassword, endSession, requireStaff, startSession, type Env } from "./auth.ts";
import { db } from "./db.ts";
import { newOrder, pickupProblem } from "./orders.ts";

export const app = new Hono<Env>();

// Log one line per request: method, path, status, and how long it took.
app.use(async (c, next) => {
  const started = performance.now();
  await next();
  const ms = Math.round(performance.now() - started);
  console.log(JSON.stringify({ method: c.req.method, path: c.req.path, status: c.res.status, ms }));
});

app.get("/health", (c) => c.json({ ok: true }));

// ---- Menu (public) ----

type MenuItem = { id: number; name: string; category: string; price_cents: number };

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
  const { customer, pickupAt, items } = parsed.data;
  const problem = pickupProblem(new Date(pickupAt), new Date());
  if (problem) return c.json({ error: problem }, 400);

  // All or nothing: the customer, the order, and every line item (B1, lesson 5).
  const orderId = await db.transaction(async (tx) => {
    const saved = await tx.query<{ id: number }>(
      `INSERT INTO customers (name, email, phone) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [customer.name, customer.email.toLowerCase(), customer.phone ?? null],
    );
    const order = await tx.query<{ id: number }>(
      "INSERT INTO orders (customer_id, pickup_at) VALUES ($1, $2) RETURNING id",
      [saved.rows[0].id, pickupAt],
    );
    const id = order.rows[0].id;
    for (const item of items) {
      // Copies today's price onto the order. Inserts nothing if the menu item doesn't exist.
      const added = await tx.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_cents)
         SELECT $1, id, $2, price_cents FROM menu_items WHERE id = $3`,
        [id, item.quantity, item.menuItemId],
      );
      if (added.affectedRows === 0) {
        throw new HTTPException(400, { message: `No menu item with id ${item.menuItemId}` });
      }
    }
    return id;
  });

  return c.json(await orderSummary(orderId), 201);
});

async function orderSummary(id: number) {
  const order = await db.query<{ id: number; customer: string; pickup_at: Date; status: string }>(
    `SELECT o.id, c.name AS customer, o.pickup_at, o.status
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [id],
  );
  if (!order.rows[0]) return null;
  const lines = await db.query<{ item: string; quantity: number; line_cents: number }>(
    `SELECT m.name AS item, oi.quantity, oi.quantity * oi.unit_price_cents AS line_cents
     FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE oi.order_id = $1 ORDER BY m.id`,
    [id],
  );
  const totalCents = lines.rows.reduce((sum, line) => sum + line.line_cents, 0);
  return { order: { ...order.rows[0], items: lines.rows, total_cents: totalCents } };
}

// ---- Staff only ----

app.get("/orders", requireStaff, async (c) => {
  const status = c.req.query("status") ?? "placed";
  const result = await db.query(
    `SELECT o.id, c.name AS customer, o.pickup_at, o.status
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.status = $1 ORDER BY o.pickup_at`,
    [status],
  );
  return c.json({ orders: result.rows });
});

app.get("/orders/:id", requireStaff, async (c) => {
  const id = Number(c.req.param("id"));
  const summary = Number.isInteger(id) ? await orderSummary(id) : null;
  if (!summary) return c.json({ error: "Order not found" }, 404);
  return c.json(summary);
});

const statusChange = z.object({ status: z.enum(["placed", "ready", "picked_up", "cancelled"]) });

app.patch("/orders/:id", requireStaff, async (c) => {
  const parsed = statusChange.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "status must be placed, ready, picked_up, or cancelled" }, 400);
  const id = Number(c.req.param("id"));
  const result = Number.isInteger(id)
    ? await db.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING id", [parsed.data.status, id])
    : null;
  if (!result?.rows.length) return c.json({ error: "Order not found" }, 404);
  return c.json(await orderSummary(id));
});

// ---- Sign in ----

const login = z.object({ email: z.email(), password: z.string().min(1) });

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
