# 001: Kitchen capacity for staff

Status: done

## Problem

The kitchen can smoke about 120 lb of meat a day. When a customer calls to ask about a big order,
staff add up the day's orders by hand to see if there's room. It's slow, and they've got it wrong
twice this year, once by counting a cancelled order.

## Change

A staff-only endpoint, `GET /kitchen/capacity?date=YYYY-MM-DD`, that returns how much meat is booked
for pickup that day and how much room is left:

```json
{ "capacity": { "date": "2026-10-24", "bookedPounds": 20, "limitPounds": 120, "availablePounds": 100 } }
```

## Acceptance criteria

1. Returns the pounds of meat (menu category `meat`) on orders for pickup that day, the 120 lb limit,
   and what's left. Cancelled orders don't count; every other status does.
2. "That day" means the day in Owensboro (America/Chicago), not in UTC: a 7 pm pickup on Nov 2 counts
   on Nov 2.
3. `availablePounds` is never negative, even if the day is overbooked.
4. A missing or invalid date (`tomorrow`, `2026-02-30`) gets a `400` with
   `date must be a day, like 2026-10-24`.
5. Without a staff session, `401`, like every other staff endpoint.

## Out of scope

- Stopping customers from placing orders over the limit (that's a later spec, and needs a
  transaction-safe check).
- Showing capacity on the website.
- Changing the limit; 120 lb is a constant for now.

## Notes for whoever builds it

- The capacity query already exists inside `api/src/capacity-tool.ts` (A2's tool example). Move it
  into its own module, `api/src/capacity.ts`, and have the tool use that, so there's one copy.
- Use `requireStaff`, like `GET /orders`.
- Validate the date with zod (`z.iso.date`), like other input in `app.ts`.
- Tests go in `api/src/app.test.ts`, inside the `staff` block, one per criterion.

## Done when

`npm run typecheck` and `npm test` pass in `api/`, and the five criteria each have a test.
