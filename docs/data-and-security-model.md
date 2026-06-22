# Onam Management — Data Model & Security Model (Phases 10–14)

> Conceptual/logical design only. **No APIs, no infrastructure, no technology choices, no code.**
> Source of truth: the consolidated functional design in
> `~/.claude/plans/you-are-acting-as-validated-eclipse.md` (Discovery, Functional Design, Corrections v2,
> resolutions C5–C8). This document covers the domain model, data model, audit/history, security, and
> data-quality strategy.

Cross-cutting principle from the corrections: **simplicity, reliability, low overhead, low cost** — model
only what the workflows need, scope everything to an **event year**, and **never hard-delete** financial or
identity records (use status + state transitions + append-only history).

---

## 1. Domain Model (Phase 10)

### 1.1 Core entities (Purpose · Lifecycle · Relationships · Ownership)

**EventYear** — the annual Onam edition; the scoping context for all transactional data and configuration.
- *Lifecycle:* `DRAFT → ACTIVE → FROZEN` (bookings closed for vendor headcount) `→ CLOSED/ARCHIVED` (read-only).
- *Relationships:* holds one EventConfig; scopes Contributions, SadyaBookings, Payments, QRPasses, Redemptions, FundHandovers, TowerPaymentProfiles, RoleBindings.
- *Ownership:* Admin. **Exactly one ACTIVE event year at a time.**

**EventConfig** — the per-year configurable rules (snapshotted onto records).
- *Holds:* per-flat minimum contribution; adult sadya price; child(<5) price **or** free flag; booking-freeze date; currency (INR).
- *Lifecycle:* editable while event is DRAFT/ACTIVE; changes are audited and **do not retro-mutate existing records** (records keep their snapshot).
- *Ownership:* Admin.

**Tower** — organizational/master unit grouping flats and residents.
- *Lifecycle:* created once by Admin; persists across years (master data). Rep assignment and payment QR are **per event year**.
- *Relationships:* 1 Tower — N Flats; 1 Tower — N Residents (via flats); 1 Tower — 1 active TowerPaymentProfile per event year.
- *Ownership:* Admin.

**TowerPaymentProfile** — "who is the rep for this tower this year, and how do residents pay them."
- *Holds:* tower, event_year, the Rep account, display name, contact info, payment QR image/handle.
- *Lifecycle:* set/changed by Admin; rep can change mid-event (turnover) with continuity of in-flight payments.
- *Ownership:* Admin manages; consumed (read-only) by residents of that tower.

**Flat** — a residence within a tower; the **contribution-bearing unit** and the family grouping.
- *Identity:* (Tower, FlatNumber). Created on first self-assertion or by Admin/Rep; persists as master data.
- *Lifecycle:* effectively permanent master data; may be merged/normalized for data quality.
- *Relationships:* belongs to one Tower; 1 Flat — N Residents; 1 Flat — (0..1) Contribution **per event year**.
- *Ownership:* shared by its resident members; administered by Tower Rep/Admin.

**Resident** — a person's self-service account.
- *Identity:* **Mobile number (globally unique)**. Attributes: Name, Mobile, Tower, Flat, created_by (self or proxy Rep), claimed flag, status.
- *Lifecycle:* `REGISTERED (active)` → optional `EDIT_PENDING` (tower/flat change awaiting Admin) → active; `UNCLAIMED` (proxy-created, not yet verified by the person) → `CLAIMED`; may be `DEACTIVATED/MERGED` (dedup).
- *Relationships:* belongs to exactly one Flat at a time; initiates the flat's Contribution; 1 Resident — N SadyaBookings; submits N Payments.
- *Ownership:* the person (self); proxy-created accounts owned by the person but created_by a Rep; Admin over all.

