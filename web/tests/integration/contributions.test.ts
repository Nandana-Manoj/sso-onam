// @vitest-environment node
//
// Contribution lifecycle (Resident + Tower Rep critical path from Phase 4 of
// the release audit): create -> submit payment -> verify/reject -> refund.
// Exercises the real RPCs signed in as real seeded users against staging.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, signInAs, SENT } from '../fixtures/testEnv';
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

describe('create_contribution', () => {
  it('rejects an amount below the event minimum', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { error } = await resident.rpc('create_contribution', { p_amount: SENT.minContribution - 1 });
    expect(error).not.toBeNull();
  });

  it('a flat with an existing live contribution cannot start a second one (once-per-flat)', async () => {
    // resident A2's flat already has a 'submitted' contribution from the seed.
    const resident = await signInAs(world.users.residentA[2]);
    const { error } = await resident.rpc('create_contribution', { p_amount: SENT.minContribution });
    expect(error).not.toBeNull();
  });

  it('a flat whose only contribution was rejected CAN start a new one', async () => {
    // resident A4's flat has a terminal 'rejected' row — should be free to retry.
    const resident = await signInAs(world.users.residentA[4]);
    const { data, error } = await resident.rpc('create_contribution', { p_amount: SENT.minContribution });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('payment_pending');
  });
});

describe('submit_contribution_payment', () => {
  it('a resident can submit payment for their own flat\'s pending contribution', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { data, error } = await resident.rpc('submit_contribution_payment', {
      p_contribution_id: world.contributionIds.pending,
      p_amount_paid: SENT.minContribution,
      p_utr: 'TEST-SUBMIT-1',
      p_screenshot_path: null,
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('submitted');
  });

  it('a resident cannot submit payment for a different flat\'s contribution', async () => {
    const otherResident = await signInAs(world.users.residentA[3]);
    const { error } = await otherResident.rpc('submit_contribution_payment', {
      p_contribution_id: world.contributionIds.pending,
      p_amount_paid: SENT.minContribution,
      p_utr: 'TEST-SPOOF',
      p_screenshot_path: null,
    });
    expect(error).not.toBeNull();
  });
});

describe('verify_contribution — reject path', () => {
  it('a rep can reject a submitted contribution with a reason', async () => {
    const rep = await signInAs(world.users.repMultiMobile);
    const { data, error } = await rep.rpc('verify_contribution', {
      p_contribution_id: world.contributionIds.submitted,
      p_approve: false,
      p_reason: 'Integration test rejection',
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('rejected');
    expect((data as { decision_reason: string }).decision_reason).toBe('Integration test rejection');
  });

  it('the resident can see the rejection reason on their own contribution', async () => {
    const resident = await signInAs(world.users.residentA[2]);
    const { data, error } = await resident
      .from('contributions')
      .select('status, decision_reason')
      .eq('id', world.contributionIds.submitted)
      .single();
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('rejected');
  });
});

describe('refund flow — admin only', () => {
  it('the resident whose contribution has a refund requested can see refund_state = requested', async () => {
    const resident = await signInAs(world.users.residentA[5]);
    const { data, error } = await resident
      .from('contributions')
      .select('refund_state')
      .eq('id', world.contributionIds.refundRequested)
      .single();
    expect(error).toBeNull();
    expect((data as { refund_state: string }).refund_state).toBe('requested');
  });

  it('a rep cannot process a refund request — refunds are admin-only', async () => {
    const rep = await signInAs(world.users.repMultiMobile);
    const { error } = await rep.rpc('process_refund', {
      p_contribution_id: world.contributionIds.refundRequested,
      p_approve: true,
      p_reason: 'should not be allowed',
    });
    expect(error).not.toBeNull();
  });

  it('an admin can process (approve) a refund request', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data, error } = await admin.rpc('process_refund', {
      p_contribution_id: world.contributionIds.refundRequested,
      p_approve: true,
      p_reason: 'Integration test refund',
    });
    expect(error).toBeNull();
    expect((data as { refund_state: string }).refund_state).toBe('refunded');
  });

  it('once refunded, the flat is free to start a new contribution again', async () => {
    const resident = await signInAs(world.users.residentA[5]);
    const { data, error } = await resident.rpc('create_contribution', { p_amount: SENT.minContribution });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('payment_pending');
  });

  it('a resident cannot self-refund a verified contribution', async () => {
    const resident = await signInAs(world.users.residentA[3]);
    const { error } = await resident.rpc('admin_refund_contribution', {
      p_contribution_id: world.contributionIds.verified,
      p_reason: 'should not be allowed',
    });
    expect(error).not.toBeNull();
  });

  it('a tower rep cannot refund a contribution either', async () => {
    const rep = await signInAs(world.users.repMultiMobile);
    const { error } = await rep.rpc('admin_refund_contribution', {
      p_contribution_id: world.contributionIds.verified,
      p_reason: 'should not be allowed',
    });
    expect(error).not.toBeNull();
  });

  it('an admin can refund a verified contribution directly, in one step', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data, error } = await admin.rpc('admin_refund_contribution', {
      p_contribution_id: world.contributionIds.verified,
      p_reason: 'Integration test direct refund',
    });
    expect(error).toBeNull();
    expect((data as { refund_state: string }).refund_state).toBe('refunded');
  });
});
