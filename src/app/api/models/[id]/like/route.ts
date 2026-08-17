import { NextResponse } from 'next/server';
import { setLiked } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Like / unlike a model. Shared by the swipe feed and the liked page.
 * Body: { liked: boolean }. `id` is the MakerWorld id, same as everywhere else.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.liked !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'body must be { liked: boolean }' }, { status: 400 });
  }

  try {
    await setLiked(id, body.liked);
    return NextResponse.json({ ok: true, id, liked: body.liked });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
