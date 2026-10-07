import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { publishedPostWhere } from '@/lib/services/blog';
import type { SeoEntityType } from '@/lib/seo/types';
import type { SeoContext } from './context';

/**
 * Every URL SEO Intelligence audits, and a fingerprint of its content.
 *
 * Cheap on purpose: ids, timestamps and counts, in a handful of queries for
 * the whole site. The fingerprint moves whenever the audited content does —
 * including a section being added, removed, reordered or hidden, which does
 * not touch the page's own timestamp — so comparing it with the one stored
 * beside a cached score is all it takes to know the score is stale.
 *
 * The content's registered address is part of it too (its route version, which
 * moves on every address change): a slug edit, a bulk move, a restore or a
 * city rename marks the audit outdated even though the content itself did not
 * change, because the URL, canonical and links it was scored with did.
 */

export type AuditTarget = {
  entityType: SeoEntityType;
  entityId: string;
  countryId: string;
  contentUpdatedAt: Date;
  contentFingerprint: string;
};

export const targetKey = (target: Pick<AuditTarget, 'entityType' | 'entityId' | 'countryId'>) =>
  `${target.entityType}:${target.entityId}:${target.countryId}`;

const time = (value: Date | null | undefined) => value?.getTime() ?? 0;
const latest = (...values: Array<Date | null | undefined>) => new Date(Math.max(0, ...values.map(time)));

export async function listAuditTargets(
  ctx: SeoContext,
  filter: { countryIds?: readonly string[] } = {},
): Promise<AuditTarget[]> {
  const countryWhere = filter.countryIds ? { countryId: { in: [...filter.countryIds] } } : {};
  const root = ctx.root;
  const includeBlogArchives = !filter.countryIds || filter.countryIds.includes(root.id);

  const [pages, pageSections, markets, productSections, posts, routes] = await Promise.all([
    prisma.page.findMany({
      where: { deletedAt: null, ...countryWhere },
      select: { id: true, countryId: true, updatedAt: true, city: { select: { updatedAt: true } } },
    }),
    prisma.pageSection.groupBy({
      by: ['pageId'],
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.productCountry.findMany({
      where: { deletedAt: null, product: { deletedAt: null }, ...countryWhere },
      select: { productId: true, countryId: true, updatedAt: true, product: { select: { updatedAt: true } } },
    }),
    prisma.productSection.groupBy({
      by: ['productId'],
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.blogPost.findMany({
      where: { deletedAt: null, ...countryWhere },
      select: { id: true, countryId: true, updatedAt: true },
    }),
    prisma.urlRoute.findMany({
      where: { kind: 'CONTENT', ...countryWhere },
      select: { entityId: true, countryId: true, version: true },
    }),
  ]);
  const routeVersion = new Map(routes.map((route) => [`${route.entityId}|${route.countryId}`, route.version]));
  /** The address part of a fingerprint; empty while the content has no route. */
  const address = (entityId: string, countryId: string) => {
    const version = routeVersion.get(`${entityId}|${countryId}`);
    return version === undefined ? '' : `|url:${version}`;
  };

  const pageSectionStats = new Map(pageSections.map((row) => [row.pageId, row]));
  const productSectionStats = new Map(productSections.map((row) => [row.productId, row]));

  const targets: AuditTarget[] = [];

  for (const page of pages) {
    const sections = pageSectionStats.get(page.id);
    targets.push({
      entityType: 'PAGE',
      entityId: page.id,
      countryId: page.countryId,
      contentUpdatedAt: latest(page.updatedAt, sections?._max.updatedAt, page.city?.updatedAt),
      // A city page also inherits from its city, so a change to the city moves
      // it. Pages outside a city keep exactly the fingerprint they had.
      contentFingerprint:
        `${time(page.updatedAt)}|${sections?._count._all ?? 0}|${time(sections?._max.updatedAt)}` +
        (page.city ? `|city:${time(page.city.updatedAt)}` : '') +
        address(page.id, page.countryId),
    });
  }

  for (const market of markets) {
    const sections = productSectionStats.get(market.productId);
    targets.push({
      entityType: 'PRODUCT_MARKET',
      entityId: market.productId,
      countryId: market.countryId,
      contentUpdatedAt: latest(market.updatedAt, market.product.updatedAt, sections?._max.updatedAt),
      contentFingerprint:
        `${time(market.product.updatedAt)}|${time(market.updatedAt)}|${sections?._count._all ?? 0}|${time(sections?._max.updatedAt)}` +
        address(market.productId, market.countryId),
    });
  }

  for (const post of posts) {
    targets.push({
      entityType: 'BLOG_POST',
      entityId: post.id,
      countryId: post.countryId,
      contentUpdatedAt: post.updatedAt,
      contentFingerprint: String(time(post.updatedAt)) + address(post.id, post.countryId),
    });
  }

  if (includeBlogArchives) {
    const [categories, categoryRoot, categoryAny, tags, tagRoot, tagAny, rootPosts] = await Promise.all([
      prisma.blogCategory.findMany({
        select: {
          id: true,
          updatedAt: true,
          countries: { where: { countryId: root.id }, select: { updatedAt: true }, take: 1 },
        },
      }),
      prisma.blogPost.groupBy({ by: ['categoryId'], where: publishedPostWhere(root.id), _count: { _all: true } }),
      prisma.blogPost.groupBy({ by: ['categoryId'], where: publishedPostWhere(), _count: { _all: true } }),
      prisma.blogTag.findMany({ select: { id: true, updatedAt: true, createdAt: true } }),
      prisma.blogPostTag.groupBy({ by: ['tagId'], where: { post: publishedPostWhere(root.id) }, _count: { _all: true } }),
      prisma.blogPostTag.groupBy({ by: ['tagId'], where: { post: publishedPostWhere() }, _count: { _all: true } }),
      prisma.blogPost.count({ where: publishedPostWhere(root.id) }),
    ]);
    const countOf = <T extends { _count: { _all: number } }>(rows: T[], match: (row: T) => boolean) =>
      rows.find(match)?._count._all ?? 0;

    for (const category of categories) {
      const override = category.countries[0]?.updatedAt ?? null;
      const inRoot = countOf(categoryRoot, (row) => row.categoryId === category.id);
      const anywhere = countOf(categoryAny, (row) => row.categoryId === category.id);
      targets.push({
        entityType: 'BLOG_CATEGORY',
        entityId: category.id,
        countryId: root.id,
        contentUpdatedAt: latest(category.updatedAt, override),
        contentFingerprint: `${time(category.updatedAt)}|${time(override)}|${inRoot}|${anywhere}`,
      });
    }
    for (const tag of tags) {
      const inRoot = countOf(tagRoot, (row) => row.tagId === tag.id);
      const anywhere = countOf(tagAny, (row) => row.tagId === tag.id);
      const updated = tag.updatedAt ?? tag.createdAt;
      targets.push({
        entityType: 'BLOG_TAG',
        entityId: tag.id,
        countryId: root.id,
        contentUpdatedAt: updated,
        contentFingerprint: `${time(updated)}|${inRoot}|${anywhere}`,
      });
    }
    targets.push({
      entityType: 'BLOG_ARCHIVE',
      entityId: 'blog',
      countryId: root.id,
      contentUpdatedAt: new Date(0),
      contentFingerprint: String(rootPosts),
    });
  }

  // A stable order, so a batched recalculation can resume from a cursor.
  return targets.sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
}
