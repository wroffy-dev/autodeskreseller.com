# SEO Intelligence

SEO Intelligence (Admin → Content & SEO → SEO Intelligence,
`/admin/seo-intelligence`) scores every public URL — pages (city pages
included), the home page, each product in each market, articles, blog
categories, tags and the blog archive — for **SEO**, **AEO** and **GEO**, and
tells editors what to fix first. It extends the existing SEO module (Admin →
SEO): settings, robots.txt, sitemaps and structured data work exactly as before.

> **What the scores are — and are not.** They are internal indicators worked
> out from the site's own content and configuration, by a deterministic,
> versioned rule engine. **AEO and GEO are content-readiness assessments**:
> they describe whether a page is written and structured so an answer engine
> or AI assistant *could* use it. They do not measure real AI citations,
> Google rankings or traffic, and promise no visibility. No paid AI API is
> called, nothing is random, and the same content always gets the same score.

---

## Contents

- [Scores](#scores)
- [What is checked](#what-is-checked)
- [Not applicable is not a failure](#not-applicable-is-not-a-failure)
- [Target keywords](#target-keywords)
- [What is analysed](#what-is-analysed)
- [Freshness: audit time, content version, stale results](#freshness-audit-time-content-version-stale-results)
- [The dashboard](#the-dashboard)
- [Rescanning](#rescanning)
- [Permissions](#permissions)
- [Data and rollout](#data-and-rollout)
- [Changing the rules](#changing-the-rules)
- [Rule reference](#rule-reference)

---

## Scores

Each check is worth points. A pass earns them all, a fail none, a warning the
share the check reports. A dimension's score is **points earned ÷ points
available × 100**, rounded, 0–100.

| Score | What it covers |
| --- | --- |
| **SEO** | Metadata, headings, copy and keyword placement, URL and canonical, indexability, images, links, social tags, structured data and its consistency with the page, duplicates, sitemap and market equivalents |
| **AEO** — answer-engine readiness | Direct answers, useful question-and-answer content, clear question headings, lists and steps, definitions, structured content such as FAQ markup where the page really has FAQs |
| **GEO** — generative-engine readiness | Identifiable entities (organisation, product, author), factual specificity, useful source references, authorship and business information where it belongs, clarity |
| **Overall** | **SEO 50% + AEO 25% + GEO 25%** (`OVERALL_WEIGHTS`, `src/lib/seo/score-overall.ts`) |

States: 0–39 *Poor*, 40–59 *Needs improvement*, 60–79 *Good*, 80–100
*Excellent*. A URL below 60 is listed as *needs attention*.

The **site score** averages live, indexable URLs only — drafts and deliberate
noindex pages never move it — weighted by kind: home page 3, product 2, page
1.5, article 1, category and archive 0.75, tag 0.5 (`SITE_KIND_WEIGHTS`).

## What is checked

Checks are content-type-specific: each declares the kinds of page it applies
to, and many decide applicability from the page itself (a contact-details
check only on home, contact and about pages; FAQ markup only where there is an
FAQ). The full list, generated from the code, is in the
[rule reference](#rule-reference). In outline:

- **SEO** — effective title and description *including inherited values*
  (page → city → market → site defaults), their length and uniqueness within
  the market; one visible H1 and a sound heading structure; natural keyword
  relevance (in the title, description, URL, H1, opening and body, and not
  overused); the public URL, canonical and robots directives; image
  alternative text; internal links and references that lead nowhere;
  structured data present, valid and consistent with the visible content;
  duplicate metadata and substantially similar content in the same market;
  sitemap eligibility; hreflang only for genuine equivalents in other markets.
- **AEO** — whether the page answers its questions directly near the top,
  uses question-style headings where it answers questions, has lists and
  steps where they help, defines its terms, and marks up real FAQ content.
  FAQs are never required on every page.
- **GEO** — whether an assistant could tell who says this (organisation,
  author or business details where they belong), what it is about (named
  products and entities), and where its facts come from (specific figures,
  dates, references); and whether the copy is clear.

Every check that does not pass explains what it found and how to fix it,
grouped as **critical**, **warning** or **suggestion**, and the editor's score
panel has a button beside each issue that jumps to the field that fixes it.

## Not applicable is not a failure

A check that does not fit a page is **N/A** and is left out of the points
available — it neither earns nor costs anything. The same holds for checks
that cannot be assessed from the data (no failure is invented when, say, an
image's dimensions are unknown) and for a deliberate noindex: it is reported,
never scored down. A page with fewer applicable checks is therefore scored on
what does apply to it.

## Target keywords

Pages, products (and each market version), articles, blog categories and
cities can name **up to three primary target keywords**. They are inputs to
the analysis — where they appear and whether they are overused — and nothing
else: no `<meta name="keywords">` tag is output, and no check or message
claims that keyword markup affects rankings. Duplicates (ignoring case and
spacing) are refused; a market version with none uses the product's.

## What is analysed

The **effective public content**, not raw editor fields. Adapters in
`src/lib/seo/content/` turn every CMS block (hero, rich text, FAQ, cards,
sliders, product grids, forms…), every product layout section and the blog's
article and listing layouts into the text, headings, links, images and
questions a visitor sees, in order, skipping hidden sections. Titles,
descriptions, canonicals and robots are resolved the way the public page
resolves them, and URLs come from the URL registry — the address the page is
really served at, city pages included.

## Freshness: audit time, content version, stale results

Scores are cached per URL and market (`SeoAudit`). Each row records:

- **when it was audited** (`calculatedAt`), shown on every row and on the
  analysis;
- the **content version** it was scored against (`contentFingerprint`): the
  content's timestamps and section counts, its city, and the version of its
  registered address — so editing the content, adding or hiding a section,
  changing the city, *or moving its URL* (a slug edit, a bulk move, a restore,
  a city rename) all change it;
- the **engine version** (`SEO_ENGINE_VERSION`) and a fingerprint of the
  site-wide settings that shape every score (templates, robots, market
  indexing, URL patterns).

A row whose fingerprints or engine no longer match is **outdated**: it is
badged in the list, counted in the banner, and filterable. Nothing is ever
shown as current when it is not.

## The dashboard

- **Overview**: the overall site score and its SEO/AEO/GEO components,
  indexable and scored URL counts, the score distribution, and what needs
  attention (missing metadata, missing structured data, no target keywords,
  indexing conflicts).
- **Scorecards**: one row per URL per market, with all four scores, issue
  counts, status, audit time and content date; a full analysis per URL.
- **Filters** (kept in the address bar, so a filtered view can be shared):
  search, **country**, **city**, **content type**, **score** band,
  **severity** (critical / warnings / suggestions only / no issues),
  **issue** type, **audit status** (up to date / outdated), publication
  status and indexing.
- The live score panel in the page, product, product-market and article
  editors scores the form as it stands, unsaved.

## Rescanning

- **One URL**: *Recalculate* on its row, or simply open its analysis — opening
  it audits it again and updates the cached row.
- **In bulk**: *Recalculate outdated* or *Recalculate all*, which run in
  bounded batches of 20 URLs per request until done, limited to the markets
  the user may work in.
- **Automatically**: creating or saving a page, product, article, blog
  category or city; publishing, unpublishing or archiving one (singly or in
  bulk, up to 50 at a time); adding, editing, reordering, hiding or removing a
  section; generating city pages; and changing a single address all refresh
  the affected URLs' scores **after the response is sent**, so a save is never
  slowed by a scan and never fails because of one. Anything this misses —
  bulk URL changes, pattern changes, settings changes, larger bulk actions —
  is marked outdated by the freshness check above.

## Permissions

The dashboard, filters, recalculation and bulk audits need `seo.manage`, and
see only the markets the user may work in. An individual analysis (and the
editor's score panel) is open to anyone who may view that kind of content —
`pages.view`, `products.view` or `blog.view` — in that market. Every check runs in the
server action.

## Data and rollout

Migration `20260925140000_seo_intelligence` (additive): nullable
`primaryKeyword1`–`3` on `Page`, `Product`, `ProductCountry`, `BlogPost` and
`BlogCategory` (an article's existing focus keyword is copied into its first
primary keyword), and the `SeoAudit` cache, which is removed with its market.
The cache is never a source of truth: deleting every row loses nothing but the
time it takes to recalculate. After deploying, open the dashboard and run
*Recalculate all* once (it starts by itself when nothing is cached).

## Changing the rules

Checks live in `src/lib/seo/score-seo.ts`, `score-aeo.ts` and `score-geo.ts`;
each is an entry with an id, label, points, severity, the kinds it applies to
and an `evaluate` function. Adding or changing one is a code change, reviewed
and tested like any other (`tests/unit/seo-intelligence.test.ts`). Bump
`SEO_ENGINE_VERSION` in `src/lib/seo/types.ts` whenever a rule changes, so
every cached score is marked outdated.

## Rule reference

Engine version **1.0.0**. Points are the check's weight when it applies.

### SEO checks (38)

| Check | Category | Points | Severity | Applies to |
| --- | --- | --- | --- | --- |
| SEO title | metadata | 8 | critical | all |
| Title length | metadata | 5 | improvement | all |
| Unique title | metadata | 4 | improvement | all |
| Primary keyword in title | keywords | 5 | improvement | all |
| Meta description | metadata | 8 | critical | all |
| Description length | metadata | 4 | improvement | all |
| Primary keyword in description | keywords | 3 | improvement | all |
| Unique description | metadata | 3 | improvement | all |
| Canonical URL | technical | 5 | critical | all |
| Robots directives | indexability | 4 | improvement | all |
| One visible H1 | content | 6 | critical | all |
| Primary keyword in H1 | keywords | 4 | improvement | all |
| Heading hierarchy | content | 4 | improvement | all |
| Useful copy | content | 8 | improvement | all |
| Primary keyword in body | keywords | 5 | improvement | all |
| Keyword overuse | keywords | 3 | improvement | all |
| Internal links | links | 4 | improvement | all |
| Authoritative external links | links | 2 | suggestion | article |
| Descriptive link text | links | 3 | improvement | all |
| Image alt text | images | 5 | improvement | all |
| Distinct alt text | images | 2 | suggestion | all |
| Image file size | images | 2 | suggestion | all |
| Readable URL | url | 3 | improvement | page, product, article, category, tag |
| URL length | url | 2 | suggestion | page, product, article, category, tag |
| Keyword-relevant URL | keywords | 3 | suggestion | page, product, article, category, tag |
| Open Graph title | social | 2 | suggestion | all |
| Open Graph description | social | 2 | suggestion | all |
| Open Graph image | social | 4 | improvement | all |
| X / Twitter card | social | 2 | suggestion | all |
| Page status | technical | 3 | improvement | all |
| Indexability | indexability | 6 | critical | all |
| Sitemap | indexability | 3 | improvement | all |
| robots.txt access | indexability | 4 | critical | all |
| Consistent indexing signals | indexability | 3 | critical | all |
| Structured data | structuredData | 4 | improvement | all |
| Market alternates (hreflang) | technical | 2 | suggestion | homepage, page, product |
| Primary keywords | keywords | 5 | improvement | all |
| Keyword overlap | keywords | 2 | suggestion | all |

### AEO checks (17)

| Check | Category | Points | Severity | Applies to |
| --- | --- | --- | --- | --- |
| Clear topic | answers | 6 | improvement | all |
| Answer-first opening | answers | 5 | improvement | homepage, page, product, article, category |
| Question-led headings | answers | 5 | suggestion | page, product, article |
| Concise answers | answers | 5 | improvement | page, product, article, homepage |
| FAQ content | answers | 5 | suggestion | homepage, page, product, article |
| FAQ structured data | structuredData | 4 | improvement | all |
| Lists and tables | readability | 4 | suggestion | homepage, page, product, article |
| Definition | answers | 3 | suggestion | page, article, category |
| Readability | readability | 4 | improvement | all |
| Self-contained sections | readability | 2 | suggestion | page, article, product |
| Clear product facts | entities | 6 | improvement | product |
| Entity named early | entities | 4 | improvement | homepage, page, product, article |
| Breadcrumbs | structuredData | 3 | improvement | page, product, article, category, tag, archive |
| Relevant schema | structuredData | 4 | improvement | all |
| Author information | trust | 5 | improvement | article |
| Published and updated dates | trust | 3 | suggestion | article |
| Archive introduction | answers | 3 | suggestion | category, tag, archive |

### GEO checks (15)

| Check | Category | Points | Severity | Applies to |
| --- | --- | --- | --- | --- |
| Organisation identity | entities | 5 | improvement | all |
| Consistent entity data | entities | 5 | improvement | homepage, product, article |
| Specific, factual statements | content | 6 | improvement | all |
| Supported claims | trust | 4 | improvement | all |
| Sources | trust | 4 | suggestion | article, page |
| Statistics with context | trust | 3 | suggestion | all |
| Freshness | trust | 3 | suggestion | article, product |
| Machine-readable structure | structuredData | 6 | improvement | all |
| Author and publisher | trust | 4 | improvement | article |
| Topical depth | content | 5 | improvement | homepage, page, product, article |
| Quotable passages | answers | 5 | improvement | homepage, page, product, article |
| Original, substantial content | content | 5 | critical | homepage, page, product, article |
| Location and contact data | entities | 3 | suggestion | homepage, page |
| No keyword stuffing | keywords | 3 | improvement | all |
| Question-and-answer coverage | answers | 4 | suggestion | page, product, article |
