import { supabase } from './supabase';
import type { ContributionStatus } from './types';

/** Public URL for a stored object (buckets here are public-read). */
export function assetUrl(bucket: string, path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export interface StatusMeta {
  label: string;
  cls: 'verified' | 'awaiting' | 'pending' | 'rejected' | 'none';
}

/** Map a contribution status to a display label + a badge/pill class. */
export function contributionStatusMeta(status: ContributionStatus | null | undefined): StatusMeta {
  switch (status) {
    case 'verified':
      return { label: 'Verified', cls: 'verified' };
    case 'submitted':
      return { label: 'Awaiting', cls: 'awaiting' };
    case 'payment_pending':
      return { label: 'Started', cls: 'pending' };
    case 'rejected':
      return { label: 'Rejected', cls: 'rejected' };
    default:
      return { label: 'Not started', cls: 'none' };
  }
}

/** Title-case a role like "tower_rep" -> "Tower Rep". */
export function prettyRole(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Build a UPI deep link (upi://pay) that opens the payer's UPI app prefilled. */
export function buildUpiLink(opts: { pa: string; pn?: string; am?: number | string; tn?: string }): string {
  const parts = [`pa=${encodeURIComponent(opts.pa)}`, 'cu=INR'];
  if (opts.pn) parts.push(`pn=${encodeURIComponent(opts.pn)}`);
  if (opts.am !== undefined && opts.am !== '' && opts.am !== null) parts.push(`am=${encodeURIComponent(String(opts.am))}`);
  if (opts.tn) parts.push(`tn=${encodeURIComponent(opts.tn)}`);
  return `upi://pay?${parts.join('&')}`;
}

/** Download an image (e.g. a QR) to the device — saves to the camera roll on mobile. */
export async function saveImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
