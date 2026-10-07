'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash, Tag, ArrowUp, ArrowDown, CornerDownRight } from 'lucide-react';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Textarea, Select, Switch } from '@/components/ui/field';
import { MediaPicker } from '@/components/admin/media-picker';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/icons';
import { slugify } from '@/lib/utils/slug';
import { flattenTree, descendantIds } from '@/lib/utils/tree';
import { cn } from '@/lib/utils/cn';
import { fillPattern } from '@/lib/urls/path';

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  /** Pages or posts filed under this category. */
  itemCount: number;
  /** Extra fields some taxonomies carry; ignored when the caller omits them. */
  seoTitle?: string | null;
  seoDescription?: string | null;
  /**
   * Values for the caller's `extraFields`. Keeping them in one bag is what
   * lets blog categories carry banners, archive copy and full SEO without page
   * categories growing any of it.
   */
  extra?: Record<string, string | boolean | null>;
};

/** One additional control a taxonomy contributes to the edit dialog. */
export type CategoryExtraField = {
  name: string;
  label: string;
  kind: 'text' | 'textarea' | 'media' | 'switch';
  hint?: string;
};

type Draft = {
  id: string;
  name: string;
  slug: string;
  description: string;
  parentId: string;
  sortOrder: string;
  seoTitle: string;
  seoDescription: string;
  extra: Record<string, string | boolean | null>;
};

const BLANK: Draft = {
  id: '',
  name: '',
  slug: '',
  description: '',
  parentId: '',
  sortOrder: '0',
  seoTitle: '',
  seoDescription: '',
  extra: {},
};

