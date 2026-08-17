/**
 * Resale-candidate scoring.
 *
 * Everything is normalised to 0..1 before weighting, so the final score is a
 * 0..100 number that stays comparable across categories and across time.
 *
 * Components:
 *   growth      - downloads/day between the last 2-3 snapshots, log-normalised
 *   engagement  - likes/downloads, i.e. how much people liked it vs just grabbed it
 *   traction    - absolute download count, log-normalised (a 50-download model
 *                 growing fast is noisier than a 5000-download one)
 *   categoryFit - jewelry/earrings/small decor ship cheap on Vinted/OLX
 *   quickPrint  - heuristic flag for small, low-material, fast prints
 */

export const WEIGHTS = {
  growth: Number(process.env.SCORE_W_GROWTH ?? 0.35),
  engagement: Number(process.env.SCORE_W_ENGAGEMENT ?? 0.25),
  traction: Number(process.env.SCORE_W_TRACTION ?? 0.1),
  categoryFit: Number(process.env.SCORE_W_CATEGORY ?? 0.2),
  quickPrint: Number(process.env.SCORE_W_QUICKPRINT ?? 0.1),
};

/**
 * Reference values, calibrated against a live sample of MakerWorld's trending
 * + target-category feeds (Aug 2026). Re-check them if the site's numbers drift.
 *
 * Note: on MakerWorld likes routinely EXCEED downloads (people like from the
 * feed without downloading), so the engagement ratio is normally 1-4, not <1.
 * Observed distribution: p25 1.26, p50 1.86, p75 3.03, p90 4.22.
 */
/** downloads/day that saturates the growth component */
const GROWTH_REF = Number(process.env.SCORE_GROWTH_REF ?? 150);
/** likes/downloads ratio that saturates the engagement component */
const ENGAGEMENT_REF = Number(process.env.SCORE_ENGAGEMENT_REF ?? 4);
/** total downloads that saturates the traction component */
const TRACTION_REF = Number(process.env.SCORE_TRACTION_REF ?? 5000);
/**
 * Shrinkage constant for the engagement ratio. A model with 2 downloads and 14
 * likes has a ratio of 7.0, which is noise, not signal - so the component is
 * computed as likes/(downloads + K). Big models are barely affected; tiny ones
 * get pulled back toward zero until they accumulate real volume.
 */
const ENGAGEMENT_SMOOTH = Number(process.env.SCORE_ENGAGEMENT_SMOOTH ?? 25);

/**
 * Category fit for the Vinted/OLX resale case: small = cheap to ship,
 * fast to print, low filament cost, high margin per gram.
 */
export function categoryFit(category?: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('earring')) return 1.0;
  if (c.includes('jewel')) return 1.0;
  if (c.includes('decor')) return 0.75;
  if (c.includes('fashion')) return 0.7;
  if (c.includes('household') || c.includes('home')) return 0.55;
  if (c.includes('hobby') || c.includes('diy')) return 0.45;
  if (c.includes('trending')) return 0.4; // mixed bag, no category signal
  return 0.35;
}

const SMALL_HINTS = [
  'earring', 'ring', 'pendant', 'necklace', 'bracelet', 'charm', 'keychain',
  'keyring', 'magnet', 'coaster', 'clip', 'holder', 'hook', 'stud', 'brooch',
  'badge', 'bookmark', 'miniature', 'mini', 'small', 'tiny', 'desk', 'ornament',
  'topper', 'fidget', 'card holder', 'stand', 'organizer', 'tray', 'plant pot',
  'planter', 'vase', 'candle', 'gift', 'flower', 'butterfly', 'heart',
];

const BULKY_HINTS = [
  'helmet', 'cosplay', 'armor', 'lamp shade', 'shelf', 'chair', 'table',
  'enclosure', 'bin', 'crate', 'printer', 'rc ', 'drone', 'gridfinity rack',
  'full size', 'life size', 'lifesize', 'katana', 'sword', 'statue', 'bust',
];

