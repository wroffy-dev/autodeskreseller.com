import type { Metadata } from 'next';
import { blogPath } from '@/lib/cms/blog-render';
import { getUrlSnapshot } from '@/lib/urls/load';
import Link from 'next/link';
import { Eye, Layers } from 'lucide-react';
import { requireAnyPermission, userCanAny } from '@/lib/auth/guards';
import { prisma } from '@/lib/db/prisma';
import { getBlogSettings } from '@/lib/services/blog-cms';
import { AdminPageHeader } from '@/components/admin/page-header';
import { BlogDesignForm } from '@/components/admin/blog/blog-design-form';
import { buttonClasses } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Blog design' };
export const dynamic = 'force-dynamic';

/**
 * Blog design.
 *
 * Sits beside Settings → Website design rather than inside it: these settings
 * are overrides *on top of* the site-wide palette and type scale, and they only
 * affect the blog.
 */
export default async function BlogDesignAdmin() {
  const user = await requireAnyPermission(['blog.design', 'blog.edit']);
  // The blog's address comes from the URL registry.
  await getUrlSnapshot();

  const [settings, row] = await Promise.all([
    getBlogSettings(),
    prisma.blogSettings.findUnique({
      where: { id: 'singleton' },
      select: { ogImageId: true },
    }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Blog design"
        description="Colours, cards, typography and the article/sidebar split. Everything here is an override — leave a field blank and the blog follows the website's own design."
        crumbs={[{ label: 'Blog', href: '/admin/blog' }, { label: 'Design' }]}
        actions={
          <>
            <Link href="/admin/blog/layout" className={buttonClasses('outline', 'md')}>
              <Layers className="h-4 w-4" aria-hidden="true" />
              Blog layout
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

      <BlogDesignForm
        initial={{ ...settings, ogImageId: row?.ogImageId ?? null }}
        canEdit={userCanAny(user, ['blog.design', 'blog.edit'])}
      />
    </>
  );
}
