import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ExternalLink, Pencil } from 'lucide-react';
import { AuthorizationError, requireUser, userCan } from '@/lib/auth/guards';
import { prisma } from '@/lib/db/prisma';
import { listAccessibleCountries } from '@/lib/country/access';
import { scopeForUser } from '@/lib/country/admin';
import { AdminPageHeader } from '@/components/admin/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table';
import { CheckItem } from '@/components/admin/seo/check-item';
import { ScoreRing } from '@/components/admin/seo/score-display';
import { RecalculateButton } from '@/components/admin/seo/recalculate-controls';
import { AuditNotFoundError, resolveAuditRef } from '@/lib/seo/intelligence/access';
import { recalculateEntities } from '@/lib/seo/intelligence/cache';
import { analyzeDocument, linkScope } from '@/lib/seo/analysis';
import { allChecks, groupChecks, topIssues } from '@/lib/seo/recommendations';
import {
  KEYWORD_STATUS_LABELS,
  PAGE_KIND_LABELS,
  SEO_DISCLAIMER,
  auditHref,
  checkBucket,
  entityTypeFromSlug,
} from '@/lib/seo/score-state';
import {
  CHECK_CATEGORY_LABELS,
  KEYWORD_PLACEMENT_LABELS,
  type CheckCategory,
  type CheckResult,
  type ContentImage,
  type ContentLink,
  type KeywordPlacement,
  type SeoDocument,
} from '@/lib/seo/types';
import { formatBytes, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = { title: 'SEO analysis' };
export const dynamic = 'force-dynamic';

/**
 * The full audit of one URL.
 *
 * Calculated from the saved content when the page is opened, and stored, so
 * the dashboard row it came from is brought up to date too. Every check is
 * listed — passed, failed and not applicable — with what was found and how to
 * fix it, grouped the way an editor thinks about a page.
 */

const SEO_SECTIONS: Array<{ id: string; title: string; categories: CheckCategory[] }> = [
  { id: 'metadata', title: 'Metadata', categories: ['metadata'] },
  { id: 'keywords', title: 'Primary keywords', categories: ['keywords'] },
  { id: 'content', title: 'Content', categories: ['content', 'readability'] },
  { id: 'url', title: 'URL', categories: ['url'] },
  { id: 'links', title: 'Links', categories: ['links'] },
  { id: 'images', title: 'Images', categories: ['images'] },
  { id: 'social', title: 'Social sharing', categories: ['social'] },
  { id: 'structured-data', title: 'Structured data', categories: ['structuredData'] },
  { id: 'technical', title: 'Technical SEO', categories: ['technical'] },
  { id: 'indexability', title: 'Indexability', categories: ['indexability'] },
];

const BUCKET_ORDER = { critical: 0, warning: 1, suggestion: 2, info: 3, passed: 4, na: 5 } as const;

function byUrgency(a: CheckResult, b: CheckResult): number {
  return (
    BUCKET_ORDER[checkBucket(a)] - BUCKET_ORDER[checkBucket(b)] ||
    b.pointsAvailable - b.pointsEarned - (a.pointsAvailable - a.pointsEarned) ||
    a.label.localeCompare(b.label)
  );
}

const PLACEMENTS: KeywordPlacement[] = [
  'title',
  'description',
  'url',
  'h1',
  'firstParagraph',
  'headings',
  'body',
  'imageAlt',
];

export default async function SeoAudit({
  params,
  searchParams,
}: {
  params: Promise<{ type: string; id: string }>;
  searchParams: Promise<{ market?: string }>;
}) {
  const user = await requireUser();
  const { type: typeSlug, id } = await params;
  const { market } = await searchParams;
  const type = entityTypeFromSlug(typeSlug);
  if (!type) notFound();

  // A product is a page per market; without one named, the market being
  // worked in.
  const countryId =
    type === 'PRODUCT_MARKET' ? market || (await scopeForUser(user)).country.id : undefined;

  let ref;
  try {
    ref = await resolveAuditRef(user, { type, id: decodeURIComponent(id), countryId });
  } catch (error) {
    if (error instanceof AuditNotFoundError) notFound();
    if (error instanceof AuthorizationError) redirect('/admin?denied=seo');
    throw error;
  }

  // Opening the analysis is a rescan: the URL is audited now and the cached
  // row brought up to date, so what is shown is never stale.
  const [audited] = await recalculateEntities([ref]);
  if (!audited) notFound();
  const { doc, result } = audited;
  const stored = await prisma.seoAudit.findFirst({
    where: { entityType: type, entityId: ref.id, countryId: doc.country.id },
    select: { calculatedAt: true, contentFingerprint: true, engineVersion: true },
  });
  const analysis = analyzeDocument(doc);
  const checks = allChecks(result);
  const grouped = groupChecks(checks);
  const canSeeDashboard = userCan(user, 'seo.manage');

  // The same product in the other markets this user can see: each is its
  // own page with its own audit, never merged.
  const otherMarkets =
    type === 'PRODUCT_MARKET'
      ? await (async () => {
          const accessible = await listAccessibleCountries(user, { includeInactive: true });
          const rows = await prisma.productCountry.findMany({
            where: {
              productId: ref.id,
              deletedAt: null,
              countryId: { in: accessible.map((country) => country.id) },
            },
            select: { countryId: true, country: { select: { name: true } } },
            orderBy: { country: { name: 'asc' } },
          });
          return rows.map((row) => ({ id: row.countryId, name: row.country.name }));
        })()
      : [];

  const status = doc.status.live
    ? 'Live'
    : doc.status.notServedReason
      ? 'Not served'
      : doc.status.value === 'SCHEDULED'
        ? 'Scheduled'
        : doc.status.value === 'ARCHIVED'
          ? 'Archived'
          : 'Draft';

  const nav = [
    { id: 'summary', label: 'Summary' },
    { id: 'keyword-placement', label: 'Keyword placement' },
    ...SEO_SECTIONS.map((section) => ({ id: section.id, label: section.title })),
    { id: 'aeo', label: 'AEO' },
    { id: 'geo', label: 'GEO' },
    { id: 'schema-analysis', label: 'Schema' },
    { id: 'outline', label: 'Outline' },
    { id: 'image-list', label: 'Image list' },
    { id: 'link-list', label: 'Link list' },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title={doc.name}
        description={`${PAGE_KIND_LABELS[doc.kind]} · ${doc.country.name} · ${doc.path}`}
        crumbs={[
          ...(canSeeDashboard ? [{ label: 'SEO Intelligence', href: '/admin/seo-intelligence' }] : []),
          { label: doc.name },
        ]}
        actions={
          <>
            <RecalculateButton entity={{ type: ref.type, id: ref.id, countryId: ref.countryId }} />
            <Link href={doc.editPath} className={buttonClasses('outline', 'sm')}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Link>
            {doc.status.live ? (
              <a
                href={doc.path}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('ghost', 'sm')}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                View live
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
          </>
        }
      />

      {otherMarkets.length > 1 ? (
        <nav aria-label="Markets" className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">This product in:</span>
          {otherMarkets.map((entry) => (
            <Link
              key={entry.id}
              href={auditHref({ type: 'PRODUCT_MARKET', id: ref.id, countryId: entry.id })}
              aria-current={entry.id === ref.countryId ? 'page' : undefined}
              className={cn(
                'rounded-full border px-2.5 py-1 transition-colors',
                entry.id === ref.countryId
                  ? 'border-brand bg-brand/10 font-medium text-brand'
                  : 'border-hairline text-content hover:border-brand/40',
              )}
            >
              {entry.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <nav aria-label="Sections of this analysis" className="scroll-x mb-5 flex gap-1.5 pb-1 text-xs">
        {nav.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="shrink-0 rounded-full bg-muted/[0.07] px-2.5 py-1 text-muted transition-colors hover:bg-muted/15 hover:text-content"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        {/* Summary */}
        <Card id="summary" className="scroll-mt-24 p-4 sm:p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="grid shrink-0 grid-cols-2 gap-4 sm:grid-cols-4">
              <ScoreRing score={result.overall} label="Overall" size="lg" />
              <ScoreRing score={result.seo.score} label="SEO" />
              <ScoreRing score={result.aeo.score} label="AEO" />
              <ScoreRing score={result.geo.score} label="GEO" />
            </div>
            <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Fact label="URL">
                <span className="break-all font-mono text-xs">{doc.absoluteUrl}</span>
              </Fact>
              <Fact label="Type">{PAGE_KIND_LABELS[doc.kind]}</Fact>
              <Fact label="Country">{doc.country.name}</Fact>
              <Fact label="Status">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <Badge tone={doc.status.live ? 'success' : 'neutral'}>{status}</Badge>
                  {doc.robots.noIndex ? <Badge tone="purple">Noindex</Badge> : null}
                </span>
              </Fact>
              <Fact label="Content updated">{formatDate(doc.updatedAt, true)}</Fact>
              <Fact label="Audited">
                {formatDate(stored?.calculatedAt ?? new Date(), true)}
                <span className="block text-[0.6875rem] text-muted">
                  Content version {(stored?.contentFingerprint || '—').slice(0, 10)} · engine {stored?.engineVersion ?? result.engineVersion}
                </span>
              </Fact>
              <Fact label="Checks">
                <span className="text-red-700">{result.counts.critical} critical</span> ·{' '}
                <span className="text-amber-700">
                  {result.counts.warnings} {result.counts.warnings === 1 ? 'warning' : 'warnings'}
                </span>{' '}
                · {result.counts.suggestions} {result.counts.suggestions === 1 ? 'suggestion' : 'suggestions'} ·{' '}
                {result.counts.passed} passed
              </Fact>
            </dl>
          </div>
          {doc.status.notServedReason ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{doc.status.notServedReason}</p>
          ) : null}
          {doc.robots.noIndex ? (
            <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
              This URL is noindex on purpose. It is scored for reference only: noindex is never counted
              against it, and it does not count towards the site score.
            </p>
          ) : null}
          <p className="mt-4 text-[0.6875rem] leading-relaxed text-muted">
            {SEO_DISCLAIMER} Engine {result.engineVersion}. Overall is SEO 50%, AEO 25% and GEO 25%.
          </p>
        </Card>

        {/* Top fixes */}
        {grouped.critical.length + grouped.warnings.length + grouped.suggestions.length > 0 ? (
          <Section id="fixes" title="What to fix first" description="The changes that would raise the score most.">
            <ul className="space-y-2">
              {topIssues(checks, 5).map((check) => (
                <CheckItem key={check.id} check={check} />
              ))}
            </ul>
          </Section>
        ) : null}

        {/* Keyword placement */}
        <Section
          id="keyword-placement"
          title="Primary keyword placement"
          description={
            doc.meta.keywordsSource === 'shared'
              ? 'This market has no keywords of its own, so the product’s shared keywords are checked.'
              : 'Where each primary keyword appears on the page.'
          }
        >
          {result.keywords.length === 0 ? (
            <p className="text-sm text-muted">
              No primary keywords are set. Add up to three in the editor&rsquo;s SEO settings and each is
              checked in the title, description, URL, headings, copy and image text.
            </p>
          ) : (
            <TableWrap className="relative">
              <Table className="min-w-[48rem]">
                <caption className="sr-only">Where each primary keyword appears</caption>
                <thead>
                  <tr>
                    <Th>Keyword</Th>
                    {PLACEMENTS.map((placement) => (
                      <Th key={placement} align="center" className="normal-case tracking-normal">
                        {KEYWORD_PLACEMENT_LABELS[placement]}
                      </Th>
                    ))}
                    <Th align="center">Uses</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.keywords.map((keyword) => (
                    <Tr key={keyword.position}>
                      <Td className="font-medium">{keyword.keyword}</Td>
                      {PLACEMENTS.map((placement) => (
                        <Td key={placement} align="center">
                          <Placement value={keyword.placements[placement]} />
                        </Td>
                      ))}
                      <Td align="center" className="whitespace-nowrap text-xs text-muted">
                        {keyword.occurrences} ({keyword.density}%)
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            keyword.status === 'strong' || keyword.status === 'good'
                              ? 'success'
                              : keyword.status === 'weak'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {KEYWORD_STATUS_LABELS[keyword.status]}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Section>

        {/* SEO checks, by part of the page */}
        {SEO_SECTIONS.map((section) => {
          const list = result.seo.checks
            .filter((check) => section.categories.includes(check.category))
            .sort(byUrgency);
          if (list.length === 0) return null;
          return (
            <ChecksSection
              key={section.id}
              id={section.id}
              title={section.title}
              checks={list}
              extra={
                section.id === 'metadata' ? (
                  <MetadataFacts doc={doc} />
                ) : section.id === 'social' ? (
                  <SocialFacts doc={doc} />
                ) : section.id === 'indexability' ? (
                  <IndexFacts doc={doc} />
                ) : null
              }
            />
          );
        })}
        {otherSeoChecks(result.seo.checks).length > 0 ? (
          <ChecksSection id="other" title="Other SEO checks" checks={otherSeoChecks(result.seo.checks)} />
        ) : null}

        <ChecksSection
          id="aeo"
          title="AEO — answer-engine readiness"
          description="An internal content-readiness assessment: whether the page answers questions directly, in a form an answer engine could quote. It does not measure real citations or visibility."
          score={result.aeo.score}
          checks={[...result.aeo.checks].sort(byUrgency)}
          grouped
        />
        <ChecksSection
          id="geo"
          title="GEO — generative-engine readiness"
          description="An internal content-readiness assessment: whether an AI assistant could tell who says this, what it is about and where the facts come from. It does not measure real AI citations or visibility."
          score={result.geo.score}
          checks={[...result.geo.checks].sort(byUrgency)}
          grouped
        />

        {/* Structured data */}
        <Section
          id="schema-analysis"
          title="Structured data analysis"
          description={
            result.structuredData.types.length > 0
              ? `Emitted: ${result.structuredData.types.join(', ')}.`
              : 'This page emits no structured data.'
          }
        >
          {result.structuredData.items.length > 0 ? (
            <TableWrap className="relative">
              <Table>
                <caption className="sr-only">Schema types this page emits or should emit</caption>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Present</Th>
                    <Th>Expected here</Th>
                    <Th>Missing properties</Th>
                    <Th>Worth adding</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.structuredData.items.map((item) => (
                    <Tr key={item.type}>
                      <Td className="font-medium">{item.type}</Td>
                      <Td>
                        <Badge tone={item.present ? 'success' : item.expected ? 'danger' : 'neutral'}>
                          {item.present ? 'Yes' : 'No'}
                        </Badge>
                      </Td>
                      <Td className="text-sm">{item.expected ? 'Yes' : 'Optional'}</Td>
                      <Td className="text-xs text-muted">{item.missing.length > 0 ? item.missing.join(', ') : '—'}</Td>
                      <Td className="text-xs text-muted">
                        {item.recommended.length > 0 ? item.recommended.join(', ') : '—'}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : null}
          {doc.schema.length > 0 ? (
            <details className="mt-3 rounded-lg border border-hairline">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-content">
                View the JSON-LD this page emits ({doc.schema.length})
              </summary>
              <pre className="max-h-96 overflow-auto border-t border-hairline bg-muted/[0.04] p-3 text-xs leading-relaxed">
                {JSON.stringify(doc.schema, null, 2)}
              </pre>
            </details>
          ) : null}
        </Section>

        {/* Outline */}
        <Section
          id="outline"
          title="Content outline"
          description={`${analysis.wordCount} words · ${analysis.headings.length} headings · ${analysis.paragraphs.length} paragraphs · ${analysis.lists} lists · ${analysis.tables} tables · ${analysis.faqs.length} FAQs`}
        >
          {analysis.headings.length === 0 ? (
            <p className="text-sm text-muted">No headings.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {analysis.headings.map((heading, index) => (
                <li
                  key={`${heading.level}-${index}`}
                  className="flex items-baseline gap-2"
                  style={{ paddingLeft: `${(heading.level - 1) * 0.875}rem` }}
                >
                  <span className="shrink-0 rounded bg-muted/10 px-1 font-mono text-[0.625rem] text-muted">
                    H{heading.level}
                  </span>
                  <span className="min-w-0 break-words text-content">{heading.text || '(empty)'}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <ImagesSection doc={doc} />
        <LinksSection doc={doc} />

        {doc.collisions.title.length +
          doc.collisions.description.length +
          doc.collisions.keyword.length +
          doc.collisions.content.length >
        0 ? (
          <Section
            id="duplicates"
            title={`Overlap with other pages in ${doc.country.name}`}
            description="Other live URLs in the same market that share this page’s title, description, first keyword or copy. Other markets are never compared."
          >
            <ul className="space-y-1.5 text-sm">
              {doc.collisions.title.map((entry) => (
                <Overlap key={`t-${entry.path}`} what="Same title" name={entry.name} path={entry.path} />
              ))}
              {doc.collisions.description.map((entry) => (
                <Overlap key={`d-${entry.path}`} what="Same description" name={entry.name} path={entry.path} />
              ))}
              {doc.collisions.keyword.map((entry) => (
                <Overlap
                  key={`k-${entry.path}`}
                  what={`Same first keyword “${entry.keyword}”`}
                  name={entry.name}
                  path={entry.path}
                />
              ))}
              {doc.collisions.content.map((entry) => (
                <Overlap key={`c-${entry.path}`} what="Near-identical copy" name={entry.name} path={entry.path} />
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function otherSeoChecks(checks: CheckResult[]): CheckResult[] {
  const known = new Set(SEO_SECTIONS.flatMap((section) => section.categories));
  return checks.filter((check) => !known.has(check.category)).sort(byUrgency);
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-24">
      <div className="border-b border-hairline px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-content">{title}</h2>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p> : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

function ChecksSection({
  id,
  title,
  description,
  checks,
  score,
  extra,
  grouped = false,
}: {
  id: string;
  title: string;
  description?: string;
  checks: CheckResult[];
  score?: number;
  extra?: React.ReactNode;
  /** Label each check with its category, for sections that span several. */
  grouped?: boolean;
}) {
  const scored = checks.filter((check) => check.pointsAvailable > 0);
  const earned = scored.reduce((sum, check) => sum + check.pointsEarned, 0);
  const available = scored.reduce((sum, check) => sum + check.pointsAvailable, 0);
  const passed = checks.filter((check) => check.status === 'PASS').length;
  const applicable = checks.filter((check) => check.status !== 'NOT_APPLICABLE').length;
  return (
    <Section
      id={id}
      title={title}
      description={[
        description,
        applicable === 0
          ? 'None of these checks apply to this page.'
          : `${passed} of ${applicable} ${applicable === 1 ? 'check' : 'checks'} passed` +
            (available > 0 ? ` · ${Math.round(earned * 10) / 10} of ${available} points` : '') +
            (score !== undefined ? ` · score ${score}` : ''),
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {extra ? <div className="mb-4">{extra}</div> : null}
      <ul className="space-y-2">
        {checks.map((check) => (
          <CheckItem
            key={check.id}
            check={check}
            showDimension={false}
            className={cn(check.status === 'NOT_APPLICABLE' && 'opacity-70')}
            action={
              grouped ? (
                <span className="text-[0.6875rem] text-muted">{CHECK_CATEGORY_LABELS[check.category]}</span>
              ) : undefined
            }
          />
        ))}
      </ul>
    </Section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="min-w-0 text-content">{children}</dd>
    </div>
  );
}

function Placement({ value }: { value: boolean | null }) {
  if (value === null) {
    return (
      <span className="text-muted" title="Not applicable">
        —<span className="sr-only">Not applicable</span>
      </span>
    );
  }
  return value ? (
    <span className="font-semibold text-emerald-700">
      ✓<span className="sr-only">Present</span>
    </span>
  ) : (
    <span className="text-red-600">
      ✗<span className="sr-only">Missing</span>
    </span>
  );
}

function SourceNote({ source }: { source: 'seo' | 'fallback' | 'default' }) {
  const text =
    source === 'seo' ? 'Set in SEO settings' : source === 'fallback' ? 'Falls back to the content' : 'Site default';
  return <span className="text-[0.6875rem] text-muted"> · {text}</span>;
}

function MetadataFacts({ doc }: { doc: SeoDocument }) {
  return (
    <dl className="grid gap-3 rounded-lg bg-muted/[0.04] p-3 text-sm sm:grid-cols-2">
      <Fact label={`Title as served (${doc.meta.title.length} characters)`}>
        <span className="break-words">{doc.meta.title || '—'}</span>
        <SourceNote source={doc.meta.titleSource} />
      </Fact>
      <Fact label={`Meta description (${doc.meta.description.length} characters)`}>
        <span className="break-words">{doc.meta.description || '—'}</span>
        <SourceNote source={doc.meta.descriptionSource} />
      </Fact>
      <Fact label="Canonical">
        <span className="break-all font-mono text-xs">{doc.meta.canonical.effective}</span>
        {doc.meta.canonical.explicit ? <span className="text-[0.6875rem] text-muted"> · set by an editor</span> : null}
      </Fact>
      <Fact label="Target keywords (analysis input)">
        {doc.meta.keywords.length > 0 ? doc.meta.keywords.join(', ') : '—'}
        <span className="block text-[0.6875rem] text-muted">Used to analyse the page; never output as markup.</span>
      </Fact>
    </dl>
  );
}

function SocialFacts({ doc }: { doc: SeoDocument }) {
  return (
    <dl className="grid gap-3 rounded-lg bg-muted/[0.04] p-3 text-sm sm:grid-cols-2">
      <Fact label="Open Graph title">
        {doc.social.ogTitle || '—'}
        <span className="text-[0.6875rem] text-muted">{doc.social.ogTitleExplicit ? ' · set' : ' · from the SEO title'}</span>
      </Fact>
      <Fact label="Open Graph description">
        {doc.social.ogDescription || '—'}
        <span className="text-[0.6875rem] text-muted">
          {doc.social.ogDescriptionExplicit ? ' · set' : ' · from the meta description'}
        </span>
      </Fact>
      <Fact label="Share image">
        {doc.social.ogImage ? (
          <span className="break-all font-mono text-xs">{doc.social.ogImage.url}</span>
        ) : (
          'None'
        )}
      </Fact>
      <Fact label="X card">
        {doc.social.twitterCard === 'summary_large_image' ? 'Large image' : 'Summary'}
        {doc.social.twitterSite ? ` · ${doc.social.twitterSite}` : ''}
      </Fact>
    </dl>
  );
}

function IndexFacts({ doc }: { doc: SeoDocument }) {
  const reasons: Record<string, string> = {
    entity: 'this page',
    shared: 'the shared product',
    market: 'the market',
    site: 'the whole site',
    blog: 'the blog',
  };
  return (
    <dl className="grid gap-3 rounded-lg bg-muted/[0.04] p-3 text-sm sm:grid-cols-2">
      <Fact label="Robots meta">
        {doc.robots.noIndex ? 'noindex' : 'index'}, {doc.robots.noFollow ? 'nofollow' : 'follow'}
        {doc.robots.noIndexReasons.length > 0 ? (
          <span className="block text-[0.6875rem] text-muted">
            Set by {doc.robots.noIndexReasons.map((reason) => reasons[reason] ?? reason).join(', ')}
          </span>
        ) : null}
      </Fact>
      <Fact label="Sitemap">
        {doc.robots.inSitemap ? 'Listed' : 'Not listed'}
        {doc.robots.sitemapExclusion ? (
          <span className="block text-[0.6875rem] text-muted">{doc.robots.sitemapExclusion}</span>
        ) : null}
      </Fact>
      <Fact label="robots.txt">
        {doc.robots.blockedByRobots ? (
          <span className="text-red-700">Blocked by “{doc.robots.blockingRule}”</span>
        ) : (
          'Allowed'
        )}
      </Fact>
      <Fact label="Language versions (hreflang)">
        {doc.alternates.locales.length > 0 ? doc.alternates.locales.join(', ') : 'None'}
      </Fact>
    </dl>
  );
}

function ImagesSection({ doc }: { doc: SeoDocument }) {
  const images = doc.content.filter((node): node is ContentImage => node.type === 'image');
  return (
    <Section
      id="image-list"
      title="Images on the page"
      description={
        images.length === 0
          ? 'No images.'
          : `${images.length} ${images.length === 1 ? 'image' : 'images'}, ${images.filter((image) => image.decorative).length} marked decorative.`
      }
    >
      {images.length === 0 ? null : (
        <TableWrap className="relative">
          <Table>
            <caption className="sr-only">Images on the page and their alt text</caption>
            <thead>
              <tr>
                <Th>Image</Th>
                <Th>Alt text</Th>
                <Th>Size</Th>
                <Th>Where</Th>
              </tr>
            </thead>
            <tbody>
              {images.map((image, index) => (
                <Tr key={`${image.src}-${index}`}>
                  <Td className="max-w-[14rem]">
                    <span className="block truncate font-mono text-xs" title={image.src ?? ''}>
                      {image.src ? image.src.split('/').pop() : '(no file)'}
                    </span>
                  </Td>
                  <Td className="text-sm">
                    {image.decorative ? (
                      <span className="text-muted">Decorative (hidden from screen readers)</span>
                    ) : image.alt ? (
                      image.alt
                    ) : (
                      <span className="font-medium text-red-700">Missing</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {[image.width && image.height ? `${image.width}×${image.height}` : null, image.bytes ? formatBytes(image.bytes) : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </Td>
                  <Td className="text-xs text-muted">{image.source ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Section>
  );
}

function LinksSection({ doc }: { doc: SeoDocument }) {
  const origin = new URL(doc.absoluteUrl).origin;
  const links = doc.content.filter((node): node is ContentLink => node.type === 'link');
  const internal = links.filter((link) => linkScope(link.href, origin) === 'internal');
  const external = links.filter((link) => linkScope(link.href, origin) === 'external');
  const collections = doc.content.filter((node) => node.type === 'collection');
  return (
    <Section
      id="link-list"
      title="Links on the page"
      description={`${internal.length} internal · ${external.length} external${collections.length > 0 ? ` · ${collections.length} product or article card ${collections.length === 1 ? 'block' : 'blocks'}` : ''}`}
    >
      {links.length === 0 ? (
        <p className="text-sm text-muted">No links in the page content.</p>
      ) : (
        <details className="rounded-lg border border-hairline">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-content">
            Show all {links.length} links
          </summary>
          <ul className="divide-y divide-hairline border-t border-hairline text-sm">
            {links.map((link, index) => (
              <li key={`${link.href}-${index}`} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="min-w-0 break-words text-content sm:w-2/5">{link.text || <em className="text-red-700">empty link text</em>}</span>
                <span className="min-w-0 break-all font-mono text-xs text-muted sm:flex-1">{link.href}</span>
                <Badge tone={linkScope(link.href, origin) === 'external' ? 'info' : 'neutral'} className="self-start">
                  {linkScope(link.href, origin)}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function Overlap({ what, name, path }: { what: string; name: string; path: string }) {
  return (
    <li className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="shrink-0 text-xs font-medium text-amber-800">{what}</span>
      <span className="min-w-0 break-words text-content">{name}</span>
      <code className="min-w-0 break-all text-xs text-muted">{path}</code>
    </li>
  );
}
