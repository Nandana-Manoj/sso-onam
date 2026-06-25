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
  towerCodes: ['TTA', 'TTB', 'TTC'],
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

  // Transactional children of the test event (covers Phase 2 tables too).
  await del('audit_log', 'audit_log', 'event_id', eventIds);
  await del('redemptions', 'redemptions', 'event_id', eventIds);
  await del('qr_passes', 'qr_passes', 'event_id', eventIds);
  await del('sadya_bookings', 'sadya_bookings', 'event_id', eventIds);
  await del('refund_requests', 'refund_requests', 'event_id', eventIds);
  await del('fund_handovers', 'fund_handovers', 'event_id', eventIds);
  await del('contributions', 'contributions', 'event_id', eventIds);

  // Auth users for seeded profiles → cascade-deletes their profiles rows.
  const { data: profs, error: pErr } = await db
    .from('profiles')
    .select('id')
    .like('mobile', `${SENT.mobilePrefix}%`);
  if (pErr) throw new Error(`select profiles: ${pErr.message}`);
  let usersDeleted = 0;
  for (const p of profs ?? []) {
    const { error } = await db.auth.admin.deleteUser(p.id);
    if (error) throw new Error(`deleteUser ${p.id}: ${error.message}`);
    usersDeleted += 1;
  }
  counts.auth_users = usersDeleted;

  // Now safe to remove flats (no profile references them), then towers, then events.
  await del('flats', 'flats', 'tower_id', towerIds);
  await del('towers', 'towers', 'id', towerIds);
  await del('events', 'events', 'id', eventIds);

  return counts;
}
