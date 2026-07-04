// @vitest-environment node
//
// Sadya booking + QR issuance + redemption lifecycle (Resident + Tower Rep +
// Sadya Rep critical path from Phase 4 of the release audit): book -> pay ->
// verify (issues a flat QR) -> scan/redeem (partial, then full, then
// over-capacity), plus the offline client_scan_id idempotency guarantee that
// the offline-capable scanner (web/src/lib/scanStore.ts) depends on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { serviceClient, signInAs, SENT } from '../fixtures/testEnv';
import { seedWorld, teardownWorld, type World } from '../fixtures/world';

interface RedeemRow {
  result: string;
  allowed_scans: number;
  redeemed_count: number;
  remaining: number;
}

let db: SupabaseClient;
let world: World;

beforeAll(async () => {
  db = serviceClient();
  world = await seedWorld(db);
}, 120_000);

afterAll(async () => {
  await teardownWorld(db);
}, 60_000);

describe('create_sadya_booking', () => {
  it('rejects zero total persons', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { error } = await resident.rpc('create_sadya_booking', { p_num_adults: 0, p_num_children: 0 });
    expect(error).not.toBeNull();
  });

  it('a resident can book adults + children for the active event', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { data, error } = await resident.rpc('create_sadya_booking', { p_num_adults: 2, p_num_children: 1 });
    expect(error).toBeNull();
    const booking = data as { status: string; total_amount: number };
    expect(booking.status).toBe('payment_pending');
    expect(booking.total_amount).toBe(2 * SENT.adultPrice + 1 * SENT.childPrice);
  });

  it('a second booking for the same resident is allowed (multiple bookings per resident, unlike contributions)', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { error } = await resident.rpc('create_sadya_booking', { p_num_adults: 1, p_num_children: 0 });
    expect(error).toBeNull();
  });
});