/**
 * Heuristic: is this likely a quick, low-material print?
 * Deliberately fuzzy - it only nudges the score, never gates it.
 */
export function quickPrintFlag(
  name: string,
  category?: string | null,
  tags?: string[] | null
): boolean {
  const hay = `${name} ${category ?? ''} ${(tags ?? []).join(' ')}`.toLowerCase();
  if (BULKY_HINTS.some((h) => hay.includes(h))) return false;
  if (SMALL_HINTS.some((h) => hay.includes(h))) return true;
  // Jewelry-ish categories are small by definition.
  const c = (category ?? '').toLowerCase();
  return c.includes('jewel') || c.includes('earring');
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const logNorm = (v: number, ref: number) =>
  clamp01(Math.log10(1 + Math.max(0, v)) / Math.log10(1 + ref));

export type SnapshotRow = { ts: number; downloads: number | null; likes: number | null };

export type ScoreBreakdown = {
  score: number;
  engagementRatio: number;
  growthPerDay: number;
  growthComponent: number;
  engagementComponent: number;
  tractionComponent: number;
  categoryBonus: number;
  quickPrint: boolean;
  windowHours: number;
  downloads: number;
  likes: number;
};

/**
 * @param snaps snapshots for one model, NEWEST FIRST
 */
export function scoreModel(
  snaps: SnapshotRow[],
  meta: { name: string; category?: string | null; tags?: string[] | null }
): ScoreBreakdown {
  const latest = snaps[0];
  const downloads = latest?.downloads ?? 0;
  const likes = latest?.likes ?? 0;

  const engagementRatio = downloads > 0 ? likes / downloads : 0;

  // Growth: use the oldest of the last 3 snapshots as the baseline so a single
  // flat 6h window doesn't zero out an otherwise climbing model.
  const window = snaps.slice(0, 3);
  const oldest = window[window.length - 1];
  let growthPerDay = 0;
  let windowHours = 0;
  if (oldest && latest && oldest.ts < latest.ts) {
    windowHours = (latest.ts - oldest.ts) / 3_600_000;
    const delta = (latest.downloads ?? 0) - (oldest.downloads ?? 0);
    const days = windowHours / 24;
    if (days > 0) growthPerDay = delta / days;
  }

  const growthComponent = logNorm(growthPerDay, GROWTH_REF);
  const smoothedRatio = likes / (downloads + ENGAGEMENT_SMOOTH);
  const engagementComponent = clamp01(smoothedRatio / ENGAGEMENT_REF);
  const tractionComponent = logNorm(downloads, TRACTION_REF);
  const categoryBonus = categoryFit(meta.category);
  const quickPrint = quickPrintFlag(meta.name, meta.category, meta.tags);

  // A brand new model has no growth history yet; fall back to traction so it
  // isn't buried, but don't let it outrank something with proven momentum.
  const hasHistory = snaps.length >= 2 && windowHours > 0;
  const growthTerm = hasHistory ? growthComponent : tractionComponent * 0.5;

  const raw =
    WEIGHTS.growth * growthTerm +
    WEIGHTS.engagement * engagementComponent +
    WEIGHTS.traction * tractionComponent +
    WEIGHTS.categoryFit * categoryBonus +
    WEIGHTS.quickPrint * (quickPrint ? 1 : 0);

  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0) || 1;

  return {
    score: Math.round((raw / totalWeight) * 1000) / 10, // 0..100, 1 decimal
    engagementRatio,
    growthPerDay,
    growthComponent,
    engagementComponent,
    tractionComponent,
    categoryBonus,
    quickPrint,
    windowHours,
    downloads,
    likes,
  };
}

// There used to be a `recomputeAllScores()` here that wrote every model's
// score into a `scores` table after each scrape cycle. That table is gone —
// scores are now computed live, on read, by src/lib/queries.ts (fetch the
// last 3 snapshots per model, call scoreModel() above). Nothing in this
// file talks to the database any more; it's pure math only.
