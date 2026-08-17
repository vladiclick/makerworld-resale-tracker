/**
 * Minimal robots.txt check for the `*` user-agent group.
 * MakerWorld serves its rules from /en/robots.txt (root redirects there).
 */
type Rules = { allow: string[]; disallow: string[] };

let cache: { rules: Rules; fetchedAt: number } | null = null;
const TTL = 24 * 60 * 60 * 1000;

export function parseRobots(txt: string): Rules {
  const rules: Rules = { allow: [], disallow: [] };
  let inStar = false;
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      inStar = value === '*';
    } else if (inStar && key === 'disallow' && value) {
      rules.disallow.push(value);
    } else if (inStar && key === 'allow' && value) {
      rules.allow.push(value);
    }
  }
  return rules;
}

/** Wildcard-aware path match ("*" = any run of chars, trailing "$" = end anchor). */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    '^' + p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '')
  );
  return re.test(path);
}

export function isAllowed(rules: Rules, url: string): boolean {
  const path = new URL(url).pathname + new URL(url).search;
  const longest = (list: string[]) =>
    list.filter((p) => matches(p, path)).reduce((a, b) => (b.length > a.length ? b : a), '');
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  if (!disallow) return true;
  return allow.length >= disallow.length; // most specific rule wins, allow breaks ties
}

/** Fetches (and caches for 24h) MakerWorld's robots.txt using a real browser page. */
export async function loadRobots(
  fetchText: (url: string) => Promise<string>
): Promise<Rules> {
  if (cache && Date.now() - cache.fetchedAt < TTL) return cache.rules;
  const txt = await fetchText('https://makerworld.com/en/robots.txt');
  const rules = parseRobots(txt);
  cache = { rules, fetchedAt: Date.now() };
  return rules;
}
