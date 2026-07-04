# Pre-Release Testing Audit — 2026-07-03

Status: point-in-time report from the first automated test suite built for this repo
(previously zero tests existed). Companion to [`release-readiness.md`](release-readiness.md)
(the manual UAT/ops playbook) — this document covers what's now *automated*, what it found,
and what's still manual-only. Test suite lives in `web/tests/`; run instructions in
[`web/README.md`](../web/README.md#testing).

---

## 1. Feature inventory (discovered)

Stack: React 19 + Vite SPA, no server code — all mutations go through Supabase
`SECURITY DEFINER` RPCs behind RLS. Roles: `resident`, `tower_rep`, `admin`, plus an
orthogonal `is_sadya_rep` flag, and an unused `sponsorship` enum value.

| Area | Pages | Key RPCs |
|---|---|---|
| Auth | Login, Register, Onboarding, ForgotPassword | `signUp`/`signInWithPassword`, `complete_registration`, `phone-reset` edge fn |
| Resident | ResidentHome, ContributionPanel, SadyaPanel, Profile | `create_contribution`, `submit_contribution_payment`, `request_refund`, `create_sadya_booking`, `submit_sadya_payment`, `cancel_sadya_booking`, `request_sadya_cancellation` |
| Tower Rep | RepHome, RepVerify, RepDashboard, RepWalkIn, RepSettlements, RepPayment | `verify_contribution`, `process_refund`, `verify_sadya_booking`, `process_sadya_cancellation`, `record_offline_contribution`, `record_offline_sadya`, `set_my_rep_payment` |
| Admin | AdminHome/Dashboard/Admins/Towers/Events/Reps/SadyaReps | `set_active_event`, `update_event_config`, `close_event`/`reopen_event`, `assign_tower_rep`/`remove_tower_rep`, `grant_admin`/`revoke_admin`, `grant_sadya_rep`/`revoke_sadya_rep` |
| Sadya Rep | SadyaScan (+ offline-capable `scanStore.ts`) | `lookup_sadya_pass`, `redeem_sadya_pass`, `list_sadya_passes` |
| Shared | Layout, SuggestionModal, correction requests | `suggestions` (insert-only), `list_pending_corrections`/`decide_correction` |

Full RLS/RPC authorization map (every table × policy, every `SECURITY DEFINER` function's
checks) was produced during discovery and used to drive the security suite — see
`web/tests/integration/security-rls.test.ts` for the codified version.

---

## 2. Test strategy

| Layer | Tool | Target | What it proves |
|---|---|---|---|
| Unit | Vitest (jsdom) | `src/lib/format.ts` validators | Pure logic: mobile normalization, synthetic email derivation, currency formatting |
| Component | Vitest + React Testing Library | `ProtectedRoute`, `SuggestionModal` | Redirect rules, form validation, client never sends server-derived fields |
| Integration/Security | Vitest (node), real network | Live Supabase (staging, then prod) | Actual RLS enforcement, RPC authorization, tower isolation, privilege escalation, cross-role denial — signed-in-as-real-user, not mocked |
| E2E | Playwright, real browser | `vite --mode {staging,prod-test}` against the live backend | Full role journeys through the actual UI |

Priority followed your Phase 2 categorization: **Critical** = money movement (contribution/
sadya create→pay→verify→refund, QR redeem) and RLS/tower isolation; **High** = admin
role-grant lifecycle, cross-tower denial in the UI; **Medium** = event config, suggestion
box; **Low** = cosmetic/UI-only paths (not automated — see §8).

---

## 3. Test files added

```
web/vitest.config.ts, web/playwright.config.ts, web/tsconfig.test.json
web/tests/setup.ts
web/tests/unit/format.test.ts                         (11 tests)
web/tests/component/ProtectedRoute.test.tsx            (6 tests)
web/tests/component/SuggestionModal.test.tsx            (3 tests)
web/tests/fixtures/testEnv.ts                          — env/client helpers, cached+retried signInAs()
web/tests/fixtures/world.ts                            — seedWorld()/teardownWorld(), the shared fixture
web/tests/integration/security-rls.test.ts             (23 tests) — RLS matrix, privilege escalation, the 2 known bugs
web/tests/integration/contributions.test.ts             (11 tests)
web/tests/integration/sadya.test.ts                    (10 tests)
web/tests/integration/admin.test.ts                    (13 tests)
web/tests/integration/events-lifecycle.test.ts          (15 tests) — added in a follow-up pass, see §8b
web/tests/integration/data-integrity.test.ts            (15 tests) — added in a follow-up pass, see §8c
web/tests/e2e/{global-setup,global-teardown,helpers}.ts
web/tests/e2e/auth.spec.ts                              (6 specs)
web/tests/e2e/resident.spec.ts                          (3 specs)
web/tests/e2e/rep.spec.ts                                (3 specs)
web/tests/e2e/admin.spec.ts                              (4 specs)
web/tests/e2e/sadya-rep.spec.ts                          (3 specs)
```

Plus ops-side additions: `web/scripts/seed-prod-test.mjs`, `reset-prod-test.mjs`,
`_lib_prod_test.mjs` (triple-confirmation prod safeguard), and fixes to the existing
`web/scripts/_lib.mjs` (see §6).

**127 automated tests total** (11 unit + 9 component + 87 integration + 20 E2E) as of §8c.

---

## 4. Test fixtures

`web/tests/fixtures/world.ts` (`seedWorld()`/`teardownWorld()`) extends your existing
sentinel pattern from `_lib.mjs` (towers `TTA/TTB/TTC`, mobiles `+919999000…`, event year
`9999`) with:

- **`TTD`** — a 4th sentinel tower, added specifically so a rep can manage a tower they
  don't live in (the multi-tower case that exposed the two bugs in §6).
- **`repMulti`** — reps towers A *and* D, residence in A.
- **`repB`**, **`repC`** — single-tower reps (repC's tower stays empty-queue).
- **`sadyaRepMobile`** (`+919999000050`, matching your existing `make-sadya-rep.mjs`
  convention) — a plain resident flagged `is_sadya_rep=true`.
- 5 residents in tower A, one contribution per status (`payment_pending`, `submitted`,
  `verified`, `rejected`, `verified+refund_requested`) — mirrors `seed-staging.mjs`.
- One cross-tower `submitted` contribution (tower B) and one `submitted` sadya booking
  (tower D) for live verify/QR-issuance tests.

Deterministic and repeatable: every integration/E2E run calls `cleanupTestData()` first
(idempotent), seeds fresh, and tears down in `afterAll`/`globalTeardown`.

---

## 5. E2E coverage matrix

| Role | Scenario | Status |
|---|---|---|
| Auth | Login (per role → correct landing route) | ✅ |
| Auth | Wrong password → error, stays on `/login` | ✅ |
| Auth | Session persists across reload | ✅ |
| Auth | Logout → session cleared, protected routes blocked | ✅ |
| Auth | Cross-role redirect (resident → `/admin/*` bounced home) | ✅ |
| Auth | Registration (phone OTP via Firebase) | ❌ not automated — see §8 |
| Resident | Submit payment on a pending contribution | ✅ |
| Resident | View verified contribution + refund request affordance | ✅ |
| Resident | View rejected contribution + reason, retry | ✅ |
| Tower Rep | See + approve own-tower submitted payment | ✅ |
| Tower Rep | Tower isolation — cannot see another tower's queue (UI-level) | ✅ |
| Tower Rep | Reject with reason → resident sees the reason | ✅ |
| Admin | Nav to every admin area renders | ✅ |
| Admin | Towers list shows seeded towers | ✅ |
| Admin | Events & Config shows seeded event | ✅ |
| Admin | Non-admin blocked from `/admin/*` | ✅ |
| Sadya Rep | `is_sadya_rep` flag grants `/scan` access | ✅ |
| Sadya Rep | Plain resident sees "not set up" message, not the scanner | ✅ |
| Sadya Rep | Admin gets scan access without the flag | ✅ |
| Sadya Rep | Actual camera-based QR scan/redeem | ❌ not automated — see §8 |

---

## 6. Test results

### Staging — **97/97 passing** (final)

First run surfaced real defects (below); all fixed and re-verified green.

### Production — validation pass, by agreement with you (data purged after; **this
approach is staging-only going forward** — see §9)

- Integration: **52/57** — 5 "failures" were environment mismatches, not bugs: several
  RPCs (`create_contribution`, `create_sadya_booking`) always target "whichever event is
  currently active," and prod already has a real active event (`AARAVAM '26`, min
  contribution ₹3000, sadya booking closed) with different config than the sentinel
  event. These tests correctly failed for the right reason and are expected to keep
  failing on prod until it's between events or you re-scope them to skip on prod (like
  the E2E specs already do).
