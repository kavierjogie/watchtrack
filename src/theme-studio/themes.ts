/**
 * Theme Studio design concepts. Dev-only exploration: nothing here is imported by the app.
 *
 * Each concept is a full visual direction, not just a palette:
 * - colour: one dark palette (WatchTrack is dark-only): five seed colours (bg, surface, primary, accent, text) plus four status hues. Every token the app
 *   uses (see src/index.css) is derived from those by tokens(), and any token that carries text is nudged until it meets
 *   WCAG AA (4.5:1) on the surface it sits on.
 * - look: typefaces, corner radii, card treatment and motion, applied by lookStyle() plus src/theme-studio/studio.css.
 * - brief: the written rationale shown in the studio.
 * Fonts load from Google Fonts in theme-studio.html only. A chosen face would be self-hosted in the app (it is offline-first).
 */

import type { CSSProperties } from 'react'

export interface Seed {
  bg: string
  surface: string
  /** Buttons, active nav, the watched part of progress. */
  primary: string
  /** Secondary highlight, used sparingly: "new" markers, chart highlights, the year-in-review chip. */
  accent: string
  text: string
}

/** Status hues (completed, plan to watch, on hold, dropped). "Watching" always takes the primary. */
export interface StatusHues {
  success: string
  info: string
  warn: string
  danger: string
}

/**
 * How cards are drawn (studio.css): shadow = soft lift, no border; hairline = 1px border, no shadow; rule = no box, a
 * top rule only (editorial); ink = heavy outline + offset shadow (manga panel); glass = translucent over the page;
 * stripe = tape-label stripe on top; flat = fill only.
 */
export type CardStyle = 'shadow' | 'hairline' | 'rule' | 'ink' | 'glass' | 'stripe' | 'flat'

export interface Look {
  display: string
  body: string
  mono?: string
  displayWeight: number
  displayCase?: 'uppercase'
  displayTracking: string
  /** Corner radii in px for Tailwind's md / lg / xl / 2xl / 3xl. */
  radius: [number, number, number, number, number]
  card: CardStyle
  /** Pills and dots become small squares. */
  squarePills?: boolean
  /** Blurred title art behind the home header. */
  backdrop?: boolean
  /** Signature easing and duration for the "watched" tick. */
  ease: string
  duration: number
}

export interface Brief {
  philosophy: string
  /** Ids from research.ts (PRODUCTS or BOARD images) with what was taken from each. */
  inspiration: [string, string][]
  surfaces: string
  cards: string
  nav: string
  icons: string
  motion: string
  distinctive: string
  risks: string
}

export interface Theme {
  id: string
  name: string
  mood: string
  personality: string
  /** The current app identity, shown for comparison. */
  current?: boolean
  recommended?: boolean
  /** The single dark palette (WatchTrack is dark-only). */
  colors: Seed
  status: StatusHues
  look: Look
  brief: Brief
}

const SYSTEM = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

