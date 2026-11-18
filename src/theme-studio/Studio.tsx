import { Check, Columns2, ExternalLink, Monitor, Moon, Smartphone, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { StatusBadge } from '../components/cards'
import type { WatchStatus } from '../lib/types'
import { Preview } from './Preview'
import { BOARD, DARK_LESSONS, DARKNESS, LANGUAGE, NOTES, PRODUCTS, shot, SYNTHESIS, TERRITORIES } from './research'
import { checks, contrast, lookStyle, THEMES, tokens, type Theme } from './themes'

type Device = 'desktop' | 'phone'
type Tab = 'concepts' | 'research' | 'board'

/** Neutral greys for the studio's own controls, so the chrome never tints the concept being judged. */
const NEUTRAL: Theme = {
  ...THEMES[0],
  id: 'neutral',
  colors: { bg: '#141414', surface: '#1E1E1E', primary: '#E6E6E6', accent: '#BDBDBD', text: '#F2F2F2' },
  status: { success: '#5FBF8A', info: '#6FA8DC', warn: '#E0A458', danger: '#E5666B' },
}

const WIDTH: Record<Device, number> = { desktop: 1280, phone: 390 }

/** Everything a themed block needs: the concept's colour tokens, its look variables and its data switches. */
function themed(theme: Theme) {
  const { style, data } = lookStyle(theme)
  return { style: { ...(tokens(theme) as CSSProperties), ...style, colorScheme: 'dark' } as CSSProperties, data }
}

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

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string, typeof Moon?][]; label: string }) {
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
          {Icon && <Icon className="size-4" aria-hidden />}
          <span className={Icon ? 'max-sm:sr-only' : ''}>{text}</span>
        </button>
      ))}
    </div>
  )
}

const SEEDS = ['bg', 'surface', 'primary', 'accent', 'text'] as const

function Swatches({ theme, className = 'h-6' }: { theme: Theme; className?: string }) {
  return (
    <span className={`flex overflow-hidden rounded-md ring-1 ring-inset ring-black/10 ${className}`} aria-hidden>
      {SEEDS.map((k) => (
        <span key={k} className="flex-1" style={{ background: theme.colors[k] }} />
      ))}
    </span>
  )
}

function Palette({ theme }: { theme: Theme }) {
  const t = useMemo(() => tokens(theme), [theme])
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
        <Moon className="size-3.5" aria-hidden /> Palette · single dark theme
      </p>
      <ul className="mt-3 grid grid-cols-5 gap-2">
        {SEEDS.map((k) => (
          <li key={k} className="min-w-0">
            <span className="block h-10 rounded-lg ring-1 ring-inset ring-line" style={{ background: theme.colors[k] }} />
            <span className="mt-1 block truncate text-[11px] capitalize text-muted">{k}</span>
            <code className="block truncate text-[11px] font-medium">{theme.colors[k]}</code>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] font-medium text-muted">Status colours (tuned to meet AA on the surface)</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {status.map(([label, c]) => (
          <li key={label} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: c, background: `color-mix(in oklab, ${c} 15%, transparent)` }}>
            {label} <code className="opacity-80">{c}</code>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] font-medium text-muted">Contrast (WCAG AA needs 4.5:1 for text)</p>
      <ul className="mt-1.5 space-y-1 text-[11px]">
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
    </div>
  )
}

