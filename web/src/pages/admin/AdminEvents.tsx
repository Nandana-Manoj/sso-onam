import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { EventConfig, EventRoster } from '../../lib/types';
import { formatINR } from '../../lib/format';
import { assetUrl, byName } from '../../lib/ui';
import Modal from '../../components/Modal';

export default function AdminEvents() {
  const [events, setEvents] = useState<EventConfig[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<EventConfig | null>(null);
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

  async function reopen(id: string) {
    setMsg(null);
    setBusy(true);
    const { error } = await supabase.rpc('reopen_event', { p_event_id: id });
    setBusy(false);
    if (error) setMsg(error.message);
    else load();
  }

  const active = events.find((e) => e.is_active) ?? null;
  const others = events.filter((e) => !e.is_active);
  const hasActive = !!active;

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <h2>Events &amp; Config</h2>

      {active ? (
        <ActiveEventEditor event={active} onChanged={load} onMessage={setMsg} />
      ) : (
        <div className="card"><p className="muted">No open event right now. Create one below and set it active, or reopen a closed event.</p></div>
      )}

      {msg && <p className="error">{msg}</p>}

      {others.length > 0 && (
        <>
          <div className="section-title"><h3>Other Events</h3></div>
          <ul className="list">
            {others.map((ev) => {
              const closed = !!ev.closed_at;
              return (
                <li key={ev.id} className="card between">
                  <div>
                    <strong>{ev.name}</strong> <span className="muted">({ev.year})</span>{' '}
                    <span className={`badge soft ${closed ? 'refunded' : 'pending'}`}>{closed ? 'Closed' : 'Draft'}</span>
                    <div className="muted">
                      Min {formatINR(ev.min_contribution)} · Adult {formatINR(ev.adult_sadya_price)} · Child {formatINR(ev.child_sadya_price)}
                    </div>
                  </div>
                  <span className="row" style={{ gap: '0.4rem' }}>
                    {closed ? (
                      <>
                        <button className="secondary" onClick={() => setViewing(ev)}>Reps &amp; Admins</button>
                        <button className="secondary" disabled={busy || hasActive} title={hasActive ? 'Close the open event first' : undefined} onClick={() => reopen(ev.id)}>Reopen</button>
                      </>
                    ) : (
                      <button className="secondary" onClick={() => activate(ev.id)}>Set Active</button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <details className="disclosure card" style={{ marginTop: '1rem' }}>
        <summary>Create a New Event</summary>
        <form onSubmit={onCreate}>
          <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Onam 2026" required /></label>
          <label>Year<input type="number" value={form.year} onChange={(e) => set('year', e.target.value)} required /></label>
          <div className="grid cols-3">
            <label>Min Contribution (₹)<input type="number" value={form.min_contribution} onChange={(e) => set('min_contribution', e.target.value)} required /></label>
            <label>Adult Sadya (₹)<input type="number" value={form.adult_sadya_price} onChange={(e) => set('adult_sadya_price', e.target.value)} required /></label>
            <label>Child &lt;5 (₹)<input type="number" value={form.child_sadya_price} onChange={(e) => set('child_sadya_price', e.target.value)} required /></label>
          </div>
          <button type="submit" disabled={busy}>Create Event</button>
        </form>
      </details>

      {viewing && <RosterModal event={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ActiveEventEditor({
  event, onChanged, onMessage,
}: { event: EventConfig; onChanged: () => void; onMessage: (m: string | null) => void }) {
  const [cfg, setCfg] = useState({
    name: event.name,
    min_contribution: String(event.min_contribution),
    adult_sadya_price: String(event.adult_sadya_price),
    child_sadya_price: String(event.child_sadya_price),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [logoBust, setLogoBust] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
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

  async function closeEvent() {
    setBusy(true);
    onMessage(null);
    const { error } = await supabase.rpc('close_event', { p_event_id: event.id });
    setBusy(false);
    setConfirmClose(false);
    if (error) onMessage(error.message);
    else onChanged();
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
          <span className="badge soft pending" style={{ marginBottom: 6 }}>Open · {event.year}</span>
          <h2>{event.name}</h2>
          <p className="hero-sub">Edit the live event below — changes don't alter records already submitted.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: '0.9rem' }}>
        <label>Event Name
          <input value={cfg.name} onChange={(e) => set('name', e.target.value)} placeholder="Onam 2026" />
        </label>
        <div className="grid cols-3">
          <label>Min Contribution (₹)
            <input type="number" value={cfg.min_contribution} onChange={(e) => set('min_contribution', e.target.value)} />
          </label>
          <label>Adult Sadya (₹)
            <input type="number" value={cfg.adult_sadya_price} onChange={(e) => set('adult_sadya_price', e.target.value)} />
          </label>
          <label>Child &lt;5 (₹)
            <input type="number" value={cfg.child_sadya_price} onChange={(e) => set('child_sadya_price', e.target.value)} />
          </label>
        </div>
        <label>Event Logo
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadLogo(f);
          }} />
        </label>
        <button onClick={saveConfig} disabled={busy}>Save Configuration</button>
        {msg && <p className={msg.toLowerCase().includes('saved') || msg.toLowerCase().includes('updated') ? 'success' : 'error'}>{msg}</p>}
      </div>

      <div className="card" style={{ marginTop: '0.9rem' }}>
        <h3>Close This Event</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Freezes a permanent record of this event — the reps, admins, and what each tower collected — then takes it
          off the live slot. Contributions stay intact. Open or create another event to continue collecting.
        </p>
        <button className="danger-btn" disabled={busy} onClick={() => setConfirmClose(true)}>Close Event</button>
      </div>

      {confirmClose && (
        <Modal title="Close This Event?" onClose={() => setConfirmClose(false)}>
          <p className="muted">
            <strong>{event.name}</strong> will be closed and archived with its current reps, admins, and tower
            collections. No new contributions can be made until you open another event. You can reopen it later if
            needed.
          </p>
          <div className="row">
            <button className="danger-btn" disabled={busy} onClick={closeEvent}>Close &amp; Archive</button>
            <button className="secondary" onClick={() => setConfirmClose(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RosterModal({ event, onClose }: { event: EventConfig; onClose: () => void }) {
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('get_event_roster', { p_event_id: event.id }).then(({ data, error }) => {
      if (error) setErr(error.message);
      else setRoster(data as EventRoster);
    });
  }, [event.id]);

  const towers = [...(roster?.towers ?? [])].sort(byName);

  return (
    <Modal title={`${event.name} · Reps & Admins`} onClose={onClose} wide>
      {err && <p className="error">{err}</p>}
      {!roster && !err && <p className="muted">Loading…</p>}
      {roster && (
        <>
          <div className="grid cols-3">
            <div className="stat green">
              <div className="stat-value">{formatINR(roster.totals.collected_verified)}</div>
              <div className="stat-label">Collected (Verified)</div>
            </div>
            <div className="stat amber">
              <div className="stat-value">{roster.totals.flats_paid}/{roster.totals.flats_total}</div>
              <div className="stat-label">Flats Paid</div>
            </div>
            {roster.totals.refunded > 0 && (
              <div className="stat red">
                <div className="stat-value">{formatINR(roster.totals.refunded)}</div>
                <div className="stat-label">Refunded</div>
              </div>
            )}
          </div>

          <h3 style={{ marginTop: '1rem' }}>Admins ({roster.admins.length})</h3>
          {roster.admins.length === 0 ? (
            <p className="muted">No admins recorded.</p>
          ) : (
            <ul className="list">
              {roster.admins.map((a) => (
                <li key={a.user_id} className="between" style={{ padding: '0.2rem 0' }}>
                  <span>{a.name}</span><span className="muted">{a.mobile}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 style={{ marginTop: '1rem' }}>Tower Reps &amp; Collections</h3>
          <table className="tbl">
            <thead>
              <tr><th>Tower</th><th>Rep</th><th>Collected</th></tr>
            </thead>
            <tbody>
              {towers.map((t) => (
                <tr key={t.tower_id}>
                  <td>{t.name}</td>
                  <td>{t.rep_name ?? <span className="muted">No rep</span>}{t.rep_mobile ? <span className="muted"> · {t.rep_mobile}</span> : ''}</td>
                  <td>{t.collected_verified ? formatINR(t.collected_verified) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: '0.6rem', fontSize: '0.8rem' }}>
            {event.closed_at
              ? `Snapshot taken when the event was closed on ${new Date(event.closed_at).toLocaleDateString()}.`
              : 'Live figures — this event is still open.'}
          </p>
        </>
      )}
    </Modal>
  );
}
