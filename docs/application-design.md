# Onam Management — Application Layer Design

> Web-first (shared URL, no install; PWA optional). Builds on the approved data model, RLS policies, and
> SECURITY DEFINER functions. **No code, no SQL, no migrations.**
> Three roles: **Resident, Tower Representative, Admin** (Sponsorship deferred).

---

## 1. Application Overview

A single responsive web app with a **role-aware shell**: after login the user is routed to the Resident,
Rep, or Admin experience based on their `role` claim. The app is **read-mostly via RLS-scoped queries** and
**writes via RPC functions** (the transactional functions already designed), with a few **Edge Functions**
for privileged Auth/admin operations. Screenshots use Supabase Storage directly (policy-scoped). The QR is
**rendered client-side** from `qr_pass.id + nonce` — never stored.

**Global UX rules:** every screen resolves an **active event** first (no active event ⇒ a friendly "nothing
open yet" state); all money/state changes show **optimistic status + server confirmation**; all destructive
or money actions confirm; errors are surfaced inline with a retry; deep links (e.g. a rep-shared
`/contribute` or `/sadya` link from WhatsApp) land on the right screen behind auth.

---

## 2. Resident Experience

**Pages:** Landing/Login · Register · Forgot-password (assisted) · Home · Contribute · Sadya (list + new) ·
Payment-submit (shared) · QR pass · Profile/Corrections.

**Navigation:** simple bottom nav — **Home · Contribute · Sadya · Profile** (+ logout/notifications in header).

### Journeys

**Register** → enter Name, Mobile, **Tower (select)**, **Flat number**, Password → account created
(`resident`, `claimed=true`) → Home. *Edge:* mobile already registered → "This number already has an account
— log in or ask your Tower Rep." *Proxy account first login:* forced password change (`claimed→true`).

**Login** → Mobile + Password → Home. **Forgot password** → screen: "Ask your Tower Rep or Admin to reset it"
(no SMS) + their contact. *(Self-service OTP reset arrives with the OTP enhancement.)*

**Home dashboard** → active-event banner; **my flat's contribution status** (Not started / In progress /
Verified — with who initiated); **my sadya bookings** with status + QR access; quick actions. *Empty:* "Your
flat hasn't contributed yet" + Contribute CTA. *Rejected payment:* red banner "Payment rejected: <reason> —
Resubmit."

**Contribution flow** →
1. Open Contribute. If flat already has a live/verified contribution → **read-only status** ("Flat 4051 has
   contributed ₹2000 — verified", or "in progress, initiated by <name>"). Else continue.
2. Enter amount (**must be ≥ minimum**; sub-min blocked inline) → Continue.
3. **Pay screen:** shows **your Tower Rep's name, contact, and payment QR**; instruction to pay directly.
4. "I've paid" → **Payment-submit**: amount paid, **UTR (optional)**, **screenshot (optional)** → status
   `submitted` → "Awaiting your Tower Rep's confirmation."
*Edges:* concurrent flatmate started one → "Your flat already has a contribution in progress" (race caught by
DB); no active event → blocked.

**Sadya booking flow** →
1. New booking: enter **#Adults** and **#Children below 5** → live total from active config (child may show
   ₹0 but "counts for entry") → Continue.
2. Pay screen (rep QR) → Payment-submit (same component) → `submitted`.
3. Bookings list shows each booking's status; **verified ⇒ QR available**.
*Edges:* after `booking_freeze_at` → "Sadya bookings are closed"; total_persons must be ≥ 1.

**Payment submission (shared):** amount paid (default = required), optional UTR, optional screenshot upload
(client-compressed). *Errors:* upload too large (auto-compress), network retry.

**QR viewing:** for a verified booking — rendered QR + "**N entries (A adults + C children), remaining: R**" +
holder/flat. Re-openable, screenshot-friendly. *Edge:* fully redeemed → "All entries used"; voided → "This
pass was cancelled — contact your rep."

**Profile / corrections:** view name, mobile, tower, flat; **request Tower/Flat correction** → `pending`
(rep/admin approval); change password. *Edge:* a correction already pending → "You have a pending correction."

---

## 3. Tower Representative Experience

**Pages:** Dashboard · Verification Queue · Residents (roster + add) · Collections · Fund Handovers · Scan
(event day) · Audit (own tower).
**Navigation:** tabs — **Dashboard · Verify · Residents · Collections · Handovers · Scan**.

- **Dashboard (own tower):** verified contributions total, **flats participated vs total**, sadya persons
  booked, **pending-verification badge**, **balance held** (verified collected − confirmed handovers),
  event-day redemption progress. *Empty:* "No activity yet."
- **Verification queue:** list of `submitted` payments (contributions + bookings) **for this tower** — payer,
  payable, amount paid, optional UTR/screenshot → **Approve** / **Reject (reason)**. Approve on a booking
  **issues the QR**; reject on a contribution **reopens the flat**. *Empty:* "Nothing awaiting verification."
  *Edge:* `amount_paid < required` → highlighted "underpaid" → reject or request more.
