import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatINR } from '../../lib/format';
import { assetUrl, byName } from '../../lib/ui';
import OfflinePaymentForm from '../../components/OfflinePaymentForm';
import CorrectionRequestsPanel from '../../components/CorrectionRequestsPanel';
import TowerLeaderboard from '../../components/TowerLeaderboard';
import {
  type OverviewContrib, type OverviewFlat, type OverviewTower,
} from '../../components/ContributionOverview';
import RevenueDashboard from '../../components/RevenueDashboard';
import { type OverviewSadya, type OverviewCancellation } from '../../components/SadyaOverview';
import Modal from '../../components/Modal';
import type { ContributionStatus, SadyaStatus } from '../../lib/types';

interface ManagedTower extends OverviewTower {
  rep_contact: string | null;
  rep_upi_id: string | null;
  rep_payment_phone: string | null;
  payment_qr_path: string | null;
}
interface ContribRow {
  id: string;
  flat_id: string;
  paid_to_tower_id: string;
  status: ContributionStatus;
  amount: number;
  amount_paid: number | null;
  utr: string | null;
  payment_submitted_at: string | null;
  refund_state: 'requested' | 'refunded' | null;
  refund_reason: string | null;
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}
interface SadyaRow {
  id: string;
  paid_to_tower_id: string;
  status: SadyaStatus;
  num_adults: number;
  num_children: number;
  total_persons: number;
  total_amount: number;
  amount_paid: number | null;
  utr: string | null;
  payment_submitted_at: string | null;
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}
interface SadyaCancelRow {
  id: string;
  paid_to_tower_id: string;
  num_adults: number;
  num_children: number;
  total_persons: number;
  amount: number;
  status: 'requested' | 'refunded';
  reason: string | null;
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}
interface SettlementRow {
  id: string;
  tower_id: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export default function RepHome() {
  const { profile } = useAuth();
  const [towers, setTowers] = useState<ManagedTower[]>([]);
  const [flats, setFlats] = useState<OverviewFlat[]>([]);
  const [contribs, setContribs] = useState<ContribRow[]>([]);
  const [sadya, setSadya] = useState<SadyaRow[]>([]);
  const [sadyaCancels, setSadyaCancels] = useState<SadyaCancelRow[]>([]);
  const [sadyaPrices, setSadyaPrices] = useState<{ adult: number; child: number } | undefined>(undefined);
  const [eventId, setEventId] = useState<string | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ContribRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [sadyaRejecting, setSadyaRejecting] = useState<SadyaRow | null>(null);
  const [sadyaRejectReason, setSadyaRejectReason] = useState('');

  // Multi-select for bulk approve
  const [selectedContribIds, setSelectedContribIds] = useState(new Set<string>());
  const [selectedSadyaIds, setSelectedSadyaIds] = useState(new Set<string>());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Settlement form state per tower
  const [settleInputs, setSettleInputs] = useState<Record<string, { amount: string; note: string }>>({});
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  // payment details (apply to all towers this rep manages)
  const [contact, setContact] = useState('');
  const [upiId, setUpiId] = useState('');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrBust, setQrBust] = useState(0);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactMsg, setContactMsg] = useState<string | null>(null);

  const qrUrl = qrPath ? `${assetUrl('rep-qr', qrPath)}${qrBust ? `?v=${qrBust}` : ''}` : null;
  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '—';

  const loadData = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }

    // Fetch towers + active event in parallel (event needed for settlements query).
    const [{ data: tw }, { data: ev }] = await Promise.all([
      supabase
        .from('towers')
        .select('id, name, rep_contact, rep_upi_id, rep_payment_phone, payment_qr_path')
        .eq('rep_user_id', profile.id),
      supabase.from('events').select('id, adult_sadya_price, child_sadya_price').eq('is_active', true).maybeSingle(),
    ]);

    const managed = ((tw as ManagedTower[]) ?? []).sort(byName);
    setTowers(managed);

    // payment details apply to all managed towers — seed the form from the first
    if (managed[0]) {
      setContact(managed[0].rep_contact ?? '');
      setUpiId(managed[0].rep_upi_id ?? '');
      setPaymentPhone(managed[0].rep_payment_phone ?? '');
      setQrPath(managed[0].payment_qr_path ?? null);
    }

    const evp = ev as { id: string; adult_sadya_price: number; child_sadya_price: number } | null;
    setSadyaPrices(evp ? { adult: evp.adult_sadya_price, child: evp.child_sadya_price } : undefined);
    setEventId(evp?.id ?? null);

    const ids = managed.map((t) => t.id);
    if (ids.length === 0) {
      setFlats([]); setContribs([]); setSadya([]); setSadyaCancels([]); setSettlements([]); setLoading(false); return;
    }

    const [{ data: fl }, { data: c, error: e }, { data: sb }, { data: sc }, { data: sett }] = await Promise.all([
      supabase.from('flats').select('id, tower_id, flat_number').in('tower_id', ids).order('flat_number'),
      supabase
        .from('contributions')
        .select('id, flat_id, paid_to_tower_id, status, amount, amount_paid, utr, payment_submitted_at, refund_state, refund_reason, flats(flat_number), resident:profiles!initiated_by_user_id(name)')
        .in('paid_to_tower_id', ids)
        .order('payment_submitted_at', { ascending: true }),
      supabase
        .from('sadya_bookings')
        .select('id, paid_to_tower_id, status, num_adults, num_children, total_persons, total_amount, amount_paid, utr, payment_submitted_at, flats(flat_number), resident:profiles!resident_id(name)')
        .in('paid_to_tower_id', ids)
        .order('payment_submitted_at', { ascending: true }),
      supabase
        .from('sadya_cancellations')
        .select('id, paid_to_tower_id, num_adults, num_children, total_persons, amount, status, reason, flats(flat_number), resident:profiles!resident_id(name)')
        .in('paid_to_tower_id', ids)
        .order('requested_at', { ascending: true }),
      evp
        ? supabase
            .from('rep_settlements')
            .select('id, tower_id, amount, note, created_at')
            .in('tower_id', ids)
            .eq('event_id', evp.id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (e) setError(e.message);
    setFlats((fl as OverviewFlat[]) ?? []);
    setContribs((c as unknown as ContribRow[]) ?? []);
    setSadya((sb as unknown as SadyaRow[]) ?? []);
    setSadyaCancels((sc as unknown as SadyaCancelRow[]) ?? []);
    setSettlements((sett as unknown as SettlementRow[]) ?? []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function persist(qrPathToSave: string | null) {
    const { error: e } = await supabase.rpc('set_my_rep_payment', {
      p_contact: contact.trim() || null,
      p_upi_id: upiId.trim() || null,
      p_payment_phone: paymentPhone.trim() || null,
      p_qr_path: qrPathToSave,
    });
    return e;
  }
  async function savePayment() {
    setContactMsg(null);
    setContactBusy(true);
    const e = await persist(null);
    setContactBusy(false);
    setContactMsg(e ? e.message : 'Saved — applies to all towers you manage.');
  }
  async function uploadQr(file: File) {
    if (!profile?.id) return;
    setContactMsg(null);
    setContactBusy(true);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${profile.id}/qr.${ext}`;
    const up = await supabase.storage.from('rep-qr').upload(path, file, { upsert: true });
    if (up.error) { setContactBusy(false); setContactMsg(up.error.message); return; }
    const e = await persist(path);
    setContactBusy(false);
    if (e) setContactMsg(e.message);
    else { setQrPath(path); setQrBust(Date.now()); setContactMsg('QR uploaded — residents can scan it now.'); }
  }

  async function approve(row: ContribRow) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('verify_contribution', {
      p_contribution_id: row.id, p_approve: true, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else loadData();
  }
  async function confirmReject() {
    if (!rejecting) return;
    const row = rejecting;
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('verify_contribution', {
      p_contribution_id: row.id, p_approve: false, p_reason: rejectReason.trim() || null,
    });
    setBusyId(null);
    setRejecting(null); setRejectReason('');
    if (e) setError(e.message); else loadData();
  }

  function toggleContrib(id: string) {
    setSelectedContribIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  async function bulkApproveContribs() {
    const ids = [...selectedContribIds];
    setSelectedContribIds(new Set());
    setError(null);
    setBulkBusy(true);
    await Promise.all(ids.map((id) =>
      supabase.rpc('verify_contribution', { p_contribution_id: id, p_approve: true, p_reason: null }),
    ));
    setBulkBusy(false);
    loadData();
  }

  async function approveSadya(row: SadyaRow) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('verify_sadya_booking', {
      p_booking_id: row.id, p_approve: true, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else loadData();
  }
  async function confirmRejectSadya() {
    if (!sadyaRejecting) return;
    const row = sadyaRejecting;
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('verify_sadya_booking', {
      p_booking_id: row.id, p_approve: false, p_reason: sadyaRejectReason.trim() || null,
    });
    setBusyId(null);
    setSadyaRejecting(null); setSadyaRejectReason('');
    if (e) setError(e.message); else loadData();
  }

  function toggleSadya(id: string) {
    setSelectedSadyaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  async function bulkApproveSadya() {
    const ids = [...selectedSadyaIds];
    setSelectedSadyaIds(new Set());
    setError(null);
    setBulkBusy(true);
    await Promise.all(ids.map((id) =>
      supabase.rpc('verify_sadya_booking', { p_booking_id: id, p_approve: true, p_reason: null }),
    ));
    setBulkBusy(false);
    loadData();
  }

  const queue = contribs.filter((c) => c.status === 'submitted');
  const refundQueue = contribs.filter((c) => c.refund_state === 'requested');
  const sadyaQueue = sadya.filter((s) => s.status === 'submitted');
  const sadyaCancelQueue = sadyaCancels.filter((s) => s.status === 'requested');
  const sadyaPeople = (s: { num_adults: number; num_children: number }) =>
    `${s.num_adults} adult${s.num_adults === 1 ? '' : 's'}${s.num_children ? ` · ${s.num_children} child${s.num_children === 1 ? '' : 'ren'}` : ''}`;
  const overviewContribs: OverviewContrib[] = contribs.map((c) => ({
    id: c.id, flat_id: c.flat_id, paid_to_tower_id: c.paid_to_tower_id,
    status: c.status, amount: c.amount, amount_paid: c.amount_paid, refund_state: c.refund_state,
  }));
  const overviewSadya: OverviewSadya[] = sadya.map((s) => ({
    id: s.id, paid_to_tower_id: s.paid_to_tower_id,
    flat_number: s.flats?.flat_number ?? null, resident_name: s.resident?.name ?? null,
    status: s.status, num_adults: s.num_adults, num_children: s.num_children,
    total_persons: s.total_persons, total_amount: s.total_amount, amount_paid: s.amount_paid,
  }));
  const overviewCancellations: OverviewCancellation[] = sadyaCancels.map((s) => ({
    id: s.id, paid_to_tower_id: s.paid_to_tower_id,
    flat_number: s.flats?.flat_number ?? null, resident_name: s.resident?.name ?? null,
    num_adults: s.num_adults, num_children: s.num_children,
    total_persons: s.total_persons, amount: s.amount, status: s.status,
  }));

  // Total collected per tower (contributions + sadya − refunds) for the settlement panel.
  const towerCollected = new Map<string, number>();
  overviewContribs.forEach((c) => {
    if (c.status === 'verified' && c.refund_state !== 'refunded') {
      const amt = Number(c.amount_paid ?? c.amount);
      towerCollected.set(c.paid_to_tower_id, (towerCollected.get(c.paid_to_tower_id) ?? 0) + amt);
    }
  });
  overviewSadya.forEach((s) => {
    if (s.status === 'verified') {
      const amt = Number(s.amount_paid ?? s.total_amount);
      towerCollected.set(s.paid_to_tower_id, (towerCollected.get(s.paid_to_tower_id) ?? 0) + amt);
    }
  });
  overviewCancellations.forEach((c) => {
    if (c.status === 'refunded') {
      towerCollected.set(c.paid_to_tower_id, (towerCollected.get(c.paid_to_tower_id) ?? 0) - c.amount);
    }
  });

  async function processRefund(row: ContribRow, appr: boolean) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('process_refund', {
      p_contribution_id: row.id, p_approve: appr, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else loadData();
  }

  async function processSadyaCancel(row: SadyaCancelRow, appr: boolean) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('process_sadya_cancellation', {
      p_cancellation_id: row.id, p_approve: appr, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else loadData();
  }

  async function addSettlement(towerId: string) {
    if (!eventId || !profile?.id) return;
    const input = settleInputs[towerId] ?? {};
    const amt = parseInt(input.amount ?? '', 10);
    if (isNaN(amt) || amt <= 0) { setSettleError('Enter a valid amount.'); return; }
    setSettleBusy(true);
    setSettleError(null);
    const { error: e } = await supabase.from('rep_settlements').insert({
      event_id: eventId,
      tower_id: towerId,
      rep_user_id: profile.id,
      amount: amt,
      note: input.note?.trim() || null,
    });
    setSettleBusy(false);
    if (e) { setSettleError(e.message); return; }
    setSettleInputs((prev) => ({ ...prev, [towerId]: { amount: '', note: '' } }));
    loadData();
  }

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  if (towers.length === 0) {
    return (
      <div className="page">
        <div className="hero"><h2>Tower representative</h2></div>
        <div className="card"><p className="muted">You're not assigned to any tower right now.</p></div>
      </div>
    );
  }

  const allContribSelected = queue.length > 0 && selectedContribIds.size === queue.length;
  const allSadyaSelected = sadyaQueue.length > 0 && selectedSadyaIds.size === sadyaQueue.length;

  return (
    <div className="page">
      <div className="hero">
        <h2>Tower Representative</h2>
        <p className="hero-sub">
          Managing <strong>{towers.map((t) => t.name).join(', ')}</strong>
        </p>
      </div>

      <details className="disclosure card card-accent">
        <summary>Your Payment Details</summary>
        <p className="muted">Used by residents in <strong>all towers you manage</strong>. Your UPI ID powers the resident's "pay" button but is never shown to them.</p>
        <label>UPI ID (for the pay button — not shown to residents)
          <input placeholder="e.g. ravi@okaxis" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
        </label>
        <label>Payment Mobile Number (shown to residents to copy &amp; pay)
          <input placeholder="e.g. 98765 43210" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} />
        </label>
        <label>Your Name (shown to residents)
          <input placeholder="e.g. Ravi" value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label style={{ marginTop: '1rem' }}>UPI QR Image (so residents can scan)
          <input type="file" accept="image/*" disabled={contactBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadQr(f); }} />
        </label>
        {qrUrl && (
          <div>
            <p className="muted">Current QR:</p>
            <img src={qrUrl} alt="Your UPI QR" style={{ maxWidth: 200, border: '1px solid var(--line)', borderRadius: 10 }} />
          </div>
        )}
        <button onClick={savePayment} disabled={contactBusy}>Save</button>
        {contactMsg && <p className={contactMsg.startsWith('Saved') || contactMsg.startsWith('QR') ? 'success' : 'error'}>{contactMsg}</p>}
      </details>

      {/* ── Verification Queue ─────────────────────────────────────────── */}
      <div className="section-title">
        <h3>Verification Queue</h3>
        {queue.length > 0 && <span className="badge awaiting">{queue.length}</span>}
      </div>
      {queue.length === 0 ? (
        <div className="card"><p className="muted">No payments waiting for verification. 🎉</p></div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: '0.4rem', gap: '0.6rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allContribSelected}
                onChange={() => setSelectedContribIds(allContribSelected ? new Set() : new Set(queue.map((r) => r.id)))}
              />
              <span className="muted">Select all</span>
            </label>
            {selectedContribIds.size > 0 && (
              <button className="success-btn" disabled={bulkBusy} onClick={bulkApproveContribs}>
                Approve {selectedContribIds.size} selected
              </button>
            )}
          </div>
          <ul className="list">
            {queue.map((row) => (
              <li key={row.id} className="card card-accent">
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={selectedContribIds.has(row.id)}
                    onChange={() => toggleContrib(row.id)}
                    style={{ marginTop: '0.2rem', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 0.3rem' }}>
                      <strong>{towerName(row.paid_to_tower_id)} · Flat {row.flats?.flat_number ?? '—'}</strong>
                      {row.resident?.name ? <> · {row.resident.name}</> : null}
                      {' '}· paid <strong>{formatINR(row.amount_paid ?? row.amount)}</strong>
                      {row.utr ? <> · UTR <code>{row.utr}</code></> : <span className="muted"> · no UTR</span>}
                    </p>
                    <p className="muted" style={{ margin: '0 0 0.4rem' }}>
                      Pledged {formatINR(row.amount)}
                      {row.payment_submitted_at ? ` · submitted ${new Date(row.payment_submitted_at).toLocaleString()}` : ''}
                    </p>
                  </div>
                </div>
                <div className="row">
                  <button className="success-btn" disabled={!!busyId || bulkBusy} onClick={() => approve(row)}>Approve</button>
                  <button className="danger-btn" disabled={!!busyId || bulkBusy} onClick={() => setRejecting(row)}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}

      {/* ── Refund Requests ────────────────────────────────────────────── */}
      {refundQueue.length > 0 && (
        <>
          <div className="section-title"><h3>Refund Requests</h3>
            <span className="badge rejected">{refundQueue.length}</span>
          </div>
          <ul className="list">
            {refundQueue.map((row) => (
              <li key={row.id} className="card card-accent">
                <p style={{ margin: '0 0 0.3rem' }}>
                  <strong>{towerName(row.paid_to_tower_id)} · Flat {row.flats?.flat_number ?? '—'}</strong>
                  {row.resident?.name ? <> · {row.resident.name}</> : null}
                  {' '}· refund <strong>{formatINR(row.amount_paid ?? row.amount)}</strong>
                </p>
                {row.refund_reason && <p className="muted" style={{ margin: '0 0 0.4rem' }}>Reason: {row.refund_reason}</p>}
                <p className="muted" style={{ margin: '0 0 0.4rem' }}>Pay the resident back, then mark it refunded.</p>
                <div className="row">
                  <button className="success-btn" disabled={busyId === row.id} onClick={() => processRefund(row, true)}>Mark Refunded</button>
                  <button className="danger-btn" disabled={busyId === row.id} onClick={() => processRefund(row, false)}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── Sadya Verification Queue ───────────────────────────────────── */}
      <div className="section-title">
        <h3>Sadya Verification Queue</h3>
        {sadyaQueue.length > 0 && <span className="badge awaiting">{sadyaQueue.length}</span>}
      </div>
      {sadyaQueue.length === 0 ? (
        <div className="card"><p className="muted">No sadya bookings waiting for verification. 🍛</p></div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: '0.4rem', gap: '0.6rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allSadyaSelected}
                onChange={() => setSelectedSadyaIds(allSadyaSelected ? new Set() : new Set(sadyaQueue.map((r) => r.id)))}
              />
              <span className="muted">Select all</span>
            </label>
            {selectedSadyaIds.size > 0 && (
              <button className="success-btn" disabled={bulkBusy} onClick={bulkApproveSadya}>
                Approve &amp; Issue {selectedSadyaIds.size} selected
              </button>
            )}
          </div>
          <ul className="list">
            {sadyaQueue.map((row) => (
              <li key={row.id} className="card card-accent">
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={selectedSadyaIds.has(row.id)}
                    onChange={() => toggleSadya(row.id)}
                    style={{ marginTop: '0.2rem', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 0.3rem' }}>
                      <strong>{towerName(row.paid_to_tower_id)} · Flat {row.flats?.flat_number ?? '—'}</strong>
                      {row.resident?.name ? ` · ${row.resident.name}` : ''} · paid{' '}
                      <strong>{formatINR(row.amount_paid ?? row.total_amount)}</strong>
                      {row.utr ? <> · UTR <code>{row.utr}</code></> : <span className="muted"> · no UTR</span>}
                    </p>
                    <p className="muted" style={{ margin: '0 0 0.4rem' }}>
                      {sadyaPeople(row)} · {row.total_persons} {row.total_persons === 1 ? 'meal' : 'meals'}
                      {row.payment_submitted_at ? ` · submitted ${new Date(row.payment_submitted_at).toLocaleString()}` : ''}
                    </p>
                  </div>
                </div>
                <div className="row">
                  <button className="success-btn" disabled={!!busyId || bulkBusy} onClick={() => approveSadya(row)}>Approve &amp; Issue Pass</button>
                  <button className="danger-btn" disabled={!!busyId || bulkBusy} onClick={() => setSadyaRejecting(row)}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── Sadya Cancellation Requests ────────────────────────────────── */}
      {sadyaCancelQueue.length > 0 && (
        <>
          <div className="section-title"><h3>Sadya Cancellation Requests</h3>
            <span className="badge rejected">{sadyaCancelQueue.length}</span>
          </div>
          <ul className="list">
            {sadyaCancelQueue.map((row) => (
              <li key={row.id} className="card card-accent">
                <p style={{ margin: '0 0 0.3rem' }}>
                  <strong>{towerName(row.paid_to_tower_id)} · Flat {row.flats?.flat_number ?? '—'}</strong>
                  {row.resident?.name ? ` · ${row.resident.name}` : ''}
                  {' '}· {sadyaPeople(row)}
                  {' '}· refund <strong>{formatINR(row.amount)}</strong>
                  {' '}· {row.total_persons} {row.total_persons === 1 ? 'pass' : 'passes'} cancelled
                </p>
                {row.reason && <p className="muted" style={{ margin: '0 0 0.4rem' }}>Reason: {row.reason}</p>}
                <p className="muted" style={{ margin: '0 0 0.4rem' }}>These passes are already off the flat's QR. Pay the resident back, then mark it refunded — or decline to restore the passes.</p>
                <div className="row">
                  <button className="success-btn" disabled={busyId === row.id} onClick={() => processSadyaCancel(row, true)}>Mark Refunded</button>
                  <button className="danger-btn" disabled={busyId === row.id} onClick={() => processSadyaCancel(row, false)}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <CorrectionRequestsPanel />

      {/* ── Revenue Dashboard ──────────────────────────────────────────── */}
      <div className="section-title"><h3>Your Towers</h3></div>
      <RevenueDashboard towers={towers} flats={flats} contribs={overviewContribs} sadya={overviewSadya} cancellations={overviewCancellations} showPerTowerBreakdown={false} />

      {/* ── Tower Leaderboard (all towers, for healthy competition) ───── */}
      {eventId && (
        <>
          <div className="section-title"><h3>Tower Leaderboard</h3></div>
          <TowerLeaderboard eventId={eventId} />
        </>
      )}

      {/* ── Walk-In / Offline Payment (toggle) ─────────────────────────── */}
      <details className="disclosure card card-accent">
        <summary>Record a Walk-In / Offline Payment</summary>
        <p className="muted">For residents who paid you directly without using the app. This marks the flat as paid (verified).</p>
        <OfflinePaymentForm towers={towers} sadyaPrices={sadyaPrices} onRecorded={loadData} />
      </details>

      {/* ── Settlements (toggle, very end) ─────────────────────────────── */}
      <details className="disclosure card card-accent">
        <summary>Settlements</summary>
        <p className="muted" style={{ margin: '0.2rem 0 0.6rem' }}>
          Record each transfer you make to the organising committee. Your amount in hand updates automatically.
        </p>
      {towers.map((tower, idx) => {
        const towerSettlements = settlements.filter((s) => s.tower_id === tower.id);
        const collected = towerCollected.get(tower.id) ?? 0;
        const settled = towerSettlements.reduce((s, r) => s + r.amount, 0);
        const inHand = collected - settled;
        const allSettled = collected > 0 && inHand <= 0;
        const inp = settleInputs[tower.id] ?? { amount: '', note: '' };

        return (
          <div
            key={tower.id}
            style={idx > 0 ? { borderTop: '1px solid var(--line)', marginTop: '1rem', paddingTop: '1rem' } : undefined}
          >
            <div className="between">
              <h3 style={{ margin: 0 }}>{tower.name}</h3>
              {allSettled && <span className="badge soft verified">Fully Settled ✓</span>}
            </div>
            <div className="grid cols-3" style={{ marginTop: '0.6rem' }}>
              <div className="stat green">
                <div className="stat-value">{formatINR(collected)}</div>
                <div className="stat-label">Total Collected</div>
              </div>
              <div className="stat blue">
                <div className="stat-value">{formatINR(settled)}</div>
                <div className="stat-label">Settled</div>
              </div>
              <div className={`stat ${inHand > 0 ? 'amber' : 'green'}`}>
                <div className="stat-value">{formatINR(Math.max(0, inHand))}</div>
                <div className="stat-label">Amount in Hand</div>
              </div>
            </div>

            {towerSettlements.length > 0 && (
              <table className="tbl" style={{ marginTop: '0.6rem' }}>
                <thead>
                  <tr><th>Date</th><th>Amount</th><th>Note</th></tr>
                </thead>
                <tbody>
                  {towerSettlements.map((s) => (
                    <tr key={s.id}>
                      <td className="muted">{new Date(s.created_at).toLocaleDateString()}</td>
                      <td>{formatINR(s.amount)}</td>
                      <td className="muted">{s.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!allSettled && (
              <div style={{ marginTop: '0.8rem', borderTop: '1px solid var(--line)', paddingTop: '0.8rem' }}>
                <p className="muted" style={{ margin: '0 0 0.5rem' }}>Record a transfer to the organising committee:</p>
                <label>Amount (₹)
                  <input
                    type="number"
                    placeholder={inHand > 0 ? `Up to ${formatINR(inHand)}` : '0'}
                    value={inp.amount}
                    onChange={(e) => setSettleInputs((prev) => ({ ...prev, [tower.id]: { ...inp, amount: e.target.value } }))}
                  />
                </label>
                <label>Note (optional)
                  <input
                    placeholder="e.g. Cash handed to treasurer"
                    value={inp.note}
                    onChange={(e) => setSettleInputs((prev) => ({ ...prev, [tower.id]: { ...inp, note: e.target.value } }))}
                  />
                </label>
                <button
                  className="success-btn"
                  disabled={settleBusy || !inp.amount}
                  onClick={() => addSettlement(tower.id)}
                >
                  Record Settlement
                </button>
                {settleError && <p className="error" style={{ marginTop: '0.4rem' }}>{settleError}</p>}
              </div>
            )}
          </div>
        );
      })}
      </details>

      {rejecting && (
        <Modal title="Reject This Payment?" onClose={() => setRejecting(null)}>
          <p className="muted">
            {towerName(rejecting.paid_to_tower_id)} · Flat {rejecting.flats?.flat_number ?? '—'} · {formatINR(rejecting.amount_paid ?? rejecting.amount)}
          </p>
          <label>Reason (optional)
            <input autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Payment not received" />
          </label>
          <div className="row">
            <button className="danger-btn" disabled={busyId === rejecting.id} onClick={confirmReject}>Reject Payment</button>
            <button className="secondary" onClick={() => setRejecting(null)}>Cancel</button>
          </div>
        </Modal>
      )}

      {sadyaRejecting && (
        <Modal title="Reject This Sadya Booking?" onClose={() => setSadyaRejecting(null)}>
          <p className="muted">
            {towerName(sadyaRejecting.paid_to_tower_id)} · Flat {sadyaRejecting.flats?.flat_number ?? '—'} · {formatINR(sadyaRejecting.amount_paid ?? sadyaRejecting.total_amount)}
          </p>
          <label>Reason (optional)
            <input autoFocus value={sadyaRejectReason} onChange={(e) => setSadyaRejectReason(e.target.value)} placeholder="e.g. Payment not received" />
          </label>
          <div className="row">
            <button className="danger-btn" disabled={busyId === sadyaRejecting.id} onClick={confirmRejectSadya}>Reject Booking</button>
            <button className="secondary" onClick={() => setSadyaRejecting(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
