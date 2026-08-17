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
 *   categoryFit - market fit: what actually sells on OLX.ro / Vinted.ro,
 *                 nudged by per-model keyword signal (see categoryFit below)
 *   quickPrint  - heuristic flag for small, low-material, fast prints
 */

export const WEIGHTS = {
  growth: Number(process.env.SCORE_W_GROWTH ?? 0.3),
  engagement: Number(process.env.SCORE_W_ENGAGEMENT ?? 0.2),
  traction: Number(process.env.SCORE_W_TRACTION ?? 0.1),
  // Raised from 0.2: this is now grounded in real OLX/Vinted data rather
  // than a guess about what "should" sell, so it deserves more of the score.
  categoryFit: Number(process.env.SCORE_W_CATEGORY ?? 0.3),
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
 * Category fit for the Romanian resale case, calibrated against what is
 * actually listed and actually wanted (surveyed Aug 2026):
 *
 * OLX.ro "printat 3d" - 1000+ live listings, by category:
 *   Electronice 304 | Casa si gradina 276 | Mama si copilul 270
 *   Piese auto 90   | MODA SI FRUMUSETE 48  <- jewelry/earrings live here
 * Typical asking prices: tool organizer 170 lei, board-game inserts 200 lei,
 * car cup holder 95-100 lei, headphone stand 30-39 lei, figurines 20-50 lei.
 *
 * Vinted.ro "printat 3d" - 500+ listings; favourites used as demand signal:
 *   92♥ LED box 131 lei | 90♥ personalised name letters 70 lei
 *   63♥ decorative fruit bowl 50 lei | 42♥ bookmark 10 lei
 *   39♥ necklace holder 16 lei | 28♥ CAT EARRINGS 7 lei
 * Average price of items with any interest: ~56 lei.
 *
 * The lesson that flipped this table: earrings do attract interest, but at
 * 7-15 lei there's no margin left after filament and shipping. Functional
 * homeware, organisers and personalised gifts get comparable interest at
 * 50-170 lei. So jewelry went from 1.0 (the old guess) to the bottom.
 */
export function categoryFit(category?: string | null): number {
  const c = (category ?? '').toLowerCase();

  // Proven sellers: functional homeware + organisers, best price/interest ratio
  if (c.includes('organizer')) return 1.0;
  if (c.includes('decor')) return 1.0;
  if (c.includes('festivit')) return 0.95; // seasonal spikes (Halloween/Christmas)
  if (c.includes('lithophane') || c.includes('hueforge')) return 0.9; // personalised gifts
  if (c.includes('office')) return 0.85;
  if (c.includes('gadget')) return 0.85; // phone/car mounts, 90-100 lei on OLX
  if (c.includes('creature') || c.includes('character')) return 0.85; // dragons, busts
  if (c.includes('toys') || c.includes('games') || c.includes('puzzle')) return 0.8;
  if (c.includes('miniature') || c.includes('animal')) return 0.75;
  if (c.includes('pets') || c.includes('garden')) return 0.7;
  if (c.includes('coin') || c.includes('badge')) return 0.6;
  if (c.includes('hobby') || c.includes('diy')) return 0.6;
  if (c.includes('household') || c.includes('home')) return 0.65;
  if (c.includes('trending')) return 0.5; // mixed bag, no category signal

  // Fashion: high interest, but the price ceiling on Vinted is ~7-25 lei.
  if (c.includes('earring')) return 0.35;
  if (c.includes('ring')) return 0.35;
  if (c.includes('jewel')) return 0.4;
  if (c.includes('fashion')) return 0.4;

  return 0.4;
}

/**
 * Keyword-level market signal, independent of category. These are the exact
 * shapes that carry price on OLX/Vinted (or that reliably don't).
 * Returns roughly -0.4..+0.4, added to the category fit.
 */
const SELLS_WELL = [
  'personalized', 'personalised', 'custom name', 'name sign', 'nameplate', 'name plate',
  'holder', 'stand', 'organizer', 'organiser', 'insert', 'mount', 'bracket', 'dock',
  'lamp', 'light box', 'lightbox', 'led', 'lithophane', 'bookmark', 'coaster',
  'articulated', 'flexi', 'fidget', 'dragon', 'bowl', 'planter', 'vase',
  'wall mount', 'desk', 'cable', 'headphone', 'controller', 'board game',
  'advent', 'christmas', 'halloween', 'gift', 'ornament',
];

/** Things that don't move, or can't be shipped cheaply from a home printer. */
const SELLS_BADLY = [
  'test model', 'calibration', 'benchy', 'printer part', 'printer upgrade',
  'ams', 'bambu lab', 'nozzle', 'hotend', 'spool holder', 'filament guide',
  'cosplay', 'helmet', 'full size', 'life size', 'lifesize',
];

export function marketSignal(name: string, tags?: string[] | null): number {
  const hay = `${name} ${(tags ?? []).join(' ')}`.toLowerCase();
  let signal = 0;
  if (SELLS_WELL.some((k) => hay.includes(k))) signal += 0.35;
  if (SELLS_BADLY.some((k) => hay.includes(k))) signal -= 0.45;
  return signal;
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
  // Market fit = where it sits in the category table, nudged by keyword signal.
  const categoryBonus = clamp01(
    categoryFit(meta.category) + marketSignal(meta.name, meta.tags)
  );
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
