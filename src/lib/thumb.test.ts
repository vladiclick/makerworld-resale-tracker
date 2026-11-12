import { describe, expect, it } from 'vitest';
import { thumb } from './thumb';

const COVER = 'https://public-cdn.bblmw.com/design/cover/abc.jpg';

describe('thumb', () => {
  it('returns undefined for a missing url', () => {
    expect(thumb(null, 56)).toBeUndefined();
    expect(thumb(undefined, 56)).toBeUndefined();
    expect(thumb('', 56)).toBeUndefined();
  });

  it('asks the MakerWorld CDN for a retina-sized WebP by default', () => {
    const out = new URL(thumb(COVER, 56)!);
    expect(out.searchParams.get('x-oss-process')).toBe('image/resize,w_112/format,webp/quality,q_80');
    expect(out.origin + out.pathname).toBe(COVER);
  });

  it('honours dpr and quality overrides', () => {
    const out = new URL(thumb(COVER, 200, { dpr: 1.5, quality: 60 })!);
    expect(out.searchParams.get('x-oss-process')).toBe('image/resize,w_300/format,webp/quality,q_60');
  });

  it('keeps existing query parameters', () => {
    const out = new URL(thumb(`${COVER}?v=3`, 100)!);
    expect(out.searchParams.get('v')).toBe('3');
    expect(out.searchParams.has('x-oss-process')).toBe(true);
  });

  it('leaves a url that already has a processing directive alone', () => {
    const url = `${COVER}?x-oss-process=image/resize,w_50`;
    expect(thumb(url, 400)).toBe(url);
  });

  it('leaves other hosts alone', () => {
    const url = 'https://example.com/image.jpg';
    expect(thumb(url, 100)).toBe(url);
  });

  it('hands back strings that are not URLs', () => {
    expect(thumb('/local/cover.jpg', 100)).toBe('/local/cover.jpg');
  });
});
