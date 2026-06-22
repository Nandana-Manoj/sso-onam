import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Tower } from '../../lib/types';

export default function AdminTowers() {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('towers').select('*').order('name');
    if (error) setMsg(error.message);
    else setTowers((data as Tower[]) ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.from('towers').insert({ name: name.trim(), code: code.trim() || null });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setName('');
      setCode('');
      load();
    }
  }

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <h2>Towers</h2>
      <form onSubmit={onCreate} className="card row">
        <input placeholder="Name (e.g. Tower 1)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" disabled={busy}>Add tower</button>
      </form>
      {msg && <p className="error">{msg}</p>}
      <ul className="list">
        {towers.map((t) => (
          <li key={t.id} className="card between">
            <span>
              <strong>{t.name}</strong> {t.code && <span className="muted">({t.code})</span>}
            </span>
            <span className={`badge soft ${t.rep_user_id ? 'verified' : 'rejected'}`}>
              {t.rep_user_id ? 'Rep assigned' : 'No rep'}
            </span>
          </li>
        ))}
        {towers.length === 0 && <p className="muted">No towers yet.</p>}
      </ul>
    </div>
  );
}
