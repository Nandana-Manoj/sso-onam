// Shared helpers for the staging seed/reset scripts.
//
// These run with the STAGING service-role key (bypasses RLS) and are NEVER
// pointed at production — see the guards below and docs/release-readiness.md.
//
// Run from the repo root so --env-file resolves, e.g.:
//   node --env-file=.env.staging web/scripts/seed-staging.mjs --yes
// Bare imports (@supabase/supabase-js) resolve via web/node_modules because
// this file lives under web/.

import { createClient } from '@supabase/supabase-js';

// ── Sentinels ────────────────────────────────────────────────────────────────
// Every seeded row is tagged so cleanup can target ONLY test data and never
// touch anything a tester or a real import created.
export const SENT = {
  eventYear: 9999, // sentinel year — no real Onam edition will ever use it
  eventName: 'TEST — Onam Seed Event',
  towerCodes: ['TTA', 'TTB', 'TTC', 'TTD'], // TTD: reserved for multi-tower-rep test fixtures
  mobilePrefix: '+919999000', // reserved fake range; matched as LIKE '+919999000%'
  phoneEmailDomain: 'phone.sso-onam.com', // must match web/src/lib/format.ts
  password: 'OnamTest#2026', // shared login for every seeded account
  minContribution: 1000,
  adultPrice: 300,
  childPrice: 150,
};

export const NOW = () => new Date().toISOString();

// Mirror of web/src/lib/format.ts mobileToEmail: digits-only + synthetic domain.
export function mobileToEmail(mobile) {
  const digits = String(mobile).replace(/\D/g, '');
  return `${digits}@${SENT.phoneEmailDomain}`;
}

// ── Environment + safety guards ──────────────────────────────────────────────
export function loadEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Copy .env.staging.example → .env.staging and run from the repo root with:\n' +
        '  node --env-file=.env.staging web/scripts/<script>.mjs --yes',
    );
  }
  return { url, key, prodUrl: process.env.PROD_SUPABASE_URL };
}

const norm = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();

// Print the target, refuse prod, and require an explicit --yes before any writes.
export function confirmTarget({ url, prodUrl }, action) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  console.log(`\n  Target Supabase project : ${host}`);
  console.log(`  Action                  : ${action}\n`);

  if (prodUrl && norm(url) === norm(prodUrl)) {
    fail('Refusing to run: SUPABASE_URL matches PROD_SUPABASE_URL. This is production.');
  }
  if (!process.argv.includes('--yes')) {
    fail(`Refusing to run without confirmation. Re-run with --yes once the target above is correct.`);
  }
}

export function admin({ url, key }) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Small DB helpers (throw on error so failures are loud) ────────────────────
export async function ins(db, table, row, returning = 'id') {
  const { data, error } = await db.from(table).insert(row).select(returning).single();
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return data;
}

