/* eslint-disable no-console */
/**
 * Clones one market's content into another, so a new storefront can open with
 * something on it instead of a 404.
 *
 * A market is a `Country` row plus its content. Creating the row is a moment's
 * work in the admin; filling it is not, and until it is filled the storefront
 * has no home page and nothing to show. This copies the pages, articles, menus,
 * product listings and marketing copy across, keeping every slug identical so
 * the two markets stay comparable.
 *
 * What it deliberately does NOT copy:
 *
 *   Money.       Prices are a commercial decision, not an arithmetic one. With
 *                `--rate` the source prices are carried across multiplied, as a
 *                starting point for someone to edit; without it a priced
 *                listing is copied with no price and held back as a draft
 *                rather than shown at nothing. Nothing here reads a live
 *                exchange rate, and nothing converts at render time.
 *   Contact      Phone numbers, addresses and tax identifiers belong to the
 *   details.     market they were written for. A wrong number on a live
 *                storefront is worse than a blank one, so these are left for
 *                the operator to fill in.
 *   Canonicals.  A market canonicals to its own URL. Inheriting the source's
 *                would point the copy at the other market's page.
 *
 * Re-running is safe: every write is keyed on (country, slug), so a second run
 * updates what it made the first time rather than creating a second copy.
 *
 * Usage:
 *   node scripts/clone-market.mjs --from IN --to AE --dry-run
 *   node scripts/clone-market.mjs --from IN --to AE --publish --rate 0.044
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, publish: false, activate: false, rate: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--publish') args.publish = true;
    else if (token === '--activate') args.activate = true;
    else if (token === '--from') args.from = argv[++i];
    else if (token === '--to') args.to = argv[++i];
    else if (token === '--rate') args.rate = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
    else die(`Unknown argument: ${token}`);
  }
  return args;
}

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const USAGE = `
Clone one market's content into another.

  node scripts/clone-market.mjs --from IN --to AE [options]

  --from <code>   Market to copy from, e.g. IN
  --to <code>     Market to copy into, e.g. AE
  --rate <n>      Multiply source prices by n as a starting point for the new
                  market (e.g. 0.044 for INR to AED). Without it, a listing
                  that has a price is copied without one and held as a draft.
  --publish       Publish the copied pages and articles. Without it everything
                  lands as a draft for review.
  --activate      Switch the target market on once it has a home page.
  --dry-run       Print what would happen and write nothing.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!args.from || !args.to) die(`--from and --to are both required.\n${USAGE}`);
if (args.from.toUpperCase() === args.to.toUpperCase()) die('--from and --to are the same market.');

let rate = null;
if (args.rate !== null) {
  rate = Number(args.rate);
  if (!Number.isFinite(rate) || rate <= 0) die(`--rate must be a positive number, got: ${args.rate}`);
}

const plan = [];
function record(line) {
  plan.push(line);
  console.log(`  ${line}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Source money carried across at the given rate, rounded to two places. */
function convert(value) {
  if (value === null || value === undefined) return null;
  if (rate === null) return null;
  return new Prisma.Decimal(value).mul(rate).toDecimalPlaces(2);
}

const publishedState = (sourceStatus, sourcePublishedAt) =>
  args.publish
    ? { status: sourceStatus, publishedAt: sourcePublishedAt ?? new Date() }
    : { status: 'DRAFT', publishedAt: null };

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

