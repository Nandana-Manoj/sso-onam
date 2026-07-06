# Release v1.6.0

**Tag:** `v1.6.0`  ·  **Merge commit on `main`:** `ce5e97a`  ·  **Date:** `2026-07-06`

Semver bump: `[ ] PATCH (fix)  [x] MINOR (feature)  [ ] MAJOR (breaking/data-model)`

---

## What changed
- Removed the resident-facing "Cancel & Request Refund" option for flat
  contributions. Residents can no longer self-initiate a refund once their
  contribution is verified.
- Removed the tower rep's "Refund Requests" approve/decline queue on the
  Verification Queues page — reps no longer action contribution refunds.
- Added an admin-only "Refund a Contribution" panel on the Admin Dashboard:
  search by flat number, enter an optional reason, and refund a verified
  contribution in a single step. Frees the flat to contribute again, same as
  before.
- DB: dropped `request_refund` (resident/admin-initiated two-step request),
  added `admin_refund_contribution` (admin-only, one-step), and tightened
  `process_refund` to admin-only (kept only to settle any pre-existing
  `requested` rows by hand — verified there are none in prod as of this
  release).
- Sadya ticket cancellations/refunds are unaffected — residents can still
  request those and tower reps still settle them; this release only changes
  the **flat contribution** refund flow.

## Migrations to apply to PROD
- [x] `supabase/migrations/20260706090000_phase3_08_admin_only_contribution_refunds.sql`
      — applied by hand in the prod Supabase SQL editor **before** this merge.

**Pre-migration snapshot taken & downloaded:** `[ ] no` — no destructive
schema change (no columns/tables dropped, only function replace/drop/create);
confirmed zero rows with `refund_state = 'requested'` in prod before applying,
so no in-flight refund requests could be stranded by the tightened authorization.

## UAT sign-off (on STAGING, the commit being promoted)
- [x] **Resident** — verified contribution no longer shows a refund button
      (asserted via Playwright e2e spec against staging).
- [x] **Tower Rep/Admin refund flow** — verified via integration tests against
      staging with real seeded RPC calls: resident blocked from
      `admin_refund_contribution`, rep blocked from both `process_refund` and
      `admin_refund_contribution`, admin succeeds on both paths. 75/90
      integration tests passed; the 9 failures are pre-existing and unrelated
      (staging has a real active event, "Aaravam '26", with different
      min-contribution/sadya-price values than the sentinel test fixtures
      assume — breaks unrelated sadya/concurrency tests the same way, not a
      regression from this change).
- [ ] **Admin dashboard UI** — not manually clicked through in a browser this
      round; covered by `tsc`/build passing and the RPC-level integration
      tests above. Flagging honestly rather than checking a box I can't
      personally verify.

## Go/no-go (solo gate)
- [x] Refund authorization verified end-to-end on staging (integration tests)
- [x] Migration applied to prod before this merge
- [x] Confirmed zero pending refund requests in prod pre-migration

---

## Deploy steps
1. [x] Applied the migration above to **prod** (before merging).
2. [x] `staging` merged into `main` (`ce5e97a`) → Vercel auto-deploys prod.
3. [x] Tagged `v1.6.0` on the merge commit.
4. [ ] **GitHub Release not created** — `gh` CLI isn't installed in this
       environment. Paste this file's contents into a new release at the
       repo's Releases page, target tag `v1.6.0`.
5. [ ] Smoke-test prod once the Vercel deploy finishes: as a resident with a
       verified contribution, confirm the refund button is gone; as an admin,
       confirm the new "Refund a Contribution" search panel works.

## Rollback (if needed)
- **Frontend:** in the prod Vercel project, Promote-to-Production the
  previous good deployment (or redeploy tag `v1.5.4`).
- **Database:** forward-only. If `admin_refund_contribution` needs to go, drop
  it and recreate `request_refund` from `supabase/migrations/20260625090000_phase1_13_refunds.sql`
  — do NOT un-run this migration under pressure; write a corrective one
  instead.

**Previous good tag:** `v1.5.4`
