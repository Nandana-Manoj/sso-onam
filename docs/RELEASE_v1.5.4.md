# Release v1.5.4

**Tag:** `v1.5.4`  ·  **Merge commit on `main`:** `65acdabb4dd9909d800bb35bdb3e9adec882ad18`  ·  **Date:** `2026-07-04`

Semver bump: `[x] PATCH (fix)  [ ] MINOR (feature)  [ ] MAJOR (breaking/data-model)`

---

## What changed
- Hid the "Continue with Google" button on Login and Register behind a new
  `GOOGLE_AUTH_ENABLED` flag (`web/src/lib/config.ts`), defaulted off. Google
  disabled prod's OAuth client today (`Error 401: disabled_client`, surfaced
  to a user as "Access blocked: Authorization Error" on `accounts.google.com`)
  — likely the same root cause as today's Firebase project suspension, since
  both live under the same Google Cloud project/account. Rather than leave
  users hitting that confusing Google-hosted error page, the button is hidden
  until the Google Cloud side is fixed. No Supabase or Google Cloud settings
  were touched — this is a frontend-only change. Re-enable by setting
  `VITE_ENABLE_GOOGLE_AUTH=true` in Vercel and redeploying, once fixed.
- Confirmed via a read-only check against prod (`auth.admin.listUsers`, no
  writes) that **zero** prod accounts have a Google identity — no one is
  locked out by this change; all 10 existing prod users are on mobile+password.

## Migrations to apply to PROD
- [x] None

**Pre-migration snapshot taken & downloaded:** `[ ] n/a` — no schema change.

## UAT sign-off (on STAGING, the commit being promoted)
- [x] **Resident** — Login and Register pages checked live on staging
      (`sso-onam-staging.vercel.app`): "Continue with Google" no longer
      renders on either page; existing mobile+password login untouched.
- [ ] **Tower Rep** — not applicable to this change (auth-page-only diff).
- [ ] **Admin** — not applicable to this change (auth-page-only diff).

This release was type-checked (`tsc --noEmit`, clean) before committing. The
change only touches the auth pages' rendered UI (a conditional around one
button), so full three-role UAT wasn't re-run — flagging honestly rather than
checking boxes I can't personally verify.

## Go/no-go (solo gate)
- [x] Verified on staging (button hidden, other login paths unaffected)
- [x] No migration, so no pre-migration snapshot needed

---

## Deploy steps
1. [x] No migration to apply.
2. [x] `staging` merged into `main` (`65acdab`) → Vercel auto-deploys prod.
3. [x] Tagged `v1.5.4` on the merge commit.
4. [ ] **GitHub Release not created** — `gh` CLI isn't installed in this
       environment. Paste this file's contents into a new release at the
       repo's Releases page, target tag `v1.5.4`.
5. [ ] Smoke-test prod once the Vercel deploy finishes: load the login page
       and confirm the Google button is gone; confirm mobile+password login
       still works.

## Rollback (if needed)
- **Frontend:** in the prod Vercel project, Promote-to-Production the
  previous good deployment (or redeploy tag `v1.5.3`). Alternatively, this is
  a single feature flag — setting `VITE_ENABLE_GOOGLE_AUTH=true` would bring
  the button back, but note the underlying OAuth client is still disabled, so
  clicking it would still fail until that's fixed separately.
- **Database:** forward-only — no migration in this release, nothing to roll
  back at the schema level.

**Previous good tag:** `v1.5.3`
