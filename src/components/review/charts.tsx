import { useState, type CSSProperties } from 'react'
import { monthState, MONTHS, toHours, WEEKDAYS, type YearReview } from '../../lib/review'

const watches = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'watch' : 'watches'}`

/**
 * Watches per month. Hover, focus or tap a month for its details; the busiest month starts selected and glows. Each
 * bar is a button, so the chart works with a keyboard and a screen reader reads every value.
 */
export function MonthChart({ review: r }: { review: YearReview }) {
  const [active, setActive] = useState(r.busiestMonth?.month ?? 0)
  const peak = Math.max(1, ...r.byMonth.map((m) => m.watches))
  const m = r.byMonth[active]
  const state = monthState(r, active)
  const busiest = r.busiestMonth?.month

  return (
    <div>
      <div className="flex h-60 items-end gap-1 sm:h-72 sm:gap-2.5 lg:h-48" role="group" aria-label="Watches per month">
        {r.byMonth.map((mo, i) => {
          const s = monthState(r, i)
          const on = i === active
          const top = i === busiest && mo.watches > 0
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
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-lg focus-visible:outline-offset-4"
            >
              {/* Phones show only the selected and busiest values, so twelve numbers don't crowd a narrow screen. */}
              <span aria-hidden className={`text-[11px] font-semibold tabular-nums transition-colors ${on || top ? 'text-fg' : 'text-muted max-sm:invisible'} ${mo.watches ? '' : 'invisible'}`}>
                {mo.watches}
              </span>
              <span
                aria-hidden
                style={{ height: mo.watches ? `${Math.max(4, (mo.watches / peak) * 100)}%` : undefined, '--rise-delay': `${i * 40}ms` } as CSSProperties}
                className={`review-bar w-full transition-[box-shadow,filter] ${
                  !mo.watches
                    ? s === 'tracked'
                      ? 'h-1.5 rounded-full bg-white/12'
                      : 'h-8 rounded-md border border-dashed border-white/15 bg-transparent'
                    : `rounded-lg ${top ? 'bg-linear-to-t from-accent-strong via-accent to-[#67e8f9] shadow-[0_0_36px_-6px_rgb(139_92_246/0.75)]' : 'bg-linear-to-t from-[#2c2563] to-[#6b5dd3] group-hover:brightness-125'}`
                } ${on ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-[#0b0922]' : ''}`}
              />
              <span aria-hidden className={`text-xs ${on ? 'font-semibold text-fg' : top ? 'font-medium text-accent-text' : 'text-muted'}`}>
                <span className="sm:hidden">{MONTHS[i][0]}</span>
                <span className="max-sm:hidden">{MONTHS[i].slice(0, 3)}</span>
              </span>
            </button>
          )
        })}
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-5 lg:mt-4 gap-y-1.5 text-[11px] text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-linear-to-t from-accent-strong to-[#67e8f9]" /> Busiest month
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-1 w-3 rounded-full bg-white/25" /> Nothing logged
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm border border-dashed border-white/30" /> Not tracked or not yet
        </li>
      </ul>

      {/* The readout for the selected month: never covers the chart or runs off a phone screen. */}
      <div className="mt-4 flex min-h-20 flex-wrap lg:mt-3 lg:min-h-16 lg:py-3 items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4" aria-live="polite">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {MONTHS[active]}
            {active === busiest && m.watches > 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-text">Busiest month</span>}
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
          <dl className="flex gap-6 text-sm">
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
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/** Watches by weekday, Monday first, with the favourite day lit and the weekend tinted cyan. */
export function WeekdayChart({ review: r }: { review: YearReview }) {
  const peak = Math.max(1, ...r.byWeekday)
  return (
    <ol className="grid grid-cols-7 gap-2" aria-label="Watches by day of the week">
      {r.byWeekday.map((n, i) => {
        const lead = i === r.favouriteWeekday?.weekday
        return (
          <li key={i} className="flex flex-col items-center gap-1.5" aria-label={`${WEEKDAYS[i]}: ${n}`} title={`${WEEKDAYS[i]}: ${n}`}>
            <span aria-hidden className="flex h-24 w-full items-end rounded-md lg:h-20 bg-white/[0.04]">
              <span
                className={`review-bar w-full rounded-md ${lead ? 'bg-linear-to-t from-accent-strong to-[#67e8f9]' : i >= 5 ? 'bg-linear-to-t from-[#1f4c63] to-[#3f8fb0]' : 'bg-linear-to-t from-[#2c2563] to-[#6b5dd3]'}`}
                style={{ height: n ? `${Math.max(6, (n / peak) * 100)}%` : '2px', '--rise-delay': `${i * 40}ms` } as CSSProperties}
              />
            </span>
            <span aria-hidden className={`text-[11px] ${lead ? 'font-semibold text-fg' : 'text-muted'}`}>
              {WEEKDAYS[i].slice(0, 2)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
