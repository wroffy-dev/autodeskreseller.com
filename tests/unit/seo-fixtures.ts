import type { ContentNode, JsonLd, SeoCountryRef, SeoDocument } from '@/lib/seo/types';

/**
 * Documents for the SEO Intelligence tests.
 *
 * `perfectPage()` is a page that does everything the engine looks for — the
 * fixture the other scenarios take something away from — so each test states
 * only the one thing it changes.
 */

export const ROOT_MARKET: SeoCountryRef = {
  id: 'country_in',
  code: 'IN',
  name: 'India',
  slug: '',
  locale: 'en-IN',
  currency: 'INR',
  isDefault: true,
  isActive: true,
  isPublished: true,
};

export const SECOND_MARKET: SeoCountryRef = {
  id: 'country_ae',
  code: 'AE',
  name: 'United Arab Emirates',
  slug: 'ae',
  locale: 'en-AE',
  currency: 'AED',
  isDefault: false,
  isActive: true,
  isPublished: true,
};

const ORIGIN = 'https://www.example.com';

const answer = (text: string): ContentNode => ({ type: 'paragraph', text });

/** Roughly 60 words of plain, specific copy about the topic. */
const PARAGRAPHS = [
  'AutoCAD LT is a cloud storage and file sharing service for companies. Teams on the Standard plan share 5 TB of storage. They recover deleted files for 180 days. Every account is managed from one admin console, so teams of 3 to 300 people choose it over personal accounts.',
  'A AutoCAD migration moves a team’s files, folders and sharing into one company account. Our team has run more than 400 of them since 2016. A typical move of 50 users and 2 TB takes five working days. It includes a pilot with one department and a delta sync on the final weekend.',
  'Pricing is billed per user in Indian rupees with a GST invoice. Annual billing costs less than monthly billing. The minimum team size is three users. Licences can be added at any time and are prorated to the renewal date, so growing teams never pay twice for a seat.',
  'Security features include two-step verification, remote wipe for lost devices and granular sharing permissions. An audit log records every file event. Administrators can require device approval before a laptop syncs company files. That keeps data inside the organisation when staff leave.',
  'Support comes from certified AutoCAD specialists in Bengaluru, by phone and email, on Indian business hours. Every AutoCAD migration ends with a short training session for team leads. Admins also get a written handover covering sharing rules, device approval and the recovery settings chosen for their team.',
];

