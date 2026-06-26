# Release hardening — adopt LATER

> **Status: deferred / not active yet.** Adopt these once the product has been tested
> on staging and is live in production with real users. They tighten the workflow but
> add friction, so they're intentionally held back until the basics are proven. Today's
> active process is in [release-readiness.md](release-readiness.md) §5 and
> [staging-setup.md](staging-setup.md).

Why wait: while you're still bootstrapping and iterating fast, the lighter setup (work on
`staging`, promote to `main` when ready) is enough. These changes make `main` strict and
formalize the release channel — valuable once mistakes cost real money/users, premature
before that.

---

## 1. Lock `main` to PR-only — "changes go to `staging` only" (the main one)

Make the **only** path into `main` a merged pull request. Then every change you make goes
to `staging`, and `main` updates solely via the deliberate `staging → main` release PR.
Direct `git push origin main` becomes impossible.

**GitHub → Settings → Rules → Rulesets → New/edit branch ruleset:**
- **Target:** Include default branch (`main`) · **Enforcement: Active**
- ☑ **Restrict deletions**
- ☑ **Block force pushes**
- ☑ **Require a pull request before merging**
  - **Required approvals: 0** (solo — so you can merge your own release PR)
  - leave other PR sub-options off
- **Bypass list: empty** (so the rule has teeth; add "Repository admin" only if you want an
  emergency hatch — but that weakens it)

**Implications once active:**
- Every release MUST go through the "Compare & pull request" → merge flow (no CLI push to
  `main`). This matches the documented release process.
- Accidental commits to `main` are blocked outright.

## 2. Make `staging` the default branch (optional reinforcement)

GitHub → Settings → General → Default branch → set to `staging`. Then new feature branches,
clones, and PRs default to targeting `staging`, making "everything flows to staging" the
path of least resistance. Vercel is unaffected (each project tracks its branch explicitly).

## 3. Local `pre-push` hook (optional belt-and-suspenders)

A machine-local git hook that refuses a push to `main` before it reaches GitHub. Catches an
accidental local `git push origin main`. Local-only (not a substitute for the ruleset), and
easy to bypass with `--no-verify`. Claude can set this up on request — it doesn't need `gh`.

---

## 4. Pre-release / release-candidate channel — decision: SKIP (for now)

Considered: auto-create/update a GitHub **pre-release** that accumulates commits each time a
PR is merged to `staging`, then promote to a full release.

**Decision: not worth it here**, because the two things it provides you already have free:
- **A deployable "what's coming" build** → the **staging Vercel site** already auto-redeploys
  every merge to `staging`. Testers just visit the URL; there's no downloadable artifact to
  version.
- **An accumulating changelog** → the **`main...staging` compare view** shows what's pending,
  and GitHub's **"Generate release notes"** button auto-lists all PRs/commits since the last
  tag at release time.

**Cost of doing it:** automating "update pre-release on each staging merge" needs a **GitHub
Actions workflow** (the CI we deliberately skipped), plus awkward tag handling (a new
`-rc.N` tag per merge, or mutable tags — bad practice).

**Adopt only if:** you start distributing **versioned downloadable build artifacts** (mobile
APK, desktop binary, installer) that testers must grab by version. A web app doesn't need it.
If you ever want a one-off RC, just tick **"Set as pre-release"** when drafting that single
release — no automation.

## 5. Other CI/CD automation — deferred

Same spirit: GitHub Actions for migration checks, automated tests on PR, deploy pipelines,
etc. All reasonable eventually; all premature for a solo/volunteer setup pre-launch. Revisit
only when a specific pain (a repeated mistake, a slow manual step) actually justifies the
maintenance surface.

---

## Suggested trigger to revisit this doc

After your first **real** production event cycle (or once a second person joins the project),
re-read this and adopt §1 first (it's the highest-value, lowest-cost hardening).
