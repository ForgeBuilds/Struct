# Struct v1.16.0 — Release Notes

**Release:** v1.16.0  
**Range:** `Release_v1.15.0..HEAD` (25 commits)  
**Status:** Pre-release — desktop artifacts built but not yet tagged  

> **Before tagging:** `package.json` still reads `1.15.0`. Bump it with  
> `npm version 1.16.0 --no-git-tag-version` so the shipped binaries match the release.

Struct v1.16.0 is a stability and integration release focused on fixing Supabase sign-in/login reliability, expanding the plugin ecosystem, and polishing the UI across agents, accounts, and rendering.

## Highlights

- **Supabase sign/login fixes.** Multiple commits address the "This build does not include Supabase configuration" error and make Supabase config optional at build time so the app can run without crashing when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing.
- **Plugin expansion.** Added Google Calendar and GitHub tools, plus per-account plugin storage so plugins are scoped correctly to each user account.
- **Language / i18n work.** Language data moved into `.json` files, a build-time translator replaced hardcoded strings, and limited language integration was added.
- **UI polish.** Agent activity indicators no longer disappear, hardware acceleration startup crashes fixed, rendering fixes, sidebar restored, and app icon finalized.

## Fixed

- **Supabase sign/login (root cause fixed).** The build now reliably detects whether `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are present — from `.env` locally, from repo secrets in CI. `scripts/check-supabase-env.mjs` now reads `.env` for local validation and **fails CI builds** when secrets are missing, so a broken auth config never ships silently.
- **`vite.config.ts`** now explicitly loads `.env` (`envDir: '.'`, `loadEnv()`) so Vite always bakes Supabase credentials into the renderer bundle.
- **`scripts/desktop-build.mjs`** pre-build check warns if `.env` is missing or empty before packaging — no more shipping builds where sign/login is broken without telling you.
- **Account section UI** shows a prominent, actionable error when Supabase isn't configured, with separate instructions for local builds (copy `.env.example` → `.env`) and CI builds (add repo secrets).
- **Agent activity indicators** no longer disappear after a while or when switching chats (`2e32321`, `50c19f2`).
- **Hardware acceleration** no longer chokes the startup process (`50c19f2`).
- **Rendering fixes** — render issue, detailed error catcher, and various UI rendering fixes (`b9c0356`, `26bc35a`, `ae8aa43`).
- **Runtime bugs** resolved that blocked Electron dev runs (`2180aa4`).
- **GitHub Actions** — commented out undeclared/failing workflow items and fixed a `.json` file that was causing CI to fail (`7aaef41`, `14f1680`).

## Added

- **Google Calendar tool addon** (`81df23c`).
- **More plugins:** Google Calendar and GitHub tools added to the plugin roster (`8ed5821`).
- **Per-account plugin storage** — plugins are now stored according to each account instead of globally (`21868bb`).
- **Language data** transferred into `.json` files (`8b5e2c9`).
- **Build-time translator** replaced the hardcoded translation trick (`a83fe82`).
- **Limited language integration** (more to come) (`16e7a4a`).
- **GitHub tool SVG** (`e741677`).
- **Account panel additions** (`1098c84`).

## Improved / UI

- **AgentActivity remodeled** — UI hierarchy adjusted, sidebar brought back (`07a8de9`).
- **UI fixes** across agent activity, account panel, and general rendering (`998cef6`, `e9e8f23`, `5768e1b`).
- **App icon** finalized with edits (`12d6e75`).

## Notes for maintainers

### If Supabase sign/login still doesn't work

This is almost always one of three things:

1. **Local build without `.env`.** `.env` is git-ignored. You must create it:  
   `cp .env.example .env` then fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase Dashboard → Project Settings → API, then `npm run build:desktop`.

2. **CI build with missing/incorrect repo secrets.** GitHub Actions secrets must be named exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (case-sensitive). Go to Settings → Secrets and variables → Actions in your repo. With my fix, CI will now **fail fast** if they're absent instead of shipping a broken build.

3. **Stale `dist/` from a previous build without env vars.** Vite bakes `import.meta.env.VITE_*` into the bundle at build time. Always run `npm run build` (or `npm run build:desktop`) after changing `.env` or secrets, then repackage.

### Verify the build has Supabase config

After building, check that the Supabase URL is embedded:
```
grep -r "supabase.co" dist/assets/
```

If you get no results, the env vars weren't baked in — rebuild.

### Latest commit `92c181f`

Titled "Added the supabase bug for sign/login and added changes to the thinking indicator" — review carefully before tagging; it may be reintroducing or tracking the Supabase sign/login issue rather than resolving it.

## Known issues

- Supabase sign/login requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to be baked into the renderer at build time. If the app was built without them (missing `.env` locally, or missing repo secrets in CI), sign-in will not work. Rebuild after adding them.

## Changed files (25 commits)

- `scripts/desktop-build.mjs`, `scripts/electron-dev.mjs` — build/CI tweaks
- `src/App.tsx`, `src/agentic.ts`, `src/uiSettings.ts` — core app and agent logic
- `src/components/SettingsPanel.tsx`, `src/components/AccountSection.tsx` — accounts/settings UI
- `src/components/AgenticActivity.tsx` — agent activity indicators
- `components/ChatHistorySidebar.tsx`, `components/CommandPalette.tsx`, `components/ErrorTab.tsx`, `components/InfoPanel.tsx`, `components/LocalModels.tsx`, `components/PrivacyPolicy.tsx`, `components/Tab2.tsx`, `components/UpdateNotification.tsx`
- `supabase/` — config and function tweaks
- `package.json`, `package-lock.json` — dependency and version bumps
- `electron/main.cjs`, `electron/preload.cjs` — Electron shell
- `build/` — app icon assets

## Diff summary

See `git diff --stat Release_v1.15.0..HEAD` for full file-level changes. Net change is focused on Supabase configuration handling, plugin system, language files, and UI components.
