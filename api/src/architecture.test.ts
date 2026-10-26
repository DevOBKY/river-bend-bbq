import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { hashPassword } from "./auth.ts";
import { db, resetDatabase } from "./db.ts";

// A clock the tests control, so cache expiry doesn't depend on waiting.
let clock = Date.parse("2026-11-02T12:00:00Z");
const app = createApp({ menuCacheMs: 60_000, now: () => clock });

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : await res.text() };
}

const order = {
  customer: { name: "Sam Lee", email: "sam@example.com" },
  pickupAt: "2026-11-07T12:00:00-06:00",
  items: [{ menuItemId: 1, quantity: 3 }],
};
const countOrders = async () => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM orders")).rows[0].n;

let cookie = "";
beforeEach(async () => {
  await resetDatabase();
  await db.query("INSERT INTO staff (email, name, password_hash) VALUES ($1, $2, $3)", [
    "pat@riverbend.example",
    "Pat Owner",
    await hashPassword("smoked-brisket-42"),
  ]);
  const login = await call("POST", "/auth/login", { email: "pat@riverbend.example", password: "smoked-brisket-42" });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});

const brisketPrice = async () => (await call("GET", "/menu?category=meat")).body.items.find((i: { id: number }) => i.id === 3).price_cents;

describe("the menu cache", () => {
  it("serves a copy until it expires", async () => {
    await brisketPrice(); // fills the cache
    await db.query("UPDATE menu_items SET price_cents = 1999 WHERE id = 3"); // behind the API's back
    expect(await brisketPrice()).toBe(1899); // still the cached copy
    clock += 61_000;
    expect(await brisketPrice()).toBe(1999); // expired, so reloaded
  });

  it("is cleared when staff change a price through the API", async () => {
    await brisketPrice();
    const res = await call("PATCH", "/menu/3", { price_cents: 1999 }, { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(await brisketPrice()).toBe(1999); // no waiting for expiry
  });
});

describe("idempotent checkout", () => {
  const key = { "Idempotency-Key": "checkout-7f3a9c21" };

  it("places the order once, however many times the request is retried", async () => {
    const first = await call("POST", "/orders", order, { ...key });
    const retry = await call("POST", "/orders", order, { ...key });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await countOrders()).toBe(7);
  });

  it("handles two identical requests arriving at once", async () => {
    const [a, b] = await Promise.all([call("POST", "/orders", order, { ...key }), call("POST", "/orders", order, { ...key })]);
    expect(a.body.order.id).toBe(b.body.order.id);
    expect(await countOrders()).toBe(7);
  });

  it("refuses the same key for a different order", async () => {
    await call("POST", "/orders", order, { ...key });
    const other = await call("POST", "/orders", { ...order, items: [{ menuItemId: 2, quantity: 1 }] }, { ...key });
    expect(other.status).toBe(422);
    expect(await countOrders()).toBe(7);
  });

  it("still places separate orders without a key", async () => {
    await call("POST", "/orders", order);
    await call("POST", "/orders", order);
    expect(await countOrders()).toBe(8);
  });
});

describe("observability", () => {
  it("gives every response a request id, keeping the caller's if it sent one", async () => {
    expect((await call("GET", "/health")).headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect((await call("GET", "/health", undefined, { "X-Request-Id": "from-the-site-123" })).headers.get("X-Request-Id")).toBe(
      "from-the-site-123",
    );
  });

  it("counts requests by route pattern, not by real path", async () => {
    await call("GET", "/menu/3");
    await call("GET", "/menu/4");
    const metrics = (await call("GET", "/metrics", undefined, { Cookie: cookie })).body as string;
    expect(metrics).toContain('http_requests_total{method="GET",route="/menu/:id",status="200"} 2');
    expect(metrics).not.toContain("/menu/3");
  });

  it("keeps metrics for staff only", async () => {
    expect((await call("GET", "/metrics")).status).toBe(401);
  });
});
