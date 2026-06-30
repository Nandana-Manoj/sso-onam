# Phase 3 — Event-Day QR Scanning / Redemption

Status: **planned, not yet built.** Decisions locked 2026-06-30.

Phase 2 issued **one sadya QR pass per flat** (`qr_passes`, keyed on `(event_id, flat_id)`,
`allowed_scans` = total persons across the flat's verified bookings). Phase 3 is the
event-day side: a sadya rep scans that pass at the serving counter and **redeems** meals
against it. The `redemptions` table and SELECT RLS already exist from Phase 0/2 — there is
no writer yet. That writer, plus the role, the serving gate, and the scanner UI, is Phase 3.

---

## Core redemption model

A flat's pass is **partial / multi-scan by design**:

- The rep scans the flat's single QR **once**.
- They enter a **head-count** on a counter (Stepper): "how many people from this flat are
  being served right now." This saves time for large families — one scan covers many meals.
- `redeem_sadya_pass` adds that count to `qr_passes.redeemed_count` and recomputes status:
  `issued → partially_redeemed → fully_redeemed`.
- The **same QR can be scanned again later** for flatmates who arrive afterward, until
  `redeemed_count` reaches `allowed_scans`. Once full, further scans return
  `rejected_exhausted` (with `remaining` so the operator sees why).

So a flat of 5 might be served as 3 now + 2 later, or all 5 at once — both work.

---

## 1. Sadya-rep role — a capability flag (NOT a `user_role` enum value)

`profiles.role` is single-valued (`user_role = resident | tower_rep | admin | sponsorship`).
A new enum value would prevent a sadya rep from *also* being a resident (who books their own
flat's sadya). **A sadya rep IS a resident** with an extra scanning capability, so we model it
as a grantable flag that stacks on top of the existing role.

**Migration `…phase3_00_sadya_rep_role.sql`:**

```sql
alter table public.profiles
  add column if not exists is_sadya_rep boolean not null default false;

create or replace function public.is_sadya_rep()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_sadya_rep from public.profiles where id = auth.uid()), false)
         or public.is_admin();
$$;
grant execute on function public.is_sadya_rep() to authenticated;

-- admin-only grant/revoke, mirroring grant_admin/revoke_admin
create or replace function public.grant_sadya_rep(p_user_id uuid)  returns void ...; -- set true
create or replace function public.revoke_sadya_rep(p_user_id uuid) returns void ...; -- set false
```

**Admin UI:** a "Sadya Reps" management screen, cloned from `AdminReps` / `AdminAdmins`
(search resident → grant/revoke). A resident or a tower_rep can be granted it.

---

## 2. Serving gate — admin open/close

Mirrors the existing booking gate (`events.sadya_open` + `set_sadya_open`).

**Migration `…phase3_01` (or its own file):**

```sql
alter table public.events
  add column if not exists sadya_serving_open boolean not null default false;

create or replace function public.set_sadya_serving_open(p_event_id uuid, p_open boolean)
returns void ...; -- admin-only
```

- Admin toggle in `AdminEvents.tsx`, next to the "Open/Close Booking" toggle.
- `redeem_sadya_pass` rejects with a clear "serving not open" error while the flag is off.

---

## 3. Redemption RPCs — `…phase3_01_sadya_redemption.sql`

Reuses existing enums (`redeem_result`, `qr_status`), `redemptions`, `audit_log`. Only schema
change beyond the role/serving flags is one idempotency column on `redemptions`.

```sql
alter table public.redemptions
  add column if not exists client_scan_id uuid unique;  -- offline-queue dedup
```

**`lookup_sadya_pass(p_nonce text)`** — read-only preview (no write):
- Authz: `is_sadya_rep()`.
- Returns: flat label, tower, `allowed_scans`, `redeemed_count`, `remaining`, `status` — or a
  `not_found` marker for an unknown nonce (returned as data, not an exception, so the UI shows
  "invalid pass").

**`redeem_sadya_pass(p_nonce text, p_count int default 1, p_device text default null, p_client_scan_id uuid)`**
— `security definer`:
1. Authz `is_sadya_rep()` + serving-open check.
2. **Idempotency:** if a `redemptions` row already exists for `p_client_scan_id`, return its
   prior result unchanged (safe replay for the offline queue).
3. `SELECT … FOR UPDATE` the pass by nonce — serializes concurrent counters so two devices
   can't both push the same flat over capacity.
4. Decide:
   - nonce not found → `rejected_invalid` (no row — `qr_pass_id` is `NOT NULL`).
   - status `void` → log `rejected_void`, no count change.
   - `redeemed_count + p_count > allowed_scans` → log `rejected_exhausted`, return `remaining`.
   - else **accept**: `redeemed_count += p_count`, recompute `status`, insert
     `redemptions(result='accepted', count_redeemed=p_count, client_scan_id=…)` + `audit_log`.
5. Return `{ result, flat_label, allowed_scans, redeemed_count, remaining }`.

`redemptions` keeps **no INSERT policy** (default-deny under RLS) → this definer RPC is the
only writer; direct client inserts are blocked.

---

## 4. Frontend — scanner + offline queue

**New dependency:** `html5-qrcode` (the app only has `qrcode`, a *generator*). Turnkey camera
handling — back-camera selection, torch, mobile permission prompts.

**`web/src/components/SadyaScanner.tsx`:**
- "Start scanning" → live camera. On decode of a nonce:
  - call `lookup_sadya_pass` (or read the cached map when offline — see below) → show a confirm
    card: **"Flat A-101 — 4 of 5 remaining. Serving now: [Stepper]"**.
  - **Redeem** → `redeem_sadya_pass(nonce, count, device, clientScanId)`.
- Result feedback: large green ✓ ("Served 3 — 3 of 5 done") or red ✗ for
  exhausted / void / invalid / serving-closed, then auto-resume scanning.
- Recent-scans list + a sync-status indicator.

**Offline queue + cached remaining-map (IndexedDB):**
- **Cached map:** at serving start (and whenever online), snapshot every flat's
  `nonce → { flat_label, allowed_scans, remaining }` into IndexedDB. While offline, the
  preview card reads remaining from this cached map plus locally-queued counts, so the operator
  still sees "X of Y left" — they are **not** scanning blind.
- **Queue:** each redeem mints a `client_scan_id` (uuid) and is enqueued locally first, giving
  instant ✓ feedback even with no connection. A background syncer flushes the queue to
  `redeem_sadya_pass` when online.
- **Reconciliation:** server is the source of truth. `client_scan_id` dedup makes replays safe.
  A queued scan that the server finds pushed a flat over capacity comes back
  `rejected_exhausted` and is surfaced in the sync panel as an **"over-served, review"** warning
  (inherent risk when two offline devices serve the same flat simultaneously — flagged, never
  silently dropped). The cached-map preview reduces but cannot fully eliminate this for truly
  concurrent offline scans of the same flat.

**Placement:** scanner section added to `RepHome.tsx` and `AdminHome.tsx` (single-page `<h3>`
sections), shown only when `is_sadya_rep`. Serving toggle lives in `AdminEvents.tsx`.

---

## Build order

1. Migration `phase3_00` (sadya_rep flag + grant/revoke) → Admin "Sadya Reps" UI.
2. Migration `phase3_01` (serving flag + `lookup`/`redeem` RPCs + `client_scan_id` column)
   → Admin serving toggle in `AdminEvents`.
3. `html5-qrcode` + `SadyaScanner` — online path first (scan → preview → counter → redeem,
   incl. partial multi-scan).
4. IndexedDB cached remaining-map + offline queue + background syncer + reconciliation panel.
5. `npm run build`; then apply migrations by hand in the Supabase SQL editor (project's usual
   flow), wire grants, and smoke-test end to end.

Scanning lands here; **Phase 4** = reports / handovers / audit.
