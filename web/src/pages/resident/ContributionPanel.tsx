import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatINR } from '../../lib/format';
import { buildUpiLink, saveImage } from '../../lib/ui';
import { CopyIcon, CheckIcon, DownloadIcon } from '../../components/Icons';
import Modal from '../../components/Modal';
import type { Contribution, EventConfig } from '../../lib/types';

const LIVE: Contribution['status'][] = ['payment_pending', 'submitted', 'verified'];

export default function ContributionPanel({ event }: { event: EventConfig }) {
  const { profile } = useAuth();
  const [contribution, setContribution] = useState<Contribution | null>(null);
  const [repContact, setRepContact] = useState<string | null>(null);
  const [repUpiId, setRepUpiId] = useState<string | null>(null);
  const [repPhone, setRepPhone] = useState<string | null>(null);
  const [repQrUrl, setRepQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingQr, setSavingQr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form fields
  const [amount, setAmount] = useState(String(event.min_contribution));
  const [amountPaid, setAmountPaid] = useState('');
  const [utr, setUtr] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');

  const load = useCallback(async () => {
    if (!profile?.flat_id) {
      setLoading(false);
      return;
    }
    const { data, error: e } = await supabase
      .from('contributions')
      .select('*')
      .eq('flat_id', profile.flat_id)
      .eq('event_id', event.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e) setError(e.message);
    setContribution((data as Contribution | null) ?? null);
    setLoading(false);
  }, [profile?.flat_id, event.id]);

  useEffect(() => {
    load();
  }, [load]);

  // prefill the "amount paid" with the pledged amount once a pending contribution appears
  useEffect(() => {
    if (contribution?.status === 'payment_pending') setAmountPaid(String(contribution.amount));
  }, [contribution?.id, contribution?.status, contribution?.amount]);

  useEffect(() => {
    if (!profile?.tower_id) return;
    supabase
      .from('towers')
      .select('rep_contact, rep_upi_id, rep_payment_phone, payment_qr_path')
      .eq('id', profile.tower_id)
      .maybeSingle()
      .then(({ data }) => {
        const t = data as {
          rep_contact: string | null; rep_upi_id: string | null;
          rep_payment_phone: string | null; payment_qr_path: string | null;
        } | null;
        setRepContact(t?.rep_contact ?? null);
        setRepUpiId(t?.rep_upi_id ?? null);
        setRepPhone(t?.rep_payment_phone ?? null);
        setRepQrUrl(
          t?.payment_qr_path
            ? supabase.storage.from('rep-qr').getPublicUrl(t.payment_qr_path).data.publicUrl
            : null,
        );
      });
  }, [profile?.tower_id]);

  async function copyPhone() {
    if (!repPhone) return;
    try {
      await navigator.clipboard.writeText(repPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy — please copy it manually.');
    }
  }

  async function saveQr() {
    if (!repQrUrl) return;
    setSavingQr(true);
    try {
      await saveImage(repQrUrl, `onam-upi-qr-${profile?.tower_id ?? 'rep'}.png`);
    } catch {
      setError('Could not save the QR — long-press the image to save it instead.');
    } finally {
      setSavingQr(false);
    }
  }

  async function startContribution(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: e1 } = await supabase.rpc('create_contribution', { p_amount: Number(amount) });
    setBusy(false);
    if (e1) setError(e1.message);
    else load();
  }

  async function submitPayment(e: FormEvent) {
    e.preventDefault();
    if (!contribution) return;
    setError(null);
    setBusy(true);
    const { error: e1 } = await supabase.rpc('submit_contribution_payment', {
      p_contribution_id: contribution.id,
      p_amount_paid: Number(amountPaid) || contribution.amount,
      p_utr: utr.trim() || null,
    });
    setBusy(false);
    if (e1) setError(e1.message);
    else {
      setUtr('');
      load();
    }
  }

  async function requestRefund() {
    if (!contribution) return;
    setError(null);
    setBusy(true);
    const { error: e1 } = await supabase.rpc('request_refund', {
      p_contribution_id: contribution.id,
      p_reason: refundReason.trim() || null,
    });
    setBusy(false);
    setRefundOpen(false);
    setRefundReason('');
    if (e1) setError(e1.message);
    else load();
  }

  if (loading) return <div className="card"><h3>Contribution</h3><p className="muted">Loading…</p></div>;

  // a refunded contribution frees the flat to contribute again
  const live = !!contribution && LIVE.includes(contribution.status) && contribution.refund_state !== 'refunded';

  return (
    <div className="card">
      <h3>Flat contribution</h3>

      {/* No live contribution → start one */}
      {!live && (
        <>
          {contribution?.status === 'rejected' && (
            <p className="error">
              Your previous attempt was rejected
              {contribution.decision_reason ? `: ${contribution.decision_reason}` : ''}. You can try again.
            </p>
          )}
          {contribution?.refund_state === 'refunded' && (
            <p className="success">Your earlier contribution was refunded. You can contribute again below.</p>
          )}
          <p className="muted">
            One contribution per flat. Minimum {formatINR(event.min_contribution)}. Any flat member can pay.
          </p>
          <form onSubmit={startContribution}>
            <label>
              Amount (₹)
              <input
                type="number"
                min={event.min_contribution}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>Start contribution</button>
          </form>
        </>
      )}

      {/* Pending payment → show rep + record payment */}
      {contribution?.status === 'payment_pending' && (
        <>
          <p>
            Pledged: <strong>{formatINR(contribution.amount)}</strong> — pay your tower rep, then submit below.
          </p>
          <div className="card">
            <strong>Pay your tower rep{repContact ? ` · ${repContact}` : ''}</strong>

            <label>Amount to pay (₹)
              <input
                type="number"
                min={event.min_contribution}
                step="1"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
            </label>

            {/* 1. Tap-to-pay button (routes to the rep's UPI ID, not shown) */}
            {repUpiId && (
              <a
                className="pay-btn"
                href={buildUpiLink({
                  pa: repUpiId,
                  pn: repContact ?? undefined,
                  am: Number(amountPaid) || contribution.amount,
                  tn: `${event.name} contribution`,
                })}
              >
                Click here to pay Rs. {(Number(amountPaid) || contribution.amount).toLocaleString('en-IN')} towards {event.name}
              </a>
            )}

            {/* 2. Phone number to copy */}
            {repPhone && (
              <div className="row" style={{ marginTop: '0.6rem' }}>
                <span style={{ flex: 1 }}>Or pay this number: <strong>{repPhone}</strong></span>
                <button type="button" className="icon-btn" title="Copy number" onClick={copyPhone}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            )}

            {/* 3. QR in a toggle (closed by default) */}
            {repQrUrl && (
              <details className="disclosure" style={{ marginTop: '0.6rem' }}>
                <summary>Show QR to scan</summary>
                <img
                  src={repQrUrl}
                  alt="Tower rep UPI QR"
                  style={{ maxWidth: 240, border: '1px solid var(--line)', borderRadius: 10, display: 'block', marginTop: '0.5rem' }}
                />
                <button type="button" className="secondary icon-text" disabled={savingQr} onClick={saveQr}>
                  <DownloadIcon /> {savingQr ? 'Saving…' : 'Save QR to phone'}
                </button>
              </details>
            )}

            {!repUpiId && !repPhone && !repQrUrl && (
              <p className="muted">Rep payment details not set yet — please contact your tower rep.</p>
            )}
          </div>
          <form onSubmit={submitPayment}>
            <label>
              UTR / reference (optional)
              <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UPI transaction ref" />
            </label>
            <button type="submit" disabled={busy}>
              I've paid {formatINR(Number(amountPaid) || contribution.amount)} — submit for verification
            </button>
          </form>
        </>
      )}

      {/* Submitted → awaiting rep */}
      {contribution?.status === 'submitted' && (
        <p>
          Payment of <strong>{formatINR(contribution.amount_paid ?? contribution.amount)}</strong> submitted
          {contribution.utr ? ` (UTR ${contribution.utr})` : ''}. Awaiting verification by your tower rep.
        </p>
      )}

      {/* Verified (and not refunded) */}
      {contribution?.status === 'verified' && contribution.refund_state !== 'refunded' && (
        <>
          <p className="success">
            ✓ Received Rs. {(contribution.amount_paid ?? contribution.amount).toLocaleString('en-IN')} towards {event.name}. Thank you!
          </p>
          {contribution.refund_state === 'requested' ? (
            <p className="muted">Refund requested — your tower rep will pay you back and confirm it.</p>
          ) : (
            <button type="button" className="danger-btn" onClick={() => setRefundOpen(true)}>
              Cancel &amp; request refund
            </button>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      {refundOpen && (
        <Modal title="Cancel & request a refund?" onClose={() => setRefundOpen(false)}>
          <p className="muted">
            Your tower rep will pay you back and confirm it. Once refunded, this contribution no longer counts and your flat can contribute again.
          </p>
          <label>Reason (optional)
            <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. paid twice by mistake" />
          </label>
          <div className="row">
            <button className="danger-btn" disabled={busy} onClick={requestRefund}>Request refund</button>
            <button className="secondary" onClick={() => setRefundOpen(false)}>Keep contribution</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