**Account & RoleBinding** — the auth + RBAC backbone (Residents are accounts too).
- *Account:* auth identity (keyed to mobile). *RoleBinding:* (account, role ∈ {Admin, TowerRep, Resident, SponsorshipTeam}, optional Tower scope for TowerRep, event_year for time-bound roles).
- *Lifecycle:* role bindings granted/revoked by Admin (except self-service Resident registration); rep bindings are per event year.
- *Ownership:* Admin manages privileged bindings; the system creates the Resident binding on registration.

**Contribution** — the family's donation, **once per flat per event year**.
- *Holds:* flat, event_year, amount (≥ snapshotted minimum), initiated_by (resident), status, min_snapshot.
- *Lifecycle:* `PAYMENT_PENDING → SUBMITTED → VERIFIED`; or `REJECTED / EXPIRED` (which **reopens** the flat).
  While in a non-terminal/VERIFIED state the flat is **locked** against a second contribution.
- *Relationships:* 1 Contribution — (0..1) active Payment, 1 — N Payment attempts (history).
- *Ownership:* the **Flat** (any member may act on it); verified by Tower Rep; overridable by Admin.

**SadyaBooking** — a meal booking, **per person, per booking** (a resident may make several).
- *Holds:* resident, flat, event_year, num_adults, num_children_u5, N (= adults + children), price snapshots (adult/child/free flag), total_amount, status.
- *Lifecycle:* `PAYMENT_PENDING → SUBMITTED → VERIFIED (issues QRPass) → CONFIRMED → PARTIALLY_REDEEMED → FULLY_REDEEMED`; or `REJECTED / EXPIRED / CANCELLED (voids QRPass)`.
- *Relationships:* 1 — (0..1) active Payment, 1 — N Payment attempts; 1 — (0..1) QRPass.
- *Ownership:* the booking **Resident**.

**Payment** — a submitted claim of a direct payment to a Tower Rep, for a Contribution or a SadyaBooking.
- *Holds:* payable reference (contribution **or** booking) + payable_type, payer resident, tower, rep account, amount_paid, UTR, optional screenshot ref, status, decided_by, decision_reason, timestamps.
- *Lifecycle:* `SUBMITTED → VERIFIED | REJECTED`, plus `OVERRIDDEN` (Admin). Attempts are retained; a payable may have several attempts over time.
- *Ownership:* payer **Resident** submits; **Tower Rep** of that tower verifies; **Admin** overrides/audits.

**QRPass** — the redeemable sadya pass issued on a VERIFIED booking.
- *Holds:* booking, event_year, allowed_scans (N), signed token payload + signature, nonce, status, remaining (derived = N − accepted redemptions).
- *Lifecycle:* `ISSUED → PARTIALLY_REDEEMED → FULLY_REDEEMED`; `VOID` on cancel/reversal.
- *Relationships:* 1 QRPass — N Redemptions; 1 — 1 SadyaBooking.
- *Ownership:* the holder **Resident**; validated by scan stations; auditable by Admin.

**Redemption** — a single scan event (the meal-gate tap).
- *Holds:* qr_pass, sequence_no, scanned_at, scanned_by (operator/rep), station/device id, online/offline flag, sync_status, result (accepted / rejected-exhausted / rejected-invalid / rejected-void).
- *Lifecycle:* created on scan, **immutable**; reconciled when synced.
- *Ownership:* event-day scan operations; audited by Admin.

**FundHandover** — record of a Tower Rep handing collected money to the committee (mirrors the workbook's
"Donation Engagement" transfer log).
- *Holds:* tower, event_year, rep account, amount, date, received_by, reference/note, status.
- *Lifecycle:* `LOGGED (by Rep) → CONFIRMED (by Admin)`; or `DISPUTED`.
- *Relationships:* Tower + EventYear — N FundHandovers; **balance held = verified collected − confirmed handovers**.
- *Ownership:* Tower Rep logs; Admin confirms/audits.

