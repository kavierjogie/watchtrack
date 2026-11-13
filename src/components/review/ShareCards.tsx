import { Download, ImageIcon, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { errMsg } from '../../lib/format'
import type { ShareData, ShareVariant } from '../../lib/reviewImage'

const VARIANTS: { id: ShareVariant; label: string; needs?: (d: ShareData) => boolean }[] = [
  { id: 'summary', label: 'Year summary' },
  { id: 'top', label: 'Top titles', needs: (d) => d.review.top.length > 0 },
  { id: 'stats', label: 'By the numbers' },
  { id: 'personality', label: 'Personality', needs: (d) => !!d.personality },
]

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

/**
 * Pick a card, see it, share it. The image code loads only when this is opened, and the preview is drawn on this
 * device from the same numbers as the page.
 */
export function ShareCards({ data }: { data: ShareData }) {
  const [open, setOpen] = useState(false)
  const [variant, setVariant] = useState<ShareVariant>('summary')
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const available = VARIANTS.filter((v) => !v.needs || v.needs(data))
  const key = `${data.review.year}|${variant}|${data.review.stats.watches}`

  useEffect(() => {
    if (!open) return
    let live = true
    let made: string | null = null
    import('../../lib/reviewImage')
      .then((m) => m.previewReview(data, variant))
      .then((url) => {
        made = url
        if (live) setPreview({ key, url })
        else URL.revokeObjectURL(url)
      })
      .catch(() => live && setPreview(null))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [open, data, variant, key])

  async function share() {
    setBusy(true)
    try {
      const { shareReviewImage } = await import('../../lib/reviewImage')
      await shareReviewImage(data, variant)
    } catch (err) {
      toast.error("Couldn't make the image", { description: errMsg(err) })
    } finally {
      setBusy(false)
    }
  }

  const touch = isTouch()
  if (!open)
    return (
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="font-semibold">Share your year</p>
          <p className="text-sm text-muted">Four card designs, made on this device. Posters and personal notes are never included.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          <ImageIcon className="size-4" aria-hidden /> Make a share card
        </button>
      </div>
    )

  const shown = preview?.key === key ? preview.url : null
  return (
    <div className="card grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:p-6">
      <div className="min-w-0 space-y-4">
        <div>
          <p className="font-semibold">Share your year</p>
          <p className="text-sm text-muted">Made on this device as a 1080 × 1350 image, the size feeds show without cropping.</p>
        </div>
        <div role="group" aria-label="Card design" className="flex flex-wrap gap-1.5">
          {available.map((v) => (
            <button key={v.id} type="button" aria-pressed={v.id === variant} className="chip" onClick={() => setVariant(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={() => void share()} disabled={busy}>
          {touch ? <Share2 className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {busy ? 'Making image…' : touch ? 'Share image' : 'Download image'}
        </button>
      </div>
      <div className="mx-auto aspect-[4/5] w-full max-w-72 overflow-hidden rounded-2xl border border-line bg-bg-2">
        {shown ? <img src={shown} alt={`Preview of the ${VARIANTS.find((v) => v.id === variant)?.label.toLowerCase()} card`} className="size-full object-cover" /> : <div className="skeleton size-full" aria-busy aria-label="Drawing preview" />}
      </div>
    </div>
  )
}
