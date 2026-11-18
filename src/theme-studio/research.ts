/**
 * Research and inspiration board for the Theme Studio (dev-only). Screenshots in ./refs were captured on 2026-11-18 from the
 * public pages linked below (headless Edge, or the in-app browser where headless was blocked). "Observed" fields describe
 * what the screenshot shows; "learn" / "adapt" / "avoid" are recommendations. Hex values marked sampled were read from the
 * screenshot pixels, so they are approximate (JPEG, scaled).
 */

const files = import.meta.glob<string>('./refs/*.jpg', { eager: true, query: '?url', import: 'default' })
export const shot = (id: string) => files[`./refs/${id}.jpg`]

export interface Product {
  id: string
  name: string
  url: string
  /** Screenshot id in ./refs, if one could be captured. */
  img?: string
  style: string
  observed: string
  works: string
  learn: string
  avoid: string
}

export const PRODUCTS: Product[] = [
  {
    id: 'anilist',
    name: 'AniList',
    url: 'https://anilist.co/anime/154587/Sousou-no-Frieren/',
    img: 'anilist-title',
    style: 'Soft navy, rounded, friendly-technical',
    observed: 'Wide banner art with the poster overlapping it; navy surfaces (sampled #161F2E); sky-blue "Add to List" split button (sampled #74ACD1); rounded geometric sans; rank chips ("#1 Highest Rated All Time") in a left rail.',
    works: 'The poster-over-banner header gives every title a sense of place. The split button puts "add" and "which list" in one control.',
    learn: 'A title page should lead with artwork and one primary action. The split "Add ▾" pattern is already in WatchTrack and is the right call.',
    avoid: 'Navy + sky blue is the default "anime tracker" look; copying it would make WatchTrack read as an AniList skin.',
  },
  {
    id: 'myanimelist',
    name: 'MyAnimeList',
    url: 'https://myanimelist.net/topanime.php',
    img: 'myanimelist',
    style: 'Dense legacy database, table-first',
    observed: 'Top Anime as a ranked table: huge grey rank numerals, small poster, score column, "Add to My List" button per row. Dark slate (sampled #1C2329) with mid-blue buttons. A consent dialog covers most of the page on first visit.',
    works: 'Huge rank numerals make a list scannable at a glance. Information density is genuinely useful for collectors.',
    learn: 'Big numerals as a typographic device: WatchTrack\'s equivalent is the next episode number ("E19"), which deserves that weight.',
    avoid: 'Ad slots, banners and 10px link rows. Density without hierarchy.',
  },
  {
    id: 'kitsu',
    name: 'Kitsu',
    url: 'https://kitsu.app/explore/anime',
    img: 'kitsu',
    style: 'Light, plain, community-era Bootstrap',
    observed: 'Plum top bar (sampled #40303D), light grey canvas, coral-red "View more" links. Every rail on Explore (Trending, Top Airing…) rendered empty during the visit.',
    works: 'The plum + coral pairing is warm and unusual for the category.',
    learn: 'Empty rails with only a "View more" link look broken. WatchTrack\'s skeletons and empty states must look intentional.',
    avoid: 'Generic Bootstrap layout, small headings, unstyled category lists.',
  },
  {
    id: 'letterboxd',
    name: 'Letterboxd',
    url: 'https://letterboxd.com/film/past-lives/',
    img: 'letterboxd',
    style: 'Cinematic editorial on slate',
    observed: 'Full-bleed backdrop that fades into a slate page; poster card overlaps it; the film title is set in a serif with the year and director beside it; small spaced uppercase nav; green star ratings and a mini ratings histogram; the three-dot orange/green/blue logo.',
    works: 'Serif titles over film stills make it feel like a film magazine, not a database. The histogram turns a number into a picture.',
    learn: 'A display serif for titles and a stills-led header can carry the whole identity with very little chrome.',
    avoid: 'The slate-blue + green palette and the three-dot mark are strongly owned by Letterboxd.',
  },
  {
    id: 'trakt',
    name: 'Trakt',
    url: 'https://trakt.tv/',
    img: 'trakt',
    style: 'Dark landing page with violet glow',
    observed: 'Near-black canvas (sampled #0F0F19) lit by a violet radial glow; huge tight-tracked bold grotesk headline; violet pill CTA (sampled #8062E8); pill eyebrow "Free on web, iOS and Android"; tilted poster card.',
    works: 'Very large, tightly set headline type is confident and readable.',
    learn: 'Scale contrast (huge headline, small body) creates hierarchy without boxes.',
    avoid: 'Violet glow + pill eyebrow + gradient card is exactly the generic AI/SaaS template the brief wants to escape.',
  },
  {
    id: 'serializd',
    name: 'Serializd',
    url: 'https://www.serializd.com/',
    img: 'serializd',
    style: 'TV-community, backdrop hero, teal',
    observed: 'Full-bleed show still behind the hero with a heavy dark vignette; teal pill buttons; Roboto-style sans; feature row of three icon circles; device mock-ups of the app below.',
    works: 'Real show art in the hero signals "TV" instantly.',
    learn: 'Let title artwork do the colour work; keep the UI palette quiet around it.',
    avoid: 'Icon-circle feature rows and device mock-ups: stock landing-page furniture.',
  },
  {
    id: 'simkl',
    name: 'Simkl',
    url: 'https://simkl.com/anime/',
    img: 'simkl',
    style: 'Busy, maximal, anime-forward',
    observed: 'Icon-over-label uppercase top nav; second nav bar (Genres, Today (17), Calendar, Countdown…); full-width anime key art with episode title in italic bold; red "Join" CTA (sampled #D83C3D); "New episodes / Yesterday" rail with episode cards.',
    works: '"Today (17)", "Countdown" and a dated "New episodes" rail put airing information first, which is the job WatchTrack does best.',
    learn: 'Group new episodes by day ("Yesterday, Tuesday 17 November") rather than by show.',
    avoid: 'Two stacked nav bars, italic display text over busy art, too many competing accents.',
  },
  {
    id: 'justwatch',
    name: 'JustWatch',
    url: 'https://www.justwatch.com/us',
    img: 'justwatch',
    style: 'Utility catalogue, near-black + yellow',
    observed: 'Near-black (sampled #050E17); yellow wordmark; a row of streaming-service logos as filters; dense 7-column poster grid with small "TV" / "Free" tags in poster corners; dropdown filter row.',
    works: 'The poster is the card: no frame, no padding, just a tag in the corner. Extremely scannable.',
    learn: 'Frameless poster tiles with corner tags; filters as a single horizontal row.',
    avoid: 'Logo soup and cookie bars; yellow-on-black is JustWatch\'s own signature.',
  },
  {
    id: 'mubi',
    name: 'MUBI',
    url: 'https://mubi.com/en/films',
    img: 'mubi',
    style: 'Editorial, white, stills not posters',
    observed: 'White page; uppercase bold grotesk headings ("FILM DATABASE"); films shown as landscape stills with the title in bold uppercase and director + year in small caps over the image; underline tabs; outlined secondary button.',
    works: 'Stills + caps titles feel curated, like a festival programme. Very little UI colour.',
    learn: 'Credits-style typography (title large, metadata small caps) and underline tabs instead of pills.',
    avoid: 'Landscape stills need backdrop art for every title; WatchTrack mostly has portrait posters.',
  },
  {
    id: 'crunchyroll',
    name: 'Crunchyroll',
    url: 'https://www.crunchyroll.com/',
    img: 'crunchyroll',
    style: 'Bold anime streaming, orange',
    observed: 'Tilted wall of anime posters behind a dark overlay; heavy rounded geometric display type; orange pill CTA (sampled #FF690B); a cream phishing-warning banner and a cookie bar on arrival.',
    works: 'Heavy, round display type has real energy and suits anime.',
    learn: 'A heavier display weight can make headings feel like key art.',
    avoid: 'Orange is Crunchyroll\'s; the tilted poster wall is a common streaming cliché.',
  },
]

