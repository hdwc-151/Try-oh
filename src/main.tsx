import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './styles/index.css'

// After a deploy, a tab that was already open still points at the previous
// build's code-split files, which no longer exist. Reload once to pick up the
// new build instead of failing when the user opens another screen.
window.addEventListener('vite:preloadError', (event) => {
  const RELOAD_FLAG = 'fitsy.chunk-reload'
  try {
    // At most one automatic reload a minute, so a genuinely missing file cannot loop.
    const lastReload = Number(window.sessionStorage.getItem(RELOAD_FLAG) ?? 0)
    if (Date.now() - lastReload < 60_000) return
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
