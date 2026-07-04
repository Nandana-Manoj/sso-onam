// @vitest-environment node
//
// Event lifecycle regression suite, including hard delete. There is NO
// delete-event RPC and NO admin UI button for it (confirmed by reading every
// migration + AdminEvents.tsx) — the only way to delete an events row at all
// is a direct service-role/SQL-editor DELETE, which is exactly what this file
// exercises, to answer: "what happens if someone does that, on purpose or by
// accident?" Everything else here (create, activate, config update, close,
// reopen) IS a real admin-facing feature and is tested as such.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, signInAs, ins, SENT } from '../fixtures/testEnv';
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

// Several tests below need a clean "no active event" starting point to test
// the one-active-event invariant. NEVER blindly deactivate whatever happens
// to be active — post-release, that could be a real live event, and turning
// it off would be a real, visible outage (every resident sees "no event
// open") even though nothing else was touched. Only ever deactivate a
// SENTINEL event; if a real one is active, skip rather than touch it.
async function ensureNoRealEventActive(): Promise<boolean> {
  const { data: active } = await db.from('events').select('id, year').eq('is_active', true).maybeSingle();
  if (!active) return true;
  const row = active as { id: string; year: number };
  if (row.year !== SENT.eventYear) return false; // a REAL event is active — refuse to touch it
  await db.from('events').update({ is_active: false }).eq('id', row.id);
  return true;
}

async function freshEvent(overrides: Record<string, unknown> = {}) {
  return ins(db, 'events', {
    name: SENT.eventName,
    year: SENT.eventYear,
    is_active: false,
    min_contribution: SENT.minContribution,
    adult_sadya_price: SENT.adultPrice,
    child_sadya_price: SENT.childPrice,
    currency: 'INR',
    ...overrides,
  });
}

describe('create', () => {
  it('an admin can create a new (inactive) event', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const { data, error } = await admin.from('events').insert({
      name: 'Regression Test Event', year: SENT.eventYear, is_active: false,
      min_contribution: 1000, adult_sadya_price: 100, child_sadya_price: 50,
    }).select().single();
    expect(error).toBeNull();
    expect((data as { is_active: boolean }).is_active).toBe(false);
  });

  it('a resident cannot create an event', async () => {
    const resident = await signInAs(world.users.residentA[1]);
    const { error } = await resident.from('events').insert({
      name: 'Rogue Event', year: SENT.eventYear, min_contribution: 1, adult_sadya_price: 1,
    });
    expect(error).not.toBeNull();
  });

  it('two events may share the same name+year — no uniqueness constraint (schema note, not a bug: worth a UX affordance if two look identical in the admin list)', async () => {
    const a = await freshEvent({ name: 'Duplicate Name Event' });
    const b = await freshEvent({ name: 'Duplicate Name Event' });
    expect(a.id).not.toBe(b.id);
  });

  it('the database enforces at most one active event, even via a direct insert bypassing set_active_event', async (ctx) => {
    if (!(await ensureNoRealEventActive())) return ctx.skip();
    const first = await freshEvent({ is_active: true });
    const { error } = await db.from('events').insert({
      name: 'Second Active Attempt', year: SENT.eventYear, is_active: true,
      min_contribution: 1, adult_sadya_price: 1,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/duplicate key|events_one_active_idx/i);
    await db.from('events').update({ is_active: false }).eq('id', first.id);
  });
});