/**
 * WatchTrack is dark-only. How dark the category actually is: page backgrounds sampled from the screenshots (approximate),
 * darkest first. Light references (A24, MUBI, Kitsu, Criterion) are kept on the board for type and layout only.
 */
export const DARKNESS: [string, string, string][] = [
  ['Are.na', '#000100', 'Pure black'],
  ['JustWatch', '#050E17', 'Blue-black'],
  ['Serializd', '#0C1011', 'Green-black'],
  ['Trakt', '#0F0F19', 'Violet-black'],
  ['WatchTrack today', '#15120F', 'Espresso'],
  ['Letterboxd', '#14171C', 'Slate'],
  ['AniList', '#161F2E', 'Navy'],
  ['Plex (tiles)', '#1A181D', 'Charcoal'],
  ['MyAnimeList', '#1C2329', 'Slate-blue'],
  ['Apple TV', '#1F1F1F', 'Neutral grey'],
]

/** What the dark references teach, for an app with a single dark theme. Observed first, then the recommendation. */
export const DARK_LESSONS = [
  'Nobody but Are.na uses true black; the rest sit between #05 and #1F. Pure black makes posters look cut out and causes smearing on OLED scrolling. Recommendation: a tinted near-black around #0E–#16, never #000.',
  'Most backgrounds are tinted cool (navy, slate, blue-black). Only WatchTrack is warm. A warm or otherwise unusual tint is the cheapest way to be recognisable in a single dark mode.',
  'Apple TV and Letterboxd show depth with lighter surfaces, not shadows: shelves and cards are a step lighter than the page. Shadows barely read on dark. Recommendation: 3 surface steps, about 4–6% lighter each.',
  'Apple TV\'s "Top 10" rows set huge outlined rank numerals beside the poster: big numbers read beautifully on dark. This supports making the next-episode number the hero.',
  'Plex shows the title as text on a dark tile when artwork is missing. Dark mode makes empty poster frames very visible, so placeholders need a designed state.',
  'Saturated accents glow on dark (Trakt violet, AniList sky blue, Apple TV #0A84FF). Recommendation: one accent, slightly desaturated for large fills, full strength only for small marks; text no brighter than off-white so it doesn\'t halate.',
]

