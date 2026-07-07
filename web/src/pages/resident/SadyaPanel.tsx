import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatINR } from '../../lib/format';
import { saveImage } from '../../lib/ui';
import { DownloadIcon } from '../../components/Icons';
import RepPayBox from '../../components/RepPayBox';
import Stepper from '../../components/Stepper';
import Modal from '../../components/Modal';
import type { EventConfig, SadyaBooking, SadyaCancellation, QrPass } from '../../lib/types';

export default function SadyaPanel({ event }: { event: EventConfig }) {
  const { profile } = useAuth();
  const [bookings, setBookings] = useState<SadyaBooking[]>([]);
  const [cancellations, setCancellations] = useState<SadyaCancellation[]>([]);
  const [flatPass, setFlatPass] = useState<QrPass | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // new-booking form (adults only — kids no longer get a separate sadya pass)
  const [adults, setAdults] = useState(1);
  const children = 0;

  // cancel-tickets-for-a-refund flow
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelAdults, setCancelAdults] = useState(0);
  const [cancelChildren, setCancelChildren] = useState(0);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }
    // Resident's own bookings (oldest first → a freshly created one shows last,
    // next to the form rather than jumping above the flat QR).
    const [{ data, error: e }, { data: cx }] = await Promise.all([
      supabase
        .from('sadya_bookings')
        .select('*')
        .eq('resident_id', profile.id)
        .eq('event_id', event.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('sadya_cancellations')
        .select('*')
        .eq('resident_id', profile.id)
        .eq('event_id', event.id)
        .order('created_at', { ascending: true }),
    ]);
    if (e) setError(e.message);
    setBookings((data as SadyaBooking[]) ?? []);
    setCancellations((cx as SadyaCancellation[]) ?? []);

    // The flat's single QR pass (covers every verified booking for the flat).
    if (profile.flat_id) {
      const { data: qp } = await supabase
        .from('qr_passes')
        .select('*')
        .eq('flat_id', profile.flat_id)
        .eq('event_id', event.id)
        .maybeSingle();
      setFlatPass((qp as QrPass | null) ?? null);
    } else {
      setFlatPass(null);
    }
    setLoading(false);
  }, [profile?.id, profile?.flat_id, event.id]);

  useEffect(() => { load(); }, [load]);

  const newTotal = adults * event.adult_sadya_price + children * event.child_sadya_price;

  async function createBooking(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (adults < 1) { setError('Add at least one person.'); return; }
    setBusy(true);
    const { error: e1 } = await supabase.rpc('create_sadya_booking', {
      p_num_adults: adults,
      p_num_children: 0,
    });
    setBusy(false);
    if (e1) setError(e1.message);
    else { setAdults(1); load(); }
  }

  async function submitPayment(booking: SadyaBooking, utr: string) {
    setError(null);
    setBusy(true);
    const { error: e1 } = await supabase.rpc('submit_sadya_payment', {
      p_booking_id: booking.id,
      p_amount_paid: booking.total_amount,
      p_utr: utr.trim() || null,
    });
    setBusy(false);
    if (e1) setError(e1.message);
    else load();
  }

  async function cancelBooking(booking: SadyaBooking) {
    setError(null);
    setBusy(true);
    const { error: e1 } = await supabase.rpc('cancel_sadya_booking', {
      p_booking_id: booking.id,
      p_reason: null,
    });
    setBusy(false);
    if (e1) setError(e1.message);
    else load();
  }

  async function requestCancellation() {
    setError(null);
    setBusy(true);
    const { error: e1 } = await supabase.rpc('request_sadya_cancellation', {
      p_num_adults: cancelAdults,
      p_num_children: cancelChildren,
      p_reason: cancelReason.trim() || null,
    });
    setBusy(false);
    setCancelOpen(false);
    setCancelAdults(0); setCancelChildren(0); setCancelReason('');
    if (e1) setError(e1.message);
    else load();
  }

  // Gate: dormant until an admin opens sadya booking for this event.
  if (!event.sadya_open) {
    return (
      <div className="card disabled">
        <h3>Book Sadya 🍛</h3>
        <p className="muted" style={{ margin: 0 }}>
          Sadya booking isn't open yet. You'll be able to book here once the committee opens it.
        </p>
      </div>
    );
  }

  if (loading) return <div className="card"><h3>Book Sadya 🍛</h3><p className="muted">Loading…</p></div>;

  const inProgress = bookings.filter((b) => b.status === 'payment_pending' || b.status === 'submitted');
  const verifiedBookings = bookings.filter((b) => b.status === 'verified');
  const verifiedCount = verifiedBookings.length;
  const peopleLabel = (a: number, c: number) =>
    `${a} adult${a === 1 ? '' : 's'}` + (c ? ` · ${c} child${c === 1 ? '' : 'ren'}` : '');

  // What's still cancellable = verified tickets minus already-cancelled ones.
  const bookedAdults = verifiedBookings.reduce((s, b) => s + b.num_adults, 0);
  const bookedChildren = verifiedBookings.reduce((s, b) => s + b.num_children, 0);
  const cancelledAdults = cancellations.reduce((s, c) => s + c.num_adults, 0);
  const cancelledChildren = cancellations.reduce((s, c) => s + c.num_children, 0);
  const availAdults = Math.max(0, bookedAdults - cancelledAdults);
  const availChildren = Math.max(0, bookedChildren - cancelledChildren);
  const cancelRefund = cancelAdults * event.adult_sadya_price + cancelChildren * event.child_sadya_price;
  const cancelCount = cancelAdults + cancelChildren;

  return (
    <div className="card">
      <h3>Book Sadya 🍛</h3>
      <p className="muted">
        {formatINR(event.adult_sadya_price)} per adult. You can make more than one booking (e.g. for
        guests) — they all share one flat pass.
      </p>

      {/* The flat's single QR — stays at the top so new bookings don't push it down. */}
      {flatPass && flatPass.status !== 'void' && <FlatQrCard pass={flatPass} />}

      {verifiedCount > 0 && !flatPass && (
        <p className="muted">Your sadya is confirmed — your flat's QR pass is being prepared.</p>
      )}

      {/* In-progress bookings (pay / awaiting). Each carries its own payment box. */}
      {inProgress.length > 0 && (
        <ul className="list" style={{ marginTop: '0.5rem' }}>
          {inProgress.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              towerId={profile?.tower_id}
              eventName={event.name}
              busy={busy}
              onSubmit={submitPayment}
              onCancel={cancelBooking}
            />
          ))}
        </ul>
      )}

      {/* Confirmed bookings + refunds — tucked into a toggle so the card stays tidy. */}
      {(verifiedBookings.length > 0 || cancellations.length > 0) && (
        <details className="disclosure" style={{ marginTop: '0.6rem' }}>
          <summary>
            Your Bookings &amp; Refunds
            {' '}({verifiedCount} confirmed{cancellations.length > 0 ? ` · ${cancellations.length} refund${cancellations.length === 1 ? '' : 's'}` : ''})
          </summary>

          {verifiedBookings.length > 0 && (
            <ul className="list" style={{ marginTop: '0.6rem' }}>
              {verifiedBookings.map((b) => (
                <li key={b.id} className="card card-accent">
                  <p className="success" style={{ margin: 0 }}>
                    ✓ <strong>{peopleLabel(b.num_adults, b.num_children)}</strong> · {formatINR(b.amount_paid ?? b.total_amount)} confirmed
                  </p>
                </li>
              ))}
            </ul>
          )}

          {cancellations.length > 0 && (
            <ul className="list" style={{ marginTop: '0.5rem' }}>
              {cancellations.map((c) => (
                <li key={c.id} className="card">
                  <p className="muted" style={{ margin: 0 }}>
                    {c.status === 'refunded' ? '↩ Refunded' : '⏳ Cancellation requested'}:{' '}
                    <strong>{peopleLabel(c.num_adults, c.num_children)}</strong> · {formatINR(c.amount)}
                    {c.status === 'requested' ? ' — your tower rep will pay you back and confirm it.' : '.'}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {availAdults + availChildren > 0 && (
            <button
              type="button"
              className="danger-btn"
              style={{ marginTop: '0.6rem' }}
              disabled={busy}
              onClick={() => { setCancelAdults(0); setCancelChildren(0); setCancelReason(''); setCancelOpen(true); }}
            >
              Cancel &amp; Request Refund
            </button>
          )}
        </details>
      )}

      <details className="disclosure" style={{ marginTop: '0.6rem' }} open={inProgress.length === 0}>
        <summary>New Sadya Booking</summary>
        <form onSubmit={createBooking} style={{ marginTop: '0.6rem' }}>
          <label>Adults
            <Stepper value={adults} onChange={setAdults} min={0} />
          </label>
          <p style={{ margin: '0.4rem 0' }}>
            Total: <strong>{formatINR(newTotal)}</strong> for {adults} {adults === 1 ? 'person' : 'people'}
          </p>
          <button type="submit" disabled={busy || adults < 1}>Create Booking</button>
        </form>
      </details>

      {error && <p className="error">{error}</p>}

      {cancelOpen && (
        <Modal title="Cancel Tickets & Request a Refund" onClose={() => setCancelOpen(false)}>
          <p className="muted">
            Choose how many tickets to cancel. Your tower rep will pay you back and confirm it. Cancelled
            tickets are removed from your flat's QR pass straight away.
          </p>
          <div className="grid cols-2">
            <label>Adults to cancel (max {availAdults})
              <Stepper value={cancelAdults} onChange={setCancelAdults} min={0} max={availAdults} />
            </label>
            <label>Children to cancel (max {availChildren})
              <Stepper value={cancelChildren} onChange={setCancelChildren} min={0} max={availChildren} />
            </label>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            Refund: <strong>{formatINR(cancelRefund)}</strong> for {cancelCount} {cancelCount === 1 ? 'ticket' : 'tickets'}
          </p>
          <div className="row">
            <button className="danger-btn" disabled={busy || cancelCount < 1} onClick={requestCancellation}>Request Refund</button>
            <button className="secondary" onClick={() => setCancelOpen(false)}>Keep Tickets</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FlatQrCard({ pass }: { pass: QrPass }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(pass.nonce, { width: 320, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [pass.nonce]);

  async function save() {
    if (!dataUrl) return;
    setSaving(true);
    try {
      await saveImage(dataUrl, `onam-sadya-pass-${pass.id.slice(0, 8)}.png`);
    } finally {
      setSaving(false);
    }
  }

  const remaining = pass.allowed_scans - pass.redeemed_count;

  return (
    <div className="card card-accent">
      <p className="success" style={{ marginTop: 0 }}>
        ✓ Your flat's sadya pass — good for {pass.allowed_scans} {pass.allowed_scans === 1 ? 'meal' : 'meals'}.
        Show this QR at the counter; it covers everyone in your flat's bookings.
      </p>
      {dataUrl ? (
        <>
          <img
            src={dataUrl}
            alt="Flat sadya QR pass"
            style={{ maxWidth: 240, border: '1px solid var(--line)', borderRadius: 10, display: 'block' }}
          />
          {pass.redeemed_count > 0 && (
            <p className="muted" style={{ margin: '0.3rem 0' }}>{remaining} of {pass.allowed_scans} remaining.</p>
          )}
          <button type="button" className="secondary icon-text" disabled={saving} onClick={save}>
            <DownloadIcon /> {saving ? 'Saving…' : 'Save Pass to Phone'}
          </button>
        </>
      ) : (
        <p className="muted">Preparing QR…</p>
      )}
    </div>
  );
}

function BookingCard({
  booking, towerId, eventName, busy, onSubmit, onCancel,
}: {
  booking: SadyaBooking;
  towerId: string | null | undefined;
  eventName: string;
  busy: boolean;
  onSubmit: (b: SadyaBooking, utr: string) => void;
  onCancel: (b: SadyaBooking) => void;
}) {
  const [utr, setUtr] = useState('');
  const people = `${booking.num_adults} adult${booking.num_adults === 1 ? '' : 's'}`
    + (booking.num_children ? ` · ${booking.num_children} child${booking.num_children === 1 ? '' : 'ren'}` : '');

  return (
    <li className="card card-accent">
      <p style={{ margin: '0 0 0.4rem' }}>
        <strong>{people}</strong> · {formatINR(booking.total_amount)}
      </p>

      {booking.status === 'payment_pending' && (
        <>
          <RepPayBox
            towerId={towerId}
            amount={booking.total_amount}
            note={`${eventName} sadya`}
            qrKey={towerId ?? undefined}
          />
          <label style={{ marginTop: '0.6rem' }}>UTR / reference (optional)
            <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UPI transaction ref" />
          </label>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => onSubmit(booking, utr)}>
              I've paid {formatINR(booking.total_amount)} — submit
            </button>
            <button type="button" className="danger-btn" disabled={busy} onClick={() => onCancel(booking)}>Cancel</button>
          </div>
        </>
      )}

      {booking.status === 'submitted' && (
        <>
          <p style={{ margin: 0 }}>
            Payment of <strong>{formatINR(booking.amount_paid ?? booking.total_amount)}</strong> submitted
            {booking.utr ? ` (UTR ${booking.utr})` : ''}. Awaiting verification by your tower rep.
          </p>
          <button type="button" className="danger-btn" style={{ marginTop: '0.5rem' }} disabled={busy} onClick={() => onCancel(booking)}>
            Cancel Booking
          </button>
        </>
      )}
    </li>
  );
}
