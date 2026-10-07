# Cities

Cities give a market local landing pages — `/delhi`, `/gurugram`,
`/ae/dubai`, and later `/delhi/autocad` or `/gurugram/revit` — without a second
content system. This
document is the reference for how they work, what they guarantee and where the
code lives.

## The model in one paragraph

**Country is the market** — currency, pricing, settings, URL prefix.
**City is a local address space inside one market** — a slug, a name, contact
details and search defaults. **Page is the content** — and a city's landing
page and every generated city page are ordinary `Page` rows, built in the Page
Builder like any other. A city holds settings and metadata, never content.

```
Country (IN, slug "")           Country (AE, slug "ae")
  └─ City Delhi (slug "delhi")    └─ City Dubai (slug "dubai")
       ├─ Page  delhi                  ├─ Page  dubai                → /ae/dubai
       │   (landing page)   → /delhi   └─ Page  dubai/autocad   → /ae/dubai/autocad
       └─ Page  delhi/autocad
                            → /delhi/autocad
```

Nothing is hard-coded: no country, city or product name appears in code. A
city is a database row; its pages are pages.

## Data

| Model | What it holds |
| --- | --- |
| `City` | `countryId`, `name`, `slug`, optional free-text `region`, `status` (DRAFT / PUBLISHED / ARCHIVED) with `archivedAt`, the derived `isActive`/`isPublished` flags, `sortOrder`; optional `salesPhone`, `whatsappNumber`, `salesEmail`, `address`, `postalCode`, `latitude`, `longitude`; `seoTitle`, `seoDescription`, `primaryKeyword1–3`, `noIndex`, `excludeFromSitemap`. Unique on `(countryId, slug)`. |
| `Page.cityId` | The city whose address space the page is in, or null. |
| `Page.isCityHomepage` | True for the page at the city's own address — its landing page. |
| `Page.generatedFromPageId`, `generationBatchId`, `generatedAt` | Where the City Page Generator copied the page from, in which run, and when. **History only.** |
| `Page.generatedHash` | A fingerprint of the content as the generator wrote it, so the impact preview knows exactly whether a page was edited since. |
| `CityPageBatch` | One generator run: source, market, counts, per-city results (including what a regenerated page held before), who ran it. **History only.** |
| `CityProduct` | An explicit city/product page: “this page is Delhi's AutoCAD page”, by stable ids (`cityId`, `productId`, `pageId`). Unique per city and product. |

`Region` is deliberately not a model and never required.

Guarantees the database enforces itself (migrations `20260930120000_cities`
and `20261007120000_city_status_products_redirect_suffix`, additive — every
existing page gets `cityId = NULL`):

- a city page belongs to its city's market (trigger `Page_city_in_country`);
- a city with pages cannot move to another market (trigger `City_country_fixed`);
- at most one live landing page per city (partial unique index `Page_one_city_homepage`);
- only a city page can be a landing page (check `Page_city_homepage_has_city`);
- a city with pages cannot be deleted (foreign key `Page.cityId`, `ON DELETE RESTRICT`);
- the flags public queries read always match the status (check `City_status_flags`), and only an archived city has `archivedAt` (`City_archived_at`);
- only pages live in a city's address space, no manual redirect takes a city's own address, and a city cannot take a slug something else already holds (triggers `UrlRoute_city_namespace`, `City_namespace_free`, `Country_prefix_not_city`);
- a city/product page is one of that city's pages (trigger `CityProduct_page_in_city`); a page that leaves the city leaves the association (`Page_left_city_product`).

## URLs

A city owns the **first segment** of addresses in its market: Delhi in the root
market owns `/delhi` and everything beneath it; Dubai in the UAE owns
`/ae/dubai/...`. Cities in other markets never matter — India's Delhi owns
`/delhi`, not `/ae/delhi`, and the UAE can have a Delhi of its own.

Addresses follow the site's trailing-slash policy (none): `/delhi/` answers
308 to `/delhi`, and every link, canonical and sitemap entry uses `/delhi`.

`Page.slug` stays market-relative and never carries the market prefix: the
page at `/ae/dubai/autocad` has the slug `dubai/autocad`.

There are **no per-city routes** (`app/delhi/page.tsx` does not exist). City
addresses are ordinary page addresses resolved by the existing catch-all and
URL registry: `/delhi/autocad` is a `UrlRoute` claim like any other,
pointing at a page by id. With the registry switched off, the previous router
finds the page by its slug, exactly as before.

### How a page joins a city

Whenever a page is given an address — by the page form, the Slug Manager, a
bulk change, a restore from the recycle bin, a city rename, the generator —
the registry's `placeContent` looks at the first segment of the new address.
If it is a city's slug in the page's market, the page is filed under that
city (`cityId`), and the page at the city's own address becomes its landing
page (`isCityHomepage`). Moving a page out of the space takes it out of the
city. The city is derived from the address in the one place every address
change passes, so it can never disagree with it.

