'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Plus, Pencil, Trash, Tags, Search } from 'lucide-react';
import { saveBlogTag, deleteBlogTag, bulkBlogTagAction } from '@/lib/actions/blog-tags';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Textarea, Switch } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { BulkBar, useSelection } from '@/components/admin/row-menu';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { slugify } from '@/lib/utils/slug';
import { fillPattern } from '@/lib/urls/path';

export type TagRow = {
  id: string;
  name: string;
  slug: string;
  postCount: number;
  description: string | null;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
};

type TagDraft = {
  id: string;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  noIndex: boolean;
};

const BLANK: TagDraft = {
  id: '',
  name: '',
  slug: '',
  description: '',
  isActive: true,
  seoTitle: '',
  seoDescription: '',
  canonicalUrl: '',
  noIndex: false,
};

const draftFrom = (row: TagRow): TagDraft => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description ?? '',
  isActive: row.isActive,
  seoTitle: row.seoTitle ?? '',
  seoDescription: row.seoDescription ?? '',
  canonicalUrl: row.canonicalUrl ?? '',
  noIndex: row.noIndex,
});

/**
 * Tag management.
 *
 * Automatic tag creation from the post editor is untouched — this screen only
 * curates what already exists. Bulk deletion defaults to unused tags only, so
 * a mis-click cannot strip tags off published posts.
 */
