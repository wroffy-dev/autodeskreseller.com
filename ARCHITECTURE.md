# Architecture

How this platform is put together, and why. For setup and operations, see
[README.md](./README.md).

---

## Contents

- [Shape of the system](#shape-of-the-system)
- [Countries](#countries)
- [Cities](#cities)
- [Request flow](#request-flow)
- [Directory layout](#directory-layout)
- [Data model](#data-model)
- [Authentication](#authentication)
- [Authorisation](#authorisation)
- [CMS architecture](#cms-architecture)
- [Lead capture and attribution](#lead-capture-and-attribution)
- [CRM](#crm)
- [Storage abstraction](#storage-abstraction)
- [SEO architecture](#seo-architecture)
- [Branding at runtime](#branding-at-runtime)
- [Email](#email)
- [Caching and revalidation](#caching-and-revalidation)
- [Deployment](#deployment)
- [Testing strategy](#testing-strategy)
- [Decisions worth knowing about](#decisions-worth-knowing-about)

---

## Shape of the system

One Next.js application serves three surfaces from a single PostgreSQL database:

```
                        ┌──────────────────────────┐
   Visitor ────────────▶│  Public site   /(public) │
                        │  SSG + ISR, RSC-first    │
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
   Administrator ──────▶│  Admin panel   /admin    │
                        │  Server Components +     │
                        │  Server Actions          │
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │  Service layer  lib/     │
                        │  validation → services → │
                        │  Prisma                  │
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │  PostgreSQL              │
                        └──────────────────────────┘
```

There is no separate API tier. Mutations are Server Actions; reads happen inside
Server Components. Client components exist only where interaction demands them —
drag-and-drop, dialogs, the form runtime — and they never touch Prisma.

---

## Countries

The platform serves several storefronts from one application. A **country** owns
a URL prefix, a currency, a locale and a set of content; exactly one country is
the default, holds the empty prefix and is served from `/`.

```
/dropbox-business        →  default market (India)
/ae/dropbox-business     →  the market whose slug is "ae"
/qa/dropbox-business     →  works the moment a Country row with slug "qa" exists
```

Resolution is one pure function over the configured markets, in
`src/lib/country/routing.ts`, plus one cached read of the `Country` table. There
is no rewrite: middleware forwards the request path, the prefix stays in the URL,
and the public catch-all classifies what is left. System routes (`/admin`,
`/api`, `/uploads`, …) are reserved and can never be read as a market.

For the default market `countryHref()` is the identity function, so the original
single-country URLs and HTML are unchanged.

Per country: pages, articles, menus, product availability and pricing, company
contact details, SEO defaults, organisation schema, leads. Global: the brand,
the media library, product identity, taxonomies, staff, roles and permissions.

Full reference, including the migration and how to add a market:
[docs/MULTI-COUNTRY.md](docs/MULTI-COUNTRY.md).

---

## Cities

Country is the market; a **City** is a local address space inside one market;
**Page** is the content. A city owns the first segment of its market's
addresses (`/delhi`, `/ae/dubai`), and its landing page and every other page
in it are ordinary `Page` rows edited in the Page Builder — there is no second
CMS, no per-city route and no second conflict system:

- **Addresses** — the URL registry files a page under a city from its address
  (`placeContent`) and refuses anything else in a city's space; a city's slug
  is checked against the registry before it is given (`src/lib/urls/cities.ts`).
- **Liveness** — a city's `status` (DRAFT / PUBLISHED / ARCHIVED) is the one
  switch; `publishedPageWhere()` serves a city page only while its city is
  published (the derived `isActive` flag, held equal to the status by a CHECK
  constraint), and `listedPageWhere()` adds the city's noindex and sitemap
  switches for the sitemap.
- **Search and contact details** — resolved Page → City → Country → Global at
  render time by `src/lib/cities/seo.ts` and `src/lib/cities/local.ts`, for the
  public page and SEO Intelligence alike.
- **Generator** — copies a page into many cities as drafts, one transaction
  per city, filling `{{city}}`/`{{region}}`-style placeholders once. Generated
  pages keep provenance (`generatedFromPageId`, `generationBatchId`,
  `generatedAt`, `generatedHash`) and nothing ever syncs them; regenerating
  an existing page is an explicit, confirmed choice after an impact preview.
- **City/product pages** — an explicit `CityProduct` row (city, product,
  page) marks a page as a city's page for a product; a nested address alone
  never does.
- **Database guarantees** — triggers keep a city's address space to its own
  pages and keep its own address free of manual redirects, so the rules hold
  whatever writes the rows.

Full reference: [docs/CITIES.md](docs/CITIES.md).

---

## Request flow

Every write follows the same path:

```
Client component
      │  (typed action call)
      ▼
Server Action  ── 'use server'
      │
      ├─▶ authorize('permission')      throws AuthorizationError
      ├─▶ zodSchema.parse(input)       throws ZodError
      ├─▶ sanitize / normalise
      │
      ▼
Service layer / Prisma
      │
      ├─▶ recordAudit(...)             never throws
      ├─▶ revalidatePath(...)
      │
      ▼
ActionResult<T>  { ok: true, data } | { ok: false, error, fieldErrors }
```

A market-scoped write also passes through `resolveActionCountry` or
`assertCountryAccess`, which validate the country it is about to write against
the markets the signed-in user may work in. Country access narrows what a role
already permits and never widens it, and a country id in a form body is never
trusted on its own.

`toActionError` maps every thrown error to a safe `ActionResult`. Zod errors
become per-field messages; authorisation errors become a generic refusal;
anything else is logged server-side and returned as a generic message. Stack
traces never reach the browser in production.

---

## Directory layout

```
src/
├── app/
│   ├── (public)/          Public site. Route group adds no path segment.
│   │   ├── [[...slug]]/   Catch-all: every CMS page, including the homepage
│   │   ├── blog/          Index, post, category
│   │   └── products/      Product detail
│   ├── admin/             Admin panel, one directory per area
│   ├── api/
│   │   ├── auth/          Auth.js route handler
│   │   └── health/        Container health check
│   ├── auth-control-panel/
│   │   └── admin/         Sign-in screen; path from lib/auth/routes.ts
│   ├── sitemap.ts         Generated from published content
│   └── robots.ts          Generated from SEO settings
│
├── components/
│   ├── ui/                Primitives: button, field, card, table, dialog, toast
│   ├── cms/               Block renderers, section renderer, generated editor
│   ├── admin/             Admin shell and per-area screens
│   ├── public/            Header, footer, popup host, brand style
│   ├── forms/             Public form runtime
│   └── products/          Product card and CTA
│
└── lib/
    ├── actions/           Server Actions — the only write path
    ├── auth/              Auth.js config, permission catalogue, guards
    ├── cms/               Block registry, field descriptors, section settings
    ├── crm/               Shared CRM vocabulary and query builders
    ├── db/                Prisma client singleton
    ├── email/             Mailer and templates
    ├── seo/               Metadata builder and JSON-LD helpers
    ├── services/          Read models and domain services
    ├── storage/           Storage abstraction
    ├── utils/             Money, slugs, sanitisation, rate limiting, CSV
    └── validation/        Zod schemas, one module per domain
```

`lib/actions` writes, `lib/services` reads. Keeping them apart means a Server
Component can import a service without dragging in the `'use server'` boundary.

---

## Data model

Twenty-nine models. The parts worth calling out:

**Content**
- `Page` has many `PageSection`. A section stores `blockType` plus two JSON
  columns: `content` (validated by the block's schema) and `settings` (the
  `SectionDesign` object described under [CMS architecture](#cms-architecture)).
  Ordering is an integer `sortOrder` rewritten in steps of ten on every reorder.
  There is no hardcoded page anywhere: the homepage is the `Page` row whose slug
  is the empty string, rendered by the same catch-all route as every other page.
- `Product` carries `Decimal` prices, JSON arrays for features/benefits/specs,
  and an optional `ctaForm` relation. Ordering is explicit and stored, never
  derived from creation date: `sortOrder` for the catalogue and a separate
  `featuredOrder` for the featured rail, so a product can sit third in the
  catalogue and first among the featured picks. `isFeatured` is a plain flag, so
  any number of products can be featured at once.
- `Brand` groups products by vendor alongside `ProductCategory`. Both are
  optional relations with `onDelete: SetNull`, so removing one never removes a
  product.
- `BlogPost` relates to categories, tags (through `BlogPostTag`) and other posts
  (through the self-referencing `BlogPostRelation`).

**CRM**
- `Lead` is the centre of the model. It stores last-touch UTM fields *and* a
  parallel set of `firstUtm*` fields, plus foreign keys to the product, landing
  page, form and lead magnet that produced it.
- `LeadActivity` is an append-only timeline. `LeadNote` holds free text.
- `Customer` links back to its leads and to `CustomerProduct`, which is shaped
  so subscriptions and orders can be added later without a migration of the
  existing rows.

**Configuration singletons**

`WebsiteSettings`, `SeoSettings`, `TrackingSettings` and `EmailSettings` each
hold exactly one row with the id `singleton`, upserted on first read. A
singleton row is simpler to reason about than a key/value table and gives every
setting a real column with a real type.

**Deletion policy**

Anything referenced by a lead is soft-deleted — pages, products, forms, posts,
lead magnets and staff. The row is marked `deletedAt`, its slug or email is
suffixed to free the unique index, and it disappears from every query. Lead
attribution and audit history stay intact. Media, redirects, categories and
navigation items are hard-deleted; nothing depends on them historically.

---

## Authentication

Auth.js v5 with a credentials provider and JWT sessions.

The configuration is deliberately split:

- `lib/auth/config.ts` is edge-safe — no Prisma, no bcrypt — so `middleware.ts`
  can import it to gate `/admin`.
- `lib/auth/index.ts` adds the credentials provider, which needs both.

The session token carries the user id, role slug and resolved permission list,
so a permission check costs nothing at request time.

Sign-in is rate limited per email address (8 attempts / 15 min) and per source
IP (20 / 15 min). A failed lookup still runs a bcrypt comparison against a dummy
hash, so response timing does not reveal whether an address exists.

---

## Authorisation

Permissions are strings like `pages.publish`, catalogued in
`lib/auth/permissions.ts` and stored in the database against roles.

Three entry points, by context:

| Function | Use | On failure |
| --- | --- | --- |
| `requireUser()` | Layouts | 404 when anonymous; redirect to the MFA step still owed |
| `requirePermission(key)` | Page components | Redirect to `/admin?denied=…` |
| `authorize(key)` | Server Actions | Throw `AuthorizationError` |

These guards are the boundary, and the only one — middleware does not gate
`/admin` at all, because a redirect from there would have named the sign-in
screen in a Location header. The admin layout authenticates, every page
re-checks its own permission, and a Server Action reached directly, without
ever loading a page, is checked just the same.

Role hierarchy is enforced by `rank` — lower is more privileged. Staff can only
create or edit accounts with a strictly higher rank than their own, which stops
an Admin promoting themselves to Super Admin. Nobody can change their own role
or suspend their own account, and the last active Super Admin cannot be deleted.

---

## CMS architecture

The page builder knows nothing about individual blocks. A block is:

```ts
{
  type: 'hero',
  label: 'Hero',
  description: '…',
  group: 'Content',
  schema: z.object({ … }),        // validation + defaults
  fields: [ … ],                  // declarative editor description
}
```

`fields` is a list of descriptors — `text`, `textarea`, `richtext`, `number`,
`boolean`, `select`, `url`, `media`, `form`, `products`, `productCategory`,
`brand`, `icon`, `color`, `length`, `repeater`. The admin editor is generated
from them by `components/cms/field-renderer.tsx`, so adding a block never means
touching editor code. A descriptor may also carry `showWhen`, which hides it
until a sibling field holds one of the listed values — that is how the product
section only asks for a category when the source is "By category".

Reading a section:

```
PageSection.content (JSON)
        │
        ▼
parseBlockContent(type, raw)
        │  schema.safeParse → falls back to schema defaults on failure
        ▼
Typed content object → block renderer
```

Partial or stale content can never crash a page: an unparseable payload falls
back to the schema's defaults, and an unregistered `blockType` renders nothing
(with a development warning).

Presentation lives in `settings`, shared by every block, and is described by
`lib/cms/design.ts`. That is why blocks contain no layout chrome of their own.

### Section design

One `SectionDesign` object covers every section regardless of block type:

```
SectionDesign
 ├── preset          quick background (default | muted | brand | dark | gradient)
 ├── widthMode       boxed | narrow | wide | full | custom  (+ maxWidth)
 ├── background      none | solid | gradient | image
 │                    └── position, size, repeat, attachment, overlay, opacity
 ├── colors          primary, secondary, text, heading, background,
 │                    button, buttonText, link, invertText
 ├── anchorId        rendered as id="…", unique per page
 └── desktop / tablet / mobile
      ├── margin  { top, right, bottom, left }   each a full CSS length
      ├── padding { top, right, bottom, left }
      ├── columns, contentWidth, minHeight, align
      ├── headingSize, bodySize
      ├── rowGap, columnGap, contentGap, cardGap
      ├── imageWidth, imageHeight
      └── hidden
```

Values are stored as finished CSS lengths (`40px`, `2.5rem`, `85%`, `4vh`), so
the admin is not limited to a fixed spacing scale.

### Why CSS custom properties, not utility classes

Tailwind cannot generate a class for a value an admin invents at runtime.
`buildSectionStyles()` therefore emits variables instead:

```
desktop values  → inline style on the <section>   (always wins, no specificity war)
tablet / mobile → one <style> per section, one media query per breakpoint,
                  containing only the properties that actually differ
```

`globals.css` holds the fixed rules that consume them (`.cms-section`,
`.cms-container`, `.cms-grid`, `.cms-media`). A section left at its defaults
emits **no** CSS at all, so flexibility costs nothing on pages that do not use
it. Inheritance runs desktop → tablet → mobile: an unset value simply does not
override the larger breakpoint.

### Backwards compatibility

`parseSectionDesign()` accepts both the current shape and the original
`{ background, paddingTop, paddingBottom, width, hideOnMobile }` one, translating
the old spacing scale into real lengths at read time. Pages built before the
design system keep rendering identically with no data migration, and are
upgraded in place the next time they are saved.

---

## Lead capture and attribution

```
Visitor lands with ?utm_source=…
        │
        ▼
middleware  ── writes attr_first (1 year) and attr_last (30 days) cookies
        │        first-touch is only written once, ever
        ▼
Visitor clicks a product CTA
        │
        ▼
ProductCta opens the configured form in a dialog
        │
        ▼
collectAttribution()  ── merges cookies with the current URL's parameters
        │
        ▼
submitForm(envelope)  ── Server Action
        │
        ├─ honeypot field filled?          → return success, store nothing
        ├─ submitted in under 1.2s?        → reject
        ├─ more than 5 in 10 min per IP?   → reject
        ├─ rebuild the Zod schema from the stored FormField rows
        ├─ create Lead   (product, page, CTA, first + last touch, hashed IP)
        ├─ create FormSubmission, linked to the lead
        └─ dispatch notifications (never blocks the response)
```

The validation schema is **rebuilt on the server** from the admin's field
definitions on every submission. The client's idea of what is required or which
select options exist is never trusted — a tampered payload fails against the
same rules the admin configured.

The raw IP is never stored; only a salted SHA-256 prefix, which is enough for
rate limiting and duplicate detection.

---

## CRM

Leads move through `NEW → CONTACTED → QUALIFIED → PROPOSAL → NEGOTIATION → WON |
LOST`, with `SPAM` outside the funnel.

The Kanban board is optimistic: the card moves immediately, and the previous
state is restored if the action fails. A move persists both the new status and
the destination column's full order, so manual ordering survives a reload.

Every meaningful change writes a `LeadActivity` row, which is what makes the
lead timeline a genuine history rather than a reconstruction.

Converting a won lead reuses an existing customer with the same email when there
is one, rather than creating a duplicate.

---

## Storage abstraction

```
        StorageService (interface)
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
LocalStorage  S3Storage   S3Storage
 (filesystem)   ('s3')      ('r2')
```

`storage()` resolves the driver from `STORAGE_PROVIDER` once and caches it. The
CMS, product editor and media library only ever see `put`, `delete` and
`publicUrl` — no branching on provider anywhere in the application code.

Each `Media` row records the provider that stored it, so files uploaded before a
provider switch keep resolving.

Upload validation runs before anything is written: size cap, MIME allow-list,
and a magic-byte check that rejects a file whose contents contradict its
declared type. SVGs are scanned for script and refused. Storage keys are
namespaced by year and month with random entropy, and path traversal is stripped
from the filename before it is used.

---

## SEO architecture

Resolution order for every page, product and post:

```
entity value  →  global default (SeoSettings)  →  built-in fallback
```

`buildMetadata()` in `lib/seo/metadata.ts` implements that merge once and is
used by every route's `generateMetadata`. It produces the title (through the
configurable `%s` template), description, canonical, robots directives, Open
Graph and Twitter cards, and the search-console verification tags.

Structured data is emitted from typed helpers, never string-built:
Organization and WebSite site-wide; Product on product pages; Article and
Breadcrumb on posts; FAQPage derived automatically from any FAQ block on a page.

`sitemap.xml` lists published, non-noindexed content and can be switched off.
`robots.txt` is generated from the same settings, including a site-wide
disallow when the SEO screen's "hide from search engines" switch is on.

Redirects are checked only when a request would otherwise 404 — the lookup costs
nothing on the happy path. Saving a redirect walks the existing chain and
refuses anything that would close a loop.

### Public addresses: the URL registry

Every public address is owned by exactly one thing, recorded in `UrlRoute`
(`pathKey` unique): content by `(entityId, countryId)`, or a redirect rule.
Content identity and public path are separate, so every link is built from the
id (`lib/urls/links.ts`) and any address can change without breaking one.

```
request ──▶ public route (catch-all or /products, /blog/…)
              │
              ▼
        resolvePublic(path)        lib/urls/resolve.ts
              │  registry on:  one lookup of pathKey
              │     CONTENT   → render that content by id (404 unless live)
              │     REDIRECT  → 308/307 before rendering, query kept
              │     none      → 404, recorded for URL Health
              │  registry off: the previous slug-based rules, unchanged
              ▼
        surface renders by id
```

Addresses are decided by custom address → market pattern → global pattern →
built-in default, and written only under one PostgreSQL advisory lock with
optimistic versions. Each server holds the registry in memory and rebuilds it
when `UrlSettings.version` changes, which costs one primary-key read per
request. The registry ships switched off; switching it off again is the
rollback. Full reference: [docs/URL-REGISTRY.md](docs/URL-REGISTRY.md).

Bulk redirects come from a two-column CSV (`URL,Destination URL`), validated
as one proposed change to the whole redirect graph — existing rules included —
and applied in locked, resumable batches recorded on `UrlOperation`
(`lib/urls/redirect-import.ts`).

### SEO Intelligence

Every public URL is scored for SEO, AEO and GEO (overall = 50/25/25) by a
deterministic, versioned rule engine (`lib/seo/score-*.ts`) over the
**effective public content**: block adapters (`lib/seo/content/`) turn CMS
sections and product/blog layouts into what a visitor sees, and documents are
built with the registry's addresses (`lib/seo/intelligence/documents.ts`).
Results are cached in `SeoAudit` with the content's and settings'
fingerprints (the route version included), so a stale score is detected
without rescoring; saves refresh affected URLs after the response. AEO and GEO
are internal content-readiness assessments, never claims about rankings or AI
citations. Full reference: [docs/SEO-INTELLIGENCE.md](docs/SEO-INTELLIGENCE.md).

---

## Branding at runtime

Colours, fonts and logos are database columns, not build-time configuration.

```
WebsiteSettings row
        │
        ▼
<BrandStyle />  ── converts hex to "R G B" triples, emits :root { --brand-* }
        │
        ▼
Tailwind tokens: bg-brand, text-content, border-hairline …
        │
        ▼
Every component on both the public site and the admin
```

Tailwind's `<alpha-value>` syntax means `bg-brand/10` still works against a
runtime-defined colour. Changing the primary colour in the admin repaints the
entire site on the next request — no rebuild, no redeploy.

### Typography

`lib/cms/google-fonts.ts` bundles a catalogue of families and the weights each
one actually ships. The admin picks a family per role — body, heading,
navigation, button — and `googleFontsHref()` builds a single stylesheet URL for
exactly those families and weights:

```
Settings → Typography          →  one <link> such as
  body     Inter    400            css2?family=Inter:wght@400;500;600;700
  heading  Inter    700                &family=Lora:wght@600
  nav      (inherit body)            &display=swap
  button   (inherit body)
```

Nothing else from the catalogue is downloaded, requested weights are clamped to
what the family provides, and a name that is not in the catalogue is skipped
rather than fetched blindly. An empty navigation or button font inherits the
body font, which costs no extra request.

Layout and button tokens (`--layout-container`, `--layout-section-spacing`,
`--btn-radius`, `--btn-padding-x`, …) come from the same settings row, and each
section's design panel can override them locally.

---

## Email

```
resolveSmtpConfig()
        │
        ├─ EmailSettings row has a host?  → use it (password decrypted here)
        └─ otherwise                      → fall back to SMTP_* env vars
```

Database first, environment second: an administrator can change SMTP provider
without a redeploy, while a fresh deployment still works from environment
variables alone.

The password is encrypted with AES-256-GCM under `ENCRYPTION_KEY`. It is never
included in any query that reaches a client component —
`getEmailSettingsSafe()` omits the column entirely and exposes only a
`hasPassword` boolean.

Sending is always fire-and-forget from the caller's perspective. A failing SMTP
server slows nobody's form submission and loses no lead.

---

## Caching and revalidation

- Public pages, products and posts are statically generated where possible and
  revalidated on an interval (`export const revalidate`).
- Admin routes are `force-dynamic` — stale data in an admin table is worse than
  a millisecond of latency.
- Every mutation calls `revalidatePath` for the surfaces it affects. Product
  changes revalidate the whole public tree, because product blocks can appear on
  any page.
- `React.cache()` deduplicates reads within a single request, so the layout and
  the page can both call `getPublishedPage()` for one query.

The `publishedPageWhere()` style helpers are **functions, not constants**. As
constants they captured `new Date()` at module load, and a long-running server
would never surface newly published content until it restarted.

---

## Deployment

Three-stage Docker build: dependencies, build, runtime. Only the standalone
bundle, static assets, `public/`, and the Prisma CLI plus migrations reach the
final image, which runs as a non-root user.

`docker/entrypoint.sh` runs `prisma migrate deploy` before starting the server,
retrying while the database comes up. `migrate deploy` only applies migrations
that already exist — it cannot generate, reset or drop anything, which is what
makes running it automatically on boot safe.

`/api/health` returns 200 when the database responds and 503 when it does not,
so an orchestrator can tell a starting container from a broken one.

The build tolerates an unreachable database. `generateStaticParams` catches the
failure and returns an empty list, and those routes render on demand instead.

---

## Testing strategy

Three layers, each catching a different class of problem:

**Unit** (`tests/unit`) — pure functions with interesting edge cases: Decimal
money handling, slug generation, the HTML sanitiser, the rate limiter, upload
validation.

**Integration** (`tests/integration`) — real Server Actions against a real
PostgreSQL database. The framework boundary is stubbed (`next/cache`, request
headers, the mailer); validation, authorisation and every query run for real.
These cover the page and section lifecycle, product pricing, the full lead
capture path, CRM operations, blog publishing, redirect loop detection and
settings encryption. Several assert that an action is *refused* — that a write
without the right permission leaves the database untouched.

**Smoke** (`scripts/smoke.sh`) — boots the actual production build on a free
port, signs in over HTTP with the seeded credentials, and asserts status codes
and rendered content across every public and admin route. This is the layer that
catches build-only failures: client/server boundary violations, `use server`
export rules, and missing static assets.

---

## Decisions worth knowing about

**No root `loading.tsx`.** A root-level loading file wraps the entire app in a
Suspense boundary. The shell then flushes with a 200 status before `notFound()`
runs, so every 404 silently returned 200 — invisible to a browser, poison to a
search engine. Loading states live in the admin segments, which never 404.

**Declarative block fields rather than bespoke editors.** Fifteen block types
would otherwise mean fifteen editor components to keep in sync. One generated
editor means a new block is a schema and a renderer.

**Decimal everywhere for money.** `0.1 + 0.2 === 0.30000000000000004` is not a
property you want in a pricing table. Prices are validated as strings, stored as
`Decimal`, and converted to strings again before crossing to a client component.

**Singleton settings rows over a key/value table.** Real columns give real
types, real defaults and real validation, at the cost of one migration when a
setting is added — which is the right trade for settings that change rarely.

**Sanitise on write *and* on read.** Content is sanitised before storage, and
again in the renderer. Rows can arrive from a migration, a restored backup or a
direct database edit; the renderer is the last line and does not assume the
writer did its job.

**Vendor tags from fixed templates.** The marketing screen accepts an ID, not a
script. Each vendor's snippet is a template with a format-validated ID
interpolated, so a compromised marketing account cannot inject JavaScript into
every page. Genuinely arbitrary scripts are a separate, audited, permission-
gated feature.
