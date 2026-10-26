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

// Saves the customer, the order, and its lines in one transaction. Returns the new order's id.
export async function placeOrder({ customer, pickupAt, items }: NewOrder): Promise<number> {
  return db.transaction(async (tx) => {
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
    return id;
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

// Who placed an order, or null if there's no such order.
export async function orderCustomer(id: number): Promise<{ name: string; email: string } | null> {
  const result = await db.query<{ name: string; email: string }>(
    "SELECT c.name, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1",
    [id],
  );
  return result.rows[0] ?? null;
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
export async function changeOrderStatus(id: number, to: OrderStatus): Promise<StatusChange> {
  const changed = await db.query<{ email: string }>(
    `UPDATE orders o SET status = $1
     FROM customers c
     WHERE o.id = $2 AND c.id = o.customer_id AND o.status = ANY($3)
     RETURNING c.email`,
    [to, id, statusesThatCanMoveTo(to)],
  );
  if (changed.rows[0]) return { result: "changed", customerEmail: changed.rows[0].email };
  const existing = await db.query<{ status: OrderStatus }>("SELECT status FROM orders WHERE id = $1", [id]);
  return existing.rows[0] ? { result: "not_allowed", current: existing.rows[0].status } : { result: "not_found" };
}
