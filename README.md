# WatchTrack

A private, offline-first tracker for anime, TV series and movies. Its one job: **always know the exact next episode to watch**, even after months away.

- No account, no database server. The only server code is stateless: a TMDB proxy (`api/tmdb.ts`), a Kitsu poster proxy so those images can be saved for offline use (`api/poster.ts`, which only allows `media.kitsu.app`), and the Google OAuth token exchange for optional Drive sync (`api/google-token.ts`).
- Visits are counted with cookie-free Vercel Web Analytics. `src/main.tsx` strips query strings, `#` fragments and title ids before anything is sent.
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
3. Optional, for TMDB (movies and extra TV results): add `TMDB_API_KEY` under **Settings → Environment Variables** (see `.env.example`). Without it the app still works with Kitsu and TVmaze.
   Optional, for Google Drive sync: add `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see **Google Drive sync** below).
4. Deploy.

`vercel.json` rewrites unknown paths to `index.html` so deep links like `/title/abc` work, stops the service worker file being cached, and sets security headers (Content-Security-Policy, nosniff, Referrer-Policy, Permissions-Policy). If you add a new provider host for API calls, it must be https; scripts may only load from the app itself.

## Public pages and SEO

Live at **https://watchtrack-eta.vercel.app**. If the domain changes, search the repo for `watchtrack-eta.vercel.app` (HTML heads, `public/robots.txt`, `public/sitemap.xml`, `src/components/Layout.tsx`).

- `/about`, `/privacy`, `/terms` and `/guides/*` are plain HTML pages (no JavaScript) built by Vite alongside the app, so any crawler can read them. They share `src/index.css`.
- Only `/` and those pages are indexable. App routes (`/library`, `/title/…`, `/settings`, `/shared`, unknown paths) get `noindex` from `PageMeta` in `Layout.tsx`, because they show this device's own data (empty for a crawler).
- Adding a guide: create `guides/<slug>.html` (copy an existing one), add it to `rollupOptions.input` in `vite.config.ts`, to `public/sitemap.xml`, and link it from `guides.html`.

## Using it


### Daily use
- **Home / Continue Watching**: each card shows the next episode with a one-tap **Watched** button. A toast confirms with **Undo**.
- **Change progress**: enter either the *last episode watched* or the *next episode to watch* (switchable per edit; default in Settings).
- **Specials / OVAs**: "Log special" adds them to history without moving your position.
- **Undo**: every progress or status change stores the previous state; undo from the toast, the title page, or the card menu.

### Sharing your watchlist
**Home → Share watchlist** (or **Library → Share**). Pick titles, then **Copy link** or **Share** (the phone's share sheet, falling back to copy). The friend opens `/shared#…` in any browser and sees a read-only list, with no account, app or import needed. Their own library is never touched.

- The list lives in the link itself (JSON → deflate-raw via the browser's `CompressionStream` → base64url, after the `#`), so nothing is uploaded and links never expire. Code: `src/lib/share.ts`.
- Included: title, type, status, season/episode progress, year, rating, online poster URL. Left out: notes, history, ids, dates, settings, keys, uploaded posters.
- Anyone with the link can read it. Fragments aren't encryption.
- Links are capped at 30,000 characters. If a selection is bigger, you're told to pick fewer titles. Nothing is silently dropped.

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
| Position unknown | Shows "episode not set" with a **Set episode** button; can't be marked watched until set. |
| Time passing | Never changes a status automatically. |

The logic lives in `src/lib/progress.ts` (pure functions) and is covered by `src/lib/progress.test.ts`.

## Your data: where it lives and how to keep it safe

- Data is in **this browser on this device**. Another browser, phone or computer has a separate copy. Installing the PWA doesn't change that.
- **Clearing site data / browsing data for this site deletes your library**, unless Google Drive sync is on. The app asks the browser for persistent storage, but that isn't a guarantee.
- **Google Drive sync** (Settings, optional) mirrors the library to the user's own Drive. See below.
- **Export backup** (Settings, the Dashboard reminder, and the Clear all data and Replace dialogs) saves the whole library as a JSON file: through the share sheet on phones that allow it (mainly iPhone), otherwise as a download.
- **Import backup file** validates the file, shows a preview with duplicates, and lets you **merge** (keep mine / use backup's / keep both) or **replace**. While Drive is connected, imported titles count as new edits and Replace records what it removed, so the next sync doesn't undo the restore.
- **Old transfer links** (`/transfer#…`) still open in the import preview, but can no longer be created: they couldn't hold big libraries. Code: `src/lib/transfer.ts`.

### Google Drive sync

- One file, `watchtrack-library.json`, in the user's Drive **appDataFolder** (hidden, only this app can read it). Scope `drive.appdata` is non-sensitive, so Google's app verification isn't needed. The developer has no access to it.
- **Safety copies:** before an upload overwrites the file, at most once a week, the old version is saved as `watchtrack-safety-YYYY-MM-DD.json` (newest 4 kept). Settings restores them through the import preview. A failed copy never blocks syncing.
- Sign-in is OAuth with PKCE via a plain redirect (no Google scripts, so the CSP is unchanged). `api/google-token.ts` adds the client secret and swaps the code or refresh token for an access token; it stores nothing. The refresh token is kept in the browser's localStorage.
- Each sync: download → merge (`src/lib/merge.ts`: newest `updatedAt` per title wins; history and posters are unions; deletions are tombstones kept 90 days) → write locally → upload if Drive was missing anything. Runs on open, on returning to the tab, when back online, and 5 s after an edit. Code: `src/lib/drive.ts`.
- **Setup (once):**
  1. Google Cloud Console → new project → enable **Google Drive API**.
  2. **OAuth consent screen**: External; app name, support email; add scope `.../auth/drive.appdata`; then **Publish app** (In production). Left in Testing, refresh tokens expire after 7 days and only test users can connect.
  3. **Credentials → Create OAuth client ID → Web application**. Authorized redirect URIs: `https://watchtrack-eta.vercel.app/settings` and `http://localhost:3000/settings` (for `vercel dev`).
  4. In Vercel, set `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then redeploy. Without them the Drive option is hidden.
- `npm run dev` doesn't run `/api` functions; use `vercel dev` to test sync locally.

### Backup file format (`version: 1`)

Also the format of the Drive file and its safety copies (plus a `deleted` list) and of old transfer links (without `images`).

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
| [Kitsu](https://kitsu.docs.apiary.io) | Anime (and anime movies) | None | Public JSON:API, CORS-enabled. |
| [TVmaze](https://www.tvmaze.com/api) | TV series, per-season episode counts | None | CORS-enabled; data is CC BY-SA, so a source link is shown on each title. |
| [TMDB](https://developer.themoviedb.org) | Movies + extra TV results | Server (`TMDB_API_KEY`) | Requests go through `/api/tmdb`, which adds the Read Access Token server-side, only allows the exact requests the app makes, and lets Vercel's CDN share answers between users. Add a per-IP rate limit on `/api/*` in the Vercel Firewall. Attribution is shown in Settings. |

No keys are bundled in the source. Kitsu and TVmaze are called straight from the browser; TMDB goes through the proxy so its key never reaches the client. Older versions stored a user-supplied TMDB key in localStorage; it is deleted automatically on first load. Rate-limit, offline and network errors show a message and leave the form usable. Poster images from these hosts are cached by the service worker so saved titles keep their artwork offline.

## Project structure

```
src/
  lib/            pure logic + storage (no React)
    types.ts        data model
    progress.ts     episode-tracking engine
    titles.ts       title factory + changes that produce history entries
    db.ts           IndexedDB (idb): schema, migrations, CRUD, quota errors
    backup.ts       export / validate / plan / apply import
    metadata.ts     Kitsu / TVmaze / TMDB clients
    prefs.ts        small UI preferences (localStorage)
  state/          React context for the library + action hooks (toasts, undo, confirmations)
  components/     UI building blocks (cards, modals, forms, filters)
  pages/          Dashboard, Library, Continue, Plan, On Hold, Completed, Title, Settings
```

IndexedDB stores: `titles`, `watchHistory`, `images` (Blobs), `settings` (reserved). Schema migrations go in the `upgrade()` callback in `db.ts`.

## Tests

`npm test` covers next-episode calculation, season advancement, unknown season counts, manual corrections, skipped episodes, completed movies, IndexedDB persistence, undo, export/import round trips (including images), duplicate handling, backup validation (including malformed and hostile files), and metadata response mapping.

## Decisions & defaults

- **Anime defaults to overall episode numbering**, TV to season + episode. Change it per title.
- **"Episodes logged"** on the dashboard counts episodes marked watched in the app; imported positions aren't counted as history.
- **Ratings are 1–10.**
- Status "Dropped" is available in addition to the requested lists.
