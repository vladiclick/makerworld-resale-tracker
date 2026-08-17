/**
 * Can you legally sell a print of this model?
 *
 * This is the difference between a side business and a takedown, so the rules
 * are explicit rather than clever.
 *
 * MakerWorld's own licences (verified Aug 2026):
 *   "Standard Digital File License"  - PERSONAL USE ONLY. Explicitly forbids
 *       selling prints or any commercial transaction. Covers ~80% of models.
 *       Commercial rights are sold separately by each creator through the
 *       MakerWorld Commercial License Membership.
 *   "MakerWorld Exclusive License"   - exclusive to the platform, same
 *       no-commercial-resale position. Treated as not sellable.
 *
 * Creative Commons codes as MakerWorld reports them:
 *   CC0        - public domain, sell freely
 *   BY         - sell with attribution
 *   BY-SA      - sell with attribution, share-alike on derivatives
 *   BY-ND      - verbatim copies may be redistributed commercially, but you
 *                may not sell a MODIFIED version. Sellable, unmodified only.
 *   BY-NC, BY-NC-SA, BY-NC-ND - NonCommercial. Never sellable.
 *
 * Anything unrecognised is 'unknown' and is hidden by default rather than
 * assumed safe.
 */

export type Sellable = 'yes' | 'conditional' | 'no' | 'unknown';

export type LicenseInfo = {
  raw: string | null;
  code: string;
  sellable: Sellable;
  note: string;
};

export function licenseInfo(raw: string | null | undefined): LicenseInfo {
  const value = (raw ?? '').trim();
  if (!value) {
    return { raw: null, code: 'unknown', sellable: 'unknown', note: 'No licence recorded yet — re-scrape this model.' };
  }

  const l = value.toLowerCase();

  // MakerWorld's own licence NAMES must be matched before any Creative Commons
  // logic. Substring matching on CC codes is a trap: "StaNDard" contains "nd",
  // which once mislabelled 1734 personal-use-only models as "NoDerivatives,
  // sellable with conditions" - exactly backwards, and the expensive direction
  // to be wrong in.
  if (l.includes('standard digital file')) {
    return {
      raw: value,
      code: value,
      sellable: 'no',
      note: "Personal use only — selling prints is explicitly forbidden. Commercial rights require buying the creator's Commercial License Membership.",
    };
  }

  if (l.includes('exclusive')) {
    return {
      raw: value,
      code: 'MakerWorld Exclusive License',
      sellable: 'no',
      note: 'Platform-exclusive licence — not for commercial resale.',
    };
  }

  // Creative Commons: match whole tokens ("by-nc-sa" -> ["by","nc","sa"]),
  // never substrings.
  const tokens = l.split(/[^a-z0-9]+/).filter(Boolean);
  const has = (t: string) => tokens.includes(t);

  if (has('cc0') || has('zero') || l.includes('public domain')) {
    return { raw: value, code: 'CC0', sellable: 'yes', note: 'Public domain — sell freely.' };
  }

  // NonCommercial first: BY-NC-SA also contains BY and SA.
  if (has('nc')) {
    return { raw: value, code: value, sellable: 'no', note: 'NonCommercial licence — selling prints is not permitted.' };
  }

  if (has('nd')) {
    return {
      raw: value,
      code: value,
      sellable: 'conditional',
      note: 'NoDerivatives — you may sell unmodified prints, but not a remixed or edited version.',
    };
  }

  if (has('sa')) {
    return {
      raw: value,
      code: value,
      sellable: 'conditional',
      note: 'ShareAlike — sellable with attribution; any derivative you publish must carry the same licence.',
    };
  }

  if (has('by') || l.includes('attribution')) {
    return { raw: value, code: value, sellable: 'yes', note: 'Sellable with attribution to the creator.' };
  }

  return { raw: value, code: value, sellable: 'unknown', note: 'Unrecognised licence — check the model page before selling.' };
}

/** Licences we're willing to show when "sellable only" is on. */
export function isSellable(raw: string | null | undefined): boolean {
  const s = licenseInfo(raw).sellable;
  return s === 'yes' || s === 'conditional';
}
