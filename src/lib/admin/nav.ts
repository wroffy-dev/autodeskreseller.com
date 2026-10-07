import type { PermissionKey } from '@/lib/auth/permissions';
import { SEED_FILES_PATH } from '@/lib/seed-files/routes';

/**
 * Admin information architecture.
 *
 * Modules group the existing routes into the areas an admin actually thinks in
 * ("Website", "Leads & CRM") instead of one flat list. Nothing here creates a
 * route: every href points at a page that already exists.
 */

export type AdminNavItem = {
  label: string;
  href: string;
  /** Any one of these grants access. */
  permission: PermissionKey | PermissionKey[];
  /** Shown in the command palette and as the icon-only tooltip subtitle. */
  description?: string;
  /** Match the route exactly instead of by prefix. */
  exact?: boolean;
  /**
   * Routes that belong to this item but do not share its href prefix, used for
   * active-state and breadcrumbs (e.g. Submissions lives under /admin/forms).
   */
  alsoMatches?: string[];
  /** Sibling routes that must NOT mark this item active. */
  notMatches?: string[];
  /**
   * Hidden from everyone but a super admin, whatever their permissions say.
   *
   * For the few destinations that are not permission-gated at all, because the
   * permission could be granted to any role from the Staff screen and the
   * destination must not be delegable. `permission` stays required, and is
   * what a super admin's blanket access satisfies.
   */
  superAdminOnly?: boolean;
};