type ActionResultish = {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

/**
 * Hierarchical category management, shared by page categories and blog
 * categories because the two are the same shape: a nested list with a slug, a
 * count and reordering.
 *
 * The parent dropdown hides the category being edited and all of its own
 * descendants, so a cycle cannot be selected in the first place. The server
 * re-checks regardless — the dropdown is a convenience, not the guard.
 */
export function CategoryTreeManager({
  rows,
  canEdit,
  canDelete,
  urlPrefix,
  urlPattern,
  itemLabel,
  withSeo = false,
  extraFields = [],
  extraDefaults = {},
  onSave,
  onDelete,
  onReorder,
  emptyDescription,
}: {
  rows: CategoryRow[];
  canEdit: boolean;
  canDelete: boolean;
  /** Shown beside each row, e.g. "/blog/category/". */
  urlPrefix: string;
  /** Where rows live when that is a URL pattern, e.g. "/insights/{slug}"; wins over the prefix. */
  urlPattern?: string;
  /** What the count counts: "post" or "page". */
  itemLabel: string;
  withSeo?: boolean;
  /** Taxonomy-specific controls appended to the edit dialog. */
  extraFields?: CategoryExtraField[];
  /** Values a brand-new category starts with for those controls. */
  extraDefaults?: Record<string, string | boolean | null>;
  onSave: (id: string | null, data: FormData) => Promise<ActionResultish>;
  onDelete: (id: string, movePagesTo: string | null) => Promise<ActionResultish>;
  onReorder?: (ids: string[]) => Promise<ActionResultish>;
  emptyDescription: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<CategoryRow | null>(null);
  const [moveTarget, setMoveTarget] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  // Parents above their children, each with a depth for indentation.
  const ordered = React.useMemo(
    () => flattenTree(rows, (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [rows],
  );

  /** Valid parents for the category being edited: never itself or its own subtree. */
  const parentOptions = React.useMemo(() => {
    const excluded = editing?.id
      ? new Set([editing.id, ...descendantIds(rows, editing.id)])
      : new Set<string>();
    return ordered.filter((entry) => !excluded.has(entry.node.id));
  }, [ordered, rows, editing]);

  async function run(fn: () => Promise<ActionResultish>) {
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
    data.set('parentId', editing.parentId);
    data.set('sortOrder', editing.sortOrder);
    if (withSeo) {
      data.set('seoTitle', editing.seoTitle);
      data.set('seoDescription', editing.seoDescription);
    }
    for (const field of extraFields) {
      const value = editing.extra[field.name];
      data.set(field.name, value === null || value === undefined ? '' : String(value));
    }

    if (await run(() => onSave(editing.id || null, data))) setEditing(null);
  }

  /** Moves a category one place within its own siblings. */
  async function move(id: string, direction: -1 | 1) {
    if (!onReorder) return;
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return;

    const siblings = ordered
      .filter((entry) => entry.node.parentId === row.parentId)
      .map((entry) => entry.node.id);
    const index = siblings.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;

    const next = [...siblings];
    [next[index], next[target]] = [next[target]!, next[index]!];

    // Only this branch is renumbered; every other branch keeps its order.
    const full = ordered.map((entry) => entry.node.id);
    const reordered = full.filter((candidate) => !next.includes(candidate)).concat(next);
    await run(() => onReorder(reordered));
  }

  const startEdit = (row: CategoryRow) =>
    setEditing({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description ?? '',
      parentId: row.parentId ?? '',
      sortOrder: String(row.sortOrder),
      seoTitle: row.seoTitle ?? '',
      seoDescription: row.seoDescription ?? '',
      extra: { ...extraDefaults, ...(row.extra ?? {}) },
    });

  const deleteTargets = confirmDelete
    ? ordered.filter(
        (entry) =>
          entry.node.id !== confirmDelete.id &&
          !descendantIds(rows, confirmDelete.id).has(entry.node.id),
      )
    : [];

  return (
    <>
      {canEdit ? (
        <div className="mb-4">
          <Button onClick={() => setEditing({ ...BLANK, extra: { ...extraDefaults } })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New category
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Tag className="h-5 w-5" />}
          title="No categories yet"
          description={emptyDescription}
          action={
            canEdit ? (
              <Button onClick={() => setEditing({ ...BLANK, extra: { ...extraDefaults } })}>
                New category
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableWrap>
          <Table className="min-w-[40rem]">
            <caption className="sr-only">Categories</caption>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>URL</Th>
                <Th align="center">{itemLabel}s</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(({ node: row, depth }) => (
                <Tr key={row.id}>
                  <Td>
                    <span
                      className="flex items-center gap-1.5"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                    >
                      {depth > 0 ? (
                        <CornerDownRight
                          className="h-3.5 w-3.5 shrink-0 text-muted"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="min-w-0">
                        <span
                          className={cn(
                            'block truncate text-content',
                            depth === 0 ? 'font-medium' : 'font-normal',
                          )}
                        >
                          {row.name}
                        </span>
                        {row.description ? (
                          <span className="block truncate text-xs text-muted">
                            {row.description}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <code className="rounded bg-muted/10 px-1.5 py-0.5 font-mono text-xs text-muted">
                      {urlPattern ? fillPattern(urlPattern, row.slug) : `${urlPrefix}${row.slug}`}
                    </code>
                  </Td>
                  <Td align="center" className="text-sm text-muted">
                    {row.itemCount}
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && onReorder ? (
                        <>
                          <button
                            type="button"
                            onClick={() => move(row.id, -1)}
                            disabled={pending}
                            aria-label={`Move ${row.name} up`}
                            className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content disabled:opacity-40"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(row.id, 1)}
                            disabled={pending}
                            aria-label={`Move ${row.name} down`}
                            className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content disabled:opacity-40"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          aria-label={`Edit ${row.name}`}
                          className="rounded p-1.5 text-muted hover:bg-muted/10 hover:text-content"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMoveTarget('');
                            setConfirmDelete(row);
                          }}
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
        title={editing?.id ? 'Edit category' : 'New category'}
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
                'Save category'
              )}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <Field label="Name" htmlFor="cat-name" required error={errors.name}>
              <Input
                id="cat-name"
                value={editing.name}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    name: event.target.value,
                    // Only auto-fill the slug for a new category; changing an
                    // existing one silently would break its live URL.
                    slug: editing.id ? editing.slug : slugify(event.target.value),
                  })
                }
              />
            </Field>

            <Field label="URL slug" htmlFor="cat-slug" error={errors.slug} hint={urlPattern ? urlPattern.replace('{slug}', '…') : urlPrefix}>
              <Input
                id="cat-slug"
                value={editing.slug}
                onChange={(event) => setEditing({ ...editing, slug: event.target.value })}
              />
            </Field>

            <Field
              label="Parent category"
              htmlFor="cat-parent"
              hint="Leave empty for a top-level category."
              error={errors.parentId}
            >
              <Select
                id="cat-parent"
                value={editing.parentId}
                onChange={(event) => setEditing({ ...editing, parentId: event.target.value })}
              >
                <option value="">No parent (top level)</option>
                {parentOptions.map(({ node, depth }) => (
                  <option key={node.id} value={node.id}>
                    {`${'— '.repeat(depth)}${node.name}`}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Description" htmlFor="cat-description" error={errors.description}>
              <Textarea
                id="cat-description"
                rows={2}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </Field>

            {withSeo ? (
              <>
                <Field label="SEO title" htmlFor="cat-seo-title" error={errors.seoTitle}>
                  <Input
                    id="cat-seo-title"
                    value={editing.seoTitle}
                    onChange={(event) => setEditing({ ...editing, seoTitle: event.target.value })}
                  />
                </Field>
                <Field
                  label="Meta description"
                  htmlFor="cat-seo-description"
                  error={errors.seoDescription}
                >
                  <Textarea
                    id="cat-seo-description"
                    rows={2}
                    value={editing.seoDescription}
                    onChange={(event) =>
                      setEditing({ ...editing, seoDescription: event.target.value })
                    }
                  />
                </Field>
              </>
            ) : null}

            {extraFields.map((field) => {
              const id = `cat-x-${field.name}`;
              const value = editing.extra[field.name];

              if (field.kind === 'switch') {
                return (
                  <div key={field.name} className="rounded-lg border border-hairline p-3">
                    <Switch
                      checked={value === true || value === 'true'}
                      onChange={(next) =>
                        setEditing({ ...editing, extra: { ...editing.extra, [field.name]: next } })
                      }
                      label={field.label}
                      hint={field.hint}
                    />
                  </div>
                );
              }

              if (field.kind === 'media') {
                return (
                  <Field key={field.name} label={field.label} hint={field.hint}>
                    <MediaPicker
                      value={typeof value === 'string' && value ? value : null}
                      onChange={(next) =>
                        setEditing({
                          ...editing,
                          extra: { ...editing.extra, [field.name]: next },
                        })
                      }
                      label={field.label}
                    />
                  </Field>
                );
              }

              const Control = field.kind === 'textarea' ? Textarea : Input;
              return (
                <Field
                  key={field.name}
                  label={field.label}
                  htmlFor={id}
                  hint={field.hint}
                  error={errors[field.name]}
                >
                  <Control
                    id={id}
                    {...(field.kind === 'textarea' ? { rows: 2 } : {})}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(
                      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                    ) =>
                      setEditing({
                        ...editing,
                        extra: { ...editing.extra, [field.name]: event.target.value },
                      })
                    }
                  />
                </Field>
              );
            })}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete ? `Delete “${confirmDelete.name}”?` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={async () => {
                if (!confirmDelete) return;
                if (await run(() => onDelete(confirmDelete.id, moveTarget || null))) {
                  setConfirmDelete(null);
                }
              }}
            >
              {pending ? 'Deleting…' : 'Delete category'}
            </Button>
          </>
        }
      >
        {confirmDelete ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {confirmDelete.itemCount > 0
                ? `${confirmDelete.itemCount} ${itemLabel}${confirmDelete.itemCount === 1 ? '' : 's'} use this category. Nothing is deleted — choose where they should go.`
                : `No ${itemLabel} uses this category.`}{' '}
              Any subcategories move up one level.
            </p>

            {confirmDelete.itemCount > 0 && deleteTargets.length > 0 ? (
              <Field label={`Move ${itemLabel}s to`} htmlFor="cat-move">
                <Select
                  id="cat-move"
                  value={moveTarget}
                  onChange={(event) => setMoveTarget(event.target.value)}
                >
                  <option value="">Leave uncategorised</option>
                  {deleteTargets.map(({ node, depth }) => (
                    <option key={node.id} value={node.id}>
                      {`${'— '.repeat(depth)}${node.name}`}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
