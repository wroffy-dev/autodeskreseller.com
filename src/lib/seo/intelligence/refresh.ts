import 'server-only';
import { after } from 'next/server';
import type { EntityRef } from './audit';
import { recalculateEntities } from './cache';
import { loadSeoContext } from './context';

/** A URL to refresh. The blog's archives may leave out the market: they live at the root. */
export type RefreshRef = Omit<EntityRef, 'countryId'> & { countryId?: string };

/**
 * Brings the cached scores of URLs an editor just saved up to date.
 *
 * Runs after the response has been sent, so saving is never slower for it,
 * and a failure here never fails the save: the dashboard's staleness check
 * lists anything this missed as outdated.
 */
export function refreshSeoScores(
  refs: readonly RefreshRef[] | (() => Promise<readonly RefreshRef[]>),
): void {
  try {
    after(async () => {
      try {
        const list = typeof refs === 'function' ? await refs() : refs;
        if (list.length === 0) return;
        const root = list.some((ref) => !ref.countryId) ? (await loadSeoContext()).root.id : '';
        await recalculateEntities(list.map((ref) => ({ ...ref, countryId: ref.countryId ?? root })));
      } catch (error) {
        console.error('[seo-intelligence] could not refresh scores after a save', error);
      }
    });
  } catch {
    // Outside a request — a script or a test calling the action directly.
  }
}
