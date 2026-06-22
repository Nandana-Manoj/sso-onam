import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatINR } from '../../lib/format';
import { assetUrl } from '../../lib/ui';
import OfflinePaymentForm from '../../components/OfflinePaymentForm';
import type { Contribution, ContributionStatus } from '../../lib/types';

interface QueueRow extends Contribution {
  flats: { flat_number: string } | null;
}
interface Flat { id: string; flat_number: string; }
interface Mini { flat_id: string; status: ContributionStatus; }

type FlatState = 'verified' | 'awaiting' | 'pending' | 'none';
const PRIORITY: Record<ContributionStatus, number> = {
  verified: 4, submitted: 3, payment_pending: 2, rejected: 1, expired: 0,
};
const STATE_LABEL: Record<FlatState, string> = {
  verified: 'Verified', awaiting: 'Awaiting', pending: 'Started', none: 'Not started',
};

export default function RepHome() {
  const { profile } = useAuth();
  const [towerName, setTowerName] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [flats, setFlats] = useState<Flat[]>([]);
  const [contribs, setContribs] = useState<Mini[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // own payment details
  const [contact, setContact] = useState('');
  const [upiId, setUpiId] = useState('');
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrBust, setQrBust] = useState(0);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactMsg, setContactMsg] = useState<string | null>(null);

  const qrUrl = qrPath ? `${assetUrl('rep-qr', qrPath)}${qrBust ? `?v=${qrBust}` : ''}` : null;

  useEffect(() => {
    if (!profile?.tower_id) return;
    supabase
      .from('towers')
      .select('name, rep_contact, rep_upi_id, payment_qr_path')
      .eq('id', profile.tower_id)
      .maybeSingle()
      .then(({ data }) => {
        const t = data as { name: string; rep_contact: string | null; rep_upi_id: string | null; payment_qr_path: string | null } | null;
        setTowerName(t?.name ?? null);
        setContact(t?.rep_contact ?? '');
        setUpiId(t?.rep_upi_id ?? '');
        setQrPath(t?.payment_qr_path ?? null);
      });
  }, [profile?.tower_id]);

  const loadData = useCallback(async () => {
    if (!profile?.tower_id) { setLoading(false); return; }
    const [{ data: q, error: e1 }, { data: fl }, { data: c }] = await Promise.all([
      supabase
        .from('contributions')
        .select('*, flats(flat_number)')
        .eq('paid_to_tower_id', profile.tower_id)
        .eq('status', 'submitted')
        .order('payment_submitted_at', { ascending: true }),
      supabase.from('flats').select('id, flat_number').eq('tower_id', profile.tower_id).order('flat_number'),
      supabase.from('contributions').select('flat_id, status').eq('paid_to_tower_id', profile.tower_id),
    ]);
    if (e1) setError(e1.message);
    setQueue((q as QueueRow[]) ?? []);
    setFlats((fl as Flat[]) ?? []);
    setContribs((c as Mini[]) ?? []);
    setLoading(false);
  }, [profile?.tower_id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function persist(qrPathToSave: string | null) {
    const { error: e } = await supabase.rpc('set_my_rep_payment', {
      p_contact: contact.trim() || null,
      p_upi_id: upiId.trim() || null,
      p_qr_path: qrPathToSave,
    });
    return e;
  }
  async function savePayment() {
    setContactMsg(null);
    setContactBusy(true);
    const e = await persist(null);
    setContactBusy(false);
    setContactMsg(e ? e.message : 'Saved — residents will see this when they pay.');
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

  async function decide(row: QueueRow, approve: boolean) {
    setError(null);
    let reason: string | null = null;
    if (!approve) reason = window.prompt('Reason for rejection (optional):') ?? null;
    setBusyId(row.id);
    const { error: e } = await supabase.rpc('verify_contribution', {
      p_contribution_id: row.id, p_approve: approve, p_reason: reason,
    });
    setBusyId(null);
    if (e) setError(e.message);
    else loadData();
  }

  // flat states
  const best = new Map<string, ContributionStatus>();
  for (const c of contribs) {
    const cur = best.get(c.flat_id);
    if (!cur || PRIORITY[c.status] > PRIORITY[cur]) best.set(c.flat_id, c.status);
  }
  const stateOf = (id: string): FlatState => {
    const s = best.get(id);
    return s === 'verified' ? 'verified' : s === 'submitted' ? 'awaiting' : s === 'payment_pending' ? 'pending' : 'none';
  };
  const verifiedCount = flats.filter((f) => stateOf(f.id) === 'verified').length;

  return (
    <div className="page">
      <div className="hero">
        <h2>Tower Representative</h2>
        <p className="hero-sub">You manage <strong>{towerName ?? '—'}</strong> · {verifiedCount}/{flats.length} flats paid</p>
      </div>

      <div className="card card-accent">
        <h3>Your payment details</h3>
        <p className="muted">Residents in your tower use these to pay you — a UPI ID (for tap-to-pay), your name/phone, and your QR.</p>
        <label>UPI ID
          <input placeholder="e.g. ravi@okaxis" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
        </label>
        <label>Your name / phone (shown to residents)
          <input placeholder="e.g. Ravi · 98765 43210" value={contact} onChange={(e) => setContact(e.target.value)} />
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
      {loading ? (
        <p className="muted">Loading…</p>
      ) : queue.length === 0 ? (
        <div className="card"><p className="muted">No payments waiting for verification. 🎉</p></div>
      ) : (
        <ul className="list">
          {queue.map((row) => (
            <li key={row.id} className="card card-accent">
              <p style={{ margin: '0 0 0.3rem' }}>
                <strong>Flat {row.flats?.flat_number ?? '—'}</strong> · paid{' '}
                <strong>{formatINR(row.amount_paid ?? row.amount)}</strong>
                {row.utr ? <> · UTR <code>{row.utr}</code></> : <span className="muted"> · no UTR</span>}
              </p>
              <p className="muted" style={{ margin: '0 0 0.4rem' }}>
                Pledged {formatINR(row.amount)}
                {row.payment_submitted_at ? ` · submitted ${new Date(row.payment_submitted_at).toLocaleString()}` : ''}
              </p>
              <div className="row">
                <button className="success-btn" disabled={busyId === row.id} onClick={() => decide(row, true)}>Approve</button>
                <button className="danger-btn" disabled={busyId === row.id} onClick={() => decide(row, false)}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}

      <div className="card card-accent">
        <h3>Record a walk-in / offline payment</h3>
        <p className="muted">For residents who paid you directly without using the app. This marks the flat as paid (verified).</p>
        {profile?.tower_id && (
          <OfflinePaymentForm towerId={profile.tower_id} onRecorded={loadData} />
        )}
      </div>

      <div className="section-title"><h3>Tower progress</h3></div>
      <div className="card">
        {flats.length === 0 ? (
          <p className="muted">No flats registered in your tower yet.</p>
        ) : (
          <div className="flat-grid">
            {flats.map((f) => {
              const st = stateOf(f.id);
              return (
                <span key={f.id} className={`flat-pill ${st}`}>
                  <span className="dot" />{f.flat_number}
                  <span className="muted" style={{ fontSize: '0.72rem' }}>· {STATE_LABEL[st]}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="card disabled">
        <h3>Collections · Handovers · Scan</h3>
        <p className="muted">Coming in later phases.</p>
      </div>
    </div>
  );
}