describe('activate / config / close / reopen (the real, supported lifecycle)', () => {
  it('set_active_event switches the active slot atomically (old deactivates, new activates)', async (ctx) => {
    if (!(await ensureNoRealEventActive())) return ctx.skip();
    const admin = await signInAs(world.users.adminMobile);
    const eventA = await freshEvent();
    const eventB = await freshEvent();

    await admin.rpc('set_active_event', { p_event_id: eventA.id });
    let { data: actives } = await db.from('events').select('id').eq('is_active', true);
    expect(actives).toHaveLength(1);
    expect((actives as { id: string }[])[0].id).toBe(eventA.id);

    await admin.rpc('set_active_event', { p_event_id: eventB.id });
    ({ data: actives } = await db.from('events').select('id').eq('is_active', true));
    expect(actives).toHaveLength(1);
    expect((actives as { id: string }[])[0].id).toBe(eventB.id);
  });

  it('a tower_rep cannot activate an event', async () => {
    const rep = await signInAs(world.users.repBMobile);
    const event = await freshEvent();
    const { error } = await rep.rpc('set_active_event', { p_event_id: event.id });
    expect(error).not.toBeNull();
  });

  it('close_event archives the roster and clears the active slot; reopen restores it', async (ctx) => {
    if (!(await ensureNoRealEventActive())) return ctx.skip();
    const admin = await signInAs(world.users.adminMobile);
    const event = await freshEvent({ is_active: true });

    const { data: closed, error: closeErr } = await admin.rpc('close_event', { p_event_id: event.id });
    expect(closeErr).toBeNull();
    expect((closed as { is_active: boolean; closed_at: string }).is_active).toBe(false);
    expect((closed as { closed_at: string | null }).closed_at).not.toBeNull();

    const { data: archive } = await db.from('event_archives').select('event_id').eq('event_id', event.id);
    expect(archive).toHaveLength(1);

    const { data: reopened, error: reopenErr } = await admin.rpc('reopen_event', { p_event_id: event.id });
    expect(reopenErr).toBeNull();
    expect((reopened as { is_active: boolean }).is_active).toBe(true);

    const { data: archiveAfter } = await db.from('event_archives').select('event_id').eq('event_id', event.id);
    expect(archiveAfter).toHaveLength(0); // reopen discards the snapshot per its documented behavior
  });

  it('reopening a second closed event is refused while another event is already open (regression guard on the one-active invariant)', async (ctx) => {
    if (!(await ensureNoRealEventActive())) return ctx.skip();
    const admin = await signInAs(world.users.adminMobile);
    const openEvent = await freshEvent({ is_active: true });
    const closedEvent = await freshEvent({ is_active: false, closed_at: new Date().toISOString() });

    const { error } = await admin.rpc('reopen_event', { p_event_id: closedEvent.id });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/close the currently open event/i);
    void openEvent;
  });
});

