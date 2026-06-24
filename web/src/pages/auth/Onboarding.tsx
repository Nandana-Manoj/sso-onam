import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { toE164 } from '../../lib/format';
import {
  firebaseEnabled,
  sendPhoneOtp,
  confirmPhoneOtp,
  resetPhoneVerifier,
} from '../../lib/firebase';
import type { ConfirmationResult } from 'firebase/auth';
import type { PublicTower } from '../../lib/types';

/** One-time profile setup after a first Google sign-in (mobile + tower + flat).
 *  The mobile is verified via Firebase OTP — same as a password signup — so every
 *  account, however they signed in, has a verified mobile (the identity key). */
export default function Onboarding() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth();
  const nav = useNavigate();
  const [towers, setTowers] = useState<PublicTower[]>([]);
  const metaName =
    (session?.user.user_metadata?.full_name as string | undefined) ??
    (session?.user.user_metadata?.name as string | undefined) ?? '';
  const [form, setForm] = useState({ name: '', mobile: '', towerId: '', flatNumber: '' });
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // route guards: wait for load, bounce if signed out or already onboarded
  useEffect(() => {
    if (loading) return;
    if (!session) nav('/login', { replace: true });
    else if (profile) nav('/', { replace: true });
  }, [loading, session, profile, nav]);

  useEffect(() => { setForm((f) => (f.name ? f : { ...f, name: metaName })); }, [metaName]);

  useEffect(() => {
    supabase.from('public_towers').select('*').order('name').then(({ data, error }) => {
      if (error) setErr(error.message);
      else setTowers((data as PublicTower[]) ?? []);
    });
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Create the profile once the mobile is confirmed (or directly, if Firebase off).
  async function completeRegistration() {
    const { error } = await supabase.rpc('complete_registration', {
      p_name: form.name.trim(),
      p_mobile: toE164(form.mobile),
      p_tower_id: form.towerId,
      p_flat_number: form.flatNumber,
    });
    if (error) {
      throw new Error(
        error.message.includes('duplicate') || error.message.includes('unique')
          ? 'This mobile number is already registered. Log in with your mobile & password instead.'
          : error.message,
      );
    }
    await refreshProfile();
    nav('/', { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (firebaseEnabled) {
        const result = await sendPhoneOtp(toE164(form.mobile), 'recaptcha-onboarding');
        setConfirmation(result);
        setStep('otp');
      } else {
        await completeRegistration();
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (!confirmation) throw new Error('Please request a new code.');
      await confirmPhoneOtp(confirmation, code);
      await completeRegistration();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function backToForm() {
    setStep('form'); setCode(''); setConfirmation(null);
    if (firebaseEnabled) resetPhoneVerifier();
  }

  if (firebaseEnabled && step === 'otp') {
    return (
      <div className="auth-page">
        <h1>Verify your number</h1>
        <p className="muted">We sent a code to {form.mobile}.</p>
        <form onSubmit={onVerify} className="card">
          <label>Enter code
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
          </label>
          {err && <p className="error">{err}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify & finish'}</button>
          <button type="button" className="link-btn" onClick={backToForm}>Back</button>
        </form>
        <div id="recaptcha-onboarding" />
      </div>
    );
  }

  return (
    <div className="auth-page">
      <h1>Almost there 🌼</h1>
      <p className="muted">Tell us a few details to finish setting up your account.</p>
      <form onSubmit={onSubmit} className="card">
        <label>Name
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label>Mobile number
          <input type="tel" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit mobile" required />
        </label>
        <label>Tower
          <select value={form.towerId} onChange={(e) => set('towerId', e.target.value)} required>
            <option value="" disabled>Select your tower</option>
            {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Flat number
          <input value={form.flatNumber} onChange={(e) => set('flatNumber', e.target.value)} required />
        </label>
        {err && <p className="error">{err}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : firebaseEnabled ? 'Send verification code' : 'Finish setup'}
        </button>
      </form>
      <div id="recaptcha-onboarding" />
      <p className="muted">
        Not you? <button className="link-btn" onClick={() => signOut().then(() => nav('/login'))}>Sign out</button>
      </p>
    </div>
  );
}
