import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import type { EventConfig } from '../../lib/types';
import { formatINR } from '../../lib/format';
import { assetUrl } from '../../lib/ui';
import ContributionPanel from './ContributionPanel';

export default function ResidentHome() {
  const { profile } = useAuth();
  const [event, setEvent] = useState<EventConfig | null>(null);
  const [repContact, setRepContact] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        setEvent((data as EventConfig | null) ?? null);
        setLoading(false);
      });
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
              {event.name} · Minimum {formatINR(event.min_contribution)} per flat · Sadya {formatINR(event.adult_sadya_price)}/adult
            </p>
          </div>

          <ContributionPanel event={event} />

          <div className="card">
            <h3>Your Tower Rep</h3>
            {repContact
              ? <p style={{ margin: 0 }}>{repContact}</p>
              : <p className="muted" style={{ margin: 0 }}>Your tower's rep hasn't added their contact yet.</p>}
          </div>

          <div className="card disabled">
            <h3>Book Sadya 🍛</h3>
            <p className="muted">Coming in the next phase.</p>
          </div>
        </>
      )}
    </div>
  );
}
