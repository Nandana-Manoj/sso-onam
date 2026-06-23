import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import RoleHome from './components/RoleHome';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Onboarding from './pages/auth/Onboarding';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResidentHome from './pages/resident/ResidentHome';
import RepHome from './pages/rep/RepHome';
import AdminHome from './pages/admin/AdminHome';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminAdmins from './pages/admin/AdminAdmins';
import AdminTowers from './pages/admin/AdminTowers';
import AdminEvents from './pages/admin/AdminEvents';
import AdminReps from './pages/admin/AdminReps';

export default function App() {
  return (
    <>
      <div className="top-banner">Sobha Silicon Oasis</div>
      <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/forgot" element={<ForgotPassword />} />

      {/* Authenticated (any role) */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<RoleHome />} />
        <Route path="/home" element={<ResidentHome />} />
      </Route>

      {/* Tower Rep + Admin */}
      <Route element={<ProtectedRoute roles={['tower_rep', 'admin']} />}>
        <Route path="/rep" element={<RepHome />} />
      </Route>

      {/* Admin only */}
      <Route element={<ProtectedRoute roles={['admin']} />}>
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/admins" element={<AdminAdmins />} />
        <Route path="/admin/towers" element={<AdminTowers />} />
        <Route path="/admin/events" element={<AdminEvents />} />
        <Route path="/admin/reps" element={<AdminReps />} />
      </Route>

      <Route path="*" element={<RoleHome />} />
      </Routes>
    </>
  );
}
