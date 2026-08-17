/**
 * One-off migration: read the old SQLite store (data/tracker.db) and push
 * everything into Supabase.
 *
 * This is the ONE place in the codebase still allowed to import
 * better-sqlite3 — it's a read-only bridge for a migration that only needs
 * to run once (or be re-run safely; see below). Everything else talks to
 * Supabase.
 *
 * Migrates: models, snapshots, daily_summaries, shortlist. Does NOT migrate
 * the old `scores` table (scores are computed live now, nothing to carry
 * over) or `scrape_runs` / `page_cache` (transient run log / cache, not
 * data worth keeping).
 *
 * Safe to re-run:
 *   - models: upserted by makerworld_id (unique).
 *   - daily_summaries: upserted by its natural (model_id, day) primary key.
 *   - shortlist: upserted by its (model_id) primary key.
 *   - snapshots: no natural unique key in the schema, so this script checks
 *     for existing (model_id, ts) pairs before inserting and skips ones
 *     that already exist.
 *
 * Usage:
 *   npm run migrate:supabase
 *   SQLITE_DB_PATH=./somewhere/tracker.db npm run migrate:supabase
 */
import './_env';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { getSupabase } from '../src/lib/supabase';

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), 'data', 'tracker.db');
const BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type OldModel = {
  id: string;
  name: string;
  creator: string | null;
  url: string;
  thumbnail_url: string | null;
  category: string | null;
  tags: string | null;
  first_seen_at: number;
  last_seen_at: number;
};

type OldSnapshot = { model_id: string; ts: number; downloads: number | null; likes: number | null };
type OldDailySummary = {
  model_id: string;
  day: string;
  ts: number;
  downloads: number | null;
  likes: number | null;
  samples: number;
};
type OldShortlist = {
  model_id: string;
  added_at: number;
  updated_at: number;
  printed: number;
  listed: number;
  sold: number;
  sale_price: number | null;
  notes: string | null;
};

