import { MotionConfig } from 'framer-motion'
import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Layout } from './components/Layout'
import { ConfirmProvider } from './components/Modal'
import { applyTheme, usePrefs } from './lib/prefs'
import { Dashboard } from './pages/Dashboard'
import { ImportNotesPage } from './pages/ImportNotes'
import { CompletedPage, ContinuePage, LibraryPage, OnHoldPage, PlanPage } from './pages/Lists'
import { SettingsPage } from './pages/Settings'
import { TitleDetails } from './pages/TitleDetails'
import { LibraryProvider } from './state/library'

export default function App() {
  const { theme } = usePrefs()

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  return (
    // "user": with Reduce Motion on, Motion drops slides/scales and keeps gentle opacity fades.
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <LibraryProvider>
          <ConfirmProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="continue" element={<ContinuePage />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="plan" element={<PlanPage />} />
                <Route path="on-hold" element={<OnHoldPage />} />
                <Route path="completed" element={<CompletedPage />} />
                <Route path="title/:id" element={<TitleDetails />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="import" element={<ImportNotesPage />} />
                <Route path="*" element={<Dashboard />} />
              </Route>
            </Routes>
            <Toaster
              position="top-center"
              theme={theme === 'system' ? 'system' : theme}
              toastOptions={{ classNames: { toast: '!rounded-2xl !border-line !bg-surface !text-fg', description: '!text-muted', actionButton: '!bg-accent !text-white' } }}
            />
          </ConfirmProvider>
        </LibraryProvider>
      </BrowserRouter>
    </MotionConfig>
  )
}