/** Also visited: TV Time's site now shows only a farewell notice to its community (observed 2026-11-18). */
export const NOTES = [
  'TV Time, one of the largest TV trackers, has shut down: tvtime.com now shows only a "Thank You, TV Time Community" notice. A tracker whose library lives on the user\'s own device (and survives the service) is a real differentiator worth expressing in the brand: calm, personal, durable, not "social network".',
  'Letterboxd, Criterion, Kitsu and MUBI blocked automated captures; their screenshots come from the in-app browser. Criterion\'s page is partly covered by its cookie notice, which was left unanswered.',
  'For the dark-only redo, Apple TV and Plex were added as dark references outside the tracker category. The Criterion Channel was also tried but is geo-blocked from this location.',
]

export const SYNTHESIS = {
  patterns: [
    'Near-black or navy canvas with one saturated brand colour (AniList blue, Trakt violet, Simkl red, JustWatch yellow, Crunchyroll orange, Serializd teal).',
    'Posters in a 2:3 grid as the primary browsing unit; title pages lead with banner art + overlapping poster.',
    'Status lists (Watching, Completed, Plan to watch…) and scores are universal.',
  ],
  trends: [
    'Huge, tightly tracked headline type on landing pages (Trakt, Crunchyroll, A24).',
    'Editorial and credits-style typography in the film space (Letterboxd serif titles, MUBI caps, A24 grotesk + mono labels).',
    'Data turned into small pictures: Letterboxd\'s ratings histogram, year-in-review recaps.',
  ],
  expected: ['One-tap "watched next episode"', 'Next airing date and "new episode" markers', 'Poster grid + list view', 'Ratings and personal stats', 'Dark mode'],
  differentiate: [
    'Make the next episode number the hero typographic element: no competitor does this.',
    'A calm, personal, durable identity (offline, no account) rather than a social network or a storefront.',
    'Own a palette nobody in the category uses: every competitor is blue, violet, red, orange, teal or yellow on black.',
  ],
  keep: ['2:3 posters as the main visual', 'Status colours with a dot + label', 'Split add button', 'A single dark theme, as chosen: no light mode or toggle'],
  drop: ['Hero card with radial glow + four icon stat tiles (the generic dashboard template)', 'Rounded-2xl bordered + shadowed card on everything', 'System font only: the type has no voice'],
}

export interface Ref {
  img: string
  source: string
  url: string
  interesting: string
  adapt: string
  avoid: string
}

