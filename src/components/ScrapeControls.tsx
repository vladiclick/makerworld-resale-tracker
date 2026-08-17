'use client';

import { useState } from 'react';
import { CATEGORY_LABELS } from '@/lib/config';

type Props = {
  /** Called once a run finishes (success or partial) so the dashboard can refresh its table. */
  onScraped: () => void;
};

const MIN_COUNT = 1;
const MAX_COUNT = 50;
const DEFAULT_COUNT = 20;

/**
 * Mirrors SCRAPE.delayMinMs/delayMaxMs on the server (src/lib/config.ts).
 * A single POST to /api/scrape only makes one upstream MakerWorld request
 * (the route caps each invocation's batch well under MakerWorld's 20-item
 * page size), but reaching a larger requested count means this component
 * fires several POSTs back-to-back. This delay keeps that *sequence* of
 * calls polite too, since a stateless serverless function can't remember
 * pacing between separate invocations — the client has to own it instead.
 * Not read from env: these are constants baked into the client bundle, and
 * non-NEXT_PUBLIC_ env vars aren't available there anyway.
 */
const CLIENT_DELAY_MIN_MS = 2000;
const CLIENT_DELAY_MAX_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ScrapeResponse = {
  ok: boolean;
  error?: string;
  scraped?: number;
  totalDone?: number;
  done?: boolean;
  nextOffset?: number;
};

export default function ScrapeControls({ onScraped }: Props) {
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [category, setCategory] = useState(CATEGORY_LABELS[0] ?? '');
  const [running, setRunning] = useState(false);
  const [scrapedSoFar, setScrapedSoFar] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (running || !category) return;
    setRunning(true);
    setError(null);
    setScrapedSoFar(0);

    let offset = 0;
    let done = false;

    try {
      while (!done) {
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category, count, offset }),
        });
        const j = (await res.json()) as ScrapeResponse;
        if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);

        offset = j.nextOffset ?? offset;
        setScrapedSoFar(j.totalDone ?? offset);
        done = !!j.done;

        if (!done) {
          await sleep(CLIENT_DELAY_MIN_MS + Math.random() * (CLIENT_DELAY_MAX_MS - CLIENT_DELAY_MIN_MS));
        }
      }
      onScraped();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const pct = count > 0 ? Math.min(100, Math.round((scrapedSoFar / count) * 100)) : 0;

  return (
    <div className="scrape-controls">
      <label>
        How many products to scrape
        <input
          type="number"
          min={MIN_COUNT}
          max={MAX_COUNT}
          value={count}
          disabled={running}
          onChange={(e) => {
            const n = Number(e.target.value);
            setCount(Number.isFinite(n) ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.trunc(n))) : DEFAULT_COUNT);
          }}
        />
      </label>

      <label>
        Category
        <select value={category} disabled={running} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_LABELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <button className="primary" onClick={run} disabled={running || !category}>
        {running ? `Scraping ${scrapedSoFar} of ${count}…` : 'Scrape now'}
      </button>

      {running && (
        <div className="scrape-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="scrape-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}

      {error && <span className="err">{error}</span>}
    </div>
  );
}
