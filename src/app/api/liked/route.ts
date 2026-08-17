import { NextResponse } from 'next/server';
import { getLikedModels } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** Thin route over getLikedModels() — powers the /liked grid. */
export async function GET() {
  return NextResponse.json({ liked: await getLikedModels() });
}
