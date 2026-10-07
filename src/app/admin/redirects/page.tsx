import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/**
 * Redirects now live in the Slug & URL Manager, next to the addresses they
 * redirect to. This address is kept so bookmarks and old links still land on
 * them.
 */
export default async function RedirectsAdmin() {
  await requirePermission('seo.manage');
  redirect('/admin/slug-manager?tab=redirects');
}
