import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Real Postgres, stored in a folder (./db by default). Set DB_DIR=memory:// for a throwaway
// in-memory database, which is what the tests use.
const dir = process.env.DB_DIR ?? "./db";
const firstRun = dir.startsWith("memory://") || !existsSync(dir);
export const db = new PGlite(dir);

// Drops every table and recreates them with the sample data.
export async function resetDatabase(): Promise<void> {
  await db.exec(readFileSync("schema.sql", "utf8"));
  await db.exec(readFileSync("seed.sql", "utf8"));
}

if (firstRun) {
  await resetDatabase();
  console.log("Created a new database with sample data.");
}
