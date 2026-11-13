import { Download, RefreshCw, Share2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errMsg } from '../../lib/format'
import type { Artwork, ShareData, ShareVariant } from '../../lib/reviewImage'
import type { Title } from '../../lib/types'
import { Modal } from '../Modal'

type ImageModule = typeof import('../../lib/reviewImage')

const VARIANTS: { id: ShareVariant; label: string; blurb: string; needs?: (d: ShareData) => boolean }[] = [
  { id: 'summary', label: 'The Overview', blurb: 'Your headline, big numbers, top titles and a highlight.' },
  { id: 'top', label: 'The Top Five', blurb: 'A poster showcase of what you watched most.', needs: (d) => d.review.top.length > 0 },
  { id: 'stats', label: 'The Numbers', blurb: 'An editorial stack of your stats, month by month.' },
  { id: 'personality', label: 'The Personality', blurb: 'Your watching personality and when you watch.', needs: (d) => !!d.personality },
]

const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

/**
 * Pick a design, see it, share it. Each card is drawn once on this device; the preview shows that exact PNG and
 * sharing or downloading sends the same bytes. The image code loads only when this opens.
 */
export function ShareStudio({ data, titles, onClose }: { data: ShareData; titles: (Title | undefined)[]; onClose: () => void }) {
  const available = VARIANTS.filter((v) => !v.needs || v.needs(data))
  const [variant, setVariant] = useState<ShareVariant>('summary')
  const [cards, setCards] = useState<Partial<Record<ShareVariant, { blob: Blob; url: string }>>>({})
  const [failed, setFailed] = useState<ShareVariant | null>(null)
  const [canShare, setCanShare] = useState(false)
  const [busy, setBusy] = useState(false)
  const mod = useRef<Promise<ImageModule> | null>(null)
  const art = useRef<Promise<Artwork> | null>(null)
  const pending = useRef(new Set<ShareVariant>())
  const urls = useRef<string[]>([])
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const made = urls.current
    return () => {
      alive.current = false
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [])

  useEffect(() => {
    if (cards[variant] || pending.current.has(variant) || failed === variant) return
    pending.current.add(variant)
    mod.current ??= import('../../lib/reviewImage')
    void mod.current
      .then(async (m) => {
        setCanShare(m.canShareFiles())
        art.current ??= m.loadArtwork(titles)
        const blob = await m.renderReview(data, variant, await art.current)
        if (!alive.current) return
        const url = URL.createObjectURL(blob)
        urls.current.push(url)
        setCards((c) => ({ ...c, [variant]: { blob, url } }))
      })
      .catch(() => alive.current && setFailed(variant))
      .finally(() => pending.current.delete(variant))
  }, [variant, cards, failed, data, titles])

  const card = cards[variant]
  const meta = VARIANTS.find((v) => v.id === variant)!

  async function deliver(kind: 'share' | 'download') {
    if (!card || !mod.current) return
    setBusy(true)
    try {
      const m = await mod.current
      const name = m.fileName(data.review, variant)
      if (kind === 'share') {
        if ((await m.shareImage(card.blob, data, variant)) === 'shared') toast.success('Shared your year')
      } else {
        m.downloadImage(card.blob, name)
        toast.success('Image saved', { description: name })
      }
    } catch (err) {
      toast.error(kind === 'share' ? "Couldn't open the share sheet" : "Couldn't save the image", { description: `${errMsg(err)}${kind === 'share' ? ' Try Download instead.' : ''}` })
    } finally {
      setBusy(false)
    }
  }

  const touch = isTouch()
  const share = canShare && (
    <button key="share" type="button" className={touch ? 'btn-primary' : 'btn-secondary'} onClick={() => void deliver('share')} disabled={!card || busy}>
      <Share2 className="size-4" aria-hidden /> Share
    </button>
  )
  const download = (
    <button key="download" type="button" className={touch && canShare ? 'btn-secondary' : 'btn-primary'} onClick={() => void deliver('download')} disabled={!card || busy}>
      <Download className="size-4" aria-hidden /> Download PNG
    </button>
  )

  return (
    <Modal open onClose={onClose} title="Share your year" size="lg" footer={touch ? [download, share] : [share, download]}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:items-start">
        <div className="mx-auto aspect-[4/5] w-full max-w-[min(100%,24rem,calc((92dvh-15rem)*0.8))] overflow-hidden rounded-2xl border border-line bg-[#0b0922] shadow-pop">
          {card ? (
            <img key={card.url} src={card.url} alt={`Preview of ${meta.label}, the 1080 × 1350 share card`} className="review-fade size-full object-cover" />
          ) : failed === variant ? (
            <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
              <p>Couldn't draw this card in this browser.</p>
              <button type="button" className="btn-secondary" onClick={() => setFailed(null)}>
                <RefreshCw className="size-4" aria-hidden /> Try again
              </button>
            </div>
          ) : (
            <div className="skeleton size-full" aria-busy aria-label="Drawing preview" />
          )}
        </div>
        <div className="space-y-4">
          <div role="group" aria-label="Card design" className="grid grid-cols-2 gap-2 sm:grid-cols-1">
            {available.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={v.id === variant}
                onClick={() => setVariant(v.id)}
                className="press rounded-xl border border-line px-3 py-2.5 text-left text-sm font-medium text-fg-2 hover:border-line-strong/60 hover:text-fg aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-fg"
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-fg-2">{meta.blurb}</p>
          <p className="text-xs text-muted">1080 × 1350, the size feeds show uncropped. Drawn on this device from your stats and top titles' posters. Your notes and full history never leave it.</p>
        </div>
      </div>
    </Modal>
  )
}
