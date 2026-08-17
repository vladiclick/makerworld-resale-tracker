/** One scrape cycle: fetch every target, snapshot it, prune old history.
 *  Scores are no longer computed/stored here — they're computed live by the
 *  dashboard/API on every read. Run `npm run score` to preview the ranking. */
import './_env';
import { runScrape } from '../src/lib/scraper';
import { collapseOldSnapshots } from '../src/lib/retention';

async function main() {
  const t0 = Date.now();
  const stats = await runScrape();
  const { collapsed } = await collapseOldSnapshots();

  console.log('--- scrape run', stats.runId, '---');
  for (const [label, n] of Object.entries(stats.perTarget)) console.log(`  ${label}: ${n} models`);
  console.log(
    `  api calls: ${stats.pagesHit} (cache hits: ${stats.pagesCached}) | snapshots: ${stats.modelsSeen} | collapsed: ${collapsed}`
  );
  if (stats.errors.length) console.log('  errors:', stats.errors.join('\n          '));
  console.log(`  took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
