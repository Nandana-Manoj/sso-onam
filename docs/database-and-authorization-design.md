# Onam Management — Physical Database & Authorization Design (Phases 15–19)

> Target: Supabase/Postgres. **Design only — no SQL DDL, no migrations, no app/frontend code.**
> Builds on the approved simplified entity set, RBAC v2, security model, and technical architecture.
> Conventions: all PKs are `uuid` (default `gen_random_uuid()`) unless noted; all tables carry
> `created_at timestamptz` (and `updated_at` where mutated); money is `numeric(10,2)`; enums are Postgres
> enum types. **RLS is enabled on every table (default-deny).** The user/profile row is keyed to
> `auth.users.id` (Supabase Auth owns identity + password).

---

## 1. Database Schema (Phase 15)

### 1.1 Master / configuration

**`towers`** — organizational unit; holds the *current* rep + their payment QR (history lives in audit + on
payment rows via `verified_by`).
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| name | text | no | e.g. "T1", "RH"; **unique** |
| code | text | yes | short code; **unique** |
| rep_user_id | uuid | yes | FK→`profiles.id`; current Tower Rep |
| rep_contact | text | yes | display contact shown to residents |
| payment_qr_path | text | yes | storage path to rep's payment QR image |

**`events`** — the annual edition + configuration (snapshotted onto records).
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| name | text | no | "Onam 2026" |
| year | int | no | |
| is_active | bool | no | default false; **one active enforced (§3)** |
| min_contribution | numeric(10,2) | no | per-flat minimum |
| adult_sadya_price | numeric(10,2) | no | |
| child_sadya_price | numeric(10,2) | no | default 0 (0 ⇒ children free but counted) |
| booking_freeze_at | timestamptz | yes | vendor headcount cutoff |
| verification_cutoff_at | timestamptz | yes | gate-readiness cutoff |
| currency | text | no | default 'INR' |

**`flats`** — the contribution-bearing unit / family grouping.
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| tower_id | uuid | no | FK→`towers.id` |
| flat_number | text | no | **canonical normalized** form |
| — | | | **unique (tower_id, flat_number)** ⇒ a flat row belongs to exactly one tower |

**`profiles`** — the User (Resident/Rep/Admin/Sponsorship). `id` = `auth.users.id`.
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK, FK→`auth.users.id` |
| name | text | no | |
| mobile | text | no | **unique** (mirrors `auth.users.phone`) |
| role | enum `user_role` | no | `resident`/`tower_rep`/`admin`/`sponsorship`; default `resident` |
| tower_id | uuid | yes | FK→`towers`; resident's tower / rep's tower |
| flat_id | uuid | yes | FK→`flats`; resident's flat |
| claimed | bool | no | default true; false for proxy-created until first login |
| created_by_user_id | uuid | yes | FK→`profiles`; rep who proxy-created |

*Justification:* identity, password, and `phone` uniqueness are owned by Supabase Auth; `profiles` adds the
domain attributes (role, tower, flat) used by RLS. Role + tower are **also mirrored into the JWT
`app_metadata`** so policies read them without recursively querying `profiles` (see §5).

**`correction_requests`** — Tower/Flat change approvals (kept as a small table for auditability).
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| profile_id | uuid | no | FK→`profiles` (the resident) |
| current_tower_id / current_flat_id | uuid | yes | snapshot |
| requested_tower_id | uuid | yes | FK→`towers` |
| requested_flat_number | text | yes | target flat may not exist yet |
| status | enum `request_status` | no | `pending`/`approved`/`rejected` |
| requested_by_user_id / decided_by_user_id | uuid | | FK→`profiles` |
| decided_at | timestamptz | yes | |
| reason | text | yes | |
| — | | | **partial unique (profile_id) WHERE status='pending'** |

### 1.2 Transactional (payment fields embedded per the simplification)

