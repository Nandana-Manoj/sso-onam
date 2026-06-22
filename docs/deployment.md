# Deploying the web app (free, public URL)

The app is a static Vite build (the `web/` folder) talking to your already-live
Supabase backend. Hosting the static files on a free CDN gives a permanent,
shareable URL at ~₹0/month.

## What you need
- A **GitHub** account (to hold the code)
- A free host account — **Vercel** (recommended for Vite), or Netlify / Cloudflare Pages
- Your Supabase values (same as `web/.env`):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY` (the publishable/anon key — safe in the browser)

> Never commit `web/.env` or the service-role/secret key. `.gitignore` already
> excludes `.env`. Only the publishable anon key ships to the browser.

## 1. Push the code to GitHub
From the project root (already a git repo):
```bash
gh repo create sso-onam --private --source=. --remote=origin --push
```
…or create an empty repo on github.com and:
```bash
git remote add origin https://github.com/<you>/sso-onam.git
git push -u origin main
```

## 2. Connect to Vercel
1. vercel.com → **Add New… → Project** → import the GitHub repo.
2. **Root Directory:** `web`  ← important (the app lives in the subfolder)
3. Framework preset: **Vite** (auto-detected). Build: `npm run build`, Output: `dist`.
4. **Environment Variables** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. **Deploy.** You get a URL like `https://sso-onam.vercel.app`.

Every `git push` to `main` re-deploys automatically.

### SPA routing
`web/vercel.json` (and `web/public/_redirects` for Netlify/Cloudflare) rewrite
all paths to `index.html`, so deep links like `/admin` and `/rep` work on reload.

## Notes
- **No Supabase change needed**: auth is mobile + password (synthetic email), so
  there are no OAuth redirect URLs to configure. Storage buckets are public-read.
- **Free-tier pause**: Supabase pauses a free project after ~7 days idle. During
  the active Onam weeks, log in daily or upgrade briefly to avoid pauses.
- Other hosts: Netlify (base dir `web`, publish `web/dist`) and Cloudflare Pages
  (root `web`, output `dist`) work identically using the `_redirects` file.
