import { z } from "zod";

// Order rules, with no database or web server involved, so they're quick to test.

export const newOrder = z.object({
  customer: z.object({
    name: z.string().trim().min(1, "Name is required").max(100),
    email: z.email("Enter a valid email address"),
    phone: z.string().trim().max(30).optional(),
  }),
  pickupAt: z.iso.datetime({ offset: true, message: "Use a date and time like 2026-11-01T12:00:00-05:00" }),
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .min(1, "An order needs at least one item"),
});

export const NOTICE_HOURS = 24;

// Catering needs a day's notice to smoke the meat. Returns what's wrong, or null if it's fine.
export function pickupProblem(pickupAt: Date, now: Date): string | null {
  const hoursAway = (pickupAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursAway <= 0) return "Pickup time must be in the future";
  if (hoursAway < NOTICE_HOURS) return `Catering orders need at least ${NOTICE_HOURS} hours' notice`;
  return null;
}
