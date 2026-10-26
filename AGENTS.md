# Working on River Bend BBQ

Instructions for AI coding agents (and a quick start for people). Many agent tools read a file like
this automatically; for the rest, point the agent at it.

## What this is

The catering-order system for River Bend BBQ, a fictional barbecue restaurant in Owensboro, KY:
`api/` (Hono + PGlite, TypeScript run directly by Node 24), `web/` (React + Vite), and `database/`
(SQL practice). Business rules live in `api/src/orders.ts`, storage in `api/src/order-store.ts`, HTTP
in `api/src/app.ts`.

## Commands

Run these from `api/` and make sure they pass before you say you're done:

```bash
npm run typecheck
npm test
```

If you changed `web/`, also run `npm run lint`, `npm run build`, and `npm run test:e2e` there.

## How we work

- **Work from a spec.** Specs live in `docs/specs/`. Do what the spec says, and nothing it doesn't.
  If the spec is unclear or seems wrong, stop and ask instead of guessing.
- **One acceptance criterion, at least one test.** Write the test first and watch it fail.
- **Keep changes small** and in the style of the code around them. No drive-by refactors.
- **Imports use `.ts` suffixes**, and only erasable TypeScript syntax (no enums, no parameter
  properties). `tsconfig.json` enforces this.

## Never

- Delete, skip, or weaken a test to make it pass. If a test seems wrong, say so.
- Edit `seed.sql` or `schema.sql` to make a test pass. Schema changes need a spec.
- Add a dependency without asking.
- Commit secrets, `.env` files, or API keys, or print them in logs.
- Change `api/src/agent/staff-tools.ts`'s `staffPolicy` or a tool's permissions without a person
  reviewing it: those lines decide what an agent may do without asking.
- Push to `main`. Open a pull request and fill in the template.
