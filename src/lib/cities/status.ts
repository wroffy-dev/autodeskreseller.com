/**
 * A city's publication status — the one switch an editor sets.
 *
 * | Status    | Pages served publicly          | Sitemap | Listed by default |
 * |-----------|--------------------------------|---------|-------------------|
 * | DRAFT     | No — every city address is 404 | No      | Yes               |
 * | PUBLISHED | Yes, each page by its own status | Yes, when indexable | Yes |
 * | ARCHIVED  | No — every city address is 404 | No      | No (Archived filter) |
 *
 * New cities start as drafts, so a city and its generated pages are reviewed
 * before anyone can reach them. Archiving keeps everything — the city, its
 * pages, their addresses — and publishing it again brings it all back.
 *
 * `isActive` and `isPublished` on the row are derived from the status and kept
 * equal to it by a database CHECK constraint (`City_status_flags`); every
 * public query filters on them. Write a status through `cityStatusColumns`.
 *
 * Plain values only, so the admin screens can use the labels.
 */

export const CITY_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type CityStatus = (typeof CITY_STATUSES)[number];

export const CITY_STATUS_LABELS: Record<CityStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export const CITY_STATUS_HELP: Record<CityStatus, string> = {
  DRAFT: 'Not public: every address in the city answers 404 until it is published.',
  PUBLISHED: 'Public: the city’s published pages are served and, when indexable, listed in the sitemap.',
  ARCHIVED: 'Not public and hidden from the default list. Nothing is deleted; publish it again to bring it back.',
};

/** The columns a status is stored as. `archivedAt` keeps its first value while the city stays archived. */
export function cityStatusColumns(
  status: CityStatus,
  previous?: { status: CityStatus; archivedAt: Date | null } | null,
): { status: CityStatus; isActive: boolean; isPublished: boolean; archivedAt: Date | null } {
  const published = status === 'PUBLISHED';
  return {
    status,
    isActive: published,
    isPublished: published,
    archivedAt:
      status === 'ARCHIVED' ? (previous?.status === 'ARCHIVED' && previous.archivedAt ? previous.archivedAt : new Date()) : null,
  };
}

/** Whether moving from one status to another puts pages in front of visitors — which needs the publish permission. */
export function isPublishing(from: CityStatus | null, to: CityStatus): boolean {
  return to === 'PUBLISHED' && from !== 'PUBLISHED';
}

export function isCityStatus(value: unknown): value is CityStatus {
  return typeof value === 'string' && (CITY_STATUSES as readonly string[]).includes(value);
}
