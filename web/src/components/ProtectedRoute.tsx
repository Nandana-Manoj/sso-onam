import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import type { UserRole } from '../lib/types';
import Layout from './Layout';

export default function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <div className="center">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;
  if (roles && !roles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
