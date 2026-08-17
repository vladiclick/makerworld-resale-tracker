/** Throwaway probe: dump MakerWorld's category tree from the models page nav. */
import { chromium } from 'playwright';
import { SCRAPE } from '../src/lib/config';
import { writeFileSync } from 'node:fs';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser
    .newContext({ userAgent: SCRAPE.userAgent, viewport: { width: 1600, height: 1000 } })
    .then((c) => c.newPage());

  await page.goto('https://makerworld.com/en/3d-models', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(6000);

  const links = await page.$$eval('a[href*="/3d-models/"]', (els) =>
    Array.from(
      new Map(
        els.map((el) => {
          const a = el as HTMLAnchorElement;
          return [a.href, { href: a.href, text: (a.textContent ?? '').trim().slice(0, 60) }];
        })
      ).values()
    )
  );
  console.log(JSON.stringify(links, null, 2));

  // Also grab whatever the app embedded as build data.
  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el?.textContent?.slice(0, 200000) ?? '';
  });
  writeFileSync('tmp-inspect/next-data.json', nextData);
  await browser.close();
}
main().catch((e) => (console.error(e), process.exit(1)));
