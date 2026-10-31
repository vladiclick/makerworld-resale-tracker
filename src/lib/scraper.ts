import { getSupabase } from './supabase';
import { SCRAPE, SELLABLE_LICENSES, TARGETS, type Target } from './config';
import { isAllowed, loadRobots } from './robots';

/**
 * MakerWorld's HTML pages sit behind bot protection, but its own front end
 * calls a plain JSON API that is NOT behind that protection — verified live:
 * a bare Node `fetch` with browser-like headers (no cookies, no session,
 * no Chromium) gets a 200 with real data.
 *
 *   GET /api/v1/search-service/select/design2
 *     ?categories=<numeric category id, empty = all>
 *     &orderBy=hotScore        (what the UI labels "Trending"/"Popular")
 *     &designCreateSince=<days, 0 = all time>
 *     &limit=20&offset=<n>&designType=0
 *
 * This means the scraper needs no headless browser at all, which matters
 * because the app deploys to Netlify Functions, where Chromium can't run.
 * Playwright is kept only as a devDependency for the one-off recon scripts
 * under scripts/ (inspect-dom.ts, probe-api.ts, probe-categories.ts) — it is
 * never imported from anywhere under src/**.
 */

const ORIGIN = 'https://makerworld.com';
const API = '/api/v1/search-service/select/design2';

export type ScrapedModel = {
  id: string;
  name: string;
  creator: string | null;
  url: string;
  thumbnailUrl: string | null;
  downloads: number | null;
  likes: number | null;
  category: string;
  source: string;
  tags: string[];
  createdAt: string | null;
  license: string | null;
};

type ApiHit = {
  id: number;
  title: string;
  slug?: string;
  cover?: string;
  likeCount?: number;
  downloadCount?: number;
  collectionCount?: number;
  designCreator?: { name?: string };
  tags?: string[];
  createTime?: string;
  license?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const politeDelay = () =>
  sleep(SCRAPE.delayMinMs + Math.random() * Math.max(0, SCRAPE.delayMaxMs - SCRAPE.delayMinMs));

function buildApiUrl(target: Target, offset: number, limit = 20): string {
  const p = new URLSearchParams({
    categories: target.categoryId ?? '',
    orderBy: target.orderBy ?? 'hotScore',
    designCreateSince: String(target.createdSinceDays ?? 0),
    limit: String(limit),
    offset: String(offset),
    designType: '0',
  });
  // Ask MakerWorld for sellable licences only - see SELLABLE_LICENSES.
  if (SELLABLE_LICENSES) p.set('licenses', SELLABLE_LICENSES);
  return `${API}?${p.toString()}`;
}

function normalize(hit: ApiHit, target: Target): ScrapedModel | null {
  if (!hit?.id || !hit.title) return null;
  const slug = hit.slug ? `-${hit.slug}` : '';
  return {
    id: String(hit.id),
    name: hit.title,
    creator: hit.designCreator?.name ?? null,
    url: `${ORIGIN}/en/models/${hit.id}${slug}`,
    thumbnailUrl: hit.cover ?? null, // reference URL only - images are never re-hosted
    downloads: typeof hit.downloadCount === 'number' ? hit.downloadCount : null,
    likes: typeof hit.likeCount === 'number' ? hit.likeCount : null,
    category: target.label,
    source: target.label,
    tags: Array.isArray(hit.tags) ? hit.tags.slice(0, 30) : [],
    createdAt: hit.createTime ?? null,
    // Decides whether this model can legally be sold - see src/lib/license.ts
    license: hit.license ?? null,
  };
}

/**
 * Page-level cache, keyed on the API path (no session ids in it, so it's a
 * stable key). Purely an in-process optimization — the Supabase schema has
 * no `page_cache` table on purpose (cache isn't data worth keeping in
 * Postgres). It dedupes repeat fetches within one running process (e.g. two
 * scrape batches inside the TTL), but resets on every new process, which on
 * Netlify Functions can be every invocation. Fine: it's a nice-to-have, not
 * something correctness depends on.
 */
const pageCache = new Map<string, { fetchedAt: number; payload: ScrapedModel[] }>();

function readCache(url: string): ScrapedModel[] | null {
  const entry = pageCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > SCRAPE.cacheTtlMs) return null;
  return entry.payload;
}

