// Supabase "Send SMS" auth hook → delivers OTPs via MSG91 (Flow API v5).
//
// Supabase calls this function whenever it needs to send an SMS OTP (phone
// signup, OTP login, phone-change). It receives the user + the generated OTP,
// and we forward it to the resident's mobile through MSG91 using a
// DLT-approved template.
//
// Deploy:  supabase functions deploy send-sms --no-verify-jwt
// Secrets (supabase secrets set ...):
//   MSG91_AUTHKEY        your MSG91 auth key
//   MSG91_TEMPLATE_ID    the DLT-approved Flow template id (contains the OTP var)
//   MSG91_OTP_VAR        template variable name for the OTP (default: OTP)
//   SEND_SMS_HOOK_SECRET the Supabase hook secret (v1,whsec_...) for verification
//
// Then in Supabase: Authentication → Hooks → "Send SMS" → enable → point to
// this function and paste the same hook secret.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

interface SendSmsPayload {
  user: { phone?: string };
  sms: { otp: string };
}

Deno.serve(async (req) => {
  const authkey = Deno.env.get('MSG91_AUTHKEY');
  const templateId = Deno.env.get('MSG91_TEMPLATE_ID');
  const otpVar = Deno.env.get('MSG91_OTP_VAR') ?? 'OTP';
  const hookSecret = Deno.env.get('SEND_SMS_HOOK_SECRET');

  if (!authkey || !templateId) {
    return new Response(JSON.stringify({ error: 'MSG91 not configured' }), { status: 500 });
  }

  const raw = await req.text();

  // Verify the request really came from Supabase (Standard Webhooks signature).
  let payload: SendSmsPayload;
  try {
    if (hookSecret) {
      const wh = new Webhook(hookSecret.replace('v1,whsec_', '').replace('whsec_', ''));
      payload = wh.verify(raw, Object.fromEntries(req.headers)) as SendSmsPayload;
    } else {
      payload = JSON.parse(raw) as SendSmsPayload;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: `invalid signature: ${(e as Error).message}` }), { status: 401 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return new Response(JSON.stringify({ error: 'missing phone/otp' }), { status: 400 });
  }

  // MSG91 wants the number with country code and no '+' (e.g. 919876543210)
  const mobiles = String(phone).replace(/\D/g, '');

  const res = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: templateId,
      recipients: [{ mobiles, [otpVar]: otp }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return new Response(JSON.stringify({ error: `MSG91 send failed: ${body}` }), { status: 500 });
  }

  // 200 + empty body tells Supabase the SMS was sent.
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
