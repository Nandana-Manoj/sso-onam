# Staging setup runbook (one-time)

Stand up the staging environment for SSO-Onam. Do the steps **in order** — later steps
depend on values from earlier ones. See [release-readiness.md](release-readiness.md) for
the why. `[you]` = dashboard/git work only you can do; `[claude]` = I can do it for you.

> Reminder: **only Supabase is duplicated.** Firebase is shared with prod (add a domain +
> test numbers). `send-sms` (MSG91) is the dead OTP path — skip it. Buckets are `rep-qr`
> and `event-assets`.

---

## Step 1 — Git: create the `staging` branch  `[claude]`

Prior work is already committed on `origin/main`. We just commit this session's staging
docs/scripts, then branch.

1. Commit the staging infra to `main` and push.
2. Create `staging` from `main` and push it (`-u origin staging`).

After this: `main` and `staging` both exist on GitHub with identical content.

---

## Step 2 — Staging Supabase project  `[you]`  ← the big one

### 2a. Create the project
- Supabase Dashboard → New project → name `sso-onam-staging`. Pick a region near you.
- Save the **database password** somewhere safe.

### 2b. Apply the schema
- Open the SQL editor and run the **18 migration files** from `supabase/migrations/` **in
  filename order**. Fastest: paste the single combined file `supabase/_bootstrap_all_migrations.sql`
  (all 18 concatenated in order) and run once. This is the same schema as prod.

### 2c. Auth settings (Authentication → Providers / Settings)
- **Email** provider: enabled.
- **Confirm email: OFF.** The app uses synthetic emails and expects `signUp` to return a
  session immediately (see `Register.tsx`). If this is on, registration breaks.
- Site URL / Redirect URLs: leave for now — fill in after Step 4 gives you the staging URL.

### 2d. Storage — nothing to do ✅
- The migrations already create both buckets and their policies (`rep-qr` in `phase1_03`,
  `event-assets` in `phase1_04`). No manual step needed; they exist after the migration run.

### 2e. Edge function: `phone-reset` (optional — only for self-service password reset)
- Deploy `supabase/functions/phone-reset` to the staging project.
- Set its one secret: `FIREBASE_PROJECT_ID` = **the same Firebase project id as prod**
  (you share the Firebase project). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are
  injected automatically.
- **Skip `send-sms`** — it's the retired MSG91 path; not used.

### 2f. Grab the keys (Project Settings → API)
- **Project URL**, **anon/publishable key** → for Vercel (Step 4) and `web/.env.staging`.
- **service_role secret** → for the seed (Step 3). Never goes in the browser.

---

## Step 3 — Seed the test data  `[claude]` (or you)

1. Copy `.env.staging.example` (repo root) → `.env.staging`; fill `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (staging), and `PROD_SUPABASE_URL` (the safety net).
2. From the repo root:
   `node --env-file=.env.staging web/scripts/seed-staging.mjs --yes`
3. Verify in the Supabase Table editor: 3 test towers, a Test Admin, 3 reps, residents,
   and contributions across every status. Login password printed at the end.

> If you paste me the staging URL + service-role key I'll run it; otherwise run it yourself
> (the key should ideally stay only on your machine).

---

## Step 4 — Staging Vercel project  `[you]`

- Vercel → Add New Project → import the **same** GitHub repo (`sso-onam`).
- **Production Branch: `staging`.** Root Directory: `web` (same as prod).
- Environment variables: copy from `web/.env.staging.example` using the **staging**
  Supabase URL + anon key (and Firebase values from Step 5, or leave blank for now).
- Deploy → note the staging URL (e.g. `sso-onam-staging.vercel.app`).
- To cut build noise: scope each project to build only its own branch (Project →
  Settings → Git → Ignored Build Step), so `main` pushes don't trigger staging previews
  and vice-versa.

---

## Step 5 — Firebase (shared project)  `[you]`

- Firebase Console → your existing project → Authentication → Settings → **Authorized
  domains** → add the staging URL from Step 4.
- Authentication → Sign-in method → Phone → **Phone numbers for testing**: add your seeded
  test numbers with canned codes (no real SMS). Use these when testing registration on
  staging — never a real number.
- Put the **same four** `VITE_FIREBASE_*` values as prod into the staging Vercel env (or
  leave blank to disable phone verification on staging and use mobile + password only).
- Back in Step 2c: set the staging Supabase Site URL / allowed redirect to the staging URL.

---

## Step 6 — Smoke test staging  `[you]` (I can guide)

Log in (password from the seed) and confirm the basics:
- **Admin** (`+919999000000`): dashboard totals look right; events/towers/reps visible.
- **Rep A** (`+919999000009`): sees Tower A's `submitted` payment; can verify it; the
  verified amounts attribute to Rep A in the ledger/donut.
- **Resident A2** (`+919999000002`): sees their submitted contribution.
- Confirm Rep A **cannot** verify Tower B's payment (cross-tower guard).

---

## Step 7 — Production safety (independent — do anytime)  `[you]`

- Prod Supabase → enable automated daily backups (+ PITR if your plan has it).
- **Do one test restore** into a throwaway project so you know it works and how long it
  takes. An untested backup is a rumor.

---

## Step 8 — Light protection on `main`  `[you/claude]`

- GitHub → repo → Settings → Branches → add a rule on `main`: no force-push; ideally
  require changes via PR. Solo, this just stops an absent-minded direct push (every commit
  on `main` auto-deploys to real residents).

---

## Done — the ongoing loop

After setup, day-to-day is just: build on `feature/*` → merge to `staging` (auto-deploys
staging) → UAT → merge `staging → main` (auto-deploys prod) → tag `vX.Y.Z` + GitHub
Release. Apply any DB migration to staging first, then prod (before the merge). Reseed
staging anytime with `reset-staging.mjs` / `seed-staging.mjs`.