### What the city's address space refuses

The city namespace is enforced by the URL registry, not by a second conflict
system:

- **Giving a city a slug** (creating or renaming it) is refused while the
  slug is a system route (`/admin`, `/api`, …), a market prefix, the address
  space of a content type (`/products`, `/blog`, `/categories`, `/brands` —
  saved patterns and the built-in ones), another city's slug in the market,
  or while anything that is not the city's own holds the city's address or
  content beneath it — pages, products, articles, redirects, anything in the
  URL registry, and pages the registry has not scanned yet. The error names
  the address and what holds it: “`/delhi` is already used by page “Delhi
  offers”. Choose another slug, or move what is there first.” The form checks
  the slug as it is typed; saving checks again under the registry lock.
- **Placing anything but a plain page** in a city's space — a product, an
  article, a category or brand landing page — is refused, even at a free
  address, so the space stays the city's pages alone.
- **A market prefix** cannot be created with the slug of a root-market city.

Redirects *beneath* a city's address are left alone: they are explicit rules
for single addresses, and the city's pages simply cannot take those addresses
while the rules exist (the generator reports them).

The Slug Manager marks every city page (“City: Delhi”), and a conflict held by
a city links to that city.

## Status

One switch, the city's **status**, with the city form's Status field and the
list's row actions:

| Status | Public | Sitemap | Listed |
| --- | --- | --- | --- |
| **Draft** (new cities start here) | No: every page in the city answers 404 — including through redirects to them — and leaves hreflang. | No | Yes |
| **Published** | Each page by its own status: a published page is served. | Published, indexable pages, unless the city is noindexed or excluded | Yes |
| **Archived** | No, exactly like a draft. | No | Only under the *Archived* filter |

Nothing is deleted by any of them, and another city's or market's content is
never served instead. Publishing a city — from draft or archive — needs
`pages.publish`; drafting and archiving need `pages.edit`.

Two more switches refine a published city:

| Switch | Effect |
| --- | --- |
| `noIndex` | Every page in the city sends noindex, and leaves the sitemap. |
| `excludeFromSitemap` | Pages stay indexable but are not listed in the sitemap. |

All of this is applied where every public page query already goes:
`publishedPageWhere()` (served), `indexablePageWhere()` (hreflang) and
`listedPageWhere()` (sitemap) in `src/lib/services/pages.ts`, which read the
derived `isActive`/`isPublished` flags (both true only for a published city).

## The landing page

One per city, at the city's own address, an ordinary page. It can be created
with the city (“Create the city's landing page”, with a title that may use
placeholders — “Autodesk reseller in {{city}}” — and the business name is
never assumed) or later from the city's
screen. It starts as an empty draft; build it in the Page Builder and publish
it like any page. Deleting it is deleting a page.

## The City Page Generator

Admin → Locations → City Page Generator (`/admin/cities/generator`).

1. Choose the market, a **source page** of that market (outside every city),
   and the **cities**.
   Optionally choose a **product**, for city/product pages: each generated
   page is then recorded as that city's page for the product (`CityProduct`),
   and `{{product}}` is filled in.
2. **Impact preview**: each city's address (`/delhi/autocad`), the generated
   title, and whether it will be created, already exists (kept) or is taken
   by something else (fails, with what holds it). An existing page shows its
   status, whether it came from this source, and whether it was **edited
   since it was generated** (exact: its content fingerprint no longer matches
   what the generator wrote). Nothing is written.
3. **Generate**: for each city, one transaction under the registry lock
   creates the page, copies every section and registers the address. A
   failure in one city rolls back only that city — never a page without its
   sections — and the others continue. The screen sends large runs in parts
   of 25 cities, each continuing the same batch, with progress. The summary
   lists Created / Regenerated / Skipped existing / Failed with the reason.

Running the generator again is idempotent: a city that already has the page is
skipped.

### Regenerating an existing page

Only ever an explicit choice: tick **Regenerate this page** on a city's row in
the impact preview, read what it replaces (title, search fields and every
section; edits made since generation; whether the new content goes public at
once because the page is published), and confirm with the checkbox before
**Generate**. The server refuses a regeneration without that confirmation, and
needs `pages.edit` (and `pages.publish` when a regenerated page is published).
The page keeps its id, address, status and publication date; the content it
held is kept in the run's record (`CityPageBatch.results[].previous`). Every
city not ticked is left exactly as it is.

Slugs: `autocad` → `delhi/autocad`; `solutions/autocad` →
`delhi/solutions/autocad`; the market homepage → `delhi` (the landing
page, when the city has none). Never with the market prefix.

