// @vitest-environment node
//
// Security/RLS regression suite — runs against a REAL Supabase project
// (staging by default; see npm run test:integration / :prod). Every
// assertion here is a real network round-trip through RLS + SECURITY
// DEFINER RPCs signed in as a real seeded user, not a mock. This is the
// authoritative check for tower isolation, cross-role denial, and
// privilege-escalation attempts (Phase 5 of the release audit).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, signInAs, anonClient, SENT, ins, NOW } from '../fixtures/testEnv';
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

async function freshContribution(status: 'submitted' | 'verified', flatId: string, residentId: string, towerId: string) {
  return ins(db, 'contributions', {
    event_id: world.event.id,
    flat_id: flatId,
    initiated_by_user_id: residentId,
    amount: SENT.minContribution,
    min_snapshot: SENT.minContribution,
    paid_to_tower_id: towerId,
    status,
    amount_paid: SENT.minContribution,
    utr: `TEST-FRESH-${Date.now()}`,
    payment_submitted_at: NOW(),
  });
}

async function profileIdFor(mobile: string): Promise<string> {
  const { data } = await db.from('profiles').select('id').eq('mobile', mobile).single();
  return (data as { id: string }).id;
}

async function freshSadyaBooking(status: 'submitted', flatId: string, residentId: string, towerId: string) {
  return ins(db, 'sadya_bookings', {
    event_id: world.event.id,
    resident_id: residentId,
    flat_id: flatId,
    num_adults: 1,
    num_children: 0,
    adult_price_snapshot: SENT.adultPrice,
    child_price_snapshot: SENT.childPrice,
    total_amount: SENT.adultPrice,
    paid_to_tower_id: towerId,
    status,
    amount_paid: SENT.adultPrice,
    utr: `TEST-SADYA-${Date.now()}`,
    payment_submitted_at: NOW(),
  });
}

