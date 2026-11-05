import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Relative asset URLs: Electron loads dist/index.html from the filesystem via
// a file:// URL, so absolute "/assets/..." paths would not resolve.
export default defineConfig(({ mode }) => {
  // Load .env explicitly so Supabase credentials are always available to the
  // renderer bundle at build time (both local dev and CI).
  loadEnv(mode, process.cwd(), '')

  return {
    base: './',
    envDir: '.',
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    clearScreen: false,
    server: {
      // Read by scripts/electron-dev.mjs, which spawns Electron with this URL.
      // strictPort: false lets Vite pick the next free port if 5173 is taken.
      port: 5173,
      strictPort: false,
    },
  }
})