export const THEMES: Theme[] = [
  {
    id: 'matinee',
    name: 'Matinee',
    mood: 'In the app since 2026-11-18',
    personality: 'Espresso & Mint kept, given a voice: a soft display serif for titles and episode numbers, flatter hairline cards and tighter corners. Evolution, not replacement.',
    recommended: true,
    colors: { bg: '#15120F', surface: '#1F1A16', primary: '#7CC4A4', accent: '#E9B872', text: '#F3EEE7' },
    status: { success: '#A9CF6A', info: '#86A9E6', warn: '#E58E5A', danger: '#E36A6A' },
    look: { display: "'Fraunces', Georgia, serif", body: "'Figtree', " + SYSTEM, displayWeight: 600, displayTracking: '-0.015em', radius: [6, 8, 10, 14, 18], card: 'hairline', backdrop: true, ease: 'cubic-bezier(0.2, 0.7, 0.2, 1)', duration: 260 },
    brief: {
      philosophy: 'The colours already set WatchTrack apart (nobody else in the category is warm brown); what reads as generic is the structure and the type. Keep the palette and brand assets, and fix the voice: a characterful soft serif for titles and numbers, Figtree for text, and fewer, flatter boxes.',
      inspiration: [
        ['letterboxd', 'Serif titles that feel like a film magazine'],
        ['serializd', 'Blurred title art behind the header'],
        ['myanimelist', 'Big numerals as the scannable element (E19)'],
        ['justwatch', 'Low-chroma UI so posters carry the colour'],
      ],
      surfaces: 'Espresso layers as today; the home header gets a blurred backdrop from the show you are watching instead of a mint glow.',
      cards: 'Hairline border, no drop shadow, 14px corners. Continue cards set the next episode in bold Figtree at 2× size (the serif read too soft at that size).',
      nav: 'Unchanged structure; active item becomes a mint bar + text, no filled pill.',
      icons: 'Lucide at 1.75 stroke; the existing W-track mark stays.',
      motion: 'Watched: the episode number slides up to the next one (260ms, ease-out). Cards fade in; nothing loops.',
      distinctive: 'Warm brown + mint is unique in the category, and a serif episode number is a signature no tracker has.',
      risks: 'Least dramatic change. Fraunces must be self-hosted (≈40 KB for two weights) to keep offline use.',
    },
  },
  {
    id: 'programme',
    name: 'Late Edition',
    mood: 'Festival programme, night print',
    personality: 'Warm ink, newsprint-white type and vermilion. Editorial and typographic: no card boxes, just rules, a serif and generous space. Posters supply the colour.',
    colors: { bg: '#14120E', surface: '#1C1915', primary: '#F06A3E', accent: '#8FB8C4', text: '#EFE8DA' },
    status: { success: '#6FB07F', info: '#8FB8C4', warn: '#D9A441', danger: '#D2507A' },
    look: { display: "'Instrument Serif', Georgia, serif", body: "'Instrument Sans', " + SYSTEM, displayWeight: 400, displayTracking: '-0.01em', radius: [0, 2, 2, 2, 2], card: 'rule', squarePills: true, ease: 'cubic-bezier(0.3, 0, 0, 1)', duration: 200 },
    brief: {
      philosophy: 'Treat the library like a festival programme: each section a column with a heading rule, titles in a light serif, metadata in small caps. Typography and whitespace instead of boxes.',
      inspiration: [
        ['a24', 'Hairline column rules and confident type'],
        ['mubi', 'Credits-style captions, underline tabs'],
        ['criterion', 'Serif + caps catalogue hierarchy'],
      ],
      surfaces: 'Flat warm ink, no gradients; type in newsprint off-white.',
      cards: 'No boxes: a 1px rule above each block, square corners.',
      nav: 'Text-only sidebar with an underline for the active item; mobile tabs with a top rule.',
      icons: 'Fewer icons: text labels first, icons only where there is no room.',
      motion: 'Short, crisp cross-fades (200ms); the episode number swaps like a type change.',
      distinctive: 'No tracker looks like a magazine. Light serif at large sizes is instantly recognisable.',
      risks: 'Less obvious tap targets without boxes; a light serif thins out on dark at small sizes, so it is kept to 20px and up; editorial looks are usually seen on paper, so it needs care to feel native on black.',
    },
  },
  {
    id: 'spine',
    name: 'Spine',
    mood: "Collector's archive",
    personality: 'Charcoal, oxblood and bone with condensed caps: a boxed-set catalogue. Every title feels numbered and shelved.',
    colors: { bg: '#121011', surface: '#1C1819', primary: '#D06A6E', accent: '#D8C9A8', text: '#EDE6DA' },
    status: { success: '#7BAE84', info: '#7FA0C6', warn: '#D6A458', danger: '#D77CA8' },
    look: { display: "'Archivo Narrow', 'Arial Narrow', sans-serif", body: "'Archivo', " + SYSTEM, mono: "'IBM Plex Mono', monospace", displayWeight: 700, displayCase: 'uppercase', displayTracking: '0.01em', radius: [2, 3, 4, 4, 6], card: 'hairline', ease: 'cubic-bezier(0.4, 0, 0.2, 1)', duration: 220 },
    brief: {
      philosophy: 'A personal library is a collection. Borrow the language of boxed sets: condensed caps headings, catalogue numbers, bone paper and a deep oxblood.',
      inspiration: [
        ['criterion', 'Spine numbers and condensed caps titles'],
        ['myanimelist', 'Rank numerals as a scanning device'],
        ['letterboxd', 'Metadata set small beside the title'],
      ],
      surfaces: 'Matte warm charcoal, no glow; bone-coloured type and rules.',
      cards: 'Hairline frame, 4px corners, no shadow.',
      nav: 'Uppercase condensed labels with counts in mono.',
      icons: 'Lucide, thin; numbers in mono replace some icons (counts, episode).',
      motion: 'Measured (220ms standard easing); lists stagger in like cards filed on a shelf.',
      distinctive: 'Oxblood + bone is unused in the category; condensed caps are compact on phones.',
      risks: 'Uppercase headings tire over long lists; red primary competes with the "dropped" status (moved to magenta).',
    },
  },
  {
    id: 'broadcast',
    name: 'Broadcast',
    mood: 'TV guide after midnight',
    personality: 'Phosphor amber on black with a mono schedule voice: teletext and departure boards. Built around "what airs next".',
    colors: { bg: '#0E0F0C', surface: '#171914', primary: '#F2B233', accent: '#6FD3C1', text: '#ECEBE2' },
    status: { success: '#8BC46A', info: '#7EA7E0', warn: '#E5794B', danger: '#E05A5A' },
    look: { display: "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif", body: "'IBM Plex Sans', " + SYSTEM, mono: "'IBM Plex Mono', monospace", displayWeight: 600, displayTracking: '-0.005em', radius: [0, 0, 0, 0, 0], card: 'hairline', squarePills: true, ease: 'steps(3, end)', duration: 150 },
    brief: {
      philosophy: 'WatchTrack\'s job is a schedule: next episode, airs Thursday, out now. Lean into broadcast design: grid lines, mono times and counts, an amber that reads like a lit display.',
      inspiration: [
        ['simkl', '"Today (17)", Countdown, day-grouped episodes'],
        ['justwatch', 'Dense, frameless catalogue'],
        ['myanimelist', 'Tabular, numeric scanning'],
      ],
      surfaces: 'Flat black with a faint grid; no gradients.',
      cards: 'Square corners, hairline grid borders, no shadow.',
      nav: 'Mono labels with counts; active item gets an amber block.',
      icons: 'Square-cap Lucide; status shown as small square indicators.',
      motion: 'Stepped, flip-board ticks (150ms, 3 steps) on the episode number; instant elsewhere.',
      distinctive: 'Unmistakable and fits the product\'s purpose literally.',
      risks: 'Can feel technical or cold for casual users; mono text is wider (longer titles truncate sooner); amber primary means "on hold" moves to orange.',
    },
  },
  {
    id: 'panel',
    name: 'Panel',
    mood: 'Manga page',
    personality: 'Sumi black, paper-white ink lines and a hanko red: heavy outlines, offset shadows and a bold gothic display. Anime energy without anime clichés.',
    colors: { bg: '#121212', surface: '#1C1C1C', primary: '#FF5A68', accent: '#FFD23F', text: '#F5F2EA' },
    status: { success: '#3FAE6A', info: '#4C8FD6', warn: '#F0A202', danger: '#C04BB0' },
    look: { display: "'Dela Gothic One', 'Arial Black', sans-serif", body: "'M PLUS 1p', " + SYSTEM, displayWeight: 400, displayTracking: '0', radius: [0, 0, 0, 0, 0], card: 'ink', squarePills: true, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)', duration: 240 },
    brief: {
      philosophy: 'Draw the interface like a manga page: panels with ink outlines, a heavy gothic for headings, a single red seal colour. Expressive, but structured.',
      inspiration: [
        ['crunchyroll', 'Heavy display weight with real energy'],
        ['anilist-title', 'Key-art-led title header'],
        ['arena', 'Square blocks with plain borders'],
      ],
      surfaces: 'Sumi black with paper-white ink lines; optional halftone texture on headers.',
      cards: '2px ink outline with a 4px offset shadow, square corners.',
      nav: 'Black bar with inverted active item, like a panel caption.',
      icons: 'Lucide at 2.25 stroke to match the heavy outlines.',
      motion: 'Snappy overshoot (240ms spring-like) on the watched tick and on pressed buttons.',
      distinctive: 'Strong personality, very recognisable, clearly entertainment.',
      risks: 'Skews anime; movie and western TV users may find it loud. Heavy outlines add visual noise in dense lists.',
    },
  },
  {
    id: 'projection',
    name: 'Projection',
    mood: 'House lights down',
    personality: 'Near-black, tungsten and marquee caps. Artwork-led and immersive: backdrops behind headers, translucent panels, posters glow.',
    colors: { bg: '#0A0A0B', surface: '#141416', primary: '#F2A65A', accent: '#E8E1D3', text: '#F4F1EA' },
    status: { success: '#6CC08F', info: '#7FA8E0', warn: '#E3C55B', danger: '#E5636B' },
    look: { display: "'Big Shoulders Display', 'Arial Narrow', sans-serif", body: "'Manrope', " + SYSTEM, displayWeight: 800, displayCase: 'uppercase', displayTracking: '0.01em', radius: [6, 8, 10, 12, 16], card: 'glass', backdrop: true, ease: 'cubic-bezier(0.16, 1, 0.3, 1)', duration: 420 },
    brief: {
      philosophy: 'The posters and stills are the most beautiful thing in the app. Dim the house lights: near-black canvas, title art behind every header, UI floating on translucent panels, a warm tungsten accent.',
      inspiration: [
        ['letterboxd', 'Backdrop fading into the page'],
        ['serializd', 'Show still behind the hero with vignette'],
        ['crunchyroll', 'Poster wall as atmosphere'],
      ],
      surfaces: 'Near-black with blurred artwork behind headers; panels at 70% opacity with backdrop blur.',
      cards: 'Translucent, borderless, 12px corners.',
      nav: 'Transparent top bar over art; sidebar recedes.',
      icons: 'Lucide, light; play-forward iconography for actions.',
      motion: 'Slow, cinematic (420ms expo-out) for art and page changes; the episode tick is a fade-through.',
      distinctive: 'The most immersive and "streaming service" feel.',
      risks: 'Depends on good artwork (placeholders look empty); translucency costs performance on older phones and must be disabled with Reduce Transparency; near-black #0A can smear on OLED screens while scrolling.',
    },
  },
  {
    id: 'pocket',
    name: 'Pocket',
    mood: 'Sunday sofa',
    personality: 'Cocoa, tomato and mint-leaf with butter-cream type and a chunky friendly display. Soft, rounded and cheerful: the most approachable direction.',
    colors: { bg: '#1E1814', surface: '#2A221C', primary: '#FF7A52', accent: '#8ED1A8', text: '#FBF1DE' },
    status: { success: '#5DBB63', info: '#5FA8D3', warn: '#F2B134', danger: '#C2408E' },
    look: { display: "'Bricolage Grotesque', " + SYSTEM, body: "'Nunito', " + SYSTEM, displayWeight: 800, displayTracking: '-0.03em', radius: [12, 14, 18, 24, 32], card: 'shadow', ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)', duration: 320 },
    brief: {
      philosophy: 'Tracking TV is a happy habit, not a database task. Big soft shapes, chunky headings, warm food colours and springy feedback.',
      inspiration: [
        ['crunchyroll', 'Round, heavy display type'],
        ['anilist', 'Friendly rounded panels'],
        ['kitsu', 'Warm coral accents'],
      ],
      surfaces: 'Cocoa layers with butter-cream type; depth from lighter fills, not borders.',
      cards: 'Borderless, 24px corners, soft shadow.',
      nav: 'Bottom tab bar with a big round add button; filled pill for the active item.',
      icons: 'Lucide rounded caps; small sticker-like status chips.',
      motion: 'Springy (320ms overshoot) on watched, add and toggles.',
      distinctive: 'Warm and playful where competitors are dark and serious.',
      risks: 'Can look childish or "app template" if overdone; large radii waste space in dense grids; tomato primary pushes "dropped" to magenta.',
    },
  },
  {
    id: 'index',
    name: 'Index',
    mood: 'Reference shelf',
    personality: 'Graphite monochrome with off-white buttons and one signal-lime highlight. Neutral, precise, information-first.',
    colors: { bg: '#0F0F10', surface: '#18181A', primary: '#EDEDED', accent: '#D4F04C', text: '#EDEDED' },
    status: { success: '#4CAF7A', info: '#5B9BE6', warn: '#E0A030', danger: '#E5534B' },
    look: { display: "'Geist', " + SYSTEM, body: "'Geist', " + SYSTEM, mono: "'Geist Mono', monospace", displayWeight: 600, displayTracking: '-0.035em', radius: [4, 6, 6, 8, 10], card: 'hairline', ease: 'cubic-bezier(0.2, 0, 0, 1)', duration: 160 },
    brief: {
      philosophy: 'Get out of the way. The interface is greyscale; posters and status colours are the only colour. Precision type, mono numbers, hairlines.',
      inspiration: [
        ['arena', 'Content is the interface'],
        ['justwatch', 'Colourless UI around colourful posters'],
        ['a24', 'Mono labels'],
      ],
      surfaces: 'Neutral graphite, no tint at all.',
      cards: 'Hairline, 8px corners, no shadow.',
      nav: 'Compact list with mono counts; active item in ink.',
      icons: 'Lucide 1.5 stroke, small.',
      motion: 'Fast and invisible (160ms).',
      distinctive: 'Calm and very legible; scales to huge libraries.',
      risks: 'Neutral is not distinctive: risks looking like a developer tool. Off-white primary buttons are very bright on graphite and rely on weight, not colour.',
    },
  },
  {
    id: 'rewind',
    name: 'Rewind',
    mood: 'Video rental, 1989',
    personality: 'Tape-case brown, rental red and mustard stripes, cream labels and a slab display. Nostalgic and fun, with structure.',
    colors: { bg: '#17120E', surface: '#231B15', primary: '#F0593F', accent: '#F2C14E', text: '#F4EAD5' },
    status: { success: '#6DAF6B', info: '#6F9FD8', warn: '#E58E3C', danger: '#C2558F' },
    look: { display: "'Archivo Black', 'Arial Black', sans-serif", body: "'Chivo', " + SYSTEM, mono: "'Chivo Mono', monospace", displayWeight: 400, displayCase: 'uppercase', displayTracking: '-0.01em', radius: [2, 3, 3, 4, 4], card: 'stripe', ease: 'cubic-bezier(0.5, 0, 0.2, 1)', duration: 240 },
    brief: {
      philosophy: 'Your library is your own video shop. Tape-spine stripes, a slab display and labels that look printed, with a mono "rental card" voice for dates and counts.',
      inspiration: [
        ['justwatch', 'Corner tags on posters'],
        ['criterion', 'Spine as identity'],
        ['simkl', 'Bold, energetic headings'],
      ],
      surfaces: 'Tape-case brown with cream, printed-looking labels.',
      cards: 'Three-colour stripe across the top edge, small corners, hairline.',
      nav: 'Slab caps labels; active item underlined in red.',
      icons: 'Lucide, plus mono counters.',
      motion: 'A short "rewind" slide (240ms) on the episode tick.',
      distinctive: 'Memorable and very ownable; stripes become a brand device for icons and share cards.',
      risks: 'Nostalgia can date quickly; stripes everywhere get noisy; slab caps are heavy for long titles.',
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    mood: 'Evening train',
    personality: 'Deep teal-ink, peach light and moon cream with a Japanese mincho serif. Quiet and literary, like a slice-of-life sky.',
    colors: { bg: '#0E1A1F', surface: '#16262C', primary: '#F2A07B', accent: '#E9DFC4', text: '#EEF1EC' },
    status: { success: '#7CC59A', info: '#8DB3E8', warn: '#E4C46A', danger: '#E46F7C' },
    look: { display: "'Shippori Mincho', Georgia, serif", body: "'Zen Kaku Gothic New', " + SYSTEM, displayWeight: 700, displayTracking: '0', radius: [8, 10, 12, 14, 20], card: 'flat', ease: 'cubic-bezier(0.25, 0.1, 0.25, 1)', duration: 360 },
    brief: {
      philosophy: 'The calm of an anime evening scene: a deep ink-teal sky, warm peach light, a mincho serif. Gentle, for watching one episode before bed.',
      inspiration: [
        ['anilist-title', 'Key art setting the mood'],
        ['letterboxd', 'Serif titles'],
        ['kitsu', 'Warm accent on a cool base'],
      ],
      surfaces: 'Ink-teal layers with a faint vertical gradient (sky) on the home header only.',
      cards: 'Flat fills, no borders, 14px corners.',
      nav: 'Soft; active item in peach text with a small dot.',
      icons: 'Lucide 1.5 stroke.',
      motion: 'Slow, soft (360ms ease) fades; no overshoot.',
      distinctive: 'Atmospheric and anime-literate without being loud.',
      risks: 'Teal-dark is near "navy" territory; mincho needs a Japanese web font (large files, must subset); peach on teal can look washed out at small sizes.',
    },
  },
  {
    id: 'current',
    name: 'Espresso & Mint (before)',
    mood: 'What shipped before Matinee',
    personality: 'The current palette with the current structure: system font, rounded 16px cards with border and shadow, mint glow in the header.',
    current: true,
    colors: { bg: '#15120F', surface: '#221D19', primary: '#7CC4A4', accent: '#E9B872', text: '#F3EEE7' },
    status: { success: '#A9CF6A', info: '#86A9E6', warn: '#E58E5A', danger: '#E36A6A' },
    look: { display: SYSTEM, body: SYSTEM, displayWeight: 600, displayTracking: '-0.025em', radius: [6, 8, 12, 16, 24], card: 'shadow', ease: 'ease-out', duration: 150 },
    brief: {
      philosophy: 'Baseline for comparison.',
      inspiration: [],
      surfaces: 'Espresso layers, mint radial glow on the header.',
      cards: 'Rounded 16px, 1px border and soft shadow on every block.',
      nav: 'Filled mint-soft pill for the active item.',
      icons: 'Lucide.',
      motion: 'Press scale and fades.',
      distinctive: 'Palette is distinctive.',
      risks: 'Hero card + four icon stat tiles + rounded bordered cards everywhere is the generic dashboard template; the system font gives the brand no voice.',
    },
  },
]

/** CSS variables and data attributes that apply a concept's look (typography, radii, card style) to a preview. */
export function lookStyle(theme: Theme): { style: CSSProperties; data: Record<string, string> } {
  const l = theme.look
  const [md, lg, xl, xxl, xxxl] = l.radius.map((r) => `${r}px`)
  return {
    style: {
      '--font-display': l.display,
      '--font-body': l.body,
      '--font-mono': l.mono ?? l.body,
      '--display-weight': l.displayWeight,
      '--display-case': l.displayCase ?? 'none',
      '--display-tracking': l.displayTracking,
      '--radius-md': md,
      '--radius-lg': lg,
      '--radius-xl': xl,
      '--radius-2xl': xxl,
      '--radius-3xl': xxxl,
      '--ease': l.ease,
      '--dur': `${l.duration}ms`,
    } as CSSProperties,
    data: { 'data-card': l.card, 'data-pills': l.squarePills ? 'square' : 'round', 'data-backdrop': l.backdrop ? 'on' : 'off' },
  }
}

// ---------- Colour maths (sRGB, WCAG 2.x) ----------

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/** a moved toward b by t (0 = a, 1 = b). */
export const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)]
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}
const rgba = (hex: string, alpha: number) => `rgb(${rgb(hex).join(' ')} / ${alpha})`

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Moves colour toward `toward` in small steps until it reaches `target` contrast on `on`. Unchanged if it already does. */
export function fit(colour: string, on: string, toward: string, target = 4.5) {
  let c = colour
  for (let t = 0.04; contrast(c, on) < target && t <= 1; t += 0.04) c = mix(colour, toward, t)
  return c
}

