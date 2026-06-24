import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/AuthContext';
import Modal from './Modal';

/** Lets a logged-in user change their password (verifies the current one first). */
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== confirm) { setErr('New passwords do not match.'); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <>
          <p>Your password has been updated.</p>
          <button onClick={onClose}>Done</button>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <label>Current password
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
          </label>
          <label>New password
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={6} required />
          </label>
          <label>Confirm new password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={6} required />
          </label>
          {err && <p className="error">{err}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>
      )}
    </Modal>
  );
}
