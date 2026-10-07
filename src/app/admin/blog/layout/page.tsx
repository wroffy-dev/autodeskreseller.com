import type { Metadata } from 'next';
import { blogPath } from '@/lib/cms/blog-render';
import { getUrlSnapshot } from '@/lib/urls/load';
import Link from 'next/link';
import { Eye, Palette } from 'lucide-react';
import type { BlogSurface } from '@prisma/client';
import { requireAnyPermission, userCanAny } from '@/lib/auth/guards';
import { getBlogSectionRows } from '@/lib/services/blog-cms';
import { AdminPageHeader } from '@/components/admin/page-header';
import { BlogLayoutBuilder } from '@/components/admin/blog/blog-layout-builder';
import type { BuilderSection } from '@/components/cms/section-builder';
import { buttonClasses } from '@/components/ui/button';
import { parseBlockContent } from '@/lib/cms/blocks';

export const metadata: Metadata = { title: 'Blog layout' };
export const dynamic = 'force-dynamic';

/**
 * Blog structure.
 *
 * One screen for the three orderable surfaces — the archive, the article and
 * the sidebar — each rendered by the same builder the page editor uses.
 */
export default async function BlogLayoutAdmin() {
  const user = await requireAnyPermission(['blog.sections', 'blog.sidebar', 'blog.edit']);
  // The blog's address comes from the URL registry.
  await getUrlSnapshot();

  const [listing, article, sidebar] = await Promise.all([
    getBlogSectionRows('LISTING'),
    getBlogSectionRows('ARTICLE'),
    getBlogSectionRows('SIDEBAR'),
  ]);

  const toBuilder = (rows: typeof listing): BuilderSection[] =>
    rows.map((row) => ({
      id: row.id,
      blockType: row.blockType,
      name: row.name,
      isVisible: row.isVisible,
      sortOrder: row.sortOrder,
      content: parseBlockContent(row.blockType, row.content),
      settings: (row.settings ?? {}) as Record<string, unknown>,
    }));

  const surfaces: Record<BlogSurface, BuilderSection[]> = {
    LISTING: toBuilder(listing),
    ARTICLE: toBuilder(article),
    SIDEBAR: toBuilder(sidebar),
  };

  return (
    <>
      <AdminPageHeader
        title="Blog layout"
        description="Drag the sections of the blog archive, the article page and the sidebar into any order. The website follows what you save here."
        crumbs={[{ label: 'Blog', href: '/admin/blog' }, { label: 'Layout' }]}
        actions={
          <>
            <Link href="/admin/blog/design" className={buttonClasses('outline', 'md')}>
              <Palette className="h-4 w-4" aria-hidden="true" />
              Blog design
            </Link>
            <Link
              href={blogPath()}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('outline', 'md')}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              View blog
            </Link>
          </>
        }
      />

      <BlogLayoutBuilder
        surfaces={surfaces}
        canEdit={userCanAny(user, ['blog.sections', 'blog.sidebar', 'blog.edit'])}
      />
    </>
  );
}
