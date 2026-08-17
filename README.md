# MakerWorld Resale Tracker

Tracks trending 3D-printable models on MakerWorld and scores them for resale potential
(print → sell on Vinted / OLX in Romania). Next.js 15 App Router app, Supabase (Postgres)
for storage, deployed to Netlify. Scraping is on-demand from the dashboard, not scheduled —
there is no cron job or always-on process.

Three pages:

| Page | Route | What it's for |
|---|---|---|
| **Dashboard** | `/` | Ranked candidate table with filters, a "Scrape now" control, and a detail drawer (trend chart, tags, shortlist status: printed / listed / sold / sale price / notes). Your main working view. |
| **Swipe** | `/swipe` | Mobile, TikTok/Tinder-style feed — one candidate at a time, swipe or tap to like/skip. Meant to be used from a phone to quickly triage what the scraper found. |
| **Liked** | `/liked` | Grid of everything you liked in Swipe, with an "Export as JSON" button (client-side, no server round trip) for pulling the list into a spreadsheet or another tool. |

---

## Supabase setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** in the project dashboard, paste the full contents of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. It's idempotent
   (`create table if not exists` / `create or replace function`), so re-running it later is
   safe. This creates `models`, `snapshots`, `shortlist`, `scrape_runs`, `daily_summaries`,
   and two RPC functions (`upsert_models`, `collapse_old_snapshots`) the app calls directly.
3. Go to **Project Settings → API**. You need two values from there:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key (not the `anon` key) → `SUPABASE_SERVICE_ROLE_KEY`

> **Warning — the service_role key bypasses Row Level Security entirely.** Every table in
> `schema.sql` has RLS turned on with zero policies attached, which means the `anon` key can
> read and write *nothing*. The app only ever works because the server talks to Postgres with
> `SUPABASE_SERVICE_ROLE_KEY`, which ignores RLS by design. That key must **only** ever live in
> server-side environment variables:
> - Never prefix it `NEXT_PUBLIC_*` — anything with that prefix gets bundled into the
>   JavaScript the browser downloads, in plain text.
> - Never commit it to git (`.env.local` and `.env` are already in `.gitignore` for this
>   reason — see below).
> - Set it directly in Netlify's environment variable UI for deployment, never in a file that
>   ends up in the repo.

---

## Local dev

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` and fill in at minimum:

```bash
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Everything else in `.env.example` (scrape delay, retention window, scoring weights) has a
working default — only touch those if you want to tune behavior.

```bash
npm run dev      # dashboard on http://localhost:3000
```

The database starts empty — use the dashboard's **Scrape now** control (see "Using it" below)
to populate it, or run `npm run scrape` from the CLI for a one-off bulk backfill across every
target category.

If you have an old local SQLite database from before this app moved to Supabase
(`data/tracker.db`), migrate it over instead of starting from scratch:

```bash
npm run migrate:supabase
```

It's safe to re-run — everything is upserted by its natural key, and snapshot rows are
deduplicated by `(model_id, ts)` before insert.

---

## Using it

**Scraping (dashboard, on-demand).** Pick a category and a count in the Dashboard's controls,
click **Scrape now**. There's no server-side scheduler: the browser itself drives the process,
calling `POST /api/scrape` repeatedly with an advancing offset until it has collected `count`
items or the upstream category runs out. Each individual call is capped at 10 models server-side
and paced with a polite delay between separate calls — see "Known limits" for why it's built
this way. Progress shows live as "Scraping N of count…".

**Swipe feed.** `/swipe` serves your best-unliked candidates, best score first, one card at a
time. Swipe right (or the ♥ button, or → key) to like, left (✕ button, or ← key) to skip.
Skipped models aren't deleted or flagged in the database — they're just excluded from your
current browser session (via `sessionStorage`) so you don't see them again until you reload.
Liking a model sets `liked = true` / `liked_at = now()` on its row, which is what moves it into
`/liked` and removes it from the swipe queue for good.

**Liked / export.** `/liked` lists everything you've liked, newest first, with an **Export as
JSON** button. It builds the file client-side from data already on the page (name, image URL,
MakerWorld URL, category, downloads, likes, liked-at) and downloads it directly — no extra
server request.

**Reaching `/swipe` from your phone during local dev.** `npm run dev` binds to all network
interfaces, not just `localhost`, so it's reachable from another device on the same Wi-Fi:

1. Find your computer's LAN IP — on macOS: `ipconfig getifaddr en0` (or `en1` for Wi-Fi on
   some Macs), or System Settings → Wi-Fi → Details.
