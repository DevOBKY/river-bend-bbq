import { beforeEach, describe, expect, it } from "vitest";
import { app } from "./app.ts";
import { hashPassword } from "./auth.ts";
import { db, resetDatabase } from "./db.ts";

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

  it("loses access after signing out", async () => {
    const cookie = await signIn();
    await call("POST", "/auth/logout", undefined, cookie);
    expect((await call("GET", "/orders", undefined, cookie)).status).toBe(401);
  });
});
