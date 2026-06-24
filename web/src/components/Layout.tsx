import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { assetUrl, prettyRole } from '../lib/ui';

export default function Layout({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [logo, setLogo] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string | null>(null);
  const [flatInfo, setFlatInfo] = useState<{ flat: string; tower: string } | null>(null);

  useEffect(() => {
    supabase
      .from('events')
      .select('name, logo_path')
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        const e = data as { name: string; logo_path: string | null } | null;
        setLogo(assetUrl('event-assets', e?.logo_path));
        setEventName(e?.name ?? null);
      });
  }, []);

  // Flat + tower read from the flat itself (source of truth — never drifts).
  useEffect(() => {
    if (!profile?.flat_id) return;
    supabase
      .from('flats')
      .select('flat_number, towers(name)')
      .eq('id', profile.flat_id)
      .maybeSingle()
      .then(({ data }) => {
        const f = data as unknown as { flat_number: string; towers: { name: string } | null } | null;
        if (f) setFlatInfo({ flat: f.flat_number, tower: f.towers?.name ?? '—' });
      });
  }, [profile?.flat_id]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">
          {logo ? <img className="brand-logo" src={logo} alt="" /> : <span>🌼</span>}
          {eventName ?? 'Onam'}
        </span>

        {profile?.role === 'tower_rep' && (
          <nav className="head-nav">
            <NavLink to="/rep" className={({ isActive }) => (isActive ? 'active' : '')}>Rep tools</NavLink>
            <NavLink to="/home" className={({ isActive }) => (isActive ? 'active' : '')}>My flat</NavLink>
          </nav>
        )}
        {profile?.role === 'admin' && (
          <nav className="head-nav">
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>Admin</NavLink>
            <NavLink to="/home" className={({ isActive }) => (isActive ? 'active' : '')}>My flat</NavLink>
          </nav>
        )}

        <span className="spacer" />
        {profile && (
          <span className="who">
            <strong>{profile.name}</strong>
            <em>{prettyRole(profile.role)}</em>
            {flatInfo && <span className="who-flat">{flatInfo.tower} · Flat {flatInfo.flat}</span>}
          </span>
        )}
        {profile && (
          <NavLink to="/profile" className={({ isActive }) => `link-btn${isActive ? ' active' : ''}`}>
            Profile
          </NavLink>
        )}
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
