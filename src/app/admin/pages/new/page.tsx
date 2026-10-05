import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { listPageCategoryOptions } from '@/lib/services/page-categories';
import { AdminPageHeader } from '@/components/admin/page-header';
import { PageForm, EMPTY_PAGE } from '@/components/admin/pages/page-form';
import { Alert } from '@/components/ui/states';
import { getAdminCountryScope } from '@/lib/country/admin';

export const metadata: Metadata = { title: 'New page' };

export default async function NewPage() {
  const user = await requirePermission('pages.create');
  const [categoryOptions, scope] = await Promise.all([
    listPageCategoryOptions(),
    getAdminCountryScope(),
  ]);

  return (
    <div className="max-w-3xl">
      <AdminPageHeader
        title="New page"
        description="Create the page, then add and arrange its sections."
        crumbs={[{ label: 'Pages', href: '/admin/pages' }, { label: 'New' }]}
      />
      <Alert tone="info" className="mb-4">
        Pages are created as drafts. Add your sections first, then publish when you are happy with it.
        {scope.canSwitch ? (
          <>
            {' '}
            This page will belong to <strong>{scope.country.name}</strong> — switch country in the
            top bar to create it somewhere else.
          </>
        ) : null}
      </Alert>
      <PageForm
        initial={EMPTY_PAGE}
        categories={categoryOptions}
        canPublish={userCan(user, 'pages.publish')}
        mode="create"
      />
    </div>
  );
}
