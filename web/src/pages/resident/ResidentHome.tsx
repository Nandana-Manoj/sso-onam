import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import type { EventConfig } from '../../lib/types';
import { formatINR } from '../../lib/format';
import { assetUrl } from '../../lib/ui';
import ContributionPanel from './ContributionPanel';
import SadyaPanel from './SadyaPanel';

export default function ResidentHome() {
  const { profile } = useAuth();
  const [event, setEvent] = useState<EventConfig | null>(null);
  const [repContact, setRepContact] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Refetch on mount and whenever the resident returns to this tab, so an
  // admin toggling sadya booking open/closed (or the contribution phase)
  // takes effect without a manual reload.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      supabase
        .from('events')
        .select('*')
        .eq('is_active', true)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled || error) return;
          setEvent((data as EventConfig | null) ?? null);
          setLoading(false);
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
  }, []);

  useEffect(() => {
    if (!profile?.tower_id) return;
    supabase
      .from('towers')
      .select('rep_contact')
      .eq('id', profile.tower_id)
      .maybeSingle()
      .then(({ data }) => setRepContact((data as { rep_contact: string | null } | null)?.rep_contact ?? null));
  }, [profile?.tower_id]);

  const logo = assetUrl('event-assets', event?.logo_path);
  const scheduleUrl = assetUrl('event-assets', event?.schedule_path);
  const scheduleIsImage = !!event?.schedule_path && !/\.pdf$/i.test(event.schedule_path);

  return (
    <div className="page">
      {loading ? (
        <p className="muted">Loading…</p>
      ) : !event ? (
        <div className="hero">
          <h2>Welcome, {profile?.name?.split(' ')[0]} 🌼</h2>
          <p className="hero-sub">No Onam event is open right now. Please check back later.</p>
        </div>
      ) : (
        <>
          <div className="hero">
            {logo && <img className="hero-logo" src={logo} alt="" />}
            <h2>Onam Greetings, {profile?.name?.split(' ')[0]}! 🌼</h2>
            <p className="hero-sub">
              {event.name} · Minimum {formatINR(event.min_contribution)} per flat
              {event.sadya_open && ` · Sadya ${formatINR(event.adult_sadya_price)}/adult`}
            </p>
          </div>

          {scheduleUrl && (
            <details className="disclosure card">
              <summary>Event Schedule 📅</summary>
              <div style={{ marginTop: '0.6rem' }}>
                {scheduleIsImage ? (
                  <a href={scheduleUrl} target="_blank" rel="noopener noreferrer">
                    <img src={scheduleUrl} alt="Event schedule" style={{ width: '100%', borderRadius: 8 }} />
                  </a>
                ) : (
                  <p style={{ margin: 0 }}>
                    <a href={scheduleUrl} target="_blank" rel="noopener noreferrer">Open the schedule (PDF) →</a>
                  </p>
                )}
              </div>
            </details>
          )}

          {profile?.is_sadya_rep && (
            <Link to="/scan" className="card link-card">
              <h3>🍽️ Scan Sadya Passes</h3>
              <p className="muted">You're a sadya rep — scan flat QR passes at the serving counter.</p>
            </Link>
          )}

          <div className="card">
            <h3>Your Tower Rep</h3>
            {repContact
              ? <p style={{ margin: 0 }}>{repContact}</p>
              : <p className="muted" style={{ margin: 0 }}>Your tower's rep hasn't added their contact yet.</p>}
          </div>

          <ContributionPanel event={event} />

          <SadyaPanel event={event} />
        </>
      )}
    </div>
  );
}
