import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { CityForm } from '@/components/admin/cities/city-form';
import { BLANK_CITY } from '@/components/admin/cities/city-form-values';
import { scopeForUser } from '@/lib/country/admin';

export const metadata: Metadata = { title: 'New city' };
export const dynamic = 'force-dynamic';

export default async function NewCity({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const user = await requirePermission('pages.create');
  const params = await searchParams;

  // Markets this user may add a city to; the one chosen in the topbar first.
  const scope = await scopeForUser(user);
  const markets = scope.countries.map((row) => ({ id: row.id, name: row.name, code: row.code, slug: row.slug }));
  const chosen = markets.find((row) => row.id === params.country) ?? markets.find((row) => row.id === scope.country.id);

  return (
    <>
      <AdminPageHeader
        title="New city"
        description="A city is a local address space inside its market. Its pages are ordinary pages, built in the Page Builder."
        backHref="/admin/cities"
        backLabel="All cities"
      />
      <div className="mx-auto max-w-4xl">
        <CityForm
          initial={{ ...BLANK_CITY, countryId: chosen?.id ?? markets[0]?.id ?? '' }}
          markets={markets}
          canPublish={userCan(user, 'pages.publish')}
        />
      </div>
    </>
  );
}
