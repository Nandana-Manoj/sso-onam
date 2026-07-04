// Copy the real tower list (name + code) from PROD into STAGING, so staging's
// picker/dropdowns match the real building structure instead of placeholder
// test towers. Read-only against prod; additive (insert-only, matched by code
// or name) against staging — never deletes or overwrites existing staging rows.
//
//   node web/scripts/copy-towers-prod-to-staging.mjs --yes
//
// Reads .env.prod-test and .env.staging directly (not via --env-file) so both
// sets of same-named vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) can be
// loaded into separate objects without colliding in process.env.

import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const root = new URL('../../', import.meta.url);
const norm = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();

function loadFile(name) {
  return parseEnv(readFileSync(new URL(name, root), 'utf8'));
}

const prodEnv = loadFile('.env.prod-test');
const stagingEnv = loadFile('.env.staging');

if (!prodEnv.SUPABASE_URL || !prodEnv.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n✖ .env.prod-test is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n');
  process.exit(1);
}
if (norm(prodEnv.SUPABASE_URL) !== norm(prodEnv.EXPECTED_PROD_URL)) {
  console.error('\n✖ .env.prod-test SUPABASE_URL does not match EXPECTED_PROD_URL — refusing to read.\n');
  process.exit(1);
}
if (!stagingEnv.SUPABASE_URL || !stagingEnv.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n✖ .env.staging is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n');
  process.exit(1);
}
if (norm(stagingEnv.SUPABASE_URL) === norm(stagingEnv.PROD_SUPABASE_URL)) {
  console.error('\n✖ .env.staging SUPABASE_URL matches PROD_SUPABASE_URL — refusing to write. This is production.\n');
  process.exit(1);
}

console.log(`\n  Reading towers from PROD    : ${new URL(prodEnv.SUPABASE_URL).host}`);
console.log(`  Writing (additive) to STAGING: ${new URL(stagingEnv.SUPABASE_URL).host}\n`);

const prodDb = createClient(prodEnv.SUPABASE_URL, prodEnv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stagingDb = createClient(stagingEnv.SUPABASE_URL, stagingEnv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: prodTowers, error: prodErr } = await prodDb
  .from('towers')
  .select('name, code')
  .order('name');
if (prodErr) { console.error('✖ Reading prod towers failed:', prodErr.message); process.exit(1); }
console.log(`Found ${prodTowers.length} tower(s) on prod:`);
for (const t of prodTowers) console.log(`    - ${t.name}${t.code ? ` (${t.code})` : ''}`);

const { data: existing, error: exErr } = await stagingDb.from('towers').select('name, code');
if (exErr) { console.error('✖ Reading staging towers failed:', exErr.message); process.exit(1); }
const existingNames = new Set(existing.map((t) => norm(t.name)));
const existingCodes = new Set(existing.filter((t) => t.code).map((t) => norm(t.code)));

const toInsert = prodTowers.filter((t) =>
  !existingNames.has(norm(t.name)) && !(t.code && existingCodes.has(norm(t.code))),
);

if (toInsert.length === 0) {
  console.log('\n✔ Staging already has every prod tower (by name/code match). Nothing to do.\n');
  process.exit(0);
}

console.log(`\nWould add ${toInsert.length} tower(s) to staging:`);
for (const t of toInsert) console.log(`    - ${t.name}${t.code ? ` (${t.code})` : ''}`);

if (!process.argv.includes('--yes')) {
  console.error('\nRefusing to write without confirmation. Re-run with --yes once the list above looks right.\n');
  process.exit(1);
}

const { error: insErr } = await stagingDb.from('towers').insert(
  toInsert.map((t) => ({ name: t.name, code: t.code })),
);
if (insErr) { console.error('✖ Insert failed:', insErr.message); process.exit(1); }

console.log(`\n✔ Added ${toInsert.length} tower(s) to staging:`);
for (const t of toInsert) console.log(`    - ${t.name}${t.code ? ` (${t.code})` : ''}`);
console.log('\nExisting staging towers were left untouched.\n');
