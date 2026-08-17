'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import styles from './SwipeFeed.module.css';
import { thumb } from '@/lib/thumb';

/**
 * Shape mirrors `FeedCard` from '@/lib/queries'. Redeclared locally (rather
 * than imported) so this client component has zero coupling to server-only
 * modules - '@/lib/queries' pulls in the Supabase client, which must never
 * end up in a browser bundle.
 */
type FeedCard = {
  id: string; // makerworld_id
  name: string;
  creator: string | null;
  url: string;
  thumbnailUrl: string | null;
  category: string | null;
  downloads: number;
  likes: number;
  score: number;
  engagementRatio: number;
  quickPrint: boolean;
};

const EXCLUDE_STORAGE_KEY = 'swipe:excludedIds';
const REFILL_THRESHOLD = 5;
const FETCH_LIMIT = 20;
const SWIPE_THRESHOLD = 100; // px of horizontal drag before it commits
const ANIM_MS = 280;

const nf = new Intl.NumberFormat('en-US');

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function loadExcludedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(EXCLUDE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return []; // sessionStorage unavailable (private mode, etc.) - fine, just no persistence
  }
}

function saveExcludedIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(EXCLUDE_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

/* -------------------------------------------------------------------------
 * Card face - the visual content shared by the top (interactive) card and
 * the peek card behind it.
 * ---------------------------------------------------------------------- */

function CardFace({ card }: { card: FeedCard }) {
  return (
    <>
      <div className={styles.thumbWrap}>
        {card.thumbnailUrl ? (
          // Hot-linked from MakerWorld's CDN, never re-hosted.
          <img
            className={styles.thumb}
            src={thumb(card.thumbnailUrl, 460)}
            alt=""
            draggable={false}
            decoding="async"
            fetchPriority="high"
          />
        ) : (
          <div className={styles.thumbFallback}>No image</div>
        )}
        {card.quickPrint && <span className={styles.quickBadge}>Quick print</span>}
      </div>

      <div className={styles.info}>
        <h2 className={styles.name}>{card.name}</h2>
        <div className={styles.meta}>
          {card.creator ? `${card.creator} · ` : ''}
          {card.category ?? 'Uncategorized'}
        </div>

        <dl className={styles.stats}>
          <div>
            <dt>Score</dt>
            <dd>{card.score.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Downloads</dt>
            <dd>{nf.format(card.downloads)}</dd>
          </div>
          <div>
            <dt>Likes</dt>
            <dd>{nf.format(card.likes)}</dd>
          </div>
          <div>
            <dt>Engagement</dt>
            <dd>{card.engagementRatio.toFixed(2)}</dd>
          </div>
        </dl>

        {/* Link out - deliberately not inside anything that starts a drag. */}
        <a
          className={styles.outLink}
          href={card.url}
          target="_blank"
          rel="noreferrer noopener"
          onPointerDown={(e) => e.stopPropagation()}
        >
          Open on MakerWorld ↗
        </a>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * SwipeCard - owns the drag gesture for whichever card is currently on top.
 * Exposes trigger('like' | 'skip') so buttons/keyboard can fire the same
 * fly-off animation as a completed drag.
 * ---------------------------------------------------------------------- */

export type SwipeCardHandle = { trigger: (direction: 'like' | 'skip') => void };

const SwipeCard = forwardRef<
  SwipeCardHandle,
  { card: FeedCard; isTop: boolean; onCommit: (direction: 'like' | 'skip') => void }
>(function SwipeCard({ card, isTop, onCommit }, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  const likeBadgeRef = useRef<HTMLDivElement>(null);
  const nopeBadgeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startX: 0, startY: 0, dx: 0, dy: 0, pointerId: null as number | null, dragging: false });
  const committedRef = useRef(false);

  const applyTransform = useCallback((dx: number, dy: number, withTransition: boolean) => {
    const el = elRef.current;
    if (!el) return;
    el.style.transition = withTransition
      ? `transform ${prefersReducedMotion() ? 1 : ANIM_MS}ms cubic-bezier(0.22,0.9,0.32,1)`
      : 'none';
    const rot = Math.max(-18, Math.min(18, dx / 12));
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    if (likeBadgeRef.current) likeBadgeRef.current.style.opacity = String(dx > 0 ? Math.min(1, dx / SWIPE_THRESHOLD) : 0);
    if (nopeBadgeRef.current) nopeBadgeRef.current.style.opacity = String(dx < 0 ? Math.min(1, -dx / SWIPE_THRESHOLD) : 0);
  }, []);

  const fly = useCallback(
    (direction: 'like' | 'skip') => {
      if (committedRef.current) return;
      committedRef.current = true;
      const ms = prefersReducedMotion() ? 1 : ANIM_MS;
      const el = elRef.current;
      if (el) {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 480;
        const targetX = (direction === 'like' ? 1 : -1) * vw * 1.2;
        const dy = dragRef.current.dy;
        el.style.transition = `transform ${ms}ms cubic-bezier(0.22,0.9,0.32,1), opacity ${ms}ms ease`;
        el.style.transform = `translate(${targetX}px, ${dy}px) rotate(${direction === 'like' ? 26 : -26}deg)`;
        el.style.opacity = '0';
      }
      if (likeBadgeRef.current) likeBadgeRef.current.style.opacity = direction === 'like' ? '1' : '0';
      if (nopeBadgeRef.current) nopeBadgeRef.current.style.opacity = direction === 'skip' ? '1' : '0';
      window.setTimeout(() => onCommit(direction), ms);
    },
    [onCommit]
  );

  const snapBack = useCallback(() => {
    dragRef.current.dx = 0;
    dragRef.current.dy = 0;
    applyTransform(0, 0, true);
  }, [applyTransform]);

  useImperativeHandle(ref, () => ({ trigger: fly }), [fly]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isTop || committedRef.current) return;
    if ((e.target as HTMLElement).closest('a')) return; // let the outbound link work normally, no drag
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, pointerId: e.pointerId, dragging: true };
    applyTransform(0, 0, false);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.dragging || d.pointerId !== e.pointerId) return;
    d.dx = e.clientX - d.startX;
    d.dy = e.clientY - d.startY;
    applyTransform(d.dx, d.dy, false);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.dragging || d.pointerId !== e.pointerId) return;
    d.dragging = false;
    if (Math.abs(d.dx) > SWIPE_THRESHOLD) {
      fly(d.dx > 0 ? 'like' : 'skip');
    } else {
      snapBack();
    }
  };

  return (
    <div
      ref={elRef}
      className={`${styles.card} ${isTop ? styles.cardTop : styles.cardPeek}`}
      onPointerDown={isTop ? onPointerDown : undefined}
      onPointerMove={isTop ? onPointerMove : undefined}
      onPointerUp={isTop ? endDrag : undefined}
      onPointerCancel={isTop ? endDrag : undefined}
      aria-hidden={!isTop}
    >
      <CardFace card={card} />
      {isTop && (
        <>
          <div ref={likeBadgeRef} className={`${styles.badge} ${styles.badgeLike}`}>
            Like
          </div>
          <div ref={nopeBadgeRef} className={`${styles.badge} ${styles.badgeNope}`}>
            Skip
          </div>
        </>
      )}
    </div>
  );
});

