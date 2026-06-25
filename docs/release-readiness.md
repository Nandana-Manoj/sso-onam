# Release Readiness & Operational Safety — SSO-Onam

Status: living document. Owner: engineering + committee admins.

This project collects **real money** from residents through volunteer tower reps.
The application-layer safety (all money mutations go through `SECURITY DEFINER`
functions with SELECT-only RLS, append-only `audit_log`, once-per-flat guards) is
strong. This document covers the **operational** safety around it: environments,
testing, and how a change reaches production without corrupting live data.

---

## 1. What is high-risk

Parts where a mistake means money is *wrong*, not just a broken screen:

- **Payment verification** (`verify_contribution`) — a rep clicking "verify" is the
  authoritative statement that cash/UPI was received. The row *is* the truth.
- **Fund handovers** (`fund_handovers`) — reconciles rep-held cash vs committee receipt.
- **Refunds** (`request_refund` / `process_refund`) — "refunded" removes money from
  collections *and* re-opens the flat to pay again.
- **Auth identity** (`profiles` ↔ `auth.users`, mobile-unique) — a test signup that
  burns a real phone number can lock out a real resident.
- **Active-event switch / pricing** (`events.is_active`, snapshots) — changing the
  active event or prices mid-flight changes what people owe.

### Tables most vulnerable to test-data contamination (ranked)

1. `contributions` — the money ledger; junk rows inflate totals and block real flats.
2. `fund_handovers` — corrupts reconciliation directly.
3. `profiles` / `auth.users` — test accounts consume real mobile numbers.
4. `audit_log` — **append-only, so test noise is permanent.**
5. `flats` / `towers` — `on delete restrict` makes test rows hard to remove.
6. (Phase 2) `qr_passes` / `redemptions` — `redemptions` is immutable; test scans are permanent.

The append-only / restrict-heavy design is the reason we use a **separate database**
for testing rather than "clean up afterward" — contamination here is irreversible.

### Workflows that must never be tested against production

Payment verification & override · fund handover · refunds · event
activation / price / freeze changes · bulk resident/rep creation & role changes ·
(Phase 2) QR issuance and redemption.

---

## 2. Environments

Two databases plus a local loop. **Not** three heavyweight environments.

| | Local Development | Staging / UAT | Production |
|---|---|---|---|
| **Purpose** | Build features, apply migrations first, fast iteration | Volunteers & reps validate workflows on realistic fake data | Real residents, reps, money |
| **Users** | Developer(s) | Volunteer testers, a couple of reps, admin | Everyone, for real |
| **Supabase** | Personal/dev project or local stack | `sso-onam-staging` | `sso-onam-prod` |
| **Firebase** | shared project + test numbers | **shared prod project** + staging domain + test numbers (no real SMS) | the Firebase project (real SMS quota) |
| **Web URL** | localhost | `sso-onam-staging.vercel.app` (visually marked) | prod URL |
| **Deploy** | none (working copy) | Vercel project on the `staging` branch (auto) | Vercel project on the `main` branch (auto, tagged) — §5 |
| **Access** | developer machine | testers + admin | dashboard/service-role held by the developer |

**Minimum required:** two Supabase projects (`staging`, `prod`). Firebase can be the
**same project** for both — it's a stateless phone-verification gate, so just add the
staging domain to its Authorized domains and use Firebase test phone numbers (no real
SMS). Local dev points at staging or a throwaway dev project. The line never to cross:
**volunteers do not touch prod.** Rule of thumb: isolate anything that stores data
(Supabase); share stateless verification services (Firebase).

---

## 3. Supabase / schema strategy

- **Separate Supabase projects per environment — yes, always.** Schema-based
  separation does not protect the shared auth pool or the append-only tables.
- **Migrations are forward-only.** Author a new file; never edit a migration already
  applied to prod; never hand-edit prod schema outside a migration file.
- **Promotion order:** local → staging → prod, applying the *same file* each step.
  The main risk is **drift** (staging and prod diverging from a panic prod hot-fix);
  the forward-only + same-file rule is the guard.
- **Test data lives in staging only.** Do not tag/segregate test rows inside prod —
  the append-only tables make that a losing game.
- **Backups:** automated daily backups (+ PITR if available) on **prod**; a manual
  downloaded snapshot before every prod migration and before event day. Staging needs
  no backups — it is reseedable by design (§4).

---

## 4. Test data

