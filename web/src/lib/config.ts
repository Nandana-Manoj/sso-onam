// Feature flags. Flip VITE_ENABLE_OTP to 'true' (and redeploy) only once the
// MSG91 Send-SMS hook is live and delivering OTPs — see docs/sms-auth-setup.md.
// When false, the app uses mobile + password (synthetic email) + Google.
// When true, accounts are phone-keyed: register/login via OTP, plus password.
export const OTP_ENABLED = import.meta.env.VITE_ENABLE_OTP === 'true';
