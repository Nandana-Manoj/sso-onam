import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { prettyRole } from '../../lib/ui';
import Modal from '../../components/Modal';

interface Person {
  id: string;
  name: string;
  mobile: string;
  role: string;
  is_sadya_rep: boolean;
}

export default function AdminSadyaReps() {
  const [sadyaReps, setSadyaReps] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [searched, setSearched] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<Person | null>(null);

  const loadSadyaReps = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, mobile, role, is_sadya_rep')
      .eq('is_sadya_rep', true)
      .order('name');
    setSadyaReps((data as Person[]) ?? []);
  }, []);
  useEffect(() => { loadSadyaReps(); }, [loadSadyaReps]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSearched(true);
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, mobile, role, is_sadya_rep')
      .or(`name.ilike.%${q}%,mobile.ilike.%${q}%`)
      .limit(25);
    if (error) setMsg(error.message);
    else setResults((data as Person[]) ?? []);
  }

  async function grant(p: Person) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('grant_sadya_rep', { p_user_id: p.id });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg(`${p.name} can now scan sadya passes.`);
      setResults([]); setQuery(''); setSearched(false);
      loadSadyaReps();
    }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    const p = revoking;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('revoke_sadya_rep', { p_user_id: p.id });
    setBusy(false);
    setRevoking(null);
    if (error) setMsg(error.message);
    else { setMsg(`Revoked sadya scanning for ${p.name}.`); loadSadyaReps(); }
  }

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <h2>Sadya Reps</h2>
      <p className="muted">
        Grant sadya scanning to residents who'll staff the serving counter on event day. They keep
        their existing role (resident or tower rep) — this only lets them scan and redeem flat sadya
        passes.
      </p>

      <form onSubmit={search} className="card row">
        <input placeholder="Search resident by name or mobile" value={query} onChange={(e) => setQuery(e.target.value)} required />
        <button type="submit">Search</button>
      </form>

      {msg && <p className={msg.includes('can now scan') || msg.startsWith('Revoked') ? 'success' : 'error'}>{msg}</p>}

      {searched && results.length === 0 && !msg && (
        <p className="muted">No matching people.</p>
      )}

      {results.map((p) => (
        <div key={p.id} className="card between">
          <div>
            <strong>{p.name}</strong>
            <div className="muted">{p.mobile} · <span className="badge soft pending">{prettyRole(p.role)}</span></div>
          </div>
          {p.is_sadya_rep
            ? <span className="badge soft verified">Already a Sadya Rep</span>
            : <button onClick={() => grant(p)} disabled={busy}>Make Sadya Rep</button>}
        </div>
      ))}

      <div className="section-title"><h3>Current Sadya Reps</h3></div>
      {sadyaReps.length === 0
        ? <p className="muted">No sadya reps yet. Search above to add one.</p>
        : (
          <ul className="list">
            {sadyaReps.map((s) => (
              <li key={s.id} className="card between">
                <div>
                  <strong>{s.name}</strong>
                  <div className="muted">{s.mobile} · <span className="badge soft pending">{prettyRole(s.role)}</span></div>
                </div>
                <button className="danger-btn" disabled={busy} onClick={() => setRevoking(s)}>Revoke</button>
              </li>
            ))}
          </ul>
        )}

      {revoking && (
        <Modal title={`Revoke sadya scanning for ${revoking.name}?`} onClose={() => setRevoking(null)}>
          <p className="muted">They'll no longer be able to scan sadya passes. You can grant it again later.</p>
          <div className="row">
            <button className="danger-btn" disabled={busy} onClick={confirmRevoke}>Revoke</button>
            <button className="secondary" onClick={() => setRevoking(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
