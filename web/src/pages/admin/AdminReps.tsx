import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { prettyRole } from '../../lib/ui';
import { formatINR } from '../../lib/format';
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
interface VerifiedRow {
  paid_to_rep_user_id: string | null;
  paid_to_tower_id: string;
  amount: number;
  amount_paid: number | null;
}
interface RepTally { name: string; amount: number; count: number; isCurrent: boolean; }

export default function AdminReps() {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<VerifiedRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: tw } = await supabase.from('towers').select('*').order('name');
    const towerRows = (tw as Tower[]) ?? [];
    setTowers(towerRows);

    const { data: ev } = await supabase.from('events').select('id').eq('is_active', true).maybeSingle();
    const eventId = (ev as { id: string } | null)?.id;

    let vRows: VerifiedRow[] = [];
    if (eventId) {
      const { data: c } = await supabase
        .from('contributions')
        .select('paid_to_rep_user_id, paid_to_tower_id, amount, amount_paid')
        .eq('event_id', eventId)
        .eq('status', 'verified');
      vRows = (c as VerifiedRow[]) ?? [];
    }
    setVerified(vRows);

    const ids = new Set<string>();
    towerRows.forEach((t) => t.rep_user_id && ids.add(t.rep_user_id));
    vRows.forEach((v) => v.paid_to_rep_user_id && ids.add(v.paid_to_rep_user_id));
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
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('assign_tower_rep', { p_user_id: c.id });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg(`${c.name} is now the rep for ${towerName(c.tower_id)}.`);
      setResults([]); setQuery(''); setSearched(false);
      load();
    }
  }

  async function removeRep(t: Tower) {
    if (!window.confirm(`Remove the rep for ${t.name}? Their past verified collections stay recorded.`)) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('remove_tower_rep', { p_tower_id: t.id });
    setBusy(false);
    if (error) setMsg(error.message);
    else { setMsg(`Removed the rep for ${t.name}.`); load(); }
  }

  // collections grouped by rep, per tower
  function tallies(towerId: string, currentRep: string | null): RepTally[] {
    const byRep = new Map<string, { amount: number; count: number }>();
    for (const v of verified) {
      if (v.paid_to_tower_id !== towerId || !v.paid_to_rep_user_id) continue;
      const cur = byRep.get(v.paid_to_rep_user_id) ?? { amount: 0, count: 0 };
      cur.amount += Number(v.amount_paid ?? v.amount);
      cur.count += 1;
      byRep.set(v.paid_to_rep_user_id, cur);
    }
    return [...byRep.entries()].map(([id, agg]) => ({
      name: names[id] ?? 'Unknown',
      amount: agg.amount,
      count: agg.count,
      isCurrent: id === currentRep,
    }));
  }

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <h2>Representatives</h2>
      <p className="muted">Search a registered resident by name, mobile, or flat number. A rep can only represent their own tower.</p>

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
          {c.tower_id ? (
            <button onClick={() => assign(c)} disabled={busy}>Make rep of {towerName(c.tower_id)}</button>
          ) : (
            <p className="muted">No tower on record — cannot assign as a rep.</p>
          )}
        </div>
      ))}

      <div className="section-title"><h3>Towers &amp; reps</h3></div>
      <ul className="list">
        {towers.map((t) => {
          const repTallies = tallies(t.id, t.rep_user_id);
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
                  <span className={`badge soft ${t.rep_contact ? 'verified' : 'pending'}`}>
                    {t.rep_contact ? 'Payment set' : 'No payment'}
                  </span>
                  {t.rep_user_id && (
                    <button className="danger-btn" disabled={busy} onClick={() => removeRep(t)}>Remove</button>
                  )}
                </span>
              </div>

              {repTallies.length > 0 && (
                <div style={{ marginTop: '0.6rem' }}>
                  <p className="muted" style={{ margin: '0 0 0.3rem' }}>Collected (verified) by rep:</p>
                  {repTallies.map((r) => (
                    <div key={r.name} className="between" style={{ padding: '0.15rem 0' }}>
                      <span>
                        {r.name}{' '}
                        {r.isCurrent ? <span className="badge soft verified">current</span> : <span className="badge soft pending">past</span>}
                      </span>
                      <span><strong>{formatINR(r.amount)}</strong> <span className="muted">· {r.count}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
