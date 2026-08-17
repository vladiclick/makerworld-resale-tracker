'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { thumb } from '@/lib/thumb';

type Detail = {
  model: {
    id: string;
    name: string;
    creator: string | null;
    url: string;
    thumbnailUrl: string | null;
    category: string | null;
    tags: string[];
    firstSeenAt: number;
    lastSeenAt: number;
  };
  score: {
    score: number;
    engagementRatio: number;
    growthPerDay: number;
    categoryBonus: number;
    quickPrint: boolean;
    downloads: number;
    likes: number;
    computedAt: number;
  } | null;
  history: { ts: number; downloads: number | null; likes: number | null; source: string }[];
  shortlist: {
    printed: boolean;
    listed: boolean;
    sold: boolean;
    salePrice: number | null;
    notes: string | null;
  } | null;
};

const nf = new Intl.NumberFormat('en-US');
const fmtDate = (ts: number) =>
  new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function ModelDrawer({
  modelId,
  onClose,
  onChanged,
}: {
  modelId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/models/${modelId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const json: Detail = await res.json();
    setD(json);
    setNotes(json.shortlist?.notes ?? '');
    setPrice(json.shortlist?.salePrice != null ? String(json.shortlist.salePrice) : '');
  }, [modelId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = async (body: Record<string, unknown>) => {
    await fetch(`/api/shortlist/${modelId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    await load();
    onChanged();
  };

  const removeShortlist = async () => {
    await fetch(`/api/shortlist/${modelId}`, { method: 'DELETE' });
    await load();
    onChanged();
  };

  const chartData =
    d?.history.map((h) => ({
      ts: h.ts,
      label: fmtDate(h.ts),
      downloads: h.downloads ?? 0,
      likes: h.likes ?? 0,
    })) ?? [];

  const sl = d?.shortlist;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <button className="close ghost" onClick={onClose}>
          ✕
        </button>

        {!d ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <h2>{d.model.name}</h2>
            <div className="creator">
              {d.model.creator ?? 'unknown'} · {d.model.category}
            </div>
            <div style={{ marginTop: 8 }}>
              <a href={d.model.url} target="_blank" rel="noreferrer noopener">
                Open on MakerWorld ↗
              </a>
            </div>

            {d.model.thumbnailUrl && (
              /* referenced from MakerWorld's CDN, not copied into this app */
              <img className="cover" src={thumb(d.model.thumbnailUrl, 620)} alt="" decoding="async" />
            )}

            <div className="kv">
              <div>
                <span>Score</span>
                <b>{d.score ? d.score.score.toFixed(1) : '—'}</b>
              </div>
              <div>
                <span>Downloads</span>
                <b>{nf.format(d.score?.downloads ?? 0)}</b>
              </div>
              <div>
                <span>Likes</span>
                <b>{nf.format(d.score?.likes ?? 0)}</b>
              </div>
              <div>
                <span>Engagement</span>
                <b>{d.score ? d.score.engagementRatio.toFixed(2) : '—'}</b>
              </div>
              <div>
                <span>Growth / day</span>
                <b>{d.score ? d.score.growthPerDay.toFixed(1) : '—'}</b>
              </div>
              <div>
                <span>Quick print</span>
                <b>{d.score?.quickPrint ? 'yes' : 'no'}</b>
              </div>
            </div>

            {d.model.tags.length > 0 && (
              <div className="tags-row">
                {d.model.tags.slice(0, 12).map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="section-title">Downloads &amp; likes over time</div>
            <div className="chart-box" style={{ height: 240 }}>
              {chartData.length < 2 ? (
                <div className="empty">
                  Only one snapshot so far — the trend line fills in after the next scrape cycle.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 6, right: 14, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#262d38" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#8b98a8" fontSize={11} minTickGap={30} />
                    <YAxis stroke="#8b98a8" fontSize={11} width={52} />
                    <Tooltip
                      contentStyle={{
                        background: '#161b22',
                        border: '1px solid #262d38',
                        borderRadius: 8,
                        color: '#e6edf3',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="downloads"
                      stroke="#ff7a1a"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="likes"
                      stroke="#4ea3ff"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="section-title">Shortlist &amp; outcome tracking</div>
            <div className="notes-grid">
              <button
                className={sl?.printed ? 'on' : 'ghost'}
                onClick={() => patch({ printed: !sl?.printed })}
              >
                Printed
              </button>
              <button
                className={sl?.listed ? 'on' : 'ghost'}
                onClick={() => patch({ listed: !sl?.listed })}
              >
                Listed on Vinted/OLX
              </button>
              <button className={sl?.sold ? 'on' : 'ghost'} onClick={() => patch({ sold: !sl?.sold })}>
                Sold
              </button>
              <label style={{ fontSize: 12, color: '#8b98a8' }}>
                Sale price (RON)
                <input
                  style={{ width: 90 }}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onBlur={() => patch({ salePrice: price === '' ? null : price })}
                  placeholder="—"
                />
              </label>
              {sl && (
                <button className="ghost" onClick={removeShortlist}>
                  Remove from shortlist
                </button>
              )}
              {saved && <span className="saved">saved</span>}
            </div>

            <textarea
              placeholder="Notes: filament used, print time, listing price, what sold…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => patch({ notes })}
            />
            <div className="creator" style={{ marginTop: 6 }}>
              First seen {fmtDate(d.model.firstSeenAt)} · last seen {fmtDate(d.model.lastSeenAt)}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
