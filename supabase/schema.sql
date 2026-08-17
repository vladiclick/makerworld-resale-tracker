-- MakerWorld Resale Tracker — Supabase (Postgres) schema.
--
-- Idempotent: every statement is safe to re-run (CREATE ... IF NOT EXISTS).
-- Apply it via the Supabase dashboard SQL Editor, or:
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--
-- Security note: Row Level Security is enabled on every table below with
-- NO policies attached. That means PostgREST (the anon/authenticated keys)
-- can see and change NOTHING in these tables — every request through the
-- public API is denied by default. The app only ever talks to Postgres
-- through this server's SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS
-- entirely, so the app keeps working. If you ever add an anon/browser
-- client, it will get zero access here until you deliberately write a
-- policy — that's intentional, not a bug.

-- One row per MakerWorld model. Mutable metadata + latest known stats;
-- full history lives in `snapshots`.
create table if not exists models (
  id                bigint generated always as identity primary key,
  makerworld_id     text not null unique,          -- MakerWorld's numeric model id, as text
  name              text not null,
  creator           text,
  url               text not null,
  thumbnail_url     text,                           -- reference only, never re-hosted
  category          text,                           -- our target label, e.g. "Fashion > Earrings"
  tags              jsonb not null default '[]'::jsonb,
  downloads         integer,
  likes             integer,
  liked             boolean not null default false,  -- manual "interesting" flag, unrelated to shortlist
  liked_at          timestamptz,
  first_seen_at     timestamptz not null default now(),
  last_scraped_at   timestamptz not null default now()
);

-- Append-only history. Never updated, never overwritten.
create table if not exists snapshots (
  id         bigint generated always as identity primary key,
  model_id   bigint not null references models(id) on delete cascade,
  ts         timestamptz not null default now(),
  downloads  integer,
  likes      integer
);
create index if not exists idx_snapshots_model_ts on snapshots (model_id, ts desc);

-- Your shortlist: candidates plus the ground-truth outcome once you act on them.
create table if not exists shortlist (
  model_id    bigint primary key references models(id) on delete cascade,
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  printed     boolean not null default false,
  listed      boolean not null default false,
  sold        boolean not null default false,
  sale_price  numeric,                              -- RON, optional
  notes       text
);

-- Run log; powers the dashboard's "last scrape" status pill.
create table if not exists scrape_runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',      -- running | ok | partial | error
  models_seen  integer not null default 0,
  category     text,
  error        text
);

-- Snapshots older than the retention window collapse into one row per model
-- per UTC day (last observation of that day wins).
create table if not exists daily_summaries (
  model_id   bigint not null references models(id) on delete cascade,
  day        date not null,
  ts         timestamptz not null,
  downloads  integer,
  likes      integer,
  samples    integer not null default 1,
  primary key (model_id, day)
);

-- Row Level Security: enabled everywhere, no policies anywhere (see comment
-- at the top of this file). The service-role key bypasses RLS by design;
-- the anon key is granted nothing.
-- Licence string exactly as MakerWorld reports it (e.g. "Standard Digital File
-- License", "BY-NC-SA", "CC0"). Classification lives in src/lib/license.ts so
-- it can be corrected without a migration. This matters: MakerWorld's Standard
-- Digital File License forbids selling prints, and it covers ~80% of models.
alter table models add column if not exists license text;

alter table models          enable row level security;
alter table snapshots       enable row level security;
alter table shortlist       enable row level security;
alter table scrape_runs     enable row level security;
alter table daily_summaries enable row level security;

-- ---------------------------------------------------------------------------
-- RPC functions. Both exist so the app layer can do a batch operation in a
-- single round trip instead of one query per row.
-- ---------------------------------------------------------------------------

-- Batch upsert of scraped model metadata, keyed on makerworld_id.
-- On conflict: refreshes name/creator/url/thumbnail_url/tags/downloads/likes
-- and last_scraped_at. Deliberately leaves `category`, `first_seen_at`,
-- `liked` and `liked_at` untouched on conflict — category is set once at
-- first sight, and liked/liked_at are a manual flag the scraper must never
-- touch. `payload` is a JSON array of objects with keys: makerworld_id,
-- name, creator, url, thumbnail_url, category, tags, downloads, likes.
-- Returns the full upserted rows so the caller can map makerworld_id -> id
-- for the snapshot insert that follows.
create or replace function upsert_models(payload jsonb)
returns setof models
language plpgsql
as $$
begin
  return query
  insert into models (
    makerworld_id, name, creator, url, thumbnail_url, category, tags,
    downloads, likes, license, first_seen_at, last_scraped_at
  )
  select
    r.makerworld_id, r.name, r.creator, r.url, r.thumbnail_url, r.category,
    coalesce(r.tags, '[]'::jsonb), r.downloads, r.likes, r.license, now(), now()
  from jsonb_to_recordset(payload) as r(
    makerworld_id text, name text, creator text, url text, thumbnail_url text,
    category text, tags jsonb, downloads integer, likes integer, license text
  )
  on conflict (makerworld_id) do update set
    name            = excluded.name,
    creator         = excluded.creator,
    url             = excluded.url,
    thumbnail_url   = excluded.thumbnail_url,
    tags            = excluded.tags,
    downloads       = excluded.downloads,
    likes           = excluded.likes,
    license         = coalesce(excluded.license, models.license),
    last_scraped_at = excluded.last_scraped_at
  returning *;
end;
$$;

-- Collapse raw snapshots older than raw_days into daily_summaries (last
-- observation of each UTC day wins), then delete the collapsed raw rows.
-- Idempotent: re-running with no new old rows collapses zero rows.
-- Returns the number of raw snapshot rows deleted.
create or replace function collapse_old_snapshots(raw_days integer default 90)
returns integer
language plpgsql
as $$
declare
  cutoff timestamptz := now() - (raw_days || ' days')::interval;
  deleted_count integer;
begin
  with ranked as (
    select
      s.model_id,
      (s.ts at time zone 'utc')::date as day,
      s.ts,
      s.downloads,
      s.likes,
      count(*) over (partition by s.model_id, (s.ts at time zone 'utc')::date) as samples,
      row_number() over (
        partition by s.model_id, (s.ts at time zone 'utc')::date
        order by s.ts desc
      ) as rn
    from snapshots s
    where s.ts < cutoff
  )
  insert into daily_summaries (model_id, day, ts, downloads, likes, samples)
  select model_id, day, ts, downloads, likes, samples
    from ranked
   where rn = 1
  on conflict (model_id, day) do update set
    ts        = excluded.ts,
    downloads = excluded.downloads,
    likes     = excluded.likes,
    samples   = daily_summaries.samples + excluded.samples;

  delete from snapshots where ts < cutoff;
  get diagnostics deleted_count = row_count;

  return deleted_count;
end;
$$;
