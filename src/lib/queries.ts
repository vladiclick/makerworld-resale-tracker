import { getSupabase } from './supabase';
import { scoreModel, type SnapshotRow } from './scoring';
import { isSellable, licenseInfo, type Sellable } from './license';

export type Candidate = {
  id: string;
  name: string;
  creator: string | null;
  url: string;
  thumbnailUrl: string | null;
  category: string | null;
  score: number;
  engagementRatio: number;
  growthPerDay: number;
  downloads: number;
  likes: number;
  quickPrint: boolean;
  computedAt: number;
  windowGrowth: number | null; // downloads gained inside the selected time window
  shortlisted: boolean;
  lastSeenAt: number;
  license: string | null;
  sellable: Sellable;
  licenseNote: string;
};

export type CandidateFilters = {
  category?: string;
  minEngagement?: number;
  windowHours?: number; // 24 / 168 / 720
  shortlistedOnly?: boolean;
  quickPrintOnly?: boolean;
  /** Hide models whose licence forbids selling prints. Defaults to true. */
  sellableOnly?: boolean;
  limit?: number;
  search?: string;
};

// ---------------------------------------------------------------------------
// Internal row shapes as they come back from PostgREST. Note: Postgres
// `bigint` columns (models.id, snapshots.model_id) are serialised as JSON
// strings by PostgREST to avoid precision loss, so we treat internal ids as
// string|number throughout and always normalise with String() before using
// them as Map keys.
// ---------------------------------------------------------------------------

type ModelRow = {
  id: number | string;
  makerworld_id: string;
  name: string;
  creator: string | null;
  url: string;
  thumbnail_url: string | null;
  category: string | null;
  tags: string[] | null;
  downloads: number | null;
  likes: number | null;
  license?: string | null;
  first_seen_at: string;
  last_scraped_at: string;
};

type HistoryRow = {
  model_id: number | string;
  ts: string;
  downloads: number | null;
  likes: number | null;
};

type HistPoint = { ts: number; downloads: number | null; likes: number | null; source: 'snapshot' | 'daily' };

/**
 * Fetch full history (snapshots + collapsed daily_summaries) for a set of
 * internal model ids in exactly two queries, then group/sort in JS. This is
 * the thing that keeps getCandidates() from issuing one query per model.
 */