describe('hard delete — NOT an in-app feature; DB-level safety net only', () => {
  it('no authenticated role — including admin — can delete an event through the normal client API (no DELETE policy exists on events)', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const event = await freshEvent();
    const { error, count } = await admin.from('events').delete({ count: 'exact' }).eq('id', event.id);
    expect(error !== null || count === 0).toBe(true);
    const { data: stillThere } = await db.from('events').select('id').eq('id', event.id);
    expect(stillThere).toHaveLength(1);
  });

  it('a completely untouched event (no contributions/bookings/audit_log) CAN be hard-deleted via service role', async () => {
    const event = await freshEvent();
    const { error, count } = await db.from('events').delete({ count: 'exact' }).eq('id', event.id);
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  it('an event with a live contribution CANNOT be hard-deleted (on delete restrict) — real money data is protected even from a service-role mistake', async () => {
    const event = await freshEvent();
    await ins(db, 'contributions', {
      event_id: event.id, flat_id: world.flats[101], initiated_by_user_id:
        (await db.from('profiles').select('id').eq('mobile', world.users.residentA[1]).single()).data!.id,
      amount: SENT.minContribution, min_snapshot: SENT.minContribution,
      paid_to_tower_id: world.towers.a, status: 'payment_pending',
    });
    const { error } = await db.from('events').delete().eq('id', event.id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23503'); // foreign_key_violation
    expect(error!.message).toMatch(/contributions/i);
  });

  it('an event with a sadya booking CANNOT be hard-deleted', async () => {
    const event = await freshEvent();
    const residentId = (await db.from('profiles').select('id').eq('mobile', world.users.residentDMobile).single()).data!.id as string;
    await ins(db, 'sadya_bookings', {
      event_id: event.id, resident_id: residentId, flat_id: world.flats['401'],
      num_adults: 1, num_children: 0, adult_price_snapshot: SENT.adultPrice,
      child_price_snapshot: SENT.childPrice, total_amount: SENT.adultPrice,
      paid_to_tower_id: world.towers.d, status: 'payment_pending',
    });
    const { error } = await db.from('events').delete().eq('id', event.id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23503');
    expect(error!.message).toMatch(/sadya_bookings/i);
  });

  it('REGRESSION-WORTHY: an event with zero money in it can still become permanently undeletable — any admin action (e.g. a config update) writes an audit_log row with no cascade, which blocks deletion just as hard as real financial data', async () => {
    const admin = await signInAs(world.users.adminMobile);
    const event = await freshEvent();
    const { error: cfgErr } = await admin.rpc('update_event_config', {
      p_event_id: event.id, p_name: 'Touched but empty', p_min_contribution: 500,
      p_adult_price: 50, p_child_price: 25, p_booking_freeze_at: null, p_verification_cutoff_at: null,
    });
    expect(cfgErr).toBeNull();

    const { error } = await db.from('events').delete().eq('id', event.id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23503');
    expect(error!.message).toMatch(/audit_log/i);
  });

  it('deleting the active event (when untouched) leaves zero active events, and a brand-new event can be created+activated cleanly afterward — no regression from the deletion', async (ctx) => {
    if (!(await ensureNoRealEventActive())) return ctx.skip();
    const event = await freshEvent({ is_active: true });

    const { error: delErr } = await db.from('events').delete().eq('id', event.id);
    expect(delErr).toBeNull();

    const { data: actives } = await db.from('events').select('id').eq('is_active', true);
    expect(actives).toHaveLength(0);

    // ResidentHome/AdminDashboard-style "is there an active event" query must
    // resolve to null cleanly, not error, when none exists.
    const resident = await signInAs(world.users.residentA[1]);
    const { data: activeCheck, error: activeErr } = await resident
      .from('events').select('*').eq('is_active', true).maybeSingle();
    expect(activeErr).toBeNull();
    expect(activeCheck).toBeNull();

    const admin = await signInAs(world.users.adminMobile);
    const replacement = await freshEvent();
    const { error: activateErr } = await admin.rpc('set_active_event', { p_event_id: replacement.id });
    expect(activateErr).toBeNull();
    const { data: newActive } = await db.from('events').select('id').eq('is_active', true);
    expect(newActive).toHaveLength(1);
    expect((newActive as { id: string }[])[0].id).toBe(replacement.id);
  });

  it('event_archives and rep_settlements CASCADE-delete cleanly when their (untouched-otherwise) event is deleted — no orphaned rows survive', async (ctx) => {
    if (!(await ensureNoRealEventActive())) return ctx.skip();
    const admin = await signInAs(world.users.adminMobile);
    const event = await freshEvent({ is_active: true });
    await admin.rpc('close_event', { p_event_id: event.id }); // creates an event_archives row + an audit_log row
    const repMultiId = (await db.from('profiles').select('id').eq('mobile', world.users.repMultiMobile).single()).data!.id as string;
    await ins(db, 'rep_settlements', {
      event_id: event.id, tower_id: world.towers.a, rep_user_id: repMultiId, amount: 1000,
    });

    // close_event's own audit_log entry means this event is ALREADY
    // undeletable via the normal path (matches the finding above) — delete
    // that one audit row first to isolate what THIS test is actually about:
    // do event_archives/rep_settlements cascade correctly once nothing else blocks it?
    await db.from('audit_log').delete().eq('event_id', event.id);

    const { error: delErr } = await db.from('events').delete().eq('id', event.id);
    expect(delErr).toBeNull();

    const { data: orphanArchive } = await db.from('event_archives').select('event_id').eq('event_id', event.id);
    expect(orphanArchive).toHaveLength(0);
    const { data: orphanSettlement } = await db.from('rep_settlements').select('id').eq('event_id', event.id);
    expect(orphanSettlement).toHaveLength(0);
  });
});
