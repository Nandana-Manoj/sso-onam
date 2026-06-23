import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatINR } from '../../lib/format';
import { assetUrl, byName } from '../../lib/ui';
import OfflinePaymentForm from '../../components/OfflinePaymentForm';
import ContributionOverview, {
  type OverviewContrib, type OverviewFlat, type OverviewTower,
} from '../../components/ContributionOverview';
import Modal from '../../components/Modal';
import type { ContributionStatus } from '../../lib/types';

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
}

export default function RepHome() {
  const { profile } = useAuth();
  const [towers, setTowers] = useState<ManagedTower[]>([]);
  const [flats, setFlats] = useState<OverviewFlat[]>([]);
  const [contribs, setContribs] = useState<ContribRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ContribRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

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
    const { data: tw } = await supabase
      .from('towers')
      .select('id, name, rep_contact, rep_upi_id, rep_payment_phone, payment_qr_path')
      .eq('rep_user_id', profile.id);
    const managed = ((tw as ManagedTower[]) ?? []).sort(byName);
    setTowers(managed);

    // payment details apply to all managed towers — seed the form from the first
    if (managed[0]) {
      setContact(managed[0].rep_contact ?? '');
      setUpiId(managed[0].rep_upi_id ?? '');
      setPaymentPhone(managed[0].rep_payment_phone ?? '');
      setQrPath(managed[0].payment_qr_path ?? null);
    }

    const ids = managed.map((t) => t.id);
    if (ids.length === 0) {
      setFlats([]); setContribs([]); setLoading(false); return;
    }
    const [{ data: fl }, { data: c, error: e }] = await Promise.all([
      supabase.from('flats').select('id, tower_id, flat_number').in('tower_id', ids).order('flat_number'),
      supabase
        .from('contributions')
        .select('id, flat_id, paid_to_tower_id, status, amount, amount_paid, utr, payment_submitted_at, refund_state, refund_reason, flats(flat_number)')
        .in('paid_to_tower_id', ids)
        .order('payment_submitted_at', { ascending: true }),
    ]);
    if (e) setError(e.message);
    setFlats((fl as OverviewFlat[]) ?? []);
    setContribs((c as unknown as ContribRow[]) ?? []);
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

  const queue = contribs.filter((c) => c.status === 'submitted');
  const refundQueue = contribs.filter((c) => c.refund_state === 'requested');
  const overviewContribs: OverviewContrib[] = contribs.map((c) => ({
    flat_id: c.flat_id, paid_to_tower_id: c.paid_to_tower_id,
    status: c.status, amount: c.amount, amount_paid: c.amount_paid, refund_state: c.refund_state,
  }));

  async function processRefund(row: ContribRow, approve: boolean) {
    setError(null);
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('process_refund', {
      p_contribution_id: row.id, p_approve: approve, p_reason: null,
    });
    setBusyId(null);
    if (e) setError(e.message); else loadData();
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

  return (
    <div className="page">
      <div className="hero">
        <h2>Tower representative</h2>
        <p className="hero-sub">
          Managing <strong>{towers.map((t) => t.name).join(', ')}</strong>
        </p>
      </div>

      <div className="card card-accent">
        <h3>Your payment details</h3>
        <p className="muted">Used by residents in <strong>all towers you manage</strong>. Your UPI ID powers the resident's "pay" button but is never shown to them.</p>
        <label>UPI ID (for the pay button — not shown to residents)
          <input placeholder="e.g. ravi@okaxis" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
        </label>
        <label>Payment mobile number (shown to residents to copy &amp; pay)
          <input placeholder="e.g. 98765 43210" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} />
        </label>
        <label>Your name (shown to residents)
          <input placeholder="e.g. Ravi" value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label style={{ marginTop: '1rem' }}>UPI QR image (so residents can scan)
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
      </div>

      <div className="section-title"><h3>Verification queue</h3>
        {queue.length > 0 && <span className="badge awaiting">{queue.length}</span>}
      </div>
      {queue.length === 0 ? (
        <div className="card"><p className="muted">No payments waiting for verification. 🎉</p></div>
      ) : (
        <ul className="list">
          {queue.map((row) => (
            <li key={row.id} className="card card-accent">
              <p style={{ margin: '0 0 0.3rem' }}>
                <strong>{towerName(row.paid_to_tower_id)} · Flat {row.flats?.flat_number ?? '—'}</strong> · paid{' '}
                <strong>{formatINR(row.amount_paid ?? row.amount)}</strong>
                {row.utr ? <> · UTR <code>{row.utr}</code></> : <span className="muted"> · no UTR</span>}
              </p>
              <p className="muted" style={{ margin: '0 0 0.4rem' }}>
                Pledged {formatINR(row.amount)}
                {row.payment_submitted_at ? ` · submitted ${new Date(row.payment_submitted_at).toLocaleString()}` : ''}
              </p>
              <div className="row">
                <button className="success-btn" disabled={busyId === row.id} onClick={() => approve(row)}>Approve</button>
                <button className="danger-btn" disabled={busyId === row.id} onClick={() => setRejecting(row)}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}

      <div className="card card-accent">
        <h3>Record a walk-in / offline payment</h3>
        <p className="muted">For residents who paid you directly without using the app. This marks the flat as paid (verified).</p>
        <OfflinePaymentForm towers={towers} onRecorded={loadData} />
      </div>

      {refundQueue.length > 0 && (
        <>
          <div className="section-title"><h3>Refund requests</h3>
            <span className="badge rejected">{refundQueue.length}</span>
          </div>
          <ul className="list">
            {refundQueue.map((row) => (
              <li key={row.id} className="card card-accent">
                <p style={{ margin: '0 0 0.3rem' }}>
                  <strong>{towerName(row.paid_to_tower_id)} · Flat {row.flats?.flat_number ?? '—'}</strong>
                  {' '}· refund <strong>{formatINR(row.amount_paid ?? row.amount)}</strong>
                </p>
                {row.refund_reason && <p className="muted" style={{ margin: '0 0 0.4rem' }}>Reason: {row.refund_reason}</p>}
                <p className="muted" style={{ margin: '0 0 0.4rem' }}>Pay the resident back, then mark it refunded.</p>
                <div className="row">
                  <button className="success-btn" disabled={busyId === row.id} onClick={() => processRefund(row, true)}>Mark refunded</button>
                  <button className="danger-btn" disabled={busyId === row.id} onClick={() => processRefund(row, false)}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-title"><h3>Your towers</h3></div>
      <ContributionOverview towers={towers} flats={flats} contribs={overviewContribs} />

      {rejecting && (
        <Modal title="Reject this payment?" onClose={() => setRejecting(null)}>
          <p className="muted">
            {towerName(rejecting.paid_to_tower_id)} · Flat {rejecting.flats?.flat_number ?? '—'} · {formatINR(rejecting.amount_paid ?? rejecting.amount)}
          </p>
          <label>Reason (optional)
            <input autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Payment not received" />
          </label>
          <div className="row">
            <button className="danger-btn" disabled={busyId === rejecting.id} onClick={confirmReject}>Reject payment</button>
            <button className="secondary" onClick={() => setRejecting(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
