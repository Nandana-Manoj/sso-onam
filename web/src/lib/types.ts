export type UserRole = 'resident' | 'tower_rep' | 'admin' | 'sponsorship';

export interface Profile {
  id: string;
  name: string;
  mobile: string;
  role: UserRole;
  tower_id: string | null;
  flat_id: string | null;
  claimed: boolean;
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
}

export type ContributionStatus =
  | 'payment_pending'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'expired';

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
