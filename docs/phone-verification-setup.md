# Phone verification & self-service password reset — Firebase

Goal: verify a resident's mobile number at **registration**, so that later, if they
forget their password, **"Forgot password"** is self-service — prove the number via
an OTP, then set a new password. No old password or session is needed.

We use **Firebase Phone Auth** purely to *prove number ownership*. Google delivers
the SMS on its own carrier agreements, so we avoid India's **DLT/TRAI** registration
(the thing that made MSG91 painful). The verified number then maps deterministically
to the Supabase account via the synthetic email (`{digits}@phone.sso-onam.com`).
Accounts stay email/password-keyed — login is unchanged.

## How it fits together
- **Register** ([web/src/pages/auth/Register.tsx](../web/src/pages/auth/Register.tsx)):
  fill the form → Firebase sends an OTP (invisible reCAPTCHA) → on confirm, the
  existing `register()` creates the Supabase account. `profiles.mobile` uniqueness
  still prevents two accounts sharing a number.
- **Forgot password** ([web/src/pages/auth/ForgotPassword.tsx](../web/src/pages/auth/ForgotPassword.tsx)):
  mobile → OTP → new password. The Firebase **ID token** is posted to the
  `phone-reset` edge function, which verifies it server-side and resets the password
  with the service role. This is the security boundary — a client can only reset the
  number it actually proved it owns.

## 1. Firebase project
1. Create a project at <https://console.firebase.google.com>.
2. **Build → Authentication → Sign-in method → Phone → Enable.**
3. **Authentication → Settings → Authorized domains**: add `localhost` and your
   Vercel domain(s).
4. **Project settings → General → Your apps → Web app** (`</>`): register an app and
   copy the config (`apiKey`, `authDomain`, `projectId`, `appId`).
5. (Recommended for dev) **Authentication → Sign-in method → Phone → Phone numbers
   for testing**: add a fake number + code so local testing doesn't send real SMS.

> Free tier covers far more verifications than a society needs. Phone Auth requires
> billing (Blaze) to be enabled on the project for production SMS in some regions —
> check the console; test numbers work without it.

## 2. Frontend env vars
Add to `web/.env` (and Vercel → Project → Environment Variables):
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=YOUR-PROJECT.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=YOUR-PROJECT-ID
VITE_FIREBASE_APP_ID=...
```
All four must be present for the feature to switch on (`firebaseEnabled`). With them
missing, the app falls back to the old behaviour (no signup OTP; reset is
rep/admin-assisted).

## 3. Deploy the `phone-reset` edge function
Lives at [supabase/functions/phone-reset/](../supabase/functions/phone-reset/).
Deploy (CLI, or paste in dashboard → Edge Functions):
```bash
supabase functions deploy phone-reset --no-verify-jwt
```
`--no-verify-jwt` is required: a forgotten-password user has no Supabase session, so
the Firebase ID token is the authorization, not a Supabase JWT.

Set its secret (the other two are injected automatically):
```bash
supabase secrets set FIREBASE_PROJECT_ID=YOUR-PROJECT-ID
```

## 4. Test
1. Register a new account with a real handset (or a Firebase test number) — confirm
   the OTP arrives and the account is created.
2. Log out, go to **Forgot password**, reset with the same number, confirm you can
   log in with the new password.

## Notes / future
- `VITE_ENABLE_OTP` (the old MSG91 / Supabase-phone-OTP path) is superseded by this
  and should stay `false`. Firebase takes precedence in the UI when both are set.
- The old test accounts keyed only on synthetic email still work for password login;
  they can reset their password here as long as `profiles.mobile` holds their E.164
  number (it does — set at registration).
