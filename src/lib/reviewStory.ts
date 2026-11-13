import { formatDay, MONTHS, percentChange, toHours, WEEKDAYS, type YearReview } from './review'

/**
 * The words around the numbers: a watching personality, personal insights and a closing summary. Every line is
 * computed from the review, with fixed thresholds, so the same history always says the same thing, and nothing is
 * said when there isn't enough data to back it up.
 */

// ---------- Watching personality ----------

export type PersonalityId = 'marathon' | 'binge' | 'completionist' | 'weekend' | 'consistent' | 'anime' | 'movies' | 'easygoing'

export interface Personality {
  id: PersonalityId
  name: string
  tagline: string
  /** Why you got it, in your own numbers. */
  reason: string
  /** How far past its threshold you are (1 = just made it). Highest wins. */
  score: number
}

/** Below this the year is too thin to say anything about habits. */
export const PERSONALITY_MIN_WATCHES = 10
const pct = (n: number) => `${Math.round(n * 100)}%`
const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`

/**
 * The rules, in tie-break order. Each is "measured value / threshold": a trait applies at 1 or more. The thresholds are
 * shown in the page's "How this works", so the result can be checked by hand.
 */
export const PERSONALITY_RULES: { id: PersonalityId; name: string; tagline: string; rule: string; test: (r: YearReview) => { score: number; reason: string } | null }[] = [
  {
    id: 'marathon',
    name: 'The Marathon Watcher',
    tagline: 'When you sit down, you settle in.',
    rule: '3 or more days with 8+ watches',
    test: (r) => (r.marathonDays >= 3 ? { score: r.marathonDays / 3, reason: `On ${plural(r.marathonDays, 'day')} you watched 8 or more in a single day${r.biggestDay ? `, with a record of ${r.biggestDay.count} on ${formatDay(r.biggestDay.day)}` : ''}.` } : null),
  },
  {
    id: 'binge',
    name: 'The Binge Watcher',
    tagline: 'One more episode is never just one.',
    rule: '40%+ of episodes in binges (4+ of one show in a day), over 3+ binges',
    test: (r) =>
      r.bingeSessions >= 3 && r.bingeShare >= 0.4
        ? { score: r.bingeShare / 0.4, reason: `${pct(r.bingeShare)} of your episodes came in binges of 4 or more of the same show in a day, across ${plural(r.bingeSessions, 'binge')}.` }
        : null,
  },
  {
    id: 'completionist',
    name: 'The Completionist',
    tagline: 'You finish what you start.',
    rule: '4+ series completed, and at least 40% of the series you watched',
    test: (r) => {
      const done = r.stats.completedSeries
      const share = r.seriesWatched ? done / r.seriesWatched : 0
      return done >= 4 && share >= 0.4 ? { score: share / 0.4, reason: `You completed ${plural(done, 'series', 'series')}: ${pct(Math.min(1, share))} of the ${plural(r.seriesWatched, 'series', 'series')} you watched this year.` } : null
    },
  },
  {
    id: 'weekend',
    name: 'The Weekend Warrior',
    tagline: 'Saturdays and Sundays are for watching.',
    rule: '15+ watches, half or more on Saturday and Sunday',
    test: (r) =>
      r.stats.watches >= 15 && r.weekendShare >= 0.5 ? { score: r.weekendShare / 0.5, reason: `${pct(r.weekendShare)} of everything you watched was on a Saturday or Sunday. An even spread would be 29%.` } : null,
  },
  {
    id: 'consistent',
    name: 'The Consistent Viewer',
    tagline: 'A little, often, all year.',
    rule: 'Something watched in 60%+ of weeks, over 8+ weeks',
    test: (r) => {
      const share = r.activeWeeks / r.coveredWeeks
      return r.coveredWeeks >= 8 && share >= 0.6 ? { score: share / 0.6, reason: `You watched something in ${r.activeWeeks} of the ${r.coveredWeeks} weeks ${r.inProgress ? 'so far' : 'of the year'}.` } : null
    },
  },
  {
    id: 'anime',
    name: 'The Anime Explorer',
    tagline: 'Your year was drawn, not filmed.',
    rule: '60%+ of episodes were anime, across 4+ anime series',
    test: (r) => {
      const share = r.stats.episodes ? r.animeEpisodes / r.stats.episodes : 0
      const titles = r.animeSeries
      return share >= 0.6 && titles >= 4 ? { score: share / 0.6, reason: `${pct(share)} of your episodes were anime, across ${plural(titles, 'series', 'series')}.` } : null
    },
  },
  {
    id: 'movies',
    name: 'The Movie Enthusiast',
    tagline: 'Two hours and a story: perfect.',
    rule: '6+ movies, making up 35%+ of everything watched',
    test: (r) => {
      const share = r.stats.movies / r.stats.watches
      return r.stats.movies >= 6 && share >= 0.35
        ? { score: share / 0.35, reason: `You watched ${plural(r.stats.movies, 'movie')}${r.movieRewatches ? ` (${plural(r.distinctMovies, 'different one')})` : ''}: ${pct(share)} of everything you logged.` }
        : null
    },
  },
]

/** Your main personality plus any other traits you qualified for, or null when the year is too thin to judge. */
export function watchingPersonality(r: YearReview): { main: Personality; also: Personality[] } | null {
  if (r.stats.watches < PERSONALITY_MIN_WATCHES || r.stats.activeDays < 3) return null
  const matched: Personality[] = []
  for (const rule of PERSONALITY_RULES) {
    const hit = rule.test(r)
    if (hit) matched.push({ id: rule.id, name: rule.name, tagline: rule.tagline, reason: hit.reason, score: hit.score })
  }
  // Stable sort: equal scores keep the rule order above.
  matched.sort((a, b) => b.score - a.score)
  if (!matched.length)
    return {
      main: {
        id: 'easygoing',
        name: 'The Easygoing Viewer',
        tagline: 'No rules, just good stuff when you feel like it.',
        reason: `No single habit dominated: ${plural(r.stats.watches, 'watch', 'watches')} across ${plural(r.titles, 'title')} on ${plural(r.stats.activeDays, 'day')}, at your own pace.`,
        score: 0,
      },
      also: [],
    }
  return { main: matched[0], also: matched.slice(1) }
}

// ---------- Insights ----------

/** The busiest month, when it means something: 10+ watches over 2+ months of coverage. */
const standoutMonth = (r: YearReview) => (r.stats.watches >= 10 && r.coverage.days >= 60 ? r.busiestMonth : null)

export interface Insight {
  id: string
  text: string
}

/** Personal observations, most interesting first. Each only appears when the data behind it is solid enough. */
export function reviewInsights(r: YearReview): Insight[] {
  const out: Insight[] = []
  const c = r.comparison

  if (c?.fair && c.previous.episodes >= 10) {
    const change = percentChange(c.current.episodes, c.previous.episodes)
    const when = c.narrowed ? `over the same dates in ${c.previousYear}` : c.toToday ? `by this point in ${c.previousYear}` : `in ${c.previousYear}`
    if (change !== null && Math.abs(change) >= 5) out.push({ id: 'compare', text: `You watched ${Math.abs(change)}% ${change > 0 ? 'more' : 'fewer'} episodes than ${when}.` })
    else if (change !== null)
      out.push({ id: 'compare', text: `You kept pace with ${c.previousYear}: ${plural(c.current.episodes, 'episode')} against ${c.previous.episodes.toLocaleString()}${c.narrowed || c.toToday ? ' over the same dates' : ''}.` })
  }
  const top = r.top[0]
  if (top && top.count >= 3 && top.mediaType !== 'movie' && r.stats.episodes) {
    out.push({ id: 'top', text: `${top.title} was your show of the year: ${plural(top.count, 'episode')}, ${pct(top.count / r.stats.episodes)} of all your episodes.` })
  }
  const month = standoutMonth(r)
  if (month) out.push({ id: 'month', text: `You were most active in ${MONTHS[month.month]}, with ${plural(month.count, 'watch', 'watches')}.` })
  if (r.favouriteWeekday) out.push({ id: 'weekday', text: `${WEEKDAYS[r.favouriteWeekday.weekday]} was your favourite day to watch: ${pct(r.favouriteWeekday.share)} of everything you logged.` })
  if (r.stats.completedSeries) out.push({ id: 'completed', text: `You completed ${plural(r.stats.completedSeries, 'series', 'series')} ${r.inProgress ? 'so far this year' : 'this year'}.` })
  if (r.stats.longestStreak && r.stats.longestStreak.days >= 3)
    out.push({ id: 'streak', text: `Your longest streak was ${r.stats.longestStreak.days} days in a row, from ${formatDay(r.stats.longestStreak.from)} to ${formatDay(r.stats.longestStreak.to)}.` })
  if (r.biggestBinge && r.biggestBinge.count >= 5) out.push({ id: 'binge', text: `Your biggest binge: ${r.biggestBinge.count} episodes of ${r.biggestBinge.title} on ${formatDay(r.biggestBinge.day)}.` })
  if (r.seriesStarted >= 2) out.push({ id: 'started', text: `You started ${plural(r.seriesStarted, 'new series', 'new series')} from episode 1.` })
  if (r.furthest && r.furthest.episode >= 100) out.push({ id: 'furthest', text: `You made it to episode ${r.furthest.episode.toLocaleString()} of ${r.furthest.title}.` })
  const h = toHours(r.stats.minutes)
  if (h >= 24) out.push({ id: 'time', text: `That's roughly ${Math.round(h).toLocaleString()} hours, or ${(h / 24).toFixed(1)} days, of watching.` })
  if (r.distinctMovies >= 3) out.push({ id: 'movies', text: `You watched ${plural(r.distinctMovies, 'different movie')}${r.movieRewatches ? `, and rewatched ${plural(r.movieRewatches, 'time')}` : ''}.` })
  return out
}

// ---------- Closing summary ----------

/** A short paragraph about the year, built only from facts in the review. */
export function lookingBack(r: YearReview, personality: Personality | null): string {
  const parts: string[] = []
  const whole = r.inProgress ? `So far in ${r.year}` : `In ${r.year}`
  const what = [r.stats.episodes ? plural(r.stats.episodes, 'episode') : '', r.stats.movies ? plural(r.stats.movies, 'movie') : ''].filter(Boolean).join(' and ')
  parts.push(`${whole}, you watched ${what} across ${plural(r.titles, 'title')}, on ${plural(r.stats.activeDays, 'different day')}.`)
  const top = r.top[0]
  if (top && top.count >= 2) parts.push(`${top.title} kept pulling you back, ${top.count} times in all.`)
  const month = standoutMonth(r)
  if (month) parts.push(`${MONTHS[month.month]} was your busiest month.`)
  if (r.stats.longestStreak && r.stats.longestStreak.days >= 3) parts.push(`At your best, you didn't miss a day for ${r.stats.longestStreak.days} days straight.`)
  if (personality && personality.id !== 'easygoing') parts.push(`All of which makes you ${personality.name.replace(/^The /, 'the ')}.`)
  return parts.join(' ')
}
