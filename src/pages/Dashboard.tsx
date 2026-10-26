import { CircleCheck, CirclePause, Clapperboard, FileUp, ListPlus, Play, Plus, Tv } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ContinueCard, EmptyState, PageHeader, PosterGridSkeleton, Section, StatCard, TitleCard } from '../components/cards'
import { TitleMenu } from '../components/TitleMenu'
import { daysSince } from '../lib/format'
import { byContinue, lastActivity } from '../lib/titles'
import { useLibrary } from '../state/library'

const byActivity = <T extends Parameters<typeof lastActivity>[0]>(a: T, b: T) => lastActivity(b).localeCompare(lastActivity(a))

export function Dashboard() {
  const { titles, loading, episodesLogged } = useLibrary()

  if (loading) return <PosterGridSkeleton />

  const watching = titles.filter((t) => t.status === 'watching' && t.progress).sort(byContinue)
  const onHold = titles.filter((t) => t.status === 'on_hold').sort(byActivity)
  const count = (s: string) => titles.filter((t) => t.status === s).length
  const recent = [...titles].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12)
  const stale = watching.filter((t) => daysSince(lastActivity(t)) >= 30)

  if (titles.length === 0) {
    return (
      <>
        <PageHeader title="Welcome" subtitle="Track what you're watching and always know the next episode." />
        <EmptyState
          icon={Tv}
          title="Your library is empty"
          body="Add your first anime, show or movie — or import the list you keep in your Notes app."
          action={
            <>
              <Link to="?add=1" className="btn-primary">
                <Plus className="size-4" aria-hidden /> Add title
              </Link>
              <Link to="/import" className="btn-secondary">
                <FileUp className="size-4" aria-hidden /> Import my notes
              </Link>
            </>
          }
        />
      </>
    )
  }

  return (
    <div className="space-y-10">
      <PageHeader title="Home" subtitle={watching.length ? `${watching.length} in progress` : 'Nothing in progress right now'} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Watching" value={count('watching')} icon={Play} to="/continue" />
        <StatCard label="On hold" value={count('on_hold')} icon={CirclePause} to="/on-hold" />
        <StatCard label="Completed" value={count('completed')} icon={CircleCheck} to="/completed" />
        <StatCard label="Plan to watch" value={count('plan')} icon={ListPlus} to="/plan" />
        <StatCard label="Episodes logged" value={episodesLogged} icon={Clapperboard} />
      </div>

      <Section
        title="Continue watching"
        action={
          watching.length > 4 && (
            <Link to="/continue" className="text-sm text-accent-text hover:underline">
              See all
            </Link>
          )
        }
      >
        {watching.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {watching.slice(0, 4).map((t) => (
              <ContinueCard key={t.id} t={t} extra={<TitleMenu t={t} />} />
            ))}
          </div>
        ) : (
          <EmptyState icon={Play} title="Nothing in progress" body="Start something from your plan-to-watch list or add a new title." />
        )}
      </Section>

      {stale.length > 0 && (
        <Section title="Haven't watched in a while">
          <ul className="card divide-y divide-line">
            {stale.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link to={`/title/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2">
                  <span className="truncate font-medium">{t.title}</span>
                  <span className="shrink-0 text-xs text-muted">{daysSince(lastActivity(t))} days</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recently updated">
        <div className="scrollbar-none -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          {recent.map((t) => (
            <div key={t.id} className="w-28 shrink-0 snap-start sm:w-32">
              <TitleCard t={t} />
            </div>
          ))}
        </div>
      </Section>

      {onHold.length > 0 && (
        <Section
          title="On hold"
          action={
            <Link to="/on-hold" className="text-sm text-accent-text hover:underline">
              See all
            </Link>
          }
        >
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {onHold.slice(0, 6).map((t) => (
              <TitleCard key={t.id} t={t} showStatus={false} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
