import { describe, it, expect } from 'vitest';
import { entityHref } from '@/lib/admin/audit-links';

/**
 * The audit log links "what changed" to the record that changed. A link is only
 * safe to render when the entity really has a `/[id]` screen — otherwise the
 * admin is sent to a 404 from a log they cannot fix.
 */
describe('audit log entity links', () => {
  it('links entities that have a detail route', () => {
    expect(entityHref('Lead', 'lead-1')).toBe('/admin/leads/lead-1');
    expect(entityHref('Page', 'page-1')).toBe('/admin/pages/page-1');
    expect(entityHref('Product', 'prod-1')).toBe('/admin/products/prod-1');
    expect(entityHref('BlogPost', 'post-1')).toBe('/admin/blog/post-1');
    expect(entityHref('Form', 'form-1')).toBe('/admin/forms/form-1');
    expect(entityHref('Customer', 'cust-1')).toBe('/admin/customers/cust-1');
    expect(entityHref('User', 'user-1')).toBe('/admin/staff/user-1');
    expect(entityHref('City', 'city-1')).toBe('/admin/cities/city-1');
  });

  it('does not link settings singletons or types with no detail screen', () => {
    for (const entity of [
      'SeoSettings',
      'WebsiteSettings',
      'TrackingSettings',
      'EmailSettings',
      'Navigation',
      'Redirect',
      'Brand',
      'ProductCategory',
      'BlogCategory',
      'Media',
      'Popup',
      'LeadMagnet',
      'TrackingScript',
      'UserRole',
      'EmailTemplate',
    ]) {
      expect(entityHref(entity, 'some-id')).toBeNull();
    }
  });

  it('does not link when the record id is missing', () => {
    expect(entityHref('Lead', null)).toBeNull();
    expect(entityHref('Page', null)).toBeNull();
  });

  it('does not link an unknown entity name', () => {
    expect(entityHref('SomethingNew', 'id-1')).toBeNull();
  });
});
