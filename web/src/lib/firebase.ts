// Firebase is used ONLY to verify that a person owns a mobile number (phone OTP).
// Google delivers the SMS on their own carrier agreements, so we avoid India's
// DLT/TRAI registration entirely. The verified number then maps deterministically
// to a Supabase account (see mobileToEmail in format.ts):
//   - at registration it gates account creation
//   - at password reset the Firebase ID token authorizes the server-side reset
// No Supabase SMS provider / MSG91 is involved.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** True when the Firebase web config is present — phone verification is available. */
export const firebaseEnabled =
  Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function getFbAuth(): Auth {
  if (!firebaseEnabled) {
    throw new Error('Phone verification is not configured. See docs/phone-verification-setup.md');
  }
  if (!auth) {
    app = initializeApp(cfg as Record<string, string>);
    auth = getAuth(app);
    // Match the device's language for the SMS / reCAPTCHA.
    auth.useDeviceLanguage();
  }
  return auth;
}

// Keep a single invisible reCAPTCHA verifier per container; re-creating it on
// every send leaks widgets and breaks subsequent verifications.
let verifier: RecaptchaVerifier | null = null;
let verifierContainerId: string | null = null;

function getVerifier(containerId: string): RecaptchaVerifier {
  if (verifier && verifierContainerId === containerId) return verifier;
  if (verifier) {
    try { verifier.clear(); } catch { /* ignore */ }
    verifier = null;
  }
  // Invisible reCAPTCHA. NOTE: on localhost an invisible token is rejected by the
  // backend (auth/invalid-app-credential — a known Firebase SDK issue), so verify
  // real numbers on the deployed domain; use Firebase test numbers on localhost.
  verifier = new RecaptchaVerifier(getFbAuth(), containerId, { size: 'invisible' });
  verifierContainerId = containerId;
  return verifier;
}

/** Reset the reCAPTCHA so the next send starts clean (call when a flow errors out). */
export function resetPhoneVerifier() {
  if (verifier) {
    try { verifier.clear(); } catch { /* ignore */ }
  }
  verifier = null;
  verifierContainerId = null;
}

/**
 * Send an OTP to an E.164 number. `containerId` is the id of an (empty) div the
 * invisible reCAPTCHA can attach to. Returns a ConfirmationResult to confirm with.
 */
export async function sendPhoneOtp(
  phoneE164: string,
  containerId: string,
): Promise<ConfirmationResult> {
  try {
    return await signInWithPhoneNumber(getFbAuth(), phoneE164, getVerifier(containerId));
  } catch (e) {
    // A failed attempt can leave the reCAPTCHA in a bad state — reset so a retry works.
    resetPhoneVerifier();
    throw e;
  }
}

/**
 * Confirm the code the user typed. Returns the Firebase ID token (a signed proof
 * that this person owns the number) for the server-side reset, plus the E.164
 * phone the token was issued for.
 */
export async function confirmPhoneOtp(
  confirmation: ConfirmationResult,
  code: string,
): Promise<{ idToken: string; phone: string }> {
  const cred = await confirmation.confirm(code);
  const idToken = await cred.user.getIdToken();
  return { idToken, phone: cred.user.phoneNumber ?? '' };
}