Generated pages are **always drafts**. Pages that differ only by a city's name
help nobody, so the generator never mass-publishes: each copy is reviewed,
given what is genuinely local — and only what is true; nothing invents
offices, addresses, testimonials, certifications or authorisations — and
published on its own. Their canonical is their own address, and each is its
own page group (not the source's twin in another market). SEO Intelligence
flags copies that stay substantially similar to each other.

### Placeholders

Filled in **once**, when each copy is made, in the title, the SEO fields
(title, description, Open Graph, Twitter, keywords) and every string inside
every section:

| Placeholder | Value |
| --- | --- |
| `{{city}}` | The city's name (same as `{{city.name}}`) |
| `{{region}}` | The city's region, or nothing (same as `{{city.region}}`) |
| `{{country}}` | The market's name (same as `{{country.name}}`) |
| `{{product}}` | The chosen product's name, or nothing (same as `{{product.name}}`; also `{{product.slug}}`) |
| `{{city.name}}` | The city's name |
| `{{city.slug}}` | The city's slug |
| `{{city.region}}` | The city's region, or nothing |
| `{{country.name}}` | The market's name |
| `{{country.code}}` | The market's code |
| `{{page.title}}` | The source page's title (its own placeholders filled) |
| `{{page.slug}}` | The source page's slug |

Replacement walks the stored JSON value by value and only touches strings —
never keys, numbers or structure, and never by serialising the document and
replacing text in it. Unknown placeholders are left as they are.

**Optional values that are empty disappear cleanly**, with the separator that
was only there for them: “Autodesk reseller in {{city}}, {{region}}” gives
“Autodesk reseller in Gurugram, Haryana” and “Autodesk reseller in Delhi” — never
“Delhi, ”. Brackets (“{{city}} ({{region}})”), commas, semicolons, dashes and
bars are handled the same way. City names
and regions cannot contain `< > { } " \`` so they are safe wherever they land.

### Independent editing — the guarantee

A generated page is a new `Page` with new `PageSection` rows. The provenance
fields record where it came from, and **nothing reads them to copy anything**:
there is no sync, no inheritance and no re-render. Editing the source never
changes a city page; editing a city page never changes the source or another
city. Running the generator again skips cities that already have the page and
never overwrites one unless it is explicitly chosen for regeneration.

## City/product pages

Future pages such as `/delhi/autocad` and `/gurugram/revit` are ordinary pages
in the city's space. What makes one *the* city's page for a product is an
explicit `CityProduct` row (city id, product id, page id) — written when the
generator runs with a product chosen — never the shape of its address:
`/delhi/autocad` is just a page unless that row says otherwise, and no
city/product combination is ever created, let alone published,
automatically. One page per product per city: a second is refused. The city
screen lists its product pages; removing an association leaves the page
untouched.

## Bulk import

Cities → **Import cities**: a CSV with `Name` and `Country` (ISO code, name or
URL prefix), and optional `Slug` (follows the name when blank), `Region` and
`Status` (DRAFT unless the file says PUBLISHED or ARCHIVED; publishing needs
`pages.publish`):

```
Name,Slug,Country,Region,Status
Delhi,delhi,IN,,DRAFT
Gurugram,gurugram,IN,Haryana,DRAFT
Dubai,dubai,AE,,DRAFT
```

Every row is validated before anything is written — name, market access,
status, slug, duplicates in the file, and the slug's whole address space in
the URL registry — and the preview says what each row will do. Import only
ever **creates** cities: one that exists is reported and left exactly as it
is, so a file can be run again and a part that failed retried without
duplicating anything. Cities are created in parts of 25 with progress, each in
its own transaction under the registry lock; optionally each gets an empty
draft landing page with a templated title.

## Initial cities

The seed step `prisma/seed/pages-cities.ts` (also part of the demo seed) adds
Delhi and Gurugram (Haryana) in the root market and Dubai in the UAE — `/delhi`,
`/gurugram`, `/ae/dubai` — as **drafts**, each with a draft landing page titled
“Autodesk reseller in …” whose copy names the city and nothing else. Existing
cities and pages are never changed. Run a URL scan afterwards so the registry
knows the new pages, then build and publish them when they are ready.

## Search (SEO, AEO, GEO)

City pages are ordinary pages to SEO Intelligence: the same scoring engine,
the same dashboard (with a **City** filter), the same score panel in the
editor. What a city contributes, resolved by one function
(`src/lib/cities/seo.ts`) for both the public page and its score:

- **title** — the city's SEO title, for the **landing page only**, when the
  page has none of its own (on other pages it would duplicate one title
  across the city);
- **description** — the city's, for any city page without its own, before the
  market's default;
- **keywords** — the city's, for the landing page only, when it names none;
- **noindex** — the city's switch, for every page in the city.

The chain is **Page → City → Country → Global**: a page's own field always
wins, and the market's and the site's defaults still apply after the city.
There are no automatic keyword variations.

Sitemap: a city page is listed when it is published and not noindexed, and
its city is published, not noindexed and not excluded — on top of the
market's own rules, with the market prefix kept.

## Local business details

A city's sales phone, WhatsApp number, sales email, address and coordinates
are shown on its pages — in the footer and in the Organization/LocalBusiness
structured data — instead of the market's. Blank fields fall back to the
market's, and the market's to the site's, when the page is rendered; nothing
is copied into rows. An address is taken as a whole, coordinates only as a
pair (`src/lib/cities/local.ts`).

## Products

Products are unchanged: `Product → ProductCountry` per market, no per-city
product or price. City pages show products at their market's prices.

## Permissions

The page permissions, plus market access, checked on the server against the
records as loaded — never against ids in a request:

| Action | Needs |
| --- | --- |
| See cities and the generator's history | `pages.view` |
| Add or import cities, create a landing page, preview and generate | `pages.create` |
| Edit a city, move it back to draft, archive it, regenerate an existing page, remove a product association | `pages.edit` |
| Publish a city (from draft or archive), import a published city, regenerate a published page | `pages.publish` |
| Delete a city | `pages.delete` |

A user restricted to some markets cannot see, edit, generate for or delete a
city in any other. A city never moves to another market.

## Deleting a city

Only a city without pages can be deleted. The list shows each city's page
count; deleting one with pages is refused with the count and offers to
archive it instead. Pages in the recycle bin leave the city when it is
deleted; restoring one later brings it back as an ordinary page. Deleting a
market deletes its cities with its pages.

## Markets and cities

- Copying a market's content (**Countries → Sync**, `npm run market:clone`)
  leaves city pages out: a city belongs to one market.
- Copying a single page to another market (**Copy to country**) still works
  for any page.

## Admin screens

- **Locations → Cities** (`/admin/cities`): search, country and status
  filters, pagination; city, country, region, URL, pages, landing page and its
  SEO score, status (archived cities under their own filter); counts of
  published, draft and archived cities and of city pages; edit, edit/open the
  landing page, view pages, generate, publish, back to draft, archive,
  restore, delete; **Import cities**.
- **New city / edit city**: country, name, slug (checked as typed), optional
  region, status, sort order, local business details, search defaults,
  noindex, sitemap exclusion, and the optional landing page. The edit screen
  lists the city's pages with links to edit, preview and their SEO analysis
  (with the latest score), and its product pages.
- **Locations → City Page Generator**.
- **Pages** list: City filter and a city badge; the page editor says which
  city a page belongs to and where it was generated from.

## Where the code is

| Concern | Code |
| --- | --- |
| Schema and migration | `prisma/schema.prisma`, `prisma/migrations/20260930120000_cities`, `prisma/migrations/20261007120000_city_status_products_redirect_suffix` |
| Status | `src/lib/cities/status.ts` |
| Bulk import | `src/lib/cities/import.ts`, `src/components/admin/cities/city-import-dialog.tsx` |
| Initial cities | `prisma/seed.ts` (`seedCities`), `prisma/seed/pages-cities.ts` |
| Namespace rules | `src/lib/urls/registry.ts` (`placeContent`, `checkAvailability`, `prefixConflict`), `src/lib/urls/cities.ts` |
| Actions | `src/lib/actions/cities.ts` |
| Rename and landing page | `src/lib/cities/manage.ts` |
| Generator | `src/lib/cities/generator.ts`, `src/lib/cities/template.ts`, `src/lib/cities/paths.ts` |
| Validation | `src/lib/validation/city.ts` |
| Public liveness and sitemap | `src/lib/services/pages.ts`, `src/lib/seo/sitemap.ts` |
| SEO and local details | `src/lib/cities/seo.ts`, `src/lib/cities/local.ts`, `src/app/(public)/_surfaces/cms-page.tsx`, `src/app/(public)/layout.tsx`, `src/lib/seo/intelligence/documents.ts` |
| Admin | `src/app/admin/cities`, `src/components/admin/cities` |
| Tests | `tests/unit/cities.test.ts`, `tests/integration/cities.test.ts`, `tests/integration/city-permissions.test.ts` |

## Limitations

- The city's SEO title is used by its landing page only; other city pages
  rely on their own titles (the generator fills them per city).
- A city page's breadcrumb is `Site → Page`; the city level is not added.
- Products have no per-city availability or pricing, by design.
- Renaming a city with many pages moves them in one transaction (up to two
  minutes); very large cities are better renamed outside peak hours.
- Regenerating a page keeps what it held in the run's record
  (`CityPageBatch.results`), but there is no one-click undo: restore it by
  hand from that record, or choose not to regenerate an edited page.
- A `CityProduct` association records which page is a city's page for a
  product; it does not add per-city prices, stock or product variants.
