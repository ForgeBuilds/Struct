import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target', 'src-tauri/gen', 'electron/freellmapi/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Helper functions / constants exported next to components. Their values
    // never change between renders, so they don't break fast refresh — the
    // rule just can't tell statically. Names are pinned explicitly so new
    // component exports stay covered by the rule.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowExportNames: [
            'useErrorHandler',
            'minimizeWindow',
            'toggleMaximizeWindow',
            'closeWindow',
            'DEFAULT_EDITOR_PREFS',
          ],
        },
      ],
    },
  },
  {
    // Entry point: it renders the app into #root and exports nothing, so the
    // fast-refresh "only export components" rule can never apply here.
    // Must stay last: in flat config the final matching entry wins.
    files: ['src/main.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
