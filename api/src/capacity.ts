import { db } from "./db.ts";

// The most meat the kitchen can smoke in one day, in pounds.
export const DAILY_MEAT_LIMIT_LB = 120;

export type Capacity = { date: string; bookedPounds: number; limitPounds: number; availablePounds: number };

// How much meat is already booked for pickup on a date (Owensboro time), and how much room is left.
// Cancelled orders don't count.
export async function kitchenCapacity(date: string): Promise<Capacity> {
  const result = await db.query<{ pounds: number }>(
    `SELECT coalesce(sum(oi.quantity), 0)::int AS pounds
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE m.category = 'meat' AND o.status <> 'cancelled'
       AND (o.pickup_at AT TIME ZONE 'America/Chicago')::date = $1::date`,
    [date],
  );
  const booked = result.rows[0].pounds;
  return {
    date,
    bookedPounds: booked,
    limitPounds: DAILY_MEAT_LIMIT_LB,
    availablePounds: Math.max(0, DAILY_MEAT_LIMIT_LB - booked),
  };
}
