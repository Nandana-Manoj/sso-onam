/** Normalize a user-entered mobile to E.164 (India default). */
export function toE164(mobile: string): string {
  const trimmed = mobile.trim().replace(/[\s-]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`;
  return trimmed;
}

/**
 * Mobile is the real identity. Supabase Auth needs an email for password
 * sign-in without an SMS provider, so we derive a deterministic synthetic
 * email from the mobile. No email is ever sent (email confirmations are
 * disabled); profiles.mobile stores the actual number.
 */
const PHONE_EMAIL_DOMAIN = 'phone.sso-onam.com';
export function mobileToEmail(mobile: string): string {
  const digits = toE164(mobile).replace(/\D/g, '');
  return `${digits}@${PHONE_EMAIL_DOMAIN}`;
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}
