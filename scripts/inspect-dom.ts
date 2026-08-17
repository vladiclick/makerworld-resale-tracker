/**
 * One-off recon tool. Loads a MakerWorld page in headed-ish Chromium, records
 * every XHR/fetch response that looks like model data, and dumps a DOM sample.
 *
 *   npm run inspect -- "https://makerworld.com/en/3d-models?collectionId=1"
 *
 * Output lands in ./tmp-inspect/ so the scraper selectors can be written
 * against the real, current page structure rather than guesswork.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const target = process.argv[2] ?? 'https://makerworld.com/en/3d-models';
const outDir = path.join(process.cwd(), 'tmp-inspect');

async function main() {
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  const apiHits: { url: string; status: number; bodyPreview: string }[] = [];

  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\//.test(url)) return;
    const ct = res.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;
    try {
      const text = await res.text();
      apiHits.push({ url, status: res.status(), bodyPreview: text.slice(0, 4000) });
    } catch {
      /* body already consumed / redirect */
    }
  });

  console.log('loading', target);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(4000);

  writeFileSync(path.join(outDir, 'page.html'), await page.content());
  writeFileSync(path.join(outDir, 'api-hits.json'), JSON.stringify(apiHits, null, 2));
  await page.screenshot({ path: path.join(outDir, 'page.png'), fullPage: false });

  // Anchor-level probe: what do model cards actually look like?
  const anchors = await page.$$eval('a[href*="/models/"]', (els) =>
    els.slice(0, 8).map((el) => ({
      href: (el as HTMLAnchorElement).href,
      className: el.className,
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      html: el.outerHTML.slice(0, 1200),
    }))
  );
  writeFileSync(path.join(outDir, 'anchors.json'), JSON.stringify(anchors, null, 2));

  console.log(`api json responses: ${apiHits.length}`);
  for (const h of apiHits) console.log(' ', h.status, h.url.slice(0, 160));
  console.log(`model anchors found: ${anchors.length}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
