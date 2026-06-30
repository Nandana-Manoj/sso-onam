import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import SadyaScanner from '../components/SadyaScanner';

export default function SadyaScan() {
  const { profile } = useAuth();
  const allowed = !!profile && (profile.is_sadya_rep || profile.role === 'admin');

  return (
    <div className="page">
      <p className="page-back"><Link to="/">← Home</Link></p>
      <h2>Scan Sadya Passes 🍽️</h2>
      {allowed ? (
        <>
          <p className="muted">
            Scan a flat's QR at the counter, set how many are being served now, and redeem.
          </p>
          <SadyaScanner />
        </>
      ) : (
        <p className="muted">
          You're not set up to scan sadya passes. Ask an admin to make you a sadya rep.
        </p>
      )}
    </div>
  );
}
