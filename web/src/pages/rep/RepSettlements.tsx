import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { formatINR } from '../../lib/format';
import { useRepData } from './useRepData';

/** Settlements: record each transfer the rep makes to the organising committee;
 *  the amount-in-hand is derived from verified collections minus what's settled. */
export default function RepSettlements() {
  const { profile } = useAuth();
  const { loading, towers, contribs, sadya, sadyaCancels, settlements, eventId, reload } = useRepData();
  const [settleInputs, setSettleInputs] = useState<Record<string, { amount: string; note: string }>>({});
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  // Total collected per tower (verified contributions + sadya − refunds).
  const towerCollected = new Map<string, number>();
  contribs.forEach((c) => {
    if (c.status === 'verified' && c.refund_state !== 'refunded') {
      towerCollected.set(c.paid_to_tower_id, (towerCollected.get(c.paid_to_tower_id) ?? 0) + Number(c.amount_paid ?? c.amount));
    }
  });
  sadya.forEach((s) => {
    if (s.status === 'verified') {
      towerCollected.set(s.paid_to_tower_id, (towerCollected.get(s.paid_to_tower_id) ?? 0) + Number(s.amount_paid ?? s.total_amount));
    }
  });
  sadyaCancels.forEach((c) => {
    if (c.status === 'refunded') {
      towerCollected.set(c.paid_to_tower_id, (towerCollected.get(c.paid_to_tower_id) ?? 0) - c.amount);
    }
  });

  async function addSettlement(towerId: string) {
    if (!eventId || !profile?.id) return;
    const input = settleInputs[towerId] ?? {};
    const amt = parseInt(input.amount ?? '', 10);
    if (isNaN(amt) || amt <= 0) { setSettleError('Enter a valid amount.'); return; }
    setSettleBusy(true);
    setSettleError(null);
    const { error: e } = await supabase.from('rep_settlements').insert({
      event_id: eventId,
      tower_id: towerId,
      rep_user_id: profile.id,
      amount: amt,
      note: input.note?.trim() || null,
    });
    setSettleBusy(false);
    if (e) { setSettleError(e.message); return; }
    setSettleInputs((prev) => ({ ...prev, [towerId]: { amount: '', note: '' } }));
    reload();
  }

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <p className="page-back"><Link to="/rep">← Rep Tools</Link></p>
      <h2>Settlements</h2>
      <p className="muted" style={{ margin: '0 0 0.6rem' }}>
        Record each transfer you make to the organising committee. Your amount in hand updates automatically.
      </p>

      {towers.map((tower) => {
        const towerSettlements = settlements.filter((s) => s.tower_id === tower.id);
        const collected = towerCollected.get(tower.id) ?? 0;
        const settled = towerSettlements.reduce((s, r) => s + r.amount, 0);
        const inHand = collected - settled;
        const allSettled = collected > 0 && inHand <= 0;
        const inp = settleInputs[tower.id] ?? { amount: '', note: '' };

        return (
          <div key={tower.id} className="card card-accent">
            <div className="between">
              <h3 style={{ margin: 0 }}>{tower.name}</h3>
              {allSettled && <span className="badge soft verified">Fully Settled ✓</span>}
            </div>
            <div className="grid cols-3" style={{ marginTop: '0.6rem' }}>
              <div className="stat green">
                <div className="stat-value">{formatINR(collected)}</div>
                <div className="stat-label">Total Collected</div>
              </div>
              <div className="stat blue">
                <div className="stat-value">{formatINR(settled)}</div>
                <div className="stat-label">Settled</div>
              </div>
              <div className={`stat ${inHand > 0 ? 'amber' : 'green'}`}>
                <div className="stat-value">{formatINR(Math.max(0, inHand))}</div>
                <div className="stat-label">Amount in Hand</div>
              </div>
            </div>

            {towerSettlements.length > 0 && (
              <div className="tbl-wrap" style={{ marginTop: '0.6rem' }}>
                <table className="tbl">
                  <thead>
                    <tr><th>Date</th><th>Amount</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {towerSettlements.map((s) => (
                      <tr key={s.id}>
                        <td className="muted">{new Date(s.created_at).toLocaleDateString()}</td>
                        <td>{formatINR(s.amount)}</td>
                        <td className="muted">{s.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!allSettled && (
              <div style={{ marginTop: '0.8rem', borderTop: '1px solid var(--line)', paddingTop: '0.8rem' }}>
                <p className="muted" style={{ margin: '0 0 0.5rem' }}>Record a transfer to the organising committee:</p>
                <label>Amount (₹)
                  <input
                    type="number"
                    placeholder={inHand > 0 ? `Up to ${formatINR(inHand)}` : '0'}
                    value={inp.amount}
                    onChange={(e) => setSettleInputs((prev) => ({ ...prev, [tower.id]: { ...inp, amount: e.target.value } }))}
                  />
                </label>
                <label>Note (optional)
                  <input
                    placeholder="e.g. Cash handed to treasurer"
                    value={inp.note}
                    onChange={(e) => setSettleInputs((prev) => ({ ...prev, [tower.id]: { ...inp, note: e.target.value } }))}
                  />
                </label>
                <button
                  className="success-btn"
                  disabled={settleBusy || !inp.amount}
                  onClick={() => addSettlement(tower.id)}
                >
                  Record Settlement
                </button>
                {settleError && <p className="error" style={{ marginTop: '0.4rem' }}>{settleError}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
