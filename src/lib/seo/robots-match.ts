/**
 * Does a robots.txt let crawlers fetch a path?
 *
 * Reads the body `compileRobots` produces — the same string /robots.txt
 * serves — and applies the rule every major crawler uses: of the Allow and
 * Disallow lines that match, the longest wins, and Allow wins a tie. `*`
 * matches anything and a trailing `$` anchors the end, as the standard
 * (RFC 9309) defines.
 */

export type RobotsRules = { allow: string[]; disallow: string[] };

/** The rules that apply to every crawler (`User-agent: *`). */
export function parseRobots(body: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let applies = false;
  let lastWasAgent = false;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      // Consecutive User-agent lines form one group.
      applies = lastWasAgent ? applies || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies) continue;
    if (field === 'allow' && value) rules.allow.push(value);
    if (field === 'disallow' && value) rules.disallow.push(value);
  }
  return rules;
}

function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

/** The Disallow rule that blocks `path`, or null when crawling is allowed. */
export function blockingRule(rules: RobotsRules, path: string): string | null {
  let bestAllow = -1;
  let bestDisallow: string | null = null;
  for (const rule of rules.allow) {
    if (matches(rule, path)) bestAllow = Math.max(bestAllow, rule.length);
  }
  for (const rule of rules.disallow) {
    if (matches(rule, path) && (!bestDisallow || rule.length > bestDisallow.length)) bestDisallow = rule;
  }
  if (!bestDisallow) return null;
  return bestDisallow.length > bestAllow ? bestDisallow : null;
}