- **Residents:** roster of own-tower residents (search); **Add resident (proxy)** (Name, Mobile, Flat, temp
  password); resident detail; **approve intra-tower Flat/Tower corrections** (cross-tower → "Needs Admin").
  *Edge:* proxy add with existing mobile → error.
- **Collections:** per-flat status + totals; export own-tower sheet.
- **Fund handovers:** **log a handover** (amount, date, received-by, reference/note); list with status +
  running balance. *Edge:* logging more than balance held → warning.
- **Scan (event day):** camera scan → `redeem_qr` → **Accepted (remaining R) — Name/Flat** or rejection
  (exhausted/void/invalid); **"admit whole party"** option (count). *Offline/no-data:* fall back to the
  **printed per-tower master list**. *Edge:* wrong-tower pass → rejected.
- **Audit:** own-tower activity feed (read-only).

---

## 4. Admin Experience

**Pages:** Dashboard · Events & Config · Towers · Reps/Users · Reports/Exports · Overrides · Audit.
**Navigation:** sidebar — **Dashboard · Events · Towers · Users · Reports · Overrides · Audit**.

- **Dashboard (global):** totals (contributions, sadya persons, collected vs vendor-payable vs contribution
  margin), **verification queue depth (all towers)**, **reconciliation indicator**, coupons issued vs
  redeemed (+ free children), donating-families count, **per-tower balances**, **live redemption counter**,
  leaderboard, YoY comparison.
- **Events & config:** create/edit event; set **min contribution, adult/child sadya prices, booking-freeze,
  verification-cutoff**; **activate** an event (single active). *Edge:* config change warns "applies only to
  new records (existing keep their snapshot)."
- **Towers:** CRUD towers; **assign rep**; set **tower payment QR + contact**.
- **Reps/Users:** search users; **grant/revoke roles**; **assisted password reset**; deactivate/merge
  duplicate accounts; approve **cross-tower** corrections.
- **Reports/Exports:** full ledger, **vendor headcount sheet**, per-tower reports, reconciliation report, YoY;
  **generate printed master list** at the verification cutoff.
- **Overrides:** override any payment decision (`overridden`), void QR, confirm/reject handovers, manual
  **refund (placeholder)**. All audited.
- **Audit:** full searchable/filterable log.

---

## 5. Navigation Map

```
/                       → if unauth: Login ; else role home
/login  /register  /forgot
─ Resident ────────────────────────────
  /home  /contribute  /sadya  /sadya/new  /pay/:payableType/:id  /qr/:bookingId  /profile
─ Tower Rep ────────────────────────────
  /rep  /rep/verify  /rep/residents  /rep/residents/new  /rep/collections
  /rep/handovers  /rep/scan  /rep/audit
─ Admin ────────────────────────────────
  /admin  /admin/events  /admin/towers  /admin/users  /admin/reports
  /admin/overrides  /admin/audit
Shared: header(notifications, logout) ; deep links /contribute /sadya land post-auth
```

Role guard on every route (server-truth via RLS/RPC; client routing is convenience only).

---

## 6. API / RPC Contracts

### 6.1 Reads — **direct table/view access via RLS** (Supabase client `select`)
| Query | Purpose | Inputs | Returns | Who (RLS) |
|---|---|---|---|---|
| towers list | registration tower dropdown + rep QR/contact | — | towers | all auth |
| active event | config/prices/cutoffs | — | event | all auth |
| my flat contribution | Home status (flat-shared) | — | contribution(s) for my flat | resident (flat) |
| my bookings | Sadya list | — | my sadya_bookings | resident (own) |
| my qr pass | QR screen | booking_id | qr_pass (own) | resident (own) |
| rep verification queue | Verify tab | — | submitted contributions+bookings, my tower | rep (tower) |
| rep residents / collections / handovers / balance | rep tabs | — | tower-scoped rows/views | rep (tower) |
| admin dashboards / reports / audit | admin views | filters | aggregate views | admin |
| audit feed | Audit | filters | audit_log (scoped) | rep(tower)/admin |

### 6.2 Writes — **RPC (SECURITY DEFINER functions)**
| RPC | Purpose | Inputs | Outputs | Permissions |
|---|---|---|---|---|
| `create_contribution` | start flat contribution | flat_id, amount | contribution_id | resident(flat)/rep(tower)/admin |
| `create_sadya_booking` | start booking | num_adults, num_children | booking_id, total | resident/rep(tower)/admin |
| `submit_payment` | attach payment proof | payable_type, payable_id, amount_paid, utr?, screenshot_path? | status | owning resident |
| `verify_payment` | approve/reject; issues QR on booking-approve | payable_type, payable_id, decision, reason? | new status (+ qr_pass_id) | rep(paid_to tower)/admin |
| `redeem_qr` | scan/redeem | nonce, count=1, device? | accepted, remaining, name, flat | rep(tower)/admin |
| `request_correction` | resident asks Tower/Flat fix | requested_tower_id?, requested_flat_number? | request_id | resident(own) |
| `approve_correction` | decide correction | request_id, decision | status | rep(intra-tower)/admin(any) |
| `log_fund_handover` | record handover | tower_id, amount, date, received_by?, ref?, note? | handover_id | rep(tower) |
| `confirm_fund_handover` | confirm receipt | handover_id | status | admin |
| `void_qr_pass` | cancel pass | booking_id, reason | status | admin/rep(tower) |
| `set_active_event` / `update_event_config` | event config | event fields | event | admin |
| `grant_role` | role/tower assignment | user_id, role, tower_id? | profile | admin |

