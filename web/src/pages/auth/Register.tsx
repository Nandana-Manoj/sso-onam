import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import type { PublicTower } from '../../lib/types';

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [towers, setTowers] = useState<PublicTower[]>([]);
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    towerId: '',
    flatNumber: '',
    password: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from('public_towers')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setTowers((data as PublicTower[]) ?? []);
      });
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await register(form);
      nav('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Create your account</h1>
      <form onSubmit={onSubmit} className="card">
        <label>
          Name
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label>
          Mobile number
          <input
            type="tel"
            value={form.mobile}
            onChange={(e) => set('mobile', e.target.value)}
            placeholder="10-digit mobile"
            required
          />
        </label>
        <label>
          Tower
          <select value={form.towerId} onChange={(e) => set('towerId', e.target.value)} required>
            <option value="" disabled>
              Select your tower
            </option>
            {towers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Flat number
          <input
            value={form.flatNumber}
            onChange={(e) => set('flatNumber', e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            minLength={6}
            required
          />
        </label>
        {err && <p className="error">{err}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
