import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatINR } from '../../lib/format';
import RepPayBox from '../../components/RepPayBox';
import Modal from '../../components/Modal';
import type { Contribution, EventConfig } from '../../lib/types';

const LIVE: Contribution['status'][] = ['payment_pending', 'submitted', 'verified'];

export default function ContributionPanel({ event }: { event: EventConfig }) {
  const { profile } = useAuth();
  const [contribution, setContribution] = useState<Contribution | null>(null);
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

  // Friendly wording for the one error residents actually hit — paying below the
  // event minimum. Replaces the raw "Amount must be at least 2000.00" from the DB.
  const belowMinMsg = `The minimum contribution is ${formatINR(event.min_contribution)}. Please enter ${formatINR(event.min_contribution)} or more.`;
  const niceError = (msg: string) => (/at least/i.test(msg) ? belowMinMsg : msg);

  async function startContribution(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (Number(amount) < event.min_contribution) { setError(belowMinMsg); return; }
    setBusy(true);
    const { error: e1 } = await supabase.rpc('create_contribution', { p_amount: Number(amount) });
    setBusy(false);
    if (e1) setError(niceError(e1.message));
    else load();
  }

  async function submitPayment(e: FormEvent) {
    e.preventDefault();
    if (!contribution) return;
    setError(null);
    const paid = Number(amountPaid) || contribution.amount;
    if (paid < event.min_contribution) { setError(belowMinMsg); return; }
    setBusy(true);
    const { error: e1 } = await supabase.rpc('submit_contribution_payment', {
      p_contribution_id: contribution.id,
      p_amount_paid: paid,
      p_utr: utr.trim() || null,
    });
    setBusy(false);
    if (e1) setError(niceError(e1.message));
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
      <h3>Flat Contribution</h3>

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
                min={0}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>Start Contribution</button>
          </form>
        </>
      )}

      {/* Pending payment → show rep + record payment */}
      {contribution?.status === 'payment_pending' && (() => {
        const payAmount = Number(amountPaid) || contribution.amount;
        const belowMin = payAmount < event.min_contribution;
        return (
          <>
            <p>
              <strong>{formatINR(contribution.amount)}</strong> — pay your tower rep, then submit below.
            </p>
            <label>Amount to Pay (₹)
              <input
                type="number"
                min={0}
                step="1"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
            </label>

            {belowMin ? (
              <p className="error">{belowMinMsg}</p>
            ) : (
              <RepPayBox
                towerId={profile?.tower_id}
                amount={payAmount}
                note={`${event.name} contribution`}
                qrKey={profile?.tower_id ?? undefined}
              />
            )}
            <form onSubmit={submitPayment}>
              <label>
                UTR / reference (optional)
                <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UPI transaction ref" />
              </label>
              <button type="submit" disabled={busy || belowMin}>
                I've paid {formatINR(payAmount)} — submit for verification
              </button>
            </form>
          </>
        );
      })()}

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
              Cancel &amp; Request Refund
            </button>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      {refundOpen && (
        <Modal title="Cancel & Request a Refund?" onClose={() => setRefundOpen(false)}>
          <p className="muted">
            Your tower rep will pay you back and confirm it. Once refunded, this contribution no longer counts and your flat can contribute again.
          </p>
          <label>Reason (optional)
            <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. paid twice by mistake" />
          </label>
          <div className="row">
            <button className="danger-btn" disabled={busy} onClick={requestRefund}>Request Refund</button>
            <button className="secondary" onClick={() => setRefundOpen(false)}>Keep Contribution</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
