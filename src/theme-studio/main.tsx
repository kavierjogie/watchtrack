import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './studio.css'
import { Studio } from './Studio'

// Isolated entry: no router, no library, no sync. Themes are applied as CSS variables on each preview frame only.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
)
