# WatchTrack

A private, offline-first tracker for anime, TV series and movies. Its one job: **always know the exact next episode to watch**, even after months away.

- No account, no backend, no database server, no analytics.
- Everything is stored in your browser (IndexedDB) on the device you use.
- Installable as an app (PWA) and works offline once loaded.

Built with React 19, TypeScript (strict), Vite, Tailwind CSS v4, `idb`, Framer Motion, Lucide and Sonner (toasts).

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Type check + production build to `dist/` (includes the service worker) |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit + persistence tests (Vitest, fake IndexedDB) |
| `npm run lint` | Oxlint |
| `npm run check` | Lint, type check, tests and build in one go |

Requires Node 20+.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project →** import the repo. It detects Vite automatically (build `npm run build`, output `dist`).
3. Deploy. No environment variables are needed.

`vercel.json` rewrites unknown paths to `index.html` so deep links like `/title/abc` work, and stops the service worker file being cached.

## Using it

### Moving over from your Notes app
**Settings → Import from notes** (or `/import`). Paste your list, or tap **Load my starter list** to use the list you shared. Every line becomes an editable row:

- Headings set type and status (`### Anime — Completed`, `### TV Series…`).
- `Black Clover | 172` → overall episode 172 was the last watched, so **173 is next**. Flagged for a quick check.
- `Helluva Boss | S2/E8` → last watched S2E8, so **S2E9 is next**.
- `Demon Slayer | S4` → season 4 with the episode **not set** (flagged). Fill it in now or later.
- `Family Guy | Watched episodes 10–20; skipped episodes 2–9` → next is 21, skipped range saved.
- Anything unreadable is kept in the title's notes. The original line is always stored on the title.
- Titles already in your library are unticked by default. Nothing is written until you confirm.

### Daily use
- **Home / Continue Watching**: each card shows the next episode with a one-tap **Watched** button. A toast confirms with **Undo**.
- **Change progress**: enter either the *last episode watched* or the *next episode to watch* (switchable per edit; default in Settings).
- **Specials / OVAs**: "Log special" adds them to history without moving your position.
- **Undo**: every progress or status change stores the previous state; undo from the toast, the title page, or the card menu.

## Episode tracking rules

Position is stored once, as `season` + `nextEpisode`. "Last watched" is always derived from it, so the two can't drift apart.

| Situation | Behaviour |
| --- | --- |
| Overall numbering (Black Clover) | Track one running episode number; season is ignored. |
| Seasonal numbering (Spy x Family) | Season + episode. Switchable per title. |
| Mark watched, season count unknown | Just advances to the next episode. |
| Season finished, next season known (total seasons or its episode count) | Moves to the next season's first unskipped episode. |
| Season finished, next season **unknown** | Stops at "Finished season N" and offers **Start season N+1** or **Mark completed**. Never assumes another season exists. |
| Last known episode of the series | Asks whether to mark the title completed. |
| Skipped ranges | Skipped when advancing and when working out "last watched". Ranges are per season. |
| Position unknown (imported "S4") | Shows "episode not set" with a **Set episode** button; can't be marked watched until set. |
| Time passing | Never changes a status automatically. |

The logic lives in `src/lib/progress.ts` (pure functions) and is covered by `src/lib/progress.test.ts`.

## Your data: where it lives and how to keep it safe

- Data is in **this browser on this device only**. Another browser, phone or computer has a separate, empty copy. Installing the PWA doesn't change that.
- **Clearing site data / browsing data for this site deletes your library.** The app asks the browser for persistent storage, but that isn't a guarantee.
- **Export backup** (Settings) downloads everything as one JSON file. **Import backup** validates it, shows a preview with duplicates, and lets you **merge** (keep mine / use backup's / keep both) or **replace**. Replacing asks for confirmation.
- Use backups to move your library between devices.

### Backup file format (`version: 1`)

```jsonc
{
  "format": "watchtrack-backup",
  "version": 1,
  "exportedAt": "2026-10-21T12:00:00.000Z",
  "titles": [ /* Title records, see src/lib/types.ts */ ],
  "history": [ /* timestamped watch-history entries */ ],
  "images": [ { "id": "…", "type": "image/png", "createdAt": "…", "data": "<base64>" } ]
}
```

Uploaded posters are included as base64. Posters fetched from a metadata provider are stored as local copies when the provider allows it, otherwise as URLs.

## Artwork and metadata (optional)

Search is only used to fill in title details and posters. Only the search text is sent; progress never leaves the device. Manual entry and uploading a poster from your device always work, including offline.

| Provider | Used for | Key | Notes |
| --- | --- | --- | --- |
| [AniList](https://docs.anilist.co) | Anime (and anime movies) | None | Public GraphQL API. Rate limited (normally 90/min, currently 30/min). |
| [TVmaze](https://www.tvmaze.com/api) | TV series, per-season episode counts | None | CORS-enabled; data is CC BY-SA, so a source link is shown on each title. |
| [TMDB](https://developer.themoviedb.org) | Movies + extra TV results | **Your own** | Paste a free v3 API key or read-access token in Settings. Stored only in this browser. Attribution is shown in Settings. |

No keys are bundled in the source, and requests go straight from the browser to the provider (no proxy). Rate-limit, offline and network errors show a message and leave the form usable. Poster images from these hosts are cached by the service worker so saved titles keep their artwork offline.

## Project structure

```
src/
  lib/            pure logic + storage (no React)
    types.ts        data model
    progress.ts     episode-tracking engine
    titles.ts       title factory + changes that produce history entries
    db.ts           IndexedDB (idb): schema, migrations, CRUD, quota errors
    backup.ts       export / validate / plan / apply import
    notesImport.ts  Notes-list parser for the import wizard
    metadata.ts     AniList / TVmaze / TMDB clients
    prefs.ts        small UI preferences (localStorage)
  state/          React context for the library + action hooks (toasts, undo, confirmations)
  components/     UI building blocks (cards, modals, forms, filters)
  pages/          Dashboard, Library, Continue, Plan, On Hold, Completed, Title, Settings, Import
```

IndexedDB stores: `titles`, `watchHistory`, `images` (Blobs), `settings` (reserved). Schema migrations go in the `upgrade()` callback in `db.ts`.

## Tests

`npm test` runs 44 tests covering next-episode calculation, season advancement, unknown season counts, manual corrections, skipped episodes, completed movies, IndexedDB persistence, undo, export/import round trips (including images), duplicate handling, backup validation, the notes parser against the real starter list, and metadata response mapping.

## Decisions & defaults

- **Anime defaults to overall episode numbering**, TV to season + episode. Change it per title.
- **Bare numbers in imported notes mean "last watched"** (so `172` → 173 next), and are flagged so you can confirm.
- **"Episodes logged"** on the dashboard counts episodes marked watched in the app; imported positions aren't counted as history.
- **Ratings are 1–10.**
- Status "Dropped" is available in addition to the requested lists.
