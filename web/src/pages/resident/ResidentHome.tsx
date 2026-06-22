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
            <h2>Onam greetings, {profile?.name?.split(' ')[0]}! 🌼</h2>
            <p className="hero-sub">
              {event.name} · minimum {formatINR(event.min_contribution)} per flat · sadya {formatINR(event.adult_sadya_price)}/adult
            </p>
          </div>

          <ContributionPanel event={event} />

          <div className="card disabled">
            <h3>Book Sadya 🍛</h3>
            <p className="muted">Coming in the next phase.</p>
          </div>
        </>
      )}
    </div>
  );
}
