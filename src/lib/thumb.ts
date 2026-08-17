/**
 * MakerWorld's CDN serves the ORIGINAL upload - routinely 2-5 MB per image -
 * which is insane for a 56px table thumbnail. It does support on-the-fly
 * resizing (Alibaba OSS style), and it returns WebP automatically:
 *
 *   ?x-oss-process=image/resize,w_400/format,webp
 *
 * Measured on a real 4.4 MB JPEG cover:
 *   original  4 428 995 B
 *   w_120         2 052 B   (2000x smaller)
 *   w_400        15 222 B
 *   w_800/q80    42 602 B
 *
 * Nothing is re-hosted or cached by us - it's still their CDN URL, just asking
 * for a sane size. Pass the CSS width you render at; this doubles it for
 * retina automatically.
 */

const RESIZABLE_HOSTS = ['bblmw.com', 'makerworld.com', 'mw-cdn.com', 'bambulab.com'];

export function thumb(
  url: string | null | undefined,
  cssWidth: number,
  opts: { dpr?: number; quality?: number } = {}
): string | undefined {
  if (!url) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // not a URL we can reason about - hand it back untouched
  }

  if (!RESIZABLE_HOSTS.some((h) => parsed.hostname.endsWith(h))) return url;
  // Already carries a processing directive: don't fight with it.
  if (parsed.searchParams.has('x-oss-process')) return url;

  const dpr = opts.dpr ?? 2;
  const width = Math.round(cssWidth * dpr);
  const quality = opts.quality ?? 80;

  parsed.searchParams.set(
    'x-oss-process',
    `image/resize,w_${width}/format,webp/quality,q_${quality}`
  );
  return parsed.toString();
}
