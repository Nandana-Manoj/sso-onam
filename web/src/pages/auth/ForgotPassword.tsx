import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { toE164 } from '../../lib/format';
import {
  firebaseEnabled,
  sendPhoneOtp,
  confirmPhoneOtp,
  resetPhoneVerifier,
} from '../../lib/firebase';
import type { ConfirmationResult } from 'firebase/auth';

// Self-service reset: prove you own the number via a Firebase phone OTP, then set
// a new password. The Firebase ID token authorizes the server-side reset (see the
// phone-reset edge function), so no session or old password is needed.
export default function ForgotPassword() {
  const { resetPasswordWithPhone } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<'mobile' | 'code' | 'password'>('mobile');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // When Firebase isn't configured, fall back to the rep/admin-assisted reset.
  if (!firebaseEnabled) {
    return (
      <div className="auth-page">
        <h1>Forgot password</h1>
        <div className="card">
          <p>
            Password resets are handled by your <strong>Tower Representative</strong> or an{' '}
            <strong>Admin</strong>. Please contact your tower rep — they can reset your password
            for you.
          </p>
        </div>
        <p className="muted"><Link to="/login">Back to log in</Link></p>
      </div>
    );
  }

  async function onSendCode(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const result = await sendPhoneOtp(toE164(mobile), 'recaptcha-forgot');
      setConfirmation(result);
      setStep('code');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onVerifyCode(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (!confirmation) throw new Error('Please request a new code.');
      const { idToken } = await confirmPhoneOtp(confirmation, code);
      setIdToken(idToken);
      setStep('password');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onSetPassword(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (!idToken) throw new Error('Verification expired. Please start again.');
      await resetPasswordWithPhone(idToken, password);
      nav('/');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function restart() {
    setStep('mobile'); setCode(''); setPassword('');
    setConfirmation(null); setIdToken(null);
    resetPhoneVerifier();
  }

  return (
    <div className="auth-page">
      <h1>Reset your password</h1>
      <div className="card">
        {step === 'mobile' && (
          <form onSubmit={onSendCode}>
            <p className="muted">Enter your mobile number and we’ll send a verification code.</p>
            <label>Mobile number
              <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile" required />
            </label>
            {err && <p className="error">{err}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={onVerifyCode}>
            <p className="muted">We sent a code to {mobile}.</p>
            <label>Enter code
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
            </label>
            {err && <p className="error">{err}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
            <button type="button" className="link-btn" onClick={restart}>Change number</button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={onSetPassword}>
            <p className="muted">Number verified. Choose a new password.</p>
            <label>New password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            </label>
            {err && <p className="error">{err}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password & log in'}</button>
          </form>
        )}
      </div>
      {/* Invisible reCAPTCHA mount point for Firebase phone auth. */}
      <div id="recaptcha-forgot" />
      <p className="muted"><Link to="/login">Back to log in</Link></p>
    </div>
  );
}
