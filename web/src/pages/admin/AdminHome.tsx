import { Link } from 'react-router-dom';

export default function AdminHome() {
  return (
    <div className="page">
      <div className="hero">
        <h2>Admin</h2>
        <p className="hero-sub">Run the celebration — track collections and manage reps.</p>
      </div>

      <div className="section-title"><h3>Operations</h3></div>
      <div className="grid cols-2">
        <Link to="/admin/dashboard" className="card link-card">
          <h3>📊 Dashboard</h3>
          <p className="muted">Live contributions — totals, charts and per-tower breakdown.</p>
        </Link>
        <Link to="/admin/reps" className="card link-card">
          <h3>🧑‍🤝‍🧑 Representatives</h3>
          <p className="muted">Assign or remove tower reps; see each rep's collections.</p>
        </Link>
        <Link to="/admin/admins" className="card link-card">
          <h3>🛡️ Admins</h3>
          <p className="muted">Grant or revoke admin access for other residents.</p>
        </Link>
      </div>

      <div className="section-title"><h3>Setup</h3></div>
      <div className="grid cols-2">
        <Link to="/admin/events" className="card link-card">
          <h3>🎏 Events &amp; Config</h3>
          <p className="muted">Set prices, the active event, and the event logo.</p>
        </Link>
        <Link to="/admin/towers" className="card link-card">
          <h3>🏢 Towers</h3>
          <p className="muted">Add the society's towers.</p>
        </Link>
      </div>
    </div>
  );
}
