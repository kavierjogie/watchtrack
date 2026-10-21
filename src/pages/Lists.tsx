import { CircleCheck, CirclePause, Library as LibraryIcon, ListPlus, Play, Plus, SearchX } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ContinueCard, EmptyState, PageHeader, PosterGridSkeleton } from '../components/cards'
import { FilterBar, TitleCollection, useFilters } from '../components/filters'
import { TitleMenu } from '../components/TitleMenu'
import { timeAgo } from '../lib/format'
import { usePrefs } from '../lib/prefs'
import { byContinue, lastActivity } from '../lib/titles'
import { MEDIA_LABEL, type MediaType } from '../lib/types'
import { useLibrary } from '../state/library'
import { useWatchActions } from '../state/useWatchActions'
import { Poster } from '../components/Poster'

const QUICK = [
  { to: '/plan', label: 'Plan to Watch', icon: ListPlus },
  { to: '/on-hold', label: 'On Hold', icon: CirclePause },
  { to: '/completed', label: 'Completed', icon: CircleCheck },
]

const noMatches = <EmptyState icon={SearchX} title="No matches" body="Try a different search or clear the filters." />

export function LibraryPage() {
  const { titles, loading } = useLibrary()
  const prefs = usePrefs()
  const { f, setF, genres, result } = useFilters(titles, { status: prefs.defaultStatus })

  return (
    <>
      <PageHeader
        title="My Library"
        subtitle={`${titles.length} title${titles.length === 1 ? '' : 's'}`}
        action={
          <Link to="?add=1" className="btn-primary">
            <Plus className="size-4" aria-hidden /> Add
          </Link>
        }
      />
      {/* Quick links to the status lists (handy on mobile where the sidebar is hidden) */}
      <div className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 lg:hidden">
        {QUICK.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="btn-secondary min-h-9 shrink-0 px-3 text-xs">
            <Icon className="size-4" aria-hidden /> {label}
          </Link>
        ))}
      </div>
      <FilterBar f={f} setF={setF} genres={genres} showStatus showRating />
      {loading ? (
        <PosterGridSkeleton />
      ) : titles.length === 0 ? (
        <EmptyState
          icon={LibraryIcon}
          title="Nothing here yet"
          body="Add titles one by one, or import your existing list."
          action={
            <>
              <Link to="?add=1" className="btn-primary">
                Add title
              </Link>
              <Link to="/import" className="btn-secondary">
                Import notes
              </Link>
            </>
          }
        />
      ) : result.length ? (
        <TitleCollection titles={result} />
      ) : (
        noMatches
      )}
    </>
  )
}

export function ContinuePage() {
  const { titles, loading } = useLibrary()
  const [type, setType] = useState<MediaType | 'all'>('all')
  const [sort, setSort] = useState<'recent' | 'idle' | 'title'>('recent')
  const list = titles
    .filter((t) => t.status === 'watching' && t.progress && (type === 'all' || t.mediaType === type))
    .sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title) : sort === 'idle' ? lastActivity(a).localeCompare(lastActivity(b)) : byContinue(a, b),
    )

  return (
    <>
      <PageHeader title="Continue Watching" subtitle="Every unfinished title and the exact episode to watch next." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(['all', 'anime', 'tv'] as const).map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={type === m} onClick={() => setType(m)}>
            {m === 'all' ? 'All' : MEDIA_LABEL[m]}
          </button>
        ))}
        <select className="input ml-auto w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by">
          <option value="recent">Recently watched</option>
          <option value="idle">Longest since watched</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>
      {loading ? (
        <PosterGridSkeleton count={6} />
      ) : list.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((t) => (
            <ContinueCard key={t.id} t={t} extra={<TitleMenu t={t} />} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Play}
          title="Nothing in progress"
          body="Titles marked as Watching show up here with their next episode."
          action={
            <Link to="?add=watching" className="btn-primary">
              Add a show you're watching
            </Link>
          }
        />
      )}
    </>
  )
}

