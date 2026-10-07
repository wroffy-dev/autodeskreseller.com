import type { Metadata } from 'next';
import { blogPath } from '@/lib/cms/blog-render';
import { getUrlSnapshot } from '@/lib/urls/load';
import Link from 'next/link';
import { Plus, Tag, Layers, Palette } from 'lucide-react';
import { prisma } from '@/lib/db/prisma';
import { requirePermission, userCan, userCanAny } from '@/lib/auth/guards';
import { AdminPageHeader } from '@/components/admin/page-header';
import { FilterBar } from '@/components/admin/filter-bar';
import type { FilterDefinition, FilterPreset } from '@/lib/admin/filters';
import { AdminPagination } from '@/components/admin/admin-pagination';
import { PostsTable, type PostRow } from '@/components/admin/blog/posts-table';
import { Card } from '@/components/ui/card';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import { resolveListCountry, countryFilterDefinition } from '@/lib/admin/country-filter';
import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Blog' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 20;

export default async function BlogAdmin({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    tag?: string;
    author?: string;
    featured?: string;
    country?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('blog.view');
  // The blog's address comes from the URL registry.
  await getUrlSnapshot();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  // Articles belong to a market, so the list follows the topbar's selection.
  const country = await resolveListCountry(user, params.country);

  const where: Prisma.BlogPostWhereInput = { deletedAt: null };
  if (country.countryId) where.countryId = country.countryId;
  if (params.q?.trim()) {
    where.OR = [
      { title: { contains: params.q.trim(), mode: 'insensitive' } },
      { slug: { contains: params.q.trim(), mode: 'insensitive' } },
      { excerpt: { contains: params.q.trim(), mode: 'insensitive' } },
    ];
  }
  if (params.status) where.status = params.status as Prisma.BlogPostWhereInput['status'];
  if (params.category) where.categoryId = params.category;
  if (params.tag) where.tags = { some: { tagId: params.tag } };
  if (params.author) where.authorId = params.author;
  if (params.featured === 'yes') where.isFeatured = true;
  if (params.featured === 'no') where.isFeatured = false;
  if (params.from || params.to) {
    where.publishedAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      // `to` is a date, so the range has to reach the end of that day.
      ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999Z`) } : {}),
    };
  }

  const [rows, total, categories, tags, authors] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        isFeatured: true,
        readingTime: true,
        publishedAt: true,
        updatedAt: true,
        featuredImage: { select: { url: true } },
        thumbnail: { select: { url: true } },
        category: { select: { name: true } },
        author: { select: { name: true } },
        country: { select: { name: true, code: true, slug: true } },
      },
    }),
    prisma.blogPost.count({ where }),
    prisma.blogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, parent: { select: { name: true } } },
    }),
    prisma.blogTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 200,
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { deletedAt: null, authoredPosts: { some: { deletedAt: null } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const can = {
    edit: userCan(user, 'blog.edit'),
    create: userCan(user, 'blog.create'),
    delete: userCan(user, 'blog.delete'),
    publish: userCan(user, 'blog.publish'),
  };

  const tableRows: PostRow[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    isFeatured: row.isFeatured,
    imageUrl: row.featuredImage?.url ?? row.thumbnail?.url ?? null,
    categoryName: row.category?.name ?? null,
    authorName: row.author?.name ?? null,
    countryName: row.country.name,
    countryCode: row.country.code,
    countrySlug: row.country.slug,
    readingTime: row.readingTime,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }));

  const definitions: FilterDefinition[] = [
    ...countryFilterDefinition(country),
    {
      name: 'status',
      label: 'Status',
      allLabel: 'Any status',
      options: [
        { label: 'Published', value: 'PUBLISHED' },
        { label: 'Draft', value: 'DRAFT' },
        { label: 'Scheduled', value: 'SCHEDULED' },
        { label: 'Archived', value: 'ARCHIVED' },
      ],
    },
    {
      name: 'category',
      label: 'Category',
      allLabel: 'Any category',
      options: categories.map((category) => ({
        label: category.parent ? `${category.parent.name} → ${category.name}` : category.name,
        value: category.id,
      })),
    },
    {
      name: 'author',
      label: 'Author',
      allLabel: 'Any author',
      options: authors.map((author) => ({ label: author.name, value: author.id })),
    },
    // The rest live behind "More filters" so the bar stays readable.
    {
      name: 'tag',
      label: 'Tag',
      allLabel: 'Any tag',
      advanced: true,
      options: tags.map((tag) => ({ label: tag.name, value: tag.id })),
    },
    {
      name: 'featured',
      label: 'Featured',
      allLabel: 'Any',
      advanced: true,
      options: [
        { label: 'Featured only', value: 'yes' },
        { label: 'Not featured', value: 'no' },
      ],
    },
    { name: 'date', label: 'Published', kind: 'date', advanced: true },
  ];

  const presets: FilterPreset[] = [
    { id: 'all', label: 'All posts', params: {} },
    { id: 'published', label: 'Published', params: { status: 'PUBLISHED' } },
    { id: 'drafts', label: 'Drafts', params: { status: 'DRAFT' } },
    { id: 'scheduled', label: 'Scheduled', params: { status: 'SCHEDULED' } },
    { id: 'featured', label: 'Featured', params: { featured: 'yes' } },
  ];

  return (
    <>
      <AdminPageHeader
        title="Blog"
        description={
          country.multiCountry
            ? `Articles are published once, at ${blogPath()}, for every market. You are working in ${country.countryId ? country.current.name : 'all countries'}.`
            : `Articles published at ${blogPath()}. Categories and tags drive the public archive pages.`
        }
        crumbs={[{ label: 'Blog' }]}
        actions={
          <>
            {userCanAny(user, ['blog.sections', 'blog.sidebar', 'blog.edit']) ? (
              <Link href="/admin/blog/layout" className={buttonClasses('outline', 'md')}>
                <Layers className="h-4 w-4" aria-hidden="true" />
                Layout
              </Link>
            ) : null}
            {userCanAny(user, ['blog.design', 'blog.edit']) ? (
              <Link href="/admin/blog/design" className={buttonClasses('outline', 'md')}>
                <Palette className="h-4 w-4" aria-hidden="true" />
                Design
              </Link>
            ) : null}
            {can.edit ? (
              <Link href="/admin/blog/categories" className={buttonClasses('outline', 'md')}>
                <Tag className="h-4 w-4" aria-hidden="true" />
                Categories
              </Link>
            ) : null}
            {can.create ? (
              <ButtonLink href="/admin/blog/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New post
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search posts by title or excerpt"
        definitions={definitions}
        presets={presets}
      />

      <Card>
        <PostsTable
          rows={tableRows}
          can={can}
          showCountry={country.multiCountry}
          countries={country.countries
            .filter((row) => row.isActive)
            .map((row) => ({ id: row.id, code: row.code, name: row.name }))}
          filtered={Boolean(
            params.q ||
              params.status ||
              params.category ||
              params.tag ||
              params.author ||
              params.featured ||
              params.from ||
              params.to,
          )}
        />
        {tableRows.length > 0 ? (
          <AdminPagination
            page={page}
            pages={Math.max(1, Math.ceil(total / PER_PAGE))}
            total={total}
            basePath="/admin/blog"
            params={params}
          />
        ) : null}
      </Card>
    </>
  );
}
