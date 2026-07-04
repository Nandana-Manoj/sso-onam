// @vitest-environment node
//
// Admin critical path from Phase 4 of the release audit: event configuration,
// tower/rep management, and the admin/sadya-rep grant lifecycle — including
// the guardrails (can't demote the last admin, can't make an admin a rep).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, signInAs } from '../fixtures/testEnv';
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

describe('event configuration', () => {
  it('an admin can update event config (min contribution, prices)', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data, error } = await admin.rpc('update_event_config', {
      p_event_id: world.event.id,
      p_name: 'Integration Test Event (renamed)',
      p_min_contribution: 1500,
      p_adult_price: 350,
      p_child_price: 175,
      p_booking_freeze_at: null,
      p_verification_cutoff_at: null,
    });
    expect(error).toBeNull();
    expect((data as { min_contribution: number }).min_contribution).toBe(1500);
  });

  it('a tower_rep cannot update event config', async () => {
    const rep = await signInAs(world.users.repMultiMobile);
    const { error } = await rep.rpc('update_event_config', {
      p_event_id: world.event.id,
      p_name: 'Hijacked',
      p_min_contribution: 1,
      p_adult_price: 1,
      p_child_price: 1,
      p_booking_freeze_at: null,
      p_verification_cutoff_at: null,
    });
    expect(error).not.toBeNull();
  });

  it('a resident cannot create a tower', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { error } = await resident.from('towers').insert({ name: 'Rogue Tower', code: 'ROGUE' });
    expect(error).not.toBeNull();
  });

  it('an admin can create a tower', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { error } = await admin.from('towers').insert({ name: 'Admin-created Test Tower', code: 'TTX-ITEST' });
    expect(error).toBeNull();
    await db.from('towers').delete().eq('code', 'TTX-ITEST'); // not a sentinel code — clean up explicitly
  });
});

describe('rep assignment', () => {
  it('an admin can assign a resident as rep of an unmanaged tower', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data: residentRow } = await db.from('profiles').select('id').eq('mobile', world.users.residentA[4]).single();
    const { error } = await admin.rpc('assign_tower_rep', {
      p_user_id: (residentRow as { id: string }).id,
      p_tower_id: world.towers.c,
    });
    expect(error).toBeNull();
    const { data: after } = await db.from('profiles').select('role').eq('mobile', world.users.residentA[4]).single();
    expect((after as { role: string }).role).toBe('tower_rep');
  });

  it('assigning a tower to an existing admin is refused (an admin cannot also be a rep)', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data: adminRow } = await db.from('profiles').select('id').eq('mobile', world.users.adminMobile).single();
    const { error } = await admin.rpc('assign_tower_rep', {
      p_user_id: (adminRow as { id: string }).id,
      p_tower_id: world.towers.b,
    });
    expect(error).not.toBeNull();
  });

  it('a tower_rep cannot remove another tower\'s rep', async () => {
    const repB = await signInAs(world.users.repBMobile);
    const { error } = await repB.rpc('remove_tower_rep', { p_tower_id: world.towers.c });
    expect(error).not.toBeNull();
  });
});

describe('admin grant/revoke lifecycle', () => {
  it('an admin cannot revoke the last remaining admin (even themselves)', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data: me } = await admin.auth.getUser();
    const { error } = await admin.rpc('revoke_admin', { p_user_id: me.user!.id });
    expect(error).not.toBeNull();
  });

  it('an admin can grant admin to a resident, and that new admin can then act as one', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data: residentRow } = await db.from('profiles').select('id').eq('mobile', world.users.residentA[3]).single();
    const { error } = await admin.rpc('grant_admin', { p_user_id: (residentRow as { id: string }).id });
    expect(error).toBeNull();

    const newAdmin = await signInAs(world.users.residentA[3]);
    const { data, error: readErr } = await newAdmin.from('audit_log').select('id').limit(1);
    expect(readErr).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('a non-admin cannot revoke another admin', async () => {
    const rep = await signInAs(world.users.repMultiMobile);
    const { data: adminRow } = await db.from('profiles').select('id').eq('mobile', world.users.adminMobile).single();
    const { error } = await rep.rpc('revoke_admin', { p_user_id: (adminRow as { id: string }).id });
    expect(error).not.toBeNull();
  });
});

describe('sadya rep grant/revoke', () => {
  it('an admin can grant is_sadya_rep to a resident without changing their role', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data: residentRow } = await db.from('profiles').select('id').eq('mobile', world.users.residentA[2]).single();
    const { error } = await admin.rpc('grant_sadya_rep', { p_user_id: (residentRow as { id: string }).id });
    expect(error).toBeNull();

    const { data: after } = await db.from('profiles').select('role, is_sadya_rep').eq('mobile', world.users.residentA[2]).single();
    expect((after as { role: string }).role).toBe('resident');
    expect((after as { is_sadya_rep: boolean }).is_sadya_rep).toBe(true);
  });

  it('a resident cannot grant themselves sadya-rep status', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { data: me } = await resident.auth.getUser();
    const { error } = await resident.rpc('grant_sadya_rep', { p_user_id: me.user!.id });
    expect(error).not.toBeNull();
  });

  it('revoking sadya-rep status removes scanning access', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data: residentRow } = await db.from('profiles').select('id').eq('mobile', world.users.sadyaRepMobile).single();
    const { error } = await admin.rpc('revoke_sadya_rep', { p_user_id: (residentRow as { id: string }).id });
    expect(error).toBeNull();

    const revoked = await signInAs(world.users.sadyaRepMobile);
    const { error: lookupErr } = await revoked.rpc('lookup_sadya_pass', { p_nonce: 'irrelevant' });
    expect(lookupErr).not.toBeNull();
  });
});
