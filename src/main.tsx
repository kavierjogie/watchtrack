import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import App from './App'
import './index.css'
import { applyTheme, getPrefs } from './lib/prefs'

// Apply theme before first paint to avoid a flash.
applyTheme(getPrefs().theme)

// Ask the browser not to evict IndexedDB under storage pressure. Chrome/Safari decide silently; Firefox asks once.
void navigator.storage?.persist?.().catch(() => {})

// Vercel Web Analytics: cookie-free page views. Only the path is sent; title ids, query strings (search text) and
// the #fragment (share-link contents) are stripped so nothing about the library leaves the device.
inject({
  beforeSend: (event) => {
    const url = new URL(event.url)
    return { ...event, url: url.origin + url.pathname.replace(/^\/title\/[^/]+/, '/title/[id]') }
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
