/** Collapse snapshots older than RETENTION_RAW_DAYS into daily summary rows. */
import './_env';
import { collapseOldSnapshots } from '../src/lib/retention';
import { RETENTION } from '../src/lib/config';

async function main() {
  const { collapsed, cutoff } = await collapseOldSnapshots();
  console.log(
    `retention: keeping raw snapshots for ${RETENTION.rawDays} days (cutoff ${new Date(cutoff).toISOString()}); collapsed ${collapsed} raw rows`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
