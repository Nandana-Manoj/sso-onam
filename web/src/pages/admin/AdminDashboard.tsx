import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/format';
import { Donut } from '../../components/Charts';
import OfflinePaymentForm from '../../components/OfflinePaymentForm';
import type { EventConfig, ContributionStatus } from '../../lib/types';

interface Flat { id: string; tower_id: string; flat_number: string; }
interface Contrib { flat_id: string; paid_to_tower_id: string; status: ContributionStatus; amount: number; amount_paid: number | null; }

type FlatState = 'verified' | 'awaiting' | 'pending' | 'none';
const PRIORITY: Record<ContributionStatus, number> = {
  verified: 4, submitted: 3, payment_pending: 2, rejected: 1, expired: 0,
};
const STATE_LABEL: Record<FlatState, string> = {
  verified: 'Verified', awaiting: 'Awaiting', pending: 'Started', none: 'Not started',
};

export default function AdminDashboard() {
  const [event, setEvent] = useState<EventConfig | null>(null);
  const [towers, setTowers] = useState<{ id: string; name: string }[]>([]);
  const [flats, setFlats] = useState<Flat[]>([]);
  const [contribs, setContribs] = useState<Contrib[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: ev } = await supabase.from('events').select('*').eq('is_active', true).maybeSingle();
    const event = (ev as EventConfig | null) ?? null;
    setEvent(event);

    const [{ data: tw }, { data: fl }] = await Promise.all([
      supabase.from('towers').select('id, name').order('name'),
      supabase.from('flats').select('id, tower_id, flat_number').order('flat_number'),
    ]);
    setTowers((tw as { id: string; name: string }[]) ?? []);
    setFlats((fl as Flat[]) ?? []);

    if (event) {
      const { data: c, error: e } = await supabase
        .from('contributions')
        .select('flat_id, paid_to_tower_id, status, amount, amount_paid')
        .eq('event_id', event.id);
      if (e) setError(e.message);
      setContribs((c as Contrib[]) ?? []);
    } else {
      setContribs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // best (current) status per flat
  const flatStatus = new Map<string, ContributionStatus>();
  for (const c of contribs) {
    const cur = flatStatus.get(c.flat_id);
    if (!cur || PRIORITY[c.status] > PRIORITY[cur]) flatStatus.set(c.flat_id, c.status);
  }
  const stateOf = (flatId: string): FlatState => {
    const s = flatStatus.get(flatId);
    if (s === 'verified') return 'verified';
    if (s === 'submitted') return 'awaiting';
    if (s === 'payment_pending') return 'pending';
    return 'none';
  };

  const amt = (c: Contrib) => Number(c.amount_paid ?? c.amount);
  const verifiedTotal = contribs.filter((c) => c.status === 'verified').reduce((s, c) => s + amt(c), 0);

  const counts = { verified: 0, awaiting: 0, pending: 0, none: 0 };
  for (const f of flats) counts[stateOf(f.id)] += 1;

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <div className="between">
        <h2>Dashboard</h2>
        <button className="secondary" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : !event ? (
        <div className="card"><p className="muted">No active event. Activate one under Events &amp; Config.</p></div>
      ) : (
        <>
          <p className="muted">{event.name} · contributions</p>

          <div className="grid cols-3">
            <div className="stat green">
              <div className="stat-value">{formatINR(verifiedTotal)}</div>
              <div className="stat-label">Collected (verified)</div>
            </div>
            <div className="stat blue">
              <div className="stat-value">{counts.awaiting}</div>
              <div className="stat-label">Awaiting verification</div>
            </div>
            <div className="stat amber">
              <div className="stat-value">{counts.verified}/{flats.length}</div>
              <div className="stat-label">Flats paid</div>
            </div>
          </div>

          <div className="card">
            <h3>Contribution status</h3>
            <Donut
              segments={[
                { value: counts.verified, color: '#15803d', label: 'Verified' },
                { value: counts.awaiting, color: '#1d4ed8', label: 'Awaiting' },
                { value: counts.pending, color: '#b45309', label: 'Started' },
                { value: counts.none, color: '#e7d8bf', label: 'Not started' },
              ]}
              centerLabel={flats.length ? `${Math.round((counts.verified / flats.length) * 100)}%` : '—'}
              centerSub="paid"
            />
          </div>

          <div className="card card-accent">
            <h3>Record a walk-in / offline payment</h3>
            <p className="muted">For a resident who paid a rep directly without using the app — marks the flat as paid.</p>
            <OfflinePaymentForm towers={towers} onRecorded={load} />
          </div>

          <div className="card">
            <h3>By tower · flats verified</h3>
            {towers.map((t) => {
              const tFlats = flats.filter((f) => f.tower_id === t.id);
              const v = tFlats.filter((f) => stateOf(f.id) === 'verified').length;
              const pct = tFlats.length ? (v / tFlats.length) * 100 : 0;
              const isOpen = open === t.id;
              return (
                <div key={t.id}>
                  <div
                    className="bar-row"
                    style={{ cursor: tFlats.length ? 'pointer' : 'default' }}
                    onClick={() => tFlats.length && setOpen(isOpen ? null : t.id)}
                  >
                    <span className="bar-name">{isOpen ? '▾ ' : '▸ '}{t.name}</span>
                    <span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%` }} /></span>
                    <span className="bar-val">{v}/{tFlats.length}</span>
                  </div>
                  {isOpen && (
                    <div className="flat-grid" style={{ marginBottom: '0.7rem' }}>
                      {tFlats.length === 0 && <span className="muted">No flats registered yet.</span>}
                      {tFlats.map((f) => {
                        const st = stateOf(f.id);
                        return (
                          <span key={f.id} className={`flat-pill ${st}`}>
                            <span className="dot" />
                            {f.flat_number}
                            <span className="muted" style={{ fontSize: '0.72rem' }}>· {STATE_LABEL[st]}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {towers.length === 0 && <p className="muted">No towers yet.</p>}
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
