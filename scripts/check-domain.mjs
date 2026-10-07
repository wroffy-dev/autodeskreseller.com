#!/usr/bin/env node
/**
 * Does every address of the site end up at the one it should, and does the
 * site then call itself by that address?
 *
 * Give it the site's real address — the one NEXT_PUBLIC_SITE_URL should hold.
 * It tries the bare domain and the www one, over http and https, a deep link
 * with a query string among them, following each redirect by hand; then it
 * reads the canonical tag, og:url, robots.txt and the sitemaps on the real
 * address and checks every URL in them uses it. A canonical or sitemap URL on
 * the other host points search engines at a redirect.
 *
 * Usage:
 *   node scripts/check-domain.mjs https://www.example.com
 *   node scripts/check-domain.mjs https://www.example.com /pricing /ae
 *
 * Read-only; needs no credentials. Exits 1 when a check fails.
 */

const [target, ...extraPaths] = process.argv.slice(2);

if (!target) {
  console.error('Usage: node scripts/check-domain.mjs <https://www.your-domain> [path ...]');
  process.exit(2);
}

let canonical;
try {
  canonical = new URL(target);
} catch {
  console.error(`Not a valid URL: ${target}`);
  process.exit(2);
}

const TIMEOUT_MS = 20_000;
const MAX_HOPS = 10;
const port = canonical.port ? `:${canonical.port}` : '';
const wwwHost = canonical.hostname.startsWith('www.') ? canonical.hostname : `www.${canonical.hostname}`;
const apexHost = canonical.hostname.replace(/^www\./, '');
const otherHost = canonical.hostname === wwwHost ? apexHost : wwwHost;
const origin = `${canonical.protocol}//${canonical.hostname}${port}`;

let failures = 0;
const pass = (message) => console.log(`  PASS  ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const note = (message) => console.log(`  ....  ${message}`);

async function request(url) {
  return fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'check-domain' },
  });
}

/** Follows redirects one hop at a time, so every hop can be judged. */
async function follow(start) {
  const hops = [];
  let url = start;
  const seen = new Set();
  for (let index = 0; index < MAX_HOPS; index += 1) {
    if (seen.has(url)) return { hops, final: url, loop: true };
    seen.add(url);
    const response = await request(url);
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url).toString();
      hops.push({ from: url, status: response.status, to: next });
      url = next;
      continue;
    }
    return { hops, final: url, status: response.status, response };
  }
  return { hops, final: url, loop: true };
}

function sameTarget(expected, actual) {
  const a = new URL(expected);
  const b = new URL(actual);
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
}

// ---------------------------------------------------------------------------
// 1. Every address arrives at the real one
// ---------------------------------------------------------------------------

console.log(`Real address: ${origin}\n\nRedirects`);

const protocols = canonical.protocol === 'https:' ? ['http:', 'https:'] : ['http:'];
const starts = [];
for (const protocol of protocols) {
  for (const host of [otherHost, canonical.hostname]) {
    starts.push(`${protocol}//${host}${port}/`);
  }
}
starts.push(`${canonical.protocol}//${otherHost}${port}/pricing?utm_source=check-domain&x=1`);
if (protocols.includes('http:') && canonical.protocol === 'https:') {
  starts.push(`http://${otherHost}${port}/pricing?utm_source=check-domain&x=1`);
}

for (const start of starts) {
  const startUrl = new URL(start);
  const expected = `${origin}${startUrl.pathname}${startUrl.search}`;
  let result;
  try {
    result = await follow(start);
  } catch (error) {
    fail(`${start} → could not connect (${error instanceof Error ? error.cause?.code ?? error.message : error})`);
    continue;
  }
  const chain = result.hops.map((hop) => `${hop.status} → ${hop.to}`).join('  ');
  const label = `${start}${chain ? `  ${chain}` : ''}`;
  if (result.loop) {
    fail(`${label}  — redirect loop`);
    continue;
  }
  if (start === expected) {
    if (result.hops.length === 0 && result.status === 200) pass(`${start} serves the site (200)`);
    else fail(`${label}  — the real address should answer 200 without redirecting (got ${result.status})`);
    continue;
  }
  const temporary = result.hops.filter((hop) => hop.status === 302 || hop.status === 307 || hop.status === 303);
  if (!sameTarget(expected, result.final)) {
    fail(`${label}  — ends at ${result.final}, expected ${expected}`);
  } else if (temporary.length > 0) {
    fail(`${label}  — ${temporary.map((hop) => hop.status).join(', ')} is temporary; use 301 or 308 so search engines move the ranking`);
  } else if (result.status !== 200) {
    fail(`${label}  — the final page answered ${result.status}`);
  } else if (result.hops.length > 2) {
    fail(`${label}  — ${result.hops.length} hops; one is best, two at most`);
  } else {
    pass(`${label}${result.hops.length === 2 ? '  (two hops: one would be better)' : ''}`);
  }
}

// ---------------------------------------------------------------------------
// 2. The site calls itself by the real address
// ---------------------------------------------------------------------------

console.log(`\nWhat the site calls itself`);

function urlsIn(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function judgeUrls(what, urls) {
  if (urls.length === 0) {
    note(`${what}: none found`);
    return;
  }
  const wrong = urls.filter((url) => {
    try {
      return new URL(url).origin !== origin;
    } catch {
      return true;
    }
  });
  if (wrong.length === 0) pass(`${what}: ${urls.length} URL${urls.length === 1 ? '' : 's'}, all on ${origin}`);
  else
    fail(
      `${what}: ${wrong.length} of ${urls.length} on another address, e.g. ${wrong[0]} — set NEXT_PUBLIC_SITE_URL and NEXTAUTH_URL to ${origin} and redeploy`,
    );
}

for (const path of ['/', ...extraPaths]) {
  try {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const html = await response.text();
    const canonicalTags = urlsIn(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/gi);
    const ogUrls = urlsIn(html, /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/gi);
    const alternates = urlsIn(html, /<link[^>]+rel=["']alternate["'][^>]*hreflang=["'][^"']+["'][^>]*href=["']([^"']+)["']/gi);
    judgeUrls(`${path} canonical`, canonicalTags);
    judgeUrls(`${path} og:url`, ogUrls);
    if (alternates.length > 0) judgeUrls(`${path} hreflang`, alternates);
  } catch (error) {
    fail(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const robots = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = robots.ok ? await robots.text() : '';
  judgeUrls('robots.txt Sitemap', urlsIn(body, /^\s*sitemap:\s*(\S+)/gim));
  judgeUrls('robots.txt Host', urlsIn(body, /^\s*host:\s*(\S+)/gim));
} catch (error) {
  fail(`robots.txt: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const index = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = index.ok ? await index.text() : '';
  const children = urlsIn(body, /<loc>([^<]+)<\/loc>/g);
  judgeUrls('sitemap.xml', children);
  const first = children.find((url) => url.startsWith(origin));
  if (first) {
    const child = await fetch(first, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    judgeUrls(new URL(first).pathname, urlsIn(child.ok ? await child.text() : '', /<loc>([^<]+)<\/loc>/g));
  }
} catch (error) {
  fail(`sitemap.xml: ${error instanceof Error ? error.message : String(error)}`);
}

if (canonical.protocol === 'https:') {
  try {
    const home = await fetch(`${origin}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const hsts = home.headers.get('strict-transport-security');
    if (hsts) pass(`HSTS: ${hsts}`);
    else fail('No Strict-Transport-Security header on the real address');
  } catch (error) {
    fail(`HSTS: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check${failures === 1 ? '' : 's'} failed.`);
process.exit(failures === 0 ? 0 : 1);
