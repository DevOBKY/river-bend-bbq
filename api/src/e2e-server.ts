// Starts the API for end-to-end tests: a fresh in-memory database with sample data and one known
// staff account. Never use this for real data.
process.env.DB_DIR = "memory://";

// Imported after setting DB_DIR, so db.ts sees it.
const { db } = await import("./db.ts");
const { hashPassword } = await import("./auth.ts");

await db.query("INSERT INTO staff (email, name, password_hash) VALUES ($1, $2, $3)", [
  "pat@riverbend.example",
  "Pat Owner",
  await hashPassword("smoked-brisket-42"),
]);

await import("./server.ts");
