/**
 * The city form's values and a blank set of them.
 *
 * A plain module, not a client one: the server pages build the form's initial
 * values from these, and a value exported from a `'use client'` module reaches
 * a Server Component as a client reference, not as the object itself.
 */

import type { CityStatus } from '@/lib/cities/status';

export type CityFormValues = {
  id: string | null;
  countryId: string;
  name: string;
  slug: string;
  region: string;
  status: CityStatus;
  sortOrder: number;
  salesPhone: string;
  whatsappNumber: string;
  salesEmail: string;
  address: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  seoTitle: string;
  seoDescription: string;
  primaryKeyword1: string;
  primaryKeyword2: string;
  primaryKeyword3: string;
  noIndex: boolean;
  excludeFromSitemap: boolean;
};

export type CityFormMarket = { id: string; name: string; code: string; slug: string };

export const BLANK_CITY: Omit<CityFormValues, 'countryId'> = {
  id: null,
  name: '',
  slug: '',
  region: '',
  status: 'DRAFT',
  sortOrder: 0,
  salesPhone: '',
  whatsappNumber: '',
  salesEmail: '',
  address: '',
  postalCode: '',
  latitude: '',
  longitude: '',
  seoTitle: '',
  seoDescription: '',
  primaryKeyword1: '',
  primaryKeyword2: '',
  primaryKeyword3: '',
  noIndex: false,
  excludeFromSitemap: false,
};
