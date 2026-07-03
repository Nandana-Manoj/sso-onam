import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import SadyaScanner from '../components/SadyaScanner';

export default function SadyaScan() {
  const { profile } = useAuth();
  const allowed = !!profile && (profile.is_sadya_rep || profile.role === 'admin');

  // Starts optimistic (true): the scanner is offline-capable by design, and a
  // rep with no connectivity right now shouldn't be locked out just because
  // this check can't reach the network — the server still authoritatively
  // rejects redemptions if serving is actually closed (redeem_sadya_pass).
  // We only flip to false on a confirmed response, and refetch whenever the
  // rep returns to this tab so an admin's toggle takes effect without a
  // manual reload.
  const [servingOpen, setServingOpen] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const load = () => {
      supabase
        .from('events')
        .select('sadya_serving_open')
        .eq('is_active', true)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled || error) return;
          setServingOpen(!!(data as { sadya_serving_open: boolean } | null)?.sadya_serving_open);
        });
    };
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, [allowed]);

  return (
    <div className="page">
      <p className="page-back"><Link to="/">← Home</Link></p>
      <h2>Scan Sadya Passes 🍽️</h2>
      {!allowed ? (
        <p className="muted">
          You're not set up to scan sadya passes. Ask an admin to make you a sadya rep.
        </p>
      ) : !servingOpen ? (
        <div className="card disabled">
          <p className="muted" style={{ margin: 0 }}>
            Sadya serving isn't open right now. Ask an admin to open serving at the counter —
            this page picks it up automatically once you're back on it.
          </p>
        </div>
      ) : (
        <>
          <p className="muted">
            Scan a flat's QR at the counter, set how many are being served now, and redeem.
          </p>
          <SadyaScanner />
        </>
      )}
    </div>
  );
}
