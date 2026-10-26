import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { hashPassword } from "./auth.ts";
import { db, resetDatabase } from "./db.ts";
import type { Email, EmailSender } from "./email.ts";

// A fake email service: it remembers what it was asked to send, and sends nothing.
const sent: Email[] = [];
const fakeEmail: EmailSender = {
  async send(email) {
    sent.push(email);
  },
};
const app = createApp({ email: fakeEmail, model: null });

// Sends a request straight to the app, with no network or port involved.
async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

// A pickup time far enough ahead to pass the notice rule.
const inThreeDays = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

const order = (items = [{ menuItemId: 1, quantity: 3 }, { menuItemId: 4, quantity: 1 }]) => ({
  customer: { name: "Sam Lee", email: "sam@example.com" },
  pickupAt: inThreeDays(),
  items,
});

const countOrders = async () => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM orders")).rows[0].n;

beforeEach(async () => {
  await resetDatabase(); // every test starts from the same sample data
  sent.length = 0;
});

describe("menu", () => {
  it("lists the whole menu", async () => {
    const res = await call("GET", "/menu");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(9);
  });

  it("filters by category", async () => {
    const res = await call("GET", "/menu?category=meat");
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(["Pulled pork (lb)", "Mutton (lb)", "Brisket (lb)"]);
  });

  it("returns 404 for an item that doesn't exist", async () => {
    expect((await call("GET", "/menu/99")).status).toBe(404);
  });
});

describe("placing an order", () => {
  it("saves it and prices it from the database", async () => {
    const res = await call("POST", "/orders", order());
    expect(res.status).toBe(201);
    expect(res.body.order.total_cents).toBe(3 * 1499 + 999);
    expect(await countOrders()).toBe(7);
  });

  it("rejects an unknown menu item and saves nothing", async () => {
    const res = await call("POST", "/orders", order([{ menuItemId: 1, quantity: 2 }, { menuItemId: 42, quantity: 1 }]));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No menu item with id 42");
    expect(await countOrders()).toBe(6); // the transaction rolled back
  });

  it("rejects a pickup without enough notice", async () => {
    const res = await call("POST", "/orders", { ...order(), pickupAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Catering orders need at least 24 hours' notice");
  });
});

describe("staff", () => {
  beforeEach(async () => {
    await db.query("INSERT INTO staff (email, name, password_hash) VALUES ($1, $2, $3)", [
      "pat@riverbend.example",
      "Pat Owner",
      await hashPassword("smoked-brisket-42"),
    ]);
  });

  const signIn = async () =>
    (await call("POST", "/auth/login", { email: "pat@riverbend.example", password: "smoked-brisket-42" })).cookie;

  it("can't list orders without signing in", async () => {
    expect((await call("GET", "/orders")).status).toBe(401);
  });

  it("is refused with the wrong password", async () => {
    const res = await call("POST", "/auth/login", { email: "pat@riverbend.example", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.cookie).toBeUndefined();
  });

  it("can sign in and mark an order ready", async () => {
    const cookie = await signIn();
    const res = await call("PATCH", "/orders/6", { status: "ready" }, cookie);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("ready");
  });

  it("emails the customer when an order is ready", async () => {
    const cookie = await signIn();
    await call("PATCH", "/orders/6", { status: "ready" }, cookie);
    expect(sent).toEqual([
      { to: "events@example.org", subject: "Your River Bend order is ready", text: "Order #6 is ready for pickup." },
    ]);
  });

  it("still marks the order ready if the email service is down", async () => {
    const brokenEmail: EmailSender = {
      async send() {
        throw new Error("email provider unavailable");
      },
    };
    const appWithBrokenEmail = createApp({ email: brokenEmail, model: null });
    const login = await appWithBrokenEmail.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "pat@riverbend.example", password: "smoked-brisket-42" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const res = await appWithBrokenEmail.request("/orders/6", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ status: "ready" }),
    });
    expect(res.status).toBe(200);
  });

  it("refuses to change an order that's already picked up", async () => {
    const cookie = await signIn();
    const res = await call("PATCH", "/orders/1", { status: "ready" }, cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Order 1 is picked_up; that's final");
    expect(sent).toHaveLength(0);
  });

  // Spec 001: kitchen capacity. One test per acceptance criterion.
  describe("kitchen capacity", () => {
    it("shows booked and available meat for a day, ignoring cancelled orders", async () => {
      await call("PATCH", "/orders/6", { status: "cancelled" }, await signIn()); // 20 lb on the 24th
      const cookie = await signIn();
      expect((await call("GET", "/kitchen/capacity?date=2026-10-24", undefined, cookie)).body.capacity).toEqual({
        date: "2026-10-24",
        bookedPounds: 0,
        limitPounds: 120,
        availablePounds: 120,
      });
      expect((await call("GET", "/kitchen/capacity?date=2026-10-09", undefined, cookie)).body.capacity.bookedPounds).toBe(16);
    });

    it("counts orders by their day in Owensboro, not in UTC", async () => {
      // 7 pm in Owensboro on Nov 2 is already Nov 3 in UTC.
      await db.query("INSERT INTO orders (customer_id, pickup_at) VALUES (1, '2026-11-02 19:00-06') RETURNING id");
      await db.query("INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_cents) VALUES (7, 3, 5, 1899)");
      const cookie = await signIn();
      expect((await call("GET", "/kitchen/capacity?date=2026-11-02", undefined, cookie)).body.capacity.bookedPounds).toBe(5);
      expect((await call("GET", "/kitchen/capacity?date=2026-11-03", undefined, cookie)).body.capacity.bookedPounds).toBe(0);
    });

    it("never reports less than nothing available", async () => {
      await db.query("INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_cents) VALUES (6, 3, 150, 1899)");
      const res = await call("GET", "/kitchen/capacity?date=2026-10-24", undefined, await signIn());
      expect(res.body.capacity).toMatchObject({ bookedPounds: 170, availablePounds: 0 });
    });

    it("needs a valid date", async () => {
      const cookie = await signIn();
      for (const query of ["", "?date=tomorrow", "?date=2026-02-30"]) {
        const res = await call("GET", `/kitchen/capacity${query}`, undefined, cookie);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("date must be a day, like 2026-10-24");
      }
    });

    it("is for staff only", async () => {
      expect((await call("GET", "/kitchen/capacity?date=2026-10-24")).status).toBe(401);
    });
  });

  it("loses access after signing out", async () => {
    const cookie = await signIn();
    await call("POST", "/auth/logout", undefined, cookie);
    expect((await call("GET", "/orders", undefined, cookie)).status).toBe(401);
  });
});
