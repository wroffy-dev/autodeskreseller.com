import 'server-only';
import { getUrlSnapshot } from './load';
import { joinMarket } from './path';
import { resolvePattern } from './snapshot';
import { DEFAULT_PATTERNS, type UrlContentType } from './types';

/**
 * The pattern new content of a type gets, as the site serves it right now:
 * the saved one while the registry is switched on, the built-in one while
 * the previous router answers — so a form never promises an address the
 * site would not serve.
 */
export async function effectivePattern(type: UrlContentType, countryId: string | null): Promise<string> {
  const snapshot = await getUrlSnapshot();
  if (!snapshot.enabled) return DEFAULT_PATTERNS[type];
  return resolvePattern(snapshot, type, countryId ?? snapshot.rootCountryId);
}

/** "/blog/…": a pattern with its slug left open, for a form hint. */
export function patternHint(pattern: string, marketSlug = ''): string {
  return joinMarket(marketSlug, pattern).replace('{slug}', '…');
}
