/**
 * Cities
 *
 * The initial cities — Delhi and Gurugram (/delhi, /gurugram) and Dubai in the
 * UAE (/ae/dubai) — each with an empty-but-honest draft landing page. Drafts
 * only: nothing becomes public until an editor publishes it. Existing cities
 * and pages are never changed.
 *
 * One runnable seed step, after `countries` and `pages`. Run it on its own
 * with `npx tsx prisma/seed/pages-cities.ts`, or tick it on the Seed files
 * screen in the admin. Run a URL scan afterwards so the registry knows the
 * new pages.
 */
import { prisma, seedCities } from '../seed';
import { runSeedStep } from './_shared';

runSeedStep('pages-cities', seedCities, prisma);