export type AdminNavModule = {
  id: string;
  label: string;
  icon: string;
  /**
   * The sidebar heading this module sits under ("Website", "Growth"). Adjacent
   * modules sharing a section are listed together under one heading; a module
   * with none (Dashboard) sits above every heading.
   */
  section?: string;
  /** A group with an href and no items is a single destination (Dashboard). */
  href?: string;
  exact?: boolean;
  permission?: PermissionKey | PermissionKey[];
  items?: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavModule[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    href: '/admin',
    exact: true,
    permission: 'dashboard.view',
  },
  {
    id: 'website',
    label: 'Website',
    icon: 'layout',
    items: [
      {
        label: 'Pages',
        href: '/admin/pages',
        permission: 'pages.view',
        description: 'Build and publish website pages',
        notMatches: ['/admin/pages/categories'],
      },
      {
        label: 'Page Categories',
        href: '/admin/pages/categories',
        permission: 'pages.view',
        description: 'Group pages into a nested structure',
        exact: true,
      },
      {
        label: 'Navigation',
        href: '/admin/navigation',
        permission: 'navigation.manage',
        description: 'Header, footer and legal menus',
      },
      {
        label: 'Media',
        href: '/admin/media',
        permission: 'media.view',
        description: 'Images and files used across the site',
      },
      {
        label: 'Popups',
        href: '/admin/popups',
        permission: 'marketing.manage',
        description: 'On-site popups and offers',
      },
      {
        label: 'Website Design',
        href: '/admin/settings/design',
        permission: 'settings.manage',
        description: 'Colours, typography, buttons and layout',
      },
      {
        label: 'Recycle Bin',
        href: '/admin/trash',
        permission: 'pages.view',
        description: 'Restore a deleted page, article, category or brand',
      },
    ],
  },
  {
    id: 'locations',
    label: 'Locations',
    icon: 'map-pin',
    items: [
      {
        label: 'Cities',
        href: '/admin/cities',
        permission: 'pages.view',
        description: 'Local address spaces inside each market, such as /delhi',
        notMatches: ['/admin/cities/generator'],
      },
      {
        label: 'City Page Generator',
        href: '/admin/cities/generator',
        permission: 'pages.create',
        description: 'Copy a page into many cities at once',
      },
    ],
  },
  {
    id: 'products',
    section: 'Catalogue',
    label: 'Products',
    icon: 'package',
    items: [
      {
        label: 'All Products',
        href: '/admin/products',
        permission: 'products.view',
        description: 'Every product and plan',
        notMatches: [
          '/admin/products/categories',
          '/admin/products/brands',
          '/admin/products/order',
          '/admin/products/design',
          '/admin/products/trash',
        ],
      },
      {
        label: 'Categories',
        href: '/admin/products/categories',
        permission: 'products.view',
        description: 'Group products by category',
      },
      {
        label: 'Brands',
        href: '/admin/products/brands',
        permission: 'products.view',
        description: 'Group products by vendor',
      },
      {
        label: 'Featured & Ordering',
        href: '/admin/products/order',
        permission: 'products.view',
        description: 'Choose the order products appear in',
      },
      {
        label: 'Product Design',
        href: '/admin/products/design',
        permission: 'products.view',
        description: 'Card style, image sizes, page layout and type',
      },
      {
        label: 'Removed Products',
        href: '/admin/products/trash',
        permission: 'products.view',
        description: 'Restore something taken out of the catalogue',
      },
    ],
  },
  {
    id: 'crm',
    section: 'Customers',
    label: 'Leads & CRM',
    icon: 'inbox',
    items: [
      {
        label: 'CRM Dashboard',
        href: '/admin/crm',
        permission: 'leads.view',
        description: 'Lead performance for any date range',
      },
      {
        label: 'Leads',
        href: '/admin/leads',
        permission: 'leads.view',
        description: 'Every enquiry from the website',
      },
      {
        label: 'Consent notice',
        href: '/admin/consent',
        permission: 'leads.view',
        description: 'Wording shown beside every public form',
      },
      {
        label: 'Pipeline',
        href: '/admin/pipeline',
        permission: 'leads.view',
        description: 'Drag leads between stages',
      },
      {
        label: 'Customers',
        href: '/admin/customers',
        permission: 'customers.view',
        description: 'Won leads and their products',
      },
      {
        label: 'Forms',
        href: '/admin/forms',
        permission: 'forms.view',
        description: 'Build the forms that capture leads',
        notMatches: ['/admin/forms/submissions'],
      },
      {
        label: 'Submissions',
        href: '/admin/forms/submissions',
        permission: 'forms.view',
        description: 'Everything visitors have submitted',
      },
    ],
  },
  {
    id: 'content',
    section: 'Content',
    label: 'Content & SEO',
    icon: 'file',
    items: [
      {
        label: 'Blog',
        href: '/admin/blog',
        permission: 'blog.view',
        description: 'Write and publish articles',
        notMatches: [
          '/admin/blog/categories',
          '/admin/blog/tags',
          '/admin/blog/layout',
          '/admin/blog/design',
        ],
      },
      {
        label: 'Blog Layout',
        href: '/admin/blog/layout',
        permission: 'blog.view',
        description: 'Order the archive, article and sidebar',
      },
      {
        label: 'Blog Design',
        href: '/admin/blog/design',
        permission: 'blog.view',
        description: 'Cards, colours, typography and widths',
      },
      {
        label: 'Blog Categories',
        href: '/admin/blog/categories',
        permission: 'blog.view',
        description: 'Organise articles by topic',
      },
      {
        label: 'Blog Tags',
        href: '/admin/blog/tags',
        permission: 'blog.view',
        description: 'Rename, re-slug and clean up tags',
        exact: true,
      },
      {
        label: 'SEO',
        href: '/admin/seo',
        permission: 'seo.manage',
        description: 'Titles, social sharing and indexing',
      },
      {
        label: 'SEO Intelligence',
        href: '/admin/seo-intelligence',
        permission: 'seo.manage',
        description: 'SEO, AEO and GEO scores for every page',
      },
      {
        label: 'Slug & URL Manager',
        href: '/admin/slug-manager',
        permission: 'seo.manage',
        description: 'Addresses, URL patterns, redirects and URL health',
        alsoMatches: ['/admin/redirects'],
      },
    ],
  },
  {
    id: 'marketing',
    section: 'Growth',
    label: 'Marketing',
    icon: 'megaphone',
    items: [
      {
        label: 'Tracking & Pixels',
        href: '/admin/marketing',
        permission: 'marketing.manage',
        description: 'Analytics and advertising tags',
      },
      {
        label: 'UTM Campaigns',
        href: '/admin/marketing/campaigns',
        permission: 'marketing.manage',
        description: 'Build tagged campaign links',
      },
      {
        label: 'Lead Magnets',
        href: '/admin/lead-magnets',
        permission: 'marketing.manage',
        description: 'Downloads offered in exchange for details',
      },
      {
        label: 'Campaign Attribution',
        href: '/admin/reports?view=attribution',
        permission: 'leads.view',
        description: 'Which campaigns produce leads',
        exact: true,
      },
    ],
  },
  {
    id: 'reports',
    section: 'Growth',
    label: 'Reports',
    icon: 'chart',
    items: [
      {
        label: 'Reports',
        href: '/admin/reports',
        permission: 'leads.view',
        description: 'Lead performance over time',
        exact: true,
      },
      {
        label: 'Audit Log',
        href: '/admin/audit',
        permission: 'audit.view',
        description: 'Who changed what, and when',
      },
    ],
  },
  {
    id: 'settings',
    section: 'Admin',
    label: 'Settings',
    icon: 'settings',
    items: [
      {
        label: 'Website Settings',
        href: '/admin/settings',
        permission: 'settings.manage',
        description: 'Name, contact details and branding',
        notMatches: [
          '/admin/settings/email',
          '/admin/settings/design',
          '/admin/settings/countries',
        ],
      },
      {
        label: 'Countries',
        href: '/admin/settings/countries',
        permission: 'settings.manage',
        description: 'Storefronts, URL prefixes, currencies and local contact details',
      },
      {
        label: 'Email Settings',
        href: '/admin/settings/email',
        permission: 'settings.manage',
        description: 'SMTP and notification templates',
      },
      {
        label: 'Staff',
        href: '/admin/staff',
        permission: 'staff.manage',
        description: 'People who can sign in',
      },
      {
        label: 'Roles & Permissions',
        href: '/admin/staff?tab=roles',
        permission: 'staff.manage',
        description: 'What each role is allowed to do',
        exact: true,
      },
      {
        label: 'Backup & Restore',
        href: '/admin/settings/backups',
        permission: 'backup.view',
        description: 'Download, schedule and restore site backups',
      },
      {
        label: 'Seed Files',
        href: SEED_FILES_PATH,
        permission: 'settings.manage',
        description: 'Run individual database seed files',
        superAdminOnly: true,
        exact: true,
      },
    ],
  },
];

