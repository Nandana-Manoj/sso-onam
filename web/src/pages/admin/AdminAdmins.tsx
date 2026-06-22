import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { prettyRole } from '../../lib/ui';
import Modal from '../../components/Modal';

interface Person {
  id: string;
  name: string;
  mobile: string;
  role: string;
}

export default function AdminAdmins() {
  const { profile } = useAuth();
  const [admins, setAdmins] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [searched, setSearched] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<Person | null>(null);

  const loadAdmins = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, name, mobile, role').eq('role', 'admin').order('name');
    setAdmins((data as Person[]) ?? []);
  }, []);
  useEffect(() => { loadAdmins(); }, [loadAdmins]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSearched(true);
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, mobile, role')
      .or(`name.ilike.%${q}%,mobile.ilike.%${q}%`)
      .limit(25);
    if (error) setMsg(error.message);
    else setResults((data as Person[]) ?? []);
  }

  async function grant(p: Person) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('grant_admin', { p_user_id: p.id });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg(`${p.name} is now an admin.`);
      setResults([]); setQuery(''); setSearched(false);
      loadAdmins();
    }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    const p = revoking;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('revoke_admin', { p_user_id: p.id });
    setBusy(false);
    setRevoking(null);
    if (error) setMsg(error.message);
    else { setMsg(`Revoked admin access for ${p.name}.`); loadAdmins(); }
  }

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <h2>Admins</h2>
      <p className="muted">Grant or revoke admin access. Admins can manage everything; you can't revoke yourself or the last admin.</p>

      <form onSubmit={search} className="card row">
        <input placeholder="Search resident by name or mobile" value={query} onChange={(e) => setQuery(e.target.value)} required />
        <button type="submit">Search</button>
      </form>

      {msg && <p className={msg.includes('now an admin') || msg.startsWith('Revoked') ? 'success' : 'error'}>{msg}</p>}

      {searched && results.length === 0 && !msg && (
        <p className="muted">No matching people.</p>
      )}

      {results.map((p) => (
        <div key={p.id} className="card between">
          <div>
            <strong>{p.name}</strong>
            <div className="muted">{p.mobile} · <span className="badge soft pending">{prettyRole(p.role)}</span></div>
          </div>
          {p.role === 'admin'
            ? <span className="badge soft verified">Already admin</span>
            : <button onClick={() => grant(p)} disabled={busy}>Make admin</button>}
        </div>
      ))}

      <div className="section-title"><h3>Current admins</h3></div>
      <ul className="list">
        {admins.map((a) => (
          <li key={a.id} className="card between">
            <div>
              <strong>{a.name}</strong>
              <div className="muted">{a.mobile}{a.id === profile?.id ? ' · you' : ''}</div>
            </div>
            {a.id !== profile?.id && admins.length > 1 && (
              <button className="danger-btn" disabled={busy} onClick={() => setRevoking(a)}>Revoke</button>
            )}
          </li>
        ))}
      </ul>

      {revoking && (
        <Modal title={`Revoke admin for ${revoking.name}?`} onClose={() => setRevoking(null)}>
          <p className="muted">They'll become a regular resident. You can grant it again later.</p>
          <div className="row">
            <button className="danger-btn" disabled={busy} onClick={confirmRevoke}>Revoke admin</button>
            <button className="secondary" onClick={() => setRevoking(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