export function PlanPage() {
  const { titles, loading } = useLibrary()
  const { f, setF, genres, result } = useFilters(
    titles.filter((t) => t.status === 'plan'),
    { sort: 'added' },
  )
  const { setStatus } = useWatchActions()

  return (
    <>
      <PageHeader
        title="Plan to Watch"
        subtitle="Things you want to get to."
        action={
          <Link to="?add=plan" className="btn-primary">
            <Plus className="size-4" aria-hidden /> Add
          </Link>
        }
      />
      <FilterBar f={f} setF={setF} genres={genres} sorts={['added', 'title', 'rating', 'updated']} />
      {loading ? (
        <PosterGridSkeleton />
      ) : result.length ? (
        <ul className="card divide-y divide-line">
          {result.map((t) => (
            <li key={t.id} className="flex items-center gap-3 p-3">
              <Link to={`/title/${t.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Poster poster={t.poster} title={t.title} mediaType={t.mediaType} className="w-12 shrink-0 rounded-lg" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {MEDIA_LABEL[t.mediaType]}
                    {t.year ? ` · ${t.year}` : ''} · added {timeAgo(t.createdAt)}
                  </span>
                </span>
              </Link>
              <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => void setStatus(t, 'watching')}>
                <Play className="size-4" aria-hidden /> Start
              </button>
              <TitleMenu t={t} />
            </li>
          ))}
        </ul>
      ) : titles.some((t) => t.status === 'plan') ? (
        noMatches
      ) : (
        <EmptyState icon={ListPlus} title="Your plan-to-watch list is empty" body="Add something you've been meaning to start." />
      )}
    </>
  )
}

export function OnHoldPage() {
  const { titles, loading } = useLibrary()
  const list = titles.filter((t) => t.status === 'on_hold').sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))

  return (
    <>
      <PageHeader title="On Hold" subtitle="Paused titles stay here until you resume them — nothing changes automatically." />
      {loading ? (
        <PosterGridSkeleton count={6} />
      ) : list.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((t) =>
            t.progress ? (
              <div key={t.id} className="space-y-0">
                <ContinueCard t={t} extra={<TitleMenu t={t} />} />
                {t.notes && <p className="mx-3 -mt-1 line-clamp-2 rounded-b-xl bg-surface-2 px-3 py-2 text-xs text-muted">{t.notes}</p>}
              </div>
            ) : (
              <OnHoldMovie key={t.id} id={t.id} />
            ),
          )}
        </div>
      ) : (
        <EmptyState icon={CirclePause} title="Nothing on hold" body="Pause a title from its menu and it'll wait here with your exact position." />
      )}
    </>
  )
}

function OnHoldMovie({ id }: { id: string }) {
  const t = useLibrary().byId(id)!
  const { setStatus } = useWatchActions()
  return (
    <div className="card flex items-center gap-3 p-3">
      <Poster poster={t.poster} title={t.title} mediaType={t.mediaType} className="w-16 shrink-0" />
      <div className="min-w-0 flex-1">
        <Link to={`/title/${t.id}`} className="font-semibold hover:text-accent-text">
          {t.title}
        </Link>
        <p className="text-xs text-muted">Updated {timeAgo(t.updatedAt)}</p>
        {t.notes && <p className="mt-1 line-clamp-2 text-xs text-muted">{t.notes}</p>}
      </div>
      <button type="button" className="btn-secondary min-h-9 px-3" onClick={() => void setStatus(t, 'watching')}>
        Resume
      </button>
    </div>
  )
}

export function CompletedPage() {
  const { titles, loading } = useLibrary()
  const done = titles.filter((t) => t.status === 'completed')
  const { f, setF, genres, result } = useFilters(done)
  return (
    <>
      <PageHeader title="Completed" subtitle={`${done.length} finished`} />
      <FilterBar f={f} setF={setF} genres={genres} showRating />
      {loading ? (
        <PosterGridSkeleton />
      ) : result.length ? (
        <TitleCollection titles={result} />
      ) : done.length ? (
        noMatches
      ) : (
        <EmptyState icon={CircleCheck} title="Nothing completed yet" body="Finished shows and movies will collect here." />
      )}
    </>
  )
}

