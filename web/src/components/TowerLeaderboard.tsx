import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/format';

interface LeaderboardRow {
  tower_id: string;
  tower_name: string;
  families: number;
  sadya_passes: number;
  total_amount: number;
}

export default function TowerLeaderboard({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .rpc('get_tower_leaderboard', { p_event_id: eventId })
      .then(({ data }) => {
        setRows((data as LeaderboardRow[]) ?? []);
        setLoading(false);
      });
  }, [eventId]);

  if (loading || rows.length === 0) return null;

  return (
    <div className="card">
      <h3>Tower Leaderboard</h3>
      <p className="muted" style={{ marginTop: 0, marginBottom: '0.6rem' }}>
        How every tower is doing this Onam.
      </p>
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Tower</th>
            <th>Families</th>
            <th>Sadya Passes</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.tower_id}>
              <td className="muted">{i + 1}</td>
              <td>{r.tower_name}</td>
              <td>{r.families || '—'}</td>
              <td>{r.sadya_passes || '—'}</td>
              <td>{r.total_amount ? formatINR(r.total_amount) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
