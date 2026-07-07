import { supabase } from './supabase';
import type { ContributionStatus } from './types';

/** Public URL for a stored object (buckets here are public-read). */
export function assetUrl(bucket: string, path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export interface StatusMeta {
  label: string;
  cls: 'verified' | 'awaiting' | 'refunded' | 'none';
}

/** Map a contribution status to a display label + a badge/pill class. We surface
 *  only three payment states: Verified, Awaiting Approval, Refunded. Anything
 *  else (started, rejected, expired) is treated as "no payment yet". */
export function contributionStatusMeta(status: ContributionStatus | null | undefined): StatusMeta {
  switch (status) {
    case 'verified':
      return { label: 'Verified', cls: 'verified' };
    case 'submitted':
      return { label: 'Awaiting Approval', cls: 'awaiting' };
    default:
      return { label: 'Not started', cls: 'none' };
  }
}

/** Natural/numeric name sort so "Tower 2" comes before "Tower 10". */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
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

/** Build + download a CSV file (no dependency). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null)[][]): void {
  const esc = (v: string | number | null) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Save an image (e.g. a QR) to the device. Prefers the share sheet — on mobile
 *  that's the only reliable way to land in Photos; a plain <a download> often
 *  drops into Files/Downloads instead. Falls back to <a download> where the
 *  share sheet (or file sharing) isn't supported, e.g. desktop browsers. */
export async function saveImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return; // user cancelled the share sheet
    }
  }

  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
