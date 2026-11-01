const url = process.env.VITE_SUPABASE_URL?.trim();
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();

const missing = [];
if (!url) missing.push("VITE_SUPABASE_URL");
if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");

if (missing.length > 0) {
  console.error(
    `Supabase build configuration is missing: ${missing.join(", ")}. ` +
      "Set both values in the build environment (GitHub repository or environment secrets for Actions) and rebuild. See SUPABASE_SETUP.md.",
  );
  process.exit(1);
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
