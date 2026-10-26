import { createHash } from "node:crypto";
import { db } from "./db.ts";
import { statusesThatCanMoveTo, type OrderStatus } from "./orders.ts";

// Everything about how orders are stored. Nothing here knows about HTTP.

export type NewOrder = {
  customer: { name: string; email: string; phone?: string };
  pickupAt: string;
  items: { menuItemId: number; quantity: number }[];
};

export type OrderSummary = {
  id: number;
  customer: string;
  pickup_at: Date;
  status: string;
  items: { item: string; quantity: number; line_cents: number }[];
  total_cents: number;
};

// Thrown when an order mentions a menu item that doesn't exist. The caller decides what that
// means: a 400 for an API, a message for a command-line tool.
export class UnknownMenuItemError extends Error {
  menuItemId: number;
  constructor(menuItemId: number) {
    super(`No menu item with id ${menuItemId}`);
    this.menuItemId = menuItemId;
  }
}

// The same idempotency key was sent with a different order: almost certainly a client bug.
export class IdempotencyKeyReusedError extends Error {}

// Saves the customer, the order, and its lines in one transaction. Returns the order's id.
// With an idempotency key, a retry of the same request returns the original order instead of
// placing a second one (S3, lesson 5).
export async function placeOrder(
  { customer, pickupAt, items }: NewOrder,
  idempotencyKey?: string,
): Promise<{ id: number; replayed: boolean }> {
  return db.transaction(async (tx) => {
    if (idempotencyKey) {
      const requestHash = createHash("sha256").update(JSON.stringify({ customer, pickupAt, items })).digest("hex");
      // The key is the primary key, so only one request can ever claim it.
      const claimed = await tx.query(
        "INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key",
        [idempotencyKey, requestHash],
      );
      if (claimed.rows.length === 0) {
        const earlier = await tx.query<{ request_hash: string; order_id: number }>(
          "SELECT request_hash, order_id FROM idempotency_keys WHERE key = $1",
          [idempotencyKey],
        );
        if (earlier.rows[0].request_hash !== requestHash) throw new IdempotencyKeyReusedError("That idempotency key was used for a different order");
        return { id: earlier.rows[0].order_id, replayed: true };
      }
    }

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
      if (added.affectedRows === 0) throw new UnknownMenuItemError(item.menuItemId);
    }
    if (idempotencyKey) await tx.query("UPDATE idempotency_keys SET order_id = $1 WHERE key = $2", [id, idempotencyKey]);
    return { id, replayed: false };
  });
}

export async function findOrder(id: number): Promise<OrderSummary | null> {
  const order = await db.query<Omit<OrderSummary, "items" | "total_cents">>(
    `SELECT o.id, c.name AS customer, o.pickup_at, o.status
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [id],
  );
  if (!order.rows[0]) return null;
  const lines = await db.query<OrderSummary["items"][number]>(
    `SELECT m.name AS item, oi.quantity, oi.quantity * oi.unit_price_cents AS line_cents
     FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE oi.order_id = $1 ORDER BY m.id`,
    [id],
  );
  const totalCents = lines.rows.reduce((sum, line) => sum + line.line_cents, 0);
  return { ...order.rows[0], items: lines.rows, total_cents: totalCents };
}

export async function listOrders(status: string) {
  const result = await db.query<{ id: number; customer: string; pickup_at: Date; status: string }>(
    `SELECT o.id, c.name AS customer, o.pickup_at, o.status
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.status = $1 ORDER BY o.pickup_at`,
    [status],
  );
  return result.rows;
}

export type StatusChange =
  | { result: "changed"; customerEmail: string }
  | { result: "not_found" }
  | { result: "not_allowed"; current: OrderStatus };

// Changes an order's status, only if the rules allow it from the status it has right now.
// Moving to "ready" also queues the customer's email, in the same transaction: both happen, or neither.
export async function changeOrderStatus(id: number, to: OrderStatus): Promise<StatusChange> {
  const changed = await db.transaction(async (tx) => {
    const updated = await tx.query<{ email: string }>(
      `UPDATE orders o SET status = $1
       FROM customers c
       WHERE o.id = $2 AND c.id = o.customer_id AND o.status = ANY($3)
       RETURNING c.email`,
      [to, id, statusesThatCanMoveTo(to)],
    );
    const email = updated.rows[0]?.email;
    if (email && to === "ready") {
      const payload = JSON.stringify({ orderId: id, to: email });
      await tx.query("INSERT INTO jobs (kind, payload) VALUES ('email.order_ready', $1)", [payload]);
    }
    return email;
  });
  if (changed) return { result: "changed", customerEmail: changed };
  const existing = await db.query<{ status: OrderStatus }>("SELECT status FROM orders WHERE id = $1", [id]);
  return existing.rows[0] ? { result: "not_allowed", current: existing.rows[0].status } : { result: "not_found" };
}
