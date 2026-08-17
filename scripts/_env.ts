/**
 * Env loader for the CLI scripts.
 *
 * `import 'dotenv/config'` only reads `.env` — but Next.js itself reads
 * `.env.local` first, and that's where the Supabase credentials live (it's the
 * gitignored one). Without this, `npm run scrape` / `migrate:supabase` / etc.
 * would see no credentials while `npm run dev` worked fine, which is a
 * confusing way to lose an afternoon.
 *
 * Import this FIRST in every script: `import './_env';`
 */
import { config } from 'dotenv';

// .env.local wins, .env fills in the gaps (dotenv never overwrites what's set).
config({ path: '.env.local' });
config({ path: '.env' });