async function main() {
  if (!fs.existsSync(SQLITE_DB_PATH)) {
    console.error(`No SQLite DB found at ${SQLITE_DB_PATH} — nothing to migrate.`);
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_DB_PATH, { readonly: true, fileMustExist: true });
  const supabase = getSupabase();

  console.log(`Reading ${SQLITE_DB_PATH} ...`);

  // ---------------------------------------------------------------------
  // models
  // ---------------------------------------------------------------------
  const oldModels = sqlite
    .prepare(
      'SELECT id, name, creator, url, thumbnail_url, category, tags, first_seen_at, last_seen_at FROM models'
    )
    .all() as OldModel[];

  // Latest downloads/likes per model, to seed the new models.downloads/likes
  // cache columns (the old schema didn't have them on the models row).
  const latestStatsByModel = new Map<string, { downloads: number | null; likes: number | null }>();
  for (const row of sqlite
    .prepare('SELECT model_id, ts, downloads, likes FROM snapshots ORDER BY ts ASC')
    .iterate() as IterableIterator<OldSnapshot>) {
    latestStatsByModel.set(row.model_id, { downloads: row.downloads, likes: row.likes });
  }

  const makerworldIdToInternalId = new Map<string, number | string>();
  let modelsUpserted = 0;

  for (const batch of chunk(oldModels, BATCH_SIZE)) {
    const rows = batch.map((m) => {
      let tags: unknown[] = [];
      try {
        tags = m.tags ? JSON.parse(m.tags) : [];
      } catch {
        tags = [];
      }
      const stats = latestStatsByModel.get(m.id);
      return {
        makerworld_id: m.id,
        name: m.name,
        creator: m.creator,
        url: m.url,
        thumbnail_url: m.thumbnail_url,
        category: m.category,
        tags,
        downloads: stats?.downloads ?? null,
        likes: stats?.likes ?? null,
        first_seen_at: new Date(m.first_seen_at).toISOString(),
        last_scraped_at: new Date(m.last_seen_at).toISOString(),
      };
    });

    const { data, error } = await supabase
      .from('models')
      .upsert(rows, { onConflict: 'makerworld_id' })
      .select('id, makerworld_id');
    if (error) throw error;

    for (const row of data ?? []) makerworldIdToInternalId.set(row.makerworld_id, row.id);
    modelsUpserted += batch.length;
    console.log(`  models: ${modelsUpserted}/${oldModels.length}`);
  }

  // ---------------------------------------------------------------------
  // snapshots (dedup by (model_id, ts) since there's no unique constraint)
  // ---------------------------------------------------------------------
  const oldSnapshots = sqlite
    .prepare('SELECT model_id, ts, downloads, likes FROM snapshots ORDER BY ts ASC')
    .all() as OldSnapshot[];

  let snapshotsInserted = 0;
  let snapshotsSkipped = 0;

  for (const batch of chunk(oldSnapshots, BATCH_SIZE)) {
    const mapped = batch
      .map((s) => {
        const internalId = makerworldIdToInternalId.get(s.model_id);
        if (internalId == null) return null;
        return { model_id: internalId, tsMs: s.ts, downloads: s.downloads, likes: s.likes };
      })
      .filter((r): r is { model_id: number | string; tsMs: number; downloads: number | null; likes: number | null } => r !== null);

    if (mapped.length === 0) continue;

    const modelIds = Array.from(new Set(mapped.map((r) => r.model_id)));
    const tsValues = mapped.map((r) => r.tsMs);
    const minTsIso = new Date(Math.min(...tsValues)).toISOString();
    const maxTsIso = new Date(Math.max(...tsValues)).toISOString();

    const { data: existing, error: existErr } = await supabase
      .from('snapshots')
      .select('model_id, ts')
      .in('model_id', modelIds)
      .gte('ts', minTsIso)
      .lte('ts', maxTsIso);
    if (existErr) throw existErr;

    const existingKeys = new Set(
      (existing ?? []).map((r: { model_id: number | string; ts: string }) => `${r.model_id}|${new Date(r.ts).getTime()}`)
    );

    const fresh = mapped
      .filter((r) => !existingKeys.has(`${r.model_id}|${r.tsMs}`))
      .map((r) => ({ model_id: r.model_id, ts: new Date(r.tsMs).toISOString(), downloads: r.downloads, likes: r.likes }));

    snapshotsSkipped += mapped.length - fresh.length;

    if (fresh.length > 0) {
      const { error: insErr } = await supabase.from('snapshots').insert(fresh);
      if (insErr) throw insErr;
      snapshotsInserted += fresh.length;
    }
    console.log(`  snapshots: ${snapshotsInserted} inserted, ${snapshotsSkipped} already present (of ${oldSnapshots.length} total)`);
  }

  // ---------------------------------------------------------------------
  // daily_summaries (natural primary key, plain upsert is enough)
  // ---------------------------------------------------------------------
  const oldDaily = sqlite
    .prepare('SELECT model_id, day, ts, downloads, likes, samples FROM daily_summaries')
    .all() as OldDailySummary[];

  let dailyUpserted = 0;
  for (const batch of chunk(oldDaily, BATCH_SIZE)) {
    const rows = batch
      .map((d) => {
        const internalId = makerworldIdToInternalId.get(d.model_id);
        if (internalId == null) return null;
        return {
          model_id: internalId,
          day: d.day,
          ts: new Date(d.ts).toISOString(),
          downloads: d.downloads,
          likes: d.likes,
          samples: d.samples,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length === 0) continue;

    const { error } = await supabase.from('daily_summaries').upsert(rows, { onConflict: 'model_id,day' });
    if (error) throw error;
    dailyUpserted += rows.length;
    console.log(`  daily_summaries: ${dailyUpserted}/${oldDaily.length}`);
  }

  // ---------------------------------------------------------------------
  // shortlist (natural primary key, plain upsert is enough)
  // ---------------------------------------------------------------------
  const oldShortlist = sqlite
    .prepare('SELECT model_id, added_at, updated_at, printed, listed, sold, sale_price, notes FROM shortlist')
    .all() as OldShortlist[];

  let shortlistUpserted = 0;
  for (const batch of chunk(oldShortlist, BATCH_SIZE)) {
    const rows = batch
      .map((s) => {
        const internalId = makerworldIdToInternalId.get(s.model_id);
        if (internalId == null) return null;
        return {
          model_id: internalId,
          added_at: new Date(s.added_at).toISOString(),
          updated_at: new Date(s.updated_at).toISOString(),
          printed: !!s.printed,
          listed: !!s.listed,
          sold: !!s.sold,
          sale_price: s.sale_price,
          notes: s.notes,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length === 0) continue;

    const { error } = await supabase.from('shortlist').upsert(rows, { onConflict: 'model_id' });
    if (error) throw error;
    shortlistUpserted += rows.length;
  }

  sqlite.close();

  console.log('\n--- migration summary ---');
  console.log(`  models:          ${modelsUpserted} upserted`);
  console.log(`  snapshots:       ${snapshotsInserted} inserted, ${snapshotsSkipped} already present`);
  console.log(`  daily_summaries: ${dailyUpserted} upserted`);
  console.log(`  shortlist:       ${shortlistUpserted} upserted`);
  console.log('done.');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
