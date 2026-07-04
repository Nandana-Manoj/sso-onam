// Feature flags. Flip VITE_ENABLE_OTP to 'true' (and redeploy) only once the
// MSG91 Send-SMS hook is live and delivering OTPs — see docs/sms-auth-setup.md.
// When false, the app uses mobile + password (synthetic email) + Google.
// When true, accounts are phone-keyed: register/login via OTP, plus password.
export const OTP_ENABLED = import.meta.env.VITE_ENABLE_OTP === 'true';

// Google's OAuth client for prod was disabled by Google (2026-07-04, see
// firebase-outage-2026-07-04 memory — likely the same project-suspension
// root cause as the Firebase outage that day). Hides the "Continue with
// Google" button until that's fixed. Set VITE_ENABLE_GOOGLE_AUTH=true (and
// redeploy) to bring it back — no other code change needed.
export const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';
