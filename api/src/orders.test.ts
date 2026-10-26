import { describe, expect, it } from "vitest";
import { newOrder, pickupProblem } from "./orders.ts";

describe("pickupProblem", () => {
  const now = new Date("2026-11-02T12:00:00-06:00");
  const hoursLater = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  it("accepts a pickup two days away", () => {
    expect(pickupProblem(hoursLater(48), now)).toBeNull();
  });

  it("accepts exactly 24 hours' notice", () => {
    expect(pickupProblem(hoursLater(24), now)).toBeNull();
  });

  it("rejects a pickup a minute short of 24 hours", () => {
    expect(pickupProblem(hoursLater(24 - 1 / 60), now)).toBe("Catering orders need at least 24 hours' notice");
  });

  it("rejects a pickup in the past", () => {
    expect(pickupProblem(hoursLater(-1), now)).toBe("Pickup time must be in the future");
  });

  it("rejects a pickup at this exact moment", () => {
    expect(pickupProblem(now, now)).toBe("Pickup time must be in the future");
  });
});

describe("newOrder", () => {
  const valid = {
    customer: { name: "Sam Lee", email: "sam@example.com" },
    pickupAt: "2026-11-07T12:00:00-06:00",
    items: [{ menuItemId: 1, quantity: 3 }],
  };

  it("accepts a valid order", () => {
    expect(newOrder.safeParse(valid).success).toBe(true);
  });

  it("trims the customer's name", () => {
    const result = newOrder.parse({ ...valid, customer: { ...valid.customer, name: "  Sam Lee  " } });
    expect(result.customer.name).toBe("Sam Lee");
  });

  it("drops fields it doesn't know, like a price the client made up", () => {
    const result = newOrder.parse({ ...valid, items: [{ menuItemId: 1, quantity: 3, unit_price_cents: 1 }] });
    expect(result.items[0]).toEqual({ menuItemId: 1, quantity: 3 });
  });

  it.each([
    ["no items", { items: [] }],
    ["a zero quantity", { items: [{ menuItemId: 1, quantity: 0 }] }],
    ["a fractional quantity", { items: [{ menuItemId: 1, quantity: 1.5 }] }],
    ["a vague pickup time", { pickupAt: "tomorrow" }],
  ])("rejects %s", (_label, change) => {
    expect(newOrder.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
