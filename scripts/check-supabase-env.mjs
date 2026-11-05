#!/usr/bin/env node
import { readFileSync } from 'node:fs';
// Validates Supabase build configuration.
//
// Supabase is OPTIONAL for Struct: the app runs fully local when these vars are
// empty (see src/lib/supabase.ts). Local builds without .env continue to work.
// However, when running in CI (CI=true) we FAIL the build if the secrets are
// absent, so a broken auth configuration never gets shipped silently.
//
// When the values ARE present we still validate their shape so a typo does not
// silently ship a broken auth configuration.

function loadEnvFile() {
  try {
    const content = readFileSync('.env', 'utf8');
    const env = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

const envFile = loadEnvFile();

const url = process.env.VITE_SUPABASE_URL?.trim() || envFile.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || envFile.VITE_SUPABASE_ANON_KEY;

const isCi = process.env.CI === "true";

const missing = [];
if (!url) missing.push("VITE_SUPABASE_URL");
if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");

if (missing.length > 0) {
  if (isCi) {
    console.error(
      `Supabase build configuration is missing in CI: ${missing.join(", ")}. ` +
        "Set both secrets in GitHub Settings → Secrets and variables → Actions, " +
        "then re-run the workflow. See SUPABASE_SETUP.md.",
    );
    process.exit(1);
  }
  console.warn(
    `Supabase build configuration is missing locally: ${missing.join(", ")}. ` +
      "The app will run in local-only mode (no sign-in / cloud sync). " +
      "To enable Supabase: copy .env.example to .env, fill in your project " +
      "values from Dashboard → Project Settings → API, then rebuild. " +
      "See SUPABASE_SETUP.md.",
  );
  process.exit(0);
}

let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  console.error("VITE_SUPABASE_URL must be a valid HTTPS URL. See SUPABASE_SETUP.md.");
  process.exit(1);
}

if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
  console.error("VITE_SUPABASE_URL must be an HTTPS Supabase project URL. See SUPABASE_SETUP.md.");
  process.exit(1);
}

if (anonKey.length < 20) {
  console.error("VITE_SUPABASE_ANON_KEY looks too short. Check the anon/public key in Supabase settings.");
  process.exit(1);
}

console.log("Supabase build configuration is present.");
