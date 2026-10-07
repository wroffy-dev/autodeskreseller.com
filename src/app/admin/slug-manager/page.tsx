import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { SlugManager } from '@/components/admin/urls/slug-manager';
import { loadManagerOverview } from '@/lib/urls/manager';
import { MANAGER_TABS, type ManagerTab } from '@/components/admin/urls/tabs';

export const metadata: Metadata = { title: 'Slug & URL Manager' };
export const dynamic = 'force-dynamic';

/**
 * SEO → Slug & URL Manager.
 *
 * Every public address the site answers for, in one place: what each piece of
 * content lives at, the patterns addresses follow, redirects, conflicts, the
 * history of every change and what is broken. The screen is a client
 * application over Server Actions, so saving never reloads the page and never
 * loses the filters, the page of results or the drawer being edited.
 */
export default async function SlugManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission('seo.manage');
  const [overview, params] = await Promise.all([loadManagerOverview(user), searchParams]);
  const requested = typeof params.tab === 'string' ? params.tab : '';
  const tab: ManagerTab = (MANAGER_TABS as readonly string[]).includes(requested)
    ? (requested as ManagerTab)
    : 'urls';

  return (
    <div className="mx-auto max-w-7xl">
      <AdminPageHeader
        title="Slug & URL Manager"
        description="Every public address, the patterns they follow, redirects, conflicts, history and URL health."
        crumbs={[{ label: 'SEO', href: '/admin/seo' }, { label: 'Slug & URL Manager' }]}
      />
      <SlugManager overview={overview} initialTab={tab} />
    </div>
  );
}
