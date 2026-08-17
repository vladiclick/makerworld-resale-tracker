import { NextResponse } from 'next/server';
import { getCandidates, getCategories, getRunStatus } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const candidates = await getCandidates({
    category: sp.get('category') ?? undefined,
    minEngagement: sp.get('minEngagement') ? Number(sp.get('minEngagement')) : undefined,
    windowHours: sp.get('windowHours') ? Number(sp.get('windowHours')) : undefined,
    shortlistedOnly: sp.get('shortlisted') === '1',
    quickPrintOnly: sp.get('quickPrint') === '1',
    search: sp.get('q') ?? undefined,
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  });

  return NextResponse.json({
    candidates,
    categories: await getCategories(),
    status: await getRunStatus(),
    servedAt: Date.now(),
  });
}
