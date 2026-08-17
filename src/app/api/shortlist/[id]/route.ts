import { NextResponse } from 'next/server';
import { removeFromShortlist, updateShortlist, getModelDetail } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  await updateShortlist(id, {
    printed: typeof body.printed === 'boolean' ? body.printed : undefined,
    listed: typeof body.listed === 'boolean' ? body.listed : undefined,
    sold: typeof body.sold === 'boolean' ? body.sold : undefined,
    salePrice:
      body.salePrice === undefined
        ? undefined
        : body.salePrice === null || body.salePrice === ''
          ? null
          : Number(body.salePrice),
    notes: body.notes === undefined ? undefined : String(body.notes ?? ''),
  });

  return NextResponse.json({ ok: true, detail: await getModelDetail(id) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeFromShortlist(id);
  return NextResponse.json({ ok: true });
}
