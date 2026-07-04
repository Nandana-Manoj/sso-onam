// ONE-OFF administrative reset for PRODUCTION: removes every profile except a
// named "keeper" account, erases all contributions/sadya collections and
// everything derived from them, removes every flat except the keeper's own,
// and clears stale rep-contact fields on the (fully preserved) towers.
//
// This is NOT part of the sentinel-tagged test-fixture tooling (_lib.mjs /
// seed-prod-test.mjs) — it operates on REAL rows, unconditionally. Treat it
// with more care than any other script in this folder.
//
// Usage (repo root):
//   node --env-file=.env.prod-test web/scripts/purge-prod-reset.mjs --keep-mobile=+918197385353
//     -> DRY RUN ONLY. Prints exact counts, writes a full JSON backup to
//        data/prod-backups/, deletes nothing.
//   node --env-file=.env.prod-test web/scripts/purge-prod-reset.mjs --keep-mobile=+918197385353 --execute --yes-this-is-prod
//     -> Actually deletes. Requires having run the dry run first in the same
//        way (re-run is cheap and re-confirms counts haven't drifted).
//
// Safety:
//   - --keep-mobile is REQUIRED, always, with no default — never silently
//     guesses whose account survives. The flat to keep is derived from that
//     profile's OWN flat_id — never matched by flat_number, which is only
//     unique per-tower, not globally (two real flats here are both "10183",
//     in different towers).
//   - EXPECTED_PROD_URL / I_UNDERSTAND_THIS_IS_PRODUCTION / --yes-this-is-prod
//     reuse the exact same triple-confirmation gate as seed-prod-test.mjs.
//   - A dry run ALWAYS happens first (no --execute = dry run, full stop) and
//     always writes a timestamped JSON backup of every row this would touch
//     BEFORE any delete — free-tier Supabase has no automated backups, so
//     this file is the only safety net. Kept in data/ (already gitignored).

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadProdTestEnv, confirmProdTarget, admin } from './_lib_prod_test.mjs';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const keepMobile = arg('keep-mobile');
const execute = process.argv.includes('--execute');

if (!keepMobile) {
  console.error('\n✖ Missing --keep-mobile=+91XXXXXXXXXX — required, no default.\n');
  process.exit(1);
}

const env = loadProdTestEnv();
confirmProdTarget(env, `${execute ? 'EXECUTE' : 'DRY RUN'}: purge all profiles except ${keepMobile}, erase all collections`);
const db = admin(env);

async function fetchAll(table, select = '*') {
  const { data, error } = await db.from(table).select(select);
  if (error) throw new Error(`select ${table}: ${error.message}`);
  return data ?? [];
}

