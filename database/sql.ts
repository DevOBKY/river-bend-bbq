// Runs a .sql file against a real Postgres database stored in the ./db folder.
// Usage: node sql.ts <file.sql>
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const file = process.argv[2];
if (!file) {
  console.log("Usage: node sql.ts <file.sql>");
  process.exit(1);
}

const db = new PGlite("./db");
try {
  const results = await db.exec(readFileSync(file, "utf8"));
  let printed = false;
  for (const result of results) {
    if (result.fields.length > 0) {
      if (result.rows.length > 0) console.table(result.rows);
      else console.log("(no rows)");
      printed = true;
    }
  }
  if (!printed) console.log("Done.");
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