describe('unauthenticated access', () => {
  it('anon (no session) cannot read contributions at all', async () => {
    const anon = anonClient();
    const { data, error } = await anon.from('contributions').select('id');
    // Default-deny RLS with no matching policy for anon → empty result, not an error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon cannot call an authenticated-only RPC', async () => {
    const anon = anonClient();
    const { error } = await anon.rpc('create_contribution', { p_amount: SENT.minContribution });
    expect(error).not.toBeNull();
  });

  it('anon can read the public towers list (intentionally public)', async () => {
    const anon = anonClient();
    const { data, error } = await anon.from('public_towers').select('id');
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('tower isolation — contributions', () => {
  it('a rep CAN verify a payment submitted to their own tower', async () => {
    const rep = await signInAs(world.users.repMultiMobile);
    // Flat 104's seeded contribution is 'rejected' (terminal) — free for a fresh live row.
    // Flats 101/102/103/105 already carry a LIVE seeded contribution (once-per-flat).
    const residentId = await profileIdFor(world.users.residentA[4]);
    const fresh = await freshContribution('submitted', world.flats[104], residentId, world.towers.a);
    const { data, error } = await rep.rpc('verify_contribution', {
      p_contribution_id: fresh.id, p_approve: true, p_reason: null,
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('verified');
  });

  it('a rep CANNOT verify a payment submitted to a different tower (cross-tower denial)', async () => {
    const repB = await signInAs(world.users.repBMobile);
    const { error } = await repB.rpc('verify_contribution', {
      p_contribution_id: world.contributionIds.verified, // tower A, not repB's tower
      p_approve: true, p_reason: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not authorized/i);
  });

  it('a resident CANNOT see another flat\'s contribution', async () => {
    const resident2 = await signInAs(world.users.residentA[2]);
    const { data, error } = await resident2
      .from('contributions')
      .select('id')
      .eq('id', world.contributionIds.verified); // belongs to flat 103 (resident A3)
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('a resident CAN see their own flat\'s contribution', async () => {
    const resident3 = await signInAs(world.users.residentA[3]);
    const { data, error } = await resident3
      .from('contributions')
      .select('id')
      .eq('id', world.contributionIds.verified);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('a rep of tower A cannot see tower B\'s submitted contribution', async () => {
    const repMulti = await signInAs(world.users.repMultiMobile);
    const { data, error } = await repMulti
      .from('contributions')
      .select('id')
      .eq('id', world.contributionIds.crossTowerB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('privilege escalation attempts', () => {
  it('a resident cannot grant themselves admin', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { data: me } = await resident.auth.getUser();
    const { error } = await resident.rpc('grant_admin', { p_user_id: me.user!.id });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/admin only/i);
  });

  it('a resident cannot directly UPDATE their own role via the profiles table', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { data: me } = await resident.auth.getUser();
    const { error } = await resident.from('profiles').update({ role: 'admin' }).eq('id', me.user!.id);
    // RLS profiles_update WITH CHECK allows the row (self-update) but the
    // identity-guard trigger blocks a role change outright.
    expect(error).not.toBeNull();
  });

  it('a tower_rep cannot grant admin to themselves or anyone else', async () => {
    const rep = await signInAs(world.users.repBMobile);
    const { data: me } = await rep.auth.getUser();
    const { error } = await rep.rpc('grant_admin', { p_user_id: me.user!.id });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/admin only/i);
  });

  it('a tower_rep cannot assign themselves as rep of a tower they do not manage', async () => {
    const repB = await signInAs(world.users.repBMobile);
    const { data: me } = await repB.auth.getUser();
    const { error } = await repB.rpc('assign_tower_rep', { p_user_id: me.user!.id, p_tower_id: world.towers.c });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/admin only/i);
  });

  it('a resident cannot call verify_contribution even on their own contribution', async () => {
    const resident = await signInAs(world.users.residentA[2]);
    const { error } = await resident.rpc('verify_contribution', {
      p_contribution_id: world.contributionIds.pending, p_approve: true, p_reason: null,
    });
    expect(error).not.toBeNull();
  });

  it('a resident cannot directly INSERT a contribution row (must go through create_contribution)', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { error } = await resident.from('contributions').insert({
      event_id: world.event.id,
      flat_id: world.flats[101],
      amount: 1,
      min_snapshot: 1,
      paid_to_tower_id: world.towers.a,
      status: 'verified', // attempting to self-verify by direct insert
    });
    expect(error).not.toBeNull();
  });

  it('nobody can DELETE a contribution row directly (append-only, status transitions only)', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { error, count } = await admin
      .from('contributions')
      .delete({ count: 'exact' })
      .eq('id', world.contributionIds.rejected);
    // Either RLS denies it (error) or the delete silently matches zero rows.
    expect(error !== null || count === 0).toBe(true);
    const { data: stillThere } = await db.from('contributions').select('id').eq('id', world.contributionIds.rejected);
    expect(stillThere).toHaveLength(1);
  });
});

describe('audit_log is admin-only', () => {
  it('a resident cannot read the audit log', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { data, error } = await resident.from('audit_log').select('id').limit(1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('an admin can read the audit log', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data, error } = await admin.from('audit_log').select('id').limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('suggestions box — write-only, not even readable by other admins', () => {
  it('a tower_rep can submit a suggestion', async () => {
    const rep = await signInAs(world.users.repCMobile);
    const { error } = await rep.from('suggestions').insert({ message: 'Test suggestion from repC' });
    expect(error).toBeNull();
  });

  it('a resident cannot submit a suggestion', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { error } = await resident.from('suggestions').insert({ message: 'Residents should not be able to send this' });
    expect(error).not.toBeNull();
  });

  it('nobody — not even an admin — can read suggestions back through the API (service-role/dashboard only)', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data, error } = await admin.from('suggestions').select('id').limit(1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a client cannot override submitted_by_user_id / role on insert", async () => {
    const rep = await signInAs(world.users.repCMobile);
    const { data: me } = await rep.auth.getUser();
    const { error } = await rep.from('suggestions').insert({
      message: 'spoofed identity attempt',
      submitted_by_user_id: '00000000-0000-0000-0000-000000000000',
      role: 'admin',
    });
    // WITH CHECK pins these to server-derived values — an explicit mismatching
    // value must be rejected, not silently overwritten.
    expect(error).not.toBeNull();
    void me;
  });
});

describe('KNOWN BUG: multi-tower rep denied on non-residence-tower actions', () => {
  // repMulti's residence (profiles.tower_id) is Tower A, but they are also the
  // assigned rep of Tower D (towers.rep_user_id). record_offline_sadya() checks
  // p_tower_id = app_tower_id() (residence) instead of is_rep_of(p_tower_id) —
  // so this call wrongly fails today. Fixed by the migration in this same PR;
  // this test should flip from failing to passing once that migration is applied.
  it('repMulti CAN record an offline/walk-in sadya booking for tower D (their non-residence rep tower)', async () => {
    const repMulti = await signInAs(world.users.repMultiMobile);
    const { error } = await repMulti.rpc('record_offline_sadya', {
      p_tower_id: world.towers.d,
      p_flat_number: '499',
      p_num_adults: 1,
      p_num_children: 0,
      p_utr: 'TEST-WALKIN-D',
      p_note: 'integration test',
    });
    expect(error).toBeNull();
  });

  it('repMulti CAN see sadya_cancellations for tower D (their non-residence rep tower)', async () => {
    const sadyaRepUserId = (await db.from('profiles').select('id').eq('mobile', world.users.sadyaRepMobile).single()).data!.id as string;
    const towerDBooking = await freshSadyaBooking('submitted', world.flats['402'], sadyaRepUserId, world.towers.d);
    const { error: cancelErr } = await db.from('sadya_cancellations').insert({
      event_id: world.event.id,
      resident_id: (await db.from('sadya_bookings').select('resident_id').eq('id', towerDBooking.id).single()).data!.resident_id,
      flat_id: world.flats['402'],
      num_adults: 1,
      num_children: 0,
      paid_to_tower_id: world.towers.d,
      status: 'requested',
      reason: 'integration test',
    });
    expect(cancelErr).toBeNull();

    const repMulti = await signInAs(world.users.repMultiMobile);
    const { data, error } = await repMulti
      .from('sadya_cancellations')
      .select('id')
      .eq('flat_id', world.flats['402']);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
