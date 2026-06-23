# SMS (mobile OTP) auth setup — MSG91

Goal: residents can log in with **mobile + OTP** *and* mobile + password, on a
single phone-keyed account. Mobile becomes the verified identity. Google stays
as an additional option. Integrity is guaranteed by a unique mobile per account
(see "Data integrity" below).

> **Sequencing:** DLT registration is the long pole (days). Do steps 1–4 first.
> The app-side switch to phone auth happens only **after** SMS delivery is
> confirmed working — flipping it before then would lock everyone out.

## 1. MSG91 account + DLT
1. Create an account at msg91.com.
2. Complete **DLT registration** (TRAI requirement for India): register the
   sender entity and an **OTP template** (e.g. `Your Sobha Silicon Oasis Onam
   code is ##OTP##`). MSG91 guides this; approval takes a few days.
3. Note your **Auth Key**, the approved **Flow/Template ID**, and the **variable
   name** used for the code in the template (e.g. `OTP`).

## 2. Deploy the Send-SMS edge function
The function lives at `supabase/functions/send-sms/`. Deploy with the CLI
(or paste it in the dashboard → Edge Functions):
```bash
supabase functions deploy send-sms --no-verify-jwt
```
Set its secrets:
```bash
supabase secrets set MSG91_AUTHKEY=xxxx MSG91_TEMPLATE_ID=xxxx MSG91_OTP_VAR=OTP
# after step 3, also: SEND_SMS_HOOK_SECRET=v1,whsec_xxxx
```

## 3. Enable phone auth + the hook in Supabase
1. **Authentication → Providers → Phone** → enable. (No native provider needed —
   delivery goes through our hook.)
2. **Authentication → Hooks → Send SMS** → enable → select the `send-sms`
   function → copy the generated **hook secret** and set it as
   `SEND_SMS_HOOK_SECRET` (step 2).
3. Keep OTP expiry/length at defaults.

## 4. Test delivery
Use Supabase's "test" or sign up a phone from the app once the app-side flow is
on — confirm the OTP arrives on a real handset.

## 5. App-side switch (done by us, after delivery works)
- Registration → `signUp({ phone, password })` (OTP-confirmed), then
  `complete_registration`.
- Login keeps **password** and adds **"Log in with OTP"**
  (`signInWithOtp` / `verifyOtp`) — both resolve to the same phone account.
- Existing synthetic-email test accounts re-register (small set).

## Data integrity across methods (mobile + password, OTP, Google)
- **`profiles.mobile` is UNIQUE** — the single dedup key. Every auth path funnels
  through `complete_registration`, which now rejects an already-used mobile with
  a clear message. So no two accounts can share a mobile, regardless of how the
  person signed in.
- Google users still set their mobile at onboarding; if it's taken, they're told
  to use their original method.
- Future hardening: link a Google identity onto the same phone account (Supabase
  identity linking) + an admin "merge accounts" tool for rare collisions
  (number change, shared family number).