// ---------- Tokens ----------

/** The full token set for one concept: the same variable names src/index.css defines, plus studio-only --accent-2. */
export function tokens(theme: Theme): Record<string, string> {
  const { bg, surface, primary, accent, text } = theme.colors
  // Button label: whichever of the page colour or the text colour reads better on the primary.
  const ink = [bg, text].sort((a, b) => contrast(b, primary) - contrast(a, primary))[0]
  const accentSoft = mix(surface, primary, 0.16)
  const status = Object.fromEntries(Object.entries(theme.status).map(([k, hue]) => [k, fit(hue, surface, text)]))
  return {
    '--bg': bg,
    '--bg-2': mix(bg, surface, 0.35),
    '--surface': surface,
    '--surface-2': mix(surface, text, 0.06),
    '--overlay': mix(surface, text, 0.03),
    '--border': mix(surface, text, 0.12),
    '--divider': mix(bg, text, 0.08),
    '--border-strong': mix(surface, primary, 0.55),
    '--text': text,
    '--text-2': mix(text, bg, 0.25),
    '--muted': fit(mix(text, bg, 0.42), surface, text),
    '--faint': mix(text, bg, 0.62),
    '--accent': primary,
    '--accent-hover': mix(primary, text, 0.14),
    '--accent-strong': mix(primary, '#000000', 0.2),
    '--accent-soft': accentSoft,
    '--accent-line': mix(surface, primary, 0.38),
    '--accent-text': fit(primary, accentSoft, text),
    '--on-accent': ink,
    '--accent-2': fit(accent, surface, text),
    '--accent-2-soft': mix(surface, accent, 0.14),
    '--danger': status.danger,
    '--success': status.success,
    '--warn': status.warn,
    '--info': status.info,
    '--shadow-card': '0 1px 0 rgb(255 255 255 / 0.025) inset, 0 8px 24px -12px rgb(0 0 0 / 0.7)',
    '--shadow-pop': '0 24px 60px -16px rgb(0 0 0 / 0.8), 0 0 0 1px rgb(255 255 255 / 0.02)',
    '--glow': rgba(primary, 0.08),
    '--accent-glow': mix(primary, '#000000', 0.2),
    '--backdrop': rgba(mix(bg, '#000000', 0.5), 0.72),
  }
}

/** Contrast pairs worth showing (and testing): each is text the app actually draws on that background. */
export function checks(t: Record<string, string>) {
  return [
    { label: 'Text on background', fg: t['--text'], bg: t['--bg'] },
    { label: 'Muted on surface', fg: t['--muted'], bg: t['--surface'] },
    { label: 'Button label', fg: t['--on-accent'], bg: t['--accent'] },
    { label: 'Active nav', fg: t['--accent-text'], bg: t['--accent-soft'] },
    { label: 'Accent text', fg: t['--accent-2'], bg: t['--surface'] },
    ...(['success', 'info', 'warn', 'danger'] as const).map((k) => ({ label: `Status: ${k}`, fg: t[`--${k}`], bg: t['--surface'] })),
  ].map((c) => ({ ...c, ratio: contrast(c.fg, c.bg) }))
}
