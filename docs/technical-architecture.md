# Onam Management — Technical Architecture & Technology Selection

> Builds on the approved business model, RBAC v2, simplified conceptual data model, and the three strategy
> decisions (Mobile OTP, in-app + 2 transactional notifications, online-first QR).
> Constraints: ~500–1000 residents · volunteer-run · near-zero budget · small team · fast delivery · no
> overengineering. **No code, no API design, no folder structures.**

---

## 1. Architecture Overview

A **standard responsive web application served from a shared URL** — residents **click a link (e.g. from
WhatsApp) and use it immediately in any mobile browser, with nothing to install**. The same app talks to a
**managed backend-as-a-service** (Postgres, auth, file storage, serverless functions), so the volunteer team
maintains **almost no infrastructure**. **PWA features (add-to-home-screen, offline shell) are an optional
progressive enhancement — never required for any core flow.**

```
[ Resident / Rep / Admin phones & laptops — any browser, opened via a shared link ]
                │  (HTTPS, JWT)
        ┌───────▼───────────────┐
        │  Web app (shared URL)  │  standard browser use; PWA install optional; free CDN
        │   (role-based UI)      │
        └───────┬───────────────┘
                │  authenticated calls
        ┌───────▼──────────────────────────────────┐
        │            Managed BaaS                    │
        │  • Postgres (relational model + constraints)│
        │  • Row-Level Security  → authorization      │
        │  • Auth (phone OTP, JWT sessions)           │
        │  • Storage (payment screenshots)            │
        │  • Edge/DB functions (verify, issue QR,     │
        │      atomic redemption ≤ N, handovers)      │
        └───────┬───────────────────────┬────────────┘
                │                       │
        [ SMS / WhatsApp OTP &     [ scheduled pg_dump
          2 transactional msgs ]     backups → object storage ]
```

**Why this shape:** the authorization model we designed (resident sees own + own-flat; rep sees own-tower;
admin all) maps **directly onto Postgres Row-Level Security** — authorization lives in the data layer,
server-enforced, with no custom backend to write or trust. Business invariants that need atomicity
(once-per-flat contribution, ≤N redemptions, payment verification → QR issuance) live in **database/edge
functions**. Everything else is the managed platform.

**Access model (explicit):**
- **Standard web access (primary):** a shared URL, opened in any browser — including WhatsApp's in-app
  browser — with **no installation, no app store, no prompts**. All flows (register, contribute, book sadya,
  pay, view QR, rep verification, admin) work fully in a plain browser tab. Deep links (e.g. a link the rep
  shares) can open a specific page.
- **Optional PWA install (enhancement):** users *may* "add to home screen" for an app-like icon and a faster
  cold start; this is **never required** and no core feature depends on it (so we don't rely on
  service-worker offline or web-push for anything essential).

**Area-by-area summary** (detail in later sections):
- **Frontend:** mobile-first **responsive web app** served from a shared URL (single codebase, role-based
  views), static-hosted on a free CDN. **PWA = optional enhancement only.**
- **Backend:** **no bespoke server** — BaaS + a handful of server-side functions for transactional logic.
- **Database:** **Postgres** (matches our relational model, real constraints, easy dashboards/aggregates).
- **Auth:** phone-OTP via BaaS auth + an SMS/WhatsApp provider; long "trusted-device" JWT sessions.
- **Authorization:** **RLS policies** by role + tower + ownership.
- **File storage:** managed object storage for screenshots, access-restricted by policy.
- **Notifications:** in-app (free) + 2 transactional OTP-channel messages; reminders via reps' WhatsApp.
- **QR:** **online-first**, atomic server-side redemption; printed fallback at cutoff.
- **Hosting:** free CDN + BaaS free tier (seasonal keep-alive / brief Pro window).
- **Monitoring:** platform logs + our AuditLog + free uptime + free error tracking.
- **Backup:** scheduled logical dumps to object storage; manual export before event day.

---

## 2. Technology Options

**Option A — Supabase (Postgres + RLS + Auth + Storage + Edge Functions) + PWA.** Batteries-included BaaS on
open-source Postgres. RLS implements our authz; SQL constraints implement our invariants; built-in phone auth
and storage. Minimal infra to run.

**Option B — Firebase (Firestore + Auth + Storage + Cloud Functions) + PWA.** Mature BaaS, very fast, good
free tier. But Firestore is **NoSQL** — our relational constraints (once-per-flat uniqueness, joins for
dashboards, relational audit) become app-side logic; security rules are less expressive than SQL RLS for
tower-scoping; higher proprietary lock-in.