async function main() {
  const { data: keeper, error: keeperErr } = await db.from('profiles').select('id, name, mobile, role, flat_id').eq('mobile', keepMobile).maybeSingle();
  if (keeperErr) throw new Error(`select keeper: ${keeperErr.message}`);
  if (!keeper) throw new Error(`No profile found with mobile ${keepMobile} — refusing to proceed (would delete everyone).`);
  if (!keeper.flat_id) throw new Error(`Keeper profile has no flat_id — refusing to proceed (can't determine which flat to keep).`);
  const { data: keeperFlat, error: flatErr } = await db.from('flats').select('id, flat_number, tower_id, towers(name)').eq('id', keeper.flat_id).single();
  if (flatErr) throw new Error(`select keeper flat: ${flatErr.message}`);
  console.log(`\nKeeper: ${keeper.name} (${keeper.mobile}, ${keeper.role}) — id ${keeper.id}`);
  console.log(`Keeper's flat: ${keeperFlat.flat_number} in ${keeperFlat.towers.name} — id ${keeperFlat.id}\n`);

  // ── Snapshot everything this run will touch, BEFORE any delete ───────────
  const snapshot = {
    takenAt: new Date().toISOString(),
    keeper,
    keeperFlat,
    profiles: (await fetchAll('profiles')).filter((p) => p.id !== keeper.id),
    towers: await fetchAll('towers'),
    flats: (await fetchAll('flats')).filter((f) => f.id !== keeper.flat_id),
    contributions: await fetchAll('contributions'),
    sadya_bookings: await fetchAll('sadya_bookings'),
    qr_passes: await fetchAll('qr_passes'),
    redemptions: await fetchAll('redemptions'),
    sadya_cancellations: await fetchAll('sadya_cancellations'),
    refund_requests: await fetchAll('refund_requests'),
    fund_handovers: await fetchAll('fund_handovers'),
    rep_settlements: await fetchAll('rep_settlements'),
    suggestions: await fetchAll('suggestions'),
    correction_requests: await fetchAll('correction_requests'),
    audit_log: (await fetchAll('audit_log')).filter((a) => a.actor_user_id !== keeper.id),
  };

  const backupDir = path.join(import.meta.dirname, '..', '..', 'data', 'prod-backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `prod-purge-backup-${snapshot.takenAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  console.log(`Backup written: ${backupPath}\n`);

  console.log('Will remove:');
  console.log('  profiles (all except keeper):', snapshot.profiles.length);
  console.log('  contributions:               ', snapshot.contributions.length);
  console.log('  sadya_bookings:               ', snapshot.sadya_bookings.length);
  console.log('  qr_passes:                    ', snapshot.qr_passes.length);
  console.log('  redemptions:                  ', snapshot.redemptions.length);
  console.log('  sadya_cancellations:          ', snapshot.sadya_cancellations.length);
  console.log('  refund_requests:              ', snapshot.refund_requests.length);
  console.log('  fund_handovers:               ', snapshot.fund_handovers.length);
  console.log('  rep_settlements:              ', snapshot.rep_settlements.length);
  console.log('  suggestions:                  ', snapshot.suggestions.length);
  console.log('  correction_requests:          ', snapshot.correction_requests.length, '(cascade via profile delete)');
  console.log('  audit_log (all but keeper\'s): ', snapshot.audit_log.length);
  console.log('  flats (all except keeper\'s):  ', snapshot.flats.length);
  console.log('  towers KEPT (structure only): ', snapshot.towers.length, '— rep_user_id + contact fields cleared\n');

  if (!execute) {
    console.log('DRY RUN — nothing deleted. Re-run with --execute --yes-this-is-prod to actually perform this.\n');
    return;
  }

  const otherProfileIds = snapshot.profiles.map((p) => p.id);

  const del = async (label, table, col, vals) => {
    if (!vals || vals.length === 0) { console.log(`  ${label}: 0`); return; }
    const { error, count } = await db.from(table).delete({ count: 'exact' }).in(col, vals);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    console.log(`  ${label}:`, count ?? 0);
  };

  console.log('Deleting...');
  await del('redemptions', 'redemptions', 'id', snapshot.redemptions.map((r) => r.id));
  await del('qr_passes', 'qr_passes', 'id', snapshot.qr_passes.map((r) => r.id));
  await del('sadya_cancellations', 'sadya_cancellations', 'id', snapshot.sadya_cancellations.map((r) => r.id));
  await del('sadya_bookings', 'sadya_bookings', 'id', snapshot.sadya_bookings.map((r) => r.id));
  await del('refund_requests', 'refund_requests', 'id', snapshot.refund_requests.map((r) => r.id));
  await del('fund_handovers', 'fund_handovers', 'id', snapshot.fund_handovers.map((r) => r.id));
  await del('contributions', 'contributions', 'id', snapshot.contributions.map((r) => r.id));
  await del('rep_settlements', 'rep_settlements', 'id', snapshot.rep_settlements.map((r) => r.id));
  await del('suggestions', 'suggestions', 'id', snapshot.suggestions.map((r) => r.id));
  await del('audit_log', 'audit_log', 'id', snapshot.audit_log.map((r) => r.id));

  // Clear stale rep-contact fields on every tower (their rep is being removed).
  const { error: towerClearErr, count: towerClearCount } = await db
    .from('towers')
    .update({ rep_contact: null, rep_upi_id: null, rep_payment_phone: null, payment_qr_path: null }, { count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000'); // affects all rows; id/name/code/flats untouched
  if (towerClearErr) throw new Error(`clear tower rep fields: ${towerClearErr.message}`);
  console.log('  towers (rep-contact fields cleared):', towerClearCount ?? 0);

  // Profiles next (correction_requests cascade away here too), then their auth users.
  await del('profiles', 'profiles', 'id', otherProfileIds);
  let usersDeleted = 0;
  for (const id of otherProfileIds) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser ${id}: ${error.message}`);
    usersDeleted += 1;
  }
  console.log('  auth users:', usersDeleted);

  // Flats last of all — safe now that every row that could reference one
  // (contributions, sadya_bookings, qr_passes, sadya_cancellations,
  // correction_requests via profile cascade, and every non-keeper profile)
  // is already gone. Keeper's own flat is never in this list.
  await del('flats', 'flats', 'id', snapshot.flats.map((f) => f.id));

  console.log('\n✔ Purge complete. Towers intact; only', keeper.mobile, 'and their flat', `(${keeperFlat.flat_number})`, 'remain.\n');
}

main().catch((e) => {
  console.error('\n✖ Failed:', e.message, '\n');
  process.exit(1);
});
