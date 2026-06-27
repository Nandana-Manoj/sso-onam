import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { prettyRole, byName } from '../../lib/ui';
import Modal from '../../components/Modal';
import type { Tower } from '../../lib/types';

interface Candidate {
  id: string;
  name: string;
  mobile: string;
  role: string;
  tower_id: string | null;
  flat_id: string | null;
  flats: { flat_number: string } | null;
}
export default function AdminReps() {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({}); // candidateId -> towerId
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Tower | null>(null);

  const load = useCallback(async () => {
    const { data: tw } = await supabase.from('towers').select('*').order('name');
    const towerRows = ((tw as Tower[]) ?? []).sort(byName);
    setTowers(towerRows);

    const ids = new Set<string>();
    towerRows.forEach((t) => t.rep_user_id && ids.add(t.rep_user_id));
    if (ids.size) {
      const { data: profs } = await supabase.from('profiles').select('id, name').in('id', [...ids]);
      const map: Record<string, string> = {};
      (profs as { id: string; name: string }[] ?? []).forEach((p) => { map[p.id] = p.name; });
      setNames(map);
    } else {
      setNames({});
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSearched(true);
    const q = query.trim();
    if (!q) { setResults([]); return; }

    const select = 'id, name, mobile, role, tower_id, flat_id, flats(flat_number)';
    const byNameMobile = supabase.from('profiles').select(select).or(`name.ilike.%${q}%,mobile.ilike.%${q}%`).limit(25);
    const flatIdsRes = await supabase.from('flats').select('id').ilike('flat_number', `%${q}%`).limit(50);
    const flatIds = (flatIdsRes.data as { id: string }[] | null)?.map((f) => f.id) ?? [];
    const [nm, byFlat] = await Promise.all([
      byNameMobile,
      flatIds.length
        ? supabase.from('profiles').select(select).in('flat_id', flatIds).limit(25)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (nm.error) { setMsg(nm.error.message); return; }
    const merged = new Map<string, Candidate>();
    for (const c of [...((nm.data as unknown as Candidate[]) ?? []), ...((byFlat.data as unknown as Candidate[]) ?? [])]) {
      merged.set(c.id, c);
    }
    setResults([...merged.values()]);
  }

  const towerName = (id: string | null) => towers.find((t) => t.id === id)?.name ?? null;

  async function assign(c: Candidate) {
    const towerId = picks[c.id];
    if (!towerId) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('assign_tower_rep', { p_user_id: c.id, p_tower_id: towerId });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg(`${c.name} is now the rep for ${towerName(towerId)}.`);
      setResults([]); setQuery(''); setSearched(false); setPicks({});
      load();
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    const t = removing;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('remove_tower_rep', { p_tower_id: t.id });
    setBusy(false);
    setRemoving(null);
    if (error) setMsg(error.message);
    else { setMsg(`Removed the rep for ${t.name}.`); load(); }
  }

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <h2>Representatives</h2>
      <p className="muted">Search a registered resident by name, mobile, or flat number, then assign them as the rep of any tower. One person can rep multiple towers.</p>

      <form onSubmit={search} className="card row">
        <input placeholder="Name, mobile, or flat number" value={query} onChange={(e) => setQuery(e.target.value)} required />
        <button type="submit">Search</button>
      </form>

      {msg && <p className={msg.includes('now the rep') || msg.startsWith('Removed') ? 'success' : 'error'}>{msg}</p>}

      {searched && results.length === 0 && !msg && (
        <p className="muted">No matching residents. They must register first.</p>
      )}

      {results.map((c) => (
        <div key={c.id} className="card">
          <div className="between">
            <div>
              <strong>{c.name}</strong>
              <div className="muted">
                {c.mobile}
                {c.flats?.flat_number ? ` · Flat ${c.flats.flat_number}` : ''}
                {' · '}<span className="badge soft pending">{prettyRole(c.role)}</span>
              </div>
            </div>
          </div>
          {c.role === 'admin' ? (
            <p className="muted">This person is an admin and can't be a tower rep.</p>
          ) : (
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <select
                value={picks[c.id] ?? ''}
                onChange={(e) => setPicks((p) => ({ ...p, [c.id]: e.target.value }))}
              >
                <option value="" disabled>Select Tower</option>
                {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button onClick={() => assign(c)} disabled={busy || !picks[c.id]}>Make Rep</button>
            </div>
          )}
        </div>
      ))}

      <div className="section-title"><h3>Towers &amp; Reps</h3></div>
      <ul className="list">
        {towers.map((t) => {
          const hasPayment = !!(t.rep_upi_id || t.payment_qr_path);
          return (
            <li key={t.id} className="card">
              <div className="between">
                <div>
                  <strong>{t.name}</strong>
                  <div className="muted">
                    {t.rep_user_id ? <>Rep: <strong>{names[t.rep_user_id] ?? '—'}</strong></> : 'No rep assigned'}
                  </div>
                </div>
                <span className="row" style={{ gap: '0.4rem' }}>
                  <span className={`badge soft ${hasPayment ? 'verified' : 'pending'}`}>
                    {hasPayment ? 'Payment info available' : 'Payment info N/A'}
                  </span>
                  {t.rep_user_id && (
                    <button className="danger-btn" disabled={busy} onClick={() => setRemoving(t)}>Remove</button>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {removing && (
        <Modal title={`Remove the Rep for ${removing.name}?`} onClose={() => setRemoving(null)}>
          <p className="muted">
            They'll go back to being a resident. Their past verified collections stay recorded and attributed to them.
          </p>
          <div className="row">
            <button className="danger-btn" disabled={busy} onClick={confirmRemove}>Remove Rep</button>
            <button className="secondary" onClick={() => setRemoving(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