function writeCache(url: string, models: ScrapedModel[]) {
  pageCache.set(url, { fetchedAt: Date.now(), payload: models });
}

const FETCH_HEADERS = {
  accept: 'application/json',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': SCRAPE.userAgent,
  referer: `${ORIGIN}/en/3d-models`,
};

// One page of the MakerWorld search API; only `hits` is read.
type SearchPage = { hits?: unknown };

async function fetchJson(path: string): Promise<SearchPage | null> {
  const res = await fetch(ORIGIN + path, { headers: FETCH_HEADERS });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for ${path}: ${text.slice(0, 200)}`);
  }
}

async function fetchRobotsText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': SCRAPE.userAgent } });
  return res.text();
}

export type RunStats = {
  runId: number;
  modelsSeen: number;
  pagesHit: number;
  pagesCached: number;
  perTarget: Record<string, number>;
  errors: string[];
};

/**
 * Full-crawl mode: walk every target up to SCRAPE.maxModelsPerTarget models
 * each. Used by the CLI (`npm run scrape`) for manual bulk backfills. The
 * dashboard's on-demand UI does NOT use this — it uses scrapeBatch() below,
 * which fetches a caller-chosen count for a single category.
 */
export async function runScrape(targets: Target[] = TARGETS): Promise<RunStats> {
  const supabase = getSupabase();
  const startedAtIso = new Date().toISOString();
  const { data: runRow, error: runInsertError } = await supabase
    .from('scrape_runs')
    .insert({ started_at: startedAtIso })
    .select('id')
    .single();
  if (runInsertError) throw runInsertError;
  const runId = Number(runRow.id);

  const stats: RunStats = {
    runId,
    modelsSeen: 0,
    pagesHit: 0,
    pagesCached: 0,
    perTarget: {},
    errors: [],
  };

  try {
    const rules = await loadRobots(fetchRobotsText);

    for (const target of targets) {
      let kept = 0;
      for (let offset = 0; kept < SCRAPE.maxModelsPerTarget; offset += 20) {
        const path = buildApiUrl(target, offset);
        const absolute = ORIGIN + path;

        if (!isAllowed(rules, absolute)) {
          stats.errors.push(`robots.txt disallows ${path}`);
          break;
        }

        let models = readCache(path);
        if (models) {
          stats.pagesCached++;
        } else {
          await politeDelay();
          let json: SearchPage | null;
          try {
            json = await fetchJson(path);
          } catch (e) {
            stats.errors.push(`${target.label} offset=${offset}: ${(e as Error).message}`);
            break;
          }
          stats.pagesHit++;
          const hits: ApiHit[] = Array.isArray(json?.hits) ? (json.hits as ApiHit[]) : [];
          models = hits.map((h) => normalize(h, target)).filter(Boolean) as ScrapedModel[];
          writeCache(path, models);
          if (hits.length === 0) break;
        }

        if (models.length === 0) break;
        await persist(models);
        kept += models.length;
        stats.modelsSeen += models.length;
      }
      stats.perTarget[target.label] = kept;
    }

    const { error: finishError } = await supabase
      .from('scrape_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: stats.errors.length ? 'partial' : 'ok',
        models_seen: stats.modelsSeen,
        error: stats.errors.length ? stats.errors.join(' | ').slice(0, 2000) : null,
      })
      .eq('id', runId);
    if (finishError) throw finishError;
    return stats;
  } catch (e) {
    await supabase
      .from('scrape_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'error',
        error: String((e as Error).message).slice(0, 2000),
      })
      .eq('id', runId);
    throw e;
  }
}

/**
 * On-demand batch: fetch exactly `limit` models of one category starting at
 * `offset`, upsert + snapshot them, and return. This is what the dashboard's
 * "Scrape now" control drives (via POST /api/scrape).
 *
 * MakerWorld's API caps out at 20 hits per request, so if `limit` is bigger
 * than that this loops internally, paging offset by 20 each time with the
 * same polite delay used elsewhere, until `limit` is met or upstream runs
 * out of results.
 */
export async function scrapeBatch(opts: {
  categoryLabel: string;
  limit: number;
  offset: number;
}): Promise<{ scraped: number; models: ScrapedModel[]; done: boolean }> {
  const target = TARGETS.find((t) => t.label === opts.categoryLabel);
  if (!target) {
    throw new Error(
      `Unknown category "${opts.categoryLabel}". Known categories: ${TARGETS.map((t) => t.label).join(', ')}`
    );
  }

  const rules = await loadRobots(fetchRobotsText);

  const collected: ScrapedModel[] = [];
  let offset = opts.offset;
  let done = false;

  while (collected.length < opts.limit) {
    const pageLimit = Math.min(20, opts.limit - collected.length);
    const path = buildApiUrl(target, offset, pageLimit);
    const absolute = ORIGIN + path;

    if (!isAllowed(rules, absolute)) {
      throw new Error(`robots.txt disallows ${path}`);
    }

    // No delay before the first upstream request of a batch (a single
    // on-demand click shouldn't feel artificially slow); delay only between
    // *additional* requests this same call has to make internally.
    if (collected.length > 0) await politeDelay();

    let models = readCache(path);
    let hitCount: number;
    if (models) {
      hitCount = models.length;
    } else {
      const json = await fetchJson(path);
      const hits: ApiHit[] = Array.isArray(json?.hits) ? (json.hits as ApiHit[]) : [];
      hitCount = hits.length;
      models = hits.map((h) => normalize(h, target)).filter(Boolean) as ScrapedModel[];
      writeCache(path, models);
    }

    collected.push(...models);
    offset += pageLimit;

    if (hitCount < pageLimit) {
      done = true;
      break;
    }
  }

  await persist(collected);
  await logRun(target.label, collected.length);
  return { scraped: collected.length, models: collected, done };
}

/**
 * Record the batch in scrape_runs so the dashboard's "last scrape" pill has
 * something to show. On-demand scraping has no long-lived run to open and
 * close, so each batch is written as one already-finished row. Failing to log
 * must never fail the scrape itself - the data is already persisted by now.
 */
async function logRun(category: string, modelsSeen: number) {
  try {
    const now = new Date().toISOString();
    await getSupabase()
      .from('scrape_runs')
      .insert({
        started_at: now,
        finished_at: now,
        status: 'ok',
        models_seen: modelsSeen,
        category,
      });
  } catch (e) {
    console.warn('[scrape] could not write scrape_runs row:', (e as Error).message);
  }
}

/**
 * Upsert model metadata (via the upsert_models RPC, one round trip for the
 * whole batch) and append one snapshots row per model. Never touches
 * `category`, `first_seen_at`, `liked` or `liked_at` on an existing model —
 * see the comment on upsert_models() in supabase/schema.sql.
 */
export async function persist(models: ScrapedModel[]): Promise<void> {
  if (models.length === 0) return;
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();

  const payload = models.map((m) => ({
    makerworld_id: m.id,
    name: m.name,
    creator: m.creator,
    url: m.url,
    thumbnail_url: m.thumbnailUrl,
    category: m.category,
    tags: m.tags,
    downloads: m.downloads,
    likes: m.likes,
    license: m.license,
  }));

  const { data: upserted, error: upsertError } = await supabase.rpc('upsert_models', { payload });
  if (upsertError) throw upsertError;

  const internalIdByMakerworldId = new Map<string, number | string>();
  for (const row of (upserted ?? []) as { id: number | string; makerworld_id: string }[]) {
    internalIdByMakerworldId.set(row.makerworld_id, row.id);
  }

  const snapshotRows = models
    .map((m) => {
      const internalId = internalIdByMakerworldId.get(m.id);
      if (internalId == null) return null;
      return { model_id: internalId, ts: nowIso, downloads: m.downloads, likes: m.likes };
    })
    .filter((row): row is { model_id: number | string; ts: string; downloads: number | null; likes: number | null } => row !== null);

  if (snapshotRows.length > 0) {
    const { error: snapError } = await supabase.from('snapshots').insert(snapshotRows);
    if (snapError) throw snapError;
  }
}

/**
 * One full cycle: scrape every target. Scores are no longer persisted —
 * they're computed live on read by src/lib/queries.ts — so this is now just
 * a thin, stable-name wrapper around runScrape() for callers that import it.
 */
export async function runCycle(targets: Target[] = TARGETS): Promise<RunStats> {
  return runScrape(targets);
}
