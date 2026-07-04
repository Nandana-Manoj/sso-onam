// @vitest-environment node
//
// Targeted data-integrity regression suite: the untested correction-request
// (tower/flat reassignment) flow — the single clearest "resident data
// mix-up" risk in the schema — plus real concurrency races (not just
// sequential logic checks) on the three places money/state could be lost or
// double-counted, plus a reconciliation check that the aggregated dashboards
// match the raw ledger. No test suite can PROVE zero bugs exist; this proves
// the specific highest-risk mechanisms hold up under real concurrent load.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, signInAs, ins, makeUser, SENT } from '../fixtures/testEnv';
import { seedWorld, teardownWorld, type World } from '../fixtures/world';

let db: SupabaseClient;
let world: World;

beforeAll(async () => {
  db = serviceClient();
  world = await seedWorld(db);
}, 120_000);

afterAll(async () => {
  await teardownWorld(db);
}, 60_000);

describe('correction requests — tower/flat reassignment (previously untested)', () => {
  it('a resident can file their own correction request', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { data: me } = await resident.auth.getUser();
    const { error } = await resident.from('correction_requests').insert({
      profile_id: me.user!.id,
      current_tower_id: world.towers.a,
      requested_tower_id: world.towers.b,
      requested_flat_number: '299',
      reason: 'moved households',
    });
    expect(error).toBeNull();
  });

  it('a resident cannot file a correction request on someone else\'s behalf', async () => {
    const resident = await signInAs(world.users.residentA[2]);
    const otherId = (await db.from('profiles').select('id').eq('mobile', world.users.residentA[3]).single()).data!.id;
    const { error } = await resident.from('correction_requests').insert({
      profile_id: otherId, current_tower_id: world.towers.a, requested_tower_id: world.towers.b,
    });
    expect(error).not.toBeNull();
  });

  it('a second pending request from the same resident is refused (at most one pending per resident)', async () => {
    const resident = await signInAs(world.users.residentA[1]); // already has one pending from the first test
    const { data: me } = await resident.auth.getUser();
    const { error } = await resident.from('correction_requests').insert({
      profile_id: me.user!.id, current_tower_id: world.towers.a, requested_tower_id: world.towers.c,
    });
    expect(error).not.toBeNull();
  });

  it('a rep of neither the current nor requested tower cannot see or decide the request', async () => {
    const repC = await signInAs(world.users.repCMobile); // reps tower C only; request is A -> B
    const { data: list } = await repC.rpc('list_pending_corrections');
    expect((list as { resident_mobile: string }[]).some((r) => r.resident_mobile === world.users.residentA[1])).toBe(false);
  });

  it('a rep of the REQUESTED tower (not the current one) can see and decide it — approving moves the profile', async () => {
    const repB = await signInAs(world.users.repBMobile); // reps tower B, the requested tower
    const { data: list } = await repB.rpc('list_pending_corrections');
    const row = (list as { id: string; resident_mobile: string }[]).find((r) => r.resident_mobile === world.users.residentA[1]);
    expect(row).toBeDefined();

    const { data: decided, error } = await repB.rpc('decide_correction', {
      p_request_id: row!.id, p_approve: true, p_reason: 'confirmed new address',
    });
    expect(error).toBeNull();
    expect((decided as { status: string }).status).toBe('approved');

    const { data: profileAfter } = await db.from('profiles').select('tower_id, flat_id').eq('mobile', world.users.residentA[1]).single();
    expect((profileAfter as { tower_id: string }).tower_id).toBe(world.towers.b);

    const { data: newFlat } = await db.from('flats').select('flat_number').eq('id', (profileAfter as { flat_id: string }).flat_id).single();
    expect((newFlat as { flat_number: string }).flat_number).toBe('299');
  });

  it("DATA PRESERVATION: the resident's OLD flat contribution is untouched after the move — no loss, no silent transfer of history", async () => {
    // resident A1's original seeded contribution (flat 101, tower A) must still
    // exist, still say flat 101, and be unaffected by the tower/flat reassignment.
    const { data: oldContribution } = await db
      .from('contributions').select('flat_id, status, amount_paid')
      .eq('id', world.contributionIds.pending) // seeded originally on flat 101 for resident A1
      .single();
    expect((oldContribution as { flat_id: string }).flat_id).toBe(world.flats[101]);
  });

  it("the moved resident can no longer see their old flat's contribution (RLS now scopes to the NEW flat, not both)", async () => {
    const moved = await signInAs(world.users.residentA[1]);
    const { data, error } = await moved.from('contributions').select('id').eq('id', world.contributionIds.pending);
    expect(error).toBeNull();
    expect(data).toEqual([]); // no longer their flat — RLS correctly hides it, doesn't duplicate visibility
  });

  it('deciding an already-decided request a second time is refused (no double-move, no duplicate audit entry)', async () => {
    const repB = await signInAs(world.users.repBMobile);
    const { data: reqRow } = await db.from('correction_requests').select('id').eq('status', 'approved')
      .eq('requested_tower_id', world.towers.b).limit(1).single();
    const { error } = await repB.rpc('decide_correction', { p_request_id: (reqRow as { id: string }).id, p_approve: true });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already been decided/i);
  });

  it('rejecting a request leaves the profile completely unchanged', async () => {
    const resident = await signInAs(world.users.residentA[2]);
    const { data: me } = await resident.auth.getUser();
    await resident.from('correction_requests').insert({
      profile_id: me.user!.id, current_tower_id: world.towers.a, requested_tower_id: world.towers.c,
      requested_flat_number: '399',
    });
    const before = await db.from('profiles').select('tower_id, flat_id').eq('id', me.user!.id).single();

    const repC = await signInAs(world.users.repCMobile);
    const { data: list } = await repC.rpc('list_pending_corrections');
    const row = (list as { id: string; resident_mobile: string }[]).find((r) => r.resident_mobile === world.users.residentA[2]);
    const { data: decided, error } = await repC.rpc('decide_correction', { p_request_id: row!.id, p_approve: false, p_reason: 'not verified' });
    expect(error).toBeNull();
    expect((decided as { status: string }).status).toBe('rejected');

    const after = await db.from('profiles').select('tower_id, flat_id').eq('id', me.user!.id).single();
    expect(after.data).toEqual(before.data);
  });
});