Small, deterministic, obviously fake. Volunteers never invent rows.

- **Towers:** 2–3 ("Test Tower A/B/C", codes `TTA/TTB/TTC`).
- **Flats:** ~5 per tower (101–105).
- **Residents:** a handful per tower, using a **reserved fake mobile-number range** so
  they never collide with real residents and are easy to spot.
- **Reps:** one per test tower, known login. **Admin:** one test admin.
- **Contributions:** seed across *every* status (`payment_pending`, `submitted`,
  `verified`, `rejected`) plus one with `refund_state = requested`.
- **Payments:** embedded payment fields populated to match (UTRs like `TEST0001`).
- **Phase 2 — Sadya:** bookings across statuses incl. `verified` and `cancelled`; a
  couple of `qr_passes` in `issued` / `partially_redeemed` for redemption testing.

**Seed:** one committed, idempotent seed artifact run against staging (one command).
**Reset:** truncate transactional + test-auth rows, re-run seed (one command).
**Refresh:** reseed staging fresh before each UAT round and after any shape-changing
migration. Never copy prod data down to staging.

---

## 5. Release process (environment branches, semver)

> Context: **single developer.** Governance is kept to self-discipline + a written
> checklist, not multi-person sign-off. The model below is what an individual maintainer
> can actually sustain while still never shipping untested code to real money.

Two long-lived branches map to two environments via two Vercel projects pointed at the
**same GitHub repo**:

| Branch | Vercel project | Production Branch | Env vars |
|---|---|---|---|
| `staging` | `sso-onam-staging` (new) | `staging` | staging Supabase/Firebase |
| `main` | `sso-onam` (existing — unchanged) | `main` (Vercel default) | prod Supabase/Firebase |

The existing prod project needs **no config change** — `main` is already its production
branch. You only *add* a staging project pointed at the new `staging` branch.

```
feature/* ──PR──▶ staging ──auto──▶ STAGING site ──UAT (§6)──▶ merge staging→main ──auto──▶ PROD
                                                                  └─ tag vX.Y.Z on that commit
```

1. Build on a `feature/*` branch; merge into **`staging`**.
2. Staging auto-deploys; run the UAT checklist (§6) against it.
3. On pass, **merge `staging → main`** → prod auto-deploys. **Tag that commit `vX.Y.Z`**
   and write the GitHub Release.

### Test exactly what you ship

The commit you promote must be the commit you tested. As a solo dev this is easy: **stop
merging features into `staging` once UAT starts**, so the tip you test is the tip you
merge to `main`. Then tag `main` at that commit as the immutable record.

### The "release" is a GitHub Release

Because prod has a **manual DB step**, a deploy alone would silently skip it. The Release
notes are the runbook — use [`docs/RELEASE_TEMPLATE.md`](RELEASE_TEMPLATE.md):

- **Version + what changed** (one line per feature)
- **Migrations to apply to prod** — exact `.sql` filenames in order, or "none"
- **UAT sign-off** — your own pass/fail per role (Resident / Rep / Admin)
- **Pre-migration snapshot taken** — yes/no

### Versioning (semver)

`vMAJOR.MINOR.PATCH`. PATCH = fixes, MINOR = features (Phase 2 = a MINOR, e.g. `v1.1.0`,
or `v2.0.0` if it reshapes the data model), MAJOR = breaking changes. Pick the bump when
you tag.

### Protect `main` (light, but real)

In this model **every commit on `main` ships to real residents instantly**, so `main` is
the dangerous branch. Solo, the goal is just to stop *your own* slips:

- Always flow **forward** (`feature → staging → main`). Never commit features straight to
  `main`.
- Optionally enable a light GitHub branch rule on `main` (no force-push; require the
  change to arrive via PR) — a guardrail against an absent-minded direct push.
- If you ever hotfix `main` directly in an emergency, **back-merge `main → staging`**
  right after so staging doesn't drift behind prod.

### Rollback

- **Frontend:** in the prod Vercel project, **"Promote to Production" on the previous
  good deployment** (or redeploy the previous tag). Fast, safe, fixes most incidents.
- **Database:** forward-only. Do **not** un-run a migration under pressure — write a
  corrective migration, or restore from the pre-migration snapshot (§3).

### Approval (solo)

No second person to ask. The gate is the **written checklist**: all three UAT roles pass
on staging *and* the pre-migration snapshot is taken, recorded in the GitHub Release,
before you merge to `main`. For real money it's worth ensuring at least one trusted
committee member *can* take a backup if you're unavailable (bus factor — see §8).

