/**
 * Shared shapes for the topbar search, used by the server action that runs the
 * queries and by the client component that shows the results.
 */

export type SearchHit = {
  id: string;
  type: 'Lead' | 'Customer' | 'Page' | 'City' | 'Product' | 'Post' | 'Media' | 'Staff' | 'Form';
  title: string;
  subtitle: string | null;
  href: string;
};

/** The order result groups are listed in, most-used first. */
export const SEARCH_TYPE_ORDER: SearchHit['type'][] = [
  'Lead',
  'Customer',
  'Page',
  'City',
  'Product',
  'Post',
  'Form',
  'Media',
  'Staff',
];

/** The module each record type is listed under in the results. */
export const SEARCH_GROUP_LABEL: Record<SearchHit['type'], string> = {
  Lead: 'Leads',
  Customer: 'Customers',
  Page: 'Pages',
  City: 'Cities',
  Product: 'Products',
  Post: 'Blog posts',
  Form: 'Forms',
  Media: 'Media',
  Staff: 'Staff',
};

/** Longest query accepted; anything longer is cut rather than refused. */
export const SEARCH_MAX_QUERY = 80;
/** Rows fetched per record type. */
export const SEARCH_PER_TYPE = 5;
/** Characters needed before records are searched (navigation matches from 1). */
export const SEARCH_MIN_QUERY = 2;
