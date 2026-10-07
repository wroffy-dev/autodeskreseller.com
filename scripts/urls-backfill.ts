/* eslint-disable no-console */
/**
 * The URL registry's scan, from the command line.
 *
 * Does exactly what "Scan" does in Admin → SEO → Slug & URL Manager: registers
 * every public address as the site serves it today, releases the routes of
 * content that no longer exists, links landing pages to their taxonomy,
 * imports redirect rules, and reports whatever it could not register. It
 * never moves an address, never changes content, and never switches the
 * registry on — that stays an administrator's decision in the admin.
 *
 * Idempotent: run it once or ten times and the registry ends up the same.
 *
 * Usage:
 *   npm run urls:backfill                 # scan and register
 *   npm run urls:backfill -- --dry-run    # report what a scan would do; write nothing
 *   npm run urls:backfill -- --json       # the full report as JSON
 *
 * Exit status: 0 when every address was registered, 2 when the scan reported
 * collisions or redirect issues to review, 1 on failure.
 */
import { prisma } from '@/lib/db/prisma';
import { runUrlScan } from '@/lib/urls/backfill';

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) {
    if (!['--dry-run', '--json', '--help', '-h'].includes(arg)) {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (args.has('--help') || args.has('-h')) {
    console.log('Usage: npm run urls:backfill [-- --dry-run] [-- --json]');
    return 0;
  }
  const dryRun = args.has('--dry-run');
  // No signed-in user: history records the scan as the system's.
  const report = await runUrlScan(null, { dryRun });

  if (args.has('--json')) {
    console.log(JSON.stringify({ dryRun, ...report }, null, 2));
  } else {
    console.log(dryRun ? '\nURL scan — dry run, nothing written\n' : '\nURL scan\n');
    console.log(`  Registry switched on:     ${report.resolverEnabled ? 'yes' : 'no'}`);
    console.log(`  Newly registered:         ${report.registered}`);
    console.log(`  Already registered:       ${report.alreadyRegistered}`);
    console.log(`  Released (content gone):  ${report.released}`);
    console.log(`  Landing pages linked:     ${report.landingPagesLinked}`);
    console.log(`  Pages grouped by market:  ${report.pagesGrouped}`);
    console.log(
      `  Redirects imported:       ${report.redirects.imported} (${report.redirects.claims} address(es), ${report.redirects.flattened} chain(s) straightened)`,
    );
    console.log(`  Content addresses total:  ${report.totals.routes}`);
    if (report.collisions.length > 0) {
      console.log(`\n  ${report.collisions.length} collision(s) — not registered, left exactly as they are:`);
      for (const collision of report.collisions) {
        console.log(`    ${collision.path}  [${collision.reason}] ${collision.label}: ${collision.detail}`);
      }
    }
    if (report.redirectIssues.length > 0) {
      console.log(`\n  ${report.redirectIssues.length} redirect issue(s):`);
      for (const issue of report.redirectIssues) console.log(`    ${issue.source}: ${issue.reason}`);
    }
    console.log(
      report.collisions.length + report.redirectIssues.length > 0
        ? '\nReview these under Conflicts in the Slug & URL Manager before switching the registry on.\n'
        : '\nNo collisions.\n',
    );
  }
  return report.collisions.length + report.redirectIssues.length > 0 ? 2 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
