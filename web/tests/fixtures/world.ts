// Builds one full sentinel-tagged fixture world for the integration/security
// suite: multi-tower rep (to exercise the two known is_rep_of() vs
// app_tower_id() bugs), a single-tower rep, an empty-queue tower, a
// sadya-rep-flagged resident, and a contribution per status. Torn down with
// cleanupTestData() from _lib.mjs (same sentinel tags), so re-runs are clean.
import type { SupabaseClient } from '@supabase/supabase-js';
import { SENT, NOW, ins, makeUser, cleanupTestData, clearSessionCache } from './testEnv';

const m = (n: number) => `${SENT.mobilePrefix}${String(n).padStart(3, '0')}`;

export interface World {
  towers: { a: string; b: string; c: string; d: string };
  event: { id: string; makeActive: boolean };
  flats: Record<string, string>;
  users: {
    adminMobile: string;
    repMultiMobile: string; // reps towers A + D, residence in A — the multi-tower case
    repBMobile: string; // reps tower B only
    repCMobile: string; // reps tower C only, empty queue
    sadyaRepMobile: string; // is_sadya_rep=true, plain resident otherwise
    residentA: Record<number, string>; // 1..5, mobiles
    residentBMobile: string;
    residentDMobile: string; // has the one submitted sadya booking
  };
  contributionIds: Record<'pending' | 'submitted' | 'verified' | 'rejected' | 'refundRequested' | 'crossTowerB', string>;
  sadyaBookingId: string; // submitted, towerD, ready to be verified in a test
}

