import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { GoogleMark } from '../../components/Icons';
import { toE164 } from '../../lib/format';
import { byName } from '../../lib/ui';
import { GOOGLE_AUTH_ENABLED } from '../../lib/config';
import {
  firebaseEnabled,
  sendPhoneOtp,
  confirmPhoneOtp,
  resetPhoneVerifier,
} from '../../lib/firebase';
import type { ConfirmationResult } from 'firebase/auth';
import type { PublicTower } from '../../lib/types';

export default function Register() {
  const { register, signInWithGoogle, startPhoneSignup, completePhoneSignup, otpEnabled, session } = useAuth();
  const nav = useNavigate();
  const [towers, setTowers] = useState<PublicTower[]>([]);

  // returning from Google OAuth with a session → leave the register page
  useEffect(() => { if (session) nav('/', { replace: true }); }, [session, nav]);
  const [form, setForm] = useState({ name: '', mobile: '', towerId: '', flatNumber: '', password: '' });
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Firebase phone-verification handle (set after the OTP is sent).
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  // Whether phone verification gates this signup. Firebase is preferred; the
  // older Supabase-OTP path stays as a fallback when only that is configured.
  const phoneVerify = firebaseEnabled || otpEnabled;

  useEffect(() => {
    supabase.from('public_towers').select('*').order('name').then(({ data, error }) => {
      if (error) setErr(error.message);
      else setTowers(((data as PublicTower[]) ?? []).sort(byName));
    });
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (firebaseEnabled) {
        const result = await sendPhoneOtp(toE164(form.mobile), 'recaptcha-register');
        setConfirmation(result);
        setStep('otp');
      } else if (otpEnabled) {
        await startPhoneSignup(form.mobile, form.password); // sends OTP via Supabase hook
        setStep('otp');
      } else {
        await register(form);
        nav('/');
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (firebaseEnabled) {
        if (!confirmation) throw new Error('Please request a new code.');
        // Confirm ownership with Firebase, then create the Supabase account.
        await confirmPhoneOtp(confirmation, code);
        await register(form);
        nav('/');
      } else {
        await completePhoneSignup(form, code);
        nav('/');
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function backToForm() {
    setStep('form'); setCode(''); setConfirmation(null);
    if (firebaseEnabled) resetPhoneVerifier();
  }

  if (phoneVerify && step === 'otp') {
    return (
      <div className="auth-page">
        <h1>Verify Your Number</h1>
        <p className="muted">We sent a code to {form.mobile}.</p>
        <p className="muted">Didn't get it? Check your spam or blocked messages folder.</p>
        <form onSubmit={onVerify} className="card">
          <label>Enter Code
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
          </label>
          {err && <p className="error">{err}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify & Finish'}</button>
          <button type="button" className="link-btn" onClick={backToForm}>Back</button>
        </form>
        {/* Invisible reCAPTCHA mount point for Firebase phone auth. */}
        <div id="recaptcha-register" />
      </div>
    );
  }

  return (
    <div className="auth-page">
      <h1>Create Your Account</h1>
      <form onSubmit={onSubmit} className="card">
        <label>Name<input name="name" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} required /></label>
        <label>Mobile Number
          <input type="tel" name="mobile" autoComplete="username" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit mobile" required />
        </label>
        <label>Tower
          <select value={form.towerId} onChange={(e) => set('towerId', e.target.value)} required>
            <option value="" disabled>Select Your Tower</option>
            {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Flat Number<input autoComplete="off" value={form.flatNumber} onChange={(e) => set('flatNumber', e.target.value)} placeholder="e.g. 10183" required /></label>
        <label>Password
          <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="At least 6 characters" minLength={6} required />
        </label>
        {/* "I'm not a robot" checkbox — tick it before requesting the code. */}
        {firebaseEnabled && <div id="recaptcha-register" style={{ marginTop: '0.8rem' }} />}
        {err && <p className="error">{err}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : phoneVerify ? 'Send Verification Code' : 'Create Account'}
        </button>
        {GOOGLE_AUTH_ENABLED && (
          <>
            <div className="or-divider"><span>or</span></div>
            <button
              type="button"
              className="google-btn"
              onClick={async () => {
                setErr(null);
                try { await signInWithGoogle(); }
                catch (e) {
                  const m = (e as Error).message;
                  setErr(m.includes('provider is not enabled')
                    ? 'Google sign-in isn’t available right now. Please use mobile & password.'
                    : m);
                }
              }}
            >
              <GoogleMark /> Continue with Google
            </button>
          </>
        )}
      </form>
      <p className="muted">Already have an account? <Link to="/login">Log in</Link></p>
    </div>
  );
}
