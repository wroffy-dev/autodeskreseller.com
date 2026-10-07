import { checkBucket } from './score-state';
import type { CheckResult, SeoAuditResult } from './types';

/**
 * Results arranged for people.
 *
 * The editor panel and the audit page show checks as Issues, Warnings,
 * Suggestions and Passed. Within each group the checks that cost the most
 * points come first, so the top of every list is the most useful thing to fix.
 */

export type GroupedChecks = {
  critical: CheckResult[];
  warnings: CheckResult[];
  suggestions: CheckResult[];
  passed: CheckResult[];
  info: CheckResult[];
};

const lost = (check: CheckResult) => check.pointsAvailable - check.pointsEarned;

export function allChecks(result: Pick<SeoAuditResult, 'seo' | 'aeo' | 'geo'>): CheckResult[] {
  return [...result.seo.checks, ...result.aeo.checks, ...result.geo.checks];
}

export function groupChecks(checks: readonly CheckResult[]): GroupedChecks {
  const groups: GroupedChecks = { critical: [], warnings: [], suggestions: [], passed: [], info: [] };
  for (const check of checks) {
    const bucket = checkBucket(check);
    if (bucket === 'critical') groups.critical.push(check);
    else if (bucket === 'warning') groups.warnings.push(check);
    else if (bucket === 'suggestion') groups.suggestions.push(check);
    else if (bucket === 'passed') groups.passed.push(check);
    else if (bucket === 'info') groups.info.push(check);
  }
  const byImpact = (a: CheckResult, b: CheckResult) => lost(b) - lost(a) || a.label.localeCompare(b.label);
  groups.critical.sort(byImpact);
  groups.warnings.sort(byImpact);
  groups.suggestions.sort(byImpact);
  return groups;
}

/** The few fixes that would move the score most, for a summary line. */
export function topIssues(checks: readonly CheckResult[], limit = 3): CheckResult[] {
  const grouped = groupChecks(checks);
  return [...grouped.critical, ...grouped.warnings, ...grouped.suggestions].slice(0, limit);
}

/**
 * The compact form a cached audit keeps: every check that did not pass, with
 * its points, message and fix. Passes are left out — they are what the
 * dashboard needs least and they are always recalculated for the full view.
 */
export type StoredCheck = Pick<
  CheckResult,
  'id' | 'dimension' | 'category' | 'label' | 'status' | 'severity' | 'pointsEarned' | 'pointsAvailable' | 'message' | 'recommendation'
>;

export function storedIssues(result: SeoAuditResult): StoredCheck[] {
  return allChecks(result)
    .filter((check) => check.status === 'FAIL' || check.status === 'WARNING' || check.status === 'INFO')
    .map((check) => ({
      id: check.id,
      dimension: check.dimension,
      category: check.category,
      label: check.label,
      status: check.status,
      severity: check.severity,
      pointsEarned: check.pointsEarned,
      pointsAvailable: check.pointsAvailable,
      message: check.message,
      recommendation: check.recommendation,
    }));
}
