import { NextResponse } from 'next/server';
import { getModelDetail } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const windowHours = Number(new URL(req.url).searchParams.get('windowHours') ?? 720);
  const detail = await getModelDetail(id, windowHours);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(detail);
}
