import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { applyTheme, getPrefs } from './lib/prefs'

// Apply theme before first paint to avoid a flash.
applyTheme(getPrefs().theme)

// Ask the browser not to evict IndexedDB under storage pressure. Chrome/Safari decide silently; Firefox asks once.
void navigator.storage?.persist?.().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