describe('verify_sadya_booking -> QR issuance (flat-keyed, one per flat/event)', () => {
  it('a rep of the paying tower can verify a submitted booking, issuing the flat QR', async () => {
    const rep = await signInAs(world.users.repMultiMobile); // reps tower D
    const { data, error } = await rep.rpc('verify_sadya_booking', {
      p_booking_id: world.sadyaBookingId,
      p_approve: true,
      p_reason: null,
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('verified');

    const { data: pass } = await db
      .from('qr_passes')
      .select('nonce, allowed_scans, redeemed_count, status')
      .eq('flat_id', world.flats['401'])
      .eq('event_id', world.event.id)
      .single();
    expect(pass).not.toBeNull();
    expect((pass as { allowed_scans: number }).allowed_scans).toBe(3); // 2 adults + 1 child from the seed booking
    expect((pass as { status: string }).status).toBe('issued');
  });

  it('a rep who does not manage that tower cannot verify it', async () => {
    // repB manages tower B only; the (already-verified) booking above is tower D.
    const repB = await signInAs(world.users.repBMobile);
    const { error } = await repB.rpc('verify_sadya_booking', {
      p_booking_id: world.sadyaBookingId,
      p_approve: true,
      p_reason: null,
    });
    expect(error).not.toBeNull();
  });
});

describe('redeem_sadya_pass', () => {
  async function getNonce() {
    const { data } = await db
      .from('qr_passes')
      .select('nonce')
      .eq('flat_id', world.flats['401'])
      .eq('event_id', world.event.id)
      .single();
    return (data as { nonce: string }).nonce;
  }

  it('a plain resident (not a sadya rep) cannot redeem passes', async () => {
    const resident = await signInAs(world.users.residentDMobile);
    const nonce = await getNonce();
    const { error } = await resident.rpc('redeem_sadya_pass', { p_nonce: nonce, p_count: 1 });
    expect(error).not.toBeNull();
  });

  it('a sadya rep can partially redeem, then fully redeem, a 3-scan pass', async () => {
    const scanner = await signInAs(world.users.sadyaRepMobile);
    const nonce = await getNonce();

    const first = await scanner.rpc('redeem_sadya_pass', { p_nonce: nonce, p_count: 2, p_device: 'itest' });
    expect(first.error).toBeNull();
    const firstRow = (first.data as RedeemRow[])[0];
    expect(firstRow.result).toBe('accepted');
    expect(firstRow.redeemed_count).toBe(2);
    expect(firstRow.remaining).toBe(1);

    const second = await scanner.rpc('redeem_sadya_pass', { p_nonce: nonce, p_count: 1, p_device: 'itest' });
    expect(second.error).toBeNull();
    const secondRow = (second.data as RedeemRow[])[0];
    expect(secondRow.result).toBe('accepted');
    expect(secondRow.redeemed_count).toBe(3);
    expect(secondRow.remaining).toBe(0);
  });

  it('scanning beyond allowed_scans is rejected as rejected_exhausted, not silently over-counted', async () => {
    const scanner = await signInAs(world.users.sadyaRepMobile);
    const nonce = await getNonce(); // already fully redeemed by the previous test
    const { data, error } = await scanner.rpc('redeem_sadya_pass', { p_nonce: nonce, p_count: 1, p_device: 'itest' });
    expect(error).toBeNull();
    const row = (data as RedeemRow[])[0];
    expect(row.result).toBe('rejected_exhausted');
    expect(row.redeemed_count).toBe(3); // unchanged
  });

  it('an unknown nonce returns rejected_invalid rather than throwing', async () => {
    const scanner = await signInAs(world.users.sadyaRepMobile);
    const { data, error } = await scanner.rpc('redeem_sadya_pass', { p_nonce: 'not-a-real-nonce', p_count: 1 });
    expect(error).toBeNull();
    expect((data as RedeemRow[])[0].result).toBe('rejected_invalid');
  });

  it('replaying the same client_scan_id returns the original outcome instead of double-counting (offline sync idempotency)', async () => {
    // Fresh booking+verify+pass so this test doesn't depend on the exhausted pass above.
    const resident = await signInAs(world.users.residentA[1]);
    const { data: booking } = await resident.rpc('create_sadya_booking', { p_num_adults: 1, p_num_children: 0 });
    const bookingId = (booking as { id: string }).id;
    await resident.rpc('submit_sadya_payment', {
      p_booking_id: bookingId, p_amount_paid: SENT.adultPrice, p_utr: 'TEST-SADYA-IDEMP',
    });
    const rep = await signInAs(world.users.repMultiMobile);
    await rep.rpc('verify_sadya_booking', { p_booking_id: bookingId, p_approve: true, p_reason: null });

    const { data: passRow } = await db
      .from('qr_passes')
      .select('nonce, redeemed_count')
      .eq('flat_id', world.flats[101])
      .eq('event_id', world.event.id)
      .single();
    const nonce = (passRow as { nonce: string }).nonce;
    const startCount = (passRow as { redeemed_count: number }).redeemed_count;

    const scanner = await signInAs(world.users.sadyaRepMobile);
    const clientScanId = randomUUID();

    const attempt1 = await scanner.rpc('redeem_sadya_pass', {
      p_nonce: nonce, p_count: 1, p_device: 'itest', p_client_scan_id: clientScanId,
    });
    expect(attempt1.error).toBeNull();
    const row1 = (attempt1.data as RedeemRow[])[0];
    expect(row1.redeemed_count).toBe(startCount + 1);

    // Simulate the offline queue replaying the exact same scan on resync.
    const attempt2 = await scanner.rpc('redeem_sadya_pass', {
      p_nonce: nonce, p_count: 1, p_device: 'itest', p_client_scan_id: clientScanId,
    });
    expect(attempt2.error).toBeNull();
    const row2 = (attempt2.data as RedeemRow[])[0];
    expect(row2.redeemed_count).toBe(startCount + 1); // NOT startCount + 2 — replay must not double-count
  });
});
