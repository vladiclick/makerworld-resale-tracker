import { describe, expect, it } from 'vitest';
import { categoryFit, marketSignal, quickPrintFlag, scoreModel, type SnapshotRow } from './scoring';

const HOUR = 3_600_000;
const snap = (hoursAgo: number, downloads: number, likes = 0): SnapshotRow => ({
  ts: Date.UTC(2026, 7, 20) - hoursAgo * HOUR,
  downloads,
  likes,
});

describe('categoryFit', () => {
  it('ranks proven sellers at the top', () => {
    expect(categoryFit('Tools > Organizers')).toBe(1);
    expect(categoryFit('Household > Decor')).toBe(1);
  });

  it('keeps thin-margin jewelry near the bottom', () => {
    expect(categoryFit('Fashion > Earrings')).toBe(0.35);
    expect(categoryFit('Fashion > Rings')).toBe(0.35);
    expect(categoryFit('Fashion > Jewelry')).toBe(0.4);
  });

  it('falls back to 0.4 for missing or unknown categories', () => {
    expect(categoryFit(null)).toBe(0.4);
    expect(categoryFit(undefined)).toBe(0.4);
    expect(categoryFit('Something new')).toBe(0.4);
  });
});

describe('marketSignal', () => {
  it('rewards shapes that sell', () => {
    expect(marketSignal('Headphone stand')).toBe(0.35);
  });

  it('penalises shapes that do not', () => {
    expect(marketSignal('Benchy')).toBe(-0.45);
  });

  it('reads tags as well as the name', () => {
    expect(marketSignal('Untitled', ['lithophane'])).toBe(0.35);
  });

  it('adds both signals when a name has both', () => {
    expect(marketSignal('Spool holder')).toBeCloseTo(-0.1);
  });

  it('is neutral when nothing matches', () => {
    expect(marketSignal('Abstract sculpture', null)).toBe(0);
  });

  it('matches whole words, not fragments of longer ones', () => {
    expect(marketSignal('Sweet dreams night sign')).toBe(0); // "ams" in "dreams"
    expect(marketSignal('Coiled spring toy')).toBe(0); // "led" in "coiled"
    expect(marketSignal('AMS riser')).toBe(-0.45);
  });

  it('still matches plurals and -ed/-ing forms', () => {
    expect(marketSignal('Wall-mounted shelf')).toBe(0.35);
    expect(marketSignal('Phone docking station')).toBe(0.35);
    expect(marketSignal('Set of 4 coasters')).toBe(0.35);
  });
});

describe('quickPrintFlag', () => {
  it('flags small items', () => {
    expect(quickPrintFlag('Cat keychain')).toBe(true);
  });

  it('lets a bulky hint win over a small one', () => {
    expect(quickPrintFlag('Mini cosplay helmet')).toBe(false);
  });

  it('treats jewelry categories as small', () => {
    expect(quickPrintFlag('Moon', 'Fashion > Jewelry')).toBe(true);
  });

  it('is false when nothing hints either way', () => {
    expect(quickPrintFlag('Abstract sculpture')).toBe(false);
  });

  it('does not read bulky hints inside longer words', () => {
    expect(quickPrintFlag('Adjustable phone stand')).toBe(true); // "table" in "adjustable"
    expect(quickPrintFlag('Tablet holder')).toBe(true); // "table" in "tablet"
    expect(quickPrintFlag('Robin ornament')).toBe(true); // "bin" in "robin"
  });

  it('does not read small hints inside longer words', () => {
    expect(quickPrintFlag('Minimalist sculpture')).toBe(false); // "mini" in "minimalist"
  });
});

describe('scoreModel', () => {
  const meta = { name: 'Abstract sculpture', category: null };

  it('scores a model with no snapshots from category fit alone', () => {
    const s = scoreModel([], meta);
    expect(s).toMatchObject({ downloads: 0, likes: 0, growthPerDay: 0, windowHours: 0, quickPrint: false });
    // categoryFit 0.4 * weight 0.3, over a total weight of 1.0
    expect(s.score).toBe(12);
  });

  it('measures growth against the oldest of the last three snapshots', () => {
    const s = scoreModel([snap(0, 400), snap(6, 300), snap(12, 100), snap(48, 0)], meta);
    expect(s.windowHours).toBe(12);
    expect(s.growthPerDay).toBe(600);
    expect(s.growthComponent).toBe(1); // saturates above the 150/day reference
  });

  it('falls back to half the traction for a brand new model', () => {
    const fresh = scoreModel([snap(0, 5000)], meta);
    expect(fresh.tractionComponent).toBe(1);
    expect(fresh.windowHours).toBe(0);
    // 0.3 * 0.5 (growth fallback) + 0.1 * 1 (traction) + 0.3 * 0.4 (category)
    expect(fresh.score).toBe(37);
  });

  it('shrinks the engagement ratio of tiny models toward zero', () => {
    const tiny = scoreModel([snap(0, 2, 14)], meta);
    const big = scoreModel([snap(0, 2000, 7000)], meta);
    expect(tiny.engagementRatio).toBe(7);
    expect(tiny.engagementComponent).toBeLessThan(0.15);
    expect(big.engagementComponent).toBeGreaterThan(0.85);
  });

  it('treats null counters as zero', () => {
    const s = scoreModel([{ ts: 1, downloads: null, likes: null }], meta);
    expect(s).toMatchObject({ downloads: 0, likes: 0, engagementRatio: 0 });
  });

  it('stays within 0..100 for an ideal model', () => {
    const s = scoreModel([snap(0, 100_000, 400_000), snap(24, 0)], {
      name: 'Personalised desk organizer',
      category: 'Tools > Organizers',
    });
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.score).toBeGreaterThan(90);
  });
});
