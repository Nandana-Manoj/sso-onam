import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/format';
import Stepper from './Stepper';

type Kind = 'contribution' | 'sadya';

/**
 * Record a payment for someone who paid the rep directly (cash/UPI) without
 * using the app. Handles both a flat contribution and a sadya booking; the
 * latter is offered only when `sadyaPrices` is provided. Reps pass a fixed
 * `towerId`; admins pass `towers` for a picker.
 */
export default function OfflinePaymentForm({
  towerId,
  towers,
  sadyaPrices,
  sadyaClosedNote,
  onRecorded,
}: {
  towerId?: string;
  towers?: { id: string; name: string }[];
  sadyaPrices?: { adult: number; child: number };
  /** Shown instead of the Sadya tab when sadyaPrices is omitted because booking isn't open. */
  sadyaClosedNote?: string;
  onRecorded: () => void;
}) {
  const [kind, setKind] = useState<Kind>('contribution');
  const [selTower, setSelTower] = useState('');
  const [flat, setFlat] = useState('');
  const [amount, setAmount] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tower = towerId ?? selTower;
  const sadyaTotal = sadyaPrices ? adults * sadyaPrices.adult + children * sadyaPrices.child : 0;

  function reset() {
    setFlat(''); setAmount(''); setAdults(1); setChildren(0); setUtr(''); setNote('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { error } = kind === 'sadya'
      ? await supabase.rpc('record_offline_sadya', {
          p_tower_id: tower,
          p_flat_number: flat.trim(),
          p_num_adults: adults,
          p_num_children: children,
          p_utr: utr.trim() || null,
          p_note: note.trim() || null,
        })
      : await supabase.rpc('record_offline_contribution', {
          p_tower_id: tower,
          p_flat_number: flat.trim(),
          p_amount: Number(amount),
          p_utr: utr.trim() || null,
          p_note: note.trim() || null,
        });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg(kind === 'sadya'
        ? `Recorded ✓ Sadya for Flat ${flat.trim()} confirmed (${adults + children} ${adults + children === 1 ? 'pass' : 'passes'}).`
        : `Recorded ✓ Flat ${flat.trim()} marked as paid.`);
      reset();
      onRecorded();
    }
  }

  const isSadya = kind === 'sadya';
  const disableSubmit = busy || !tower || !flat.trim()
    || (isSadya ? adults + children < 1 : !(Number(amount) > 0));

  return (
    <form onSubmit={submit}>
      {sadyaPrices && (
        <div className="row" style={{ gap: '0.4rem' }}>
          <button type="button" className={kind === 'contribution' ? '' : 'secondary'} style={{ flex: 1 }}
            onClick={() => { setKind('contribution'); setMsg(null); }}>Contribution</button>
          <button type="button" className={isSadya ? '' : 'secondary'} style={{ flex: 1 }}
            onClick={() => { setKind('sadya'); setMsg(null); }}>Sadya</button>
        </div>
      )}
      {!sadyaPrices && sadyaClosedNote && (
        <p className="muted" style={{ marginTop: 0 }}>{sadyaClosedNote}</p>
      )}

      {towers && (
        <label>Tower
          <select value={selTower} onChange={(e) => setSelTower(e.target.value)} required>
            <option value="" disabled>Select Tower</option>
            {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}

      {isSadya ? (
        <>
          <label>Flat Number<input value={flat} onChange={(e) => setFlat(e.target.value)} required /></label>
          <div className="grid cols-2">
            <label>Adults<Stepper value={adults} onChange={setAdults} min={0} /></label>
            <label>Children (under 5)<Stepper value={children} onChange={setChildren} min={0} /></label>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            Total: <strong>{formatINR(sadyaTotal)}</strong> for {adults + children} {adults + children === 1 ? 'pass' : 'passes'}
          </p>
        </>
      ) : (
        <div className="grid cols-2">
          <label>Flat Number<input value={flat} onChange={(e) => setFlat(e.target.value)} required /></label>
          <label>Amount (₹)<input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
        </div>
      )}

      <label>UTR / Reference (optional)<input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UPI ref, if any" /></label>
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid cash in person" /></label>
      <button type="submit" disabled={disableSubmit}>{isSadya ? 'Record Sadya Booking' : 'Record Payment'}</button>
      {msg && <p className={msg.startsWith('Recorded') ? 'success' : 'error'}>{msg}</p>}
    </form>
  );
}
