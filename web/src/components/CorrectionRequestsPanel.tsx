import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Modal from './Modal';

interface CorrectionRow {
  id: string;
  resident_name: string;
  resident_mobile: string;
  current_tower: string | null;
  current_flat: string | null;
  requested_tower: string | null;
  requested_flat: string | null;
  reason: string | null;
  created_at: string;
}

// Pending tower/flat correction requests the current rep/admin can act on.
// Listing + decisions go through SECURITY DEFINER RPCs (an incoming resident's
// profile wouldn't be visible under normal RLS).
export default function CorrectionRequestsPanel() {
  const [rows, setRows] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CorrectionRow | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('list_pending_corrections');
    if (e) setError(e.message);
    setRows((data as CorrectionRow[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, approve: boolean, rsn?: string) {
    setError(null);
    setBusyId(id);
    const { error: e } = await supabase.rpc('decide_correction', {
      p_request_id: id, p_approve: approve, p_reason: rsn ?? null,
    });
    setBusyId(null);
    if (e) setError(e.message); else load();
  }

  async function confirmReject() {
    if (!rejecting) return;
    const id = rejecting.id;
    const rsn = reason.trim() || undefined;
    setRejecting(null); setReason('');
    await decide(id, false, rsn);
  }

  if (loading) return null;

  return (
    <>
      <div className="section-title"><h3>Tower / Flat Change Requests</h3>
        {rows.length > 0 && <span className="badge awaiting">{rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="card"><p className="muted">No pending change requests.</p></div>
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="card card-accent">
              <p style={{ margin: '0 0 0.3rem' }}>
                <strong>{r.resident_name}</strong> <span className="muted">({r.resident_mobile})</span>
              </p>
              <p style={{ margin: '0 0 0.3rem' }}>
                {r.current_tower ?? '—'} · Flat {r.current_flat ?? '—'}
                {' → '}
                <strong>{(r.requested_tower ?? r.current_tower) ?? '—'} · Flat {r.requested_flat ?? '—'}</strong>
              </p>
              {r.reason && <p className="muted" style={{ margin: '0 0 0.4rem' }}>Reason: {r.reason}</p>}
              <div className="row">
                <button className="success-btn" disabled={busyId === r.id} onClick={() => decide(r.id, true)}>Approve</button>
                <button className="danger-btn" disabled={busyId === r.id} onClick={() => setRejecting(r)}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}

      {rejecting && (
        <Modal title="Reject This Request?" onClose={() => setRejecting(null)}>
          <p className="muted">
            {rejecting.resident_name} — {(rejecting.requested_tower ?? rejecting.current_tower) ?? '—'} · Flat {rejecting.requested_flat ?? '—'}
          </p>
          <label>Reason (optional)
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Flat already occupied" />
          </label>
          <div className="row">
            <button className="danger-btn" disabled={busyId === rejecting.id} onClick={confirmReject}>Reject Request</button>
            <button className="secondary" onClick={() => setRejecting(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );
}
