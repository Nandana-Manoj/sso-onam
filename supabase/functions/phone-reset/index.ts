// Self-service password reset, gated by a Firebase phone-verification token.
//
// The browser proves the user owns a mobile number via Firebase Phone Auth, then
// posts the resulting Firebase ID token here. We verify that token against
// Google's public keys, derive the account's synthetic email from the *verified*
// phone (so a caller can only reset the number they actually proved), and set the
// new password with the service role. The client then signs in normally.
//
// Deploy:  supabase functions deploy phone-reset --no-verify-jwt
//   (no Supabase user session exists during a reset — the Firebase token is the
//    authorization, not a Supabase JWT.)
// Secret:  supabase secrets set FIREBASE_PROJECT_ID=your-firebase-project-id
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5';

const PHONE_EMAIL_DOMAIN = 'phone.sso-onam.com'; // must match web/src/lib/format.ts

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Google's public keys for Firebase ID tokens (JWKS form).
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const projectId = Deno.env.get('FIREBASE_PROJECT_ID');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectId || !supabaseUrl || !serviceKey) {
    return json({ error: 'phone-reset is not configured' }, 500);
  }

  let idToken: string | undefined;
  let newPassword: string | undefined;
  try {
    ({ idToken, newPassword } = await req.json());
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  if (!idToken || !newPassword) return json({ error: 'Missing idToken or newPassword' }, 400);
  if (String(newPassword).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  // 1. Verify the Firebase ID token: signature + issuer + audience + expiry.
  let phone: string | undefined;
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    phone = payload.phone_number as string | undefined;
  } catch (e) {
    return json({ error: `Invalid verification token: ${(e as Error).message}` }, 401);
  }
  if (!phone) return json({ error: 'Token has no verified phone number' }, 401);

  // 2. Map the verified phone → account. profiles.mobile is the E.164 source of
  //    truth; the synthetic email is derived from the same digits.
  const digits = phone.replace(/\D/g, '');
  const email = `${digits}@${PHONE_EMAIL_DOMAIN}`;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: lookupError } = await admin
    .from('profiles')
    .select('id')
    .eq('mobile', phone)
    .maybeSingle();
  if (lookupError) return json({ error: lookupError.message }, 500);
  if (!profile) return json({ error: 'No account is registered with that number' }, 404);

  // 3. Set the new password (and keep the synthetic email confirmed).
  const { error: updateError } = await admin.auth.admin.updateUserById(profile.id as string, {
    password: String(newPassword),
    email_confirm: true,
  });
  if (updateError) return json({ error: updateError.message }, 500);

  // Return the phone so the client knows which (synthetic) email to sign in with.
  return json({ phone, email });
});
