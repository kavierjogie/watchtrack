import { CalendarHeart, RefreshCw } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/cards'
import { ShareStudio } from '../components/review/ShareCards'
import { Calendar, Compared, DataNotes, Finale, Intro, Journey, LookingBack, Moments, PersonalityCard, Top5 } from '../components/review/sections'
import { listAllHistory } from '../lib/db'
import { buildYearReview, indexHistory, reviewYears } from '../lib/review'
import type { ShareData } from '../lib/reviewImage'
import { lookingBack, reviewHeadline, reviewHighlights, reviewInsights, standoutRecord, watchingPersonality } from '../lib/reviewStory'
import type { HistoryEntry } from '../lib/types'
import { useLibrary } from '../state/library'

/**
 * Your year in WatchTrack: an opening, seven chapters and a closing screen, on an always-midnight stage. Everything is worked out on this device from the watch history
 * (lib/review.ts for the numbers, lib/reviewStory.ts for the words); this page only lays it out.
 */
export function YearReviewPage() {
  const lib = useLibrary()
  const [params, setParams] = useSearchParams()
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Fixed for the visit, so the numbers don't shift while you read (and "so far" means when you opened it).
  const [now] = useState(() => Date.now())
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    let live = true
    listAllHistory()
      .then((h) => {
        if (!live) return
        setHistory(h)
        setFailed(false)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [lib.historyVersion, attempt])

  // One pass over the history per change; switching years reuses it.
  const index = useMemo(() => (history ? indexHistory(lib.titles, history) : null), [lib.titles, history])
  const years = useMemo(() => (index ? reviewYears(index) : []), [index])
  const asked = Number(params.get('year'))
  const year = years.includes(asked) ? asked : (years[0] ?? new Date(now).getFullYear())
  const review = useMemo(() => (index ? buildYearReview(index, year, now) : null), [index, year, now])
  const personality = useMemo(() => (review ? watchingPersonality(review) : null), [review])
  const insights = useMemo(() => (review ? reviewInsights(review) : []), [review])
  const highlights = useMemo(() => (review ? reviewHighlights(review) : []), [review])
  const share = useMemo<ShareData | null>(() => (review ? { review, personality, highlights } : null), [review, personality, highlights])
  // Only these posters go on the cards: the top titles, and the lead highlight's title.
  const shareTitles = useMemo(() => {
    const ids = new Set(review?.top.map((t) => t.titleId))
    if (highlights[0]?.titleId) ids.add(highlights[0].titleId)
    return [...ids].map((id) => lib.byId(id))
  }, [review, highlights, lib])

  const chooseYear = useCallback((y: number) => setParams(y === years[0] ? {} : { year: String(y) }, { replace: true }), [setParams, years])

  if (failed)
    return (
      <EmptyState
        icon={CalendarHeart}
        title="Couldn't open your history"
        body="Your library is still saved. This browser didn't let WatchTrack read it just now."
        action={
          <button type="button" className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw className="size-4" aria-hidden /> Try again
          </button>
        }
      />
    )

  if (!index || lib.loading)
    return (
      <div className="space-y-6" aria-busy aria-label="Loading your year">
        <div className="skeleton h-64 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-32 rounded-2xl" />
          ))}
        </div>
        <div className="skeleton h-72 rounded-2xl" />
      </div>
    )

  if (!review || !share)
    return (
      <EmptyState
        icon={CalendarHeart}
        title="Nothing logged yet"
        body="Mark episodes and movies watched, and your year in review fills in here: your top shows, streaks, busiest months and watching personality. It's worked out on this device and never uploaded."
        action={
          <Link to="/" className="btn-primary">
            Go to Home
          </Link>
        }
      />
    )

  return (
    <div className="dark review-stage relative -mx-4 overflow-hidden text-fg sm:mx-auto sm:max-w-6xl sm:rounded-[2rem] sm:border sm:border-white/6 sm:shadow-pop">
      <Intro review={review} headline={reviewHeadline(review, personality?.main ?? null)} years={years} year={year} onYear={chooseYear} />
      <div className="space-y-24 px-5 pb-12 pt-10 sm:space-y-28 sm:px-10 sm:pt-16 lg:space-y-16 lg:px-10 lg:pt-6">
        <Journey review={review} />
        <Calendar review={review} />
        <PersonalityCard review={review} personality={personality} />
        <Moments review={review} byId={lib.byId} />
        <Top5 review={review} byId={lib.byId} />
        {/* Two text-led chapters share a row on desktop instead of each taking a screen. */}
        <div className="grid gap-y-24 sm:gap-y-28 lg:grid-cols-2 lg:gap-x-12">
          <Compared review={review} />
          <LookingBack summary={lookingBack(review, personality?.main ?? null)} insights={insights} />
        </div>
        <Finale review={review} standout={standoutRecord(review)} byId={lib.byId} onShare={() => setSharing(true)} />
        <DataNotes review={review} undated={index.undated} duplicates={index.duplicates} />
      </div>
      <AnimatePresence>{sharing && <ShareStudio key={year} data={share} titles={shareTitles} onClose={() => setSharing(false)} />}</AnimatePresence>
    </div>
  )
}
