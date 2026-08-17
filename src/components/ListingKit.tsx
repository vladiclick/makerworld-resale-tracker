'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { thumb } from '@/lib/thumb';
import styles from './ListingKit.module.css';

/**
 * One listing at a time, with copy buttons. Deliberately manual: OLX and
 * Vinted both ban scripted posting, and every listing needs photos of the
 * actual print anyway. This gets a post down to about a minute.
 */

type Listing = {
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  priceSuggested: number;
  olxCategory: string;
  vintedCategory: string;
  tags: string[];
  attribution: string | null;
  licenseWarning: string | null;
};

type Row = {
  modelId: string;
  name: string;
  creator: string | null;
  url: string;
  imageUrl: string | null;
  category: string | null;
  license: string | null;
  sellable: 'yes' | 'conditional' | 'no' | 'unknown';
  listing: Listing;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={done ? 'on' : 'ghost'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked - the text is on screen to select manually */
        }
      }}
    >
      {done ? '✓ Copiat' : label}
    </button>
  );
}

export default function ListingKit() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [i, setI] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/listings', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setRows(j.listings as Row[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="empty err">{error}</div>;
  if (!rows) return <div className="empty">Loading…</div>;
  if (rows.length === 0)
    return (
      <div className="empty">
        Nothing liked yet — go to <Link href="/swipe">Swipe</Link> and pick some.
      </div>
    );

  const row = rows[Math.min(i, rows.length - 1)];
  const l = row.listing;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1>Listing kit</h1>
        <span className={styles.count}>
          {i + 1} / {rows.length}
        </span>
        <div className={styles.spacer} />
        <button className="ghost" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>
          ← Înapoi
        </button>
        <button
          className="primary"
          onClick={() => setI((n) => Math.min(rows.length - 1, n + 1))}
          disabled={i >= rows.length - 1}
        >
          Următorul →
        </button>
      </header>

      {l.licenseWarning && (
        <div className={row.sellable === 'no' ? styles.blocked : styles.warn}>
          ⚖ {l.licenseWarning}
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.left}>
          {row.imageUrl && <img className={styles.cover} src={thumb(row.imageUrl, 420)} alt="" />}
          <div className={styles.note}>
            Referință model — pozele din anunț trebuie să fie cu printul tău real.
          </div>
          <a href={row.url} target="_blank" rel="noreferrer noopener">
            Deschide pe MakerWorld ↗
          </a>
        </div>

        <div className={styles.right}>
          <label className={styles.field}>
            <span>Titlu</span>
            <div className={styles.value}>{l.title}</div>
            <CopyButton value={l.title} label="Copiază titlul" />
          </label>

          <label className={styles.field}>
            <span>Preț sugerat (RON)</span>
            <div className={styles.value}>
              <b className={styles.price}>{l.priceSuggested} lei</b>
              <span className={styles.range}>
                interval de piață {l.priceMin}–{l.priceMax} lei
              </span>
            </div>
            <CopyButton value={String(l.priceSuggested)} label="Copiază prețul" />
          </label>

          <label className={styles.field}>
            <span>Descriere</span>
            <pre className={styles.desc}>{l.description}</pre>
            <CopyButton value={l.description} label="Copiază descrierea" />
          </label>

          <div className={styles.twoCol}>
            <label className={styles.field}>
              <span>Categorie OLX</span>
              <div className={styles.value}>{l.olxCategory}</div>
            </label>
            <label className={styles.field}>
              <span>Categorie Vinted</span>
              <div className={styles.value}>{l.vintedCategory}</div>
            </label>
          </div>

          <label className={styles.field}>
            <span>Etichete</span>
            <div className={styles.tags}>
              {l.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <CopyButton value={l.tags.join(', ')} label="Copiază etichetele" />
          </label>
        </div>
      </div>
    </div>
  );
}