async function fetchHistoryByModel(
  modelIds: (string | number)[]
): Promise<Map<string, HistPoint[]>> {
  const map = new Map<string, HistPoint[]>();
  if (modelIds.length === 0) return map;
  const supabase = getSupabase();

  /**
   * Two caps to respect at once:
   *  - PostgREST returns at most 1000 rows per request, silently. With a few
   *    thousand snapshots that meant most models came back with NO history,
   *    so every growth number quietly collapsed to zero.
   *  - a huge .in(...) list blows the URL length limit.
   * So: chunk the ids, and page each chunk until it returns a short page.
   */
  const ID_CHUNK = 200;
  const PAGE = 1000;

  const fetchAll = async (table: 'snapshots' | 'daily_summaries') => {
    const rows: HistoryRow[] = [];
    for (let i = 0; i < modelIds.length; i += ID_CHUNK) {
      const ids = modelIds.slice(i, i + ID_CHUNK);
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from(table)
          .select('model_id, ts, downloads, likes')
          .in('model_id', ids)
          .order('ts', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as HistoryRow[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
    }
    return rows;
  };

  const [snapRows, dayRows] = await Promise.all([
    fetchAll('snapshots'),
    fetchAll('daily_summaries'),
  ]);
  const snapsRes = { data: snapRows, error: null as null | Error };
  const daysRes = { data: dayRows, error: null as null | Error };
  if (snapsRes.error) throw snapsRes.error;
  if (daysRes.error) throw daysRes.error;

  const push = (row: HistoryRow, source: 'snapshot' | 'daily') => {
    const key = String(row.model_id);
    const point: HistPoint = { ts: new Date(row.ts).getTime(), downloads: row.downloads, likes: row.likes, source };
    const arr = map.get(key);
    if (arr) arr.push(point);
    else map.set(key, [point]);
  };
  for (const row of (snapsRes.data ?? []) as HistoryRow[]) push(row, 'snapshot');
  for (const row of (daysRes.data ?? []) as HistoryRow[]) push(row, 'daily');

  for (const arr of map.values()) arr.sort((a, b) => b.ts - a.ts); // newest first
  return map;
}

/** Downloads gained between the earliest observation inside [since, now] and the latest observation overall. */
function windowGrowthFor(historyDesc: HistPoint[], since: number): number | null {
  if (historyDesc.length === 0) return null;
  const latest = historyDesc[0];
  const inWindow = historyDesc.filter((h) => h.ts >= since);
  if (inWindow.length === 0) return null;
  const baseline = inWindow[inWindow.length - 1]; // oldest point still inside the window
  if (!baseline || baseline.ts >= latest.ts) return null;
  if (latest.downloads == null || baseline.downloads == null) return null;
  return latest.downloads - baseline.downloads;
}

async function fetchShortlistedIds(modelIds: (string | number)[]): Promise<Set<string>> {
  if (modelIds.length === 0) return new Set();
  const supabase = getSupabase();
  // Deliberately NOT filtered by modelIds: passing thousands of ids into an
  // .in() blows PostgREST's URL length limit and comes back as a bare
  // "Bad Request". The shortlist is a hand-curated table of tens of rows, so
  // fetching all of it and intersecting in JS is both simpler and cheaper.
  const { data, error } = await supabase.from('shortlist').select('model_id').limit(1000);
  if (error) throw error;
  return new Set((data ?? []).map((r: { model_id: number | string }) => String(r.model_id)));
}

/** Ranked candidate list, scored live from the most recent snapshots. */
export async function getCandidates(f: CandidateFilters = {}): Promise<Candidate[]> {
  const supabase = getSupabase();
  const limit = Math.min(f.limit ?? 100, 500);
  const windowHours = f.windowHours ?? 168;
  const since = Date.now() - windowHours * 3600_000;

  // PostgREST caps every select at 1000 rows. Past that the cap is silent: you
  // get an arbitrary 1000 models and score those, so whole categories vanish
  // from the ranking. Page explicitly instead.
  const PAGE = 1000;
  const MAX_MODELS = Number(process.env.SCORE_MAX_MODELS ?? 5000);
  let modelRows: ModelRow[] = [];
  for (let from = 0; from < MAX_MODELS; from += PAGE) {
    let query = supabase
      .from('models')
      .select(
        'id, makerworld_id, name, creator, url, thumbnail_url, category, tags, downloads, likes, license, first_seen_at, last_scraped_at'
      )
      .gte('last_scraped_at', new Date(since).toISOString())
      .order('last_scraped_at', { ascending: false })
      .range(from, from + PAGE - 1);

    if (f.category) query = query.eq('category', f.category);

    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as ModelRow[];
    modelRows = modelRows.concat(batch);
    if (batch.length < PAGE) break;
  }
  if (modelRows.length === 0) return [];

  // Free-text search on name/creator done in JS (avoids escaping user input
  // into a PostgREST .or() filter string).
  if (f.search) {
    const needle = f.search.toLowerCase();
    modelRows = modelRows.filter(
      (m) => m.name.toLowerCase().includes(needle) || (m.creator ?? '').toLowerCase().includes(needle)
    );
  }
  if (modelRows.length === 0) return [];

  const modelIds = modelRows.map((m) => m.id);
  const [historyByModel, shortlistIds] = await Promise.all([
    fetchHistoryByModel(modelIds),
    fetchShortlistedIds(modelIds),
  ]);

  const computedAt = Date.now();
  const candidates: Candidate[] = [];
  for (const m of modelRows) {
    const history = historyByModel.get(String(m.id)) ?? [];
    const snaps: SnapshotRow[] = history.slice(0, 3);
    const b = scoreModel(snaps, { name: m.name, category: m.category, tags: m.tags ?? [] });
    const shortlisted = shortlistIds.has(String(m.id));

    if (typeof f.minEngagement === 'number' && f.minEngagement > 0 && b.engagementRatio < f.minEngagement) continue;
    if (f.quickPrintOnly && !b.quickPrint) continue;
    // Default ON: a model you can't legally sell is not a candidate.
    if (f.sellableOnly !== false && !isSellable(m.license)) continue;
    if (f.shortlistedOnly && !shortlisted) continue;

    candidates.push({
      id: m.makerworld_id,
      name: m.name,
      creator: m.creator,
      url: m.url,
      thumbnailUrl: m.thumbnail_url,
      category: m.category,
      score: b.score,
      engagementRatio: b.engagementRatio,
      growthPerDay: b.growthPerDay,
      downloads: b.downloads,
      likes: b.likes,
      quickPrint: b.quickPrint,
      computedAt,
      windowGrowth: windowGrowthFor(history, since),
      shortlisted,
      lastSeenAt: new Date(m.last_scraped_at).getTime(),
      license: m.license ?? null,
      sellable: licenseInfo(m.license).sellable,
      licenseNote: licenseInfo(m.license).note,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

export async function getCategories(): Promise<string[]> {
  const supabase = getSupabase();
  // Same 1000-row cap applies here: without paging, whole categories were
  // missing from the dashboard's filter dropdown.
  const set = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await supabase
      .from('models')
      .select('category')
      .not('category', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as { category: string | null }[];
    for (const row of batch) if (row.category) set.add(row.category);
    if (batch.length < PAGE) break;
  }
  return Array.from(set).sort();
}

export async function getModelDetail(id: string, windowHours = 720) {
  const supabase = getSupabase();
  const { data: model, error } = await supabase
    .from('models')
    .select('*')
    .eq('makerworld_id', id)
    .maybeSingle();
  if (error) throw error;
  if (!model) return null;

  const historyByModel = await fetchHistoryByModel([model.id]);
  const historyDesc = historyByModel.get(String(model.id)) ?? [];

  const since = Date.now() - windowHours * 3600_000;
  const history = historyDesc
    .filter((h) => h.ts >= since)
    .slice()
    .sort((a, b) => a.ts - b.ts); // chart wants ascending

  const tags: string[] = Array.isArray(model.tags) ? model.tags : [];
  // Score always uses the last 3 snapshots ever, independent of the
  // windowHours filter above (that filter only bounds the chart history).
  const snaps: SnapshotRow[] = historyDesc.slice(0, 3);
  const b = snaps.length > 0 ? scoreModel(snaps, { name: model.name, category: model.category, tags }) : null;

  const { data: shortlistRow, error: slError } = await supabase
    .from('shortlist')
    .select('*')
    .eq('model_id', model.id)
    .maybeSingle();
  if (slError) throw slError;

  return {
    model: {
      id: model.makerworld_id as string,
      name: model.name as string,
      creator: model.creator as string | null,
      url: model.url as string,
      thumbnailUrl: model.thumbnail_url as string | null,
      category: model.category as string | null,
      tags,
      firstSeenAt: new Date(model.first_seen_at).getTime(),
      lastSeenAt: new Date(model.last_scraped_at).getTime(),
    },
    score: b
      ? {
          score: b.score,
          engagementRatio: b.engagementRatio,
          growthPerDay: b.growthPerDay,
          categoryBonus: b.categoryBonus,
          quickPrint: b.quickPrint,
          downloads: b.downloads,
          likes: b.likes,
          computedAt: Date.now(),
          details: b,
        }
      : null,
    history: history.map((h) => ({ ts: h.ts, downloads: h.downloads, likes: h.likes, source: h.source })),
    // Scores are computed live on read now, not persisted, so there is no
    // historical time series of past scores to show any more (the current
    // dashboard doesn't render this field, only `history`). Kept for shape
    // compatibility.
    scoreHistory: [] as { ts: number; score: number }[],
    shortlist: shortlistRow
      ? {
          addedAt: new Date(shortlistRow.added_at).getTime(),
          updatedAt: new Date(shortlistRow.updated_at).getTime(),
          printed: !!shortlistRow.printed,
          listed: !!shortlistRow.listed,
          sold: !!shortlistRow.sold,
          salePrice: shortlistRow.sale_price,
          notes: shortlistRow.notes,
        }
      : null,
  };
}

export async function getShortlist() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('shortlist')
    .select('*, models(makerworld_id, name, url, thumbnail_url, category)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as ShortlistRow[];
  if (rows.length === 0) return [];

  const modelIds = rows.map((r: ShortlistRow) => r.model_id);
  const historyByModel = await fetchHistoryByModel(modelIds);

  return rows.map((r: ShortlistRow) => {
    const m = r.models;
    const history = historyByModel.get(String(r.model_id)) ?? [];
    const snaps: SnapshotRow[] = history.slice(0, 3);
    const score = snaps.length > 0 ? scoreModel(snaps, { name: m?.name ?? '', category: m?.category ?? null, tags: [] }).score : null;

    return {
      modelId: m?.makerworld_id ?? String(r.model_id),
      name: m?.name ?? null,
      url: m?.url ?? null,
      thumbnailUrl: m?.thumbnail_url ?? null,
      category: m?.category ?? null,
      score,
      addedAt: new Date(r.added_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
      printed: !!r.printed,
      listed: !!r.listed,
      sold: !!r.sold,
      salePrice: r.sale_price,
      notes: r.notes,
    };
  });
}

async function findInternalId(makerworldId: string): Promise<number | string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('models').select('id').eq('makerworld_id', makerworldId).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function addToShortlist(modelId: string): Promise<void> {
  const supabase = getSupabase();
  const internalId = await findInternalId(modelId);
  if (internalId == null) throw new Error(`addToShortlist: unknown model id "${modelId}"`);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('shortlist')
    .upsert({ model_id: internalId, added_at: now, updated_at: now }, { onConflict: 'model_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeFromShortlist(modelId: string): Promise<void> {
  const supabase = getSupabase();
  const internalId = await findInternalId(modelId);
  if (internalId == null) return; // nothing to remove
  const { error } = await supabase.from('shortlist').delete().eq('model_id', internalId);
  if (error) throw error;
}

// Row of `shortlist` joined with its model, as selected by getShortlist.
type ShortlistRow = {
  model_id: number | string;
  added_at: string;
  updated_at: string;
  printed: boolean;
  listed: boolean;
  sold: boolean;
  sale_price: number | null;
  notes: string | null;
  models: { makerworld_id: string; name: string; url: string; thumbnail_url: string | null; category: string | null } | null;
};

export type ShortlistPatch = {
  printed?: boolean;
  listed?: boolean;
  sold?: boolean;
  salePrice?: number | null;
  notes?: string | null;
};

export async function updateShortlist(modelId: string, patch: ShortlistPatch): Promise<void> {
  const supabase = getSupabase();
  const internalId = await findInternalId(modelId);
  if (internalId == null) throw new Error(`updateShortlist: unknown model id "${modelId}"`);

  const { data: existing, error: existErr } = await supabase
    .from('shortlist')
    .select('model_id')
    .eq('model_id', internalId)
    .maybeSingle();
  if (existErr) throw existErr;
  if (!existing) await addToShortlist(modelId);

  const update: Record<string, unknown> = {};
  if (typeof patch.printed === 'boolean') update.printed = patch.printed;
  if (typeof patch.listed === 'boolean') update.listed = patch.listed;
  if (typeof patch.sold === 'boolean') update.sold = patch.sold;
  if (patch.salePrice !== undefined) update.sale_price = patch.salePrice;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (Object.keys(update).length === 0) return;
  update.updated_at = new Date().toISOString();

  const { error } = await supabase.from('shortlist').update(update).eq('model_id', internalId);
  if (error) throw error;
}

export async function getRunStatus() {
  const supabase = getSupabase();

  const lastRunRes = await supabase.from('scrape_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (lastRunRes.error) throw lastRunRes.error;

  const [modelsCountRes, snapshotsCountRes, shortlistedCountRes, lastSnapRes] = await Promise.all([
    supabase.from('models').select('*', { count: 'exact', head: true }),
    supabase.from('snapshots').select('*', { count: 'exact', head: true }),
    supabase.from('shortlist').select('*', { count: 'exact', head: true }),
    supabase.from('snapshots').select('ts').order('ts', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (modelsCountRes.error) throw modelsCountRes.error;
  if (snapshotsCountRes.error) throw snapshotsCountRes.error;
  if (shortlistedCountRes.error) throw shortlistedCountRes.error;
  if (lastSnapRes.error) throw lastSnapRes.error;

  const last = lastRunRes.data as
    | { id: number; started_at: string; finished_at: string | null; status: string; models_seen: number; error: string | null }
    | null;

  return {
    lastRun: last
      ? {
          id: last.id,
          startedAt: new Date(last.started_at).getTime(),
          finishedAt: last.finished_at ? new Date(last.finished_at).getTime() : null,
          status: last.status,
          modelsSeen: last.models_seen,
          error: last.error,
        }
      : null,
    // No `scores` table any more (scores are computed live), so this now
    // reflects how fresh the underlying data is: the newest snapshot in the
    // system, i.e. "score is as of this point in time".
    lastScoredAt: lastSnapRes.data?.ts ? new Date(lastSnapRes.data.ts).getTime() : null,
    models: modelsCountRes.count ?? 0,
    snapshots: snapshotsCountRes.count ?? 0,
    shortlisted: shortlistedCountRes.count ?? 0,
  };
}

/* -------------------------------------------------------------------------
 * Like feed (swipe UI) + liked list
 *
 * `liked` / `liked_at` live on the models row and are only ever written from
 * here - the scraper's upsert deliberately never touches them.
 * ---------------------------------------------------------------------- */

export type FeedCard = {
  id: string; // makerworld_id
  name: string;
  creator: string | null;
  url: string;
  thumbnailUrl: string | null;
  category: string | null;
  downloads: number;
  likes: number;
  score: number;
  engagementRatio: number;
  quickPrint: boolean;
  license: string | null;
  sellable: Sellable;
  licenseNote: string;
};

/**
 * Next unliked models for the swipe feed, best-scoring first.
 * `excludeIds` are the makerworld ids already swiped away this session -
 * they stay in the DB untouched, they're just not served again.
 */
export async function getFeed(
  opts: { limit?: number; excludeIds?: string[]; sellableOnly?: boolean } = {}
): Promise<FeedCard[]> {
  const supabase = getSupabase();
  const limit = Math.min(opts.limit ?? 30, 100);
  const exclude = new Set(opts.excludeIds ?? []);

  // Pool the whole unliked set (paged past the 1000-row cap), not just the 400
  // most recently scraped - otherwise the feed only ever shows whichever
  // category happened to be scraped last.
  const PAGE = 1000;
  const POOL_MAX = Number(process.env.FEED_POOL_MAX ?? 3000);
  let pool: ModelRow[] = [];
  for (let from = 0; from < POOL_MAX; from += PAGE) {
    const { data, error } = await supabase
      .from('models')
      .select('id, makerworld_id, name, creator, url, thumbnail_url, category, tags, downloads, likes, license')
      .eq('liked', false)
      .order('last_scraped_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as ModelRow[];
    pool = pool.concat(batch);
    if (batch.length < PAGE) break;
  }

  // Default ON: don't put something in the swipe feed that can't be sold.
  const rows = pool
    .filter((m) => !exclude.has(m.makerworld_id))
    .filter((m) => opts.sellableOnly === false || isSellable(m.license));
  if (rows.length === 0) return [];

  const historyByModel = await fetchHistoryByModel(rows.map((m) => m.id));

  const cards = rows.map((m) => {
    const snaps: SnapshotRow[] = (historyByModel.get(String(m.id)) ?? []).slice(0, 3);
    const b = scoreModel(snaps, { name: m.name, category: m.category, tags: m.tags ?? [] });
    return {
      id: m.makerworld_id,
      name: m.name,
      creator: m.creator,
      url: m.url,
      thumbnailUrl: m.thumbnail_url,
      category: m.category,
      downloads: b.downloads,
      likes: b.likes,
      score: b.score,
      engagementRatio: b.engagementRatio,
      quickPrint: b.quickPrint,
      license: m.license ?? null,
      sellable: licenseInfo(m.license).sellable,
      licenseNote: licenseInfo(m.license).note,
    };
  });

  cards.sort((a, b) => b.score - a.score);
  return cards.slice(0, limit);
}

/** Set or clear the like flag. Clearing also clears liked_at. */
export async function setLiked(modelId: string, liked: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('models')
    .update({ liked, liked_at: liked ? new Date().toISOString() : null })
    .eq('makerworld_id', modelId);
  if (error) throw error;
}

// Row of `models` as selected by getLikedModels.
type LikedRow = {
  makerworld_id: string;
  name: string;
  creator: string | null;
  url: string;
  thumbnail_url: string | null;
  category: string | null;
  downloads: number | null;
  likes: number | null;
  liked_at: string | null;
  license: string | null;
};

export type LikedModel = {
  id: string;
  name: string;
  creator: string | null;
  url: string;
  thumbnailUrl: string | null;
  category: string | null;
  downloads: number;
  likes: number;
  likedAt: string | null;
  license: string | null;
  sellable: Sellable;
  licenseNote: string;
};

/** Everything liked, newest like first. Shape feeds the JSON export directly. */
export async function getLikedModels(): Promise<LikedModel[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('models')
    .select('makerworld_id, name, creator, url, thumbnail_url, category, downloads, likes, liked_at, license')
    .eq('liked', true)
    .order('liked_at', { ascending: false, nullsFirst: false });
  if (error) throw error;

  return ((data ?? []) as LikedRow[]).map((m) => ({
    id: m.makerworld_id,
    name: m.name,
    creator: m.creator,
    url: m.url,
    thumbnailUrl: m.thumbnail_url,
    category: m.category,
    downloads: m.downloads ?? 0,
    likes: m.likes ?? 0,
    likedAt: m.liked_at,
    license: m.license ?? null,
    sellable: licenseInfo(m.license).sellable,
    licenseNote: licenseInfo(m.license).note,
  }));
}
