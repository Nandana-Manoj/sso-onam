// Seed the STAGING database with a small, deterministic, obviously-fake dataset
// so volunteers test against known data instead of inventing rows in prod.
//
//   node --env-file=.env.staging web/scripts/seed-staging.mjs --yes
//
// Idempotent: it cleans up any prior seed (sentinel-tagged rows only) first, so
// re-running gives a fresh, known-good state. See docs/release-readiness.md §4.

import { SENT, NOW, loadEnv, confirmTarget, admin, ins, makeUser, cleanupTestData } from './_lib.mjs';

const env = loadEnv();
confirmTarget(env, 'SEED staging (clean + insert test data)');
const db = admin(env);

const m = (n) => `${SENT.mobilePrefix}${String(n).padStart(3, '0')}`; // +9199990000NN

async function main() {
  console.log('Cleaning any previous seed…');
  const cleaned = await cleanupTestData(db);
  console.log('  removed:', cleaned);

  // ── Towers ──────────────────────────────────────────────────────────────
  console.log('Seeding towers…');
  const towerA = (await ins(db, 'towers', { name: 'Test Tower A', code: 'TTA' })).id;
  const towerB = (await ins(db, 'towers', { name: 'Test Tower B', code: 'TTB' })).id;
  const towerC = (await ins(db, 'towers', { name: 'Test Tower C', code: 'TTC' })).id;

  // ── Event ───────────────────────────────────────────────────────────────
  // Activate the test event only if nothing else is active (one-active index).
  const { data: actives } = await db.from('events').select('id').eq('is_active', true).limit(1);
  const makeActive = !actives || actives.length === 0;
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
      currency: 'INR',
    },
    'id',
  );
  const eventId = event.id;
  if (!makeActive) {
    console.log('  ⚠ another event is already active — test event seeded INACTIVE.');
    console.log('    Activate it from the admin UI before testing the live contribution flow.');
  }

  // ── Admin ───────────────────────────────────────────────────────────────
  // UAT needs an admin (events, tower/rep management, dashboards). Seeding one
  // directly is safe — is_admin() reads role from profiles, not from JWT claims.
  console.log('Seeding admin…');
  await makeUser(db, { mobile: m(0), name: 'Test Admin', role: 'admin' });

  // ── Reps (one per tower) ────────────────────────────────────────────────
  console.log('Seeding reps + residents…');
  const repA = await makeUser(db, { mobile: m(9), name: 'Test Rep A', role: 'tower_rep', towerId: towerA });
  const repB = await makeUser(db, { mobile: m(19), name: 'Test Rep B', role: 'tower_rep', towerId: towerB });
  const repC = await makeUser(db, { mobile: m(29), name: 'Test Rep C', role: 'tower_rep', towerId: towerC });
  // Mark each tower's current rep (mirrors grant_role).
  await db.from('towers').update({ rep_user_id: repA }).eq('id', towerA);
  await db.from('towers').update({ rep_user_id: repB }).eq('id', towerB);
  await db.from('towers').update({ rep_user_id: repC }).eq('id', towerC);

  // ── Tower A: 5 flats, one resident each, one contribution per status ─────
  // The once-per-flat partial-unique index allows only one LIVE row per flat,
  // so each live status lives on its own flat.
  const flats = {};
  for (const n of [101, 102, 103, 104, 105]) {
    flats[n] = (await ins(db, 'flats', { tower_id: towerA, flat_number: String(n) })).id;
  }
  const resA = {};
  for (let i = 1; i <= 5; i++) {
    const flatNo = 100 + i;
    resA[i] = await makeUser(db, {
      mobile: m(i),
      name: `Test Resident A${i}`,
      role: 'resident',
      towerId: towerA,
      flatId: flats[flatNo],
    });
  }

  const base = (flatId, residentId, status, extra = {}) => ({
    event_id: eventId,
    flat_id: flatId,
    initiated_by_user_id: residentId,
    amount: SENT.minContribution,
    min_snapshot: SENT.minContribution,
    paid_to_tower_id: towerA,
    status,
    ...extra,
  });

  console.log('Seeding contributions across every status…');
  // payment_pending — created, no payment recorded yet
  await ins(db, 'contributions', base(flats[101], resA[1], 'payment_pending'));
  // submitted — payment recorded, awaiting the rep
  await ins(
    db,
    'contributions',
    base(flats[102], resA[2], 'submitted', {
      amount_paid: SENT.minContribution,
      utr: 'TEST0002',
      payment_submitted_at: NOW(),
      paid_to_rep_user_id: repA, // set on submit in the real flow — keep ledger attribution realistic
    }),
  );
  // verified — approved by the rep
  await ins(
    db,
    'contributions',
    base(flats[103], resA[3], 'verified', {
      amount_paid: SENT.minContribution,
      utr: 'TEST0003',
      payment_submitted_at: NOW(),
      paid_to_rep_user_id: repA,
      verified_by_user_id: repA,
      verified_at: NOW(),
    }),
  );
  // rejected — terminal; flat is free to try again
  await ins(
    db,
    'contributions',
    base(flats[104], resA[4], 'rejected', {
      amount_paid: 500,
      utr: 'TEST0004',
      payment_submitted_at: NOW(),
      paid_to_rep_user_id: repA,
      verified_by_user_id: repA,
      verified_at: NOW(),
      decision_reason: 'Seed: amount did not match',
    }),
  );
  // verified + refund requested — exercises the refund flow
  await ins(
    db,
    'contributions',
    base(flats[105], resA[5], 'verified', {
      amount_paid: SENT.minContribution,
      utr: 'TEST0005',
      payment_submitted_at: NOW(),
      paid_to_rep_user_id: repA,
      verified_by_user_id: repA,
      verified_at: NOW(),
      refund_state: 'requested',
      refund_requested_at: NOW(),
      refund_reason: 'Seed: overpayment',
    }),
  );

  // ── Tower B: one submitted contribution (for cross-tower verification tests) ─
  const flatB = (await ins(db, 'flats', { tower_id: towerB, flat_number: '201' })).id;
  const resB = await makeUser(db, {
    mobile: m(11),
    name: 'Test Resident B1',
    role: 'resident',
    towerId: towerB,
    flatId: flatB,
  });
  await ins(db, 'contributions', {
    event_id: eventId,
    flat_id: flatB,
    initiated_by_user_id: resB,
    amount: SENT.minContribution,
    min_snapshot: SENT.minContribution,
    paid_to_tower_id: towerB,
    status: 'submitted',
    amount_paid: SENT.minContribution,
    utr: 'TEST0021',
    payment_submitted_at: NOW(),
    paid_to_rep_user_id: repB,
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n✔ Seed complete.\n');
  console.log('  Login password for every account:', SENT.password);
  console.log('  Accounts (mobile → role):');
  console.log(`    ${m(0)}  Admin`);
  console.log(`    ${m(9)}  Rep A        ${m(19)} Rep B        ${m(29)} Rep C`);
  console.log(`    ${m(1)}  Resident A1 (101, payment_pending)`);
  console.log(`    ${m(2)}  Resident A2 (102, submitted)`);
  console.log(`    ${m(3)}  Resident A3 (103, verified)`);
  console.log(`    ${m(4)}  Resident A4 (104, rejected)`);
  console.log(`    ${m(5)}  Resident A5 (105, verified + refund requested)`);
  console.log(`    ${m(11)} Resident B1 (201, submitted — Tower B)`);
  console.log('');
}

// Tower C is intentionally minimal — a rep and no contributions — so there is a
// tower with an empty verification queue to test against.

main().catch((e) => {
  console.error('\n✖ Seed failed:', e.message, '\n');
  process.exit(1);
});
