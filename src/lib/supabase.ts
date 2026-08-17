/**
 * Server-only Supabase client.
 *
 * THIS MODULE MUST NEVER BE IMPORTED FROM A 'use client' COMPONENT. It holds
 * the service-role key, which bypasses Row Level Security entirely — if it
 * ever reached the browser bundle, anyone could read/write every table. All
 * browser access must go through Next.js API routes (src/app/api/**), which
 * run on the server and are the only code allowed to call getSupabase().
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requireEnv(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Set it in .env.local (see .env.example) — ` +
        `find it in the Supabase dashboard under Project Settings -> API ` +
        `(${name === 'SUPABASE_URL' ? 'the "Project URL"' : 'the "service_role" secret key'}).`
    );
  }
  return value;
}

let _client: SupabaseClient | null = null;

/** Memoised singleton. Throws the actionable error above if env vars are missing. */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  _client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return _client;
}
