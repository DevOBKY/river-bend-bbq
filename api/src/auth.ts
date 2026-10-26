import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { db } from "./db.ts";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const COOKIE = "session";
const SESSION_DAYS = 7;

export type Staff = { id: number; email: string; name: string };
export type Env = { Variables: { staff: Staff; requestId: string } };

// Passwords are stored as "salt$hash", never as the password itself.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export async function startSession(c: Context, staffId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO sessions (token_hash, staff_id, expires_at)
     VALUES ($1, $2, now() + $3 * interval '1 day')`,
    [sha256(token), staffId, SESSION_DAYS],
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession(c: Context): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  deleteCookie(c, COOKIE, { path: "/" });
}

// Middleware: lets the request through only with a valid session, and remembers who it is.
export async function requireStaff(c: Context<Env>, next: Next) {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: "Sign in required" }, 401);
  const result = await db.query<Staff>(
    `SELECT staff.id, staff.email, staff.name
     FROM sessions JOIN staff ON staff.id = sessions.staff_id
     WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`,
    [sha256(token)],
  );
  const staff = result.rows[0];
  if (!staff) return c.json({ error: "Sign in required" }, 401);
  c.set("staff", staff);
  await next();
}