export function TagManager({
  rows,
  query,
  canEdit,
  canDelete,
  urlPattern = '/blog/tag/{slug}',
}: {
  rows: TagRow[];
  query: string;
  canEdit: boolean;
  canDelete: boolean;
  /** Where tag archives live, from the URL pattern the site serves now. */
  urlPattern?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const selection = useSelection(rows);
  const [editing, setEditing] = React.useState<TagDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<TagRow | null>(null);
  const [confirmBulk, setConfirmBulk] = React.useState<'delete' | 'deleteUnused' | null>(null);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [term, setTerm] = React.useState(query);

  // Search lives in the URL so a filtered view survives a refresh and can be shared.
  React.useEffect(() => setTerm(query), [query]);
  React.useEffect(() => {
    if (term === query) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (term) next.set('q', term);
      else next.delete('q');
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, query, pathname, router, searchParams]);

  async function run(
    fn: () => Promise<{
      ok: boolean;
      error?: string;
      message?: string;
      fieldErrors?: Record<string, string[]>;
    }>,
  ) {
    setPending(true);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast(result.error ?? 'Something went wrong.', 'error');
      return false;
    }
    toast(result.message ?? 'Saved.');
    router.refresh();
    return true;
  }

  async function save() {
    if (!editing) return;
    setErrors({});
    const data = new FormData();
    data.set('name', editing.name);
    data.set('slug', editing.slug);
    data.set('description', editing.description);
    data.set('isActive', String(editing.isActive));
    data.set('seoTitle', editing.seoTitle);
    data.set('seoDescription', editing.seoDescription);
    data.set('canonicalUrl', editing.canonicalUrl);
    data.set('noIndex', String(editing.noIndex));
    if (await run(() => saveBlogTag(editing.id || null, data))) setEditing(null);
  }

  const unusedSelected = rows.filter(
    (row) => selection.selected.includes(row.id) && row.postCount === 0,
  ).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search tags"
            aria-label="Search tags"
            className="pl-9"
          />
        </div>
        {canEdit ? (
          <Button className="sm:ml-auto" onClick={() => setEditing({ ...BLANK })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New tag
          </Button>
        ) : null}
      </div>

      {canDelete ? (
        <BulkBar count={selection.selected.length} onClear={selection.clear}>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || unusedSelected === 0}
            onClick={() => setConfirmBulk('deleteUnused')}
          >
            Delete unused ({unusedSelected})
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => setConfirmBulk('delete')}
          >
            Delete selected
          </Button>
        </BulkBar>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-5 w-5" />}
          title={query ? `No tag matches “${query}”` : 'No tags yet'}
          description={
            query
              ? 'Try a different search.'
              : 'Tags appear here as soon as a post uses one, or you can add one now.'
          }
          action={
            canEdit && !query ? (
              <Button onClick={() => setEditing({ ...BLANK })}>New tag</Button>
            ) : undefined
          }
        />
      ) : (
        <TableWrap>
          <Table className="min-w-[34rem]">
            <caption className="sr-only">Blog tags</caption>
            <thead>
              <tr>
                {canDelete ? (
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      checked={selection.allSelected}
                      onChange={selection.toggleAll}
                      aria-label="Select all tags"
                      className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                    />
                  </Th>
                ) : null}
                <Th>Tag</Th>
                <Th>URL</Th>
                <Th align="center">Posts</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  {canDelete ? (
                    <Td>
                      <input
                        type="checkbox"
                        checked={selection.selected.includes(row.id)}
                        onChange={() => selection.toggle(row.id)}
                        aria-label={`Select ${row.name}`}
                        className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                      />
                    </Td>
                  ) : null}
                  <Td>
                    <span className="font-medium text-content">{row.name}</span>
                    {row.isActive ? null : (
                      <span className="ml-2 text-xs text-muted">Hidden</span>
                    )}
                    {row.description ? (
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {row.description}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <code className="rounded bg-muted/10 px-1.5 py-0.5 font-mono text-xs text-muted">
                      {fillPattern(urlPattern, row.slug)}
                    </code>
                  </Td>
                  <Td align="center" className="text-sm text-muted">
                    {row.postCount === 0 ? (
                      <span className="text-amber-700">Unused</span>
                    ) : (
                      row.postCount
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditing(draftFrom(row))}
                          aria-label={`Edit ${row.name}`}
                          className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(row)}
                          aria-label={`Delete ${row.name}`}
                          className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit tag' : 'New tag'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !editing?.name.trim()}>
              {pending ? (
                <>
                  <Spinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save tag'
              )}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <Field label="Name" htmlFor="tag-name" required error={errors.name}>
              <Input
                id="tag-name"
                value={editing.name}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    name: event.target.value,
                    // Only derive the slug for a new tag; changing an existing
                    // one would break its live archive URL without warning.
                    slug: editing.id ? editing.slug : slugify(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="URL slug" htmlFor="tag-slug" error={errors.slug} hint={urlPattern.replace('{slug}', '…')}>
              <Input
                id="tag-slug"
                value={editing.slug}
                onChange={(event) => setEditing({ ...editing, slug: event.target.value })}
              />
            </Field>
            <Field label="Description" htmlFor="tag-description" error={errors.description}>
              <Textarea
                id="tag-description"
                rows={2}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </Field>
            <div className="rounded-lg border border-hairline p-3">
              <Switch
                checked={editing.isActive}
                onChange={(next) => setEditing({ ...editing, isActive: next })}
                label="Offer this tag publicly"
                hint="A hidden tag keeps its archive URL working; it just stops being listed."
              />
            </div>
            <Field label="SEO title" htmlFor="tag-seo-title" error={errors.seoTitle}>
              <Input
                id="tag-seo-title"
                value={editing.seoTitle}
                onChange={(event) => setEditing({ ...editing, seoTitle: event.target.value })}
              />
            </Field>
            <Field
              label="Meta description"
              htmlFor="tag-seo-description"
              error={errors.seoDescription}
            >
              <Textarea
                id="tag-seo-description"
                rows={2}
                value={editing.seoDescription}
                onChange={(event) =>
                  setEditing({ ...editing, seoDescription: event.target.value })
                }
              />
            </Field>
            <Field label="Canonical URL" htmlFor="tag-canonical" error={errors.canonicalUrl}>
              <Input
                id="tag-canonical"
                value={editing.canonicalUrl}
                onChange={(event) => setEditing({ ...editing, canonicalUrl: event.target.value })}
              />
            </Field>
            <div className="rounded-lg border border-hairline p-3">
              <Switch
                checked={editing.noIndex}
                onChange={(next) => setEditing({ ...editing, noIndex: next })}
                label="Hide this archive from search engines (noindex)"
              />
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await run(() => deleteBlogTag(confirmDelete.id));
          setConfirmDelete(null);
        }}
        title={confirmDelete ? `Delete “${confirmDelete.name}”?` : ''}
        message={
          confirmDelete && confirmDelete.postCount > 0
            ? `The tag is removed from ${confirmDelete.postCount} post(s). The posts themselves are kept.`
            : 'This tag is not used by any post.'
        }
        confirmLabel="Delete tag"
        pending={pending}
      />

      <ConfirmDialog
        open={Boolean(confirmBulk)}
        onClose={() => setConfirmBulk(null)}
        onConfirm={async () => {
          if (!confirmBulk) return;
          const ok = await run(() =>
            bulkBlogTagAction({ ids: selection.selected, action: confirmBulk }),
          );
          setConfirmBulk(null);
          if (ok) selection.clear();
        }}
        title={
          confirmBulk === 'deleteUnused'
            ? `Delete ${unusedSelected} unused tag(s)?`
            : `Delete ${selection.selected.length} tag(s)?`
        }
        message={
          confirmBulk === 'deleteUnused'
            ? 'Only the selected tags that no post uses are deleted.'
            : 'Selected tags are removed from every post that uses them. The posts themselves are kept.'
        }
        confirmLabel="Delete tags"
        pending={pending}
      />
    </>
  );
}