/** The board: seven sections, each a few genuine screenshots. The same screenshot may be read for different qualities. */
export const BOARD: { id: string; title: string; refs: Ref[] }[] = [
  {
    id: 'aesthetic',
    title: 'Overall aesthetic and personality',
    refs: [
      { img: 'a24', source: 'A24', url: 'https://a24films.com/films', interesting: 'White page split by thin vertical rules; giant grotesk "In theaters"; mono "NOW PLAYING" labels; outlined "BUY TICKETS".', adapt: 'Hairline column rules and mono labels as a quiet, confident system.', avoid: 'Copying the A24 grotesk wordmark look.' },
      { img: 'arena', source: 'Are.na', url: 'https://www.are.na/explore', interesting: 'Pure black, square blocks with 1px borders, almost no colour: content is the interface.', adapt: 'Restraint: let posters be the only colour.', avoid: 'So minimal it gives no sense of entertainment.' },
    ],
  },
  {
    id: 'colour',
    title: 'Colour',
    refs: [
      { img: 'kitsu', source: 'Kitsu', url: 'https://kitsu.app/explore/anime', interesting: 'Plum header (sampled #40303D) with coral-red links on light grey: warm, unusual in the category.', adapt: 'Warm, dusky darks instead of navy.', avoid: 'The plum bar itself; low-contrast grey canvas.' },
      { img: 'justwatch', source: 'JustWatch', url: 'https://www.justwatch.com/us', interesting: 'Interface nearly colourless (sampled #050E17); the posters supply all the colour.', adapt: 'Keep UI chroma low so a 200-poster library still looks calm.', avoid: 'Yellow-on-black (their signature).' },
      { img: 'trakt', source: 'Trakt', url: 'https://trakt.tv/', interesting: 'Violet radial glow on near-black (CTA sampled #8062E8).', adapt: 'Nothing: shown as the look to steer away from.', avoid: 'Violet glow + pill CTA: the generic AI landing page.' },
    ],
  },
  {
    id: 'type',
    title: 'Typography and hierarchy',
    refs: [
      { img: 'letterboxd', source: 'Letterboxd', url: 'https://letterboxd.com/film/past-lives/', interesting: 'Serif film title, with year and director set small beside it; spaced caps nav.', adapt: 'A display face for titles and the next-episode number; small caps for metadata.', avoid: 'Their exact serif/slate pairing.' },
      { img: 'mubi', source: 'MUBI', url: 'https://mubi.com/en/films', interesting: 'Credits-style captions: TITLE in bold caps, DIRECTOR YEAR in small caps, over the still.', adapt: 'Caption hierarchy on poster tiles and in Year in review.', avoid: 'All-caps body text.' },
      { img: 'criterion', source: 'Criterion Collection', url: 'https://www.criterion.com/shop/browse', interesting: 'Serif navigation, condensed caps page title, spine numbers as identity.', adapt: 'Numbering as a collector\'s device ("No. 017" for library entries, "E19" for episodes).', avoid: 'The C logo and spine design.' },
    ],
  },
  {
    id: 'layout',
    title: 'Layout and spacing',
    refs: [
      { img: 'myanimelist', source: 'MyAnimeList', url: 'https://myanimelist.net/topanime.php', interesting: 'Ranked rows with huge numerals in a fixed left column.', adapt: 'A fixed numeral column for the Continue list ("E19" at display size).', avoid: 'The ad-heavy chrome and tiny links.' },
      { img: 'anilist-title', source: 'AniList', url: 'https://anilist.co/anime/154587/Sousou-no-Frieren/', interesting: 'Banner + overlapping poster + synopsis; tabs below; rank chips in a side rail.', adapt: 'Already close to WatchTrack\'s title page; refine with stronger type.', avoid: 'Navy + sky blue.' },
      { img: 'appletv', source: 'Apple TV', url: 'https://tv.apple.com/', interesting: 'Neutral grey page (sampled #1F1F1F); poster shelves with rounded corners and a hairline edge; "Top 10" rows with huge numerals beside each poster.', adapt: 'Depth from lighter surfaces, not shadows; display-size numerals next to posters.', avoid: 'Apple\'s blue and the rank-numeral treatment as-is.' },
    ],
  },
  {
    id: 'components',
    title: 'Components and navigation',
    refs: [
      { img: 'simkl', source: 'Simkl', url: 'https://simkl.com/anime/', interesting: '"Today (17)", "Calendar", "Countdown" as navigation; new episodes grouped under a dated heading.', adapt: 'Day-grouped Upcoming; counts inside nav labels.', avoid: 'Two stacked nav bars with icon-over-label caps.' },
      { img: 'anilist', source: 'AniList (home)', url: 'https://anilist.co/', interesting: 'Light canvas with a dark rounded feature panel; "Browse Anime" as a two-part tinted heading.', adapt: 'Mixed light/dark panels can mark a special area (Year in review already does this).', avoid: 'Illustrated icon blobs.' },
    ],
  },
  {
    id: 'imagery',
    title: 'Imagery and artwork',
    refs: [
      { img: 'serializd', source: 'Serializd', url: 'https://www.serializd.com/', interesting: 'Real show still behind the hero, heavy vignette; a vertical caption naming the show and year.', adapt: 'A blurred backdrop from the title you are watching behind the home header.', avoid: 'Device mock-ups and icon circles.' },
      { img: 'crunchyroll', source: 'Crunchyroll', url: 'https://www.crunchyroll.com/', interesting: 'Wall of key art at an angle; heavy rounded display type.', adapt: 'Heavier display weight for anime-forward directions.', avoid: 'Tilted poster walls; orange.' },
      { img: 'plex', source: 'Plex', url: 'https://watch.plex.tv/', interesting: 'When artwork is missing, the tile shows the title as text on dark charcoal (sampled #1A181D). The header is a magenta-to-blue gradient (sampled #4B0C3B → #02238C).', adapt: 'A designed title-text placeholder for missing posters.', avoid: 'The magenta/blue gradient header: the generic glow look.' },
    ],
  },
  {
    id: 'motion',
    title: 'Interactions and micro-interactions',
    refs: [
      { img: 'justwatch', source: 'JustWatch', url: 'https://www.justwatch.com/us', interesting: 'Bookmark ribbon in each poster corner: one-tap save with no menu.', adapt: 'The existing one-tap "watched" check on poster hover is the same idea; make its feedback (number ticking forward) the signature motion.', avoid: 'Hover-only controls on touch screens.' },
      { img: 'letterboxd', source: 'Letterboxd', url: 'https://letterboxd.com/film/past-lives/', interesting: 'Ratings histogram next to the score: data at a glance, no chart chrome.', adapt: 'Small inline histograms for episodes-per-month and ratings.', avoid: 'Green stars (theirs).' },
    ],
  },
]

