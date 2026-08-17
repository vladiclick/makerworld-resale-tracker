import { getSupabase } from './supabase';
import { RETENTION } from './config';

/**
 * Collapse raw snapshots older than RETENTION.rawDays into one row per model
 * per UTC day (last observation of that day wins), then delete the raw rows.
 * Idempotent: safe to run on every cycle.
 *
 * The actual collapse logic lives in Postgres (see collapse_old_snapshots()
 * in supabase/schema.sql) — it needs window functions to pick "last
 * observation of the day" per model, which isn't expressible through
 * PostgREST's query builder, so it's a single RPC round trip instead.
 */
export async function collapseOldSnapshots(rawDays = RETENTION.rawDays) {
  const supabase = getSupabase();
  const cutoff = Date.now() - rawDays * 24 * 60 * 60 * 1000;

  const { data, error } = await supabase.rpc('collapse_old_snapshots', { raw_days: rawDays });
  if (error) throw error;

  const collapsed = typeof data === 'number' ? data : 0;
  return { collapsed, cutoff };
}
