import { NextResponse } from 'next/server';
import { addToShortlist, getShortlist } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ shortlist: await getShortlist() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const modelId = String(body.modelId ?? '');
  if (!modelId) return NextResponse.json({ error: 'modelId required' }, { status: 400 });
  await addToShortlist(modelId);
  return NextResponse.json({ ok: true, shortlist: await getShortlist() });
}