**ProfileChangeRequest (EditRequest)** — a resident's request to change identity-critical fields.
- *Holds:* resident, requested change (old→new Tower/Flat), status, requested_by, decided_by, reason, timestamps.
- *Lifecycle:* `PENDING → APPROVED (applies change) | REJECTED`.
- *Ownership:* Resident requests; **Admin** approves.

**AuditLog** — append-only system journal of every sensitive action (cross-cutting, see §5).

**ScanStation/Device** *(light)* — a registered scanner that pre-syncs confirmed bookings and holds a local
redemption ledger for offline operation; partitioned by tower or used as a single station; reconciles on
reconnect.

**Deferred placeholders (modeled as stubs only, not detailed):**
- **RefundRequest** — captures overpayment/cancellation so data isn't lost; status `PENDING` only; logic later.
- **Sponsor / Pledge / Expense / BudgetLine** — Sponsorship Team domain; scope deferred (role exists, no detail).

### 1.2 Aggregates & boundaries

- **EventYear** = the partition/scoping context for all transactional data (not a transactional root, but every record carries event_year).
- **Flat aggregate** = Flat + its Residents + its (≤1) Contribution-per-year. **Consistency boundary for "one contribution per flat per year."**
- **SadyaBooking aggregate** = Booking + QRPass + Redemptions. **Invariant boundary for "≤ N scans"** (strong online; eventual/reconciled offline).
- **Payment** lives **within its payable's aggregate** — verifying a Payment transitions its Contribution/Booking atomically.
- **Tower custody aggregate** = Tower + FundHandovers (+ derived balance) per year.
- **Account aggregate** = Account + RoleBindings + ProfileChangeRequests.
- **AuditLog** = system-wide, append-only, outside all aggregates.

---

## 2. Entity Definitions & Relationship Model (Phase 11)

### 2.1 Relationship map (cardinalities)

```
Society (1) ──< Tower (N)
Tower (1) ──< Flat (N)
Flat (1) ──< Resident (N)                 [Resident belongs to exactly one Flat at a time]
EventYear (1) ── (1) EventConfig
Tower (1) ──< TowerPaymentProfile (N, one ACTIVE per EventYear)
Account (1) ──< RoleBinding (N)           [Resident/TowerRep/Admin/Sponsorship]
Flat (1) + EventYear (1) ── (0..1) Contribution
Contribution (1) ──< Payment (N attempts) ── (0..1) active
Resident (1) ──< SadyaBooking (N, per EventYear)
SadyaBooking (1) ──< Payment (N attempts) ── (0..1) active
SadyaBooking (1) ── (0..1) QRPass
QRPass (1) ──< Redemption (N)
Tower (1) + EventYear (1) ──< FundHandover (N)
Resident (1) ──< ProfileChangeRequest (N)
(every mutating action) ──< AuditLog (N)
```

### 2.2 Constraints, uniqueness & validation rules

**Resident / Account**
- Mobile number **globally unique**; format-validated (valid Indian mobile). Name non-empty.
- Belongs to exactly one (Tower, Flat); referenced Tower must exist; flat number normalized & valid for tower.
- Proxy-created residents start `UNCLAIMED`; become `CLAIMED` only after the person proves control of the mobile.

