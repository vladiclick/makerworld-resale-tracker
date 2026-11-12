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
const band = (name: string) => {
  const l = listing({ name, category: null });
  return [l.priceMin, l.priceMax];
};

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

  it('matches price keywords on whole words', () => {
    expect(band('Advent calendar')).toEqual([25, 60]); // seasonal, not "vent" -> car
    expect(band('Card holder')).toEqual([30, 60]); // holder, not "car"
    expect(band('Angled phone stand')).toEqual([30, 60]); // stand, not "led" -> lamp
    expect(band('Spring clip')).toEqual([25, 60]); // general, not "ring" -> jewelry
  });

  it('still prices plurals and -ed/-ing forms', () => {
    expect(band('LEDs for a shelf')).toEqual([70, 140]);
    expect(band('Wall-mounted key rack')).toEqual([30, 60]);
    expect(band('Personalized pet tag')).toEqual([35, 80]);
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

  it('matches marketplace categories on whole words', () => {
    const olx = (name: string) => listing({ name, category: null }).olxCategory;
    expect(olx('Card holder')).toBe('Casa și grădina > Decorațiuni interior'); // not "car"
    expect(olx('Scarf clip')).toBe('Casa și grădina > Decorațiuni interior'); // not "car"
    expect(olx('Spring pen holder')).toBe('Casa și grădina > Decorațiuni interior'); // not "ring"
    expect(listing({ name: 'Angled photo frame', category: null }).vintedCategory).toBe(
      'Casă > Decorațiuni'
    ); // not "led" -> lighting
    expect(olx('Moon lightbox')).toBe('Casa și grădina > Iluminat');
    expect(listing({ name: 'Octopus', category: 'Toys & Games' }).vintedCategory).toBe('Copii > Jucării');
  });

  it('matches tag keywords on whole words', () => {
    const tags = (name: string) => listing({ name, category: null }).tags;
    expect(tags('Adventure map')).not.toContain('cadou craciun'); // "advent"
    expect(tags('Enamel pin')).not.toContain('personalizat'); // "name"
    expect(tags('Standard dice')).not.toContain('suport'); // "stand"
    expect(tags('Advent calendar')).toContain('cadou craciun');
    expect(tags('Name plate')).toContain('personalizat');
  });

  it('adds Romanian search tags and caps them at 10', () => {
    expect(listing({ name: 'Christmas ornament', category: null }).tags).toEqual(
      expect.arrayContaining(['printat 3d', 'cadou craciun'])
    );
    const many = listing({ name: 'Christmas halloween personalised name organizer earrings' });
    expect(many.tags.length).toBeLessThanOrEqual(10);
  });
});
