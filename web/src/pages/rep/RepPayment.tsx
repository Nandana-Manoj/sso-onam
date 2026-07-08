import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { assetUrl } from '../../lib/ui';
import { useRepData } from './useRepData';

/** The rep's payment details (UPI ID, payment number, name, QR) shown to
 *  residents. Applies to every tower the rep manages. */
export default function RepPayment() {
  const { profile } = useAuth();
  const { loading, towers } = useRepData();

  const [contact, setContact] = useState('');
  const [upiId, setUpiId] = useState('');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrBust, setQrBust] = useState(0);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactMsg, setContactMsg] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Payment details apply to all managed towers — seed the form from the first.
  useEffect(() => {
    if (seeded || towers.length === 0) return;
    const t = towers[0];
    setContact(t.rep_contact ?? '');
    setUpiId(t.rep_upi_id ?? '');
    setPaymentPhone(t.rep_payment_phone ?? '');
    setQrPath(t.payment_qr_path ?? null);
    setSeeded(true);
  }, [towers, seeded]);

  const qrUrl = qrPath ? `${assetUrl('rep-qr', qrPath)}${qrBust ? `?v=${qrBust}` : ''}` : null;

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
    const e = await persist(qrPath);
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

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <p className="page-back"><Link to="/rep">← Rep Tools</Link></p>
      <h2>Payment Details</h2>
      <div className="card card-accent">
        <p className="muted" style={{ marginTop: 0 }}>
          Used by residents in <strong>all towers you manage</strong>. Shown to residents making a contribution, so they can copy it and pay you directly.
        </p>
        <label>UPI ID (shown to residents making a contribution, to copy &amp; pay)
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
      </div>
    </div>
  );
}