/* -------------------------------------------------------------------------
 * SwipeFeed - queue management, prefetch, keyboard, optimistic like/skip.
 * ---------------------------------------------------------------------- */

export default function SwipeFeed() {
  const [queue, setQueue] = useState<FeedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excludeRef = useRef<Set<string>>(new Set());
  const fetchingRef = useRef(false);
  const topCardRef = useRef<SwipeCardHandle>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // The shared app nav (rendered by the root layout, above this page) is
  // sticky but still occupies normal document flow height. `100dvh` on this
  // page alone doesn't know about it, which pushes the action bar below the
  // fold. Measure it and size the page to the remainder instead.
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.app-nav');
    if (!nav || !pageRef.current) return;
    const page = pageRef.current;
    const applyHeight = () => {
      page.style.setProperty('--nav-h', `${nav.getBoundingClientRect().height}px`);
    };
    applyHeight();
    const ro = new ResizeObserver(applyHeight);
    ro.observe(nav);
    window.addEventListener('resize', applyHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', applyHeight);
    };
  }, []);

  // Hydrate session-swiped ids before the first feed request.
  useEffect(() => {
    for (const id of loadExcludedIds()) excludeRef.current.add(id);
  }, []);

  const fetchMore = useCallback(async () => {
    if (fetchingRef.current || exhausted) return;
    fetchingRef.current = true;
    setFetchingMore(true);
    try {
      const exclude = Array.from(excludeRef.current).join(',');
      const url = `/api/feed?limit=${FETCH_LIMIT}${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ''}`;
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Feed request failed (${res.status})`);

      const fresh: FeedCard[] = (json.cards ?? []).filter((c: FeedCard) => !excludeRef.current.has(c.id));
      setQueue((q) => {
        const existingIds = new Set(q.map((c) => c.id));
        const toAdd = fresh.filter((c) => !existingIds.has(c.id));
        return toAdd.length ? [...q, ...toAdd] : q;
      });
      if (fresh.length === 0) setExhausted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      fetchingRef.current = false;
      setFetchingMore(false);
      setLoading(false);
    }
  }, [exhausted]);

  useEffect(() => {
    if (!exhausted && queue.length < REFILL_THRESHOLD) fetchMore();
  }, [queue.length, exhausted, fetchMore]);

  // Warm the next few cards' images in the browser cache so a swipe reveals an
  // already-decoded image instead of a grey box. Same resized URL the card
  // will request, so it's a cache hit, not a second download.
  useEffect(() => {
    for (const card of queue.slice(1, 4)) {
      const src = thumb(card.thumbnailUrl, 460);
      if (!src) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }, [queue]);

  const commit = useCallback((card: FeedCard, direction: 'like' | 'skip') => {
    // Optimistic: the card is already flying off screen by the time this
    // fires. Advance the queue now, fire the PATCH in the background.
    setQueue((q) => q.filter((c) => c.id !== card.id));
    excludeRef.current.add(card.id);
    saveExcludedIds(excludeRef.current);

    if (direction === 'like') {
      fetch(`/api/models/${encodeURIComponent(card.id)}/like`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ liked: true }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error || `Request failed (${res.status})`);
          }
        })
        .catch((e) => {
          // Restore the card so the like isn't silently lost.
          excludeRef.current.delete(card.id);
          saveExcludedIds(excludeRef.current);
          setQueue((q) => [card, ...q]);
          setError(`Couldn't save "${card.name}" as liked - restored, try again. (${(e as Error).message})`);
        });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        topCardRef.current?.trigger('like');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        topCardRef.current?.trigger('skip');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const top = queue[0];

  return (
    <div className={styles.page} ref={pageRef}>
      <header className={styles.header}>
        <h1>Swipe</h1>
        <span className={styles.counter}>{queue.length > 0 ? `${queue.length} queued` : ''}</span>
      </header>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          <button type="button" className={styles.errorDismiss} onClick={() => setError(null)} aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      <div className={styles.stage}>
        {queue.length === 0 ? (
          loading || fetchingMore ? (
            <div className={styles.status} aria-live="polite">
              Loading feed…
            </div>
          ) : (
            <div className={styles.empty} aria-live="polite">
              <p className={styles.emptyTitle}>Nothing left to swipe</p>
              <p className={styles.emptySub}>Scrape more from the dashboard, then come back.</p>
              <Link href="/" className={styles.emptyCta}>
                Go to dashboard
              </Link>
            </div>
          )
        ) : (
          <div className={styles.cardStack}>
            {queue.slice(0, 2).map((card, index) => (
              <SwipeCard
                key={card.id}
                card={card}
                isTop={index === 0}
                onCommit={(direction) => commit(card, direction)}
                ref={index === 0 ? topCardRef : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {top && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.skipBtn}
            aria-label="Skip this model"
            onClick={() => topCardRef.current?.trigger('skip')}
          >
            ✕
          </button>
          <a
            className={styles.linkOut}
            href={top.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open on MakerWorld"
          >
            ↗
          </a>
          <button
            type="button"
            className={styles.likeBtn}
            aria-label="Like this model"
            onClick={() => topCardRef.current?.trigger('like')}
          >
            ♥
          </button>
        </div>
      )}
    </div>
  );
}