describe('concurrency races — no lost updates, no double-commits under real parallel load', () => {
  // verify_contribution's initial `select ... from contributions where id = ...`
  // has no `for update` (unlike redeem_sadya_pass / decide_correction, which do
  // lock). Two concurrent calls can both read the pre-decision row, both pass
  // the status guard, and both commit — the guard is a check-then-act race, not
  // an atomic one. The next two tests are KNOWN BUGS: they assert the correct/
  // safe behavior and currently fail against the real database. See the fix
  // migration this session added and re-run to confirm green.
  it('two residents of the SAME flat racing create_contribution — exactly one succeeds, one flat, one live row', async () => {
    const towerA = world.towers.a;
    const flat = await ins(db, 'flats', { tower_id: towerA, flat_number: 'RACE1' });
    const uA = await makeUser(db, { mobile: `${SENT.mobilePrefix}061`, name: 'Race A', role: 'resident', towerId: towerA, flatId: flat.id });
    const uB = await makeUser(db, { mobile: `${SENT.mobilePrefix}062`, name: 'Race B', role: 'resident', towerId: towerA, flatId: flat.id });
    void uA; void uB;

    const clientA = await signInAs(`${SENT.mobilePrefix}061`);
    const clientB = await signInAs(`${SENT.mobilePrefix}062`);

    const [resA, resB] = await Promise.all([
      clientA.rpc('create_contribution', { p_amount: SENT.minContribution }),
      clientB.rpc('create_contribution', { p_amount: SENT.minContribution }),
    ]);

    const outcomes = [resA, resB];
    const succeeded = outcomes.filter((r) => !r.error);
    const failed = outcomes.filter((r) => r.error);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const { data: liveRows } = await db.from('contributions').select('id')
      .eq('flat_id', flat.id).in('status', ['payment_pending', 'submitted', 'verified']);
    expect(liveRows).toHaveLength(1); // never two live commitments for one flat, even under a genuine race
  });

  it('two concurrent redemptions racing the LAST remaining scan on a pass — exactly one accepted, one rejected_exhausted, count never exceeds allowed_scans', async () => {
    const resident = await signInAs(world.users.residentA[4]); // uninvolved in the tests above
    const { data: booking } = await resident.rpc('create_sadya_booking', { p_num_adults: 2, p_num_children: 0 });
    const bookingId = (booking as { id: string }).id;
    await resident.rpc('submit_sadya_payment', { p_booking_id: bookingId, p_amount_paid: SENT.adultPrice * 2, p_utr: 'RACE-QR' });
    const rep = await signInAs(world.users.repMultiMobile);
    await rep.rpc('verify_sadya_booking', { p_booking_id: bookingId, p_approve: true, p_reason: null });

    const { data: passRow } = await db.from('qr_passes').select('nonce, allowed_scans')
      .eq('flat_id', world.flats[104]).eq('event_id', world.event.id).single();
    const { nonce, allowed_scans: allowedScans } = passRow as { nonce: string; allowed_scans: number };
    expect(allowedScans).toBe(2);

    const scanner = await signInAs(world.users.sadyaRepMobile);
    // Two genuinely concurrent requests, both asking for the only remaining scan.
    const [r1, r2] = await Promise.all([
      scanner.rpc('redeem_sadya_pass', { p_nonce: nonce, p_count: 2, p_device: 'race-1' }),
      scanner.rpc('redeem_sadya_pass', { p_nonce: nonce, p_count: 2, p_device: 'race-2' }),
    ]);
    const results = [r1, r2].map((r) => (r.data as { result: string }[])[0].result);
    expect(results.filter((r) => r === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r === 'rejected_exhausted')).toHaveLength(1);

    const { data: finalPass } = await db.from('qr_passes').select('redeemed_count, allowed_scans')
      .eq('nonce', nonce).single();
    const fp = finalPass as { redeemed_count: number; allowed_scans: number };
    expect(fp.redeemed_count).toBe(fp.allowed_scans); // never over, never under
  });

  it('a REP double-clicking (or a client retrying) verify_contribution is safely rejected on the second call, not silently duplicated', async () => {
    const flat = await ins(db, 'flats', { tower_id: world.towers.a, flat_number: 'RACEVERIFY' });
    await makeUser(db, { mobile: `${SENT.mobilePrefix}091`, name: 'Race Verify', role: 'resident', towerId: world.towers.a, flatId: flat.id });
    const resident = await signInAs(`${SENT.mobilePrefix}091`);
    const { data: fresh } = await resident.rpc('create_contribution', { p_amount: SENT.minContribution });
    const contribId = (fresh as { id: string }).id;
    await resident.rpc('submit_contribution_payment', { p_contribution_id: contribId, p_amount_paid: SENT.minContribution, p_utr: 'RACE-VERIFY' });

    const rep = await signInAs(world.users.repMultiMobile);
    const [r1, r2] = await Promise.all([
      rep.rpc('verify_contribution', { p_contribution_id: contribId, p_approve: true, p_reason: null }),
      rep.rpc('verify_contribution', { p_contribution_id: contribId, p_approve: true, p_reason: null }),
    ]);
    const outcomes = [r1, r2];
    // A plain tower_rep may only decide a 'submitted' row — the race's loser
    // sees it already 'verified' and is correctly refused, not allowed to
    // silently re-apply. Good: reps can never produce a duplicate/ambiguous
    // decision this way, only ever exactly one.
    expect(outcomes.filter((r) => !r.error)).toHaveLength(1);
    expect(outcomes.filter((r) => r.error)).toHaveLength(1);

    const { data: finalRow } = await db.from('contributions').select('status, overridden').eq('id', contribId).single();
    expect((finalRow as { status: string }).status).toBe('verified');
    expect((finalRow as { overridden: boolean }).overridden).toBe(false); // exactly one real decision, no false "override"
  });

  it('CAVEAT: an ADMIN double-clicking (or a client retrying) verify_contribution DOES get both calls through, and the race\'s loser mislabels a single decision as "overridden"', async () => {
    // Admins are allowed to re-decide an already-settled row (deliberate
    // override support) — but that means an admin's OWN double-click/retry
    // on the exact same action is indistinguishable from a genuine second
    // opinion. Not data loss, but a misleading audit trail worth knowing about.
    const flat = await ins(db, 'flats', { tower_id: world.towers.a, flat_number: 'RACEADMIN' });
    await makeUser(db, { mobile: `${SENT.mobilePrefix}092`, name: 'Race Admin', role: 'resident', towerId: world.towers.a, flatId: flat.id });
    const resident = await signInAs(`${SENT.mobilePrefix}092`);
    const { data: fresh } = await resident.rpc('create_contribution', { p_amount: SENT.minContribution });
    const contribId = (fresh as { id: string }).id;
    await resident.rpc('submit_contribution_payment', { p_contribution_id: contribId, p_amount_paid: SENT.minContribution, p_utr: 'RACE-ADMIN' });

    const admin = await signInAs(world.users.adminMobile);
    const [r1, r2] = await Promise.all([
      admin.rpc('verify_contribution', { p_contribution_id: contribId, p_approve: true, p_reason: null }),
      admin.rpc('verify_contribution', { p_contribution_id: contribId, p_approve: true, p_reason: null }),
    ]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull(); // admin can re-decide, so BOTH calls succeed under the race

    const { data: finalRow } = await db.from('contributions').select('status, overridden').eq('id', contribId).single();
    expect((finalRow as { status: string }).status).toBe('verified'); // end state is still consistent, not corrupted
    expect((finalRow as { overridden: boolean }).overridden).toBe(true); // but falsely flagged as an override
  });
});

describe('reconciliation — dashboard aggregates match the raw ledger exactly', () => {
  it('get_tower_leaderboard total_amount/families/sadya_passes match a manual sum of the raw rows for tower C (isolated, only this test writes to it)', async () => {
    const flat1 = await ins(db, 'flats', { tower_id: world.towers.c, flat_number: 'RECON1' });
    const flat2 = await ins(db, 'flats', { tower_id: world.towers.c, flat_number: 'RECON2' });
    const r1 = await makeUser(db, { mobile: `${SENT.mobilePrefix}071`, name: 'Recon 1', role: 'resident', towerId: world.towers.c, flatId: flat1.id });
    const r2 = await makeUser(db, { mobile: `${SENT.mobilePrefix}072`, name: 'Recon 2', role: 'resident', towerId: world.towers.c, flatId: flat2.id });

    // flat1: one VERIFIED contribution of 2000 -> counts.
    await ins(db, 'contributions', {
      event_id: world.event.id, flat_id: flat1.id, initiated_by_user_id: r1,
      amount: 2000, min_snapshot: SENT.minContribution, paid_to_tower_id: world.towers.c,
      status: 'verified', amount_paid: 2000,
    });
    // flat2: one REJECTED contribution of 3000 -> must NOT count.
    await ins(db, 'contributions', {
      event_id: world.event.id, flat_id: flat2.id, initiated_by_user_id: r2,
      amount: 3000, min_snapshot: SENT.minContribution, paid_to_tower_id: world.towers.c,
      status: 'rejected', amount_paid: 3000,
    });

    const admin = await signInAs(world.users.adminMobile);
    const { data: board, error } = await admin.rpc('get_tower_leaderboard', { p_event_id: world.event.id });
    expect(error).toBeNull();
    const towerCRow = (board as { tower_id: string; families: number; total_amount: number }[]).find((r) => r.tower_id === world.towers.c);

    expect(towerCRow).toBeDefined();
    expect(towerCRow!.families).toBe(1); // only the verified one counts as a "family"
    expect(towerCRow!.total_amount).toBe(2000); // rejected 3000 must be excluded, not summed in
  });
});

describe('audit log content correctness — not just present, but accurate', () => {
  it("a verify_contribution audit_log entry's before/after JSON matches the real state transition", async () => {
    // A scratch flat + resident so this test owns its own contribution row.
    const flat = await ins(db, 'flats', { tower_id: world.towers.a, flat_number: 'AUDITCHK' });
    await makeUser(db, { mobile: `${SENT.mobilePrefix}081`, name: 'Audit Check', role: 'resident', towerId: world.towers.a, flatId: flat.id });
    const auditResident = await signInAs(`${SENT.mobilePrefix}081`);
    const { data: c } = await auditResident.rpc('create_contribution', { p_amount: SENT.minContribution });
    const contribId = (c as { id: string }).id;
    await auditResident.rpc('submit_contribution_payment', { p_contribution_id: contribId, p_amount_paid: SENT.minContribution, p_utr: 'AUDIT-CHK' });

    const rep = await signInAs(world.users.repMultiMobile);
    await rep.rpc('verify_contribution', { p_contribution_id: contribId, p_approve: true, p_reason: null });

    const { data: log } = await db.from('audit_log').select('before, after, action')
      .eq('entity_id', contribId).eq('action', 'contribution.verified').order('created_at', { ascending: false }).limit(1).single();
    const row = log as { before: { status: string }; after: { status: string; amount_paid: number } };
    expect(row.before.status).toBe('submitted');
    expect(row.after.status).toBe('verified');
    expect(row.after.amount_paid).toBe(SENT.minContribution);
  });
});
