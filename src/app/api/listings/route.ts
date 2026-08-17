import { NextResponse } from 'next/server';
import { getLikedModels } from '@/lib/queries';
import { buildListing } from '@/lib/listing';

export const dynamic = 'force-dynamic';

/**
 * Ready-to-paste listing copy for every liked model.
 * You post by hand — this only removes the typing.
 */
export async function GET() {
  const liked = await getLikedModels();

  const listings = liked.map((m) => ({
    modelId: m.id,
    name: m.name,
    creator: m.creator,
    url: m.url,
    imageUrl: m.thumbnailUrl,
    category: m.category,
    license: m.license,
    sellable: m.sellable,
    downloads: m.downloads,
    likes: m.likes,
    listing: buildListing({
      name: m.name,
      creator: m.creator,
      url: m.url,
      category: m.category,
      license: m.license,
      downloads: m.downloads,
      likes: m.likes,
    }),
  }));

  return NextResponse.json({ listings, generatedAt: Date.now() });
}