**Option C — Custom monolith (e.g., Django or Node) + managed Postgres on a PaaS (Render/Railway/Fly) +
object storage (R2/S3).** Full control, no BaaS lock-in, and **Django admin gives a free Admin panel**. But
the team **builds and maintains a server** (auth, OTP, storage wiring, patching, uptime), free PaaS tiers also
sleep/limit, and it's **slower to deliver** — more ops for volunteers.

**Option D — No-code / spreadsheet (Google Forms+Sheets / AppSheet).** Cheapest and fastest, but cannot
deliver OTP identity, enforce RBAC/visibility, do atomic QR redemption, or prevent the very data-quality
problems we're escaping. **Rejected** for the transactional core (could still serve throwaway side-forms).

---

## 3. Architecture Comparison Matrix

(● weak · ●● ok · ●●● strong, for *this* project's priorities)

| Dimension | A. Supabase+PWA | B. Firebase+PWA | C. Custom monolith | D. No-code |
|---|---|---|---|---|
| Development speed | ●●● | ●●● | ● | ●●● |
| Hosting cost | ●●● (free tier) | ●●● (free tier) | ●● | ●●● |
| Operational complexity (low=better) | ●●● low | ●●● low | ● high | ●●● low |
| Security (authz fit) | ●●● (SQL RLS) | ●● (rules) | ●● (you build it) | ● |
| Maintainability (small team) | ●●● | ●● | ● | ●● |
| Scalability (to ~1k users) | ●●● (ample) | ●●● | ●● | ● |
| Vendor lock-in (low=better) | ●● (it's Postgres) | ● (proprietary) | ●●● none | ● |
| Future extensibility | ●●● (add tables/RLS) | ●● (denormalize) | ●●● | ● |
| Relational-constraint fit | ●●● | ● | ●●● | ● |

---

## 4. Recommended Stack

**Supabase + a mobile-first PWA.** Decisive reasons:
- **Authorization for free, and correct:** our RBAC/visibility rules become **RLS policies** — exactly the
  "server-enforced, never-trust-client" guarantee we specified, with no backend to build.
- **The data model fits Postgres natively:** once-per-flat uniqueness, flat→one-tower, append-only audit,
  dashboard aggregates — all are first-class SQL.
- **Fast + cheap + low-ops:** auth, storage, and functions are built-in; no servers to patch; generous free
  tier covers this scale comfortably.
- **Low lock-in for a BaaS:** it's standard Postgres underneath — portable (migrate the DB or self-host).

**Components:**
- **Frontend:** a responsive **web app** (a modern SPA framework — React or Svelte; either is fine) served
  from a **shared URL**, mobile-first, one codebase with **role-based views** for Resident / Rep / Admin,
  static-hosted on a free CDN. Works fully in any browser via a link (no install). **Optional PWA manifest +
  service worker** layered on as a progressive enhancement only.
- **Data + logic:** Supabase Postgres with **RLS**; **Postgres functions / Edge Functions** for transactional
  operations (payment verify → QR issue, **atomic redemption with `≤ N` check**, contribution-lock,
  fund-handover confirm). Dashboards = SQL views.
- **Auth:** Supabase Auth, phone provider (below).
- **Storage:** Supabase Storage for screenshots (policy-restricted).
- **Admin surface:** a section of the same PWA (Admin role) + the Supabase dashboard for break-glass.

**Strongest alternative if the team prefers owning the backend / hates BaaS lock-in:** Option C with
**Django** — chiefly for its **free, instant admin panel**. Accept the added ops/build time as the cost.

---

## 5. Authentication Design (re-evaluated: Mobile + Password vs Mobile OTP)

Identity remains the **mobile number**. Re-evaluating the two candidates under the stated lenses (near-zero
budget, fast timeline, **annual** usage, volunteer-run):

| Criterion | **Mobile + Password** | **Mobile OTP** |
|---|---|---|
| Ongoing cost | **$0** — no messages sent | SMS per code (~₹0.12–0.25) + provider account; small with long sessions |
| Implementation speed | **Ships day one** — built into the BaaS auth, **no external dependency** | Needs an SMS gateway **+ India DLT/sender-ID registration** (approval can take **days–weeks**) → real timeline risk |
| Implementation complexity | **Low** — hashing handled by the platform; phone-confirmation can be disabled | Medium — provider integration, OTP issue/verify, rate-limiting |
| Operational overhead | Forgotten-password resets — absorbed by **Rep/Admin-assisted reset** (no messaging) | Monitor SMS deliverability, provider balance, DLT compliance |
| UX | Slightly more friction (remember a password) | **Best** — nothing to remember |
| Annual-usage fit | People forget once-a-year passwords → recovery needed (reps handle it) | Re-verify each season anyway (~1 SMS/user); clean |
| Volunteer-run fit | **Strong** — reps already proxy-register and support residents | Strong UX, but DLT/setup needs a registered entity the society may not have |

**Recommendation (revised): Mobile + Password for v1**, with Mobile OTP as a planned enhancement.

Rationale: it **ships immediately with zero external dependency and zero recurring cost**, and the one real
weakness of passwords for an annual app — *forgotten credentials* — is absorbed by **Rep/Admin-assisted
recovery**, leaning on the volunteer relationship that already exists (reps proxy-register residents anyway).
This avoids the **DLT registration hurdle entirely**, which is the biggest threat to a fast, near-zero-budget
launch. **Mobile OTP is the better self-service experience and should be added once DLT (or a WhatsApp
Business channel) is in place** — at which point it can also power passwordless recovery and retire the
assisted-reset step.

**Decision rule:** if the society *already* has an entity that can obtain DLT (or a ready WhatsApp Business
channel) **without delaying launch**, go straight to Mobile OTP; **otherwise launch with Mobile + Password.**

**Implementation notes:**
- Mobile number stays the **unique identity**; **phone-confirmation can be disabled at signup** (no SMS),
  because the **Tower Rep validates the roster** and proxy registration exists — fake/duplicate numbers are
  caught by the unique constraint + rep review, not by SMS verification.
- Proxy-created (`UNCLAIMED`) accounts: the Rep sets an initial/temporary password and shares it; the resident
  changes it on first login (→ `CLAIMED`). Privileged roles (Rep/Admin) are **granted by Admin** (no
  self-elevation).
- **Recovery without SMS:** resident asks → **Tower Rep or Admin issues a reset / temporary password for
  their own tower** (mirrors the correction-approval authority already granted).
- **Sessions:** BaaS **access JWT** (role + tower claims for RLS) + a **long "remember me" refresh token** so
  residents stay logged in through the active weeks; rate-limit login attempts; shorter sessions / step-up
  re-auth for Admin on sensitive actions.

---

## 6. Hosting Design

- **Frontend PWA:** free global CDN tier — **Cloudflare Pages / Vercel / Netlify** (Git push → auto-deploy).
  $0, HTTPS included, fast on cheap Android phones.
- **Backend/data:** **Supabase free tier** (Postgres, Auth, Storage, Edge Functions, connection pooling).
- **Deployment model:** Git-based CI/CD for the PWA; Supabase migrations via its CLI. No servers to manage.
- **⚠️ Seasonal free-tier caveat:** Supabase **free projects pause after ~7 days of inactivity** — a real
  issue for an off-season app. Mitigations: (a) a **free scheduled keep-alive ping** (GitHub Action / uptime
  monitor) during the active months; or (b) run **Supabase Pro (~$25/mo) only for the ~2 active months**
  (~$50/yr) to also get **daily backups + no pausing**. Recommend (a) off-season, (b) during the event window.
- **QR validation hosting:** the **online-first** scan path is just authenticated calls to a redemption
  function; ensure a **dedicated 4G phone / hotspot at the gate**; **printed master list** exported at the
  verification cutoff as fallback.

**Monitoring & logging:** keep minimal — **Supabase dashboard logs**, the app's own **AuditLog** table (already
designed) for business events, a **free uptime monitor** (UptimeRobot/Cronitor), and **free-tier error
tracking** (e.g. Sentry) for the PWA. No observability stack to build.

**Backup & recovery:** the free-tier gap. Add a **scheduled logical dump** (`pg_dump` via a free scheduled
GitHub Action) to cheap/free object storage (Cloudflare R2 / Drive), **daily during the active season** plus a
**manual export right before event day**. Append-only audit + immutable financial transitions make
point-in-time reconstruction feasible. (Pro tier's daily PITR is the paid upgrade if desired.)

---

## 7. Storage Design

- **Payment screenshots** → managed object storage (Supabase Storage), **policy-restricted** so an image is
  readable only by the **submitting resident, that tower's Rep, and Admin** (mirrors RLS visibility).
- **Client-side image compression** before upload (cap dimensions/size) — screenshots are the main storage
  driver; this keeps well within the **1 GB** free tier for a year of ~thousands of payments.
- **Lifecycle:** archive/prune prior-year images (or offload to R2) to stay in free limits across years.
- **Generated exports** (printed master list, reports) → on-demand, not stored long-term.
- **QR images** are not stored — they're rendered from the booking's `id + nonce` on demand.

---

## 8. Notification Design

Now that **v1 auth uses Mobile + Password (no messaging channel)**, v1 notifications are **in-app + manual
rep WhatsApp**, with automated out-of-band messages deferred to the same enhancement that adds a messaging
channel (OTP/WhatsApp):
- **In-app (free, v1):** all statuses, confirmations, correction outcomes, and the Rep's "payments awaiting
  verification" badge — the source of truth.
- **Reps' per-tower WhatsApp groups (manual, v1):** the practical out-of-band reach for *payment verified*,
  *payment rejected (resubmit)*, reminders, and event-day announcements — leveraging the relationship that
  already exists, with **no system to build**.
- **Automated out-of-band (later enhancement):** when a messaging channel is added (alongside OTP), automate
  exactly two transactional triggers — *payment verified (QR ready)* and *payment rejected (resubmit)* — via
  that one provider.
- **Email:** skipped (identity is mobile; poor reach).
- Net v1 automated messaging cost ≈ **$0**.

---

## 9. Cost Analysis (annual, realistic)

| Item | Free path | If you spend a little |
|---|---|---|
| PWA hosting (CDN) | **$0** | $0 |
| BaaS (Postgres/Auth/Storage/Functions) | **$0** free tier + keep-alive | ~**$50/yr** (Pro for ~2 active months: backups + no pause) |
| Auth | **$0** — Mobile + Password (no messaging) | $0 |
| SMS (only if/when OTP added, + 2 transactional msgs) | **$0 in v1** (password auth) | ~₹150–400/season once OTP added |
| WhatsApp channel (optional, for OTP/transactional later) | often free tier | low |
| Error tracking / uptime | **$0** free tiers | $0 |
| Custom domain (optional) | **$0** (`*.pages.dev` etc.) | ~$10/yr |
| **Total** | **≈ $5–10/yr** | **≈ $60–70/yr** |

Effectively **near-zero**, dominated by an optional ~$50 paid window if you want managed backups + no pausing
during the event.

---

## 10. Risks & Tradeoffs

| # | Risk / tradeoff | Mitigation |
|---|---|---|
| T1 | **Free-tier pausing** (seasonal) | Keep-alive ping off-season; Pro for the ~2 active months |
| T2 | **Free-tier backups are weak** | Scheduled `pg_dump` to object storage + manual pre-event export |
| T3 | **DLT/SMS setup friction** (India entity/sender-ID) | One-time registration; WhatsApp fallback; long sessions cut volume |
| T4 | **BaaS lock-in** | It's Postgres underneath — portable; Django monolith is the escape hatch |
| T5 | **Logic split across RLS + DB/edge functions** can sprawl | Keep invariants in a few well-named functions; RLS for read scoping; document them |
| T6 | **Gate connectivity** for online QR | Dedicated 4G/hotspot + printed fallback + verification cutoff |
| T7 | **Small team / bus factor** | Managed services minimize what must be maintained; document the handful of functions + policies |
| T8 | **PWA limits** (no native push on iOS historically) | Rely on in-app + SMS/WhatsApp for the 2 critical alerts, not web-push |
| T9 | **Storage growth across years** | Compress uploads; archive/offload old years |

---

## 11. Final Technical Recommendation

Build a **mobile-first web app on Supabase**, served from a **shared URL** (click-from-WhatsApp, no install):
- **Frontend:** responsive **web app** (React or Svelte), one codebase, role-based views, on a **free CDN**;
  **PWA install is an optional enhancement, never required**.
- **Data & authorization:** **Postgres + Row-Level Security** implementing the approved RBAC/visibility model;
  business invariants in a small set of **Postgres/Edge functions** (verify → issue QR, **atomic ≤N
  redemption**, contribution-lock, handover-confirm).
- **Auth:** **Mobile + Password for v1** (zero cost, zero external dependency, ships immediately;
  Rep/Admin-assisted recovery), with **Mobile OTP as a planned enhancement** once DLT/WhatsApp is in place;
  **long "remember me" sessions** through the active weeks.
- **Storage:** managed object storage for screenshots, policy-restricted, client-compressed.
- **Notifications (v1):** **in-app everywhere + reps' WhatsApp groups (manual)**; automate 2 transactional
  messages later, with the messaging channel that comes with OTP.
- **QR:** **online-first** atomic redemption + **gate hotspot** + **printed fallback** at the cutoff.
- **Ops:** platform logs + AuditLog + free uptime/error tracking; **scheduled pg_dump backups**; keep-alive
  off-season, optional ~$50 Pro window during the event.

This delivers **fast**, costs **≈ $0–60/year** (v1 has no messaging cost), is **maintainable by a small
volunteer team** (almost no infra), **enforces our security model at the data layer**, and **extends cleanly**
to the deferred modules (voluntary top-ups, refund, sponsorship, multi-year) and to Mobile OTP, by adding
tables, policies, functions, and a messaging provider.

*Stopping here per scope — no API design, folder structures, or code. Ready to proceed to those on your
go-ahead.*
