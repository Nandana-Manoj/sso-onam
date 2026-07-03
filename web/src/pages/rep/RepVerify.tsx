import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/format';
import Modal from '../../components/Modal';
import CorrectionRequestsPanel from '../../components/CorrectionRequestsPanel';
import { useRepData, type ContribRow, type SadyaRow, type SadyaCancelRow } from './useRepData';

/** All the rep's approval work in one focused place: contribution payments,
 *  refund requests, sadya bookings, sadya cancellations and change requests. */
export default function RepVerify() {
  const { loading, towers, contribs, sadya, sadyaCancels, reload } = useRepData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ContribRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [sadyaRejecting, setSadyaRejecting] = useState<SadyaRow | null>(null);
  const [sadyaRejectReason, setSadyaRejectReason] = useState('');
  const [selectedContribIds, setSelectedContribIds] = useState(new Set<string>());
  const [selectedSadyaIds, setSelectedSadyaIds] = useState(new Set<string>());

  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '—';

  async function approve(row: ContribRow) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('verify_contribution', {
      p_contribution_id: row.id, p_approve: true, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else reload();
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
    if (e) setError(e.message); else reload();
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
    reload();
  }

  async function approveSadya(row: SadyaRow) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('verify_sadya_booking', {
      p_booking_id: row.id, p_approve: true, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else reload();
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
    if (e) setError(e.message); else reload();
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
    reload();
  }

  async function processRefund(row: ContribRow, appr: boolean) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('process_refund', {
      p_contribution_id: row.id, p_approve: appr, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else reload();
  }
  async function processSadyaCancel(row: SadyaCancelRow, appr: boolean) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('process_sadya_cancellation', {
      p_cancellation_id: row.id, p_approve: appr, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else reload();
  }

  const queue = contribs.filter((c) => c.status === 'submitted');
  const refundQueue = contribs.filter((c) => c.refund_state === 'requested');
  const sadyaQueue = sadya.filter((s) => s.status === 'submitted');
  const sadyaCancelQueue = sadyaCancels.filter((s) => s.status === 'requested');
  const sadyaPeople = (s: { num_adults: number; num_children: number }) =>
    `${s.num_adults} adult${s.num_adults === 1 ? '' : 's'}${s.num_children ? ` · ${s.num_children} child${s.num_children === 1 ? '' : 'ren'}` : ''}`;

  const allContribSelected = queue.length > 0 && selectedContribIds.size === queue.length;
  const allSadyaSelected = sadyaQueue.length > 0 && selectedSadyaIds.size === sadyaQueue.length;

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <p className="page-back"><Link to="/rep">← Rep Tools</Link></p>
      <h2>Verification Queues</h2>

      {/* ── Verification Queue ─────────────────────────────────────────── */}
      <div className="section-title">
        <h3>Payment Verification</h3>
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
                    <div className="between" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div>
                        <strong style={{ fontSize: '1.05rem' }}>Flat {row.flats?.flat_number ?? '—'}</strong>
                        <div className="muted" style={{ marginTop: '0.2rem', fontSize: '0.85rem' }}>
                          {towerName(row.paid_to_tower_id)}{row.resident?.name ? ` · ${row.resident.name}` : ''}
                        </div>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          Pledged {formatINR(row.amount)}
                          {' · '}{row.utr ? <>UTR <code>{row.utr}</code></> : 'no UTR'}
                        </div>
                        {row.payment_submitted_at && (
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            Submitted {new Date(row.payment_submitted_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{formatINR(row.amount_paid ?? row.amount)}</div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>paid</div>
                      </div>
                    </div>
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
                <div className="between" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
                  <div>
                    <strong style={{ fontSize: '1.05rem' }}>Flat {row.flats?.flat_number ?? '—'}</strong>
                    <div className="muted" style={{ marginTop: '0.2rem', fontSize: '0.85rem' }}>
                      {towerName(row.paid_to_tower_id)}{row.resident?.name ? ` · ${row.resident.name}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{formatINR(row.amount_paid ?? row.amount)}</div>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>refund due</div>
                  </div>
                </div>
                {row.refund_reason && <p className="muted" style={{ margin: '0.7rem 0 0' }}>Reason: {row.refund_reason}</p>}
                <p className="muted" style={{ margin: '0.5rem 0 0.7rem' }}>Pay the resident back, then mark it refunded.</p>
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
        <h3>Sadya Verification</h3>
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
                    <div className="between" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div>
                        <strong style={{ fontSize: '1.05rem' }}>Flat {row.flats?.flat_number ?? '—'}</strong>
                        <div className="muted" style={{ marginTop: '0.2rem', fontSize: '0.85rem' }}>
                          {towerName(row.paid_to_tower_id)}{row.resident?.name ? ` · ${row.resident.name}` : ''}
                        </div>
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {sadyaPeople(row)} · {row.total_persons} {row.total_persons === 1 ? 'meal' : 'meals'}
                          {' · '}{row.utr ? <>UTR <code>{row.utr}</code></> : 'no UTR'}
                        </div>
                        {row.payment_submitted_at && (
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            Submitted {new Date(row.payment_submitted_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{formatINR(row.amount_paid ?? row.total_amount)}</div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>paid</div>
                      </div>
                    </div>
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
                <div className="between" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
                  <div>
                    <strong style={{ fontSize: '1.05rem' }}>Flat {row.flats?.flat_number ?? '—'}</strong>
                    <div className="muted" style={{ marginTop: '0.2rem', fontSize: '0.85rem' }}>
                      {towerName(row.paid_to_tower_id)}{row.resident?.name ? ` · ${row.resident.name}` : ''}
                    </div>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {sadyaPeople(row)} · {row.total_persons} {row.total_persons === 1 ? 'pass' : 'passes'} cancelled
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{formatINR(row.amount)}</div>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>refund due</div>
                  </div>
                </div>
                {row.reason && <p className="muted" style={{ margin: '0.7rem 0 0' }}>Reason: {row.reason}</p>}
                <p className="muted" style={{ margin: '0.5rem 0 0.7rem' }}>These passes are already off the flat's QR. Pay the resident back, then mark it refunded — or decline to restore the passes.</p>
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
