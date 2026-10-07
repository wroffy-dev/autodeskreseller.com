'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ExternalLink, FileText, Globe, MapPin, Pencil, Plus, Trash, Wand2 } from 'lucide-react';
import { deleteCity, setCityStatus } from '@/lib/actions/cities';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { RowMenu, RowMenuItem } from '@/components/admin/row-menu';
import { ContentStatusBadge } from '@/components/admin/status-badge';
import { ScoreNumber } from '@/components/admin/seo/score-display';
import { formatNumber } from '@/lib/utils/format';
import { CITY_STATUS_LABELS, type CityStatus } from '@/lib/cities/status';

const STATUS_TONES = { DRAFT: 'warning', PUBLISHED: 'success', ARCHIVED: 'neutral' } as const;

export type CityTableRow = {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  status: CityStatus;
  noIndex: boolean;
  excludeFromSitemap: boolean;
  country: { id: string; name: string; code: string; slug: string };
  /** The city's public address, market prefix included: `/delhi`, `/ae/dubai`. */
  path: string;
  pageCount: number;
  landing: { id: string; title: string; status: string } | null;
  landingScore: number | null;
};

export type CityPermissions = { create: boolean; edit: boolean; publish: boolean; delete: boolean };

export function CitiesTable({
  rows,
  can,
  showCountry,
  filtered,
}: {
  rows: CityTableRow[];
  can: CityPermissions;
  showCountry: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<CityTableRow | null>(null);

  async function changeStatus(row: CityTableRow, status: CityStatus) {
    setPending(row.id);
    const result = await setCityStatus({ cityId: row.id, status });
    setPending(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Saved.');
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(deleting.id);
    const result = await deleteCity({ cityId: deleting.id });
    setPending(null);
    setDeleting(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(result.message ?? 'Deleted.');
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<MapPin className="h-5 w-5" />}
        title={filtered ? 'No cities match those filters' : 'No cities yet'}
        description={
          filtered
            ? 'Try clearing the search or the status filter.'
            : 'Add a city to give it its own address space — /delhi, /ae/dubai — with pages built in the Page Builder.'
        }
        action={
          can.create && !filtered ? (
            <ButtonLink href="/admin/cities/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New city
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <TableWrap>
        <Table>
          <caption className="sr-only">Cities</caption>
          <thead>
            <tr>
              <Th>City</Th>
              {showCountry ? <Th>Country</Th> : null}
              <Th>Region</Th>
              <Th>URL</Th>
              <Th align="center">Pages</Th>
              <Th>Landing page</Th>
              <Th align="center">SEO</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const live = row.status === 'PUBLISHED' && row.landing?.status === 'PUBLISHED';
              return (
                <Tr key={row.id}>
                  <Td>
                    <Link href={`/admin/cities/${row.id}`} className="font-medium text-content hover:text-brand">
                      {row.name}
                    </Link>
                  </Td>
                  {showCountry ? (
                    <Td>
                      <Badge tone="info" title={row.country.name}>
                        {row.country.code}
                      </Badge>
                    </Td>
                  ) : null}
                  <Td className="text-muted">{row.region ?? '—'}</Td>
                  <Td>
                    <code className="font-mono text-xs text-content">{row.path}</code>
                  </Td>
                  <Td align="center">
                    {row.pageCount > 0 ? (
                      <Link
                        href={`/admin/pages?country=${row.country.id}&city=${row.id}`}
                        className="font-medium text-brand hover:underline"
                        aria-label={`${formatNumber(row.pageCount)} pages in ${row.name}`}
                      >
                        {formatNumber(row.pageCount)}
                      </Link>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </Td>
                  <Td>
                    {row.landing ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/admin/pages/${row.landing.id}`} className="text-sm text-content hover:text-brand">
                          {row.landing.title}
                        </Link>
                        <ContentStatusBadge status={row.landing.status} />
                      </span>
                    ) : (
                      <span className="text-xs text-muted">None yet</span>
                    )}
                  </Td>
                  <Td align="center">
                    {row.landingScore !== null ? (
                      <ScoreNumber score={row.landingScore} />
                    ) : (
                      <span className="text-xs text-muted" title="The landing page has not been scored yet">
                        —
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONES[row.status]}>{CITY_STATUS_LABELS[row.status]}</Badge>
                      {row.noIndex ? <Badge tone="warning">Noindex</Badge> : null}
                      {row.excludeFromSitemap ? <Badge tone="neutral">Not in sitemap</Badge> : null}
                    </span>
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/admin/cities/${row.id}`}
                        className="rounded p-1.5 text-muted transition-colors hover:bg-muted/10 hover:text-content"
                        aria-label={`Edit ${row.name}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Link>
                      <RowMenu label={`More actions for ${row.name}`}>
                        {row.landing ? (
                          <RowMenuItem onClick={() => router.push(`/admin/pages/${row.landing!.id}`)}>
                            <FileText className="h-4 w-4" aria-hidden="true" />
                            Edit landing page
                          </RowMenuItem>
                        ) : null}
                        {live ? (
                          <RowMenuItem onClick={() => window.open(row.path, '_blank', 'noopener,noreferrer')}>
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                            Open landing page
                          </RowMenuItem>
                        ) : null}
                        <RowMenuItem onClick={() => router.push(`/admin/pages?country=${row.country.id}&city=${row.id}`)}>
                          <FileText className="h-4 w-4" aria-hidden="true" />
                          View pages
                        </RowMenuItem>
                        {can.create ? (
                          <RowMenuItem
                            onClick={() =>
                              router.push(`/admin/cities/generator?country=${row.country.id}&city=${row.id}`)
                            }
                          >
                            <Wand2 className="h-4 w-4" aria-hidden="true" />
                            Generate pages
                          </RowMenuItem>
                        ) : null}
                        {can.publish && row.status !== 'PUBLISHED' ? (
                          <RowMenuItem onClick={() => changeStatus(row, 'PUBLISHED')} disabled={pending === row.id}>
                            <Globe className="h-4 w-4" aria-hidden="true" />
                            Publish
                          </RowMenuItem>
                        ) : null}
                        {can.edit && row.status === 'PUBLISHED' ? (
                          <RowMenuItem onClick={() => changeStatus(row, 'DRAFT')} disabled={pending === row.id}>
                            <FileText className="h-4 w-4" aria-hidden="true" />
                            Back to draft
                          </RowMenuItem>
                        ) : null}
                        {can.edit && row.status === 'ARCHIVED' ? (
                          <RowMenuItem onClick={() => changeStatus(row, 'DRAFT')} disabled={pending === row.id}>
                            <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                            Restore as draft
                          </RowMenuItem>
                        ) : null}
                        {can.edit && row.status !== 'ARCHIVED' ? (
                          <RowMenuItem onClick={() => changeStatus(row, 'ARCHIVED')} disabled={pending === row.id}>
                            <Archive className="h-4 w-4" aria-hidden="true" />
                            Archive
                          </RowMenuItem>
                        ) : null}
                        {can.delete ? (
                          <RowMenuItem tone="danger" onClick={() => setDeleting(row)} disabled={pending === row.id}>
                            <Trash className="h-4 w-4" aria-hidden="true" />
                            Delete
                          </RowMenuItem>
                        ) : null}
                      </RowMenu>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      {/* A city with pages is never deleted: say how many, and offer to archive it instead. */}
      <Dialog
        open={deleting !== null && deleting.pageCount > 0}
        onClose={() => setDeleting(null)}
        title={`${deleting?.name ?? 'This city'} still has pages`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Close
            </Button>
            {deleting && deleting.status !== 'ARCHIVED' && can.edit ? (
              <Button
                onClick={async () => {
                  const row = deleting;
                  setDeleting(null);
                  await changeStatus(row, 'ARCHIVED');
                }}
              >
                Archive instead
              </Button>
            ) : null}
          </>
        }
      >
        <p className="text-sm text-muted">
          {deleting
            ? `${deleting.name} has ${deleting.pageCount} page${deleting.pageCount === 1 ? '' : 's'}${deleting.landing ? ', including its landing page' : ''}, so it cannot be deleted. Delete or move ${deleting.pageCount === 1 ? 'it' : 'them'} first — or archive the city: its pages answer 404 until it is published again, and nothing is deleted.`
            : null}
        </p>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null && deleting.pageCount === 0}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        pending={pending !== null}
        title={`Delete ${deleting?.name ?? 'this city'}?`}
        message={`${deleting?.name ?? 'The city'} has no pages. Deleting it frees ${deleting?.path ?? 'its address'} for other content. This cannot be undone.`}
        confirmLabel="Delete city"
      />
    </>
  );
}
