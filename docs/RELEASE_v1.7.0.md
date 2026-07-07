# Release v1.7.0

**Tag:** `v1.7.0`  ·  **Merge commit on `main`:** `7ae99b4`  ·  **Date:** `2026-07-08`

Semver bump: `[ ] PATCH (fix)  [x] MINOR (feature)  [ ] MAJOR (breaking/data-model)`

---

## What changed
- Fixed dashboard tables (Flats & Amounts, Sadya ledger, Tower Leaderboard,
  Per-Tower Breakdown, Sadya Serving, Reps & Collections, Settlements)
  overflowing the page and misaligning on mobile — tables now scroll inside
  their own container instead of wrapping cell text and throwing rows out of
  alignment.
- Renamed the sadya headcount labels from "Passes" to "No. of Leaves" across
  the admin/rep dashboards and CSV exports.
- Removed the "Children" input from sadya booking forms (resident booking +
  rep/admin offline walk-in). New sadya bookings are adults-only; kids no
  longer get a separate sadya pass. Existing bookings that already include
  children are unaffected and can still be cancelled/refunded normally.
- Updated the Help contact to Arun Mohan.
- QR images (sadya flat pass, rep UPI QR) now try the native share sheet
  first when saving to the device, so they land in Photos instead of
  Files/Downloads on browsers that support it; falls back to the previous
  download behavior otherwise.
- DB: fixed `set_my_rep_payment` throwing "query returned more than one row"
  for any tower rep managing more than one tower (the multi-tower rep model
  was never propagated into this function).

## Migrations to apply to PROD
- [x] `supabase/migrations/20260708090000_phase3_09_fix_multitower_rep_payment.sql`
      — already applied by hand in the prod Supabase SQL editor **before**
      this merge, and confirmed working live (a multi-tower rep successfully
      saved their payment details on prod).

**Pre-migration snapshot taken & downloaded:** `[ ] no` — no destructive
schema change (function replace only, no columns/tables touched).

## UAT sign-off (on STAGING, the commit being promoted)
- [x] **Tower Rep** — payment details save (the bug this release fixes) —
      confirmed working directly by the user on both staging and prod, not
      just in tests.
- [ ] **Resident** — sadya booking form (adults-only) and the mobile table
      fixes — verified via `tsc`, the existing unit/component suite (20/20
      passing), and a rendered mockup using the real CSS reproducing the
      exact reported overflow/alignment bug and confirming the fix. Not
      clicked through live in a browser this round (would need an
      authenticated staging session).
- [ ] **Admin** — dashboard tables — same verification as above (rendered
      mockup + tests), not clicked through live.
- [ ] **QR "save to Photos" fix** — code reviewed and structured to fail
      safe (falls back to the old download behavior on any unsupported
      browser or error), but not yet confirmed on a real phone. Flagging
      honestly — recommend a quick real-device spot-check post-deploy.

## Go/no-go (solo gate)
- [x] Migration applied to prod before this merge, and confirmed fixed live
- [x] No destructive schema change / no data at risk
- [ ] Full live click-through on staging not done this round (see UAT above)

---

## Deploy steps
1. [x] Applied the migration above to **prod** (before merging).
2. [x] `staging` merged into `main` (`7ae99b4`) → Vercel auto-deploys prod.
3. [x] Tagged `v1.7.0` on the merge commit.
4. [ ] **GitHub Release not created** — `gh` CLI isn't installed in this
       environment. Paste this file's contents into a new release at the
       repo's Releases page, target tag `v1.7.0`.
5. [ ] Smoke-test prod once the Vercel deploy finishes: check a dashboard
       table on a phone (no more overflow/misalignment), confirm the sadya
       booking form is adults-only, and spot-check the QR save on a real
       device if convenient.

## Rollback (if needed)
- **Frontend:** in the prod Vercel project, Promote-to-Production the
  previous good deployment (or redeploy tag `v1.6.0`).
- **Database:** forward-only. If `set_my_rep_payment` needs to go back,
  write a corrective migration — do NOT un-run this one under pressure.

**Previous good tag:** `v1.6.0`
