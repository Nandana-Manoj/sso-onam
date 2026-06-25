# Staging seed / reset scripts

Small Node scripts that populate or clear a **known-good test dataset** on the
**staging** Supabase project, so volunteers test against predictable data instead
of inventing rows. Part of the operational-safety plan in
[`docs/release-readiness.md`](../../docs/release-readiness.md) §4.

> **Staging only.** These use the service-role key and write directly. The scripts
> hard-refuse to run if the target URL matches `PROD_SUPABASE_URL`, and require an
> explicit `--yes`. Never point them at production.

## Prerequisites

1. `web/` dependencies installed (`npm install` in `web/`) — the scripts reuse
   `@supabase/supabase-js` from there. Node 20.6+ (for `--env-file`).
2. A staging Supabase project that already has the schema applied (run the
   `supabase/migrations/*.sql` files in order in its SQL editor first).
3. Ops env file: copy [`.env.staging.example`](../../.env.staging.example) at the
   repo root → `.env.staging` and fill in the **staging** `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and your `PROD_SUPABASE_URL` (the safety net).

## Usage

Run from the **repo root** (so `--env-file` resolves):

```
# Populate a fresh dataset (cleans any previous seed first — idempotent)
node --env-file=.env.staging web/scripts/seed-staging.mjs --yes

# Remove the seeded dataset
node --env-file=.env.staging web/scripts/reset-staging.mjs --yes
```

Drop `--yes` to do a dry confirmation: the script prints the target host and the
action, then refuses, so you can eyeball that you're aimed at staging.

## What gets seeded

| Tower | Contents |
|---|---|
| **Test Tower A** (`TTA`) | Flats 101–105, one resident each, one contribution per status: `payment_pending`, `submitted`, `verified`, `rejected`, and `verified` + refund requested. |
| **Test Tower B** (`TTB`) | Flat 201, one resident with a `submitted` contribution — for cross-tower verification tests (Rep A must not be able to verify it). |
| **Test Tower C** (`TTC`) | A rep with an empty queue. |

Plus one **Test Admin** (so admin-only flows — events, tower/rep management, dashboards
— are testable). All submitted/verified rows carry `paid_to_rep_user_id` so the rep
collection ledger/donut attributes them correctly.

- The year-`9999` "TEST — Onam Seed Event" is activated **only if** no other event
  is active (the one-active-event constraint). Otherwise it's seeded inactive and
  the script tells you to activate it from the admin UI.
- Every account logs in with the password printed at the end of the seed run.

## Safety tags (how cleanup stays surgical)

Cleanup deletes **only** rows matching these sentinels, so it never touches real
or tester-created data:

- Towers with code `TTA` / `TTB` / `TTC`
- The event with `year = 9999`
- Profiles whose `mobile` starts `+919999000`