**`contributions`** — one live row per flat per event.
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| event_id | uuid | no | FK→`events` |
| flat_id | uuid | no | FK→`flats` |
| initiated_by_user_id | uuid | no | FK→`profiles` |
| amount | numeric(10,2) | no | **CHECK amount ≥ min_snapshot** |
| min_snapshot | numeric(10,2) | no | config at creation |
| status | enum `txn_status` | no | `payment_pending`/`submitted`/`verified`/`rejected`/`expired` |
| paid_to_tower_id | uuid | no | FK→`towers` (resident's own tower) |
| amount_paid | numeric(10,2) | yes | filled on submit |
| utr | text | yes | **optional** |
| screenshot_path | text | yes | optional |
| payment_submitted_at | timestamptz | yes | |
| verified_by_user_id | uuid | yes | FK→`profiles` |
| verified_at | timestamptz | yes | |
| decision_reason | text | yes | |
| overridden / overridden_by_user_id | bool / uuid | | admin override marker |
| — | | | **partial unique (flat_id, event_id) WHERE status IN ('payment_pending','submitted','verified')** |

**`sadya_bookings`** — per person, multiple per resident allowed.
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| event_id | uuid | no | FK→`events` |
| resident_id | uuid | no | FK→`profiles` |
| flat_id | uuid | yes | FK→`flats` (reporting) |
| num_adults | int | no | **CHECK ≥ 0** |
| num_children | int | no | **CHECK ≥ 0** (children < 5) |
| total_persons | int | no | **GENERATED = num_adults + num_children; CHECK ≥ 1** |
| adult_price_snapshot / child_price_snapshot | numeric(10,2) | no | config snapshot |
| total_amount | numeric(10,2) | no | |
| status | enum `txn_status_sadya` | no | adds `cancelled` to the txn states |
| *(payment fields)* | | | same embedded set as `contributions` |

**`qr_passes`** — one per verified booking.
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| booking_id | uuid | no | FK→`sadya_bookings`; **unique** |
| event_id | uuid | no | FK→`events` |
| allowed_scans | int | no | = booking.total_persons at issue |
| nonce | text | no | random, unguessable; **unique**; QR payload = `id`+`nonce` |
| redeemed_count | int | no | default 0; **CHECK 0 ≤ redeemed_count ≤ allowed_scans** |
| status | enum `qr_status` | no | `issued`/`partially_redeemed`/`fully_redeemed`/`void` |
| voided_at / voided_by_user_id | timestamptz / uuid | yes | |

**`redemptions`** — one row per scan action; **immutable**.
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| qr_pass_id | uuid | no | FK→`qr_passes` |
| event_id | uuid | no | FK→`events` |
| scanned_by_user_id | uuid | no | FK→`profiles` |
| scanned_at | timestamptz | no | default now() |
| count_redeemed | int | no | default 1 (supports "admit whole party in one tap"); CHECK ≥ 1 |
| result | enum `redeem_result` | no | `accepted`/`rejected_exhausted`/`rejected_void`/`rejected_invalid` |
| device_info | text | yes | |

**`fund_handovers`** — rep→committee transfer log.
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| event_id | uuid | no | FK→`events` |
| tower_id | uuid | no | FK→`towers` |
| rep_user_id | uuid | no | FK→`profiles` |
| amount | numeric(10,2) | no | **CHECK > 0** |
| handover_date | date | no | |
| received_by_user_id | uuid | yes | FK→`profiles` (usually Admin) |
| received_by_name | text | yes | free-text fallback (per workbook) |
| reference / note | text | yes | |
| status | enum `handover_status` | no | `logged`/`confirmed`/`rejected` |
| confirmed_by_user_id / confirmed_at | uuid / timestamptz | yes | |

**`refund_requests`** — *placeholder* (overpay/cancel capture; logic deferred).
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| event_id | uuid | no | FK→`events` |
| resident_id | uuid | no | FK→`profiles` |
| contribution_id / booking_id | uuid | yes | one set |
| amount | numeric(10,2) | no | |
| reason | enum | no | `overpayment`/`cancellation` |
| status | enum | no | `pending` only (v1) |

**`audit_log`** — append-only (see §7).
| Column | Type | Null | Notes |
|---|---|---|---|
| id | bigint | no | PK (bigserial, ordered) |
| event_id | uuid | yes | FK→`events` |
| actor_user_id | uuid | yes | FK→`profiles` (null = system) |
| action | text | no | e.g. `contribution.verified` |
| entity_type / entity_id | text / uuid | | target |
| before / after | jsonb | yes | change snapshot |
| reason | text | yes | |
| created_at | timestamptz | no | default now() |

---

## 2. Relationships

```
auth.users 1──1 profiles
towers 1──< flats 1──< profiles (residents)
towers 1──1 profiles (rep_user_id)            [current rep]
events 1──< contributions / sadya_bookings / qr_passes / redemptions / fund_handovers / refund_requests
flats  1──(0..1) contributions  (per event, live)
flats  1──< profiles
profiles(resident) 1──< sadya_bookings
sadya_bookings 1──(0..1) qr_passes 1──< redemptions
towers + events 1──< fund_handovers
profiles 1──< correction_requests
(all sensitive actions) ──< audit_log
```

---

## 3. Constraints (Phase 16) — placement matrix

| Invariant | DB constraint | DB function | App validation |
|---|---|---|---|
| Mobile uniqueness | ✅ `auth.users.phone` unique + `profiles.mobile` unique | | format hint |
| Flat belongs to one tower | ✅ FK + unique(tower_id, flat_number) | | normalize on entry |
| **One contribution per flat/event** | ✅ partial unique (flat_id,event_id) WHERE active | lock/reopen transitions | |
| Contribution ≥ minimum | ✅ CHECK (amount ≥ min_snapshot) | snapshot set in `create_contribution` | block sub-min in UI |
| Sadya persons ≥ 1; counts ≥ 0 | ✅ CHECK + GENERATED total_persons | | |
| **QR redeemed ≤ allowed** | ✅ CHECK (redeemed_count ≤ allowed_scans) | atomic increment in `redeem_qr` | |
| One QR per booking; unique nonce | ✅ unique(booking_id), unique(nonce) | issue in `verify_payment` | |
| Handover amount > 0 | ✅ CHECK | balance non-negative (advisory) | |
| One active event | ✅ partial unique (is_active) WHERE is_active | `set_active_event` | |
| One pending correction per resident | ✅ partial unique WHERE pending | | |
| amount_paid ≥ required (at verify) | | ✅ `verify_payment` (values exist only at verify) | |
| Pay **own tower only** | FK | ✅ `create/submit` enforce paid_to_tower = resident.tower | |
| Booking before freeze | | ✅ `create_sadya_booking` (time + admin override) | UI disable |
| Verify only by own-tower rep/admin | | ✅ function role+tower check | + RLS |
| Resident can't self-change role/tower/flat | | trigger guard | RLS limits row |

*Principle:* **structural/identity/count invariants → DB constraints** (cheapest, race-proof);
**multi-step / state-transition / cross-value invariants → SECURITY DEFINER functions**; **UX guidance →
app**. The partial unique on contributions is what makes "once per flat" **concurrency-safe** without locks.

---

## 4. Index Strategy

| Table | Indexes | Purpose |
|---|---|---|
| profiles | unique(mobile); (tower_id); (flat_id); (role) | rep roster, flat grouping, role filter |
| flats | unique(tower_id, flat_number); (tower_id) | uniqueness + tower listing |
| contributions | partial unique(flat_id,event_id) WHERE active; (event_id,status); **(paid_to_tower_id,status)**; (flat_id) | once-per-flat, dashboards, **rep verification queue**, flat visibility |
| sadya_bookings | (resident_id); (event_id,status); **(paid_to_tower_id,status)**; (flat_id) | own bookings, dashboards, rep queue |
| qr_passes | unique(booking_id); **unique(nonce)**; (event_id,status) | scan lookup by nonce, dashboards |
| redemptions | (qr_pass_id); (event_id,scanned_at) | per-pass tally, live event counter |
| fund_handovers | (tower_id,event_id,status) | per-tower balance |
| correction_requests | partial unique(profile_id) WHERE pending; (requested_tower_id,status) | rep approval queue |
| audit_log | (entity_type,entity_id); (event_id,created_at); (actor_user_id) | traceability lookups |

The hot paths are the **rep verification queue** (`paid_to_tower_id,status`), the **scan lookup** (`nonce`),
and **dashboard roll-ups** (`event_id,status`) — all explicitly indexed.

---

## 5. RLS Policy Matrix (Phase 17)

**Mechanics.** RLS enabled + default-deny on all tables. Two helpers (`SECURITY DEFINER`, stable):
`current_role()` and `current_tower_id()` read from the **JWT `app_metadata`** (role + tower_id), which is
written only by trusted admin paths and is **not user-editable** (unlike `user_metadata`). Reading from JWT
(not from `profiles`) avoids recursive policy evaluation on `profiles`. **SECURITY DEFINER functions** perform
all multi-step/financial mutations and bypass RLS internally **while re-checking role+tower themselves** — so
client-side direct writes to financial tables are simply not granted.

Legend: **own** = `auth.uid()` ownership; **flat** = same `flat_id`; **tower** = row's tower = caller's tower;
**fn** = only via a transactional function; **—** = denied.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| towers | all authenticated | admin | admin | — |
| events | all authenticated | admin | admin (fn for activate) | — |
| flats | resident: own flat / own tower list · rep: tower · admin: all | resident (own tower, via fn) · rep: tower · admin | rep: tower · admin | — |
| profiles | resident: own · rep: tower · admin: all | resident: own (id=auth.uid) · rep: tower (proxy) · admin | resident: own **non-identity cols** (trigger-guarded) · rep: tower (fn) · admin | — |
| correction_requests | resident: own · rep: tower (current/requested) · admin | resident: own | fn (`approve_correction`) | — |
| contributions | **resident: flat** (flat-shared) · rep: tower · admin | resident: own flat (fn) · rep: tower (fn) | fn (`submit_payment`, `verify_payment`) | — |
| sadya_bookings | resident: own · rep: tower · admin | resident: own (fn) · rep: tower (fn) | fn (submit/verify/cancel) | — |
| qr_passes | resident: own booking · rep: tower · admin | fn (`verify_payment`) | fn (`void_qr_pass`) | — |
| redemptions | resident: own pass · rep: tower · admin | fn (`redeem_qr`) | — | — |
| fund_handovers | rep: tower · admin | rep: tower (`log_fund_handover`) | fn (`confirm_fund_handover`, admin) | — |
| refund_requests | resident: own · rep: tower · admin | fn | admin | — |
| audit_log | admin: all · rep: own-tower entities (via view/fn) | fn only (definer) | — | — |

**How tower-scoping is enforced.** Each privileged policy compares the row's tower to `current_tower_id()`:
- direct `tower_id` (towers, flats, fund_handovers, profiles),
- `paid_to_tower_id` (contributions, sadya_bookings — the tower the resident paid),
- via the parent (qr_passes/redemptions → booking → tower; correction_requests → requested/current tower).
Residents are scoped by **ownership** (`resident_id = auth.uid()`) or **flat** (`flat_id = caller.flat_id`,
which powers the flat-shared contribution visibility). A Tower Rep therefore can **never** read another
tower's residents, payments, proof, or passes; cross-tower reads return zero rows at the database.

**DELETE is denied everywhere** — history is preserved; "removal" is a status change.

---

## 6. Transactional Functions (Phase 18)

All are `SECURITY DEFINER`, `EXECUTE` granted to `authenticated`, with `search_path` pinned; each writes an
`audit_log` row in the same transaction. **(Auth-user creation and message-sending are Edge Functions using
the service role — noted where relevant — because they call the Auth admin API / external providers, which
pure SQL cannot.)**

1. **`create_contribution(flat_id, amount)`**
   - *In:* flat, amount. *Out:* contribution row/id.
   - *Perms:* resident of that flat, or rep (own tower), or admin.
   - *Tx:* snapshot `min` + set `paid_to_tower = caller's tower`; insert `payment_pending`.
   - *Fails:* amount < min; active contribution already exists (partial-unique violation → friendly "flat already has a live contribution"); not member of flat.

2. **`create_sadya_booking(num_adults, num_children)`**
   - *In:* counts. *Out:* booking id.
   - *Perms:* resident (self) / rep proxy (own tower) / admin.
   - *Tx:* snapshot prices, compute total, set tower; insert `payment_pending`.
   - *Fails:* total_persons < 1; after `booking_freeze_at` (unless admin); invalid counts.

3. **`submit_payment(payable_type, payable_id, amount_paid, utr?, screenshot_path?)`**
   - *Perms:* the owning resident.
   - *Tx:* set payment fields, status → `submitted`.
   - *Fails:* not owner; wrong current status; payable not found.

4. **`verify_payment(payable_type, payable_id, decision, reason?)`**
   - *Perms:* **Tower Rep of `paid_to_tower_id`** or **Admin**.
   - *Tx (atomic):* on **approve** → check `amount_paid ≥ required`; status → `verified`; **if booking, insert
     `qr_passes` (nonce, allowed_scans = total_persons)**. On **reject** → status `rejected` (contribution
     thus reopens the flat). Audit with actor+reason; set `overridden` if admin acting cross-tower.
   - *Fails:* unauthorized (wrong tower/role); not in `submitted`; `amount_paid < required` (→ `needs_info`);
     concurrent double-verify (row lock).

5. **`redeem_qr(nonce, count := 1, device_info?)`**
   - *Perms:* Rep (own tower) or Admin (scanner).
   - *Tx (atomic):* `SELECT … FOR UPDATE` the pass by nonce; verify event active, status≠void; if
     `redeemed_count + count ≤ allowed_scans` → increment, set `partially/fully_redeemed`, insert
     `accepted` redemption. Else insert a `rejected_*` redemption and return rejection.
   - *Out:* `{accepted, remaining, holder_name, flat}` (name/flat for operator eyeball).
   - *Fails:* invalid/unknown nonce; void; exhausted; wrong event; unauthorized tower. **Row lock makes
     concurrent scans safe — no over-redemption** (online-first ⇒ single source of truth, no offline gap).

6. **`approve_correction(request_id, decision)`**
   - *Perms:* Rep **only when current & requested tower = caller's tower** (intra-tower flat fix); **Admin**
     for anything cross-tower.
   - *Tx:* on approve → resolve/create target flat, update `profiles.tower_id/flat_id`, mark approved, audit;
     flag that the user's JWT claim must refresh on next login if tower changed.
   - *Fails:* not pending; unauthorized (cross-tower by a rep); invalid target.

7. **`log_fund_handover(tower_id, amount, handover_date, received_by?, reference?, note?)`**
   - *Perms:* Rep of that tower. *Tx:* insert `logged`. *Fails:* amount ≤ 0; not own tower.

8. **`confirm_fund_handover(handover_id)`** — *Perms:* Admin. *Tx:* `logged → confirmed`, audit. *Fails:* not
   admin; wrong status.

9. **`void_qr_pass(booking_id, reason)`** — *Perms:* Admin (or rep own tower) on cancel/reversal. *Tx:* status
   `void`, audit. *Fails:* unauthorized; already redeemed (policy decision: allow void with note).

10. **`set_active_event(event_id)` / `update_event_config(...)` / `grant_role(user_id, role, tower_id?)`** —
    *Perms:* Admin. *Tx:* enforce single-active; update config/role + **sync JWT `app_metadata`**; audit.

11. **`create_proxy_resident(name, mobile, flat_number, temp_password)` — *Edge Function*** (service role):
    creates the `auth.users` record (phone, temp password, confirmed) + `profiles` row (`claimed=false`,
    `created_by`), in the rep's own tower. *Perms:* Rep (own tower) / Admin. *Fails:* mobile already exists;
    not own tower.

---

## 7. Audit Model (Phase 19)

- **Tables:** `audit_log` (append-only). `redemptions` is itself an immutable financial-ish stream and is
  **not** double-logged into `audit_log` (the scan log is the record; only exceptional voids/overrides are
  audited).
- **Audit events (the `action` vocabulary):** `contribution.created/submitted/verified/rejected/expired`,
  `booking.created/submitted/verified/rejected/cancelled`, `payment.overridden`,
  `qr.issued/voided`, `correction.requested/approved/rejected`, `handover.logged/confirmed/rejected`,
  `event.config_updated/activated`, `role.granted`, `profile.proxy_created`, `refund.requested`.
- **Single write path:** every financial/sensitive mutation goes through a `SECURITY DEFINER` function that
  writes the audit row **in the same transaction** as the change; direct client writes to those tables are
  not granted → audit **cannot be bypassed**. Captures actor, before/after, reason, timestamp, event.
- **Immutability:** no UPDATE/DELETE policy on `audit_log` (and `EXECUTE`-only insert path); revoke
  update/delete from all roles.
- **Verification history / traceability:** each contribution & booking retains its payment fields + decision
  (`verified_by`, `verified_at`, `decision_reason`, `overridden`), and every transition is in `audit_log` —
  so "who verified/rejected/overrode this payment, when, and why" is always answerable. **Every rupee in
  (verified collections) and out (confirmed handovers) is reconstructable.**
- **Retention:** keep indefinitely (volume is tiny); **event-year scoped**; archived events read-only. No
  partitioning needed at this scale; `pg_dump` backups (per architecture) provide DR. If ever large, partition
  `audit_log` by `event_id`.

---

## 8. Security Review (Deliverable 8)

- **Default-deny RLS on every table**; no table relies on application-layer authz alone.
- **SECURITY DEFINER hardening:** each function re-validates caller `role`/`tower` internally (callable ≠
  authorized), pins `search_path`, and grants `EXECUTE` only to `authenticated`. This is the main escalation
  surface — reviewed per function.
- **JWT trust:** authz claims live in `app_metadata` (admin-set, not user-writable); `user_metadata` is never
  used for authorization. Tower/role changes **re-sync the claim**; stale claims expire with the session.
- **No direct financial writes:** contributions/bookings/qr/redemptions/handovers mutate **only via
  functions**, guaranteeing both invariant enforcement and audit capture.
- **Column-level gap:** RLS is row-level, so a trigger guards residents from changing their own
  `role/tower/flat` (those go through `approve_correction`/`grant_role`).
- **QR integrity:** unguessable `nonce` (high entropy) blocks forgery-by-guessing; `redeem_qr` row-locks the
  pass so concurrent scans can't exceed `allowed_scans`; **online-first removes the offline cross-device
  gap entirely** (DB is the single source of truth). Printed list is the manual fallback only.
- **Payment integrity:** `amount_paid ≥ required` enforced at verify; pay-own-tower enforced at create/submit;
  reps can't alter resident-submitted values (separate columns, function-mediated).
- **Rep self-dealing** (rep verifying own-tower payments, possibly their own): not DB-preventable by design —
  mitigated by **immutable audit + admin override + collected-vs-confirmed-handover reconciliation** (accepted
  trade-off from the approved model).
- **Storage:** screenshot bucket uses path-scoped Storage policies mirroring table RLS (owner + that tower's
  rep + admin can read).
- **Deletion disabled** across the schema protects financial history; recovery via status + audit + backups.
- **Policy recursion** avoided via JWT-claim helpers rather than `profiles` self-queries.

---

*End of Phases 15–19. No SQL, migrations, or frontend produced. Awaiting approval before generating the
schema/migrations.*