export async function makeUser(db, { mobile, name, role, towerId = null, flatId = null }) {
  const email = mobileToEmail(mobile);
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: SENT.password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${mobile}: ${error.message}`);
  const id = data.user.id;
  // Insert the profile directly (service role bypasses RLS); shape matches
  // complete_registration. INSERT does not fire the before-UPDATE identity guard.
  await ins(db, 'profiles', {
    id,
    name,
    mobile,
    role,
    tower_id: towerId,
    flat_id: flatId,
    claimed: true,
  });
  return id;
}

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── Cleanup: delete ONLY sentinel-tagged rows, in FK-safe order ───────────────
// Order matters: children before parents, and profiles (auth users) are removed
// BEFORE flats so the flats' on-delete-set-null on profiles never fires the
// identity guard (which would reject the cascade under a non-admin connection).
export async function cleanupTestData(db) {
  const counts = {};
  const del = async (label, table, col, vals) => {
    if (!vals || vals.length === 0) {
      counts[label] = 0;
      return;
    }
    const { error, count } = await db
      .from(table)
      .delete({ count: 'exact' })
      .in(col, vals);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    counts[label] = count ?? 0;
  };

  // Resolve sentinel parents.
  const { data: events, error: eErr } = await db
    .from('events')
    .select('id')
    .eq('year', SENT.eventYear);
  if (eErr) throw new Error(`select events: ${eErr.message}`);
  const eventIds = (events ?? []).map((e) => e.id);

  const { data: towers, error: tErr } = await db
    .from('towers')
    .select('id')
    .in('code', SENT.towerCodes);
  if (tErr) throw new Error(`select towers: ${tErr.message}`);
  const towerIds = (towers ?? []).map((t) => t.id);

  // Flats under sentinel towers — needed so transactional rows created via an
  // RPC that always targets "whichever event is currently active" (create_
  // contribution, create_sadya_booking, record_offline_sadya, ...) still get
  // found and removed even when that active event ISN'T the sentinel event
  // (e.g. testing against a project — prod included — that already has a
  // real event live). Scoping cleanup by event_id alone would silently leave
  // those rows behind. See fixtures/world.ts and the prod-test docs.
  const { data: flats, error: flErr } = await db
    .from('flats')
    .select('id')
    .in('tower_id', towerIds.length ? towerIds : ['00000000-0000-0000-0000-000000000000']);
  if (flErr) throw new Error(`select flats: ${flErr.message}`);
  const flatIds = (flats ?? []).map((f) => f.id);

  const { data: qrPasses, error: qpErr } = await db
    .from('qr_passes')
    .select('id')
    .in('flat_id', flatIds.length ? flatIds : ['00000000-0000-0000-0000-000000000000']);
  if (qpErr) throw new Error(`select qr_passes: ${qpErr.message}`);
  const qrPassIds = (qrPasses ?? []).map((p) => p.id);

  // Auth users, enumerated directly by email prefix (not joined through
  // profiles) so an auth user orphaned by a partial/failed prior cleanup
  // (profile already gone, auth user left behind) is still found here, up
  // front — several tables below (audit_log, suggestions) reference actors
  // by user id with NO cascade/set-null, independent of any event, so they
  // must be cleaned by user id, not just by event id.
  const emailPrefix = SENT.mobilePrefix.replace(/\D/g, ''); // '+919999000' -> '919999000'
  const sentinelUserIds = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email?.startsWith(emailPrefix)) sentinelUserIds.push(u.id);
    }
    if (users.length < 200) break;
  }

  // Transactional children of the test event (covers Phase 2 tables too).
  // audit_log rows aren't all event-scoped (role/rep-management actions like
  // grant_admin write event_id = null), so also sweep by actor_user_id —
  // otherwise a sentinel admin/rep who ever took such an action becomes
  // permanently un-deletable (audit_log.actor_user_id has no cascade, by
  // design — it's meant to survive the actor being removed).
  await del('audit_log (by event)', 'audit_log', 'event_id', eventIds);
  await del('audit_log (by actor)', 'audit_log', 'actor_user_id', sentinelUserIds);
  await del('redemptions (by event)', 'redemptions', 'event_id', eventIds);
  await del('redemptions (by pass)', 'redemptions', 'qr_pass_id', qrPassIds);
  await del('qr_passes (by event)', 'qr_passes', 'event_id', eventIds);
  await del('qr_passes (by flat)', 'qr_passes', 'flat_id', flatIds);
  await del('sadya_cancellations (by event)', 'sadya_cancellations', 'event_id', eventIds);
  await del('sadya_cancellations (by flat)', 'sadya_cancellations', 'flat_id', flatIds);
  await del('sadya_bookings (by event)', 'sadya_bookings', 'event_id', eventIds);
  await del('sadya_bookings (by flat)', 'sadya_bookings', 'flat_id', flatIds);
  await del('sadya_bookings (by resident)', 'sadya_bookings', 'resident_id', sentinelUserIds);
  await del('refund_requests', 'refund_requests', 'event_id', eventIds);
  await del('fund_handovers', 'fund_handovers', 'event_id', eventIds);
  await del('contributions (by event)', 'contributions', 'event_id', eventIds);
  await del('contributions (by flat)', 'contributions', 'flat_id', flatIds);
  await del('contributions (by initiator)', 'contributions', 'initiated_by_user_id', sentinelUserIds);

  // suggestions.submitted_by_user_id -> profiles(id) has no ON DELETE action
  // (by design — it's an intentionally unlisted feedback trail, not meant to
  // vanish when a rep is reassigned). Deleting a sentinel rep's auth user
  // without clearing their suggestions first fails at the DB layer; GoTrue
  // surfaces that as an opaque 500 rather than the real FK error.
  await del('suggestions', 'suggestions', 'submitted_by_user_id', sentinelUserIds);

  let usersDeleted = 0;
  for (const id of sentinelUserIds) {
    const { error: delErr } = await db.auth.admin.deleteUser(id);
    if (delErr) throw new Error(`deleteUser ${id}: ${delErr.message}`);
    usersDeleted += 1;
  }
  counts.auth_users = usersDeleted;

  // Now safe to remove flats (no profile references them), then towers, then events.
  await del('flats', 'flats', 'tower_id', towerIds);
  await del('towers', 'towers', 'id', towerIds);
  await del('events', 'events', 'id', eventIds);

  return counts;
}
