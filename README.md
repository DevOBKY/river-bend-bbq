# River Bend BBQ

The reference code for the running example in [DevOBKY](https://devobky.org)'s Building track:
the catering-order system for River Bend BBQ, a (fictional) barbecue restaurant in Owensboro, KY.

This branch is the system as it stands at the **end of A2** *Building with LLMs*: on top of the S2
redesign, the API has a catering planner (`POST /catering/suggest`) that turns a description of an
event into an order from the real menu, and an FAQ helper (`POST /catering/ask`) that answers only
from River Bend's FAQ, plus an eval suite in `api/evals/`. Earlier states are tagged
[`end-of-b4`](https://github.com/DevOBKY/river-bend-bbq/tree/end-of-b4) and
[`end-of-s2`](https://github.com/DevOBKY/river-bend-bbq/tree/end-of-s2); this one is
[`end-of-a2`](https://github.com/DevOBKY/river-bend-bbq/tree/end-of-a2).

The AI features need a Claude API key in the `ANTHROPIC_API_KEY` environment variable. Without one,
they report themselves unavailable and everything else works. API use is billed per request, so set a
spending limit in the Claude Console. Never commit a key.

The lessons build it up step by step, so your code will look different along the way. Use this repository to compare, to get unstuck, or to see
how the pieces fit together. Don't just copy it: the projects ask you to build your own system,
and the understanding comes from building.

| Folder | What it is | Course |
| --- | --- | --- |
| [`database/`](database) | The database design, sample data, and a small runner for practising SQL | B1 *Data & Databases* |
| [`api/`](api) | The API: menu, catering orders, staff sign-in, plus unit and integration tests | B2 *APIs & Backends*, B4 *Testing & Quality* |
| [`web/`](web) | The React site: menu, cart, checkout, staff dashboard, plus end-to-end tests | B3 *Frontend Applications*, B4 |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Runs every check on every push and pull request | B4 |

## What you need

- [Node.js](https://nodejs.org) 24 or newer
- Git Bash or another POSIX shell on Windows, for the `curl` examples in the lessons

Everything runs locally. The database is [PGlite](https://pglite.dev), real Postgres running inside
Node, so there's nothing else to install.

## Running it

### Practise SQL (B1)

```bash
cd database
npm install
node sql.ts schema.sql
node sql.ts seed.sql
node sql.ts your-query.sql
```

### The API (B2)

```bash
cd api
npm install
node create-staff.ts pat@riverbend.example "Pat Owner" "smoked-brisket-42"
npm run dev
```

The API runs on <http://localhost:3000> (try `/health` and `/menu`). The first start creates a
database in `api/db` with the sample menu and orders. Delete that folder to start fresh. Run
`create-staff.ts` while the API is stopped: only one program can open the database at a time.

### The website (B3)

With the API running, in a second terminal:

```bash
cd web
npm install
npm run dev
```

Open <http://localhost:5173>. Vite forwards `/api/*` to the API on port 3000. Sign in to the staff
area with the account you created above.

## Tests (B4)

```bash
cd api
npm run typecheck
npm test                 # unit and integration tests, against an in-memory database (fake model)
npm run eval -- --fake   # the planner eval harness, with a naive fake model (free)
npm run eval             # the planner eval, against Claude (needs ANTHROPIC_API_KEY; costs money)

cd ../web
npm run lint
npm run build
npx playwright install chromium   # once
npm run test:e2e         # starts its own API and site on ports 3100 and 5174
```

The end-to-end tests start fresh copies of both servers with sample data and a test staff account,
so they never touch your development database.

## Things to notice

- **Prices come from the database, never from the client.** The checkout sends menu item ids and
  quantities; the API looks up prices and copies them onto the order (`unit_price_cents`).
- **Placing an order is one transaction.** If any line item fails, nothing is saved.
- **Business rules live in `api/src/orders.ts`,** away from the database and the web server, so
  they can be unit-tested in milliseconds.
- **Staff sessions** are random tokens stored as hashes, in `httpOnly` cookies. Passwords are hashed
  with `scrypt`.

The sample staff password above is for local practice only. Never reuse it anywhere real.
