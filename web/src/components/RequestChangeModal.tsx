import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import Modal from './Modal';
import { byName } from '../lib/ui';
import type { PublicTower } from '../lib/types';

// Residents can't edit their tower/flat directly (identity guard). Instead they
// file a correction_request the admin reviews. Mobile is intentionally NOT
// requestable here — it's the verified login ID.
export default function RequestChangeModal({
  currentTowerName,
  currentFlatNumber,
  onClose,
  onSubmitted,
}: {
  currentTowerName: string;
  currentFlatNumber: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { profile } = useAuth();
  const presentFlat = currentFlatNumber === '—' ? '' : currentFlatNumber;
  const [towers, setTowers] = useState<PublicTower[]>([]);
  const [towerId, setTowerId] = useState(profile?.tower_id ?? '');
  const [flatNumber, setFlatNumber] = useState(presentFlat);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.from('public_towers').select('*').order('name').then(({ data }) => {
      setTowers(((data as PublicTower[]) ?? []).sort(byName));
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!profile) { setErr('You must be signed in.'); return; }
    const newFlat = flatNumber.trim().toUpperCase();
    const towerChanged = !!towerId && towerId !== profile.tower_id;
    const flatChanged = !!newFlat && newFlat !== presentFlat.toUpperCase();
    if (!towerChanged && !flatChanged) {
      setErr('Nothing has changed — pick a different tower or flat.');
      return;
    }
    if (!reason.trim()) { setErr('Please add a reason for the admin.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('correction_requests').insert({
        profile_id: profile.id,
        current_tower_id: profile.tower_id,
        current_flat_id: profile.flat_id,
        requested_tower_id: towerId || null,
        requested_flat_number: newFlat || null,
        reason: reason.trim(),
      });
      if (error) {
        // One pending request per resident (unique partial index).
        if (error.code === '23505') {
          throw new Error('You already have a pending request. Please wait for the admin to review it.');
        }
        throw error;
      }
      setDone(true);
      onSubmitted();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Request a Change" onClose={onClose}>
      {done ? (
        <>
          <p>Your request was sent to the admin. You’ll keep your current details until it’s approved.</p>
          <button onClick={onClose}>Done</button>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <p className="muted" style={{ marginTop: 0 }}>
            Currently: {currentTowerName} · Flat {currentFlatNumber}. An admin reviews the change before it applies.
          </p>
          <label>Tower
            <select value={towerId} onChange={(e) => setTowerId(e.target.value)}>
              {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>Flat Number
            <input value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} placeholder="e.g. A-1203" />
          </label>
          <label>Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you requesting this change?" required />
          </label>
          {err && <p className="error">{err}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send Request'}</button>
        </form>
      )}
    </Modal>
  );
}