export function perfectPage(overrides: Partial<SeoDocument> = {}): SeoDocument {
  const path = '/autocad-lt';
  const url = `${ORIGIN}${path}`;
  const content: ContentNode[] = [
    { type: 'heading', level: 1, text: 'AutoCAD LT for teams in India' },
    answer(PARAGRAPHS[0]!),
    {
      type: 'image',
      src: '/uploads/autocad-lt-admin-console.webp',
      alt: 'AutoCAD LT admin console showing team storage use',
      decorative: false,
      width: 1200,
      height: 675,
      bytes: 84_000,
      mimeType: 'image/webp',
    },
    { type: 'heading', level: 2, text: 'What does AutoCAD LT cost?' },
    answer(PARAGRAPHS[2]!),
    {
      type: 'table',
      caption: 'AutoCAD LT plans',
      rows: [
        ['Plan', 'Storage', 'Price per user'],
        ['Standard', '5 TB', '₹1,250 a month'],
        ['Advanced', '15 TB', '₹2,000 a month'],
      ],
    },
    { type: 'heading', level: 2, text: 'How long does a migration take?' },
    answer(PARAGRAPHS[1]!),
    {
      type: 'list',
      ordered: true,
      items: [
        'Inventory every shared drive and its owner',
        'Run a pilot with one department',
        'Sync the delta on the final weekend',
      ],
    },
    { type: 'heading', level: 2, text: 'Is AutoCAD LT secure?' },
    answer(PARAGRAPHS[3]!),
    { type: 'heading', level: 2, text: 'Who supports our team after the move?' },
    answer(PARAGRAPHS[4]!),
    {
      type: 'paragraph',
      text: 'According to the AutoCAD Trust Center, files are encrypted with 256-bit AES at rest and TLS in transit.',
    },
    { type: 'link', href: 'https://www.autodesk.com/business/trust', text: 'AutoCAD Trust Center' },
    { type: 'link', href: '/pricing', text: 'AutoCAD LT pricing' },
    { type: 'link', href: '/autocad-migration', text: 'AutoCAD migration service' },
    { type: 'link', href: '/contact', text: 'Talk to a AutoCAD specialist' },
    { type: 'heading', level: 2, text: 'Frequently asked questions' },
    {
      type: 'faq',
      question: 'Can we keep our existing AutoCAD accounts?',
      answer: 'Yes. Existing personal accounts can be invited into the team, and their files move with them.',
    },
    {
      type: 'faq',
      question: 'Do you issue GST invoices?',
      answer: 'Yes. Every invoice is issued in Indian rupees with GST, from our registered office in Bengaluru.',
    },
    {
      type: 'faq',
      question: 'What is the minimum number of users?',
      answer: 'Three users on the Standard and Advanced plans. There is no maximum.',
    },
  ];

  const schema: JsonLd[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Example Cloud Pvt Ltd',
      url: ORIGIN,
      logo: `${ORIGIN}/logo.png`,
      sameAs: ['https://www.linkedin.com/company/example', 'https://x.com/example'],
      address: { '@type': 'PostalAddress', addressLocality: 'Bengaluru', addressCountry: 'IN' },
      telephone: '+91 80 0000 0000',
      email: 'hello@example.com',
      contactPoint: { '@type': 'ContactPoint', contactType: 'sales', telephone: '+91 80 0000 0000' },
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Example', url: ORIGIN },
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'AutoCAD LT for teams in India',
      url,
      inLanguage: 'en-IN',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'AutoCAD LT', item: url },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Can we keep our existing AutoCAD accounts?',
          acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
        },
      ],
    },
  ];

  return {
    entityType: 'PAGE',
    entityId: 'page_autocad_lt',
    kind: 'page',
    name: 'AutoCAD LT',
    country: ROOT_MARKET,
    path,
    slug: 'autocad-lt',
    absoluteUrl: url,
    editPath: '/admin/pages/page_autocad_lt',
    status: { value: 'PUBLISHED', live: true, publishedAt: '2026-01-10T09:00:00.000Z', notServedReason: null },
    updatedAt: '2026-09-01T09:00:00.000Z',
    meta: {
      title: 'AutoCAD LT for Teams in India | Example',
      ownTitle: 'AutoCAD LT for Teams in India',
      titleSource: 'seo',
      description:
        'Buy AutoCAD LT in India with GST invoices, 5 TB of shared storage, migration help and support from certified AutoCAD specialists. Plans from 3 users.',
      descriptionSource: 'seo',
      canonical: { explicit: null, effective: url, self: url, otherMarket: null },
      keywords: ['AutoCAD LT', 'AutoCAD migration'],
      keywordsSource: 'own',
    },
    robots: {
      noIndex: false,
      noFollow: false,
      noIndexReasons: [],
      inSitemap: true,
      sitemapExclusion: null,
      blockedByRobots: false,
      blockingRule: null,
    },
    social: {
      ogTitle: 'AutoCAD LT for teams in India',
      ogTitleExplicit: true,
      ogDescription: 'Shared storage, migration help and GST invoices from certified AutoCAD specialists.',
      ogDescriptionExplicit: true,
      ogImage: { url: `${ORIGIN}/uploads/og-autocad-lt.png`, source: 'entity' },
      twitterCard: 'summary_large_image',
      twitterSite: '@example',
      twitterTitleExplicit: false,
    },
    content,
    schema,
    alternates: { locales: ['en-IN'], indexableMarkets: 1 },
    entity: {
      siteName: 'Example',
      organizationName: 'Example Cloud Pvt Ltd',
      hasLogo: true,
      sameAsCount: 2,
      hasAddress: true,
      hasPhone: true,
      hasEmail: true,
      localBusinessType: null,
    },
    collisions: { title: [], description: [], keyword: [], content: [] },
    ...overrides,
  };
}
