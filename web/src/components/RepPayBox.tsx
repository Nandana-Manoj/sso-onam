import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { buildUpiLink, saveImage } from '../lib/ui';
import { CopyIcon, CheckIcon, DownloadIcon } from './Icons';

interface RepDetails {
  rep_contact: string | null;
  rep_upi_id: string | null;
  rep_payment_phone: string | null;
  payment_qr_path: string | null;
}

/**
 * "Pay Your Tower Rep" box — the decentralized payment UI shared by the
 * contribution and sadya flows. Loads the rep's payment details for the given
 * tower and offers three ways to pay: a tap-to-pay UPI button (the rep's UPI ID
 * is never shown), a copyable phone number, and a scannable QR.
 */
export default function RepPayBox({
  towerId,
  amount,
  note,
  qrKey,
}: {
  towerId: string | null | undefined;
  amount: number;
  note: string;
  /** Used to name the saved QR file (e.g. the tower id). */
  qrKey?: string;
}) {
  const [rep, setRep] = useState<RepDetails | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingQr, setSavingQr] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!towerId) return;
    supabase
      .from('towers')
      .select('rep_contact, rep_upi_id, rep_payment_phone, payment_qr_path')
      .eq('id', towerId)
      .maybeSingle()
      .then(({ data }) => {
        const t = (data as RepDetails | null) ?? null;
        setRep(t);
        setQrUrl(
          t?.payment_qr_path
            ? supabase.storage.from('rep-qr').getPublicUrl(t.payment_qr_path).data.publicUrl
            : null,
        );
      });
  }, [towerId]);

  async function copyPhone() {
    if (!rep?.rep_payment_phone) return;
    try {
      await navigator.clipboard.writeText(rep.rep_payment_phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr('Could not copy — please copy it manually.');
    }
  }

  async function saveQr() {
    if (!qrUrl) return;
    setSavingQr(true);
    try {
      await saveImage(qrUrl, `onam-upi-qr-${qrKey ?? 'rep'}.png`);
    } catch {
      setErr('Could not save the QR — long-press the image to save it instead.');
    } finally {
      setSavingQr(false);
    }
  }

  return (
    <div className="card">
      <strong>Pay Your Tower Rep{rep?.rep_contact ? ` · ${rep.rep_contact}` : ''}</strong>

      {/* 1. Tap-to-pay button (routes to the rep's UPI ID, not shown) */}
      {rep?.rep_upi_id && (
        <a
          className="pay-btn"
          href={buildUpiLink({
            pa: rep.rep_upi_id,
            pn: rep.rep_contact ?? undefined,
            am: amount,
            tn: note,
          })}
        >
          Click here to pay Rs. {amount.toLocaleString('en-IN')}
        </a>
      )}

      {/* 2. Phone number to copy */}
      {rep?.rep_payment_phone && (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <span style={{ flex: 1 }}>Or pay this number: <strong>{rep.rep_payment_phone}</strong></span>
          <button type="button" className="icon-btn" title="Copy Number" onClick={copyPhone}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      )}

      {/* 3. QR in a toggle (closed by default) */}
      {qrUrl && (
        <details className="disclosure" style={{ marginTop: '0.6rem' }}>
          <summary>Show QR to Scan</summary>
          <img
            src={qrUrl}
            alt="Tower rep UPI QR"
            style={{ maxWidth: 240, border: '1px solid var(--line)', borderRadius: 10, display: 'block', marginTop: '0.5rem' }}
          />
          <button type="button" className="secondary icon-text" disabled={savingQr} onClick={saveQr}>
            <DownloadIcon /> {savingQr ? 'Saving…' : 'Save QR to Phone'}
          </button>
        </details>
      )}

      {rep && !rep.rep_upi_id && !rep.rep_payment_phone && !qrUrl && (
        <p className="muted">Rep payment details not set yet — please contact your tower rep.</p>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
