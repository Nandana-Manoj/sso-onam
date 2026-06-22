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
  signIn: (mobile: string, password: string) => Promise<void>;
  register: (args: RegisterArgs) => Promise<void>;
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
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s) await loadProfile(s.user.id);
      else setProfile(null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(mobile: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: mobileToEmail(mobile),
      password,
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
      value={{ session, profile, loading, signIn, register, signOut, refreshProfile }}
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
