import { AnimatePresence } from 'framer-motion'
import { Bell, BellOff, CalendarCheck, CalendarClock, CalendarSync, Check, CheckCheck, Clapperboard, Megaphone, Sparkles, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ALERT_HEADING, alertUrl, describeAlert, dismissAlert, markRead, useAlerts, visible, type Alert, type AlertKind } from '../lib/alerts'
import { formatRelease, timeAgo } from '../lib/format'
import { usePrefs } from '../lib/prefs'
import { useLibrary } from '../state/library'
import { Modal } from './Modal'
import { Poster } from './Poster'

const KIND: Record<AlertKind, { icon: LucideIcon; tone: string }> = {
  season_announced: { icon: Megaphone, tone: 'bg-accent-soft text-accent-text' },
  date_confirmed: { icon: CalendarCheck, tone: 'bg-info/15 text-info' },
  date_changed: { icon: CalendarSync, tone: 'bg-warn/15 text-warn' },
  upcoming_episode: { icon: CalendarClock, tone: 'bg-info/15 text-info' },
  episode_released: { icon: Clapperboard, tone: 'bg-success/15 text-success' },
  season_available: { icon: Sparkles, tone: 'bg-success/15 text-success' },
}

const failed = () => toast.error("Couldn't update alerts. Your browser may be blocking storage.")

export function AlertItem({ a, onOpen }: { a: Alert; onOpen?: () => void }) {
  const t = useLibrary().byId(a.titleId)
  const { icon: Icon, tone } = KIND[a.kind]
  return (
    <li className={`relative flex gap-3 rounded-2xl p-3 transition-colors ${a.read ? '' : 'bg-accent-soft/40'}`}>
      <Poster poster={t?.poster ?? null} source={t?.source} title={a.showTitle} mediaType={t?.mediaType ?? 'tv'} className="w-12 shrink-0 self-start" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${tone}`}>
            <Icon className="size-3" aria-hidden /> {ALERT_HEADING[a.kind]}
          </span>
          <time className="text-muted" dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>
            {timeAgo(a.createdAt)}
          </time>
          {!a.read && <span className="size-2 rounded-full bg-accent" aria-label="Unread" />}
        </p>
        <p className="font-medium wrap-anywhere">{a.showTitle}</p>
        <p className="text-sm text-muted">{describeAlert(a)}</p>
        <p className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] text-fg-2">
          <span className="rounded-full bg-surface-2 px-2 py-0.5">{a.label}</span>
          {a.date && <span className="rounded-full bg-surface-2 px-2 py-0.5">{formatRelease(a.date)}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1 pt-1">
          {t ? (
            <Link
              to={alertUrl(a)}
              className="btn-secondary h-8 px-3 text-xs"
              onClick={() => {
                if (!a.read) void markRead([a.id]).catch(failed)
                onOpen?.()
              }}
            >
              Open show
            </Link>
          ) : (
            <span className="text-xs text-muted">No longer in your library</span>
          )}
          {!a.read && (
            <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => void markRead([a.id]).catch(failed)}>
              <Check className="size-3.5" aria-hidden /> Mark read
            </button>
          )}
        </div>
      </div>
      <button type="button" className="icon-btn size-8 shrink-0" aria-label={`Dismiss alert about ${a.showTitle}`} title="Dismiss" onClick={() => void dismissAlert(a.id).catch(failed)}>
        <X className="size-4" aria-hidden />
      </button>
    </li>
  )
}

/** Loading, error and empty states shared by the panel and the history page. */
export function AlertList({ limit, onOpen }: { limit?: number; onOpen?: () => void }) {
  const { items, status, error } = useAlerts()
  const { alertsOn } = usePrefs()
  const list = visible(items)
  if (status === 'loading' || status === 'idle')
    return (
      <div className="space-y-2" aria-busy aria-label="Loading alerts">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
    )
  if (status === 'error')
    return (
      <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
        {error}
      </p>
    )
  if (!list.length)
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text ring-1 ring-accent-line">
          {alertsOn ? <Bell className="size-5" aria-hidden /> : <BellOff className="size-5" aria-hidden />}
        </span>
        <p className="font-medium">{alertsOn ? "You're all caught up" : 'Release alerts are off'}</p>
        <p className="mt-1 max-w-xs text-sm text-muted">
          {alertsOn
            ? 'New seasons, confirmed dates and new episodes for shows in your library will show up here.'
            : 'Turn them on in Settings to hear about new seasons and episodes.'}
        </p>
        <Link to="/upcoming" className="btn-secondary mt-4" onClick={onOpen}>
          <CalendarClock className="size-4" aria-hidden /> See upcoming releases
        </Link>
      </div>
    )
  return (
    <ul className="space-y-1">
      {list.slice(0, limit).map((a) => (
        <AlertItem key={a.id} a={a} onOpen={onOpen} />
      ))}
    </ul>
  )
}

/** Bell with unread badge; opens the alerts panel (a bottom sheet on phones). */
export function AlertBell() {
  const [open, setOpen] = useState(false)
  const { items } = useAlerts()
  const list = visible(items)
  const unread = list.filter((a) => !a.read).length
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className="icon-btn relative" aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-on-accent ring-2 ring-bg-2">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <Modal
            open
            onClose={close}
            title="Alerts"
            footer={
              <>
                <Link to="/notifications" className="btn-ghost" onClick={close}>
                  See all
                </Link>
                <button type="button" className="btn-secondary" disabled={!unread} onClick={() => void markRead('all').catch(failed)}>
                  <CheckCheck className="size-4" aria-hidden /> Mark all read
                </button>
              </>
            }
          >
            <AlertList limit={20} onOpen={close} />
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}
