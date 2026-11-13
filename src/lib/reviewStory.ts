import { formatDay, MONTHS, percentChange, toHours, WEEKDAYS, type YearReview } from './review'

/**
 * The words around the numbers: a watching personality, personal insights and a closing summary. Every line is
 * computed from the review, with fixed thresholds, so the same history always says the same thing, and nothing is
 * said when there isn't enough data to back it up.
 */

// ---------- Watching personality ----------

export type PersonalityId = 'marathon' | 'binge' | 'completionist' | 'weekend' | 'consistent' | 'anime' | 'movies' | 'explorer' | 'easygoing'

export interface Personality {
  id: PersonalityId
  name: string
  tagline: string
  /** Why you got it, in your own numbers. */
  reason: string
  /** The one number behind it, for the share card: "62%" / "of your episodes came in binges". */
  stat: { value: string; label: string }
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
export const PERSONALITY_RULES: { id: PersonalityId; name: string; tagline: string; rule: string; test: (r: YearReview) => { score: number; reason: string; stat: Personality['stat'] } | null }[] = [
  {
    id: 'marathon',
    name: 'The Marathon Watcher',
    tagline: 'When you sit down, you settle in.',
    rule: '3 or more days with 8+ watches',
    test: (r) => (r.marathonDays >= 3 ? { score: r.marathonDays / 3, stat: { value: r.marathonDays.toLocaleString(), label: 'days with 8 or more watches' }, reason: `On ${plural(r.marathonDays, 'day')} you watched 8 or more in a single day${r.biggestDay ? `, with a record of ${r.biggestDay.count} on ${formatDay(r.biggestDay.day)}` : ''}.` } : null),
  },
  {
    id: 'binge',
    name: 'The Binge Watcher',
    tagline: 'One more episode is never just one.',
    rule: '40%+ of episodes in binges (4+ of one show in a day), over 3+ binges',
    test: (r) =>
      r.bingeSessions >= 3 && r.bingeShare >= 0.4
        ? { score: r.bingeShare / 0.4, stat: { value: pct(r.bingeShare), label: 'of your episodes came in binges' }, reason: `${pct(r.bingeShare)} of your episodes came in binges of 4 or more of the same show in a day, across ${plural(r.bingeSessions, 'binge')}.` }
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
      return done >= 4 && share >= 0.4 ? { score: share / 0.4, stat: { value: done.toLocaleString(), label: `series completed, ${pct(Math.min(1, share))} of those you watched` }, reason: `You completed ${plural(done, 'series', 'series')}: ${pct(Math.min(1, share))} of the ${plural(r.seriesWatched, 'series', 'series')} you watched this year.` } : null
    },
  },
  {
    id: 'weekend',
    name: 'The Weekend Watcher',
    tagline: 'Saturdays and Sundays are for watching.',
    rule: '15+ watches, half or more on Saturday and Sunday',
    test: (r) =>
      r.stats.watches >= 15 && r.weekendShare >= 0.5 ? { score: r.weekendShare / 0.5, stat: { value: pct(r.weekendShare), label: 'of your watching on Saturdays and Sundays' }, reason: `${pct(r.weekendShare)} of everything you watched was on a Saturday or Sunday. An even spread would be 29%.` } : null,
  },
  {
    id: 'consistent',
    name: 'The Consistent Viewer',
    tagline: 'A little, often, all year.',
    rule: 'Something watched in 60%+ of weeks, over 8+ weeks',
    test: (r) => {
      const share = r.activeWeeks / r.coveredWeeks
      return r.coveredWeeks >= 8 && share >= 0.6 ? { score: share / 0.6, stat: { value: `${r.activeWeeks}/${r.coveredWeeks}`, label: 'weeks with something watched' }, reason: `You watched something in ${r.activeWeeks} of the ${r.coveredWeeks} weeks ${r.inProgress ? 'so far' : 'of the year'}.` } : null
    },
  },
  {
    id: 'anime',
    name: 'The Anime Enthusiast',
    tagline: 'Your year was drawn, not filmed.',
    rule: '60%+ of episodes were anime, across 4+ anime series',
    test: (r) => {
      const share = r.stats.episodes ? r.animeEpisodes / r.stats.episodes : 0
      const titles = r.animeSeries
      return share >= 0.6 && titles >= 4 ? { score: share / 0.6, stat: { value: pct(share), label: `of your episodes were anime, across ${plural(titles, 'series', 'series')}` }, reason: `${pct(share)} of your episodes were anime, across ${plural(titles, 'series', 'series')}.` } : null
    },
  },
  {
    id: 'movies',
    name: 'The Movie Buff',
    tagline: 'Two hours and a story: perfect.',
    rule: '6+ movies, making up 35%+ of everything watched',
    test: (r) => {
      const share = r.stats.movies / r.stats.watches
      return r.stats.movies >= 6 && share >= 0.35
        ? { score: share / 0.35, stat: { value: r.stats.movies.toLocaleString(), label: `movies, ${pct(share)} of everything you watched` }, reason: `You watched ${plural(r.stats.movies, 'movie')}${r.movieRewatches ? ` (${plural(r.distinctMovies, 'different one')})` : ''}: ${pct(share)} of everything you logged.` }
        : null
    },
  },
  {
    id: 'explorer',
    name: 'The Genre Explorer',
    tagline: 'No single genre could keep you.',
    rule: '8+ genres across 6+ titles, with no genre in more than half of them',
    test: (r) => {
      const [first, second] = r.genres
      const lead = first ? first.titles / r.genreTitles : 1
      return r.genreTitles >= 6 && r.genres.length >= 8 && lead <= 0.5
        ? {
            score: r.genres.length / 8,
            stat: { value: r.genres.length.toLocaleString(), label: `genres across ${plural(r.genreTitles, 'title')}` },
            reason: `You covered ${r.genres.length} genres this year. ${first.name}${second ? ` and ${second.name}` : ''} led, but nothing ran the show.`,
          }
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
    if (hit) matched.push({ id: rule.id, name: rule.name, tagline: rule.tagline, reason: hit.reason, stat: hit.stat, score: hit.score })
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
        stat: { value: r.titles.toLocaleString(), label: `titles on ${plural(r.stats.activeDays, 'day')}, no habit in charge` },
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

// ---------- Headline and standout (shared by the page's opening and ending, and the share cards) ----------

const HEADLINES: Partial<Record<PersonalityId, string>> = {
  anime: 'A year full of anime adventures.',
  binge: 'One more episode? Apparently, many.',
  marathon: 'A year of marathon nights.',
  completionist: 'A year of finishing what you started.',
  weekend: 'Weekends, well spent.',
  consistent: 'A little, often, all year long.',
  movies: 'A year at the movies.',
  explorer: 'A year that went everywhere.',
}

/** The opening line, chosen from the year's dominant habit so it always says something true about you. */
export function reviewHeadline(r: YearReview, personality: Personality | null): string {
  const picked = personality && HEADLINES[personality.id]
  if (picked) return picked
  if (!r.stats.episodes) return `Your ${r.year}, one movie at a time.`
  if (r.stats.episodes >= 300) return 'Your year, measured in episodes.'
  return r.inProgress ? `Your ${r.year}, one episode at a time.` : `You watched your way through ${r.year}.`
}

export interface Standout {
  /** The big number, already formatted. */
  value: string
  /** What it counts, read straight after the number ("days in a row"). */
  unit: string
  detail: string
}

/** The year's most impressive record, for the ending and the share cards. Always returns something for a non-empty year. */
export function standoutRecord(r: YearReview): Standout {
  const s = r.stats.longestStreak
  if (s && s.days >= 7) return { value: String(s.days), unit: 'days in a row', detail: `Your longest streak, ${formatDay(s.from)} – ${formatDay(s.to)}.` }
  if (r.biggestDay && r.biggestDay.count >= 6) return { value: String(r.biggestDay.count), unit: 'watched in one day', detail: `Your biggest day, on ${formatDay(r.biggestDay.day)}.` }
  const m = standoutMonth(r)
  if (m) return { value: m.count.toLocaleString(), unit: `watches in ${MONTHS[m.month]}`, detail: 'Your busiest month of the year.' }
  if (s && s.days >= 3) return { value: String(s.days), unit: 'days in a row', detail: `Your longest streak, ${formatDay(s.from)} – ${formatDay(s.to)}.` }
  return { value: r.stats.activeDays.toLocaleString(), unit: r.stats.activeDays === 1 ? 'day with something on' : 'days with something on', detail: `Across ${plural(r.titles, 'title')}.` }
}

// ---------- Highlight reel (the share card that celebrates one achievement) ----------

export type HighlightId = 'title' | 'binge' | 'streak' | 'month' | 'finished' | 'genre' | 'milestone' | 'furthest'

export interface Highlight {
  id: HighlightId
  /** What kind of achievement it is ("Longest streak"). */
  label: string
  /** The big figure, already formatted. A genre highlight's figure is the genre's name. */
  value: string
  /** Read straight after the value ("days in a row"). */
  unit: string
  detail: string
  /** The title it's about, for its poster. */
  titleId?: string
  /** How far past its threshold it is (1 = just made it). Highest leads the card. */
  score: number
}

const MILESTONE_STEPS = [100, 250, 500, 1000, 2000, 5000, 10_000]

/**
 * The year's achievements worth celebrating, best first. Each needs a fixed minimum (an 8-episode favourite, a week-long
 * streak, a 6-episode binge…) and is ranked by how far past it you went, so a thin year gets none rather than a forced one.
 */
export function reviewHighlights(r: YearReview): Highlight[] {
  const out: Highlight[] = []
  const top = r.top[0]
  if (top && top.mediaType !== 'movie' && top.count >= 8 && r.stats.episodes)
    out.push({
      id: 'title',
      label: 'Most-watched title',
      value: top.count.toLocaleString(),
      unit: `episodes of ${top.title}`,
      detail: `${pct(top.count / r.stats.episodes)} of every episode you watched${top.completed ? ', and you finished it' : ''}.`,
      titleId: top.titleId,
      score: top.count / 8,
    })
  else if (top && top.mediaType === 'movie' && top.count >= 3)
    out.push({ id: 'title', label: 'Most-watched title', value: top.count.toLocaleString(), unit: `times watching ${top.title}`, detail: 'Some films are worth seeing again.', titleId: top.titleId, score: top.count / 3 })
  const b = r.biggestBinge
  if (b && b.count >= 6) out.push({ id: 'binge', label: 'Biggest binge', value: b.count.toLocaleString(), unit: `episodes of ${b.title} in one day`, detail: `On ${formatDay(b.day)}. Just one more, right?`, titleId: b.titleId, score: b.count / 6 })
  const s = r.stats.longestStreak
  if (s && s.days >= 7) out.push({ id: 'streak', label: 'Longest streak', value: s.days.toLocaleString(), unit: 'days in a row', detail: `Something watched every day, ${formatDay(s.from)} – ${formatDay(s.to)}.`, score: s.days / 7 })
  const m = standoutMonth(r)
  if (m && m.count >= 15) {
    const mostly = r.byMonth[m.month].top
    out.push({
      id: 'month',
      label: 'Most productive month',
      value: m.count.toLocaleString(),
      unit: `watches in ${MONTHS[m.month]}`,
      detail: mostly && mostly.count >= 3 ? `Led by ${mostly.title}, ${plural(mostly.count, 'time')}.` : 'Your busiest month of the year.',
      score: m.count / 15,
    })
  }
  const done = Math.max(0, ...r.completedByMonth)
  if (done >= 3) {
    const month = r.completedByMonth.indexOf(done)
    out.push({
      id: 'finished',
      label: 'Most finished in a month',
      value: done.toLocaleString(),
      unit: `series completed in ${MONTHS[month]}`,
      detail: `Out of ${plural(r.stats.completedSeries, 'series', 'series')} you completed ${r.inProgress ? 'so far' : 'all year'}.`,
      score: done / 3,
    })
  }
  const g = r.genres[0]
  if (g && g.titles >= 4 && g.titles / r.genreTitles >= 0.3)
    out.push({ id: 'genre', label: 'Favourite genre', value: g.name, unit: 'was your genre of the year', detail: `${g.titles} of the ${r.genreTitles} titles you watched were ${g.name}.`, score: g.titles / 4 })
  const reached = [...MILESTONE_STEPS].reverse().find((n) => r.stats.watches >= n)
  if (reached) {
    const what = r.moments.find((x) => x.kind === 'milestone' && x.title === `Watch number ${reached.toLocaleString()}`)
    out.push({
      id: 'milestone',
      label: 'Milestone',
      value: reached.toLocaleString(),
      unit: 'watches logged',
      detail: what ? `Number ${reached.toLocaleString()} was ${what.detail}, on ${formatDay(what.day)}.` : `${r.stats.watches.toLocaleString()} in all.`,
      score: Math.log2(reached / 50),
    })
  }
  const f = r.furthest
  if (f && f.episode >= 100) out.push({ id: 'furthest', label: 'Deepest dive', value: f.episode.toLocaleString(), unit: `episodes into ${f.title}`, detail: 'The furthest you reached in any one show.', titleId: f.titleId, score: f.episode / 200 })
  // Stable sort: equal scores keep the order above.
  return out.sort((a, b) => b.score - a.score)
}
