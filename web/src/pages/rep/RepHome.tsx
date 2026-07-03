import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { useRepData, pendingCounts } from './useRepData';

/** Rep tools hub — a compact landing page of cards (like the admin home) so the
 *  event-day essentials aren't buried in one long scroll. Each card opens a
 *  focused sub-page; the verification card surfaces a pending count up front. */
export default function RepHome() {
  const { profile } = useAuth();
  const d = useRepData();
  const counts = pendingCounts(d);

  // Tower/flat change requests come through their own RPC — fold their count into
  // the verification badge so "anything pending?" is answered without going in.
  const [corrections, setCorrections] = useState(0);
  useEffect(() => {
    supabase.rpc('list_pending_corrections').then(({ data }) => setCorrections(((data as unknown[]) ?? []).length));
  }, []);
  const pendingTotal = counts.total + corrections;

  const canScan = profile?.is_sadya_rep || profile?.role === 'admin';

  if (d.loading) return <div className="page"><p className="muted">Loading…</p></div>;

  if (d.towers.length === 0) {
    return (
      <div className="page">
        <div className="hero"><h2>Tower Representative</h2></div>
        <div className="card"><p className="muted">You're not assigned to any tower right now.</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="hero">
        <h2>Tower Representative</h2>
        <p className="hero-sub">
          Managing <strong>{d.towers.map((t) => t.name).join(', ')}</strong>
        </p>
      </div>

      <div className="section-title"><h3>Event Related</h3></div>
      <div className="grid cols-2">
        <Link to="/rep/verify" className="card link-card">
          <div className="between">
            <h3>✅ Verification Queues</h3>
            {pendingTotal > 0 && <span className="badge awaiting">{pendingTotal}</span>}
          </div>
          <p className="muted">
            {pendingTotal > 0
              ? `${pendingTotal} item${pendingTotal === 1 ? '' : 's'} waiting — payments, sadya, refunds & change requests.`
              : 'Approve payments & sadya bookings, handle refunds and change requests.'}
          </p>
        </Link>

        {canScan && (
          <Link to="/scan" className="card link-card">
            <h3>🍽️ Scan Sadya Passes</h3>
            <p className="muted">Scan flat QR passes and redeem meals at the serving counter.</p>
          </Link>
        )}

        <Link to="/rep/dashboard" className="card link-card">
          <h3>📊 Dashboards</h3>
          <p className="muted">Live collections, sadya serving progress and the tower leaderboard.</p>
        </Link>

        <Link to="/rep/walk-in" className="card link-card">
          <h3>🚶 Record a Walk-In</h3>
          <p className="muted">Log an offline payment for a resident who paid you directly.</p>
        </Link>
      </div>

      <div className="section-title"><h3>Manage</h3></div>
      <div className="grid cols-2">
        <Link to="/rep/settlements" className="card link-card">
          <h3>💸 Settlements</h3>
          <p className="muted">Record transfers to the organising committee; track your amount in hand.</p>
        </Link>
        <Link to="/rep/payment" className="card link-card">
          <h3>⚙️ Payment Details</h3>
          <p className="muted">Your UPI ID, payment number and QR shown to residents.</p>
        </Link>
      </div>
    </div>
  );
}
