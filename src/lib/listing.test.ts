import { describe, expect, it } from 'vitest';
import { buildListing, FILAMENT_COLORS, type ListingInput } from './listing';

const base: ListingInput = {
  name: 'Headphone stand',
  creator: 'maker42',
  url: 'https://makerworld.com/en/models/123',
  category: 'Household > Office',
  license: 'BY',
};

const listing = (over: Partial<ListingInput>) => buildListing({ ...base, ...over });

describe('buildListing', () => {
  it('builds a title capped at 70 characters', () => {
    expect(listing({}).title).toBe('Headphone stand - printat 3D');
    expect(listing({ name: 'x'.repeat(100) }).title).toHaveLength(70);
  });

  it('lists every filament colour in the description', () => {
    const { description } = listing({});
    for (const c of FILAMENT_COLORS) expect(description).toContain(c);
  });

  it('credits the creator for a sellable licence', () => {
    const l = listing({});
    expect(l.attribution).toBe(
      'Model: "Headphone stand" de maker42 (BY) — https://makerworld.com/en/models/123'
    );
    expect(l.description).toContain(`Sursă model: ${l.attribution}`);
    expect(l.licenseWarning).toBeNull();
  });

  it('falls back to a generic creator name', () => {
    expect(listing({ creator: null }).attribution).toContain('de autor MakerWorld');
  });

  it('warns instead of crediting when the licence forbids selling', () => {
    const l = listing({ license: 'BY-NC' });
    expect(l.attribution).toBeNull();
    expect(l.licenseWarning).toMatch(/^NU vinde:/);
    expect(l.description).not.toContain('Sursă model');
  });

  it('passes on the condition of a conditional licence', () => {
    expect(listing({ license: 'BY-ND' }).licenseWarning).toMatch(/NoDerivatives/);
  });

  it('prices from the first matching band, suggesting the midpoint', () => {
    expect(listing({ name: 'Catan board game insert' })).toMatchObject({
      priceMin: 120,
      priceMax: 220,
      priceSuggested: 170,
    });
    expect(listing({ name: 'Cat earrings', category: 'Fashion > Earrings' })).toMatchObject({
      priceMin: 7,
      priceMax: 20,
    });
  });

  it('uses the general band when nothing matches', () => {
    expect(listing({ name: 'Abstract sculpture', category: null })).toMatchObject({
      priceMin: 25,
      priceMax: 60,
      priceSuggested: 43,
    });
  });

  it('picks marketplace categories from the name and category', () => {
    expect(listing({ name: 'Cup holder', category: null }).olxCategory).toMatch(/^Auto/);
    expect(listing({ name: 'Cat earrings', category: null }).vintedCategory).toBe(
      'Femei > Accesorii > Bijuterii'
    );
    expect(listing({ name: 'Articulated dragon', category: null }).olxCategory).toBe(
      'Mama și copilul > Jucării'
    );
    expect(listing({ name: 'Abstract sculpture', category: null }).vintedCategory).toBe(
      'Casă > Decorațiuni'
    );
  });

  it('adds Romanian search tags and caps them at 10', () => {
    expect(listing({ name: 'Christmas ornament', category: null }).tags).toEqual(
      expect.arrayContaining(['printat 3d', 'cadou craciun'])
    );
    const many = listing({ name: 'Christmas halloween personalised name organizer earrings' });
    expect(many.tags.length).toBeLessThanOrEqual(10);
  });
});
