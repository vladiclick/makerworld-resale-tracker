'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ModelDrawer from './ModelDrawer';
import ScrapeControls from './ScrapeControls';
import type { Candidate } from '@/lib/queries';

const POLL_MS = 60_000;

const WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
];

type ApiResponse = {
  candidates: Candidate[];
  categories: string[];
  status: {
    lastRun: { startedAt: number; finishedAt: number | null; status: string; modelsSeen: number } | null;
    lastScoredAt: number | null;
    models: number;
    snapshots: number;
    shortlisted: number;
  };
  servedAt: number;
};

function ago(ts?: number | null) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const nf = new Intl.NumberFormat('en-US');

export default function Dashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [category, setCategory] = useState('');
  const [minEngagement, setMinEngagement] = useState(0);
  const [windowHours, setWindowHours] = useState(168);
  const [quickOnly, setQuickOnly] = useState(false);
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [q, setQ] = useState('');

  const filters = useMemo(() => {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (minEngagement > 0) p.set('minEngagement', String(minEngagement));
    p.set('windowHours', String(windowHours));
    if (quickOnly) p.set('quickPrint', '1');
    if (shortlistedOnly) p.set('shortlisted', '1');
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [category, minEngagement, windowHours, quickOnly, shortlistedOnly, q]);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates?${filtersRef.current}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, filters]);

  // Live feed: poll every 60s. No websockets needed for a single-user tool.
  useEffect(() => {
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const toggleShortlist = async (c: Candidate, e: React.MouseEvent) => {
    e.stopPropagation();
    if (c.shortlisted) {
      await fetch(`/api/shortlist/${c.id}`, { method: 'DELETE' });
    } else {
      await fetch('/api/shortlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: c.id }),
      });
    }
    load();
  };

  const rows = data?.candidates ?? [];

  return (
    <div className="wrap">
      <header className="top">
        <h1>MakerWorld Resale Tracker</h1>
        <span className="sub">
          {data ? `${data.status.models} models · ${nf.format(data.status.snapshots)} snapshots · ${data.status.shortlisted} shortlisted` : 'loading…'}
        </span>
        <div className="spacer" />
        <span className="status-pill">
          last scrape <b>{ago(data?.status.lastRun?.startedAt)}</b>
          {data?.status.lastRun?.status ? ` (${data.status.lastRun.status})` : ''}
        </span>
        <span className="status-pill">
          scored <b>{ago(data?.status.lastScoredAt)}</b>
        </span>
        <ScrapeControls onScraped={load} />
      </header>

      <div className="filters">
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          Min engagement (likes/downloads)
          <input
            type="number"
            step="0.25"
            min="0"
            style={{ width: 80 }}
            value={minEngagement}
            onChange={(e) => setMinEngagement(Number(e.target.value))}
          />
        </label>

        <label>
          Window
          <span style={{ display: 'flex', gap: 4 }}>
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                className={windowHours === w.hours ? 'on' : 'ghost'}
                onClick={() => setWindowHours(w.hours)}
              >
                {w.label}
              </button>
            ))}
          </span>
        </label>

        <button className={quickOnly ? 'on' : 'ghost'} onClick={() => setQuickOnly((v) => !v)}>
          Quick prints only
        </button>
        <button
          className={shortlistedOnly ? 'on' : 'ghost'}
          onClick={() => setShortlistedOnly((v) => !v)}
        >
          Shortlisted only
        </button>

        <input
          placeholder="search name / creator"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <div className="spacer" style={{ flex: 1 }} />
        {error && <span className="err">{error}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {data ? 'No candidates match these filters. Try widening the time window.' : 'Loading…'}
        </div>
      ) : (
        <table className="candidates">
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              <th style={{ width: 66 }} />
              <th>Model</th>
              <th>Category</th>
              <th className="num">Score</th>
              <th className="num">Downloads</th>
              <th className="num">Likes</th>
              <th className="num">Engmt</th>
              <th className="num">Growth/day</th>
              <th className="num">Δ window</th>
              <th style={{ width: 96 }}>Shortlist</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr
                key={c.id}
                className={selected === c.id ? 'selected' : ''}
                onClick={() => setSelected(c.id)}
              >
                <td className="num">{i + 1}</td>
                <td>
                  {/* thumbnails are hot-linked from MakerWorld, never re-hosted */}
                  {c.thumbnailUrl ? (
                    <img className="thumb" src={c.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="thumb" />
                  )}
                </td>
                <td>
                  <div className="name">{c.name}</div>
                  <div className="creator">
                    {c.creator ?? 'unknown'}
                    {c.quickPrint && <span className="tag quick" style={{ marginLeft: 8 }}>quick print</span>}
                  </div>
                </td>
                <td>
                  <span className="tag">{c.category}</span>
                </td>
                <td className="num">
                  <span className="score-badge">{c.score.toFixed(1)}</span>
                </td>
                <td className="num">{nf.format(c.downloads)}</td>
                <td className="num">{nf.format(c.likes)}</td>
                <td className="num">{c.engagementRatio.toFixed(2)}</td>
                <td className="num">{c.growthPerDay ? c.growthPerDay.toFixed(1) : '—'}</td>
                <td className="num">
                  {c.windowGrowth ? <span className="up">+{nf.format(c.windowGrowth)}</span> : '—'}
                </td>
                <td>
                  <button
                    className={c.shortlisted ? 'on' : 'ghost'}
                    onClick={(e) => toggleShortlist(c, e)}
                  >
                    {c.shortlisted ? '★ Saved' : '☆ Save'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <ModelDrawer
          modelId={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
