import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

/** Index route: send each role to its home. */
export default function RoleHome() {
  const { session, profile, loading } = useAuth();
  if (loading) return <div className="center">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;
  switch (profile.role) {
    case 'admin':
      return <Navigate to="/admin" replace />;
    case 'tower_rep':
      return <Navigate to="/rep" replace />;
    default:
      return <Navigate to="/home" replace />;
  }
}
