# Release v1.5.3

**Tag:** `v1.5.3`  ·  **Merge commit on `main`:** `723f5f2db799327105904144d69492b292862a19`  ·  **Date:** `2026-07-04`

Semver bump: `[x] PATCH (fix)  [ ] MINOR (feature)  [ ] MAJOR (breaking/data-model)`

---

## What changed
- Resident home/profile cleanup: removed the duplicate "Need Help?" card from the Profile
  page (already in the header), and moved "Your Tower Rep" above the contribution/sadya
  panels on the resident home page.
- Contribution flow: hide the "Pay Your Tower Rep" box (tap-to-pay, phone, QR) and disable
  submit when the entered pay amount is below the event minimum; simplified the pledged-
  amount wording. Hid the sadya price in the hero banner until sadya booking is open.
- Sadya walk-ins gated on `sadya_open`, at both layers:
  - DB: `record_offline_sadya()` now raises if `sadya_open` is false (was previously
    un-gated — an admin/rep could record a walk-in sadya booking before the committee
    opened booking).
  - UI: the Sadya tab in the offline-payment form (admin dashboard + rep walk-in) no
    longer renders at all when booking is closed, replaced with an explanatory note —
    previously the fields were fillable and only rejected on submit.
- Fixed the Tower Leaderboard sort order: `get_tower_leaderboard` ties on a plain SQL
  string sort of tower name (`Tower 10`/`Tower 11` before `Tower 2`); now re-sorted
  client-side with the same natural-number comparator (`byName`) used by every other
  tower list in the app.
- Fixed the combined revenue donut center label rounding: `Math.round(n/1000)` turned
  e.g. 2500 into a misleading "3k" when the legend/table right next to it showed the
  exact figure; now keeps one decimal in the ₹1k–10k range.
- Ops: added `web/scripts/copy-towers-prod-to-staging.mjs` — read-only against prod,
  additive-only against staging (matches existing rows by name/code, never deletes/
  overwrites) — used once to bring staging's tower list to match prod's real 12 towers.

## Migrations to apply to PROD
- [x] `supabase/migrations/20260704090000_phase3_06_gate_offline_sadya_open.sql` — **already applied** (confirmed by you directly, before this merge)

**Pre-migration snapshot taken & downloaded:** `[ ] no` — same free-tier constraint noted
in v1.5.2; the change is additive (one new `raise exception` guard), nothing to roll back
at the schema level.

## UAT sign-off (on STAGING, the commit being promoted)
- [ ] **Resident** — not separately re-verified this round (contribution min-amount gate
      is new — recommend a quick manual check: try paying below minimum, confirm the pay
      box/QR is hidden and submit is disabled)
- [x] **Tower Rep / Admin** — walk-in sadya gate spot-checked live on staging (screenshot:
      submit correctly rejected with "Sadya booking is not open yet" before the UI-hide
      fix; UI-hide fix itself not re-screenshotted after deploy)
- [ ] **Admin dashboards** — tower leaderboard sort order confirmed via screenshot
      (showed the bug); fix not yet re-screenshotted live

This release was type-checked (`tsc --noEmit`, clean) before each commit, but did **not**
go through the full three-role manual UAT pass your process calls for — flagging this
honestly rather than checking boxes I can't personally verify. Recommend a quick pass on
prod once deployed (see smoke-test step below), given this is the real-money app.

## Go/no-go (solo gate)
- [ ] Full UAT — see caveat above
- [x] Migration already applied to staging + prod (confirmed by you)

---

## Deploy steps
1. [x] Migration already applied to prod (confirmed by you before this merge).
2. [x] `staging` merged into `main` (`723f5f2`) → Vercel auto-deploys prod. *(This merge
       happened directly — not run by this session; discovered already done when I went
       to perform it.)*
3. [x] Tagged `v1.5.3` on the merge commit.
4. [ ] **GitHub Release not created** — `gh` CLI isn't installed in this environment.
       Paste this file's contents into a new release at the repo's Releases page,
       target tag `v1.5.3`.
5. [ ] Smoke-test prod with one trivial, reversible action — do this once the Vercel
       deploy finishes (check deploy status in the Vercel dashboard first).

## Rollback (if needed)
- **Frontend:** in the prod Vercel project, Promote-to-Production the previous good
  deployment (or redeploy tag `v1.5.2`).
- **Database:** forward-only — the one migration in this release only added a guard
  clause; nothing to roll back at the schema level even in an emergency.

**Previous good tag:** `v1.5.2`
