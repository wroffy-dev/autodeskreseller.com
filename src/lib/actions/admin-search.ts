'use server';

import { prisma } from '@/lib/db/prisma';
import { getCurrentUser, userCan } from '@/lib/auth/guards';
import { listAccessibleCountries } from '@/lib/country/access';
import {
  SEARCH_MAX_QUERY,
  SEARCH_PER_TYPE,
  SEARCH_TYPE_ORDER,
  type SearchHit,
} from '@/lib/admin/search';

export type { SearchHit } from '@/lib/admin/search';

/**
 * Global admin search, behind the topbar search field.
 *
 * Every group is gated on the server by the caller's permissions, so a Sales
 * user never sees pages or staff in their results, and nothing about a group
 * they cannot open — not even a count — leaves this function.
 *
 * Records that belong to a market (pages, cities, posts, leads, forms) are
 * additionally limited to the markets the caller may work in, so search cannot
 * hand someone a record from a storefront they cannot open. Where more than one
 * market exists, each hit names its own.
 *
 * Bounded on every axis: the query is trimmed and capped, each type returns at
 * most SEARCH_PER_TYPE rows, and every lookup is a `contains` on indexed text
 * columns already used by the module's own list search.
 */
export async function adminSearch(query: string): Promise<SearchHit[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const q = typeof query === 'string' ? query.trim().slice(0, SEARCH_MAX_QUERY) : '';
  if (q.length < 2) return [];
  const contains = { contains: q, mode: 'insensitive' as const };
  const take = SEARCH_PER_TYPE;
  const hits: SearchHit[] = [];

  const countries = await listAccessibleCountries(user, { includeInactive: true });
  const multiCountry = countries.length > 1;
  const countryIds = countries.map((c) => c.id);
  // A super admin sees every market, which needs no clause at all.
  const countryScope = user.role === 'super-admin' ? {} : { countryId: { in: countryIds } };
  // Forms with no market are shared by all of them.
  const formCountryScope =
    user.role === 'super-admin'
      ? {}
      : { OR: [{ countryId: null }, { countryId: { in: countryIds } }] };

  const tasks: Array<Promise<void>> = [];

  if (userCan(user, 'leads.view')) {
    tasks.push(
      prisma.lead
        .findMany({
          where: {
            deletedAt: null,
            ...countryScope,
            OR: [{ name: contains }, { email: contains }, { company: contains }, { phone: contains }],
          },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            status: true,
            country: { select: { name: true } },
          },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Lead',
              title: row.name,
              subtitle: [
                row.company,
                row.email,
                row.status.toLowerCase(),
                multiCountry ? row.country.name : null,
              ]
                .filter(Boolean)
                .join(' · '),
              href: `/admin/leads/${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'customers.view')) {
    tasks.push(
      prisma.customer
        .findMany({
          where: { deletedAt: null, OR: [{ name: contains }, { email: contains }, { company: contains }] },
          take,
          select: { id: true, name: true, company: true, email: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Customer',
              title: row.name,
              subtitle: [row.company, row.email].filter(Boolean).join(' · '),
              href: `/admin/customers/${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'pages.view')) {
    tasks.push(
      prisma.page
        .findMany({
          where: {
            deletedAt: null,
            ...countryScope,
            OR: [{ title: contains }, { slug: contains }],
          },
          take,
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            country: { select: { name: true, slug: true } },
          },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Page',
              title: row.title,
              subtitle: [
                `/${[row.country.slug, row.slug].filter(Boolean).join('/')}`,
                row.status.toLowerCase(),
                multiCountry ? row.country.name : null,
              ]
                .filter(Boolean)
                .join(' · '),
              href: `/admin/pages/${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'pages.view')) {
    tasks.push(
      prisma.city
        .findMany({
          where: { ...countryScope, OR: [{ name: contains }, { slug: contains }] },
          orderBy: { name: 'asc' },
          take,
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            country: { select: { name: true, slug: true } },
          },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'City',
              title: row.name,
              subtitle: [
                `/${[row.country.slug, row.slug].filter(Boolean).join('/')}`,
                row.status.toLowerCase(),
                multiCountry ? row.country.name : null,
              ]
                .filter(Boolean)
                .join(' · '),
              href: `/admin/cities/${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'products.view')) {
    tasks.push(
      prisma.product
        .findMany({
          where: { deletedAt: null, OR: [{ name: contains }, { slug: contains }, { sku: contains }] },
          take,
          select: { id: true, name: true, sku: true, status: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Product',
              title: row.name,
              subtitle: [row.sku, row.status.toLowerCase()].filter(Boolean).join(' · '),
              href: `/admin/products/${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'blog.view')) {
    tasks.push(
      prisma.blogPost
        .findMany({
          where: {
            deletedAt: null,
            ...countryScope,
            OR: [{ title: contains }, { slug: contains }],
          },
          take,
          select: { id: true, title: true, status: true, country: { select: { name: true } } },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Post',
              title: row.title,
              subtitle: [row.status.toLowerCase(), multiCountry ? row.country.name : null]
                .filter(Boolean)
                .join(' · '),
              href: `/admin/blog/${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'forms.view')) {
    tasks.push(
      prisma.form
        .findMany({
          where: {
            deletedAt: null,
            AND: [formCountryScope, { OR: [{ name: contains }, { slug: contains }] }],
          },
          take,
          select: { id: true, name: true, slug: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Form',
              title: row.name,
              subtitle: `/${row.slug}`,
              href: `/admin/forms/${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'media.view')) {
    tasks.push(
      prisma.media
        .findMany({
          where: { deletedAt: null, OR: [{ filename: contains }, { title: contains }, { altText: contains }] },
          take,
          select: { id: true, filename: true, title: true, mimeType: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Media',
              title: row.title || row.filename,
              subtitle: row.mimeType,
              href: `/admin/media?selected=${row.id}`,
            });
          }
        }),
    );
  }

  if (userCan(user, 'staff.manage')) {
    tasks.push(
      prisma.user
        .findMany({
          where: { deletedAt: null, OR: [{ name: contains }, { email: contains }] },
          take,
          select: { id: true, name: true, email: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              id: row.id,
              type: 'Staff',
              title: row.name,
              subtitle: row.email,
              href: `/admin/staff/${row.id}`,
            });
          }
        }),
    );
  }

  await Promise.all(tasks);
  // Groups arrive in whatever order their queries finished; list them in a
  // fixed order so results do not reshuffle between keystrokes.
  return hits
    .sort((a, b) => SEARCH_TYPE_ORDER.indexOf(a.type) - SEARCH_TYPE_ORDER.indexOf(b.type))
    .slice(0, SEARCH_PER_TYPE * SEARCH_TYPE_ORDER.length);
}