/** Three aesthetic territories explored before the concepts. */
export const TERRITORIES = [
  {
    name: 'Programme & archive',
    from: 'A24, MUBI, Criterion, Letterboxd',
    idea: 'Film-festival programmes, collector catalogues and credits typography. Type and rules do the work; colour comes from posters.',
    concepts: ['programme', 'spine', 'index'],
  },
  {
    name: 'Broadcast & schedule',
    from: 'Simkl, JustWatch, MyAnimeList',
    idea: 'TV guides, teletext and departure boards: the product is about what airs next, so time and numbers become the visual language.',
    concepts: ['broadcast', 'rewind'],
  },
  {
    name: 'Contemporary anime culture',
    from: 'Crunchyroll, AniList, Serializd',
    idea: 'Manga panels, poster key art and Japanese print: heavier type, ink outlines, painted dusk colour.',
    concepts: ['panel', 'dusk', 'pocket'],
  },
  {
    name: 'Cinema lobby',
    from: 'Letterboxd, Serializd, the current Espresso & Mint',
    idea: 'Warm, after-dark, a little vintage: the feeling of settling in for the next episode.',
    concepts: ['matinee', 'projection'],
  },
]

export const LANGUAGE = {
  words: ['Personal', 'Calm', 'Cinematic', 'Durable', 'Precise'],
  type: 'A display face with character for titles and episode numbers (serif or condensed), a highly legible text face for everything else, tabular figures everywhere numbers line up.',
  colour: 'One dark theme: a tinted near-black (never #000) with three lighter surface steps for depth, off-white text, one interaction colour, one rare highlight. Low chroma around posters. Avoid navy, violet and the competitors\' signature hues.',
  layout: 'Fewer boxes: hairlines and spacing instead of a bordered card around everything. One big number per card.',
  components: 'Flat cards, compact chips, split buttons, status as dot + label. Distinct focus ring.',
  images: 'Posters unframed with a corner tag; backdrops blurred behind headers only.',
  motion: 'Quick and physical: the episode number ticks forward when you mark it watched; nothing loops.',
  avoid: ['Purple/blue gradients and glows', 'Pill eyebrow badges', 'Four icon stat tiles', 'Glassmorphism over plain colour', 'Emoji-like illustration blobs'],
}
