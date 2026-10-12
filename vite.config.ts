import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  clearScreen: false,
  server: {
    // Must match `build.devUrl` in src-tauri/tauri.conf.json.
    // strictPort: false allows Vite to automatically pick the next available port if 5173 is taken.
    port: 5173,
    strictPort: false,
    watch: {
      // Tauri and Android builds can generate hundreds of thousands of files
      // under the repository root. They are not web sources and watching
      // them makes Vite spend CPU rescanning build output.
      ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**'],
    },
  },
})
