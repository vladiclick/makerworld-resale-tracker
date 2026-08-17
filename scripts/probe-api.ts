/** Throwaway probe: ask the site (from inside a real browser session) which
 *  category endpoints exist and what a category-filtered query returns. */
import { chromium } from 'playwright';
import { SCRAPE } from '../src/lib/config';

const paths = process.argv.slice(2);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ userAgent: SCRAPE.userAgent }).then((c) => c.newPage());
  await page.goto('https://makerworld.com/en', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);

  for (const p of paths) {
    const out = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' } });
        const t = await r.text();
        return { status: r.status, body: t.slice(0, 3000) };
      } catch (e) {
        return { status: -1, body: String(e) };
      }
    }, p);
    console.log('\n=== ', p, out.status, '\n', out.body);
    await page.waitForTimeout(2500);
  }
  await browser.close();
}
main().catch((e) => (console.error(e), process.exit(1)));