2. On your phone (same Wi-Fi network), visit `http://<that-ip>:3000/swipe`.
3. Some routers/firewalls block device-to-device traffic on the same network ("client
   isolation" / "AP isolation") — if the phone can't connect, that setting is the usual cause.

---

## Netlify deploy

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build settings (already set in `netlify.toml`, Netlify should pick them up automatically):
   - Build command: `npm run build`
   - Publish directory: `.next`
4. Under **Site configuration → Environment variables**, add:

   | Variable | Required | Value |
   |---|---|---|
   | `SUPABASE_URL` | yes | Project URL from Supabase → Project Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | yes | service_role secret key, same place — **never** as `NEXT_PUBLIC_*` |
   | `SCRAPE_DELAY_MIN_MS` / `SCRAPE_DELAY_MAX_MS` | optional | polite delay range between upstream requests, ms (default 2000 / 3000) |
   | `SCRAPE_CACHE_TTL_MS` | optional | in-process page cache window, ms (default 3600000 = 1h) |
   | `SCRAPE_MAX_PER_TARGET` | optional | models per target for CLI full-crawl `npm run scrape` (default 60) |
   | `RETENTION_RAW_DAYS` | optional | raw snapshot retention window, days (default 90) |
   | `SCORE_W_GROWTH`, `SCORE_W_ENGAGEMENT`, `SCORE_W_TRACTION`, `SCORE_W_CATEGORY`, `SCORE_W_QUICKPRINT` | optional | scoring weights (default 0.35 / 0.25 / 0.10 / 0.20 / 0.10) |
   | `SCORE_GROWTH_REF`, `SCORE_ENGAGEMENT_REF`, `SCORE_TRACTION_REF`, `SCORE_ENGAGEMENT_SMOOTH` | optional | scoring calibration constants (default 150 / 4 / 5000 / 25) |

5. Deploy. **Env var changes require a redeploy** to take effect — Netlify bakes them into the
   build/function bundle, it doesn't hot-reload them into a running site. Trigger a redeploy
   from the Netlify UI (or push a commit) after changing any of the above.

`netlify.toml` pins `NODE_VERSION = "22"` and declares `@netlify/plugin-nextjs` (the Next.js
Runtime) explicitly — Netlify's current build image auto-installs and auto-enables that plugin
for any Next.js site, so you don't need to add it to `package.json` yourself, but pinning it in
the toml keeps the behavior explicit and consistent between `netlify dev` and a real deploy.

---

## Scoring model

Computed live on every read (dashboard load, swipe feed, model detail) from each model's last
1–3 snapshots — nothing is precomputed or stored. All components are normalised to 0..1, then
weighted into a 0–100 score (`src/lib/scoring.ts`):

| Component | Weight | What it measures |
|---|---|---|
| `growth` | 0.35 | downloads/day between the oldest and newest of the last 3 snapshots, log-normalised (ref 150/day) |
| `engagement` | 0.25 | shrunk `likes / (downloads + 25)` ratio, log-scaled against a ref of 4.0 |
| `traction` | 0.10 | absolute downloads, log-normalised (ref 5000) |
| `categoryFit` | 0.20 | Earrings/Jewelry 1.0 · Decor 0.75 · Fashion 0.7 · Household/Home 0.55 · Hobby & DIY 0.45 · Trending 0.4 · anything else 0.35 |
| `quickPrint` | 0.10 | keyword heuristic for small, fast, low-filament prints (1.0 if flagged, 0 if not) |

Two calibration notes, both from live MakerWorld data (captured Aug 2026, re-verify if the
site's numbers drift — see below):

- **Likes routinely exceed downloads** on MakerWorld — people like from the feed without
  downloading. Observed ratio spread: p25 1.26 / p50 1.86 / p75 3.03 / p90 4.22. That's why
  `SCORE_ENGAGEMENT_REF` is 4, not ~0.25 as you'd naively expect from "likes ≤ downloads."
- The engagement ratio going into the score is **shrunk**, `likes / (downloads + 25)`, not the
  raw `likes / downloads` shown in the dashboard's "Engmt" column. Without the shrinkage, a
  model with 2 downloads and 14 likes (raw ratio 7.0) would outrank one with 510 downloads —
  pure noise from a tiny sample. Raise `SCORE_ENGAGEMENT_SMOOTH` to be harsher on low-volume
  models.

`quickPrint` is a keyword heuristic over name + category + tags: hits on *earring, pendant,
keychain, magnet, coaster, planter…* set it true; *helmet, cosplay, statue, shelf, life size…*
force it false. It's a nudge, not a gate.

A model with fewer than 2 snapshots (or a zero-width time window) has no growth history yet —
its growth term falls back to half its traction score instead of zeroing out, so it isn't
buried on first sight, but it still can't outrank something with proven momentum.

Every weight and reference constant is an env var (see `.env.example` and the Netlify deploy
table above); change one and reload the dashboard, or run `npm run score` for a quick
no-network CLI preview of the resulting ranking.

---

## Data retention

Raw snapshots are kept for **90 days** by default (`RETENTION_RAW_DAYS`). Older rows collapse
into `daily_summaries` — one row per model per UTC day, keeping the last observation of that day
and a count of how many raw samples it replaced. The actual collapse runs in Postgres via the
`collapse_old_snapshots` RPC (window functions aren't expressible through PostgREST's query
builder, so it's one round trip instead of pulling everything into JS). It's idempotent, so
running it with nothing new to collapse is a no-op.

- `npm run scrape` runs it automatically at the end of a CLI scrape cycle.
- `npm run retention` runs it standalone, any time, with no scraping involved.
- The on-demand dashboard scrape path (`POST /api/scrape`) does **not** run it — it's meant to
  stay fast per invocation (see "Known limits"). Run `npm run retention` yourself periodically
  (e.g. from your own machine, or any external scheduler you point at it) if you're relying
  entirely on dashboard scraping and never running `npm run scrape`.

---

## Known limits / gotchas

- **Serverless function timeout vs. scrape batch size.** Netlify Functions default to a 10s
  execution limit on the free tier (26s max on paid tiers). `POST /api/scrape`
  (`src/app/api/scrape/route.ts`) caps each invocation at 10 models, and because MakerWorld's
  API returns up to 20 hits per request, a 10-item batch is fetched in a **single** upstream
  call — there's no 2-3s inter-request delay *within* one invocation (that delay only paces the
  *sequence* of separate POSTs the client fires, handled client-side in `ScrapeControls.tsx`,
  since a stateless function can't remember pacing between invocations). So one POST is
  typically: an in-process robots.txt fetch (skipped once cached, but repeated on every cold
  start since the cache is just a module-level variable) + one MakerWorld API call + one
  Supabase RPC (`upsert_models`) + one Supabase insert (`snapshots`) — a handful of round trips,
  comfortably under 10s in the common case. It is **not hard-guaranteed**: a slow MakerWorld
  response, a distant Supabase region, or Next.js cold-start overhead stacked on top of the
  above could push a single invocation close to the limit, especially the first call after a
  cold start. If you see intermittent 504s from `/api/scrape` on Netlify, this is the first
  place to look — lowering the per-click "count" (which doesn't change the per-call cap, but
  reduces how many chained calls a session makes) won't help; what would help is upgrading the
  Netlify plan for a higher function timeout, or reducing `BATCH_CAP` in the route itself
  (route code is out of scope for this pass — see the report below).
- **Supabase free tier limits.** Free projects pause after a week of inactivity (auto-resume on
  next request, but that first request will be slow) and cap storage/bandwidth/monthly active
  compute. Fine for a personal tracker; watch it if scraping volume grows a lot.
- **MakerWorld's API is unofficial.** `src/lib/scraper.ts` calls
  `/api/v1/search-service/select/design2`, MakerWorld's own front-end endpoint, verified live
  but not documented anywhere public — it can change without notice. Re-verify with
  `npm run probe:categories` (current category ids) and `npm run inspect -- <url>` (dumps a
  page's real API traffic to `tmp-inspect/`) if scraping starts returning empty results or
  errors. Both of those need `npx playwright install chromium` run once locally first —
  Playwright is a devDependency used only by these recon scripts, never at runtime.
- **No authentication.** Anyone with the deployed URL can view the dashboard, scrape on your
  Supabase quota, and like/unlike models — there's no login anywhere in this app. Treat the
  Netlify URL as semi-private (don't post it publicly), or turn on Netlify's built-in
  password/visitor-access protection (Site configuration → Visitor access) if you want a real
  gate in front of it.

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dashboard in dev mode, http://localhost:3000 |
| `npm run build` | Production build |
| `npm run start` | Serve the production build (run `build` first) |
| `npm run lint` | `next lint` |
| `npm run scrape` | One full CLI scrape cycle across every target category, then runs the retention pass |
| `npm run score` | Print the current ranked candidate list, scored live from stored snapshots — no network calls |
| `npm run retention` | Collapse snapshots older than `RETENTION_RAW_DAYS` into `daily_summaries`, standalone |
| `npm run inspect -- <url>` | Recon: load a MakerWorld page in headless Chromium, dump its DOM + real API traffic to `tmp-inspect/` |
| `npm run db:apply` | Apply `supabase/schema.sql` straight to Postgres over the session pooler. Needs `SUPABASE_DB_URL`. Idempotent |
| `npm run db:init` | Print `supabase/schema.sql` to the console, for pasting into the Supabase SQL Editor by hand |
| `npm run migrate:supabase` | One-off: copy an old local `data/tracker.db` (SQLite) into Supabase. Safe to re-run |
| `npm run probe:categories` | Recon: dump MakerWorld's current category ids + labels from its nav |
| `npm run probe:api -- <path...>` | Recon: hit one or more API paths from inside a real browser session, print status + body |

---

## Scope

Personal tracking tool. It stores numeric stats and thumbnail URLs for reference only — no
model files, no descriptions, no re-hosted images, nothing redistributed. Scraping is on-demand
and rate-limited (2-3s between upstream requests, robots.txt fetched and enforced before every
batch), so keep click-driven scrape counts reasonable rather than hammering "Scrape now"
repeatedly back to back.
