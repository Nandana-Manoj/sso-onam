# Google sign-in setup

Google sign-in is wired into the app (a "Continue with Google" button on Login
and Register). It needs OAuth credentials that only you can create, in two
consoles. No database migration is required.

After a first Google sign-in, the user has a session but no profile, so the app
routes them to a one-time **onboarding** form (mobile + tower + flat) that calls
`complete_registration`. Existing mobile + password accounts keep working.

## 1. Google Cloud Console (create OAuth credentials)
1. https://console.cloud.google.com → create or pick a project.
2. **APIs & Services → OAuth consent screen** → User type **External** → fill
   app name, your support email, developer email → Save. (While in "Testing",
   add your Google account under **Test users**, or **Publish** the app.)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → Application type **Web application**.
4. **Authorized redirect URIs** → add exactly:
   ```
   https://eqzscqjkhsauaqeyqlwa.supabase.co/auth/v1/callback
   ```
5. (Optional) **Authorized JavaScript origins** → add `http://localhost:5174`
   and your deployed origin (e.g. `https://sso-onam.vercel.app`).
6. Create → copy the **Client ID** and **Client secret**.

## 2. Supabase dashboard
1. **Authentication → Providers → Google** → enable → paste the Client ID +
   Client secret → Save.
2. **Authentication → URL Configuration**:
   - **Site URL**: your deployed URL (e.g. `https://sso-onam.vercel.app`).
   - **Redirect URLs** (allow-list): add both
     `http://localhost:5174` and your deployed origin
     (the app redirects back to `window.location.origin`).

## 3. Test
- Login → **Continue with Google** → pick a Google account → returns to the app.
- First time: you land on **Almost there** (onboarding) → enter mobile + tower +
  flat → **Finish setup** → you're routed to your role's home.
- Returning Google users skip onboarding (profile already exists).

## Notes
- A Google user who enters a mobile already used by a mobile+password account
  gets a friendly "already registered — log in with mobile & password" message.
- The app's supabase client uses `detectSessionInUrl: true` + PKCE to complete
  the OAuth redirect.
