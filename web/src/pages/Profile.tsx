import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import ChangePasswordModal from '../components/ChangePasswordModal';
import RequestChangeModal from '../components/RequestChangeModal';

export default function Profile() {
  const { profile, updateName, signOut } = useAuth();
  const [name, setName] = useState(profile?.name ?? '');
  const [flatInfo, setFlatInfo] = useState<{ flat: string; tower: string } | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  // Tower + flat come from the flat row (source of truth), like the header does.
  useEffect(() => {
    if (!profile?.flat_id) return;
    supabase
      .from('flats')
      .select('flat_number, towers(name)')
      .eq('id', profile.flat_id)
      .maybeSingle()
      .then(({ data }) => {
        const f = data as unknown as { flat_number: string; towers: { name: string } | null } | null;
        if (f) setFlatInfo({ flat: f.flat_number, tower: f.towers?.name ?? '—' });
      });
  }, [profile?.flat_id]);

  // Is there already a pending tower/flat change request? (At most one allowed.)
  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('correction_requests')
      .select('id')
      .eq('profile_id', profile.id)
      .eq('status', 'pending')
      .maybeSingle()
      .then(({ data }) => setHasPending(!!data));
  }, [profile?.id]);

  const changed = name.trim() !== (profile?.name ?? '');

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setErr(null); setSaved(false); setBusy(true);
    try {
      await updateName(name);
      setSaved(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <h2>Your Profile</h2>

      {/* Editable details */}
      <form className="card" onSubmit={onSave}>
        <h3>Your Details</h3>
        <p className="muted" style={{ marginTop: 0 }}>You can update these.</p>
        <label>Name
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required />
        </label>
        {err && <p className="error">{err}</p>}
        {saved && <p className="muted">Saved.</p>}
        <button type="submit" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save Changes'}</button>
      </form>

      {/* Locked details — managed elsewhere, changeable only via admin request */}
      <div className="card">
        <h3>Account Info <span className="lock-tag">🔒 Locked</span></h3>
        <p className="muted" style={{ marginTop: 0 }}>
          These can’t be changed here. Your mobile is your verified login ID and can’t be changed.
          For a tower or flat correction, request a change and an admin will review it.
        </p>
        <label>Mobile
          <input value={profile?.mobile ?? ''} readOnly disabled />
        </label>
        <label>Tower
          <input value={flatInfo?.tower ?? '—'} readOnly disabled />
        </label>
        <label>Flat
          <input value={flatInfo?.flat ?? '—'} readOnly disabled />
        </label>
        {hasPending ? (
          <p className="muted">⏳ You have a pending change request awaiting admin review.</p>
        ) : (
          <button type="button" className="secondary" onClick={() => setShowRequest(true)}>
            Request a Tower/Flat Change
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="row">
        <button type="button" onClick={() => setShowPw(true)}>Change Password</button>
        <button type="button" onClick={() => signOut()}>Log Out</button>
      </div>

      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
      {showRequest && (
        <RequestChangeModal
          currentTowerName={flatInfo?.tower ?? '—'}
          currentFlatNumber={flatInfo?.flat ?? '—'}
          onClose={() => setShowRequest(false)}
          onSubmitted={() => setHasPending(true)}
        />
      )}
    </div>
  );
}
