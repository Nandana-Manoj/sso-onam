// Load test for the SSO-Onam prod backend.
//
// Exercises three things under concurrency (default 20 at a time):
//   1. READ   — anon GET of the public_towers view (the landing/registration read)
//   2. SIGNUP — Supabase Auth email signup (synthetic phone-email), the heaviest call
//   3. WRITE  — complete_registration + create_contribution RPCs (real money-loop writes)
//
// All test accounts use the sentinel mobile prefix 9700 (919700XXXXXX) and flat
// numbers prefixed LT- so the rows are trivially purgeable afterwards.
//
// Reads Supabase URL + anon key from web/.env (VITE_* names) unless overridden by
// SUPABASE_URL / SUPABASE_ANON_KEY env vars. Tunables: CONCURRENCY, ROUNDS,
// FRONTEND_URL (optional — adds a CDN page-load burst).
//
// Run from repo root:  node web/scripts/load-test.mjs
//                      CONCURRENCY=20 node web/scripts/load-test.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- config ---------------------------------------------------------------
function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* file optional */ }
  return out;
}

const envFile = loadEnvFile(join(__dirname, '..', '.env'));
const SUPABASE_URL = process.env.SUPABASE_URL || envFile.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || envFile.VITE_SUPABASE_ANON_KEY;
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const ROUNDS = Number(process.env.ROUNDS || 1);
const FRONTEND_URL = process.env.FRONTEND_URL || '';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY (and not found in web/.env).');
  process.exit(1);
}

const host = new URL(SUPABASE_URL).host;
console.log('═'.repeat(64));
console.log('SSO-Onam load test');
console.log(`  target      : ${host}`);
console.log(`  concurrency : ${CONCURRENCY}`);
console.log(`  rounds      : ${ROUNDS}`);
if (FRONTEND_URL) console.log(`  frontend    : ${FRONTEND_URL}`);
console.log('═'.repeat(64));

// ---- helpers --------------------------------------------------------------
function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// Run `fn(i)` for i in [0, n) with at most `n` in flight at once (one burst).
async function burst(n, fn) {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

function summarize(label, results) {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const total = results.reduce((a, r) => a + r.ms, 0);
  console.log(`\n── ${label} ──`);
  console.log(`  requests : ${results.length}   ok: ${ok.length}   failed: ${bad.length}`);
  if (times.length) {
    console.log(
      `  latency  : min ${times[0] | 0}ms  p50 ${pct(times, 50) | 0}ms  ` +
      `p95 ${pct(times, 95) | 0}ms  max ${times[times.length - 1] | 0}ms`,
    );
  }
  if (bad.length) {
    const groups = {};
    for (const r of bad) {
      const key = (r.error || 'unknown').slice(0, 80);
      groups[key] = (groups[key] || 0) + 1;
    }
    console.log('  errors   :');
    for (const [k, v] of Object.entries(groups)) console.log(`    ${v}×  ${k}`);
  }
  return { ok: ok.length, failed: bad.length, p95: pct(times, 95) | 0 };
}

async function timed(fn) {
  const t0 = performance.now();
  try {
    await fn();
    return { ok: true, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, error: e?.message || String(e) };
  }
}

// ---- scenarios ------------------------------------------------------------
async function scenarioFrontend() {
  if (!FRONTEND_URL) return null;
  const all = [];
  for (let r = 0; r < ROUNDS; r++) {
    const res = await burst(CONCURRENCY, () =>
      timed(async () => {
        const resp = await fetch(FRONTEND_URL, { redirect: 'follow' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await resp.text();
      }),
    );
    all.push(...res);
  }
  return summarize(`FRONTEND page load  (GET ${FRONTEND_URL})`, all);
}

async function scenarioRead() {
  const all = [];
  for (let r = 0; r < ROUNDS; r++) {
    const res = await burst(CONCURRENCY, () =>
      timed(async () => {
        const sb = newClient();
        const { error } = await sb.from('public_towers').select('*').order('name');
        if (error) throw error;
      }),
    );
    all.push(...res);
  }
  return summarize('READ  anon public_towers', all);
}

// Fetch one valid tower id for the write journey.
async function getTowerId() {
  const { data, error } = await newClient().from('public_towers').select('id').limit(1);
  if (error) throw new Error(`could not read towers: ${error.message}`);
  if (!data?.length) throw new Error('no towers exist — cannot run write journey');
  return data[0].id;
}

let SEQ = 0;
function uniqueMobile() {
  // 10 digits, sentinel prefix 9700 + 6 digits derived from time+seq
  const n = (Date.now() % 1000000) + SEQ++;
  return '9700' + String(n % 1000000).padStart(6, '0');
}

async function scenarioWrite(towerId) {
  const all = [];
  for (let r = 0; r < ROUNDS; r++) {
    const res = await burst(CONCURRENCY, (i) =>
      timed(async () => {
        const sb = newClient();
        const mobile = uniqueMobile();
        const email = `91${mobile}@phone.sso-onam.com`;
        const { data: signUp, error: suErr } = await sb.auth.signUp({
          email,
          password: 'LoadTest#2026',
        });
        if (suErr) throw new Error(`signup: ${suErr.message}`);
        if (!signUp.session) throw new Error('signup: no session (email-confirm on?)');

        const flat = `LT-${Date.now().toString(36)}-${r}-${i}`;
        const { error: regErr } = await sb.rpc('complete_registration', {
          p_name: `Load Test ${mobile}`,
          p_mobile: `+91${mobile}`,
          p_tower_id: towerId,
          p_flat_number: flat,
        });
        if (regErr) throw new Error(`register: ${regErr.message}`);

        // read active event min, then start the flat contribution
        const { data: ev } = await sb.from('events').select('min_contribution').eq('is_active', true).limit(1).maybeSingle();
        const amount = Math.max(1000, Number(ev?.min_contribution || 0));
        const { error: cErr } = await sb.rpc('create_contribution', { p_amount: amount });
        if (cErr) throw new Error(`contribution: ${cErr.message}`);
      }),
    );
    all.push(...res);
  }
  return summarize('WRITE signup → register → contribution', all);
}

// ---- main -----------------------------------------------------------------
const wall0 = performance.now();
const fe = await scenarioFrontend();
const read = await scenarioRead();

let write = null;
try {
  const towerId = await getTowerId();
  write = await scenarioWrite(towerId);
} catch (e) {
  console.log(`\n── WRITE skipped ──\n  ${e.message}`);
}

const totalReq = CONCURRENCY * ROUNDS * (1 + 1 + (write ? 1 : 0) + (fe ? 1 : 0));
console.log('\n' + '═'.repeat(64));
console.log(`wall clock   : ${((performance.now() - wall0) / 1000).toFixed(1)}s`);
console.log(`total reqs   : ~${totalReq}`);
const failed = (fe?.failed || 0) + (read?.failed || 0) + (write?.failed || 0);
console.log(failed ? `RESULT       : ${failed} failed request(s) — see above` : 'RESULT       : all requests succeeded');
console.log('═'.repeat(64));
console.log('\nCleanup: test rows use mobile prefix 9700 (emails 91 9700… @phone.sso-onam.com)');
console.log('and flat numbers LT-… — purge these before going live.');
