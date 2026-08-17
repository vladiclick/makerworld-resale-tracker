/**
 * Print the current ranked candidate list. No network / scraping involved —
 * scores are computed live from whatever snapshots are already in Supabase,
 * the same way the dashboard's /api/candidates does it. There's no more
 * "recompute and persist" step: the old `scores` table is gone, so this
 * replaces the previous `recomputeAllScores()` write path with a read-only
 * preview.
 */
import './_env';
import { getCandidates } from '../src/lib/queries';

async function main() {
  const candidates = await getCandidates({ limit: 20, windowHours: 720 });
  console.log(`top ${candidates.length} candidates (scored live from stored snapshots):`);
  for (const c of candidates) {
    console.log(`  ${c.score.toFixed(1).padStart(5)}  ${c.name}  (${c.category ?? 'uncategorized'})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
