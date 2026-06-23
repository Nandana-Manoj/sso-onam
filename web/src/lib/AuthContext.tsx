import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';
import { toE164, mobileToEmail } from './format';
import { OTP_ENABLED } from './config';

interface RegisterArgs {
  name: string;
  mobile: string;
  password: string;
  towerId: string;
  flatNumber: string;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  otpEnabled: boolean;
  signIn: (mobile: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  register: (args: RegisterArgs) => Promise<void>;
  // phone-OTP mode (VITE_ENABLE_OTP=true)
  startPhoneSignup: (mobile: string, password: string) => Promise<void>;
  completePhoneSignup: (args: RegisterArgs, token: string) => Promise<void>;
  startOtpLogin: (mobile: string) => Promise<void>;
  verifyOtpLogin: (mobile: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.error('loadProfile', error);
      setProfile(null);
      return;
    }
    setProfile((data as Profile | null) ?? null);
  }

  useEffect(() => {
    let active = true;
    // onAuthStateChange fires INITIAL_SESSION on subscribe (and SIGNED_IN after
    // the OAuth code exchange). We must NOT await Supabase DB calls *inside* the
    // callback — that runs under the auth lock and deadlocks (symptom: stuck on
    // "Loading…" after Google login until a refresh). Defer loadProfile instead.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      setSession(s);
      if (s) {
        setTimeout(async () => {
          await loadProfile(s.user.id);
          if (active) setLoading(false);
        }, 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(mobile: string, password: string) {
    const { error } = OTP_ENABLED
      ? await supabase.auth.signInWithPassword({ phone: toE164(mobile), password })
      : await supabase.auth.signInWithPassword({ email: mobileToEmail(mobile), password });
    if (error) throw error;
  }

  // --- phone-OTP mode helpers (used when OTP_ENABLED) ---
  async function startPhoneSignup(mobile: string, password: string) {
    // creates a phone-keyed user and triggers an OTP via the Send-SMS hook
    const { error } = await supabase.auth.signUp({ phone: toE164(mobile), password });
    if (error) throw error;
  }

  async function completePhoneSignup(args: RegisterArgs, token: string) {
    const phone = toE164(args.mobile);
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw error;
    if (!data.session) throw new Error('Could not verify the code. Please try again.');
    const { error: rpcError } = await supabase.rpc('complete_registration', {
      p_name: args.name,
      p_mobile: phone,
      p_tower_id: args.towerId,
      p_flat_number: args.flatNumber,
    });
    if (rpcError) throw rpcError;
    await loadProfile(data.session.user.id);
  }

  async function startOtpLogin(mobile: string) {
    const { error } = await supabase.auth.signInWithOtp({ phone: toE164(mobile) });
    if (error) throw error;
  }

  async function verifyOtpLogin(mobile: string, token: string) {
    const { error } = await supabase.auth.verifyOtp({ phone: toE164(mobile), token, type: 'sms' });
    if (error) throw error;
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async function register(args: RegisterArgs) {
    const phone = toE164(args.mobile);
    const { data, error } = await supabase.auth.signUp({
      email: mobileToEmail(args.mobile),
      password: args.password,
    });
    if (error) throw error;
    if (!data.session) {
      throw new Error(
        'Account created but no session was returned. Disable "Confirm email" in Supabase Auth settings (v1 has no SMS/email sending).',
      );
    }
    const { error: rpcError } = await supabase.rpc('complete_registration', {
      p_name: args.name,
      p_mobile: phone,
      p_tower_id: args.towerId,
      p_flat_number: args.flatNumber,
    });
    if (rpcError) throw rpcError;
    await loadProfile(data.session.user.id);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  async function refreshProfile() {
    if (session) await loadProfile(session.user.id);
  }

  return (
    <AuthContext.Provider
      value={{
        session, profile, loading, otpEnabled: OTP_ENABLED,
        signIn, signInWithGoogle, register,
        startPhoneSignup, completePhoneSignup, startOtpLogin, verifyOtpLogin,
        signOut, refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
