/**
 * Storage moved from a local SQLite file to Supabase (Postgres) — see
 * supabase/schema.sql for the schema. supabase-js talks to Postgres through
 * PostgREST, which has no "run this arbitrary multi-statement SQL file"
 * call (by design: the REST API only ever touches known tables/RPCs), so
 * there's nothing for this script to execute directly. It just prints the
 * DDL and where to run it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql');
const sql = readFileSync(schemaPath, 'utf8');

console.log(sql);
console.log('--- apply this schema ---');
console.log('Supabase dashboard -> SQL Editor -> paste the above -> Run');
console.log('or: psql "$SUPABASE_DB_URL" -f supabase/schema.sql');
