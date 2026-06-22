import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { EventConfig } from '../../lib/types';
import { formatINR } from '../../lib/format';
import { assetUrl } from '../../lib/ui';

export default function AdminEvents() {
  const [events, setEvents] = useState<EventConfig[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    year: String(new Date().getFullYear()),
    min_contribution: '2000',
    adult_sadya_price: '400',
    child_sadya_price: '0',
  });

  async function load() {
    const { data, error } = await supabase.from('events').select('*').order('year', { ascending: false });
    if (error) setMsg(error.message);
    else setEvents((data as EventConfig[]) ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.from('events').insert({
      name: form.name.trim(),
      year: Number(form.year),
      min_contribution: Number(form.min_contribution),
      adult_sadya_price: Number(form.adult_sadya_price),
      child_sadya_price: Number(form.child_sadya_price),
    });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setForm({ ...form, name: '' });
      load();
    }
  }

  async function activate(id: string) {
    setMsg(null);
    const { error } = await supabase.rpc('set_active_event', { p_event_id: id });
    if (error) setMsg(error.message);
    else load();
  }

  const active = events.find((e) => e.is_active) ?? null;
  const others = events.filter((e) => !e.is_active);

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <h2>Events &amp; config</h2>

      {active ? (
        <ActiveEventEditor event={active} onChanged={load} />
      ) : (
        <div className="card"><p className="muted">No active event yet. Create one below and set it active.</p></div>
      )}

      {msg && <p className="error">{msg}</p>}

      {others.length > 0 && (
        <>
          <div className="section-title"><h3>Other years</h3></div>
          <ul className="list">
            {others.map((ev) => (
              <li key={ev.id} className="card between">
                <div>
                  <strong>{ev.name}</strong> <span className="muted">({ev.year})</span>
                  <div className="muted">
                    Min {formatINR(ev.min_contribution)} · Adult {formatINR(ev.adult_sadya_price)} · Child {formatINR(ev.child_sadya_price)}
                  </div>
                </div>
                <button className="secondary" onClick={() => activate(ev.id)}>Set active</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <details className="disclosure card" style={{ marginTop: '1rem' }}>
        <summary>Create a new event</summary>
        <form onSubmit={onCreate}>
          <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Onam 2026" required /></label>
          <label>Year<input type="number" value={form.year} onChange={(e) => set('year', e.target.value)} required /></label>
          <div className="grid cols-3">
            <label>Min contribution (₹)<input type="number" value={form.min_contribution} onChange={(e) => set('min_contribution', e.target.value)} required /></label>
            <label>Adult sadya (₹)<input type="number" value={form.adult_sadya_price} onChange={(e) => set('adult_sadya_price', e.target.value)} required /></label>
            <label>Child &lt;5 (₹)<input type="number" value={form.child_sadya_price} onChange={(e) => set('child_sadya_price', e.target.value)} required /></label>
          </div>
          <button type="submit" disabled={busy}>Create event</button>
        </form>
      </details>
    </div>
  );
}

function ActiveEventEditor({ event, onChanged }: { event: EventConfig; onChanged: () => void }) {
  const [cfg, setCfg] = useState({
    name: event.name,
    min_contribution: String(event.min_contribution),
    adult_sadya_price: String(event.adult_sadya_price),
    child_sadya_price: String(event.child_sadya_price),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [logoBust, setLogoBust] = useState(0);
  const logoUrl = assetUrl('event-assets', event.logo_path);

  function set<K extends keyof typeof cfg>(key: K, value: string) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  async function saveConfig() {
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.rpc('update_event_config', {
      p_event_id: event.id,
      p_name: cfg.name.trim() || null,
      p_min_contribution: Number(cfg.min_contribution),
      p_adult_price: Number(cfg.adult_sadya_price),
      p_child_price: Number(cfg.child_sadya_price),
    });
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setMsg('Configuration saved.');
      onChanged();
    }
  }

  async function uploadLogo(file: File) {
    setMsg(null);
    setBusy(true);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${event.id}/logo.${ext}`;
    const up = await supabase.storage.from('event-assets').upload(path, file, { upsert: true });
    if (up.error) {
      setBusy(false);
      setMsg(up.error.message);
      return;
    }
    const { error } = await supabase.from('events').update({ logo_path: path }).eq('id', event.id);
    setBusy(false);
    if (error) setMsg(error.message);
    else {
      setLogoBust(Date.now());
      setMsg('Logo updated — shown across all consoles.');
      onChanged();
    }
  }

  return (
    <div className="hero saffron">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {logoUrl && (
          <img
            className="hero-logo"
            src={`${logoUrl}${logoBust ? `?v=${logoBust}` : ''}`}
            alt="Event logo"
          />
        )}
        <div style={{ flex: 1 }}>
          <span className="badge soft pending" style={{ marginBottom: 6 }}>Active · {event.year}</span>
          <h2>{event.name}</h2>
          <p className="hero-sub">Edit the live event below — changes don't alter records already submitted.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: '0.9rem' }}>
        <label>Event name
          <input value={cfg.name} onChange={(e) => set('name', e.target.value)} placeholder="Onam 2026" />
        </label>
        <div className="grid cols-3">
          <label>Min contribution (₹)
            <input type="number" value={cfg.min_contribution} onChange={(e) => set('min_contribution', e.target.value)} />
          </label>
          <label>Adult sadya (₹)
            <input type="number" value={cfg.adult_sadya_price} onChange={(e) => set('adult_sadya_price', e.target.value)} />
          </label>
          <label>Child &lt;5 (₹)
            <input type="number" value={cfg.child_sadya_price} onChange={(e) => set('child_sadya_price', e.target.value)} />
          </label>
        </div>
        <label>Event logo
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadLogo(f);
          }} />
        </label>
        <button onClick={saveConfig} disabled={busy}>Save configuration</button>
        {msg && <p className={msg.toLowerCase().includes('saved') || msg.toLowerCase().includes('updated') ? 'success' : 'error'}>{msg}</p>}
      </div>
    </div>
  );
}