/** Strips the query string so route matching compares paths only. */
function pathOf(href: string): string {
  const index = href.indexOf('?');
  return index === -1 ? href : href.slice(0, index);
}

/**
 * True when `pathname` (plus its query) should light this item up.
 *
 * `exact` items also compare the query string, which is how two entries that
 * share a route — Reports vs Campaign Attribution — stay distinguishable.
 */
export function isItemActive(
  item: AdminNavItem | AdminNavModule,
  pathname: string,
  search = '',
): boolean {
  const href = item.href;
  if (!href) return false;

  const target = pathOf(href);
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';

  if (item.exact) {
    if (pathname !== target) return false;
    // An exact item with a query must match it; one without must have none.
    const current = new URLSearchParams(search);
    if (!query) return Array.from(current.keys()).length === 0;
    return Array.from(new URLSearchParams(query).entries()).every(
      ([key, value]) => current.get(key) === value,
    );
  }

  const matches = (candidate: string) =>
    pathname === candidate || pathname.startsWith(`${candidate}/`);

  if ('notMatches' in item && item.notMatches?.some((exclude) => matches(exclude))) return false;
  if (matches(target)) return true;
  return 'alsoMatches' in item ? Boolean(item.alsoMatches?.some(matches)) : false;
}

export type VisibleModule = AdminNavModule & { items: AdminNavItem[] };

/**
 * Filters the tree down to what this user may actually reach.
 *
 * `isSuperAdmin` is passed separately from `can` rather than inferred from it.
 * A super admin's `can` returns true for everything, so it cannot tell a super
 * admin apart from a role that simply holds the permission — and a
 * `superAdminOnly` entry has to make exactly that distinction.
 */
export function visibleModules(
  can: (permission: PermissionKey) => boolean,
  isSuperAdmin = false,
): Array<AdminNavModule & { items: AdminNavItem[] }> {
  const allowed = (permission: AdminNavItem['permission'] | undefined) => {
    if (!permission) return true;
    return Array.isArray(permission) ? permission.some(can) : can(permission);
  };

  return ADMIN_NAV.map((group) => ({
    ...group,
    items: (group.items ?? []).filter(
      (item) => (!item.superAdminOnly || isSuperAdmin) && allowed(item.permission),
    ),
  })).filter((group) => (group.href ? allowed(group.permission) : group.items.length > 0));
}

/** The group + item that own the current route, used for breadcrumbs. */
export function locateRoute(
  pathname: string,
  search = '',
): { group: AdminNavModule; item?: AdminNavItem } | null {
  for (const group of ADMIN_NAV) {
    if (group.href && isItemActive(group, pathname, search)) return { group };
    for (const item of group.items ?? []) {
      if (isItemActive(item, pathname, search)) return { group, item };
    }
  }
  // Fall back to a prefix match so detail routes still resolve to their group.
  for (const group of ADMIN_NAV) {
    for (const item of group.items ?? []) {
      if (pathname.startsWith(`${pathOf(item.href)}/`)) return { group, item };
    }
  }
  return null;
}
