import { LayoutGrid, List, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { usePrefs, setPrefs } from '../lib/prefs'
import { lastActivity } from '../lib/titles'
import { MEDIA_LABEL, STATUS_LABEL, type MediaType, type Title, type WatchStatus } from '../lib/types'
import { TitleCard, TitleRow } from './cards'

export type SortKey = 'updated' | 'title' | 'rating' | 'added' | 'watched'
const SORT_LABEL: Record<SortKey, string> = {
  updated: 'Recently updated',
  watched: 'Last watched',
  title: 'Title A–Z',
  rating: 'Rating',
  added: 'Date added',
}

export interface Filters {
  q: string
  type: MediaType | 'all'
  status: WatchStatus | 'all'
  genre: string
  minRating: number
  sort: SortKey
}

export function useFilters(titles: Title[], init: Partial<Filters> = {}) {
  const prefs = usePrefs()
  const [f, setF] = useState<Filters>({
    q: '',
    type: prefs.defaultType,
    status: 'all',
    genre: '',
    minRating: 0,
    sort: 'updated',
    ...init,
  })
  const genres = useMemo(() => [...new Set(titles.flatMap((t) => t.genres))].sort(), [titles])

  const result = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const out = titles.filter(
      (t) =>
        (f.type === 'all' || t.mediaType === f.type) &&
        (f.status === 'all' || t.status === f.status) &&
        (!f.genre || t.genres.includes(f.genre)) &&
        (!f.minRating || (t.rating ?? 0) >= f.minRating) &&
        (!q || t.title.toLowerCase().includes(q) || t.altTitles.some((a) => a.toLowerCase().includes(q)) || t.tags.some((g) => g.toLowerCase().includes(q))),
    )
    const cmp: Record<SortKey, (a: Title, b: Title) => number> = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      watched: (a, b) => lastActivity(b).localeCompare(lastActivity(a)),
      title: (a, b) => a.title.localeCompare(b.title),
      rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title),
      added: (a, b) => b.createdAt.localeCompare(a.createdAt),
    }
    return out.sort(cmp[f.sort])
  }, [titles, f])

  return { f, setF, genres, result }
}

export function FilterBar({
  f,
  setF,
  genres,
  showStatus = false,
  showRating = false,
  sorts = ['updated', 'watched', 'title', 'rating', 'added'],
}: {
  f: Filters
  setF: (f: Filters) => void
  genres: string[]
  showStatus?: boolean
  showRating?: boolean
  sorts?: SortKey[]
}) {
  const prefs = usePrefs()
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF({ ...f, [k]: v })

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">Search titles</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input pl-9" type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Search titles, tags…" />
        </label>
        {genres.length > 0 && (
          <select className="input w-auto" value={f.genre} onChange={(e) => set('genre', e.target.value)} aria-label="Genre">
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        )}
        {showRating && (
          <select className="input w-auto" value={f.minRating} onChange={(e) => set('minRating', Number(e.target.value))} aria-label="Minimum rating">
            <option value={0}>Any rating</option>
            {[9, 8, 7, 6, 5].map((n) => (
              <option key={n} value={n}>
                {n}+ / 10
              </option>
            ))}
          </select>
        )}
        <select className="input w-auto" value={f.sort} onChange={(e) => set('sort', e.target.value as SortKey)} aria-label="Sort by">
          {sorts.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="flex rounded-xl border border-line" role="group" aria-label="Layout">
          <button type="button" className="icon-btn" aria-pressed={prefs.libraryView === 'grid'} aria-label="Grid view" onClick={() => setPrefs({ libraryView: 'grid' })}>
            <LayoutGrid className={`size-4 ${prefs.libraryView === 'grid' ? 'text-accent-text' : ''}`} />
          </button>
          <button type="button" className="icon-btn" aria-pressed={prefs.libraryView === 'list'} aria-label="List view" onClick={() => setPrefs({ libraryView: 'list' })}>
            <List className={`size-4 ${prefs.libraryView === 'list' ? 'text-accent-text' : ''}`} />
          </button>
        </div>
      </div>
      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {(['all', 'anime', 'tv', 'movie'] as const).map((m) => (
          <button key={m} type="button" className="chip shrink-0" aria-pressed={f.type === m} onClick={() => set('type', m)}>
            {m === 'all' ? 'All types' : MEDIA_LABEL[m]}
          </button>
        ))}
        {showStatus && <span className="mx-1 w-px shrink-0 bg-line" aria-hidden />}
        {showStatus &&
          (['all', 'watching', 'on_hold', 'plan', 'completed', 'dropped'] as const).map((s) => (
            <button key={s} type="button" className="chip shrink-0" aria-pressed={f.status === s} onClick={() => set('status', s)}>
              {s === 'all' ? 'Any status' : STATUS_LABEL[s]}
            </button>
          ))}
      </div>
    </div>
  )
}

const GRID: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-7',
  md: 'grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6',
  lg: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
}

const PAGE = 48

/** Grid or list of titles, rendered in pages so large libraries stay fast. */
export function TitleCollection({ titles }: { titles: Title[] }) {
  const prefs = usePrefs()
  const [limit, setLimit] = useState(PAGE)
  const shown = titles.slice(0, limit)

  return (
    <>
      {prefs.libraryView === 'grid' ? (
        <div className={`grid gap-x-4 gap-y-6 ${GRID[prefs.gridSize]}`}>
          {shown.map((t) => (
            <TitleCard key={t.id} t={t} />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-line p-1">
          {shown.map((t) => (
            <TitleRow key={t.id} t={t} />
          ))}
        </div>
      )}
      {titles.length > limit && (
        <div className="mt-6 flex justify-center">
          <button type="button" className="btn-secondary" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({titles.length - limit} left)
          </button>
        </div>
      )}
    </>
  )
}
