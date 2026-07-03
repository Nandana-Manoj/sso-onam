import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import Modal from './Modal';

// Free-text feedback from reps/admins for the developer. role and
// submitted_by_user_id are derived server-side (not sent by the client) —
// see supabase/migrations/20260703093000_phase3_03_suggestions.sql.
export default function SuggestionModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) { setErr('Please write a suggestion first.'); return; }
    setErr(null);
    setBusy(true);
    const { error } = await supabase.from('suggestions').insert({ message: message.trim() });
    setBusy(false);
    if (error) setErr(error.message);
    else setDone(true);
  }

  return (
    <Modal title="Suggest an Improvement" onClose={onClose}>
      {done ? (
        <>
          <p>Thanks — your suggestion has been sent. 🙌</p>
          <button onClick={onClose}>Done</button>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <p className="muted" style={{ marginTop: 0 }}>
            Spot something that could work better? Tell us — this goes straight to the developer.
          </p>
          <label>Your Suggestion
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. It would help if the rep dashboard showed..."
              required
            />
          </label>
          {err && <p className="error">{err}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send Suggestion'}</button>
        </form>
      )}
    </Modal>
  );
}
