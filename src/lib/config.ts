/** Central knobs. Everything here is overridable via .env.local */

export type Target = {
  /** Label stored on the model row, e.g. "Fashion > Earrings" */
  label: string;
  /**
   * MakerWorld numeric category id (the number in the category URL slug,
   * e.g. /en/3d-models/206-earrings -> "206"). Empty string = no filter,
   * which is what the site's own Trending feed uses.
   */
  categoryId: string;
  /** API sort key. "hotScore" is what the UI shows as Trending / Popular. */
  orderBy?: 'hotScore' | 'newest' | 'mostDownload' | 'mostCollect';
  /** designCreateSince: only models published in the last N days. 0 = all time. */
  createdSinceDays?: number;
  /** Human-facing page for the same listing, handy for spot checks. */
  pageUrl: string;
};

/**
 * Licences whose prints may legally be sold. MakerWorld's search API accepts
 * these server-side via `&licenses=`, so we ask it for sellable models only
 * instead of scraping everything and discarding ~95% (verified: of 2160
 * models scraped unfiltered, 2040 were personal-use-only).
 *
 *   CC0    sell freely
 *   BY     sell with attribution
 *   BY-SA  sell with attribution, share-alike on derivatives
 *   BY-ND  sell unmodified prints only
 *
 * Deliberately excludes every NC (NonCommercial) variant, MakerWorld's
 * "Standard Digital File License" and "MakerWorld Exclusive License", all of
 * which forbid selling prints. See src/lib/license.ts.
 */
export const SELLABLE_LICENSES = (
  process.env.SCRAPE_LICENSES ?? 'CC0,BY,BY-SA,BY-ND'
).trim();

export const SCRAPE = {
  /** polite delay between API calls, ms */
  delayMinMs: Number(process.env.SCRAPE_DELAY_MIN_MS ?? 2000),
  delayMaxMs: Number(process.env.SCRAPE_DELAY_MAX_MS ?? 3000),
  /** a page fetched inside this window is served from the in-process cache instead of re-hit */
  cacheTtlMs: Number(process.env.SCRAPE_CACHE_TTL_MS ?? 60 * 60 * 1000), // 1h
  userAgent:
    process.env.SCRAPE_USER_AGENT ??
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  /** hard cap on models per target page; keeps CLI full-crawl runs (`npm run scrape`) short and polite */
  maxModelsPerTarget: Number(process.env.SCRAPE_MAX_PER_TARGET ?? 60),
};

export const RETENTION = {
  /** raw snapshots older than this collapse into daily_summaries */
  rawDays: Number(process.env.RETENTION_RAW_DAYS ?? 90),
};

const BASE = 'https://makerworld.com/en/3d-models';

/**
 * Category ids verified live against makerworld.com's category nav.
 *
 * Deliberately broad: an earlier version tracked only Trending + decor +
 * jewelry + earrings, so the feed was ~60% earrings regardless of what
 * actually sells. These cover the categories that show real demand on
 * OLX.ro / Vinted.ro for printed goods.
 */
export const TARGETS: Target[] = [
  {
    label: 'Trending',
    categoryId: '',
    orderBy: 'hotScore',
    createdSinceDays: 7, // same as the site's default trending feed
    pageUrl: `${BASE}`,
  },
  { label: 'Household > Decor', categoryId: '401', pageUrl: `${BASE}/401-decor` },
  { label: 'Household > Festivities', categoryId: '403', pageUrl: `${BASE}/403-festivities` },
  { label: 'Household > Office', categoryId: '404', pageUrl: `${BASE}/404-office` },
  { label: 'Household > Pets', categoryId: '405', pageUrl: `${BASE}/405-pets` },
  { label: 'Household > Garden', categoryId: '402', pageUrl: `${BASE}/402-garden` },
  { label: 'Fashion > Jewelry', categoryId: '208', pageUrl: `${BASE}/208-jewelry` },
  { label: 'Fashion > Earrings', categoryId: '206', pageUrl: `${BASE}/206-earrings` },
  { label: 'Fashion > Rings', categoryId: '205', pageUrl: `${BASE}/205-rings` },
  { label: 'Toys & Games', categoryId: '800', pageUrl: `${BASE}/800-toys-and-games` },
  { label: 'Toys & Games > Characters', categoryId: '801', pageUrl: `${BASE}/801-characters` },
  { label: 'Toys & Games > Puzzles', categoryId: '804', pageUrl: `${BASE}/804-puzzles` },
  { label: 'Miniatures > Animals', categoryId: '601', pageUrl: `${BASE}/601-animals` },
  { label: 'Miniatures > Creatures', categoryId: '603', pageUrl: `${BASE}/603-creatures` },
  { label: 'Tools > Organizers', categoryId: '701', pageUrl: `${BASE}/701-organizers` },
  { label: 'Tools > Gadgets', categoryId: '705', pageUrl: `${BASE}/705-gadgets` },
  { label: 'Art > Coin & Badges', categoryId: '103', pageUrl: `${BASE}/103-coin-and-badges` },
  { label: 'Hueforge & Lithophane', categoryId: '2001', pageUrl: `${BASE}/2001-hueforge-and-lithophane` },
  { label: 'Hobby & DIY', categoryId: '300', pageUrl: `${BASE}/300-hobby-and-diy` },
];

/**
 * Labels of every category the scraper knows how to fetch, in display order.
 * Safe to import from client components (e.g. ScrapeControls) — it's a
 * plain derived constant, not env-driven, so nothing server-only leaks into
 * the browser bundle.
 */
export const CATEGORY_LABELS: string[] = TARGETS.map((t) => t.label);
