import { licenseInfo } from './license';

/**
 * Turns a tracked model into ready-to-paste OLX.ro / Vinted.ro listing copy.
 *
 * You still post by hand - both platforms ban scripted posting, and every
 * listing needs photos of YOUR actual print anyway. This just removes the
 * typing: title, Romanian description, price band, category and the
 * attribution line the licence requires.
 *
 * Price bands come from a live survey of both marketplaces (Aug 2026), not
 * from guesswork - see the table in PRICE_BANDS.
 */

export type ListingInput = {
  name: string;
  creator: string | null;
  url: string;
  category: string | null;
  license: string | null;
  downloads?: number;
  likes?: number;
};

export type Listing = {
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  priceSuggested: number;
  olxCategory: string;
  vintedCategory: string;
  tags: string[];
  attribution: string | null;
  licenseWarning: string | null;
};

/**
 * Observed asking prices in RON for printed goods, Aug 2026.
 *   OLX: tool organiser 170, board-game inserts 200, car cup holder 95-100,
 *        headphone stand 30-39, name plates 40, figurines 20-50, keycap 8
 *   Vinted: LED box 131, name letters 70, fruit bowl 50, bookmark 10,
 *           necklace holder 16, earrings 7
 * Items with any favourites on Vinted averaged ~56 RON.
 */
const PRICE_BANDS: { test: RegExp; min: number; max: number; label: string }[] = [
  { test: /insert|board game|catan|dice tower/i, min: 120, max: 220, label: 'board game' },
  { test: /organizer|organiser|makita|tool holder|drawer/i, min: 70, max: 170, label: 'organiser' },
  { test: /lamp|light ?box|led|lithophane|hueforge/i, min: 70, max: 140, label: 'lamp/lightbox' },
  { test: /car|auto|cup ?holder|suport pahar|dashboard|vent/i, min: 60, max: 110, label: 'car accessory' },
  { test: /planter|vase|bowl|fruit|ghiveci/i, min: 40, max: 80, label: 'decor vessel' },
  { test: /personali[sz]|custom name|nume|name ?tag|name ?plate|initial/i, min: 35, max: 80, label: 'personalised' },
  { test: /dragon|articulated|flexi|figur|statue|bust/i, min: 30, max: 70, label: 'figurine' },
  { test: /holder|stand|dock|mount|bracket|hook/i, min: 30, max: 60, label: 'holder/stand' },
  { test: /christmas|halloween|advent|ornament|craciun|brad/i, min: 25, max: 60, label: 'seasonal' },
  { test: /coaster|bookmark|semn de carte|magnet/i, min: 10, max: 25, label: 'small flat' },
  { test: /keychain|breloc|keyring|charm/i, min: 10, max: 20, label: 'keychain' },
  { test: /earring|cercei|pendant|necklace|bracelet|ring/i, min: 7, max: 20, label: 'jewelry (thin margin)' },
];

const DEFAULT_BAND = { min: 25, max: 60, label: 'general' };

function priceFor(input: ListingInput) {
  const hay = `${input.name} ${input.category ?? ''}`;
  const band = PRICE_BANDS.find((b) => b.test.test(hay)) ?? DEFAULT_BAND;
  const suggested = Math.round((band.min + band.max) / 2);
  return { min: band.min, max: band.max, suggested, label: band.label };
}

/** OLX and Vinted use different trees; these are the closest real categories. */
function categoriesFor(input: ListingInput): { olx: string; vinted: string } {
  const hay = `${input.name} ${input.category ?? ''}`.toLowerCase();
  if (/car|auto|cup holder|dashboard/.test(hay))
    return { olx: 'Auto, moto și ambarcațiuni > Piese auto > Accesorii interior', vinted: 'Casă > Depozitare' };
  if (/earring|cercei|necklace|bracelet|ring|jewel/.test(hay))
    return { olx: 'Modă și frumusețe > Accesorii > Bijuterii', vinted: 'Femei > Accesorii > Bijuterii' };
  if (/toy|joc|puzzle|figur|dragon|game/.test(hay))
    return { olx: 'Mama și copilul > Jucării', vinted: 'Copii > Jucării' };
  if (/organizer|holder|stand|dock|desk|office/.test(hay))
    return { olx: 'Casa și grădina > Decorațiuni interior', vinted: 'Casă > Depozitare' };
  if (/lamp|led|light|lithophane/.test(hay))
    return { olx: 'Casa și grădina > Iluminat', vinted: 'Casă > Decorațiuni' };
  return { olx: 'Casa și grădina > Decorațiuni interior', vinted: 'Casă > Decorațiuni' };
}

function tagsFor(input: ListingInput): string[] {
  const base = ['printat 3d', 'print 3d', 'handmade', 'PLA'];
  const hay = `${input.name} ${input.category ?? ''}`.toLowerCase();
  if (/christmas|craciun|advent/.test(hay)) base.push('cadou craciun', 'decoratiuni craciun');
  if (/halloween/.test(hay)) base.push('halloween', 'decor halloween');
  if (/personali|nume|name|initial/.test(hay)) base.push('personalizat', 'cadou personalizat');
  if (/organizer|holder|stand/.test(hay)) base.push('organizator', 'suport');
  if (/earring|cercei/.test(hay)) base.push('cercei', 'bijuterii');
  return base.slice(0, 10);
}

export function buildListing(input: ListingInput): Listing {
  const price = priceFor(input);
  const cats = categoriesFor(input);
  const info = licenseInfo(input.license);

  // BY / BY-SA / BY-ND all require crediting the creator. CC0 does not, but
  // crediting anyway costs nothing and keeps you clearly in the right.
  const attribution =
    info.sellable === 'no'
      ? null
      : `Model: "${input.name}" de ${input.creator ?? 'autor MakerWorld'} (${input.license ?? 'licență necunoscută'}) — ${input.url}`;

  const licenseWarning =
    info.sellable === 'no'
      ? `NU vinde: ${info.note}`
      : info.sellable === 'conditional'
        ? info.note
        : null;

  const title = `${input.name} - printat 3D`.slice(0, 70);

  const description = [
    `${input.name} — printat 3D de mine, filament PLA.`,
    '',
    'Detalii:',
    '• Print nou, verificat înainte de expediere',
    '• Se poate face în mai multe culori — scrie-mi ce culoare vrei',
    '• Se poate printa la comandă (2-3 zile)',
    '',
    'Expediere prin curier sau Easybox. Poze reale cu produsul.',
    '',
    attribution ? `Sursă model: ${attribution}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title,
    description,
    priceMin: price.min,
    priceMax: price.max,
    priceSuggested: price.suggested,
    olxCategory: cats.olx,
    vintedCategory: cats.vinted,
    tags: tagsFor(input),
    attribution,
    licenseWarning,
  };
}
