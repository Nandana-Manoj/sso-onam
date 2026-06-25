# Release vX.Y.Z

> Copy this into the GitHub Release notes when promoting to production.
> Prod deploys when `staging → main` is merged (Vercel auto-deploys `main`).
> Tag the merge commit `vX.Y.Z` as the immutable record.
> See [release-readiness.md](release-readiness.md) §5 for the full process.

**Tag:** `vX.Y.Z`  ·  **Merge commit on `main`:** `<sha>`  ·  **Date:** `YYYY-MM-DD`

Semver bump: `[ ] PATCH (fix)  [ ] MINOR (feature)  [ ] MAJOR (breaking/data-model)`

---

## What changed
<!-- One line per merged feature/fix. Link the PR. -->
- …
- …

## Migrations to apply to PROD
<!-- Exact .sql filenames in apply order, or "None". Applied by hand in the prod -->
<!-- Supabase SQL editor BEFORE the merge to main (the merge auto-deploys the -->
<!-- frontend, which must not reach prod ahead of its schema). -->
- [ ] None
<!-- or -->
- [ ] `supabase/migrations/2026XXXX_phaseX_..sql`

**Pre-migration snapshot taken & downloaded:** `[ ] yes`

## UAT sign-off (on STAGING, the commit being promoted)
<!-- Solo: your own pass/fail per role. All three must pass before merging to main. -->
- [ ] **Resident** — registration / contributions / refund — pass / fail
- [ ] **Tower Rep** — payment verification / handover / refund — pass / fail
- [ ] **Admin** — event / towers-reps / dashboards & CSV — pass / fail

## Go/no-go (solo gate)
- [ ] All three UAT roles pass on staging
- [ ] Pre-migration snapshot taken (if any migrations)

---

## Deploy steps
1. [ ] Apply the migrations above to **prod** (in order), if any.
2. [ ] Merge `staging → main` → Vercel auto-deploys prod.
3. [ ] Tag the merge commit `vX.Y.Z` and publish this Release.
4. [ ] Smoke-test prod with one trivial, reversible action.

## Rollback (if needed)
- **Frontend:** in the prod Vercel project, Promote-to-Production the previous good
  deployment (or redeploy the previous tag).
- **Database:** forward-only — write a corrective migration or restore the
  pre-migration snapshot. Do NOT un-run a migration under pressure.

**Previous good tag:** `vX.Y.(Z-1)`
