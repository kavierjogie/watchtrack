import { useState, type CSSProperties } from 'react'
import { MONTHS, toHours, WEEKDAYS, type YearReview } from '../../lib/review'

const watches = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'watch' : 'watches'}`

type MonthState = 'tracked' | 'untracked' | 'future'

/** A month before the first logged watch isn't "zero", it wasn't tracked; one after today hasn't happened yet. */
function monthState(r: YearReview, m: number): MonthState {
  const first = `${r.year}-${String(m + 1).padStart(2, '0')}-01`
  const last = `${r.year}-${String(m + 1).padStart(2, '0')}-31`
  if (last < r.coverage.from) return 'untracked'
  if (first > r.coverage.to) return 'future'
  return 'tracked'
}

/**
 * Watches per month. Hover, focus or tap a month for its details; the busiest month starts selected. Each bar is a
 * button, so the chart works with a keyboard and a screen reader reads every value.
 */
export function MonthChart({ review: r }: { review: YearReview }) {
  const [active, setActive] = useState(r.busiestMonth?.month ?? 0)
  const peak = Math.max(1, ...r.byMonth.map((m) => m.watches))
  const m = r.byMonth[active]
  const state = monthState(r, active)

  return (
    <div>
      <div className="flex h-48 items-end gap-1 sm:h-56 sm:gap-2" role="group" aria-label="Watches per month">
        {r.byMonth.map((mo, i) => {
          const s = monthState(r, i)
          const on = i === active
          const label = s === 'tracked' ? `${MONTHS[i]}: ${watches(mo.watches)}` : `${MONTHS[i]}: ${s === 'future' ? 'not yet' : 'not tracked'}`
          return (
            <button
              key={i}
              type="button"
              aria-label={label}
              aria-pressed={on}
              title={label}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5 rounded-lg focus-visible:outline-offset-4"
            >
              <span aria-hidden className={`text-[11px] font-medium tabular-nums transition-colors ${on ? 'text-fg' : 'text-muted'} ${mo.watches ? '' : 'invisible'}`}>
                {mo.watches}
              </span>
              <span
                aria-hidden
                style={{ height: mo.watches ? `${Math.max(4, (mo.watches / peak) * 100)}%` : undefined, '--rise-delay': `${i * 35}ms` } as CSSProperties}
                className={`review-bar w-full rounded-md transition-[background-color,box-shadow] ${
                  !mo.watches
                    ? s === 'tracked'
                      ? 'h-1 bg-line'
                      : 'h-1 border border-dashed border-line bg-transparent'
                    : on
                      ? 'bg-accent shadow-[0_0_0_3px_var(--accent-soft)]'
                      : i === r.busiestMonth?.month
                        ? 'bg-accent/70 group-hover:bg-accent/85'
                        : 'bg-accent-line group-hover:bg-accent/50'
                }`}
              />
              <span aria-hidden className={`text-xs ${on ? 'font-semibold text-fg' : 'text-muted'}`}>
                <span className="sm:hidden">{MONTHS[i][0]}</span>
                <span className="max-sm:hidden">{MONTHS[i].slice(0, 3)}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* The readout for the selected month: a tooltip that never covers the chart or runs off a phone screen. */}
      <div className="mt-4 flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl bg-surface-2 px-4 py-3" aria-live="polite">
        <div className="min-w-0">
          <p className="font-semibold">
            {MONTHS[active]}
            {active === r.busiestMonth?.month && m.watches > 0 && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-text">Busiest month</span>}
          </p>
          <p className="truncate text-sm text-muted">
            {state === 'future'
              ? "Hasn't happened yet."
              : state === 'untracked'
                ? 'Before you started logging in WatchTrack.'
                : m.watches
                  ? `Most watched: ${m.top?.title ?? '—'}${m.top && m.top.count > 1 ? ` (${m.top.count})` : ''}`
                  : 'Nothing logged this month.'}
          </p>
        </div>
        {state === 'tracked' && m.watches > 0 && (
          <dl className="flex gap-5 text-sm">
            <Stat label="Episodes" value={m.episodes.toLocaleString()} />
            <Stat label="Movies" value={m.movies.toLocaleString()} />
            <Stat label="Hours (est.)" value={`≈${toHours(m.minutes).toLocaleString()}`} />
          </dl>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/** Watches by weekday, Monday first, with the weekend picked out. */
export function WeekdayChart({ review: r }: { review: YearReview }) {
  const peak = Math.max(1, ...r.byWeekday)
  return (
    <ol className="grid grid-cols-7 gap-1.5" aria-label="Watches by day of the week">
      {r.byWeekday.map((n, i) => (
        <li key={i} className="flex flex-col items-center gap-1" aria-label={`${WEEKDAYS[i]}: ${n}`} title={`${WEEKDAYS[i]}: ${n}`}>
          <span aria-hidden className="flex h-16 w-full items-end">
            <span
              className={`review-bar w-full rounded ${i === r.favouriteWeekday?.weekday ? 'bg-accent' : i >= 5 ? 'bg-info/60' : 'bg-accent-line'}`}
              style={{ height: n ? `${Math.max(6, (n / peak) * 100)}%` : '2px', '--rise-delay': `${i * 40}ms` } as CSSProperties}
            />
          </span>
          <span aria-hidden className="text-[11px] text-muted">
            {WEEKDAYS[i].slice(0, 2)}
          </span>
        </li>
      ))}
    </ol>
  )
}
