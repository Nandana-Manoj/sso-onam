import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see web/.env.example');
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,      // long "remember me" session through the active weeks
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
