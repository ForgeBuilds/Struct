# Supabase setup for Struct

Struct uses Supabase for auth, profiles, cloud sync and the `api-keys` edge
function. The app runs fully local when the two vars below are empty — every
auth / sync call degrades to "signed out". **When they are wrong, every login
method fails at once** (email + GitHub + Google), which is the usual cause of
"login always fails".

## 1. Create the project

1. Go to https://supabase.com/dashboard → New project.
2. Dashboard → Project Settings → API: copy the **Project URL**
   (`https://<ref>.supabase.co`) and the **anon public** key.
3. Copy `.env.example` to `.env` at the repo root and fill in:

   ```sh
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   VITE_OAUTH_REDIRECT_URL=agenticcoder://auth/callback
   ```

> **Rebuild after editing `.env`.** Vite bakes `VITE_*` vars into the bundle
> at build time. Restarting an already packaged app or adding `.env` beside
> its executable cannot change those values. For a local package, run the
> desktop build command after setting `.env`. For GitHub Actions releases,
> add repository secrets named `VITE_SUPABASE_URL` and
> `VITE_SUPABASE_ANON_KEY`; the platform workflow injects them while building
> the renderer. If in doubt, confirm `dist/assets/*.js` contains your
> `<ref>.supabase.co` before packaging.

## 2. Apply the database schema

In Dashboard → SQL Editor (or `supabase db push`), run in order:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_harden_profiles.sql
supabase/migrations/0003_restore_table_grants.sql
supabase/migrations/0006_remove_paywalls.sql
```

(`0004_payments.sql` + `0005_byok_paywall.sql` are superseded by `0006` — do
not run them on a fresh project.) You need tables `profiles`, `chats`,
`user_settings`, `user_api_keys` plus the `handle_new_user` trigger.

## 3. Auth → URL Configuration

Dashboard → Authentication → URL Configuration:

- Site URL: `http://localhost:5173` (dev) — production value doesn't matter
  for the desktop app.
- Redirect URLs allow list — add **both**:
  - `agenticcoder://auth/callback` (desktop OAuth + password recovery)
  - `http://localhost:5173` (browser dev preview)

Missing the first entry is the #1 OAuth failure: Supabase rejects
`redirect_to` and the browser shows a raw error page instead of returning to
the app.

## 4. Enable providers

Dashboard → Authentication → Sign In / Providers:

- Email: on (confirmation email optional — the app handles both cases).
- GitHub / Google: switch on, paste the OAuth Client ID + Secret from the
  GitHub / Google Cloud console, and add the Supabase callback URL shown in
  the dashboard to your OAuth app.

The sign-in form probes `/auth/v1/settings` on startup: a provider switched
off here shows as disabled with a Recheck button instead of sending you to a
dead browser page.

## 5. Deploy the edge function (BYOK keys only)

```sh
supabase secrets set BYOK_ENCRYPTION_KEY=$(openssl rand -hex 32)
supabase functions deploy api-keys
```

`verify_jwt` stays ON (`supabase/config.toml`). The app calls it with the
user's JWT; without the deploy, key save/load fails but login still works.

## 6. When every login method fails

1. Open Settings → Account: the form now runs a startup probe and prints the
   real cause (bad key, unreachable project, disabled provider, rejected
   redirect URL) with a Recheck button.
2. Check `.env` matches Dashboard → Project Settings → API (rotated anon
   keys and paused/restored projects change these).
3. Rebuild (`npm run build`) and retest.
4. Run `supabase db push` / re-run the SQL files — a missing `profiles`
   table or trigger breaks post-login profile creation.
