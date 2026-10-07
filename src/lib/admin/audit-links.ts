/**
 * Where a record of each audited type lives in the admin, so "what changed" in
 * the audit log is one click from the thing that changed.
 *
 * Only types with a real `/[id]` screen belong here — linking anything else
 * would send the admin to a 404 from a log they cannot act on. Settings
 * singletons and records managed inline are deliberately absent and render as
 * plain text instead.
 */
const ENTITY_ROUTES: Record<string, string> = {
  BlogPost: '/admin/blog',
  City: '/admin/cities',
  Customer: '/admin/customers',
  Form: '/admin/forms',
  Lead: '/admin/leads',
  Page: '/admin/pages',
  Product: '/admin/products',
  User: '/admin/staff',
};

export function entityHref(entity: string, entityId: string | null): string | null {
  const base = ENTITY_ROUTES[entity];
  if (!base || !entityId) return null;
  return `${base}/${entityId}`;
}
