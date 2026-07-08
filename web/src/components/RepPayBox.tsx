import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { saveImage } from '../lib/ui';
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
 * tower. The `contribution` variant walks through scan-QR / UPI ID / phone
 * number as plain copyable steps; the default (sadya) variant keeps the
 * phone-number line plus a collapsible, savable QR.
 */
export default function RepPayBox({
  towerId,
  amount,
  note,
  qrKey,
  variant = 'default',
}: {
  towerId: string | null | undefined;
  amount: number;
  note: string;
  /** Used to name the saved QR file (e.g. the tower id). */
  qrKey?: string;
  variant?: 'default' | 'contribution';
}) {
  const [rep, setRep] = useState<RepDetails | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<'phone' | 'upi' | null>(null);
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

  async function copyValue(key: 'phone' | 'upi', value: string | null | undefined) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
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

  // Direct UPI tap-to-pay is disabled for now — residents pay via the steps
  // below instead. Left in place in case we bring it back.
  // {rep?.rep_upi_id && (
  //   <a
  //     className="pay-btn"
  //     href={buildUpiLink({
  //       pa: rep.rep_upi_id,
  //       pn: rep.rep_contact ?? undefined,
  //       am: amount,
  //       tn: note,
  //     })}
  //   >
  //     Click here to pay Rs. {amount.toLocaleString('en-IN')}
  //   </a>
  // )}

  if (variant === 'contribution') {
    return (
      <div className="card">
        <strong>Pay Your Tower Rep{rep?.rep_contact ? ` · ${rep.rep_contact}` : ''}</strong>
        <p className="muted" style={{ margin: '0.3rem 0 0.6rem' }}>
          To make a contribution of Rs. {amount.toLocaleString('en-IN')}:
        </p>
        <ol className="pay-steps">
          {qrUrl && (
            <li>
              Scan this QR code from another phone
              <img
                src={qrUrl}
                alt={`Tower rep UPI QR — ${note}`}
                style={{ maxWidth: 200, border: '1px solid var(--line)', borderRadius: 10, display: 'block', marginTop: '0.5rem' }}
              />
            </li>
          )}
          {rep?.rep_upi_id && (
            <li>
              Pay using UPI ID
              <div className="row" style={{ marginTop: '0.3rem' }}>
                <span className="copy-value" style={{ flex: 1 }}>{rep.rep_upi_id}</span>
                <button type="button" className="icon-btn" title="Copy UPI ID" onClick={() => copyValue('upi', rep.rep_upi_id)}>
                  {copied === 'upi' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </li>
          )}
          {rep?.rep_payment_phone && (
            <li>
              Pay to phone number
              <div className="row" style={{ marginTop: '0.3rem' }}>
                <span className="copy-value" style={{ flex: 1 }}>{rep.rep_payment_phone}</span>
                <button type="button" className="icon-btn" title="Copy Number" onClick={() => copyValue('phone', rep.rep_payment_phone)}>
                  {copied === 'phone' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </li>
          )}
        </ol>

        {rep && !rep.rep_upi_id && !rep.rep_payment_phone && !qrUrl && (
          <p className="muted">Rep payment details not set yet — please contact your tower rep.</p>
        )}
        {err && <p className="error">{err}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <strong>Pay Your Tower Rep{rep?.rep_contact ? ` · ${rep.rep_contact}` : ''}</strong>

      {/* Phone number to copy */}
      {rep?.rep_payment_phone && (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <span style={{ flex: 1 }}>Or pay this number: <strong>{rep.rep_payment_phone}</strong></span>
          <button type="button" className="icon-btn" title="Copy Number" onClick={() => copyValue('phone', rep.rep_payment_phone)}>
            {copied === 'phone' ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      )}

      {/* QR in a toggle (closed by default) */}
      {qrUrl && (
        <details className="disclosure" style={{ marginTop: '0.6rem' }}>
          <summary>Show QR to Scan</summary>
          <img
            src={qrUrl}
            alt={`Tower rep UPI QR — ${note}`}
            style={{ maxWidth: 240, border: '1px solid var(--line)', borderRadius: 10, display: 'block', marginTop: '0.5rem' }}
          />
          <button type="button" className="secondary icon-text" disabled={savingQr} onClick={saveQr}>
            <DownloadIcon /> {savingQr ? 'Saving…' : 'Save QR to Phone'}
          </button>
        </details>
      )}

      {rep && !rep.rep_payment_phone && !qrUrl && (
        <p className="muted">Rep payment details not set yet — please contact your tower rep.</p>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
