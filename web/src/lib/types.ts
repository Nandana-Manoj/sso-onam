export type UserRole = 'resident' | 'tower_rep' | 'admin' | 'sponsorship';

export interface Profile {
  id: string;
  name: string;
  mobile: string;
  role: UserRole;
  tower_id: string | null;
  flat_id: string | null;
  claimed: boolean;
  is_sadya_rep: boolean;
}

export interface PublicTower {
  id: string;
  name: string;
  code: string | null;
}

export interface Tower extends PublicTower {
  rep_user_id: string | null;
  rep_contact: string | null;
  rep_upi_id: string | null;
  payment_qr_path: string | null;
}

export interface EventConfig {
  id: string;
  name: string;
  year: number;
  is_active: boolean;
  min_contribution: number;
  adult_sadya_price: number;
  child_sadya_price: number;
  booking_freeze_at: string | null;
  verification_cutoff_at: string | null;
  currency: string;
  logo_path: string | null;
  schedule_path: string | null;
  sadya_open: boolean;
  sadya_serving_open: boolean;
  status?: 'draft' | 'open' | 'closed';
  closed_at?: string | null;
}

// Per-event roster snapshot returned by get_event_roster (frozen on close).
export interface RosterAdmin { user_id: string; name: string; mobile: string }
export interface RosterTower {
  tower_id: string;
  name: string;
  rep_user_id: string | null;
  rep_name: string | null;
  rep_mobile: string | null;
  collected_verified: number;
  contributions_count: number;
  flats_paid: number;
}
export interface RosterRep {
  user_id: string;
  name: string;
  mobile: string;
  collected_verified: number;
  contributions_count: number;
}
export interface EventRoster {
  generated_at: string;
  config: { name: string; year: number; min_contribution: number; adult_sadya_price: number; child_sadya_price: number };
  admins: RosterAdmin[];
  towers: RosterTower[];
  reps: RosterRep[];
  totals: {
    collected_verified: number;
    refunded: number;
    contributions_verified: number;
    flats_total: number;
    flats_paid: number;
  };
}

export type ContributionStatus =
  | 'payment_pending'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'expired';

export type SadyaStatus =
  | 'payment_pending'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface SadyaBooking {
  id: string;
  event_id: string;
  resident_id: string;
  flat_id: string | null;
  num_adults: number;
  num_children: number;
  total_persons: number;
  adult_price_snapshot: number;
  child_price_snapshot: number;
  total_amount: number;
  status: SadyaStatus;
  paid_to_tower_id: string;
  paid_to_rep_user_id: string | null;
  amount_paid: number | null;
  utr: string | null;
  payment_submitted_at: string | null;
  verified_by_user_id: string | null;
  verified_at: string | null;
  decision_reason: string | null;
  created_at: string;
}

/** A resident's request to cancel N sadya tickets (adults/children) for a refund.
 *  Settled by the tower rep: 'requested' → 'refunded' (or declined = row removed). */
export interface SadyaCancellation {
  id: string;
  event_id: string;
  flat_id: string | null;
  resident_id: string;
  num_adults: number;
  num_children: number;
  total_persons: number;
  amount: number;
  paid_to_tower_id: string;
  status: 'requested' | 'refunded';
  reason: string | null;
  created_at: string;
}

export type QrStatus = 'issued' | 'partially_redeemed' | 'fully_redeemed' | 'void';

export interface QrPass {
  id: string;
  booking_id: string | null;
  flat_id: string | null;
  event_id: string;
  allowed_scans: number;
  nonce: string;
  redeemed_count: number;
  status: QrStatus;
}

export interface Contribution {
  id: string;
  event_id: string;
  flat_id: string;
  initiated_by_user_id: string;
  amount: number;
  min_snapshot: number;
  status: ContributionStatus;
  paid_to_tower_id: string;
  paid_to_rep_user_id: string | null;
  amount_paid: number | null;
  utr: string | null;
  screenshot_path: string | null;
  payment_submitted_at: string | null;
  verified_by_user_id: string | null;
  verified_at: string | null;
  decision_reason: string | null;
  overridden: boolean;
  refund_state: 'requested' | 'refunded' | null;
  refund_reason: string | null;
  created_at: string;
  updated_at: string;
}
