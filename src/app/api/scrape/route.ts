import { NextResponse } from 'next/server';
import { getRunStatus } from '@/lib/queries';
import { scrapeBatch } from '@/lib/scraper';
import { CATEGORY_LABELS } from '@/lib/config';

export const dynamic = 'force-dynamic';

const KNOWN_CATEGORIES = new Set(CATEGORY_LABELS);

/**
 * Netlify Functions are ephemeral and stateless between invocations — a
 * module-level "is a scrape running / how far did it get" variable (which
 * the old scheduled version used) would reset the moment the function
 * instance recycles, and there is no guarantee two POSTs even land on the
 * same instance. So this route deliberately does NOT own a long-running job:
 * each POST fetches at most BATCH_CAP models in one upstream round trip and
 * returns where it left off (`nextOffset`, `done`). The CLIENT
 * (ScrapeControls.tsx) is what loops, calling this route repeatedly with an
 * advancing `offset` until it has collected `count` items or `done` is true.
 * That keeps every single invocation fast and comfortably inside any
 * serverless timeout, with no server-side state to lose.
 */
const BATCH_CAP = 10;

export async function GET() {
  return NextResponse.json({ status: await getRunStatus() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const { category, count, offset } = (body ?? {}) as {
    category?: unknown;
    count?: unknown;
    offset?: unknown;
  };

  if (typeof category !== 'string' || !KNOWN_CATEGORIES.has(category)) {
    return NextResponse.json(
      { ok: false, error: `category must be one of: ${CATEGORY_LABELS.join(', ')}` },
      { status: 400 }
    );
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 50) {
    return NextResponse.json({ ok: false, error: 'count must be an integer between 1 and 50' }, { status: 400 });
  }
  const startOffset = typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;

  // `offset` doubles as "how many of this run's `count` have been scraped so
  // far" (the client always advances it by exactly what the previous call
  // reported scraping), so it's also the correct upstream pagination cursor
  // for the next request — no separate progress state needed anywhere.
  const remaining = count - startOffset;
  if (remaining <= 0) {
    return NextResponse.json({ ok: true, scraped: 0, totalDone: startOffset, done: true, nextOffset: startOffset });
  }

  try {
    const result = await scrapeBatch({
      categoryLabel: category,
      limit: Math.min(BATCH_CAP, remaining),
      offset: startOffset,
    });
    const nextOffset = startOffset + result.scraped;
    return NextResponse.json({
      ok: true,
      scraped: result.scraped,
      totalDone: nextOffset,
      done: result.done || nextOffset >= count,
      nextOffset,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
