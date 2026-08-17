import { NextResponse } from 'next/server';
import { getFeed } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Thin route over getFeed() for the swipe UI.
 * ?limit=            max cards to return (getFeed clamps to 100)
 * ?exclude=id,id,id  makerworld ids swiped away this session - never re-served
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const excludeParam = sp.get('exclude');
  const excludeIds = excludeParam
    ? excludeParam.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  try {
    const cards = await getFeed({
      limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
      excludeIds,
    });
    return NextResponse.json({ cards, servedAt: Date.now() });
  } catch (e) {
    return NextResponse.json({ cards: [], error: (e as Error).message }, { status: 500 });
  }
}
