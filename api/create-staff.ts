// Adds a staff account. Usage: node create-staff.ts <email> <name> <password>
// Stop the server first: only one program can open the ./db folder at a time.
import { hashPassword } from "./src/auth.ts";
import { db } from "./src/db.ts";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.log("Usage: node create-staff.ts <email> <name> <password>");
  process.exit(1);
}
await db.query("INSERT INTO staff (email, name, password_hash) VALUES ($1, $2, $3)", [
  email.toLowerCase(),
  name,
  await hashPassword(password),
]);
console.log(`Added ${name}.`);
await db.close();
