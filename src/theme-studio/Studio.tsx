import { Columns2, Monitor, Moon, Smartphone, Sun, SunMoon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Preview } from './Preview'
import { checks, THEMES, tokens, type Mode, type Theme } from './themes'

type ModeChoice = Mode | 'both'
type Device = 'desktop' | 'phone'

/** Neutral greys for the studio's own controls, so the chrome never tints the palette being judged. */
const NEUTRAL: Theme = {
  id: 'neutral',
  name: 'Studio',
  mood: '',
  personality: '',
  dark: { bg: '#141414', surface: '#1E1E1E', primary: '#E6E6E6', accent: '#BDBDBD', text: '#F2F2F2' },
  light: { bg: '#ECECEC', surface: '#F7F7F7', primary: '#262626', accent: '#555555', text: '#1A1A1A' },
  status: { success: '#5FBF8A', info: '#6FA8DC', warn: '#E0A458', danger: '#E5666B' },
}

const WIDTH: Record<Device, number> = { desktop: 1280, phone: 390 }

/** A frame at a real device width, scaled down (CSS zoom) to the space it has, like a screenshot. */
function Frame({ device, label, children }: { device: Device; label: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const width = WIDTH[device]
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, e.contentRect.width / width)))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [width])
  return (
    <figure ref={ref} className="min-w-0">
      <figcaption className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">{label}</figcaption>
      <div className="mx-auto overflow-hidden rounded-2xl shadow-pop ring-1 ring-line" style={{ width, zoom }}>
        {children}
      </div>
    </figure>
  )
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string, typeof Sun][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-line bg-bg-2 p-0.5">
      {options.map(([v, text, Icon]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`press flex min-h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium ${value === v ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg'}`}
        >
          <Icon className="size-4" aria-hidden />
          <span className="max-sm:sr-only">{text}</span>
        </button>
      ))}
    </div>
  )
}

const SEEDS = ['bg', 'surface', 'primary', 'accent', 'text'] as const

function Swatches({ theme, mode, className = 'h-6' }: { theme: Theme; mode: Mode; className?: string }) {
  return (
    <span className={`flex overflow-hidden rounded-md ring-1 ring-inset ring-black/10 ${className}`} aria-hidden>
      {SEEDS.map((k) => (
        <span key={k} className="flex-1" style={{ background: theme[mode][k] }} />
      ))}
    </span>
  )
}

