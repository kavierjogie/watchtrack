import { Check, Copy, Download, Lock, Moon, RefreshCw, Share2, ShieldCheck, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { errMsg } from '../../lib/format'
import type { Artwork, ShareData, ShareTheme, ShareVariant } from '../../lib/reviewImage'
import type { Title } from '../../lib/types'
import { Modal } from '../Modal'

type ImageModule = typeof import('../../lib/reviewImage')

interface CardInfo {
  id: ShareVariant
  label: (d: ShareData) => string
  /** One line about what's on it for this year, under the tab's name. */
  peek: (d: ShareData) => string
  blurb: string
  contents: string[]
  /** Why it can't be made yet, or null when it can. */
  locked: (d: ShareData) => string | null
}

// Top Five needs 3+ titles (3 or 4 make a Top Three): the same rule as topCount in reviewImage, kept here so the
// tabs don't wait for the image code to load.
const CARDS: CardInfo[] = [
  {
    id: 'top',
    label: (d) => (d.review.top.length >= 5 ? 'The Top Five' : 'The Top Three'),
    peek: (d) => (d.review.top[0] ? `#1 ${d.review.top[0].title}` : ''),
    blurb: 'The titles that defined your year, ranked, posters and all.',
    contents: ['Your most-watched titles, ranked', 'Their posters, number one up front', 'Anime, series or movie, and how much you watched'],
    locked: (d) => (d.review.top.length >= 3 ? null : 'Watch 3+ titles to unlock'),
  },
  {
    id: 'stats',
    label: () => 'The Numbers',
    peek: (d) => {
      const s = d.review.stats
      return s.episodes >= s.movies ? `${s.episodes.toLocaleString()} episodes` : `${s.movies.toLocaleString()} movies`
    },
    blurb: 'Your year in big, exact numbers. Only what WatchTrack actually logged, nothing estimated.',
    contents: ['Episodes or movies watched', 'Titles, completions, active days and streaks', 'Your year, month by month'],
    locked: () => null,
  },
  {
    id: 'personality',
    label: () => 'The Personality',
    peek: (d) => d.personality?.main.name ?? '',
    blurb: 'Your viewing identity, worked out from your habits with fixed rules.',
    contents: ['Your watching personality and icon', 'The number that earned it', 'Other traits you showed'],
    locked: (d) => (d.personality ? null : 'Log 10+ watches on 3+ days'),
  },
  {
    id: 'highlight',
    label: () => 'The Highlight Reel',
    peek: (d) => d.highlights[0]?.label ?? '',
    blurb: "Your standout achievement of the year, with the runners-up. Picked from your records, never made up.",
    contents: ['Your biggest achievement, front and centre', 'Up to two runner-up records', "The title's poster, when it's about one"],
    locked: (d) => (d.highlights.length ? null : 'Needs a streak, binge or big month'),
  },
]

const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
const keyOf = (theme: ShareTheme, v: ShareVariant) => `${theme}:${v}`

/**
 * Pick a card, see it, share it. Cards are drawn on this device, the chosen one first and the rest after so the tabs get
 * thumbnails; the preview shows the exact PNG that sharing, copying or downloading sends. The image code loads only
 * when this opens.
 */
export function ShareStudio({ data, titles, onClose }: { data: ShareData; titles: (Title | undefined)[]; onClose: () => void }) {
  const open = useMemo(() => CARDS.filter((c) => !c.locked(data)), [data])
  const [variant, setVariant] = useState<ShareVariant>(open[0]?.id ?? 'stats')
  const [theme, setTheme] = useState<ShareTheme>('midnight')
  const [cards, setCards] = useState<Record<string, { blob: Blob; url: string }>>({})
  const [failed, setFailed] = useState<Record<string, true>>({})
  const [caps, setCaps] = useState({ share: false, copy: false })
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const mod = useRef<Promise<ImageModule> | null>(null)
  const art = useRef<Promise<Artwork> | null>(null)
  const drawing = useRef(false)
  const urls = useRef<string[]>([])
  const alive = useRef(true)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    alive.current = true
    const made = urls.current
    return () => {
      alive.current = false
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [])

  // One card at a time: the selected one, then the others in this style for their thumbnails.
  useEffect(() => {
    if (drawing.current) return
    const next = [variant, ...open.map((c) => c.id).filter((v) => v !== variant)].find((v) => !cards[keyOf(theme, v)] && !failed[keyOf(theme, v)])
    if (!next) return
    const key = keyOf(theme, next)
    drawing.current = true
    mod.current ??= import('../../lib/reviewImage')
    void mod.current
      .then(async (m) => {
        setCaps({ share: m.canShareFiles(), copy: m.canCopyImage() })
        art.current ??= m.loadArtwork(titles)
        const blob = await m.renderReview(data, next, await art.current, theme)
        if (!alive.current) return
        const url = URL.createObjectURL(blob)
        urls.current.push(url)
        setCards((c) => ({ ...c, [key]: { blob, url } }))
      })
      .catch(() => alive.current && setFailed((f) => ({ ...f, [key]: true })))
      .finally(() => {
        drawing.current = false
        if (alive.current) setTick((t) => t + 1)
      })
  }, [variant, theme, cards, failed, data, titles, open, tick])

  const key = keyOf(theme, variant)
  const card = cards[key]
  const info = CARDS.find((c) => c.id === variant)!
  const label = info.label(data)

  async function deliver(kind: 'share' | 'download' | 'copy') {
    if (!card || !mod.current) return
    setBusy(true)
    try {
      const m = await mod.current
      const name = m.fileName(data.review, variant, theme)
      if (kind === 'share') {
        if ((await m.shareImage(card.blob, name, data.review.year)) === 'shared') toast.success('Shared your year')
      } else if (kind === 'copy') {
        await m.copyImage(card.blob)
        toast.success('Image copied', { description: 'Paste it into a chat or post.' })
      } else {
        m.downloadImage(card.blob, name)
        toast.success('Image saved', { description: name })
      }
    } catch (err) {
      const what = { share: "Couldn't open the share sheet", copy: "Couldn't copy the image", download: "Couldn't save the image" }[kind]
      toast.error(what, { description: `${errMsg(err)}${kind === 'download' ? '' : ' Try Download instead.'}` })
    } finally {
      setBusy(false)
    }
  }

  // Arrow keys move between the cards that can be made, as in any tab list.
  function onTabKey(e: KeyboardEvent) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir || !open.length) return
    e.preventDefault()
    const i = open.findIndex((c) => c.id === variant)
    const next = open[(i + dir + open.length) % open.length]
    setVariant(next.id)
    tabs.current[CARDS.indexOf(next)]?.focus()
  }

  const touch = isTouch()
  const share = caps.share && (
    <button key="share" type="button" className={touch ? 'btn-primary' : 'btn-secondary'} onClick={() => void deliver('share')} disabled={!card || busy}>
      <Share2 className="size-4" aria-hidden /> Share
    </button>
  )
  const copy = caps.copy && !caps.share && (
    <button key="copy" type="button" className="btn-secondary" onClick={() => void deliver('copy')} disabled={!card || busy}>
      <Copy className="size-4" aria-hidden /> Copy image
    </button>
  )
  const download = (
    <button key="download" type="button" className={touch && caps.share ? 'btn-secondary' : 'btn-primary'} onClick={() => void deliver('download')} disabled={!card || busy}>
      <Download className="size-4" aria-hidden /> Download PNG
    </button>
  )
  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-xs text-muted">
        <span className="font-semibold text-fg-2">1080 × 1350 px</span> · 4:5 PNG
      </p>
      <div className="ml-auto flex flex-wrap gap-2">{touch ? [download, share] : [copy, share, download]}</div>
    </div>
  )

  return (
    <Modal open onClose={onClose} title="Share your year" size="xl" footer={footer}>
      <div className="space-y-4">
        <div role="tablist" aria-label="Card design" onKeyDown={onTabKey} className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
          {CARDS.map((c, i) => {
            const lock = c.locked(data)
            const thumb = cards[keyOf(theme, c.id)]
            const selected = c.id === variant
            return (
              <button
                key={c.id}
                ref={(el) => {
                  tabs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`share-tab-${c.id}`}
                aria-selected={selected}
                aria-controls="share-preview"
                tabIndex={selected ? 0 : -1}
                disabled={!!lock}
                onClick={() => setVariant(c.id)}
                className={`press group flex min-w-[12.5rem] shrink-0 snap-start items-center gap-3 rounded-2xl border p-2 pr-3 text-left transition-colors md:min-w-0 ${
                  selected ? 'border-accent bg-accent-soft shadow-[0_0_0_1px_var(--accent)]' : 'border-line hover:border-line-strong/70'
                } disabled:cursor-not-allowed disabled:opacity-55`}
              >
                <span className="relative aspect-[4/5] w-12 shrink-0 overflow-hidden rounded-lg border border-white/8 bg-surface-2">
                  {lock ? (
                    <Lock className="absolute inset-0 m-auto size-4 text-muted" aria-hidden />
                  ) : thumb ? (
                    <img src={thumb.url} alt="" className="review-fade size-full object-cover" />
                  ) : (
                    <span className="skeleton absolute inset-0" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${selected ? 'text-fg' : 'text-fg-2 group-hover:text-fg'}`}>{c.label(data)}</span>
                  <span className="block truncate text-xs text-muted">{lock ?? c.peek(data)}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_19rem] md:items-start">
          <div
            id="share-preview"
            role="tabpanel"
            aria-labelledby={`share-tab-${variant}`}
            className={`mx-auto aspect-[4/5] w-full max-w-[min(100%,27rem,calc((92dvh-19rem)*0.8))] overflow-hidden rounded-2xl border border-line shadow-pop ${theme === 'daylight' ? 'bg-[#efeafc]' : 'bg-[#0b0922]'}`}
          >
            {card ? (
              <img key={card.url} src={card.url} alt={`Preview of ${label}, the 1080 × 1350 share card`} className="review-fade size-full object-cover" />
            ) : failed[key] ? (
              <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
                <p>Couldn't draw this card in this browser.</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setFailed((f) => {
                      const rest = { ...f }
                      delete rest[key]
                      return rest
                    })
                  }
                >
                  <RefreshCw className="size-4" aria-hidden /> Try again
                </button>
              </div>
            ) : (
              <div className="skeleton size-full" aria-busy aria-label="Drawing preview" />
            )}
          </div>

          <div className="space-y-5">
            <div>
              <h3 className="text-xl font-bold tracking-tight">{label}</h3>
              <p className="mt-1 text-sm text-fg-2">{info.blurb}</p>
              <ul className="mt-3 space-y-1.5 text-sm text-fg-2">
                {info.contents.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="eyebrow">Card style</p>
              <div role="radiogroup" aria-label="Card style" className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg-2 p-1">
                {(
                  [
                    ['midnight', 'Midnight', Moon],
                    ['daylight', 'Daylight', Sun],
                  ] as const
                ).map(([id, name, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={theme === id}
                    onClick={() => setTheme(id)}
                    className="press flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-fg aria-checked:bg-surface-2 aria-checked:text-fg aria-checked:shadow-card"
                  >
                    <Icon className="size-4" aria-hidden /> {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2.5 rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-muted">
              <ShieldCheck className="mt-px size-4 shrink-0 text-accent-text" aria-hidden />
              <p>
                Made on this device from your stats and your top titles' posters. Your full history and private notes aren't included, and nothing is uploaded. Sized 1080 × 1350 so Instagram, WhatsApp and most feeds show it uncropped.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
