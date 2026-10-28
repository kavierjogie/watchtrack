import { MotionConfig } from 'framer-motion'
import { Component, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Layout } from './components/Layout'
import { ConfirmProvider } from './components/Modal'
import { applyTheme, usePrefs } from './lib/prefs'
import { Dashboard } from './pages/Dashboard'
import { DiscoverPage } from './pages/Discover'
import { CompletedPage, ContinuePage, LibraryPage, OnHoldPage, PlanPage } from './pages/Lists'
import { NotificationsPage } from './pages/Notifications'
import { SettingsPage } from './pages/Settings'
import { UpcomingPage } from './pages/Upcoming'
import { SharedPage } from './pages/Shared'
import { TitleDetails } from './pages/TitleDetails'
import { LibraryProvider } from './state/library'

/** Last line of defence: a render error shows a way out instead of a blank page. Saved data is never touched. */
class CrashScreen extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-20 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted">WatchTrack hit an unexpected error. Your library is still saved on this device.</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a href="/settings" className="btn-secondary">
            Open Settings
          </a>
        </div>
      </main>
    )
  }
}

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
      <CrashScreen>
        <BrowserRouter>
          <LibraryProvider>
            <ConfirmProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="continue" element={<ContinuePage />} />
                  <Route path="library" element={<LibraryPage />} />
                  <Route path="discover" element={<DiscoverPage />} />
                  <Route path="plan" element={<PlanPage />} />
                  <Route path="on-hold" element={<OnHoldPage />} />
                  <Route path="completed" element={<CompletedPage />} />
                  <Route path="upcoming" element={<UpcomingPage />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="title/:id" element={<TitleDetails />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<Dashboard />} />
                </Route>
                {/* Outside Layout: a friend opening a link sees just the shared list, not an empty app. */}
                <Route path="shared" element={<SharedPage />} />
              </Routes>
              <Toaster
                position="top-center"
                theme={theme === 'system' ? 'system' : theme}
                toastOptions={{ classNames: { toast: '!rounded-2xl !border-line !bg-overlay !text-fg !shadow-pop', description: '!text-muted', actionButton: '!bg-accent !text-on-accent' } }}
              />
            </ConfirmProvider>
          </LibraryProvider>
        </BrowserRouter>
      </CrashScreen>
    </MotionConfig>
  )
}
