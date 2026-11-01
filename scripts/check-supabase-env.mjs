#!/usr/bin/env node
// Validates Supabase build configuration when it is provided.
//
// Supabase is OPTIONAL for Struct: the app runs fully local when these vars are
// empty (see src/lib/supabase.ts). Builds must therefore never fail just
// because the secrets are absent (forks, PRs, local dev). When the values ARE
// present we still validate their shape so a typo does not silently ship a
// broken auth configuration.

const url = process.env.VITE_SUPABASE_URL?.trim();
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();

const missing = [];
if (!url) missing.push("VITE_SUPABASE_URL");
if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");

if (missing.length > 0) {
  console.warn(
    `Supabase build configuration is missing: ${missing.join(", ")}. ` +
      "The build will continue in local-only mode (no auth/cloud sync). " +
      "Set both values in the build environment to enable Supabase. See SUPABASE_SETUP.md.",
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
