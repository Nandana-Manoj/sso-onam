# Release v1.5.2

**Tag:** `v1.5.2`  ·  **Merge commit on `main`:** `9264d1c470517836a954228688d23858e202747c`  ·  **Date:** `2026-07-04`

Semver bump: `[x] PATCH (fix)  [ ] MINOR (feature)  [ ] MAJOR (breaking/data-model)`

---

## What changed
- Added a full automated testing framework from zero: Vitest (unit/component), Vitest+node
  (integration/security against live Supabase), Playwright (E2E) — 127 tests.
- Fixed `record_offline_sadya()` and the `sadya_cancellations` RLS policy: both checked a
  rep's residence tower instead of `is_rep_of()`, wrongly denying multi-tower reps on
  towers they manage but don't live in.
- Fixed a real concurrency bug: `verify_contribution`, `verify_sadya_booking`,
  `process_refund`, and `process_sadya_cancellation` had a check-then-act race (no row
  lock) — two near-simultaneous calls (double-click, retry, or two people acting at once)
  could bypass the single-decision guard. Added `FOR UPDATE`, matching the pattern already
  used correctly by `redeem_sadya_pass`/`decide_correction`.
- Fixed several gaps in `web/scripts/_lib.mjs`'s test-data cleanup (missing
  `sadya_cancellations`/`suggestions`/actor-scoped `audit_log` handling, orphaned-auth-user
  recovery) that could have left `reset-staging.mjs` permanently stuck.
- Added an opt-in, triple-confirmed prod validation path (`seed-prod-test.mjs` /
  `reset-prod-test.mjs`) for exercising the real target before launch.
- Operational: reset production to a clean slate (`purge-prod-reset.mjs`) — removed all
  early test/beta registrations and their collections, keeping only the admin account and
  the tower/flat structure, ahead of the real launch.

Full findings and methodology: [`docs/testing-audit-2026-07-03.md`](testing-audit-2026-07-03.md).

## Migrations to apply to PROD
- [x] `supabase/migrations/20260703094000_phase3_04_fix_multitower_rep_gaps.sql` — **already applied**
- [x] `supabase/migrations/20260703095000_phase3_05_fix_verify_race_conditions.sql` — **already applied**

**Pre-migration snapshot taken & downloaded:** `[ ] no` — no automated backups exist on the
free-tier Supabase plan; a full JSON export of all removed data was taken as part of the
separate prod reset (`data/prod-backups/`, local-only), but not specifically before these
two migrations. Recommend enabling backups (Pro plan) before the real event.

## UAT sign-off (on STAGING, the commit being promoted)
- [x] **Resident** — registration (manual, Firebase test number) / contributions / refund — pass
- [x] **Tower Rep** — payment verification / handover / refund — pass (97-test automated suite + manual)
- [x] **Admin** — event / towers-reps / dashboards & CSV — pass
- [x] **Sadya Rep** — camera QR scan/redeem (manual) / offline idempotency (automated) — pass

## Go/no-go (solo gate)
- [x] All UAT roles pass on staging
- [x] Migrations applied to both staging and prod, re-verified live on both

---

## Deploy steps
1. [x] Migrations applied to prod (both, confirmed via a safe, sentinel-scoped concurrency check).
2. [x] Merged `staging → main` (`9264d1c`) → Vercel auto-deploys prod.
3. [x] Tagged `v1.5.2` and published this release.
4. [ ] Smoke-test prod with one trivial, reversible action — **do this once the Vercel
       deploy finishes** (check the deploy status in the Vercel dashboard first).

## Rollback (if needed)
- **Frontend:** in the prod Vercel project, Promote-to-Production the previous good
  deployment (or redeploy tag `v1.5.1`).
- **Database:** forward-only — the two migrations in this release only added a row lock
  and corrected two `is_rep_of()` checks; nothing to roll back at the schema level even in
  an emergency. If needed, write a corrective migration.

**Previous good tag:** `v1.5.1`
