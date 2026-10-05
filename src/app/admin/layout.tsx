import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { getCurrentUser, requireUser } from '@/lib/auth/guards';
import { getWebsiteSettings } from '@/lib/services/settings';
import { getAdminCountryScope } from '@/lib/country/admin';
import { AdminShell } from '@/components/admin/admin-shell';
import { ADMIN_THEME_SCRIPT } from '@/lib/admin/theme';
// Every rule in here is scoped under `.admin-ui`, so it cannot reach the public site.
import './admin-ui.css';
import './admin-dark.generated.css';

/**
 * Titles for the admin — but only for somebody who is actually in it.
 *
 * A layout's metadata is still resolved when the layout itself calls
 * `notFound()`, so a static export here would title the 404 that an anonymous
 * visitor gets "Admin" and tell them precisely what that 404 exists not to
 * say. Returning nothing leaves the site's own defaults, which is what every
 * other missing page shows.
 *
 * `getCurrentUser()` is request-cached, so this shares the lookup the layout
 * below makes rather than adding one.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!(await getCurrentUser())) return {};
  return {
    title: { default: 'Admin', template: '%s · Admin' },
    robots: { index: false, follow: false },
  };
}

/**
 * Every /admin route is authenticated here as well as in middleware.
 * Middleware alone is not an authorisation boundary — each page and Server
 * Action re-checks the specific permission it needs.
 *
 * `requireUser()` also enforces two-factor authentication: a session that has
 * passed the password check but not the second factor is redirected to
 * enrolment or verification and never renders this layout at all.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [site, role, account, scope] = await Promise.all([
    getWebsiteSettings(),
    user.role
      ? prisma.userRole.findUnique({ where: { slug: user.role }, select: { name: true } })
      : null,
    prisma.user.findUnique({ where: { id: user.id }, select: { image: true } }),
    // Resolved here so the selector renders from a server value and there is
    // nothing for hydration to correct.
    getAdminCountryScope(),
  ]);

  return (
    <>
      {/* Applies the stored Light / Dark / System choice before the shell
          paints, so a dark admin never flashes light on reload. */}
      <script dangerouslySetInnerHTML={{ __html: ADMIN_THEME_SCRIPT }} />
      <AdminShell
        user={{
          name: user.name,
          email: user.email,
          roleName: role?.name ?? 'Staff',
          permissions: user.permissions,
          isSuperAdmin: user.role === 'super-admin',
          image: account?.image ?? null,
        }}
        branding={{
          siteName: site.siteName,
          logoUrl: site.logoUrl,
          // Shown instead of the regular logo while the admin is in dark mode.
          logoDarkUrl: site.logoDarkUrl,
        }}
        country={{ id: scope.country.id, code: scope.country.code, name: scope.country.name }}
        countries={scope.countries.map((country) => ({
          id: country.id,
          code: country.code,
          name: country.name,
          isDefault: country.isDefault,
        }))}
      >
        {children}
      </AdminShell>
    </>
  );
}
