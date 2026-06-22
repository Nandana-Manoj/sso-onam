# Onam Management — Final Revised Business Model & Remaining Decisions

> Approved conceptual model + simplifications, the five locked decisions, and the three remaining strategy
> recommendations (Auth, Notifications, Event-Day QR). This is the **input to Technical Architecture &
> Technology Selection**. No APIs, infrastructure, or stack choices here.
> Builds on `docs/data-and-security-model.md` and the consolidated plan-file design.

---

## 1. Final Revised Business Model

### Scope (v1)
Volunteer-run, one residential society, ~500–1000 residents across multiple towers, one Onam event per
**event year** (multi-year history retained). Roles: **Admin, Tower Representative, Resident** (Sponsorship
**deferred**).

### Locked rules
- **Contributions** — **per flat/family, once per event year**; a flat satisfies the configurable **minimum
  exactly once**; **all residents of the flat see its status**. Additional voluntary top-ups are **out of
  scope for v1** (designed-around, not built).
- **Payments** — made **directly to the resident's own Tower Rep**; the **Tower Rep is the verification
  authority**. **UTR is OPTIONAL**; a payment may be verified by **UTR, screenshot, or the Rep's direct
  confirmation from their own payment history**. **Admin = override + audit authority.**
- **Registration** — residents **self-register** (Name, Mobile, Tower, Flat); **Mobile = primary identity**.
  **Tower/Flat corrections**: resident requests → **Tower Rep approves within their own tower** → **Admin
  final override**.
- **Sadya** — **#Adults and #Children<5 entered explicitly**; **children<5 consume a scan even when free**;
  **QR entitlement N = Adults + Children<5**. Pricing (adult price, child price/free) configured by Admin and
  **snapshotted** on the booking.
- **Sponsorship** — **deferred** from v1.

### Simplified entity set (approved)
`User` (role + optional tower) · `Tower` (holds current rep + contact + payment QR) · `Flat` ((Tower,FlatNo),
family grouping) · `Event` (+ config: minimum, sadya prices, **booking-freeze date**; `is_active`) ·
`Contribution` (per flat/event, embeds its payment fields) · `SadyaBooking` (per person, embeds payment
fields) · `QRPass` · `Redemption` · `FundHandover` · `AuditLog` (append-only). `RefundRequest` kept as a
**placeholder** for overpay/cancel. **Dropped from the earlier model:** Account/RoleBinding engine,
EventYear state machine, TowerPaymentProfile, polymorphic Payment-with-attempts, signed-QR key management,
station partitioning/peer-sync, ProfileChangeRequest entity, handover DISPUTED state.

### Kept invariants (load-bearing)
Price snapshot on records · once-per-flat contribution uniqueness · mobile-unique identity · a flat number
belongs to exactly one tower · append-only money history · **rep-receives-money-so-rep-verifies** ·
refund-placeholder.

### Workflow deltas from the simplification review (now adopted)
- **UTR optional**; Rep verifies against own UPI history with a one-tap approve (+ batch approve).
- **Tower Rep approves own-tower Tower/Flat corrections**; Admin overrides.
- **Verification cutoff** before the event + **gate manual-admit-and-reconcile** override (so a late-verified
  resident is never turned away).
