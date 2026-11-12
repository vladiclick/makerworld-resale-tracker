import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from './robots';

const SAMPLE = `
# MakerWorld-style rules
User-agent: Googlebot
Disallow: /only-for-google

User-agent: *
Disallow: /api/
Disallow: /en/search
Allow: /api/v1/design-service/
Disallow: /*.json$
`;

describe('parseRobots', () => {
  it('keeps only the rules from the * group', () => {
    const rules = parseRobots(SAMPLE);
    expect(rules.disallow).toEqual(['/api/', '/en/search', '/*.json$']);
    expect(rules.allow).toEqual(['/api/v1/design-service/']);
  });

  it('ignores comments, blank lines and empty Disallow values', () => {
    const rules = parseRobots('User-agent: * # everyone\nDisallow:\n\nDisallow: /private # keep out\n');
    expect(rules.disallow).toEqual(['/private']);
    expect(rules.allow).toEqual([]);
  });

  it('is case-insensitive on directive names', () => {
    const rules = parseRobots('USER-AGENT: *\nDISALLOW: /x\nallow: /x/y');
    expect(rules).toEqual({ disallow: ['/x'], allow: ['/x/y'] });
  });

  it('applies a group whose User-agent run lists * after another agent', () => {
    const rules = parseRobots('User-agent: Googlebot\nUser-agent: *\nDisallow: /shared');
    expect(rules.disallow).toEqual(['/shared']);
  });

  it('applies a group whose User-agent run lists * before another agent', () => {
    const rules = parseRobots('User-agent: *\nUser-agent: Googlebot\nDisallow: /shared');
    expect(rules.disallow).toEqual(['/shared']);
  });

  it('starts a new group once a rule has ended the User-agent run', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a\nUser-agent: Googlebot\nDisallow: /b');
    expect(rules.disallow).toEqual(['/a']);
  });

  it('keeps colons inside the value', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a:b');
    expect(rules.disallow).toEqual(['/a:b']);
  });
});

describe('isAllowed', () => {
  const rules = parseRobots(SAMPLE);
  const url = (path: string) => `https://makerworld.com${path}`;

  it('allows paths no rule matches', () => {
    expect(isAllowed(rules, url('/en/3d-models/401-decor'))).toBe(true);
  });

  it('blocks a disallowed prefix', () => {
    expect(isAllowed(rules, url('/api/private'))).toBe(false);
    expect(isAllowed(rules, url('/en/search?keyword=vase'))).toBe(false);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    expect(isAllowed(rules, url('/api/v1/design-service/published/123'))).toBe(true);
  });

  it('supports * wildcards and the $ end anchor', () => {
    expect(isAllowed(rules, url('/en/models/feed.json'))).toBe(false);
    expect(isAllowed(rules, url('/en/models/feed.json.html'))).toBe(true);
  });

  it('breaks an equal-length tie in favour of Allow', () => {
    const tie = parseRobots('User-agent: *\nDisallow: /page\nAllow: /page');
    expect(isAllowed(tie, url('/page'))).toBe(true);
  });

  it('allows everything when the * group has no rules', () => {
    expect(isAllowed(parseRobots('User-agent: Googlebot\nDisallow: /'), url('/anything'))).toBe(true);
  });
});
