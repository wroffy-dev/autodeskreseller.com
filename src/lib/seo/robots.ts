/**
 * The site's one robots.txt.
 *
 * Crawlers read robots.txt from the **host root only**. `/ae/robots.txt` is not
 * a file a crawler will ever fetch, so a market does not get its own — its
 * rules are compiled into the single root file, each path written with that
 * market's prefix. Presenting a per-market robots.txt in the admin would be
 * offering a control that does nothing.
 *
 * Two things are deliberately kept apart, because conflating them is the most
 * common way a site disappears from search:
 *
 *  - **Disallow** stops a crawler *fetching* a URL.
 *  - **noindex** asks it not to *list* one.
 *
 * A URL that is disallowed is never fetched, so its noindex is never seen — and
 * it can still be listed from other signals. Blocking crawling to hide a page
 * does the opposite of what it looks like. The admin says so beside the field.
 *
 * robots.txt is also not access control. It is public, and it is advisory.
 * Anything that must not be reached is protected by authentication; this file
 * never lists such a path, because listing it would publish its address.
 */

export type CountryRobots = {
  /** URL prefix, `""` for the root market. */
  slug: string;
  name: string;
  isActive: boolean;
  isPublished: boolean;
  /** One path per line, relative to this market's prefix. */
  disallow: string | null;
  allow: string | null;
  noIndexCountry: boolean;
  excludeFromSitemap: boolean;
};

export type RobotsInput = {
  /** Absolute origin, no trailing slash. */
  baseUrl: string;
  noIndexSite: boolean;
  sitemapEnabled: boolean;
  /** Extra global paths to disallow, one per line. */
  extra: string | null;
  countries: readonly CountryRobots[];
};

/**
 * Paths never disallowed, whatever an administrator types.
 *
 * Blocking these stops a crawler fetching the CSS, JavaScript and images a page
 * needs to render, so it judges the page on a broken version of itself. It is
 * a self-inflicted ranking problem that looks like nothing at all from the
 * admin, which is why it is refused here rather than warned about.
 */
const RENDER_CRITICAL = ['/_next/static', '/_next/image', '/media', '/uploads', '/favicon.ico'];

/** Application paths always disallowed. */
const ALWAYS_DISALLOW = ['/admin', '/admin/', '/api/', '/preview'];

export type RobotsWarning = { level: 'error' | 'warning'; message: string };

/** Splits an admin textarea into clean, rooted paths. */
function paths(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/^(dis)?allow:\s*/i, ''))
    .filter(Boolean)
    .map((line) => (line.startsWith('/') ? line : `/${line}`));
}

/** Joins a market prefix to a path the admin wrote relative to that market. */
function withPrefix(slug: string, path: string): string {
  if (!slug) return path;
  return `/${slug}${path === '/' ? '' : path}`;
}

/**
 * Builds the robots.txt body, and whatever is wrong with it.
 *
 * Returns both so the admin preview and the served file are the same string,
 * produced by the same function. A preview generated a second way would
 * eventually disagree with what crawlers actually get.
 */
export function compileRobots(input: RobotsInput): { body: string; warnings: RobotsWarning[] } {
  const warnings: RobotsWarning[] = [];
  const lines: string[] = [];

  if (input.noIndexSite) {
    // The whole-site switch. Said plainly, because someone will read this file
    // wondering why the site vanished.
    lines.push('# Whole-site crawling is switched off in Admin → SEO.');
    lines.push('User-agent: *');
    lines.push('Disallow: /');
    warnings.push({
      level: 'error',
      message:
        'The entire site is blocked from crawling. Nothing will be indexed while this is on.',
    });
    return { body: `${lines.join('\n')}\n`, warnings };
  }

  const disallow = new Set<string>(ALWAYS_DISALLOW);

  for (const path of paths(input.extra)) {
    if (path === '/') {
      warnings.push({
        level: 'error',
        message:
          'A global rule of "/" would block the whole site. It has been ignored — use the whole-site switch if that is really intended.',
      });
      continue;
    }
    if (blocksRendering(path)) {
      warnings.push({
        level: 'error',
        message: `“${path}” would block the assets pages need to render, so it was ignored.`,
      });
      continue;
    }
    disallow.add(path);
  }

  const allow = new Set<string>();

  for (const country of input.countries) {
    if (!country.isActive) continue;

    for (const path of paths(country.disallow)) {
      const full = withPrefix(country.slug, path);
      if (path === '/' && !country.slug) {
        warnings.push({
          level: 'error',
          message: `A rule of "/" for ${country.name} would block the whole site, because that market is served from the root. It has been ignored.`,
        });
        continue;
      }
      if (blocksRendering(full)) {
        warnings.push({
          level: 'error',
          message: `“${full}” would block the assets pages need to render, so it was ignored.`,
        });
        continue;
      }
      disallow.add(full);
    }

    for (const path of paths(country.allow)) {
      allow.add(withPrefix(country.slug, path));
    }

    if (country.noIndexCountry) {
      warnings.push({
        level: 'warning',
        message: `${country.name} is set to noindex. That is served as a robots meta tag on its pages — it is deliberately not a Disallow rule here, because a blocked page is never fetched and its noindex is never read.`,
      });
    }
  }

  lines.push('User-agent: *');
  for (const path of [...allow].sort()) lines.push(`Allow: ${path}`);
  for (const path of [...disallow].sort()) lines.push(`Disallow: ${path}`);

  if (input.sitemapEnabled) {
    lines.push('');
    // Absolute, as the protocol requires: a relative sitemap reference is
    // ignored.
    lines.push(`Sitemap: ${input.baseUrl}/sitemap.xml`);
  } else {
    warnings.push({
      level: 'warning',
      message: 'Sitemaps are switched off, so robots.txt does not point at one.',
    });
  }

  lines.push('');
  lines.push(`Host: ${input.baseUrl}`);

  // A site with every market blocked is the same outcome as blocking "/", just
  // harder to notice.
  const servingMarkets = input.countries.filter((country) => country.isActive);
  const blocked = servingMarkets.filter((country) =>
    paths(country.disallow).some((path) => path === '/' && country.slug),
  );
  if (servingMarkets.length > 0 && blocked.length === servingMarkets.length) {
    warnings.push({
      level: 'error',
      message: 'Every market is blocked. Between them these rules block the whole public site.',
    });
  }

  return { body: `${lines.join('\n')}\n`, warnings };
}

/** Would this rule stop a crawler fetching what a page needs to render? */
function blocksRendering(path: string): boolean {
  const value = path.toLowerCase();
  return RENDER_CRITICAL.some(
    (critical) => value === critical || critical.startsWith(value) || value.startsWith(critical),
  );
}
