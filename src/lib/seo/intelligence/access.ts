import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { AuthorizationError, userCan, type SessionUser } from '@/lib/auth/guards';
import type { PermissionKey } from '@/lib/auth/permissions';
import { assertCountryAccess } from '@/lib/country/access';
import type { SeoEntityType } from '@/lib/seo/types';
import { loadSeoContext } from './context';
import type { EntityRef } from './audit';

/**
 * Who may see a URL's score.
 *
 * A score describes content, so seeing one needs the right to view that
 * content, in its market — the same right the editor it sits in needs. The
 * dashboard across the whole site is a separate matter: that needs the SEO
 * permission.
 */

export class AuditNotFoundError extends Error {}

const VIEW_PERMISSION: Record<SeoEntityType, PermissionKey> = {
  PAGE: 'pages.view',
  PRODUCT_MARKET: 'products.view',
  BLOG_POST: 'blog.view',
  BLOG_CATEGORY: 'blog.view',
  BLOG_TAG: 'blog.view',
  BLOG_ARCHIVE: 'blog.view',
};

/** Checks the user may see this URL and returns it with its market. */
export async function resolveAuditRef(
  user: SessionUser,
  input: { type: SeoEntityType; id: string; countryId?: string | null },
): Promise<EntityRef> {
  if (!userCan(user, VIEW_PERMISSION[input.type])) {
    throw new AuthorizationError(VIEW_PERMISSION[input.type]);
  }
  switch (input.type) {
    case 'PAGE': {
      const page = await prisma.page.findFirst({
        where: { id: input.id, deletedAt: null },
        select: { countryId: true },
      });
      if (!page) throw new AuditNotFoundError('That page no longer exists.');
      await assertCountryAccess(user, page.countryId);
      return { type: 'PAGE', id: input.id, countryId: page.countryId };
    }
    case 'PRODUCT_MARKET': {
      if (!input.countryId) throw new AuditNotFoundError('A market is required.');
      const product = await prisma.product.findFirst({
        where: { id: input.id, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new AuditNotFoundError('That product no longer exists.');
      await assertCountryAccess(user, input.countryId);
      return { type: 'PRODUCT_MARKET', id: input.id, countryId: input.countryId };
    }
    case 'BLOG_POST': {
      const post = await prisma.blogPost.findFirst({
        where: { id: input.id, deletedAt: null },
        select: { countryId: true },
      });
      if (!post) throw new AuditNotFoundError('That article no longer exists.');
      await assertCountryAccess(user, post.countryId);
      return { type: 'BLOG_POST', id: input.id, countryId: post.countryId };
    }
    case 'BLOG_CATEGORY': {
      const found = await prisma.blogCategory.findUnique({ where: { id: input.id }, select: { id: true } });
      if (!found) throw new AuditNotFoundError('That category no longer exists.');
      break;
    }
    case 'BLOG_TAG': {
      const found = await prisma.blogTag.findUnique({ where: { id: input.id }, select: { id: true } });
      if (!found) throw new AuditNotFoundError('That tag no longer exists.');
      break;
    }
    case 'BLOG_ARCHIVE':
      break;
  }
  // Categories, tags and the archive are the blog's, served at the root.
  const ctx = await loadSeoContext();
  return { type: input.type, id: input.type === 'BLOG_ARCHIVE' ? 'blog' : input.id, countryId: ctx.root.id };
}
