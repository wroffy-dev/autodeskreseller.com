import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';

/**
 * Invalidating what an address change touches.
 *
 * Public pages are rendered per request, so the registry's own version bump is
 * what makes a change live everywhere; this clears the router caches and the
 * sitemaps for the addresses involved — the old one and the new one — so a
 * browser holding a cached copy of either is not left behind.
 */
export function revalidateAddresses(paths: Iterable<string | null | undefined>): void {
  const unique = new Set<string>();
  for (const path of paths) if (path) unique.add(path);
  for (const path of unique) {
    try {
      revalidatePath(path);
    } catch {
      // Outside a request (a script, a test) there is no cache to clear.
    }
  }
  try {
    revalidatePath('/sitemap.xml');
  } catch {
    // As above.
  }
}

/** Every current address of one piece of content, in every market. */
export async function addressesOf(entityId: string): Promise<string[]> {
  const routes = await prisma.urlRoute.findMany({
    where: { entityId, kind: 'CONTENT' },
    select: { path: true },
  });
  return routes.map((route) => route.path);
}