**Flat**
- Unique by **(Tower, FlatNumber)**. A flat number belongs to **exactly one tower** (prevents the workbook's cross-tower contamination, e.g. a T8 flat appearing under T10).
- Flat number stored in a **canonical normalized form** (the workbook had `1174.0`, `RH 17`, `RH1` — normalize on entry).

**Contribution**
- **At most one non-terminal Contribution per (Flat, EventYear)**; **at most one VERIFIED per (Flat, EventYear)**.
- `amount ≥ EventConfig.min_contribution` (snapshot at creation). Sub-minimum **blocked at entry**.
- May be initiated by **any** member of the flat; on `REJECTED/EXPIRED` the flat reopens.

**SadyaBooking**
- `num_adults ≥ 0`, `num_children_u5 ≥ 0`, **N = adults + children ≥ 1** (must book at least one person).
- `total_amount = adults × adult_price_snapshot + children × child_price_snapshot` (child price may be 0 per config).
- Creation blocked after `EventConfig.booking_freeze_date` (Admin override only; overrides don't alter an already-submitted vendor headcount).
- Multiple bookings per resident allowed.

**Payment**
- `amount_paid ≥ required` (contribution minimum / booking total). Underpayment → cannot VERIFY (NEEDS_INFO/reject); overpayment → recorded + flagged (→ RefundRequest placeholder).
- **UTR required & format-valid; UTR unique per (Tower, EventYear)** to block reuse; **cross-tower duplicate UTR is flagged** for Admin (catches a resident reusing one UTR on two payables).
- `tower == payer.tower` (residents pay **their own tower's** rep only).
- Verifier must be that tower's **Rep** or **Admin**. A Rep cannot edit the resident-submitted amount/UTR — only approve/reject with a reason.

**QRPass**
- `allowed_scans = booking.N`; **one QRPass per booking**; signed token + nonce **unique**; bound to event_year & booking_id.
- `remaining = N − accepted redemptions ≥ 0` (online-authoritative; offline reconciled).

**Redemption**
- Belongs to one QRPass; immutable; carries a sequence number and station id.
- Online: the (N+1)th accepted scan is rejected. Offline: enforced per-device; over-redemption across devices is **flagged on reconciliation**.

**FundHandover**
- `amount > 0`; tower's rep is the source; `confirmed transferred ≤ verified collected` expected (overage flagged, not silently allowed).

**ProfileChangeRequest**
- At most one `PENDING` request per resident; Tower/Flat changes require Admin approval before taking effect.

**EventYear / Config**
- Exactly one `ACTIVE`. Config changes audited; never retro-applied to existing snapshots.

**AuditLog**
- Append-only; never updated or deleted.

---

## 3. Audit & History Strategy (Phase 12)

**Audit requirements** — an **append-only, immutable** journal capturing actor, action, entity, before/after
(or transition), reason, timestamp, event_year for every sensitive action:
- Payment submit / verify / reject / **override** (who, when, **reason**).
- Contribution lock / reopen; SadyaBooking confirm / cancel.
- EventConfig changes (old → new values).
- QRPass issue / void; **Redemption** events (their own immutable stream).
- FundHandover log / confirm / dispute.
- Tower/Rep/Tower-QR management; RoleBinding grant/revoke; **proxy resident registration**.
- ProfileChangeRequest submit / approve / reject.

**Change tracking** — financial/identity records are **not mutated in place**; they progress through
**state transitions**, each recorded with actor + timestamp + reason. Mutable descriptive fields (e.g. config,
profile name) keep **before/after** snapshots.

**Approval tracking** — EditRequests, FundHandover confirmations, and payment overrides each record
requester, approver, decision, reason, and timestamps as first-class data (queryable, not just logs).

**Verification history** — each payable retains its **full Payment-attempt timeline** (including rejected
attempts) with verifier identity, decision, and reason — so "why was this verified/rejected and by whom" is
always answerable.

**History & retention** — everything is **event-year scoped**; archived years are **read-only**. No
hard-deletes of financial/identity data; dedup/merge is done via status + linkage, preserving history.
**Audit read access:** Admin (all); Tower Rep may see audit entries **scoped to their own tower** only.

---

## 4. Security Model (Phase 13)

### 4.1 Authentication requirements (conceptual; no technology named)
- **Identity = mobile number.** Registration must include a **proof-of-control of the mobile** (e.g. one-time
  code) because the mobile is the unique identifier — this also lets **proxy-created (UNCLAIMED) accounts be
  claimed** by the real person and prevents a Rep from silently impersonating residents.
- **Privileged accounts** (Admin, Tower Rep, Sponsorship Team) are **provisioned/role-granted by Admin**;
  no self-elevation. **No shared logins** — every actor is individually identifiable for audit.
- Authenticated sessions with least-privilege; role elevation only by Admin; sensitive actions
  (override, config, fund-handover confirm) tied to a real, logged actor.

### 4.2 Authorization model
- **RBAC with scope**: Admin (global), Tower Rep (scoped to **one tower**), Resident (scoped to **self + own
  flat's shared contribution**), Sponsorship Team (scoped to sponsorship domain; deferred).
- **Server-enforced object-level authorization on every access** — the actor's role binding + the target's
  tower/flat/owner decide access; **client-supplied scope is never trusted**.
- Money decisions (verify/reject) limited to the **owning tower's Rep**; override/audit limited to **Admin**.

### 4.3 Data visibility rules (consolidated)
| Viewer | Can see |
|---|---|
| Resident | Own profile, own bookings/QR/payments; **own flat's contribution** (read, shared with flat members); nothing about other residents |
| Tower Rep | **Own tower only**: residents (full detail), payments + proof, contributions, sadya bookings, collection & balance-held; **other towers → none/headline-only, no PII, no proof** |
| Admin | Everything, all towers, all audit, config |
| Sponsorship Team | Sponsorship domain only; **no resident PII** (deferred) |

- **Payment proof (UTR, screenshot, rep contact)** visible only to: the submitting resident, the receiving
  Tower Rep, and Admin.

### 4.4 QR fraud prevention
- **Signed QR token** `{event_year, booking_id, allowed_scans=N, nonce}` — signature makes the pass
  **unforgeable** and the scan-count **un-inflatable**. Key is **per event year and rotated**; **asymmetric
  signing preferred** so scanners can **verify offline** with a public key without holding the secret.
- **Scope binding**: reject tokens from a different event year or unknown booking.
- **N-limit enforcement**: online authoritative counter; offline **per-device local ledger**; over-redemption
  flagged on reconciliation.
- **Duplicate-redemption prevention**: each accepted scan recorded with sequence; beyond-N rejected.
- **Offline cross-device gap**: default to a **single station** or **stations partitioned by tower** (a pass is
  only valid at its tower's station) so one pass can't be split across stations; reconcile-and-flag after.
- **Sharing**: capped at N paid persons, so lending only spends one's own quota — acceptable; operator may
  see name/flat on scan to eyeball. **VOID** propagates to scanners where possible and is caught on reconcile.

### 4.5 Payment fraud prevention (decentralized, manual, simplicity-first)
- **The verifier receives the money** — the Tower Rep confirms each payment against **their own UPI/bank
  history**, so verification isn't based on a screenshot alone (screenshot is **secondary evidence** only).
- **UTR uniqueness/dedup** within a tower (and cross-tower flagging) blocks reuse of one payment for two payables.
- **Amount validation** enforces ≥ required; under/over-payment is caught and routed (NEEDS_INFO / flag).
- **Reps cannot alter** the resident-submitted amount/UTR; decisions are **logged with reason**.
- **Admin override + immutable audit + collected-vs-handover reconciliation** is the primary control against
  **Rep self-dealing** (a Rep verifying payments to their own account): shortfalls surface when verified
  collections don't match confirmed handovers. *Accepted trade-off:* the conflict of interest is mitigated by
  audit/reconciliation, **not** by system-enforced separation — chosen for operational simplicity.

---

## 5. Data Quality Strategy (Phase 14)

**Duplicate prevention**
- **Mobile unique** → no duplicate accounts per number.
- **Contribution once-per-flat** (uniqueness) → no double family contributions.
- **UTR dedup** → no reused payment proof.
- **One QRPass per booking.**
- **Flat keyed by (tower, flat#)** with normalization → prevents fragmented/variant flat records.

**Flat grouping validation**
- (Tower, Flat) must reference a valid tower; flat number must match the tower's expected pattern
  (configurable) and is normalized on entry.
- Residents asserting the same (tower, flat) are **grouped into one Flat** automatically.
- **Anomaly flags** for Tower-Rep review: a flat with implausibly many members; a flat number not matching the
  tower's pattern; a member whose asserted tower ≠ flat's tower.
- A flat number cannot belong to two towers (kills cross-tower contamination).

**Resident ownership rules**
- Each account owned by the person (mobile); **proxy accounts** owned by the resident but `created_by` a Rep
  and must be **claimed** via mobile proof before the person has self-service access.
- A flat's **contribution is jointly owned** by flat members — any member may initiate/resubmit; once VERIFIED
  it is **locked** and stays with the **flat** (not the individual) even if that person later moves out.
- **Sadya bookings are individually owned** by the booking resident.
- A resident belongs to exactly **one flat at a time**.

**Edit approval workflows**
- **Tower/Flat change** → `ProfileChangeRequest PENDING` → **Admin approve/reject** → on approve, re-scope the
  resident and re-evaluate flat grouping (must not orphan a flat's verified contribution).
- **Cosmetic fields** (e.g. name spelling) may be self-serve (configurable); **mobile change** is treated as
  sensitive **account recovery** (Admin + re-verification, later with auth).
- Every edit and decision is **audited**.

---

## 6. Risks & Edge Cases (Deliverable 8)

| # | Edge case / risk | Handling |
|---|---|---|
| E1 | Two flat members initiate a contribution simultaneously | "One active contribution per flat" uniqueness guard; the second sees the existing one (race resolved at the constraint) |
| E2 | Resident registers the **wrong tower/flat**, then pays the wrong Rep | Pay-own-tower routing uses their (possibly wrong) registered tower → misdirected payment; fix via EditRequest + **Admin override / inter-rep reconciliation**; flagged |
| E3 | **Proxy account never claimed** | Resident can't self-view QR; Rep holds/prints the pass; claim later via mobile proof |
| E4 | **UTR reused across towers** (different reps) | Per-tower uniqueness won't catch it alone → **global duplicate-UTR flag** to Admin |
| E5 | **Overpayment / cancellation** with refund logic deferred | Capture as **RefundRequest placeholder**; Admin handles manually offline; no data lost |
| E6 | **Offline double-redemption** across stations | Partition by tower / single station + post-event reconciliation flags overage; meals (not cash) → small residual tolerable |
| E7 | **QR screenshot shared** to a non-family freeloader | Capped at N paid persons; operator eyeball on name/flat; residual accepted |
| E8 | **Child-count inflation** for free meals | Children consume scans (true headcount); config can price children; operator eyeball; flag outliers |
| E9 | **Rep turnover / QR change mid-event** | Admin reassigns Rep + TowerPaymentProfile; in-flight payments stay attributed; handover balance continuity |
| E10 | **Booking after freeze date** | Blocked; Admin-only late changes don't alter the submitted vendor headcount |
| E11 | **Event-year rollover** | One ACTIVE year; archived years read-only; no cross-year leakage |
| E12 | **Shared family mobile number** | One account per number; sadya still bookable for multiple persons via adult/child counts; acceptable |
| E13 | **Duplicate-account merge** (same person, two numbers) | Admin merge tool preserving payments/bookings/history + audit |
| E14 | **Signing-key compromise** | Per-event rotation; **asymmetric** keeps the secret server-side (scanners verify only) — limits forgery exposure |
| E15 | **Rep self-dealing / fake approvals** | Admin audit + override + verified-collected-vs-confirmed-handover reconciliation surfaces shortfalls |
| E16 | **Self-asserted flat data mess at 500–1000 scale** | Normalization + pattern validation + Tower-Rep roster review + anomaly flags |

---

*End of Phases 10–14. No APIs, infrastructure, or technologies designed. Awaiting approval before the next
phase.*
