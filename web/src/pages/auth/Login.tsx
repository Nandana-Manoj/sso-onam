import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { GoogleMark } from '../../components/Icons';

export default function Login() {
  const { signIn, signInWithGoogle, startOtpLogin, verifyOtpLogin, otpEnabled, session } = useAuth();
  const nav = useNavigate();

  // if a session appears (e.g. returning from Google OAuth), leave the login page
  useEffect(() => { if (session) nav('/', { replace: true }); }, [session, nav]);
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await signIn(mobile, password); nav('/'); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onSendCode(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await startOtpLogin(mobile); setOtpSent(true); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await verifyOtpLogin(mobile, code); nav('/'); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onGoogle() {
    setErr(null);
    try { await signInWithGoogle(); }
    catch (e) {
      const m = (e as Error).message;
      setErr(m.includes('provider is not enabled')
        ? 'Google sign-in isn’t available right now. Please use your mobile number.'
        : m);
    }
  }

  return (
    <div className="auth-page">
      <h1>🌼 Onam</h1>
      <p className="muted">Log in with your mobile number.</p>

      {otpEnabled && (
        <div className="seg">
          <button className={mode === 'password' ? 'on' : ''} onClick={() => { setMode('password'); setErr(null); }}>Password</button>
          <button className={mode === 'otp' ? 'on' : ''} onClick={() => { setMode('otp'); setErr(null); }}>OTP</button>
        </div>
      )}

      <div className="card">
        {/* Password login */}
        {(!otpEnabled || mode === 'password') && (
          <form onSubmit={onPassword}>
            <label>Mobile number
              <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile" required />
            </label>
            <label>Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {err && <p className="error">{err}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          </form>
        )}

        {/* OTP login */}
        {otpEnabled && mode === 'otp' && (
          !otpSent ? (
            <form onSubmit={onSendCode}>
              <label>Mobile number
                <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile" required />
              </label>
              {err && <p className="error">{err}</p>}
              <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
            </form>
          ) : (
            <form onSubmit={onVerify}>
              <p className="muted">We sent a code to {mobile}.</p>
              <label>Enter code
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
              </label>
              {err && <p className="error">{err}</p>}
              <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify & log in'}</button>
              <button type="button" className="link-btn" onClick={() => { setOtpSent(false); setCode(''); }}>Change number</button>
            </form>
          )
        )}

        <div className="or-divider"><span>or</span></div>
        <button type="button" className="google-btn" onClick={onGoogle}>
          <GoogleMark /> Continue with Google
        </button>
      </div>

      <p className="muted">New here? <Link to="/register">Create an account</Link></p>
      <p className="muted"><Link to="/forgot">Forgot password?</Link></p>
    </div>
  );
}
