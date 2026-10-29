import { CircleCheck, CirclePause, Clapperboard, Compass, HardDriveDownload, Library, ListPlus, Play, Plus, Share2, Sparkles, Tv, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ContinueCard, EmptyState, PosterGridSkeleton, Section, SeeAll, StatCard, TitleCard } from '../components/cards'
import { TitleMenu } from '../components/TitleMenu'
import { daysSince } from '../lib/format'
import { backupNudgeDue, snoozeBackupNudge, usePrefs } from '../lib/prefs'
import { byContinue, lastActivity } from '../lib/titles'
import { useLibrary } from '../state/library'

const byActivity = <T extends Parameters<typeof lastActivity>[0]>(a: T, b: T) => lastActivity(b).localeCompare(lastActivity(a))

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 5 ? 'Late night watching?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Dashboard() {
  const { titles, loading, episodesLogged } = useLibrary()
  const { backupNudgeAfter } = usePrefs()

  if (loading)
    return (
      <div className="space-y-8">
        <div className="skeleton h-40 rounded-3xl" />
        <PosterGridSkeleton count={6} />
      </div>
    )

  const watching = titles.filter((t) => t.status === 'watching' && t.progress).sort(byContinue)
  const onHold = titles.filter((t) => t.status === 'on_hold').sort(byActivity)
  const count = (s: string) => titles.filter((t) => t.status === s).length
  const recent = [...titles].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
  const stale = watching.filter((t) => daysSince(lastActivity(t)) >= 30)

  if (titles.length === 0) {
    return (
      <div className="space-y-8">
        <Hero
          title="Track anime, TV shows and movies in one place"
          subtitle="One watchlist for everything you watch. Log episodes with a tap and always know the next one. No sign-up: your library stays in this browser."
        >
          <Link to="?add=1" className="btn-primary">
            <Plus className="size-4" aria-hidden /> Add your first title
          </Link>
          {/* Plain links: these are static pages outside the app's router. */}
          <a href="/about" className="btn-secondary">
            How it works
          </a>
          <a href="/guides" className="btn-ghost">
            Guides
          </a>
        </Hero>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Plus, title: 'Add titles', body: 'Search Kitsu and TVmaze for artwork and episode counts, or enter them by hand.' },
            { icon: Play, title: 'Log episodes', body: 'One tap marks the next episode watched. Undo is always one tap away.' },
            { icon: Share2, title: 'Share & back up', body: 'Send a read-only watchlist link, or export everything as JSON from Settings.' },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="card p-4">
              <Icon className="size-5 text-accent-text" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
        <EmptyState icon={Tv} title="Your library is empty" body="Titles you add show up here with your progress, stats and what to watch next." />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <Hero
        title={greeting()}
        subtitle={
          watching.length
            ? `${watching.length} title${watching.length === 1 ? '' : 's'} in progress${episodesLogged ? ` · ${episodesLogged.toLocaleString()} episode${episodesLogged === 1 ? '' : 's'} logged` : ''}`
            : 'Nothing in progress right now — pick something from your list.'
        }
      >
        <Link to="?add=1" className="btn-primary">
          <Plus className="size-4" aria-hidden /> Add title
        </Link>
        <Link to="/library" className="btn-secondary">
          <Library className="size-4" aria-hidden /> Browse library
        </Link>
        <Link to="?share=1" className="btn-ghost max-sm:hidden">
          <Share2 className="size-4" aria-hidden /> Share watchlist
        </Link>
      </Hero>

      {backupNudgeDue(titles.length, backupNudgeAfter) && <BackupNudge />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Watching" value={count('watching')} icon={Play} to="/continue" />
        <StatCard label="Completed" value={count('completed')} icon={CircleCheck} to="/completed" tone="bg-success/15 text-success" />
        <StatCard label="Plan to watch" value={count('plan')} icon={ListPlus} to="/plan" tone="bg-info/15 text-info" />
        <StatCard label="On hold" value={count('on_hold')} icon={CirclePause} to="/on-hold" tone="bg-warn/15 text-warn" />
      </div>

      <Section title="Continue watching" action={watching.length > 4 && <SeeAll to="/continue" label={`See all ${watching.length}`} />}>
        {watching.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {watching.slice(0, 4).map((t) => (
              <ContinueCard key={t.id} t={t} extra={<TitleMenu t={t} />} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Play}
            title="Nothing in progress"
            body="Start something from your plan-to-watch list or add a show you're watching."
            action={
              <Link to="/plan" className="btn-secondary">
                <ListPlus className="size-4" aria-hidden /> Open plan to watch
              </Link>
            }
          />
        )}
      </Section>

      <Section title="Recently added" action={<SeeAll to="/library" />}>
        {/* A deliberate carousel: scrolls sideways inside its own track, never the page. */}
        <div className="scrollbar-none -mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0">
          {recent.map((t) => (
            <div key={t.id} className="w-32 shrink-0 snap-start sm:w-36">
              <TitleCard t={t} />
            </div>
          ))}
        </div>
      </Section>

      <Link to="/discover" className="card-link group flex items-center gap-4 overflow-hidden bg-[radial-gradient(70%_120%_at_0%_0%,var(--glow),transparent_70%)] p-4 sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text ring-1 ring-accent/20">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Find something new</span>
          <span className="block text-sm text-muted">Recommendations based on the genres and ratings in your library.</span>
        </span>
        <Compass className="size-5 shrink-0 text-muted transition-colors group-hover:text-accent-text" aria-hidden />
      </Link>

      {stale.length > 0 && (
        <Section title="Haven't watched in a while">
          <ul className="card divide-y divide-line overflow-hidden">
            {stale.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link to={`/title/${t.id}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2">
                  <span className="truncate font-medium">{t.title}</span>
                  <span className="shrink-0 text-xs text-warn">{daysSince(lastActivity(t))} days idle</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {onHold.length > 0 && (
        <Section title="On hold" action={<SeeAll to="/on-hold" />}>
          <div className="poster-grid">
            {onHold.slice(0, 6).map((t) => (
              <TitleCard key={t.id} t={t} showStatus={false} />
            ))}
          </div>
        </Section>
      )}

      {episodesLogged > 0 && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted">
          <Clapperboard className="size-3.5" aria-hidden /> {episodesLogged.toLocaleString()} episode{episodesLogged === 1 ? '' : 's'} logged with WatchTrack
        </p>
      )}
    </div>
  )
}

function Hero({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <header className="relative overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_100%_0%,var(--glow),transparent_70%),radial-gradient(40%_60%_at_0%_100%,var(--glow),transparent_70%)]" />
      <div className="relative">
        <p className="eyebrow text-accent-text">WatchTrack</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">{subtitle}</p>
        <div className="mt-5 flex flex-wrap gap-2">{children}</div>
      </div>
    </header>
  )
}

// iOS Safari clears site storage after ~7 days unused unless the site is on the Home Screen.
const iosBrowser = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone

/** Data only lives in this browser, so remind people to export before they have something to lose. */
function BackupNudge() {
  return (
    <div role="status" className="card flex items-start gap-3 border-warn/40 p-4">
      <HardDriveDownload className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="font-medium">Your library lives only in this browser</p>
        <p className="text-muted">
          Clearing browser data deletes it. Export a backup so you can restore it or move it to another device.
          {iosBrowser && " On iPhone, also tap Share → Add to Home Screen so Safari doesn't clear it after a week away."}
        </p>
        <Link to="/settings" className="btn-secondary min-h-9 px-3 text-xs">
          Export backup
        </Link>
      </div>
      <button type="button" className="btn-ghost size-9 shrink-0 p-0" aria-label="Remind me later" onClick={() => snoozeBackupNudge(7)}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
