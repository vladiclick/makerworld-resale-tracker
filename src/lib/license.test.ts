import { describe, expect, it } from 'vitest';
import { isSellable, licenseInfo } from './license';

describe('licenseInfo', () => {
  it('marks a missing licence as unknown', () => {
    expect(licenseInfo(null)).toMatchObject({ raw: null, code: 'unknown', sellable: 'unknown' });
    expect(licenseInfo('   ').sellable).toBe('unknown');
  });

  it('never reads "nd" inside "Standard Digital File License" as NoDerivatives', () => {
    const info = licenseInfo('Standard Digital File License');
    expect(info.sellable).toBe('no');
  });

  it('treats the MakerWorld Exclusive License as not sellable', () => {
    expect(licenseInfo('MakerWorld Exclusive License')).toMatchObject({
      code: 'MakerWorld Exclusive License',
      sellable: 'no',
    });
  });

  it.each(['CC0', 'cc0 1.0', 'Public Domain'])('treats %s as public domain', (raw) => {
    expect(licenseInfo(raw)).toMatchObject({ code: 'CC0', sellable: 'yes' });
  });

  it.each(['BY-NC', 'BY-NC-SA', 'BY-NC-ND', 'CC BY-NC 4.0'])('rejects NonCommercial %s', (raw) => {
    expect(licenseInfo(raw).sellable).toBe('no');
  });

  it('allows BY-ND with conditions (unmodified prints only)', () => {
    const info = licenseInfo('BY-ND');
    expect(info.sellable).toBe('conditional');
    expect(info.note).toMatch(/NoDerivatives/);
  });

  it('allows BY-SA with conditions (share-alike)', () => {
    const info = licenseInfo('BY-SA');
    expect(info.sellable).toBe('conditional');
    expect(info.note).toMatch(/ShareAlike/);
  });

  it.each(['BY', 'CC BY 4.0', 'Attribution'])('allows %s with attribution', (raw) => {
    expect(licenseInfo(raw).sellable).toBe('yes');
  });

  it('keeps the raw value, trimmed', () => {
    expect(licenseInfo('  BY  ').raw).toBe('BY');
  });

  it('hides anything it does not recognise', () => {
    expect(licenseInfo('GPL-3.0').sellable).toBe('unknown');
  });
});

describe('isSellable', () => {
  it('accepts yes and conditional licences', () => {
    expect(isSellable('CC0')).toBe(true);
    expect(isSellable('BY')).toBe(true);
    expect(isSellable('BY-SA')).toBe(true);
    expect(isSellable('BY-ND')).toBe(true);
  });

  it('rejects no and unknown licences', () => {
    expect(isSellable('BY-NC-SA')).toBe(false);
    expect(isSellable('Standard Digital File License')).toBe(false);
    expect(isSellable(undefined)).toBe(false);
    expect(isSellable('Something else')).toBe(false);
  });
});
