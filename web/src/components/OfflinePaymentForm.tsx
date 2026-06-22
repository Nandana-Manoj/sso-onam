import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Record a contribution for someone who paid directly (cash/UPI) without using
 * the app. Reps pass a fixed `towerId`; admins pass `towers` for a picker.
 */
export default function OfflinePaymentForm({
  towerId,
  towers,
  onRecorded,
}: {
  towerId?: string;
  towers?: { id: string; name: string }[];
  onRecorded: () => void;
}) {
  const [selTower, setSelTower] = useState('');
  const [flat, setFlat] = useState('');
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tower = towerId ?? selTower;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.rpc('record_offline_contribution', {
      p_tower_id: tower,
      p_flat_number: flat.trim(),
      p_amount: Number(amount),
      p_utr: utr.trim() || null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg(`Recorded ✓ Flat ${flat.trim()} marked as paid.`);
      setFlat(''); setAmount(''); setUtr(''); setNote('');
      onRecorded();
    }
  }

  return (
    <form onSubmit={submit}>
      {towers && (
        <label>Tower
          <select value={selTower} onChange={(e) => setSelTower(e.target.value)} required>
            <option value="" disabled>Select tower</option>
            {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      <div className="grid cols-2">
        <label>Flat number<input value={flat} onChange={(e) => setFlat(e.target.value)} required /></label>
        <label>Amount (₹)<input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
      </div>
      <label>UTR / reference (optional)<input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UPI ref, if any" /></label>
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid cash in person" /></label>
      <button type="submit" disabled={busy || !tower}>Record payment</button>
      {msg && <p className={msg.startsWith('Recorded') ? 'success' : 'error'}>{msg}</p>}
    </form>
  );
}