/** Type scale in the concept's own faces. */
function Specimen({ theme }: { theme: Theme }) {
  const { style, data } = themed(theme)
  const l = theme.look
  const name = (f: string) => f.split(',')[0].replace(/'/g, '')
  return (
    <div className="concept min-w-0 rounded-2xl border border-line bg-bg p-5 text-fg" style={style} {...data}>
      <p className="eyebrow">Typography</p>
      <h2 className="mt-3 text-4xl leading-none">Frieren</h2>
      <p className="display mt-2 text-5xl leading-none text-accent-text tabular-nums">E19 next</p>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-fg-2">Last: E18 · watched 2 hours ago. Frieren sets out to fulfil the last wishes of her comrades and finds herself beginning a new adventure.</p>
      <p className="mono mt-2 text-xs text-muted tabular-nums">AIRS THU 17:30 · 18 / 28 · 1,284 EPISODES</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-divider pt-3 text-[11px]">
        <dt className="text-muted">Display</dt>
        <dd>
          {name(l.display)} {l.displayWeight}
          {l.displayCase ? ' · caps' : ''}
        </dd>
        <dt className="text-muted">Text</dt>
        <dd>{name(l.body)}</dd>
        <dt className="text-muted">Labels</dt>
        <dd>{name(l.mono ?? l.body)}</dd>
        <dt className="text-muted">Corners</dt>
        <dd>{l.radius.slice(1).join(' / ')} px</dd>
        <dt className="text-muted">Cards</dt>
        <dd className="capitalize">{l.card}</dd>
      </dl>
    </div>
  )
}

const STATUSES: WatchStatus[] = ['watching', 'completed', 'plan', 'on_hold', 'dropped']

/** Components with hover / focus / active / disabled shown side by side, plus the live "watched" tick. */
function States({ theme }: { theme: Theme }) {
  const { style, data } = themed(theme)
  const [ep, setEp] = useState(19)
  const state = (label: string, el: ReactNode) => (
    <div className="flex flex-col items-start gap-1.5">
      {el}
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  )
  return (
    <div className="concept min-w-0 space-y-5 rounded-2xl border border-line bg-bg p-5 text-fg" style={style} {...data}>
      <p className="eyebrow">Components and states</p>
      <div className="flex flex-wrap gap-3">
        {state('Default', <button className="btn-primary">Save</button>)}
        {state('Hover', <button className="btn-primary bg-accent-hover">Save</button>)}
        {state('Focus', <button className="btn-primary outline-2 outline-offset-2 outline-accent">Save</button>)}
        {state('Pressed', <button className="btn-primary scale-[0.97]">Save</button>)}
        {state('Disabled', <button className="btn-primary" disabled>Save</button>)}
      </div>
      <div className="flex flex-wrap gap-3">
        {state('Secondary', <button className="btn-secondary">Cancel</button>)}
        {state('Hover', <button className="btn-secondary border-line-strong/60 bg-surface-2">Cancel</button>)}
        {state('Ghost', <button className="btn-ghost">Continue</button>)}
        {state('Danger', <button className="btn-danger">Remove</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="chip" aria-pressed="true">
          All · 13
        </button>
        <button className="chip">Anime</button>
        <button className="chip border-line-strong/60 bg-surface-2 text-fg">TV (hover)</button>
        {STATUSES.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {state('Input', <input className="input" placeholder="Search anime, TV and movies" />)}
        {state('Input focused', <input className="input border-accent ring-3 ring-accent/20" defaultValue="Frieren" />)}
      </div>
      <div className="card flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Frieren: Beyond Journey&apos;s End</p>
          <p className="display overflow-hidden text-3xl leading-tight text-accent-text tabular-nums">
            <span key={ep} className="tick">
              E{ep}
            </span>{' '}
            next
          </p>
          <p className="text-xs text-muted">Try it: the signature tick ({theme.look.duration}ms)</p>
        </div>
        <button className="btn-primary" onClick={() => setEp((n) => (n >= 28 ? 19 : n + 1))}>
          <Check className="size-4" aria-hidden /> Watched E{ep}
        </button>
      </div>
    </div>
  )
}

function Brief({ theme, onRef }: { theme: Theme; onRef: () => void }) {
  const b = theme.brief
  const rows: [string, string][] = [
    ['Surfaces', b.surfaces],
    ['Cards', b.cards],
    ['Navigation', b.nav],
    ['Icons', b.icons],
    ['Motion', b.motion],
    ['Distinctive', b.distinctive],
    ['Watch out', b.risks],
  ]
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed text-fg-2">{b.philosophy}</p>
      {b.inspiration.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Inspired by</p>
          <ul className="flex flex-wrap gap-2">
            {b.inspiration.map(([id, what]) => (
              <li key={id}>
                <button type="button" onClick={onRef} className="press flex items-center gap-2 rounded-xl border border-line bg-bg-2 p-1.5 pr-3 text-left text-xs hover:bg-surface-2">
                  {shot(id) && <img src={shot(id)} alt="" className="h-9 w-14 rounded-md object-cover object-top" />}
                  <span>
                    <span className="block font-semibold">{PRODUCTS.find((p) => p.id === id || p.img === id)?.name ?? BOARD.flatMap((s) => s.refs).find((r) => r.img === id)?.source}</span>
                    <span className="text-muted">{what}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className={`text-xs font-semibold ${k === 'Watch out' ? 'text-warn' : 'text-muted'}`}>{k}</dt>
            <dd className="mt-0.5 text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ConceptsView({ device, id, setId, compareId, setTab }: { device: Device; id: string; setId: (id: string) => void; compareId: string; setTab: (t: Tab) => void }) {
  const theme = THEMES.find((t) => t.id === id)!
  const compare = THEMES.find((t) => t.id === compareId && t.id !== id) ?? null
  const shown = [theme, ...(compare ? [compare] : [])]
  return (
    <>
      <div role="radiogroup" aria-label="Concept" className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 2xl:grid-cols-6">
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
              <span className="flex items-end gap-2">
                <span className="rounded-lg px-1.5 py-1 text-3xl leading-none" style={{ fontFamily: t.look.display, fontWeight: t.look.displayWeight, color: t.colors.primary, background: t.colors.bg }} aria-hidden>
                  Aa
                </span>
                <Swatches theme={t} className="h-5 flex-1" />
              </span>
              <span className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                {!t.current && <kbd className="font-sans tabular-nums">{(i + 1) % 10}</kbd>}
                <span className="truncate">{t.mood}</span>
                {t.recommended && <span className="ml-auto shrink-0 rounded-full bg-fg px-1.5 text-[10px] font-semibold text-bg">Recommended</span>}
                {t.current && <span className="ml-auto shrink-0 rounded-full bg-fg/10 px-1.5 text-[10px] font-semibold text-fg-2">Current</span>}
              </span>
              <span className="mt-0.5 block text-sm font-semibold leading-snug">{t.name}</span>
            </button>
          )
        })}
      </div>

      {shown.map((th) => (
        <section key={th.id} className="card min-w-0 space-y-5 p-4 sm:p-6">
          <div>
            <p className="eyebrow flex items-center gap-2">
              {th.mood}
              {th.recommended && (
                <span className="inline-flex items-center gap-1 normal-case tracking-normal text-fg">
                  <Sparkles className="size-3.5" aria-hidden /> Claude&apos;s recommendation
                </span>
              )}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{th.name}</h2>
            <p className="mt-1 max-w-3xl text-sm text-fg-2">{th.personality}</p>
          </div>
          <Brief theme={th} onRef={() => setTab('board')} />
          <div className={`grid gap-3 ${compare ? '' : 'xl:grid-cols-3'}`}>
            <Specimen theme={th} />
            <States theme={th} />
            <Palette theme={th} />
          </div>
        </section>
      ))}

      <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${shown.length > 1 ? 2 : 1}, minmax(0, 1fr))` }}>
        {shown.map((th) => {
          const { style, data } = themed(th)
          return (
            <Frame
              key={th.id}
              device={device}
              label={
                <>
                  <Swatches theme={th} className="h-3 w-12" />
                  {th.name}
                </>
              }
            >
              <Preview style={style} data={data} />
            </Frame>
          )
        })}
      </div>
    </>
  )
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">
      {children} <ExternalLink className="size-3 text-muted" aria-hidden />
    </a>
  )
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-fg-2">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  )
}

function ResearchView() {
  return (
    <div className="space-y-8">
      <div className="max-w-3xl space-y-2 text-sm text-fg-2">
        <h2 className="text-xl font-semibold tracking-tight text-fg">Ten products in the category</h2>
        <p>Screenshots captured 2026-11-18 from the linked public pages. Observed details describe the screenshot; the last two columns are recommendations for WatchTrack. Hex values are sampled from the screenshots, so approximate.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-bg-2 text-xs text-muted">
            <tr>
              {['Product', 'Design style', 'Observed', 'What works well', 'What we can learn', 'Do not copy'].map((h) => (
                <th key={h} className="px-3 py-2.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider align-top">
            {PRODUCTS.map((p) => (
              <tr key={p.id}>
                <td className="w-44 px-3 py-3">
                  {p.img && (
                    <a href={shot(p.img)} target="_blank" rel="noreferrer">
                      <img src={shot(p.img)} alt={`${p.name} screenshot`} className="mb-2 aspect-[16/10] w-40 rounded-lg object-cover object-top ring-1 ring-line" />
                    </a>
                  )}
                  <Ext href={p.url}>{p.name}</Ext>
                </td>
                <td className="w-36 px-3 py-3 font-medium">{p.style}</td>
                <td className="px-3 py-3 text-fg-2">{p.observed}</td>
                <td className="px-3 py-3 text-fg-2">{p.works}</td>
                <td className="px-3 py-3 text-fg-2">{p.learn}</td>
                <td className="px-3 py-3 text-fg-2">{p.avoid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">How dark is dark?</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg-2">WatchTrack is dark-only, so the page colour carries the identity. Backgrounds sampled from the screenshots (approximate), with off-white text on each.</p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {DARKNESS.map(([name, hex, tint]) => (
            <li key={name} className="rounded-xl p-3 ring-1 ring-line" style={{ background: hex, color: '#EDEBE6' }}>
              <span className="block text-sm font-semibold">{name}</span>
              <code className="text-xs opacity-80">{hex}</code>
              <span className="block text-xs opacity-70">
                {tint} · {contrast('#EDEBE6', hex).toFixed(1)}:1
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <List title="What single-dark-theme products teach" items={DARK_LESSONS} />
        </div>
      </div>
      <div className="space-y-2">
        {NOTES.map((n) => (
          <p key={n} className="max-w-4xl rounded-xl bg-surface-2 px-4 py-3 text-sm text-fg-2">
            {n}
          </p>
        ))}
      </div>
      <div>
        <h2 className="mb-3 text-xl font-semibold tracking-tight">Synthesis</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <List title="Common patterns" items={SYNTHESIS.patterns} />
          <List title="Emerging trends" items={SYNTHESIS.trends} />
          <List title="Features users expect" items={SYNTHESIS.expected} />
          <List title="Where WatchTrack can differ" items={SYNTHESIS.differentiate} />
          <List title="Conventions worth keeping" items={SYNTHESIS.keep} />
          <List title="Generic patterns to drop" items={SYNTHESIS.drop} />
        </div>
      </div>
    </div>
  )
}

function BoardView({ open }: { open: (id: string) => void }) {
  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Aesthetic territories</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TERRITORIES.map((t) => (
            <div key={t.name} className="card p-4">
              <h3 className="font-semibold">{t.name}</h3>
              <p className="text-xs text-muted">From {t.from}</p>
              <p className="mt-2 text-sm text-fg-2">{t.idea}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.concepts.map((c) => {
                  const th = THEMES.find((x) => x.id === c)!
                  return (
                    <button key={c} type="button" onClick={() => open(c)} className="chip">
                      <Swatches theme={th} className="h-2.5 w-6" /> {th.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {BOARD.map((section) => (
        <section key={section.id}>
          <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {section.refs.map((r) => (
              <article key={r.img + r.source} className="card overflow-hidden">
                <a href={shot(r.img)} target="_blank" rel="noreferrer" className="block">
                  <img src={shot(r.img)} alt={`${r.source} screenshot`} loading="lazy" className="aspect-[16/10] w-full object-cover object-top" />
                </a>
                <div className="space-y-2 p-4 text-sm">
                  <Ext href={r.url}>{r.source}</Ext>
                  <p className="text-fg-2">{r.interesting}</p>
                  <p>
                    <span className="font-semibold text-success">Adapt </span>
                    <span className="text-fg-2">{r.adapt}</span>
                  </p>
                  <p>
                    <span className="font-semibold text-danger">Don&apos;t copy </span>
                    <span className="text-fg-2">{r.avoid}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="card p-5">
        <h2 className="text-xl font-semibold tracking-tight">Extracted design language</h2>
        <p className="mt-2 flex flex-wrap gap-2">
          {LANGUAGE.words.map((w) => (
            <span key={w} className="rounded-full bg-fg px-3 py-1 text-sm font-semibold text-bg">
              {w}
            </span>
          ))}
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          {(
            [
              ['Typography', LANGUAGE.type],
              ['Colour', LANGUAGE.colour],
              ['Layout', LANGUAGE.layout],
              ['Components', LANGUAGE.components],
              ['Imagery', LANGUAGE.images],
              ['Motion', LANGUAGE.motion],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold text-muted">{k}</dt>
              <dd className="mt-0.5 text-fg-2">{v}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs font-semibold text-danger">Avoid</dt>
            <dd className="mt-0.5 text-fg-2">{LANGUAGE.avoid.join(' · ')}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-fg-2">
          Why: WatchTrack is a private, offline tool used a few seconds at a time (&quot;mark E19 watched&quot;), across anime, TV and film. A personal, calm and precise identity suits that better than the social-network or storefront looks of the category, and durability matters now that TV Time has closed.
        </p>
      </section>
    </div>
  )
}

export function Studio() {
  // Optional deep link: ?tab=board&c=panel&vs=current&device=phone (handy for sharing a view or screenshots).
  const [q] = useState(() => new URLSearchParams(location.search))
  const [tab, setTab] = useState<Tab>(() => (q.get('tab') as Tab) || 'concepts')
  const [id, setId] = useState(() => THEMES.find((t) => t.id === q.get('c'))?.id ?? THEMES[0].id)
  const [compareId, setCompareId] = useState(() => q.get('vs') ?? 'current')
  const [device, setDevice] = useState<Device>(() => (q.get('device') as Device) || (window.innerWidth < 900 ? 'phone' : 'desktop'))
  const chrome = tokens(NEUTRAL) as CSSProperties

  // ← / → (or 1–9, 0) step through concepts without reaching for the mouse.
  useEffect(() => {
    if (tab !== 'concepts') return
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
  }, [id, tab])

  return (
    <div className="min-h-dvh bg-bg text-fg" style={{ ...chrome, colorScheme: 'dark' }}>
      <header className="sticky top-0 z-20 border-b border-divider bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto min-w-0">
            <h1 className="text-base font-semibold tracking-tight">WatchTrack Design Studio</h1>
            <p className="text-xs text-muted">Single dark theme. Preview only: the app&apos;s own theme is unchanged.</p>
          </div>
          <Segmented
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              ['concepts', 'Concepts'],
              ['research', 'Research'],
              ['board', 'Inspiration'],
            ]}
          />
          {tab === 'concepts' && (
            <>
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
                <select className="input w-auto" value={compareId === id ? '' : compareId} onChange={(e) => setCompareId(e.target.value)}>
                  <option value="">No comparison</option>
                  {THEMES.filter((t) => t.id !== id).map((t) => (
                    <option key={t.id} value={t.id}>
                      Compare: {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] space-y-6 px-4 py-6 sm:px-6">
        {tab === 'concepts' && <ConceptsView device={device} id={id} setId={setId} compareId={compareId} setTab={setTab} />}
        {tab === 'research' && <ResearchView />}
        {tab === 'board' && (
          <BoardView
            open={(c) => {
              setId(c)
              setTab('concepts')
              window.scrollTo(0, 0)
            }}
          />
        )}
      </div>
      {tab === 'concepts' && (
        <p className="pb-8 text-center text-xs text-muted">
          Keys 1–9, 0 and ← → switch concepts.
        </p>
      )}
    </div>
  )
}
