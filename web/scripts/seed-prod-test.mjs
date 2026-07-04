// Seed PRODUCTION with the same sentinel-tagged test dataset as staging, for
// a final pre-launch validation pass on the real target project — opt-in
// only, with extra confirmations beyond the staging scripts. See
// _lib_prod_test.mjs and the plan's "Prod validation" section.
//
//   node --env-file=.env.prod-test web/scripts/seed-prod-test.mjs --yes-this-is-prod
//
// Idempotent: cleans up any prior sentinel-tagged rows first (same as
// seed-staging.mjs). ALWAYS pair this with reset-prod-test.mjs immediately
// after the prod-test run — never leave sentinel data sitting in prod.

import { SENT, NOW, ins, makeUser, cleanupTestData, loadProdTestEnv, confirmProdTarget, admin } from './_lib_prod_test.mjs';

const env = loadProdTestEnv();
confirmProdTarget(env, 'SEED PRODUCTION (clean + insert sentinel-tagged test data)');
const db = admin(env);

const m = (n) => `${SENT.mobilePrefix}${String(n).padStart(3, '0')}`;

async function main() {
  console.log('Cleaning any previous prod-test seed…');
  const cleaned = await cleanupTestData(db);
  console.log('  removed:', cleaned);

  const towerA = (await ins(db, 'towers', { name: 'Test Tower A', code: 'TTA' })).id;
  const towerB = (await ins(db, 'towers', { name: 'Test Tower B', code: 'TTB' })).id;

  // Never activate a sentinel event on prod if a real event is already
  // active — this is a read-only validation pass, not allowed to disturb a
  // live event. If one is active, skip the contribution-flow fixtures that
  // depend on an active event and only exercise what doesn't need one.
  const { data: actives } = await db.from('events').select('id, name').eq('is_active', true).limit(1);
  const makeActive = !actives || actives.length === 0;
  if (!makeActive) {
    console.log(`  ⚠ another event is already active on PROD (${actives[0].name}) — sentinel event seeded INACTIVE.`);
    console.log('    Contribution/sadya RPC checks that require an active event will be skipped by the test suite.');
  }
  const event = await ins(
    db,
    'events',
    {
      name: SENT.eventName,
      year: SENT.eventYear,
      is_active: makeActive,
      min_contribution: SENT.minContribution,
      adult_sadya_price: SENT.adultPrice,
      child_sadya_price: SENT.childPrice,
      sadya_open: true,
      sadya_serving_open: true,
      currency: 'INR',
    },
    'id',
  );

  await makeUser(db, { mobile: m(0), name: 'Test Admin', role: 'admin' });
  const repA = await makeUser(db, { mobile: m(9), name: 'Test Rep A', role: 'tower_rep', towerId: towerA });
  await db.from('towers').update({ rep_user_id: repA }).eq('id', towerA);
  const repB = await makeUser(db, { mobile: m(19), name: 'Test Rep B', role: 'tower_rep', towerId: towerB });
  await db.from('towers').update({ rep_user_id: repB }).eq('id', towerB);

  const flatA = (await ins(db, 'flats', { tower_id: towerA, flat_number: '101' })).id;
  const resA = await makeUser(db, { mobile: m(1), name: 'Test Resident A1', role: 'resident', towerId: towerA, flatId: flatA });

  if (makeActive) {
    await ins(db, 'contributions', {
      event_id: event.id, flat_id: flatA, initiated_by_user_id: resA,
      amount: SENT.minContribution, min_snapshot: SENT.minContribution,
      paid_to_tower_id: towerA, status: 'submitted',
      amount_paid: SENT.minContribution, utr: 'PRODTEST0001', payment_submitted_at: NOW(),
      paid_to_rep_user_id: repA,
    });
  }

  console.log('\n✔ Prod-test seed complete.\n');
  console.log('  Login password for every account:', SENT.password);
  console.log(`  Admin ${m(0)} · Rep A ${m(9)} (tower A) · Rep B ${m(19)} (tower B) · Resident A1 ${m(1)}`);
  console.log('\n  Run reset-prod-test.mjs as soon as validation is done.\n');
}

main().catch((e) => {
  console.error('\n✖ Prod-test seed failed:', e.message, '\n');
  process.exit(1);
});
