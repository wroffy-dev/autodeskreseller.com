'use client';

import {
  CategoryTreeManager,
  type CategoryRow,
  type CategoryExtraField,
} from '@/components/admin/category-tree-manager';
import { saveBlogCategory, deleteBlogCategory } from '@/lib/actions/blog';

/** Kept for callers that imported this type before the manager was shared. */
export type BlogCategoryRow = CategoryRow;

/**
 * Archive artwork, archive copy, status and the rest of the SEO set.
 *
 * Contributed as extra fields rather than baked into the shared manager, so
 * page categories are untouched by any of it.
 */
const EXTRA_FIELDS: CategoryExtraField[] = [
  {
    name: 'isActive',
    kind: 'switch',
    label: 'Show in the blog filters',
    hint: 'A hidden category keeps its archive URL working; it just stops being advertised.',
  },
  { name: 'imageId', kind: 'media', label: 'Featured image' },
  { name: 'bannerImageId', kind: 'media', label: 'Archive banner' },
  {
    name: 'archiveTitle',
    kind: 'text',
    label: 'Archive heading',
    hint: 'Shown on the category page. Falls back to the category name.',
  },
  { name: 'archiveDescription', kind: 'textarea', label: 'Archive description' },
  { name: 'canonicalUrl', kind: 'text', label: 'Canonical URL' },
  { name: 'ogTitle', kind: 'text', label: 'Open Graph title' },
  { name: 'ogDescription', kind: 'textarea', label: 'Open Graph description' },
  { name: 'ogImageId', kind: 'media', label: 'Social share image' },
  {
    name: 'primaryKeyword1',
    kind: 'text',
    label: 'Primary keyword 1',
    hint: 'Up to three searches this archive should answer. Analysis inputs for SEO Intelligence only: nothing is added to the page’s markup.',
  },
  { name: 'primaryKeyword2', kind: 'text', label: 'Primary keyword 2' },
  { name: 'primaryKeyword3', kind: 'text', label: 'Primary keyword 3' },
  { name: 'noIndex', kind: 'switch', label: 'Hide from search engines (noindex)' },
  { name: 'noFollow', kind: 'switch', label: 'Do not follow links (nofollow)' },
];

/**
 * Blog categories, on the shared tree manager.
 *
 * Blog categories gained nesting, so they use the same component page
 * categories do rather than a near-identical copy.
 */
export function BlogCategoryManager({
  rows,
  canEdit,
  canDelete,
  urlPattern = '/blog/category/{slug}',
}: {
  rows: CategoryRow[];
  canEdit: boolean;
  canDelete: boolean;
  /** Where category archives live, from the URL pattern the site serves now. */
  urlPattern?: string;
}) {
  return (
    <CategoryTreeManager
      rows={rows}
      canEdit={canEdit}
      canDelete={canDelete}
      urlPrefix="/blog/category/"
      urlPattern={urlPattern}
      itemLabel="post"
      withSeo
      extraFields={EXTRA_FIELDS}
      extraDefaults={{ isActive: true, noIndex: false, noFollow: false }}
      emptyDescription={`Categories create archive pages at ${urlPattern.replace('{slug}', '…')}`}
      onSave={(id, data) => saveBlogCategory(id, data)}
      // Blog categories have no bulk move-on-delete action; posts simply become
      // uncategorised, which is what deleteBlogCategory already does.
      onDelete={(categoryId) => deleteBlogCategory(categoryId)}
    />
  );
}