- **Redeem-whole-party in one action** at the gate (not N separate taps).
- **Rep roster confirmation** before a self-asserted flat's shared-contribution visibility is fully trusted
  (mitigates the typo'd-flat correctness hole).

---

## 2. Authentication Recommendation

| Option | Cost | UX | Volunteer support burden | Implementation | Society fit |
|---|---|---|---|---|---|
| Mobile + Password | Free | Password fatigue; forgotten between yearly uses | **High** — password resets (which still need a channel) | Moderate (hashing + reset that itself needs OTP/email) | Weak — seasonal use, elderly users |
| **Mobile OTP** | **Low** (SMS per code; India DLT setup) | **Excellent** — passwordless, matches mobile-as-identity | **Low** — no resets; only "didn't get code" | Moderate (OTP issue + rate-limit + provider) | **Strong** |
| Email OTP | ~Free | Requires email many residents lack; identity is mobile, not email | Moderate (typos/spam, "no email") | Low–moderate | Weak — contradicts mobile-identity, excludes non-email residents |

**Recommendation: Mobile OTP (passwordless).** It is the only option that aligns with **mobile-as-primary-
identity**, needs nothing for users to remember (ideal for a once-a-year app and elderly residents), and has
the **lowest support burden** (no password resets). It also doubles as the proof-of-control that lets
proxy-created accounts be **claimed**.

**Cost mitigation (important):** keep **long-lived "trusted device" sessions** so OTP is needed only at
**registration and new-device login** — not every visit. That holds SMS to roughly **one message per resident
per season** (~₹100–300 total for 1000 users), making Mobile OTP both the best-UX *and* a low-cost choice.
*(Operational note for the architecture phase: India transactional SMS requires DLT/sender-ID registration —
a one-time setup, not a per-event cost. A WhatsApp channel is a viable cheaper/higher-deliverability
alternative to evaluate then.)*

---

## 3. Notification Recommendation

**Events and the right channel** (principle: in-app is the source of truth; spend an out-of-band message
only where silence breaks the flow; lean on reps' existing tower WhatsApp groups for the rest):

| Event | In-app | Out-of-band (mobile) | Manual / rep-driven |
|---|---|---|---|
| Payment **verified** (QR ready) | ✅ | ✅ (action-relevant) | — |
| Payment **rejected / needs info** | ✅ | ✅ (must resubmit — the critical one) | — |
| Sadya booking / contribution confirmed | ✅ | — | — |
| Tower/Flat correction approved/rejected | ✅ | — | — |
| (Rep) new payment awaiting verification | ✅ (rep dashboard badge) | optional | — |
| Payment-pending reminders, event-day reminders, announcements | ✅ | — | ✅ **rep's tower WhatsApp group** |

**Recommendation for v1:**
- **In-app notifications/status for everything** (zero cost; the dashboard already reflects state).
- **One out-of-band mobile message** (reuse the OTP channel — SMS or WhatsApp) for **exactly two
  transactional triggers**: *payment verified (QR ready)* and *payment rejected (resubmit)*. These are where a
  resident who doesn't reopen the app would otherwise be stuck.
- **Reminders/announcements stay manual** via reps' existing per-tower WhatsApp groups — no blast
  infrastructure to build, and it uses the volunteer relationship that already exists.
- **Email: skip for v1** (identity isn't email; poor reach).

This keeps automated messaging to ~2 triggers and consolidates on a single provider with OTP.

---

## 4. Event-Day QR Recommendation

| Option | Build/operate complexity | Connectivity dependence | Multi-device consistency | Last-minute bookings | Volunteer skill |
|---|---|---|---|---|---|
| **Online validation** | **Lowest** | Needs data at the gate | **Automatic** (single source of truth) | **Instant** | **Lowest** — just scan |
| Offline pre-synced | Higher (sync, local ledger, reconciliation) | None | Manual/eventual; cross-device gap | **Missed if synced before they booked** | Higher |

**Recommendation: Online-first validation (with a guaranteed gate connection + printed fallback).** This
reverses my earlier offline-leaning stance, on purpose — under the "simplest operationally safe" lens the
offline machinery is exactly the over-engineering flagged in review, and it introduces the worst event-day
failure (a late-verified resident's valid pass missing from a stale scanner).

Make it safe cheaply:
1. **Online validation** is authoritative, trivially multi-device consistent, and handles same-day bookings.
2. **Guarantee connectivity at the gate** with a dedicated **mobile-data phone / small hotspot** for the
   scanner(s) — far cheaper and simpler than building robust offline sync. One 4G phone at the gate is enough.
3. **Printed per-tower master list** (flat, name, allowed count), auto-generated at the **verification cutoff**,
   as the manual fallback if data drops mid-event.
4. **Redeem-whole-party in one action**, and bind each scan to event + booking + remaining count so a pass
   can't exceed N or be reused.

Net: online-first is the **simplest to build, simplest for volunteers, lowest cost, and the safest** given you
can almost always put one phone online at the gate — with paper as the no-regret backup.

---

## 5. Remaining Risks

| # | Risk | Mitigation / status |
|---|---|---|
| R1 | **Verification crush** in the final days (reps with day jobs) | Verification cutoff + early push; UTR-optional one-tap approve; Admin can help verify (override authority) |
| R2 | **Gate connectivity loss** despite hotspot | Printed master list fallback + passive last-synced cache; manual-admit-and-reconcile |
| R3 | **Self-asserted flat typos** leaking/blocking contribution status | Rep roster confirmation before trusting flat-sharing; normalization + anomaly flags |
| R4 | **SMS deliverability / DLT setup** (India) | One-time DLT/sender-ID setup; evaluate WhatsApp alt in architecture phase; long sessions cut volume |
| R5 | **Rep self-dealing / fake approvals** | Admin audit + override + verified-collected-vs-confirmed-handover reconciliation |
| R6 | **Overpayment / cancellation** (no refund logic in v1) | RefundRequest placeholder; manual offline by Admin |
| R7 | **Wrong-tower registration → misdirected payment** | Correction flow (Rep approves) + Admin override; inter-rep settlement handled manually |
| R8 | **Event-day throughput** (~500–1000 in a dinner window) | Party-redeem in one action; 1–3 online scanners; clear signage |
| R9 | **Deferred scope drift** (refund, sponsorship, voluntary top-ups) | Explicitly out of v1; placeholders keep data; designed-around |

No open risk is a blocker for proceeding to architecture; R2 and R4 carry operational (not design) follow-ups.

---

## 6. Final Readiness Assessment

**Status: READY to proceed to Technical Architecture & Technology Selection.**

- ✅ Business rules finalized (contributions, payments, registration, sadya, sponsorship-deferred).
- ✅ Roles & permissions (RBAC v2) finalized; Rep = verifier/own-tower corrections, Admin = override/audit.
- ✅ Conceptual data model finalized and **simplified** (~10 entities, no crypto key management).
- ✅ Audit, security, and data-quality models defined.
- ✅ Three remaining strategy decisions recommended: **Mobile OTP**, **in-app + 2 transactional mobile
  notifications (reps' WhatsApp for the rest)**, **online-first QR with hotspot + printed fallback**.
- ⏭️ **Carry-forward for architecture/tech phase (not blockers):** OTP/notification channel & provider
  (SMS vs WhatsApp, India DLT); venue-connectivity confirmation; whether to build voluntary top-ups,
  refund, and sponsorship as later modules; multi-year archival approach.

*Awaiting your go-ahead to begin Technical Architecture & Technology Selection.*