async function clonePages(from, to) {
  const pages = await prisma.page.findMany({
    // City pages belong to their city, and a city to one market: not cloned.
    where: { countryId: from.id, deletedAt: null, cityId: null },
    include: { sections: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  const idBySlug = new Map();

  for (const source of pages) {
    const shared = {
      title: source.title,
      ...publishedState(source.status, source.publishedAt),
      // The source's home page becomes the target's home page. A market
      // without one has no root to serve, which is the whole problem this
      // script exists to solve.
      isHomepage: source.isHomepage,
      categoryId: source.categoryId,
      showHeader: source.showHeader,
      showFooter: source.showFooter,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      canonicalUrl: null,
      noIndex: source.noIndex,
      noFollow: source.noFollow,
      ogTitle: source.ogTitle,
      ogDescription: source.ogDescription,
      ogImageId: source.ogImageId,
      twitterTitle: source.twitterTitle,
      twitterDescription: source.twitterDescription,
      twitterImageId: source.twitterImageId,
    };

    const sections = source.sections.map((section) => ({
      blockType: section.blockType,
      name: section.name,
      sortOrder: section.sortOrder,
      isVisible: section.isVisible,
      content: section.content ?? {},
      settings: section.settings ?? {},
    }));

    const label = `/${source.slug || ''}${source.isHomepage ? '  (home page)' : ''}`;

    const existing = await prisma.page.findUnique({
      where: { countryId_slug: { countryId: to.id, slug: source.slug } },
      select: { id: true },
    });
    const verb = existing ? 'replace' : 'create ';

    if (args.dryRun) {
      record(`${verb} page    ${label} — ${sections.length} sections`);
      continue;
    }

    let copy;
    if (existing) {
      await prisma.pageSection.deleteMany({ where: { pageId: existing.id } });
      copy = await prisma.page.update({
        where: { id: existing.id },
        data: { ...shared, deletedAt: null, sections: { create: sections } },
      });
    } else {
      copy = await prisma.page.create({
        data: { ...shared, countryId: to.id, slug: source.slug, sections: { create: sections } },
      });
    }

    idBySlug.set(source.slug, copy.id);
    record(`${verb} page    ${label} — ${sections.length} sections`);
  }

  return idBySlug;
}

// ---------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------

async function clonePosts(from, to) {
  const posts = await prisma.blogPost.findMany({
    where: { countryId: from.id, deletedAt: null },
    include: { tags: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const source of posts) {
    const shared = {
      title: source.title,
      subtitle: source.subtitle,
      ...publishedState(source.status, source.publishedAt),
      excerpt: source.excerpt,
      content: source.content,
      readingTime: source.readingTime,
      isFeatured: false,
      featuredPriority: source.featuredPriority,
      featuredImageId: source.featuredImageId,
      thumbnailId: source.thumbnailId,
      categoryId: source.categoryId,
      authorId: source.authorId,
      options: source.options ?? {},
      sidebarMode: source.sidebarMode,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      focusKeyword: source.focusKeyword,
      canonicalUrl: null,
      noIndex: source.noIndex,
      noFollow: source.noFollow,
      ogTitle: source.ogTitle,
      ogDescription: source.ogDescription,
      ogImageId: source.ogImageId,
      twitterImageId: source.twitterImageId,
    };

    const existing = await prisma.blogPost.findUnique({
      where: { countryId_slug: { countryId: to.id, slug: source.slug } },
      select: { id: true },
    });
    const verb = existing ? 'replace' : 'create ';

    if (args.dryRun) {
      record(`${verb} article /blog/${source.slug}`);
      continue;
    }

    if (existing) {
      await prisma.blogPostTag.deleteMany({ where: { postId: existing.id } });
      await prisma.blogPost.update({
        where: { id: existing.id },
        data: {
          ...shared,
          deletedAt: null,
          tags: { create: source.tags.map((tag) => ({ tagId: tag.tagId })) },
        },
      });
    } else {
      await prisma.blogPost.create({
        data: {
          ...shared,
          countryId: to.id,
          slug: source.slug,
          tags: { create: source.tags.map((tag) => ({ tagId: tag.tagId })) },
        },
      });
    }

    record(`${verb} article /blog/${source.slug}`);
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Menus, with internal links repointed at the target market's own pages.
 *
 * A copied menu that still linked to the source market's page rows would send
 * every visitor straight back out of the market they are in, so an item whose
 * page has no counterpart here is dropped rather than left pointing away.
 */
async function cloneNavigation(from, to, pageIdBySlug) {
  const menus = await prisma.navigation.findMany({
    where: { countryId: from.id },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  const sourcePages = await prisma.page.findMany({
    where: { countryId: from.id },
    select: { id: true, slug: true },
  });
  const slugByPageId = new Map(sourcePages.map((page) => [page.id, page.slug]));

  for (const menu of menus) {
    const present = await prisma.navigation.findUnique({
      where: { countryId_slug: { countryId: to.id, slug: menu.slug } },
      select: { id: true },
    });
    const verb = present ? 'replace' : 'create ';

    if (args.dryRun) {
      record(`${verb} menu    ${menu.name} (${menu.location}) — ${menu.items.length} items`);
      continue;
    }

    const target = await prisma.navigation.upsert({
      where: { countryId_slug: { countryId: to.id, slug: menu.slug } },
      update: { name: menu.name, location: menu.location },
      create: { countryId: to.id, slug: menu.slug, name: menu.name, location: menu.location },
    });

    await prisma.navigationItem.deleteMany({ where: { navigationId: target.id } });

    // Two passes: every item first, then the parent links, because a child
    // cannot reference a parent row that does not exist yet.
    const newIdByOldId = new Map();
    let dropped = 0;

    for (const item of menu.items) {
      let pageId = null;
      if (item.pageId) {
        const slug = slugByPageId.get(item.pageId);
        pageId = slug === undefined ? null : (pageIdBySlug.get(slug) ?? null);
        if (!pageId) {
          dropped += 1;
          continue;
        }
      }

      const created = await prisma.navigationItem.create({
        data: {
          navigationId: target.id,
          label: item.label,
          linkType: item.linkType,
          url: item.url,
          pageId,
          productId: item.productId,
          blogCategoryId: item.blogCategoryId,
          // An article link is market-scoped like a page, and the copies are
          // new rows, so it is left off rather than pointed at the source's.
          blogPostId: null,
          description: item.description,
          icon: item.icon,
          openInNewTab: item.openInNewTab,
          isHighlighted: item.isHighlighted,
          sortOrder: item.sortOrder,
          isVisible: item.isVisible,
        },
      });
      newIdByOldId.set(item.id, created.id);
    }

    for (const item of menu.items) {
      const newId = newIdByOldId.get(item.id);
      const newParentId = item.parentId ? newIdByOldId.get(item.parentId) : null;
      if (!newId || !newParentId) continue;
      await prisma.navigationItem.update({
        where: { id: newId },
        data: { parentId: newParentId },
      });
    }

    record(
      `${verb} menu    ${menu.name} (${menu.location}) — ${newIdByOldId.size} items` +
        (dropped > 0 ? `, ${dropped} link${dropped === 1 ? '' : 's'} dropped` : ''),
    );
  }
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

async function cloneProducts(from, to) {
  const listings = await prisma.productCountry.findMany({
    where: { countryId: from.id, product: { deletedAt: null } },
    include: { product: { select: { name: true, slug: true } } },
    orderBy: { sortOrder: 'asc' },
  });

  for (const source of listings) {
    /*
     * A price the copy could not carry across must not reach a storefront: the
     * listing would show a product at no price at all. A source that genuinely
     * has no price is a different thing — a "contact us" tier is published
     * price-less on purpose — and copies across as it stands.
     */
    const priceLost = source.monthlyPrice !== null && rate === null;
    const status = args.publish && !priceLost ? source.status : 'DRAFT';

    const data = {
      status,
      publishedAt: status === 'DRAFT' ? null : (source.publishedAt ?? new Date()),
      isFeatured: source.isFeatured,
      sortOrder: source.sortOrder,
      featuredOrder: source.featuredOrder,
      currency: to.currency,
      monthlyPrice: convert(source.monthlyPrice),
      annualPrice: convert(source.annualPrice),
      compareAtPrice: convert(source.compareAtPrice),
      discountPercent: source.discountPercent,
      priceSuffix: source.priceSuffix,
      priceNote: source.priceNote,
      shortDescription: source.shortDescription,
      description: source.description,
      ctaLabel: source.ctaLabel,
      ctaUrl: source.ctaUrl,
      ctaFormId: source.ctaFormId,
      seoTitle: source.seoTitle,
      seoDescription: source.seoDescription,
      canonicalUrl: null,
      noIndex: source.noIndex,
      ogImageId: source.ogImageId,
    };

    const price =
      data.monthlyPrice === null ? 'no price' : `${to.currency} ${data.monthlyPrice.toString()}`;

    const present = await prisma.productCountry.findUnique({
      where: { productId_countryId: { productId: source.productId, countryId: to.id } },
      select: { id: true },
    });
    const verb = present ? 'replace' : 'create ';

    if (args.dryRun) {
      record(`${verb} product /products/${source.product.slug} — ${price}, ${status.toLowerCase()}`);
      continue;
    }

    await prisma.productCountry.upsert({
      where: { productId_countryId: { productId: source.productId, countryId: to.id } },
      update: data,
      create: { ...data, productId: source.productId, countryId: to.id },
    });

    record(`${verb} product /products/${source.product.slug} — ${price}, ${status.toLowerCase()}`);
  }

  return listings.length;
}

// ---------------------------------------------------------------------------
// Market settings
// ---------------------------------------------------------------------------

/**
 * The marketing copy and SEO defaults, without anything market-specific.
 *
 * Contact details and tax identifiers are left blank on purpose: a UAE
 * storefront printing an Indian phone number is a real problem, and an empty
 * field falls back to the global settings, which is the safer wrong answer.
 */
async function cloneSettings(from, to) {
  const source = await prisma.countrySettings.findUnique({ where: { countryId: from.id } });
  if (!source) {
    record('        settings — nothing to copy');
    return;
  }

  const data = {
    headerCtaLabel: source.headerCtaLabel,
    headerCtaUrl: source.headerCtaUrl,
    salesCtaText: source.salesCtaText,
    footerDescription: source.footerDescription,
    copyrightText: source.copyrightText,
    defaultTitle: source.defaultTitle,
    titleTemplate: source.titleTemplate,
    defaultDescription: source.defaultDescription,
    defaultOgImageUrl: source.defaultOgImageUrl,
    organizationName: source.organizationName,
    organizationType: source.organizationType,
    organizationLogoUrl: source.organizationLogoUrl,
  };

  const existing = await prisma.countrySettings.findUnique({ where: { countryId: to.id } });
  const verb = existing ? 'replace' : 'create ';

  if (args.dryRun) {
    record(`${verb} settings — marketing copy and SEO defaults (no contact details)`);
    return;
  }

  if (existing) {
    await prisma.countrySettings.update({ where: { countryId: to.id }, data });
  } else {
    await prisma.countrySettings.create({ data: { ...data, countryId: to.id } });
  }
  record(`${verb} settings — marketing copy and SEO defaults (no contact details)`);
}

// ---------------------------------------------------------------------------

async function main() {
  const [from, to] = await Promise.all([
    prisma.country.findUnique({ where: { code: args.from.toUpperCase() } }),
    prisma.country.findUnique({ where: { code: args.to.toUpperCase() } }),
  ]);

  if (!from) die(`No market with code ${args.from.toUpperCase()}.`);
  if (!to) die(`No market with code ${args.to.toUpperCase()}. Create it in Admin → Countries first.`);

  console.log(
    `\n${args.dryRun ? 'Would clone' : 'Cloning'} ${from.name} (${from.code}) → ${to.name} (${to.code})`,
  );
  console.log(`Target prefix: /${to.slug || ''}    currency: ${to.currency}`);
  console.log(
    rate === null
      ? 'No --rate given: priced listings are copied without a price and held as drafts.'
      : `Prices carried across × ${rate} as a starting point — edit them in the admin.`,
  );
  console.log('');

  const pageIdBySlug = await clonePages(from, to);
  await clonePosts(from, to);
  await cloneNavigation(from, to, pageIdBySlug);
  const productCount = await cloneProducts(from, to);
  await cloneSettings(from, to);

  if (args.dryRun) {
    console.log(`\n${plan.length} things would be written. Nothing was.\n`);
    return;
  }

  // ---- activation -------------------------------------------------------
  const home = await prisma.page.findFirst({
    where: { countryId: to.id, isHomepage: true, status: 'PUBLISHED', deletedAt: null },
    select: { id: true },
  });

  if (args.activate) {
    if (!home) {
      console.log(
        `\n! ${to.name} was not switched on: it has no published home page, so /${to.slug} would 404.` +
          (args.publish ? '' : ' Re-run with --publish.'),
      );
    } else if (!to.isActive) {
      await prisma.country.update({ where: { id: to.id }, data: { isActive: true } });
      console.log(`\n✓ ${to.name} is now live at /${to.slug}`);
    } else {
      console.log(`\n✓ ${to.name} was already live at /${to.slug}`);
    }
  }

  console.log(`\n${plan.length} things written.\n`);
  console.log('Before this market is really open, in Admin → Countries → ' + to.name + ':');
  console.log('  • contact details — phone, email, address, tax number (left blank on purpose)');
  if (rate !== null) console.log(`  • check every price: they are ${from.currency} × ${rate}, not a quote`);
  else if (productCount > 0) console.log(`  • set prices for ${productCount} product listings, then publish them`);
  console.log('  • read the copied pages: text written for one market rarely fits another');
  console.log('');
  // The copy is written straight to the database, so the URL registry has not
  // seen it yet. While the registry answers public requests, content without a
  // registered address is not served — a scan registers it, changing nothing else.
  console.log('Then register the new addresses: Admin → SEO → Slug & URL Manager → Scan again');
  console.log('(or `npm run urls:backfill`). Until then, with the registry switched on, the copied');
  console.log('pages and products are not reachable.');
  console.log('');
}

main()
  .catch((error) => {
    console.error(`\n✗ ${error?.message ?? error}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
