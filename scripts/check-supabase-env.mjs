#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
// Validates Supabase build configuration.
//
// Supabase is OPTIONAL for Struct: the app runs fully local when these vars are
// empty (see src/lib/supabase.ts). Local builds without .env continue to work.
// Trusted CI builds fail when the values are absent, while fork pull requests
// can still build in local-only mode because GitHub withholds repository secrets.
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
const isForkPullRequest = process.env.GITHUB_EVENT_NAME === "pull_request";
const verifyBundle = process.argv.includes("--verify-bundle");

const missing = [];
if (!url) missing.push("VITE_SUPABASE_URL");
if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");

if (missing.length > 0) {
  if (isCi && !isForkPullRequest) {
    console.error(
      `Supabase build configuration is missing in CI: ${missing.join(", ")}. ` +
        "Set both values as GitHub Actions secrets or variables in " +
        "Settings → Secrets and variables → Actions, " +
        "then re-run the workflow. See SUPABASE_SETUP.md.",
    );
    process.exit(1);
  }
  console.warn(
    `Supabase build configuration is missing: ${missing.join(", ")}. ` +
      (isForkPullRequest
        ? "This fork pull request will build in local-only mode (no sign-in / cloud sync). "
        : "The app will run in local-only mode (no sign-in / cloud sync). ") +
      "Set both GitHub Actions secrets or variables, or configure them in .env. " +
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

if (verifyBundle) {
  const assetDir = "dist/assets";
  if (!existsSync(assetDir)) {
    console.error("Renderer assets are missing. Run npm run build before verifying Supabase config.");
    process.exit(1);
  }
  const bundles = readdirSync(assetDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(`${assetDir}/${name}`, "utf8"));
  if (!bundles.some((bundle) => bundle.includes(url))) {
    console.error("VITE_SUPABASE_URL was not found in the built renderer. Check the build environment.");
    process.exit(1);
  }
  if (!bundles.some((bundle) => bundle.includes(anonKey))) {
    console.error("VITE_SUPABASE_ANON_KEY was not found in the built renderer. Check the build environment.");
    process.exit(1);
  }
}

console.log("Supabase build configuration is present.");
