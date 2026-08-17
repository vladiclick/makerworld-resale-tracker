/**
 * Applies supabase/schema.sql to the Supabase Postgres database.
 *
 * PostgREST (what supabase-js talks to) can't run DDL, so this connects
 * straight to Postgres with `pg`. Needs SUPABASE_DB_URL in .env.local:
 *
 *   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
 *
 * Grab it from the Supabase dashboard: Connect -> Direct/Connection string ->
 * Session pooler (the session pooler works over IPv4; the direct connection is
 * IPv6-only). The schema is idempotent, so re-running this is safe.
 */
import './_env';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error(
      'Missing SUPABASE_DB_URL in .env.local — see the comment at the top of this file.'
    );
  }

  const sql = readFileSync(path.join(process.cwd(), 'supabase', 'schema.sql'), 'utf8');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`
    );
    console.log('schema applied. public tables:', rows.map((r) => r.table_name).join(', '));

    const { rows: fns } = await client.query(
      `select routine_name from information_schema.routines
        where routine_schema = 'public' order by routine_name`
    );
    console.log('functions:', fns.map((r) => r.routine_name).join(', ') || '(none)');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('apply-schema failed:', e.message);
  process.exit(1);
});
