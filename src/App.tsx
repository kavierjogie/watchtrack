import { MotionConfig } from 'framer-motion'
import { Component, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { InAppBrowserBanner } from './components/InAppBrowserBanner'
import { Layout } from './components/Layout'
import { ConfirmProvider } from './components/Modal'
import { FEEDBACK_MAILTO } from './lib/format'
import { applyTheme, usePrefs } from './lib/prefs'
import { Dashboard } from './pages/Dashboard'
import { LibraryProvider } from './state/library'

/** A page's code, fetched when first opened. The service worker still precaches every chunk, so all of them work offline. */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const lists = () => import('./pages/Lists')
const LibraryPage = page(lists, 'LibraryPage')
const ContinuePage = page(lists, 'ContinuePage')
const PlanPage = page(lists, 'PlanPage')
const OnHoldPage = page(lists, 'OnHoldPage')
const CompletedPage = page(lists, 'CompletedPage')
const DiscoverPage = page(() => import('./pages/Discover'), 'DiscoverPage')
const NotificationsPage = page(() => import('./pages/Notifications'), 'NotificationsPage')
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage')
const UpcomingPage = page(() => import('./pages/Upcoming'), 'UpcomingPage')
const SharedPage = page(() => import('./pages/Shared'), 'SharedPage')
const TitleDetails = page(() => import('./pages/TitleDetails'), 'TitleDetails')
const TransferPage = page(() => import('./pages/Transfer'), 'TransferPage')

/** Last line of defence: a render error shows a way out instead of a blank page. Saved data is never touched. */
class CrashScreen extends Component<{ children: ReactNode }, { failed: boolean; message: string }> {
  state = { failed: false, message: '' }
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-20 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted">WatchTrack hit an unexpected error. Your library is still saved on this device.</p>
        {this.state.message && <p className="font-mono text-xs wrap-anywhere text-muted">{this.state.message}</p>}
        <div className="flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a href="/settings" className="btn-secondary">
            Open Settings
          </a>
        </div>
        <p className="text-sm text-muted">
          Keeps happening?{' '}
          <a href={FEEDBACK_MAILTO} className="underline hover:text-fg">
            Let me know
          </a>
        </p>
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
              <InAppBrowserBanner />
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
                  <Route path="transfer" element={<TransferPage />} />
                  <Route path="*" element={<Dashboard />} />
                </Route>
                {/* Outside Layout: a friend opening a link sees just the shared list, not an empty app. */}
                <Route
                  path="shared"
                  element={
                    <Suspense fallback={null}>
                      <SharedPage />
                    </Suspense>
                  }
                />
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