export async function seedWorld(db: SupabaseClient): Promise<World> {
  clearSessionCache();
  await cleanupTestData(db);

  const towerA = (await ins(db, 'towers', { name: 'Test Tower A', code: 'TTA' })).id;
  const towerB = (await ins(db, 'towers', { name: 'Test Tower B', code: 'TTB' })).id;
  const towerC = (await ins(db, 'towers', { name: 'Test Tower C', code: 'TTC' })).id;
  const towerD = (await ins(db, 'towers', { name: 'Test Tower D', code: 'TTD' })).id;

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
      sadya_open: true,
      sadya_serving_open: true,
      currency: 'INR',
    },
    'id',
  );

  await makeUser(db, { mobile: m(0), name: 'Test Admin', role: 'admin' });

  const repMulti = await makeUser(db, { mobile: m(9), name: 'Test Rep Multi', role: 'tower_rep', towerId: towerA });
  const repB = await makeUser(db, { mobile: m(19), name: 'Test Rep B', role: 'tower_rep', towerId: towerB });
  const repC = await makeUser(db, { mobile: m(29), name: 'Test Rep C', role: 'tower_rep', towerId: towerC });
  // repMulti manages BOTH tower A (residence) and tower D (non-residence) —
  // is_rep_of(towerD) is true even though app_tower_id() (residence) is A.
  await db.from('towers').update({ rep_user_id: repMulti }).eq('id', towerA);
  await db.from('towers').update({ rep_user_id: repMulti }).eq('id', towerD);
  await db.from('towers').update({ rep_user_id: repB }).eq('id', towerB);
  await db.from('towers').update({ rep_user_id: repC }).eq('id', towerC);

  const flats: Record<string, string> = {};
  for (const n of [101, 102, 103, 104, 105]) {
    flats[n] = (await ins(db, 'flats', { tower_id: towerA, flat_number: String(n) })).id;
  }
  flats['201'] = (await ins(db, 'flats', { tower_id: towerB, flat_number: '201' })).id;
  flats['401'] = (await ins(db, 'flats', { tower_id: towerD, flat_number: '401' })).id;
  flats['402'] = (await ins(db, 'flats', { tower_id: towerD, flat_number: '402' })).id;

  const residentA: Record<number, string> = {};
  for (let i = 1; i <= 5; i++) {
    residentA[i] = await makeUser(db, {
      mobile: m(i),
      name: `Test Resident A${i}`,
      role: 'resident',
      towerId: towerA,
      flatId: flats[100 + i],
    });
  }
  const residentB = await makeUser(db, {
    mobile: m(11), name: 'Test Resident B1', role: 'resident', towerId: towerB, flatId: flats['201'],
  });
  const residentD = await makeUser(db, {
    mobile: m(31), name: 'Test Resident D1', role: 'resident', towerId: towerD, flatId: flats['401'],
  });
  await makeUser(db, {
    mobile: m(50), name: 'Test Sadya Rep', role: 'resident', towerId: towerD, flatId: flats['402'],
  });
  await db.from('profiles').update({ is_sadya_rep: true }).eq('mobile', m(50));

  const base = (flatId: string, residentId: string, status: string, extra: Record<string, unknown> = {}) => ({
    event_id: event.id,
    flat_id: flatId,
    initiated_by_user_id: residentId,
    amount: SENT.minContribution,
    min_snapshot: SENT.minContribution,
    paid_to_tower_id: towerA,
    status,
    ...extra,
  });

  const pending = await ins(db, 'contributions', base(flats[101], residentA[1], 'payment_pending'));
  const submitted = await ins(db, 'contributions', base(flats[102], residentA[2], 'submitted', {
    amount_paid: SENT.minContribution, utr: 'TEST0002', payment_submitted_at: NOW(), paid_to_rep_user_id: repMulti,
  }));
  const verified = await ins(db, 'contributions', base(flats[103], residentA[3], 'verified', {
    amount_paid: SENT.minContribution, utr: 'TEST0003', payment_submitted_at: NOW(),
    paid_to_rep_user_id: repMulti, verified_by_user_id: repMulti, verified_at: NOW(),
  }));
  const rejected = await ins(db, 'contributions', base(flats[104], residentA[4], 'rejected', {
    amount_paid: 500, utr: 'TEST0004', payment_submitted_at: NOW(),
    paid_to_rep_user_id: repMulti, verified_by_user_id: repMulti, verified_at: NOW(),
    decision_reason: 'Seed: amount did not match',
  }));
  const refundRequested = await ins(db, 'contributions', base(flats[105], residentA[5], 'verified', {
    amount_paid: SENT.minContribution, utr: 'TEST0005', payment_submitted_at: NOW(),
    paid_to_rep_user_id: repMulti, verified_by_user_id: repMulti, verified_at: NOW(),
    refund_state: 'requested', refund_requested_at: NOW(), refund_reason: 'Seed: overpayment',
  }));
  const crossTowerB = await ins(db, 'contributions', {
    event_id: event.id, flat_id: flats['201'], initiated_by_user_id: residentB,
    amount: SENT.minContribution, min_snapshot: SENT.minContribution, paid_to_tower_id: towerB,
    status: 'submitted', amount_paid: SENT.minContribution, utr: 'TEST0021',
    payment_submitted_at: NOW(), paid_to_rep_user_id: repB,
  });

  const sadyaBooking = await ins(db, 'sadya_bookings', {
    event_id: event.id,
    resident_id: residentD,
    flat_id: flats['401'],
    num_adults: 2,
    num_children: 1,
    adult_price_snapshot: SENT.adultPrice,
    child_price_snapshot: SENT.childPrice,
    total_amount: 2 * SENT.adultPrice + 1 * SENT.childPrice,
    paid_to_tower_id: towerD,
    status: 'submitted',
    amount_paid: 2 * SENT.adultPrice + 1 * SENT.childPrice,
    utr: 'TEST0031',
    payment_submitted_at: NOW(),
    paid_to_rep_user_id: repMulti,
  });

  return {
    towers: { a: towerA, b: towerB, c: towerC, d: towerD },
    event: { id: event.id, makeActive },
    flats,
    users: {
      adminMobile: m(0),
      repMultiMobile: m(9),
      repBMobile: m(19),
      repCMobile: m(29),
      sadyaRepMobile: m(50),
      residentA: { 1: m(1), 2: m(2), 3: m(3), 4: m(4), 5: m(5) },
      residentBMobile: m(11),
      residentDMobile: m(31),
    },
    contributionIds: {
      pending: pending.id, submitted: submitted.id, verified: verified.id,
      rejected: rejected.id, refundRequested: refundRequested.id, crossTowerB: crossTowerB.id,
    },
    sadyaBookingId: sadyaBooking.id,
  };
}

export async function teardownWorld(db: SupabaseClient) {
  return cleanupTestData(db);
}
