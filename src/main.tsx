/*
 * Author: madhusudhan
 * Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
 */
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes/seasonal/shared/effects.css'
import './themes/seasonal/christmas/theme.css'
import './themes/seasonal/halloween/theme.css'
import './themes/seasonal/fall/theme.css'
import './themes/seasonal/thanksgiving/theme.css'
import { ErrorProvider } from './errorContext'

// Single-window chat app. Electron draws the native frame; the renderer is
// only ever the chat interface.
const App = lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorProvider>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </ErrorProvider>
  </StrictMode>,
)