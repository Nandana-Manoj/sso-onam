import { Link } from 'react-router-dom';
import OfflinePaymentForm from '../../components/OfflinePaymentForm';
import { useRepData } from './useRepData';

/** Record a walk-in / offline payment for a resident who paid the rep directly. */
export default function RepWalkIn() {
  const { loading, towers, sadyaPrices, sadyaOpen, reload } = useRepData();

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <p className="page-back"><Link to="/rep">← Rep Tools</Link></p>
      <h2>Record a Walk-In</h2>
      <div className="card card-accent">
        <p className="muted" style={{ marginTop: 0 }}>
          For residents who paid you directly without using the app. This marks the flat as paid (verified).
        </p>
        <OfflinePaymentForm
          towers={towers}
          sadyaPrices={sadyaPrices}
          sadyaClosedNote={sadyaOpen ? undefined : "Sadya walk-ins aren't available until booking opens."}
          onRecorded={reload}
        />
      </div>
    </div>
  );
}
