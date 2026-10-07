import type { CountrySettingsView } from '@/lib/country/types';

/**
 * A city's own contact details, over its market's.
 *
 * City → market → site, resolved when a page is rendered and never copied
 * into rows: a city that leaves its phone number blank shows the market's,
 * and the market's shows the site's (that step is `getCountrySettings`), so
 * changing the market's number changes every city that has none of its own.
 *
 * Only the details that can differ by city are taken from it: the sales
 * phone, WhatsApp number and sales email, the address and the coordinates.
 * Company identity, support lines, tax details and the rest stay the
 * market's. An address is taken as a whole — a city with its own address
 * replaces the market's lines rather than mixing its street with the market's
 * postcode — and coordinates only as a pair.
 */

export type CityLocalDetails = {
  name: string;
  region: string | null;
  salesPhone: string | null;
  whatsappNumber: string | null;
  salesEmail: string | null;
  address: string | null;
  postalCode: string | null;
  latitude: string | null;
  longitude: string | null;
};

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function withCityDetails(local: CountrySettingsView, city: CityLocalDetails | null): CountrySettingsView {
  if (!city) return local;
  const address = clean(city.address);
  const latitude = clean(city.latitude);
  const longitude = clean(city.longitude);
  return {
    ...local,
    salesPhone: clean(city.salesPhone) ?? local.salesPhone,
    whatsappNumber: clean(city.whatsappNumber) ?? local.whatsappNumber,
    salesEmail: clean(city.salesEmail) ?? local.salesEmail,
    ...(address
      ? {
          address,
          addressLine1: null,
          addressLine2: null,
          city: city.name,
          region: clean(city.region),
          postalCode: clean(city.postalCode),
        }
      : {}),
    ...(latitude && longitude ? { latitude, longitude } : {}),
  };
}