### 6.3 **Edge Functions** (service role / Auth admin / external)
| Edge Fn | Purpose | Inputs | Outputs | Permissions |
|---|---|---|---|---|
| `create_proxy_resident` | create auth user + profile for a non-digital resident | name, mobile, flat_number, temp_password | user_id | rep(own tower)/admin |
| `reset_password` | assisted recovery (rep own-tower / admin) | user_id (+ new temp) | ok | rep(tower)/admin |
| `generate_printed_list` *(optional)* | signed export at cutoff | event_id, tower_id? | file/url | admin/rep(tower) |
| `send_notification` *(later)* | transactional message | recipient, template | ok | system |

**Storage (direct, policy-scoped):** screenshot upload/download via Supabase Storage client; QR images are
not stored (client-rendered).

---

## 7. Supabase Interaction Model

**Decision rule:**
- **Direct table/view via RLS** → *reads, and trivially-scoped data with no multi-step invariant.* Justify:
  RLS already guarantees visibility; PostgREST gives it for free → least code, fastest, fewer moving parts.
- **RPC (Postgres function)** → *any write that needs atomicity, a state-transition/business invariant, an
  audit entry, or controlled RLS bypass.* Justify: one transactional boundary guarantees the invariant +
  audit together (e.g. `verify_payment` must flip status **and** mint the QR **and** log audit atomically;
  `redeem_qr` must row-lock to stay ≤ N). Raw client writes couldn't enforce these safely.
- **Edge Function** → *anything needing the service role, the Auth admin API, or an external provider.*
  Justify: creating/resetting another user's auth credentials and sending messages must never expose the
  service key to the browser; these live server-side only.

| Operation class | Mechanism | Why |
|---|---|---|
| Dashboards, lists, own/flat/tower reads | Direct (RLS) | scoping handled by RLS; no invariant |
| Create/submit/verify/redeem/correction/handover/config | RPC | atomic + invariant + audit |
| Screenshot upload/view | Storage (policies) | native; mirrors RLS |
| Proxy account, password reset, messaging | Edge Fn | service-role / Auth admin / external |

---

## 8. Development Roadmap (risk-ordered, MVP-early)

Ordering principle: build the **foundation** once, then the **highest-value + highest-risk money loop**
first to validate the decentralized-payment/RLS/RPC patterns early, then the **event-day-critical** QR path
with buffer before the event, then admin/ops (Admin can use the Supabase dashboard as an interim crutch),
then enhancements.

- **Phase 0 — Foundation (enabler).** Schema + constraints + RLS + the core RPC functions; Auth
  (Mobile+Password) + role claims; app shell + role routing; Admin can create an **event, towers, reps**.
  *Exit:* a logged-in user lands on the right (empty) home. *De-risks:* the whole RLS/RPC/auth integration.
- **Phase 1 — Contribution MVP (ship first).** Resident register/login → `create_contribution` → pay screen
  (rep QR) → `submit_payment`; Rep **verification queue** → `verify_payment`; resident sees status; basic Rep
  dashboard totals. *Exit:* the spreadsheet's contribution + verification loop fully replaced — a deployable
  MVP. *De-risks:* the central business assumption (pay-rep, rep-verifies) end-to-end.
- **Phase 2 — Sadya + QR issuance.** Booking flow + pricing; reuse the Phase-1 payment/verify path; **QR pass
  generation + viewing** (no scanning yet). *Exit:* residents hold valid passes.
- **Phase 3 — Event-day scanning (time-critical).** Rep/Admin **Scan** mode → `redeem_qr`, redemption
  tracking, live counter, **verification cutoff**, **printed master-list** export + gate fallback. *Schedule
  with buffer and a dry run before the event.* *De-risks:* the only hard event-day path.
- **Phase 4 — Admin & operations.** Full admin dashboard + **reports/exports** (vendor headcount,
  reconciliation, YoY), **fund handovers** (log/confirm), **overrides**, audit views, **proxy registration +
  assisted password reset** (Edge Functions), corrections approval UI.
- **Phase 5 — Enhancements (post-MVP).** Automated notifications + **Mobile OTP** (once DLT/WhatsApp ready),
  **PWA install**, refund/voluntary-top-ups/sponsorship modules, multi-year archival UX.

**Critical path to event day:** Phase 0 → 1 → 2 → 3. Phases 4–5 can trail (with Supabase-dashboard interim
for admin tasks) without blocking the event. Each phase is independently shippable.

---

*End of application design. No code, SQL, or migrations produced. Ready to proceed to schema/migrations or
Phase 0 build on your approval.*