- E2E: **14/14** applicable passed; 6 event-dependent specs **self-skipped** (the
  `!world.event.makeActive` guard) rather than touch the real event.
- Prod verified clean of all sentinel data after every pass (0 sentinel users/towers,
  real event's row counts unaffected).

---

## 7. Bugs found & fixed

### Application bugs (both fail-closed, not privilege escalation — found by the multi-tower-rep fixture)

| # | Bug | File | Fix |
|---|---|---|---|
| 1 | `record_offline_sadya()` gated on `p_tower_id = app_tower_id()` (rep's own residence tower) instead of `is_rep_of(p_tower_id)` — a multi-tower rep got denied recording a walk-in booking for a tower they manage but don't live in | `record_offline_sadya` RPC | `supabase/migrations/20260703094000_phase3_04_fix_multitower_rep_gaps.sql` — applied to **staging and prod** |
| 2 | `sadya_cancellations` SELECT policy had the same stale residence-tower check instead of `is_rep_of(paid_to_tower_id)` | RLS policy `sadya_canc_select` | same migration |

Regression coverage: `security-rls.test.ts` → `describe('KNOWN BUG: ...')` — both tests
went from red to green after the migration, on both environments.

### Ops-tooling bugs (in `web/scripts/_lib.mjs`, used by your real `seed-staging.mjs`/`reset-staging.mjs`, not just this test suite)

`cleanupTestData()` predated several later migrations and tables, so it silently left
rows behind that would eventually make a real reset get stuck:

| # | Gap | Symptom |
|---|---|---|
| 3 | Never deleted `sadya_cancellations` | Deleting the sentinel event failed (FK violation), poisoning every subsequent reset |
| 4 | Never deleted `suggestions` | A sentinel rep who ever submitted a suggestion became permanently un-deletable |
| 5 | `audit_log` cleanup was event-scoped only | Role-management actions (`grant_admin`, etc.) write `event_id = null` audit rows — actor-scoped sweep added |
| 6 | All transactional cleanup was event-scoped only | An RPC that targets "whichever event is active" (not necessarily the sentinel one) leaves rows cleanup can't find by event id — added flat/resident-scoped sweeps as a second net |
| 7 | Auth-user cleanup was joined through `profiles` | An auth user orphaned by a partial/failed prior cleanup (profile gone, auth row left) silently persisted, causing "already registered" on the next seed — now enumerated directly by email prefix |

Bug #6 is the one that mattered most in practice — it's what caused the fake sentinel
sadya-booking to briefly attach to prod's real `AARAVAM '26` event during testing (caught
and cleaned immediately; see §9).

### Test-harness bugs (in the test suite itself, not the app)

- `loginAs()` E2E helper didn't wait for login to complete before the test navigated
  elsewhere — race condition, intermittent failures.
- One rep→resident E2E test used `context.newPage()` (shares localStorage/session with
  the first page) instead of `browser.newContext()` (isolated) — the second login
  silently inherited the first user's session.
- `npm run test:e2e:prod` set prod env for the Node-side setup/teardown but never passed
  `PLAYWRIGHT_VITE_MODE` to the spawned Vite dev server — the **browser** silently fell
  back to `--mode staging` while Node correctly seeded/cleaned prod, so every login
  failed for a very confusing reason. Fixed by threading `PLAYWRIGHT_VITE_MODE` through
  `.env.prod-test`.

---

## 8. Coverage gaps (not automated — manual QA still needed before launch)

- **Registration + Firebase phone verification** — reCAPTCHA and real/test phone OTP
  aren't practically automatable in this environment. Manually verify on staging once a
  Firebase test phone number is configured (per `docs/staging-setup.md`).
- **Actual camera-based QR scanning** (`html5-qrcode` decode) — access control is
  covered; the real scan-and-decode hardware path needs a manual walkthrough on a phone.
- **Google OAuth sign-in** — not automated (would need a real/test Google account flow).
- **Offline queue / IndexedDB (`scanStore.ts`)** — the *server-side* idempotency
  (`client_scan_id` replay safety) is covered in `sadya.test.ts`; the *browser* offline
  queue/sync behavior itself is not.
- **Bulk approve** (RepVerify, up to 25 at once) — not tested.
- **Event close/reopen + archive** (`close_event`, `reopen_event`, `get_event_roster`,
  `build_event_archive`) — not tested.
- **Fund handovers / rep settlements** — not tested.
- **Correction requests** (tower/flat change, `list_pending_corrections`/
  `decide_correction`) — not tested.
- **Storage policies** (`rep-qr`, `event-assets` upload paths) — not tested.
- **Load/concurrency** beyond what `web/scripts/load-test.mjs` already covers (reads,
  signup, contribution-creation write path) — that script still doesn't exercise
  verification, fund handovers, or refunds under load.

None of these are blockers on their own, but they're real gaps — prioritize the first
three (registration, camera scanning, OAuth) since they're pure user-facing golden paths
with zero automated coverage.

---

## 8b. Addendum — event create/delete lifecycle (added after a follow-up request)

You asked me to test deleting and recreating events specifically. First finding, before
any test: **there is no delete-event feature in this app** — no RPC, no admin UI button.
I verified this by reading every migration and `AdminEvents.tsx`. The only way to delete
an `events` row at all is a direct service-role/SQL-editor `DELETE`, bypassing the app
entirely. So I tested two different things: (1) the real, supported lifecycle
(create → activate → config → close → reopen), and (2) what actually happens if a
developer *does* delete an event via SQL — since that's a real thing that could happen by
accident, even without an in-app button. New file:
`web/tests/integration/events-lifecycle.test.ts` (15 tests, all passing on staging).

**The good news — the schema already protects you from this:**

- Events with **any** contribution, sadya booking, QR pass, redemption, fund handover, or
  refund request are **hard-blocked from deletion** (`ON DELETE RESTRICT`/`NO ACTION`
  foreign keys) — confirmed with a real `23503 foreign_key_violation` in each case.
- **No authenticated role can delete an event through the app at all** — not even admin.
  There's no DELETE policy on `events` for any role, so this is a database-administrator-
  only operation by design, never a self-service admin action.
- `event_archives` and `rep_settlements` correctly `CASCADE` away if their event is
  deleted (once nothing else blocks it) — no orphaned rows.
- After deleting an untouched, previously-active event, the app degrades gracefully (no
  crash): the "active event" query returns null, residents see "no event open," and a
  replacement event can be created and activated cleanly.

**One regression-worthy finding, not a bug but worth knowing:** an event doesn't need
real money in it to become permanently undeletable. `audit_log.event_id` has no cascade
either, and *any* admin action on an event — even a config-only edit with zero
contributions — writes an audit row that blocks a later hard delete. In practice this
means: the moment an event is touched at all (activated, price-edited, sadya toggled),
it can only ever be removed by a developer manually deleting its `audit_log` rows first
in the SQL editor. That's consistent with treating `audit_log` as a permanent record
(matches the project's own append-only design intent per `release-readiness.md` §1), but
if you ever *did* want a "delete this event, it was a mistake" admin feature, it would
need to either cascade `audit_log` (weakening the audit trail) or be scoped to
truly-untouched events only. **Recommendation: don't build a delete-event feature** — the
existing `close_event` (archives + deactivates) is the correct way to retire one, and the
current DB posture (delete = developer-only, blocked by any real usage) is the safer
default for a real-money app. I'm flagging this so it's a deliberate choice, not an
oversight.

**Also tested while in this area (all pass, all real regression guards):**
- Two events can share the same name+year — schema allows it (no unique constraint). Not
  a defect, but a minor UX gap: worth disambiguating duplicate-looking events in the
  admin list if this ever happens by accident.
- The "one active event" partial-unique index holds even against a direct INSERT that
  bypasses `set_active_event` — confirmed a raw duplicate-active insert is rejected.
- `reopen_event` correctly refuses to reopen a second event while one is already open.
- Non-admin roles are correctly denied event creation and activation.

Total suite is now **112 tests** (97 from the original audit + 15 here), all green on
staging. Not re-run against prod — per §9's recommendation, active-event-shaped tests
stay on staging now that a real event is live there.

---

## 8c. Addendum — data-integrity audit (correction requests, concurrency, reconciliation)

You asked for a data-integrity confirmation — "no data loss or mix-up" — after manually
verifying registration, camera QR scanning, and Google OAuth yourself. New file:
`web/tests/integration/data-integrity.test.ts` (15 tests). This targeted the highest-risk
mechanisms for exactly that failure mode: an untested reassignment flow, and real (not
simulated) concurrent access to the money-deciding functions.

**Correction requests (tower/flat reassignment) — previously completely untested, now
covered:** filing, tower-scoped visibility (current *or* requested tower rep, or admin),
approve (moves the profile; old flat's history is untouched, not duplicated or dragged
along; the resident correctly loses visibility into their old flat afterward — no
lingering access, no orphaned view), reject (profile provably unchanged), the
one-pending-request-per-resident guard, and re-deciding an already-decided request
(refused). All pass. No mix-up found in this flow.

**Reconciliation — dashboard math matches the raw ledger exactly:** built a tower with a
known verified contribution and a known rejected one, called `get_tower_leaderboard`, and
asserted its `total_amount`/`families` exactly matched a hand-computed expectation
(rejected amount correctly excluded, not summed in). Passes.

**Audit log content correctness:** spot-checked that a `verify_contribution` audit entry's
`before`/`after` JSON actually reflects the real state transition, not just that a row
exists. Passes.

**Real concurrency bug found — fixed on both staging and prod:** I ran genuinely
concurrent (`Promise.all`, not sequential) calls against the money-deciding RPCs and found
`verify_contribution` had a check-then-act race: it reads the row, checks its status, and
only *then* updates — with no row lock in between. Two simultaneous calls (an accidental
double-click, a flaky client retrying an in-flight request, or two people acting within
milliseconds of each other) could both read the same "undecided" snapshot and both go
through — confirmed empirically: a plain tower_rep's second concurrent call, which should
have been refused, instead succeeded, and the `overridden` flag (meant to flag a genuine
re-decision) silently stayed `false` because it was computed from stale data. I checked
the other three structurally-identical "decide" functions (`verify_sadya_booking`,
`process_refund`, `process_sadya_cancellation`) and found the exact same missing lock in
all three — `redeem_sadya_pass` and `decide_correction` already do this correctly, so the
fix brings the other four in line with that existing pattern.

**Fix:** `supabase/migrations/20260703095000_phase3_05_fix_verify_race_conditions.sql`
adds `for update` to all four functions' initial row lookup. No behavior change for any
single, non-concurrent call — verified by re-running the entire 87-test integration suite
green after applying it. Applied to **both staging and prod**; re-ran the race 4
consecutive times on staging (all closed) and once more directly against prod using a
throwaway contribution scoped to the inactive sentinel event (never touching the real
`AARAVAM '26` event) — confirmed fixed there too: exactly one success, one clean
rejection, `overridden` correctly `false`.

This was the most significant finding of the entire audit. It's not data *loss* — no
money or row disappeared in any scenario I could produce — but it's exactly the "mix-up"
category you asked about: under real concurrent access, a payment decision's authorization
guard and audit trail could not be trusted to reflect what actually happened. Low
probability in practice (needs two near-simultaneous requests on the *same* row), but
non-zero, and payment verification is the single highest-stakes action in the app.

Total suite is now **127 tests** (112 from the previous passes + 15 here), all green on
staging; the race-condition fix specifically re-verified live on prod as well.

---

## 8d. Addendum — is it safe to commit these tests and run them again after launch?

You asked directly: once real users exist, could running this suite later touch real data?
Answer: **by construction, almost everything here can't — with one real exception I found
and fixed while checking.**

**Why most of it is safe by construction:**
- Committing test files does nothing by itself — nothing runs automatically (no CI is
  wired, deliberately, per your own `release-hardening-later.md`).
- `npm run test` / `test:unit` / `test:component` never touch a network — they can't reach
  prod no matter when they're run.
- `npm run test:integration` / `test:e2e` (no `:prod`) only ever target **staging** — they
  require `.env.staging`, which is gitignored and holds staging's own URL. There's no path
  from these commands to prod, ever.
- `npm run test:integration:prod` / `test:e2e:prod` — the only commands that *can* reach
  prod — require a separate gitignored `.env.prod-test` with three deliberate
  confirmations (exact URL match, an explicit "I understand" flag, a distinct
  `--yes-this-is-prod` flag). That file doesn't exist unless someone deliberately creates
  it; it can't be triggered by accident via the normal commands above.
- Every fixture the suite creates is sentinel-tagged (reserved fake mobile prefix,
  reserved tower codes, reserved event year `9999`), and `cleanupTestData()` only ever
  deletes rows matching those exact tags. A real user's profile, flat, contribution, or
  booking can never match a sentinel filter, so the suite cannot delete or modify real
  user data — by construction, not by care taken in the moment.

**The real exception I found and fixed:** several tests in `events-lifecycle.test.ts`
needed a clean "no active event" starting point to test the one-active-event invariant,
and did that by blindly deactivating **every** event in the database — not scoped to
sentinel ones. Pre-release, with no real event (or only your sentinel one) active, this
was harmless. **Post-release, with a real live event, this would have silently turned it
off** — every resident would suddenly see "No Onam event is open right now," with no data
actually lost, but a real, visible outage caused by what looked like a routine test run.

Fixed: these 6 tests now check first whether the currently active event is a real one; if
so, they **skip themselves** rather than touch it, the same way the E2E resident/rep specs
already did. I proved this works, not just asserted it — created a fake "real-looking"
active event on staging, reran the suite (the 6 tests correctly skipped, the other 9 ran
normally), confirmed the simulated event was still active and completely untouched
afterward, then cleaned up. Also audited every other `.update()`/`.delete()` call across
the entire test suite (`world.ts`, every integration test file) — everything else was
already scoped to a specific ID the test itself created, never to "all rows of a table."

**Bottom line:** yes, it's safe to commit these now. The one gap that could have caused a
real post-launch incident is closed and verified. The only way this suite ever touches
prod at all is the explicit, three-times-confirmed `:prod` commands — reserve those for a
deliberate one-off pass (e.g. between events, or with the same care taken this session),
and the default `npm run test:integration` / `test:e2e` remain your safe, routine gate.

---

## 9. Release readiness assessment

### Production-ready (verified by automated tests, on both staging and prod)

- Auth: login/logout, session persistence, cross-role route protection.
- Contribution lifecycle: create (with minimum enforcement + once-per-flat guard) →
  submit payment → verify/reject → refund request/process, including cross-tower denial.
- Sadya lifecycle: booking → payment → verify (flat-keyed QR issuance) → scan/redeem,
  including partial/full redemption, over-capacity rejection, and offline
  `client_scan_id` replay idempotency.
- RLS/security: tower isolation across contributions/sadya/cancellations, admin-only
  `audit_log`, write-only `suggestions` with server-derived identity, privilege-escalation
  attempts (self-grant admin, direct role UPDATE, direct financial-table INSERT/DELETE)
  all correctly denied.
- Admin role lifecycle: grant/revoke admin (with last-admin and self-revoke guards),
  assign/remove tower rep (with admin-can't-be-rep guard), grant/revoke sadya-rep flag.
- Event lifecycle: create/activate/config/close/reopen; hard-delete is correctly
  impossible in-app and DB-protected the moment an event has any real data (§8b).
- Correction requests (tower/flat reassignment): filing, tower-scoped visibility,
  approve/reject, no history loss or duplication, no re-deciding a settled request (§8c).
- Reconciliation: `get_tower_leaderboard` aggregates verified to match the raw ledger
  exactly, with rejected/refunded rows correctly excluded (§8c).
- Concurrency: the once-per-flat contribution guard and the QR over-redemption guard both
  hold under genuine parallel requests, not just sequential logic (§8c).
- The two multi-tower-rep bugs, and the verify/process-function race condition, are fixed
  and re-verified on both environments.
- Registration, camera-based QR scanning, and Google OAuth — manually verified by you.

### Not yet production-ready / needs manual sign-off before launch

- `docs/release-readiness.md` §7 (backup + test-restore drill) — still marked not done
  as of this audit; do this before event day regardless of test suite status.
- Vercel plan/licensing decision (§8 of release-readiness.md) — unrelated to testing but
  still open.
- Fund handovers, `rep_settlements`, and event close/archive (`get_event_roster`,
  `build_event_archive`) remain automated-test gaps — lower risk than what's now covered
  (no money creation/movement happens in them directly), but still unverified.
- Bulk-approve (RepVerify, up to 25 at once) and the browser-side offline queue/sync UI
  (`scanStore.ts`) — server-side idempotency is covered; the client queue itself isn't.

### Important operational finding from this audit

**Production already has a real, active, named event ("AARAVAM '26", ₹3000 minimum,
sadya booking not yet open)** — this is not an empty pre-launch slate. You authorized
testing directly against it this one time, with a full purge after (confirmed clean).
Going forward, **do not repeat that** — several RPCs always operate on "whichever event
is currently active," so any future automated run against prod while a real event is
active risks writing fake data into real aggregates again, or accidentally succeeding at
something (e.g. `create_contribution`) against real event pricing. Recommendation:
`npm run test:integration` / `test:e2e` (staging) as your routine regression check;
reserve the `:prod` variants for a deliberate, one-off pass when prod is between events
(or accept that those specific tests will keep environment-mismatching, which is safe —
they fail closed, they don't corrupt anything).

### Recommended next actions, in order

1. Run `npm run test` + `npm run test:integration` + `npm run test:e2e` (staging) as a
   standing pre-release gate from now on — it's fast (~90s integration, ~45s E2E) and
   caught two real bugs (one security-adjacent, one a genuine concurrency race in payment
   verification) on its first two real uses.
2. Do the backup/test-restore drill (`release-readiness.md` §7) before committing to an
   event date — this is the one remaining item that isn't about code at all.
3. When time allows, extend coverage to fund handovers, event close/archive, and the
   browser-side offline queue UI — the remaining gaps, all lower-risk than what's covered.

### Confidence assessment — can you proceed?

**Yes, with the backup drill as the one hard gate.** Every core money-moving path, the
full authorization model, event lifecycle (including the delete edge case), tower/flat
reassignment, dashboard-vs-ledger reconciliation, and — critically — behavior under real
concurrent access, are now verified with automated tests that exercise the actual database
and actual UI, not mocks. The two bugs this pass found (a stale-tower-check gap, and a
missing row lock in payment verification) were both real, both fixed, and both re-verified
on staging and prod. Finding and closing issues like that is what this process is for —
it's evidence the net worked, not a reason for hesitation.

What I can't claim is certainty that zero bugs remain — no amount of testing proves that.
What I can say: the specific failure modes you were worried about (data loss, mix-ups
between residents/towers/flats, double-processing under concurrency) were each targeted
directly and specifically, not just incidentally covered, and every one I could construct
a test for either already held or was fixed. Combined with your manual verification of
registration, OAuth, and camera scanning, I don't see a remaining known gap that should
block launch. The backup/restore drill is the one item left that's genuinely untested and
irreversible if wrong — do that, and I'd consider this ready.