function Palette({ theme, mode }: { theme: Theme; mode: Mode }) {
  const t = useMemo(() => tokens(theme, mode), [theme, mode])
  const status: [string, string][] = [
    ['Watching', t['--accent']],
    ['Completed', t['--success']],
    ['Plan', t['--info']],
    ['On hold', t['--warn']],
    ['Dropped', t['--danger']],
  ]
  return (
    <div className="min-w-0 rounded-2xl border border-line p-4" style={{ ...(t as CSSProperties), background: 'var(--bg)', color: 'var(--text)' }}>
      <p className="eyebrow flex items-center gap-1.5">
        {mode === 'dark' ? <Moon className="size-3.5" aria-hidden /> : <Sun className="size-3.5" aria-hidden />} {mode} mode
      </p>
      <ul className="mt-3 grid grid-cols-5 gap-2">
        {SEEDS.map((k) => (
          <li key={k} className="min-w-0">
            <span className="block h-10 rounded-lg ring-1 ring-inset ring-line" style={{ background: theme[mode][k] }} />
            <span className="mt-1 block truncate text-[11px] capitalize text-muted">{k}</span>
            <code className="block truncate text-[11px] font-medium">{theme[mode][k]}</code>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] font-medium text-muted">Status colours (tuned for this mode)</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {status.map(([label, c]) => (
          <li key={label} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: c, background: `color-mix(in oklab, ${c} 15%, transparent)` }}>
            {label} <code className="opacity-80">{c}</code>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-[11px]">
        <summary className="cursor-pointer text-muted hover:text-fg">Contrast checks (WCAG AA ≥ 4.5)</summary>
        <ul className="mt-2 space-y-1">
          {checks(t).map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span className="rounded px-1.5 py-0.5 font-semibold" style={{ color: c.fg, background: c.bg }}>
                Aa
              </span>
              <span className="flex-1 text-fg-2">{c.label}</span>
              <span className={`tabular-nums ${c.ratio >= 4.5 ? 'text-success' : 'text-danger'}`}>{c.ratio.toFixed(1)}:1</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

export function Studio() {
  const [id, setId] = useState(THEMES[0].id)
  const [compareId, setCompareId] = useState('')
  const [mode, setMode] = useState<ModeChoice>('dark')
  const [device, setDevice] = useState<Device>(() => (window.innerWidth < 900 ? 'phone' : 'desktop'))

  const theme = THEMES.find((t) => t.id === id)!
  const compare = THEMES.find((t) => t.id === compareId && t.id !== id) ?? null
  const modes: Mode[] = mode === 'both' ? ['dark', 'light'] : [mode]
  const frames = [theme, ...(compare ? [compare] : [])].flatMap((th) => modes.map((m) => ({ th, m })))
  const chrome = tokens(NEUTRAL, mode === 'light' ? 'light' : 'dark') as CSSProperties

  // ← / → (or 1–9, 0) step through themes without reaching for the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return
      const i = THEMES.findIndex((t) => t.id === id)
      const n = '1234567890'.indexOf(e.key)
      const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : n
      if (next === -1 && e.key !== 'ArrowLeft') return
      setId(THEMES[(next + THEMES.length) % THEMES.length].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])

  return (
    <div className="min-h-dvh bg-bg text-fg" style={{ ...chrome, colorScheme: mode === 'light' ? 'light' : 'dark' }}>
      <header className="sticky top-0 z-20 border-b border-divider bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto min-w-0">
            <h1 className="text-base font-semibold tracking-tight">WatchTrack Theme Studio</h1>
            <p className="text-xs text-muted">Preview only. The app's own theme is unchanged.</p>
          </div>
          <Segmented
            label="Colour mode"
            value={mode}
            onChange={setMode}
            options={[
              ['dark', 'Dark', Moon],
              ['light', 'Light', Sun],
              ['both', 'Both', SunMoon],
            ]}
          />
          <Segmented
            label="Device"
            value={device}
            onChange={setDevice}
            options={[
              ['desktop', 'Desktop', Monitor],
              ['phone', 'Phone', Smartphone],
            ]}
          />
          <label className="flex items-center gap-2">
            <Columns2 className="size-4 text-muted" aria-hidden />
            <span className="sr-only">Compare with</span>
            <select className="input w-auto" value={compare?.id ?? ''} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">No comparison</option>
              {THEMES.filter((t) => t.id !== id).map((t) => (
                <option key={t.id} value={t.id}>
                  Compare: {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] space-y-6 px-4 py-6 sm:px-6">
        <div role="radiogroup" aria-label="Theme" className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 md:grid-cols-3 lg:grid-cols-5">
          {THEMES.map((t, i) => {
            const on = t.id === id
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setId(t.id)}
                className={`press w-56 shrink-0 snap-start rounded-2xl border p-3 text-left sm:w-auto ${on ? 'border-fg/60 bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'}`}
              >
                <span className="flex gap-1">
                  <Swatches theme={t} mode="dark" className="h-6 flex-1" />
                  <Swatches theme={t} mode="light" className="h-6 flex-1" />
                </span>
                <span className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <kbd className="font-sans tabular-nums">{(i + 1) % 10}</kbd> · {t.mood}
                  {t.suggested && <span className="ml-auto rounded-full bg-fg/10 px-1.5 text-[10px] font-semibold text-fg-2">Suggested</span>}
                </span>
                <span className="mt-0.5 block text-sm font-semibold leading-snug">{t.name}</span>
              </button>
            )
          })}
        </div>

        <section className={`grid gap-4 ${compare ? 'lg:grid-cols-2' : ''}`}>
          {[theme, ...(compare ? [compare] : [])].map((th) => (
            <div key={th.id} className="card min-w-0 p-4 sm:p-5">
              <p className="eyebrow">{th.mood}</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">{th.name}</h2>
              <p className="mt-1 max-w-3xl text-sm text-fg-2">{th.personality}</p>
              <div className={`mt-4 grid gap-3 ${compare ? '' : 'md:grid-cols-2'}`}>
                <Palette theme={th} mode="dark" />
                <Palette theme={th} mode="light" />
              </div>
            </div>
          ))}
        </section>

        <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${frames.length > 1 ? 2 : 1}, minmax(0, 1fr))` }}>
          {frames.map(({ th, m }) => (
            <Frame
              key={`${th.id}-${m}`}
              device={device}
              label={
                <>
                  <Swatches theme={th} mode={m} className="h-3 w-12" />
                  {th.name} · {m === 'dark' ? 'Dark' : 'Light'}
                </>
              }
            >
              <Preview style={{ ...(tokens(th, m) as CSSProperties), colorScheme: m }} />
            </Frame>
          ))}
        </div>
      </div>
    </div>
  )
}
