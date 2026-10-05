# Changelog

All notable changes to this application. The version here is the **application
version** — see [VERSION_README.md](./VERSION_README.md) for what that is, how
to move it, and why it is not the same thing as a consent notice version.

This project uses [semantic versioning](https://semver.org): MAJOR.MINOR.PATCH.

---

## [Unreleased]

### Added

- **Leads are sent to the Deskzo CRM.** Every lead captured on the site — and
  every one staff add by hand — is pushed to Deskzo's lead capture API from the
  server, with its company, designation, product, page and UTM tags. A lead the
  CRM cannot take straight away is retried with backoff instead of lost, and
  this site's lead id goes as `external_id`, so a retry never makes a second
  CRM lead. Each lead shows its CRM status and reference, and
  **Settings → CRM Integration** tests the key, shows the queue, retries
  failures and can send the leads captured before. Configured with
  `DESKZO_KEY_ID` and `DESKZO_SECRET`; retries run on
  `POST /api/internal/cron/crm-sync`. See
  [docs/CRM-INTEGRATION.md](./docs/CRM-INTEGRATION.md).

### Fixed

- **Deleting a product from one market deleted it from every market.** The
  product screen is country-scoped, but delete set the global `Product.deletedAt`
  — so removing a plan from the UAE catalogue removed it from India and Qatar
  too, without anyone there being asked. Deletion is now a withdrawal from one
  market: `ProductCountry.deletedAt` archives that market's configuration, and
  the shared product row is only retired once no market offers it. Bulk delete
  was the same bug at twenty times the scale and is fixed the same way.

- **Deleting a category or brand from one market deleted it everywhere.** The
  taxonomies are shared rows, so a country screen's delete removed the row
  everybody used. Three new availability tables — `ProductCategoryCountry`,
  `PageCategoryCountry`, `BrandCountry` — record which markets offer what, and a
  country-scoped removal now deletes one availability row. The shared row is
  removed only when no market offers it at all.

- **`/admin/products` listed the global catalogue**, so a UAE administrator saw
  and could delete India's products. It now lists the market being worked in,
  and the Status, Featured, price and currency columns read that market's own
  configuration rather than the global product's.

### Changed

- **The country sync is add-only.** `UPDATE_EXISTING` is gone from the interface
  and from the engine. Content a market already has is skipped however much it
  has been edited; content a market imported and then deleted stays deleted;
  content only that market has is untouched; and deleting something in India
  never touches a copy already synced elsewhere.

- **Manually deleted content is no longer resurrected.** `CountrySyncMapping`
  gains `deletedInTargetAt`. When a run finds a previously imported copy gone it
  records a tombstone and reports *"Previously imported but manually removed from
  this country"*; every later run reaches the same conclusion. The mapping has no
  foreign key to the row it points at, which is what lets the tombstone outlive
  the deletion.

- **The sync allowlist covers the rest of a market's website**: page categories,
  product categories, brands, forms, products, pages, page sections, menus and
  popups, in dependency order. Menu links are remapped to the target market's own
  pages, and a link whose page was not imported is dropped rather than left
  pointing at India.

- **Canonical URLs are no longer carried across.** A copied `canonicalUrl` named a
  URL on India's site, which tells search engines the target market's page is a
  duplicate that need not be shown. The field is left empty so each market's own
  canonical generator answers for it.

- **Every non-default market gets a "Sync from India" button** on Settings →
  Countries; the default market never does. The source is resolved server-side
  from the default-country configuration and is never taken from the browser, so
  no request can ask for UAE → Qatar.

- Preview and result both break down by content type, name what was left removed,
  and show failures rather than swallowing them. Delete confirmations name the
  market: *"Remove this product from UAE?"*, with a line saying other markets are
  unaffected.

- Mapping and target lookups are batched per entity kind rather than issued per
  item, so a market with hundreds of imported records costs one query instead of
  hundreds.

### Database

Additive migration `20260916150000_country_content_isolation`. No data is reset,
dropped or rewritten:

- `ProductCountry.deletedAt` + an index on `(countryId, deletedAt)`
- `CountrySyncMapping.deletedInTargetAt`
- `ProductCategoryCountry`, `PageCategoryCountry`, `BrandCountry`
- `Form.offerMarketingConsent` default changed to `false`

Backfill grants every existing market exactly what it can see today, so the admin
screens and the public site are unchanged the moment it lands. Products already
deleted globally have their market configurations marked to match, so the change
of meaning does not bring products back into storefronts that had removed them.

---

## [1.1.0] — 2026-09-16

### Fixed

- **Public forms could not be submitted at all on a site with no consent notice
  published.** Every submission was rejected with *"That submission could not be
  read. Please try again."* on a correctly filled form. `getCurrentNotice`
  returns version `0` for the wording built into the application, which is the
  state of every deployment until an administrator publishes a notice — and
  nothing seeds one. The page sent that `0` back as the version it had shown,
  the submission schema required `1` or more, and because the consent object
  travels inside the submission envelope, rejecting one field failed the whole
  envelope. Version `0` is now `BUILT_IN_NOTICE_VERSION`, an explicit, valid
  version that every layer accepts and records; published notices still start at
  `1`, so the two can never be confused.

- **Tick boxes could be read as accepted when they were not.** Checkbox values
  went through `z.coerce.boolean()`, which reads the string `"false"` as `true`
  because it is a non-empty string. Ticks are now read only from the tokens a
  checkbox actually posts.

- **Publishing a country-specific consent notice deactivated every other
  market's.** "Current" was scoped by notice key alone, so publishing UAE
  wording silently left India — and every market falling back to the shared
  notice — with no live notice at all. It is now scoped by key *and* market.
  Version allocation retries when two administrators publish at once, instead of
  failing in front of whoever was second.

- **A failed submission could leave the submit button stuck.** An error that was
  not a rejected submission — a dropped connection, a deploy mid-request — left
  the promise rejected and `pending` never cleared, so the button read
  "Sending…" indefinitely with no error shown. Submission is now wrapped, with
  the pending state cleared in `finally`. Filled inputs are preserved either
  way.

- Publishing a notice now revalidates public pages, not just the admin screen.

### Changed

- **One consent tick box per public form**, replacing the separate enquiry,
  marketing and Terms boxes. The wording it covers is written out beneath it,
  and the label is editable per form in Admin → Forms → *a form* → Settings.
  Behind it, enquiry, marketing and Terms are still recorded **separately**:
  each is derived from the box being ticked **and** from that purpose actually
  appearing in what was displayed, so a purpose that was not on screen can never
  be recorded as agreed.

- **Marketing wording may be left empty.** Clearing it in Admin → Leads & CRM →
  Consent notice is a decision, not a gap: no form asks for marketing consent,
  nothing renders, and no blank line or empty container is left behind. The
  built-in wording applies only while no notice has been published, and never
  overrides an intentionally empty saved value. Offering marketing now requires
  both the form's setting **and** non-empty published wording.

- **Marketing can never ride on a required tick box.** A form whose tick box is
  mandatory (lawful basis Consent, or Terms acceptance required) cannot also
  offer marketing in it — that would make marketing a condition of getting a
  reply. Saving that combination is refused with a message naming the switch to
  change, and any form that already holds it has marketing dropped from display
  and recorded as not presented.

- The Leads consent panel and export distinguish marketing **not offered** from
  **offered and declined**, rather than flattening both to "no". New export
  columns: `marketing_state`, `consent_notice_scope`, `consent_label_shown`.

### Added

- **Admin → Settings → Application information**: application name, running
  version, release date and build commit, all read-only and compiled into the
  build.

- `npm run release -- patch|minor|major` — moves `package.json`,
  `package-lock.json`, `CHANGELOG.md` and `VERSION_README.md` together. It does
  not commit, tag, push or deploy.

- [VERSION_README.md](./VERSION_README.md) and this changelog.

### Database

Additive migration `20260916120000_combined_consent_checkbox`. Four nullable
columns, no backfill, no data rewritten:

- `Form.consentCombinedLabel`
- `ConsentRecord.marketingPresented`, `.displayedLabel`, `.noticeScope`

Existing consent records read "not recorded" for anything that did not exist
when they were written. Nothing is reinterpreted as having accepted the new
combined wording.

---

## [1.0.0]

Initial release: public site, CMS, CRM, multi-country routing, consent capture,
SEO and content sync.
