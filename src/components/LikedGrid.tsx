'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { LikedModel } from '@/lib/queries';
import styles from './LikedGrid.module.css';
import { thumb } from '@/lib/thumb';

const nf = new Intl.NumberFormat('en-US');

function formatLikedAt(iso: string | null) {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Sort newest like first, unliked-but-somehow-present items last (matches getLikedModels order). */
function sortByLikedAt(items: LikedModel[]): LikedModel[] {
  return [...items].sort((a, b) => {
    if (a.likedAt && b.likedAt) return b.likedAt.localeCompare(a.likedAt);
    if (a.likedAt) return -1;
    if (b.likedAt) return 1;
    return 0;
  });
}

export default function LikedGrid() {
  const [items, setItems] = useState<LikedModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/liked', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.liked ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnlike = useCallback(async (item: LikedModel) => {
    // optimistic remove
    setItems((prev) => (prev ? prev.filter((m) => m.id !== item.id) : prev));
    setCardErrors((prev) => {
      if (!(item.id in prev)) return prev;
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    try {
      const res = await fetch(`/api/models/${item.id}/like`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ liked: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'unlike failed');
    } catch (e) {
      // restore, re-sorted back into place
      setItems((prev) => {
        if (!prev) return prev;
        if (prev.some((m) => m.id === item.id)) return prev;
        return sortByLikedAt([...prev, item]);
      });
      setCardErrors((prev) => ({ ...prev, [item.id]: (e as Error).message }));
    }
  }, []);

  const handleExport = useCallback(() => {
    if (!items || items.length === 0) return;
    const payload = items.map((m) => ({
      name: m.name,
      image_url: m.thumbnailUrl,
      makerworld_url: m.url,
      category: m.category,
      downloads: m.downloads,
      likes: m.likes,
      liked_at: m.likedAt,
    }));
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `makerworld-liked-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [items]);

  const count = items?.length ?? 0;

  return (
    <div className="wrap">
      <header className={styles.header}>
        <h1>Liked</h1>
        <span className={styles.count}>{items ? `${count} liked` : 'loading…'}</span>
        <div className={styles.spacer} />
        <button type="button" className="primary" onClick={handleExport} disabled={!items || count === 0}>
          Export as JSON
        </button>
      </header>

      {loadError && <div className={styles.banner}>Failed to load liked models: {loadError}</div>}

      {items && items.length === 0 && !loadError && (
        <div className="empty">
          No liked models yet. Go to <Link href="/swipe">Swipe</Link> to start liking models.
        </div>
      )}

      {items && items.length > 0 && (
        <div className={styles.grid}>
          {items.map((item) => (
            <article className={styles.card} key={item.id}>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.thumbLink}>
                <div className={styles.thumbWrap}>
                  {item.thumbnailUrl ? (
                    // Hot-linked thumbnail, never re-hosted — plain <img>, not next/image.
                    <img
                      src={thumb(item.thumbnailUrl, 260)}
                      alt={item.name}
                      className={styles.thumb}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className={styles.thumbPlaceholder}>No image</div>
                  )}
                </div>
              </a>
              <div className={styles.body}>
                <h3 className={styles.name} title={item.name}>
                  {item.name}
                </h3>
                {item.creator && <div className={styles.creator}>by {item.creator}</div>}
                {item.category && (
                  <div className={styles.metaRow}>
                    <span className={styles.tag}>{item.category}</span>
                  </div>
                )}
                <div className={styles.stats}>
                  <span>
                    <b>{nf.format(item.downloads)}</b> downloads
                  </span>
                  <span>
                    <b>{nf.format(item.likes)}</b> likes
                  </span>
                </div>
                <div className={styles.likedAt}>Liked {formatLikedAt(item.likedAt)}</div>
                {cardErrors[item.id] && <div className={styles.cardError}>{cardErrors[item.id]}</div>}
                <div className={styles.actions}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.viewLink}>
                    View on MakerWorld ↗
                  </a>
                  <button type="button" className={styles.unlikeBtn} onClick={() => handleUnlike(item)}>
                    Unlike
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
