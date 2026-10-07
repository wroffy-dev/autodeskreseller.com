'use client';

import * as React from 'react';
import Link from 'next/link';
import { LayoutTemplate, Plus } from 'lucide-react';
import { PageRowActions, PageBulkBar } from './page-list-actions';
import { ContentStatusBadge } from '@/components/admin/lead-status-badge';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/format';

export type PageRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  isHomepage: boolean;
  updatedAt: string;
  /** Null when the page is uncategorised. */
  categoryName: string | null;
  /** The city the page belongs to, if any. */
  cityName?: string | null;
  isCityHomepage?: boolean;
  /** The market this page belongs to. */
  countryName: string;
  countryCode: string;
  countrySlug: string;
  sectionCount: number;
};

export type PagePermissions = {
  edit: boolean;
  publish: boolean;
  create: boolean;
  delete: boolean;
};

export function PagesTable({
  rows,
  can,
  filtered,
  showCountry = false,
  countries = [],
}: {
  rows: PageRow[];
  can: PagePermissions;
  filtered: boolean;
  /** Adds the Country column. Hidden on a single-market installation. */
  showCountry?: boolean;
  /** Markets a page can be copied into. */
  countries?: Array<{ id: string; code: string; name: string }>;
}) {
  const [selected, setSelected] = React.useState<string[]>([]);

  // Drop selections for rows that are no longer on screen.
  React.useEffect(() => {
    setSelected((current) => current.filter((id) => rows.some((row) => row.id === id)));
  }, [rows]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<LayoutTemplate className="h-5 w-5" />}
        title={filtered ? 'No pages match those filters' : 'No pages yet'}
        description={
          filtered
            ? 'Try clearing the search or the status filter.'
            : 'Create your first page and start adding sections.'
        }
        action={
          can.create ? (
            <ButtonLink href="/admin/pages/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New page
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  const allSelected = selected.length === rows.length;
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    );

  return (
    <>
      {can.edit || can.delete ? (
        <div className="px-4 pt-4 sm:px-5">
          <PageBulkBar selected={selected} onClear={() => setSelected([])} can={can} />
        </div>
      ) : null}

      <TableWrap>
        <Table>
          <caption className="sr-only">Website pages</caption>
          <thead>
            <tr>
              {can.edit ? (
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))}
                    aria-label="Select all pages"
                    className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                  />
                </Th>
              ) : null}
              <Th>Title</Th>
              <Th>URL</Th>
              {showCountry ? <Th>Country</Th> : null}
              <Th>Category</Th>
              <Th>Status</Th>
              <Th align="center">Sections</Th>
              <Th>Updated</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                {can.edit ? (
                  <Td>
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.title}`}
                      className="h-4 w-4 rounded border-hairline text-brand focus:ring-brand/30"
                    />
                  </Td>
                ) : null}
                <Td>
                  <Link
                    href={`/admin/pages/${row.id}`}
                    className="font-medium text-content hover:text-brand"
                  >
                    {row.title}
                  </Link>
                  {row.isHomepage ? (
                    <Badge tone="brand" className="ml-2">
                      Homepage
                    </Badge>
                  ) : null}
                  {row.cityName ? (
                    <Badge tone="info" className="ml-2" title={row.isCityHomepage ? 'The city’s landing page' : 'A page in this city'}>
                      {row.cityName}
                      {row.isCityHomepage ? ' · landing' : ''}
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <code className="rounded bg-muted/10 px-1.5 py-0.5 font-mono text-xs text-muted">
                    /{[row.countrySlug, row.slug].filter(Boolean).join('/')}
                  </code>
                </Td>
                {showCountry ? (
                  <Td className="whitespace-nowrap text-sm text-content">{row.countryName}</Td>
                ) : null}
                <Td className="text-sm">
                  {row.categoryName ? (
                    <span className="text-content">{row.categoryName}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td>
                  <ContentStatusBadge status={row.status} />
                </Td>
                <Td align="center" className="text-sm text-muted">
                  {row.sectionCount}
                </Td>
                <Td className="whitespace-nowrap text-sm text-muted">
                  {formatDate(row.updatedAt)}
                </Td>
                <Td align="right">
                  <PageRowActions
                    pageId={row.id}
                    slug={row.slug}
                    status={row.status}
                    isHomepage={row.isHomepage}
                    countrySlug={row.countrySlug}
                    // A page is only offered to markets other than its own —
                    // which is the row's market, not the one being filtered by.
                    countries={countries.filter((country) => country.code !== row.countryCode)}
                    can={can}
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}