---

## 6. UAT checklist (run on staging, sign off per role)

Keep each role to one screen. Focus: Registration, Contributions, Payment verification.

> Seeded accounts (all on password `OnamTest#2026`) cover the *existing*-data cases.
> To test **new registration** on staging you need a Firebase **test phone number**
> configured (canned code, no SMS) — or set staging's Firebase env blank so signup
> falls back to mobile + password. Don't register with a real number on staging.

### Resident
- **Registration** — *Happy:* test mobile → OTP (test number) → password → correct tower/flat.
  *Failure:* wrong OTP; mobile already registered (clear message, no crash); weak password.
  *Edge:* abandon mid-OTP and retry; mobile with whitespace/format variants; flat that
  already has a contributing member.
- **Contributions** — *Happy:* create ≥ minimum → submit payment (UTR + screenshot) →
  "submitted". *Failure:* below `min_contribution`; second flat member starts a second
  live contribution → "already in progress"; submit payment twice. *Edge:* request
  refund on a verified contribution; flat re-opens only after the rep marks it refunded.

### Tower Rep
- **Payment verification** — *Happy:* see only own tower's submitted payments; verify →
  `verified`, attribution recorded. *Failure:* verify another tower's payment (refused);
  reject with reason → flat re-opens. *Edge:* two devices act on the same payment (no
  double-process); verify then admin override → `overridden` flips, audit captures both.
- **Fund handover** — *Happy:* log → admin confirms. *Failure:* amount ≤ 0 rejected;
  reject a handover. *Edge:* reconciliation reads correctly after a refund.
- **Refunds** — *Happy:* process requested refund → `refunded`, drops from collections.
  *Failure:* process one not in `requested` state; wrong-tower rep tries to process.

### Admin
- *Happy:* create/activate event; create towers/flats/reps; dashboards + CSV totals correct.
- *Failure:* activate a second event (one-active constraint holds); reassign a rep with
  pending work.
- *Edge:* edit prices/minimum after contributions exist → existing rows keep snapshots,
  new rows pick up new values; change freeze/cutoff times and confirm enforcement.

**Sign-off (solo):** you run all three role checklists on staging yourself and record
the pass/fail in the GitHub Release. Release ships only when all three pass.

---

## 7. Event-day safety

Highest-stakes window. Stability over features.

- **Backups:** daily automated prod backups in the weeks prior; a **manual downloaded
  snapshot the night before and the morning of**, held off-platform. Solo: make sure at
  least one trusted committee member also has a copy / can take one (bus factor).
- **Recovery:** **do a test restore into a scratch project at least once before the
  event** — an untested backup is a rumor. Know the restore time and steps cold.
- **Emergency rollback (event day):** default lever is frontend redeploy-previous. DB
  changes are forbidden except a deliberate corrective migration with a fresh snapshot
  taken immediately before.
- **Production freeze:** freeze code 3–4 days before the event — security/data-loss
  hotfixes only. Set `booking_freeze_at` / `verification_cutoff_at` deliberately and
  verify on staging first.
- **Assume venue WiFi fails:** pre-stage a printed/offline fallback (verified
  contributions / valid QR passes) so collection and sadya entry can continue offline.

---

## 8. Risks & anti-overengineering notes

**Do NOT** (overkill for a volunteer team): three full environments; migration
CI/automation now; copying prod data to staging; per-row `is_test` flags in prod;
release branches or approval bots.

**Watch:** schema drift from panic prod hot-fixes (forward-only rule); test/real mobile
collisions (reserved test range); SMS quota (share the prod Firebase project but use
test phone numbers so staging never sends real SMS); single key-holder bus factor
(≥2 people can back up & redeploy); **untested backups** (the §7 test-restore closes this).

**Vercel licensing:** the free **Hobby** plan is for non-commercial use. A society
collecting real money likely needs **Pro** for prod (a conscious decision — Pro or accept
the terms risk). Also: two Vercel projects on one repo cross-trigger preview builds —
scope each project to build only its own branch (Ignored Build Step) to cut the noise.

**Three things before any Phase 2 code:**
1. Stand up `sso-onam-staging` (a separate Supabase project; reuse the prod Firebase
   project); point all volunteer testing there.
2. Turn on prod backups and do one test restore.
3. Commit a seed script; make "reset staging" one command.
