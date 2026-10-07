# Versioning

**Current release:** `1.2.0` — released 2026-10-07

Everything about how this application is versioned: where the number lives, how
Settings reads it, how to move it, and what it is *not*.

---

## Contents

- [Where the version lives](#where-the-version-lives)
- [How Settings reads the running version](#how-settings-reads-the-running-version)
- [Moving the version](#moving-the-version)
- [Before a release](#before-a-release)
- [Deploying so the new version appears](#deploying-so-the-new-version-appears)
- [Application version vs consent notice version](#application-version-vs-consent-notice-version)
- [This release](#this-release)

---

## Where the version lives

**`package.json` is the single authoritative source.**

```json
{
  "version": "1.1.0",
  "release": { "date": "2026-09-16" }
}
```

One file, changed by one command, and the same file npm itself versions — so
`package.json` and `package-lock.json` cannot drift.

There is deliberately **no database field** for the version. A settings row can
be edited to claim any version at all, including one that is not running, and a
version display that can be wrong answers "what did somebody type?" rather than
"what is deployed?". Nothing in the admin can change these values.

`release.date` sits beside the version in the same file for the same reason: one
command moves both, and neither can be updated without the other.

---

## How Settings reads the running version

`next.config.mjs` reads `package.json` at **build time** and inlines three
constants into the build:

| Constant | From |
|---|---|
| `APP_VERSION` | `package.json` → `version` |
| `APP_RELEASE_DATE` | `package.json` → `release.date` |
| `APP_BUILD_COMMIT` | the first of `BUILD_COMMIT`, `SOURCE_COMMIT`, `GITHUB_SHA`, `COOLIFY_COMMIT_SHA`, `VERCEL_GIT_COMMIT_SHA`, else `git rev-parse` in a checkout |

`src/lib/app-version.ts` reads them back, validates the version against
`MAJOR.MINOR.PATCH` and the date against `YYYY-MM-DD`, and reports `unknown` or
`Not recorded` rather than guessing. **Admin → Settings → Application
information** renders them read-only.

Because they are compiled in, "Settings says 1.1.0" and "1.1.0 is the running
build" are the same statement. They change only when a new image is built:
never on a CMS save, a consent edit, a settings change, a container restart, or
a rebuild of the same release.

> `.git` is excluded from the Docker build context, so the build commit in a
> container comes from a build argument or a CI variable, not from git. If your
> builder sets none of the names above, pass `BUILD_COMMIT` and the field is
> populated; otherwise it reads *"Not supplied by the builder"*, which is
> honest rather than blank.

---

## Moving the version

```bash
npm run release -- patch      # 1.1.0 -> 1.1.1   a fix, no behaviour change
npm run release -- minor      # 1.1.0 -> 1.2.0   new behaviour, compatible
npm run release -- major      # 1.1.0 -> 2.0.0   a breaking change
npm run release -- 1.4.2      # an exact version
npm run release -- minor --dry-run   # print what would change, write nothing
```

Which one:

| Bump | Use it for |
|---|---|
| **patch** | A bug fix that changes no behaviour anyone relies on. |
| **minor** | New behaviour that does not break an existing deployment — a new admin screen, a new field, a new block. |
| **major** | Anything an existing deployment has to be changed to survive: a removed setting, a renamed route, a migration that is not backward compatible. |

The command updates four files:

- `package.json` — `version` and `release.date`
- `package-lock.json` — via `npm version`, so the two stay in step
- `CHANGELOG.md` — renames the `## [Unreleased]` heading to the new version
- `VERSION_README.md` — the **Current release** line at the top

It **does not** commit, tag, push or deploy. A release is a decision; the script
only writes the files that record it, so it lands in a diff and is reviewed like
any other change.

---

## Before a release

1. Write the entries under `## [Unreleased]` in `CHANGELOG.md` as you work, so
   the release step is a rename rather than an archaeology exercise.
2. Run the checks: `npm test`, `npm run typecheck`, `npm run lint`,
   `npm run build`.
3. Confirm any new migration is additive and applies cleanly to a copy of
   production (`npm run db:rehearse`).
4. Run `npm run release -- <bump>`.
5. Fill in the new changelog heading if anything is missing.
6. Commit: `git commit -m "Release <version>"`.
7. Tag and push if you tag releases — the script does neither on purpose.

---

## Deploying so the new version appears

Settings reads the version from the **build**, so a new version appears only
after a new image is built and running:

```bash
# 1. Build the image from the committed release
docker build -t dropbox-reseller:1.2.0 --build-arg BUILD_COMMIT=$(git rev-parse --short=12 HEAD) .

# 2. Apply migrations (additive; it neither resets nor deletes anything)
npx prisma migrate deploy

# 3. Start the new image
```

On Coolify or another PaaS, a redeploy from the commit does the same thing;
`prisma migrate deploy` runs on boot (`instrumentation.ts`, `migrationsOnBoot`).

Pulling the code without rebuilding does **not** change what Settings shows, and
that is the intended behaviour: it reports what is running, not what is in the
repository.

---

## Application version vs consent notice version

Two numbers, unrelated, easy to confuse:

|  | Application version | Consent notice version |
|---|---|---|
| **What it counts** | Releases of the software | Published versions of the consent wording |
| **Where it lives** | `package.json`, compiled into the build | `ConsentNotice.version` in the database |
| **Who moves it** | A developer, via `npm run release` | An administrator, by publishing wording in Admin → Leads & CRM → Consent notice |
| **Where it is shown** | Admin → Settings → Application information | Against each lead, in Consent & privacy |
| **Starts at** | `1.0.0` | `1` — with `0` reserved for the wording built into the application, used until something is published |
| **Changes on a CMS edit?** | No | Only when a notice is published |
| **Changes on a deploy?** | Yes, if the release changed | No |

A lead reading *"default — built-in wording"* was captured while no notice had
been published; version `0` is a real, valid version and not a draft. See
[docs/CONSENT-AND-PRIVACY.md](./docs/CONSENT-AND-PRIVACY.md).

---

## This release

**1.2.0 — 2026-10-07.** Full detail in [CHANGELOG.md](./CHANGELOG.md).

- **Slug & URL Manager** and the **URL registry**: one owner per public
  address, custom address → country pattern → global pattern, automatic 308
  redirects straight to content by id, conflicts, history, URL Health.
  See [docs/URL-REGISTRY.md](./docs/URL-REGISTRY.md).
- **Redirects → Import CSV** (`URL,Destination URL`) with whole-graph
  validation, explicit conflict decisions and resumable batches.
- **Cities** with Draft / Published / Archived status, bulk import, the City
  Page Generator (drafts only, `{{city}}`/`{{country}}`/`{{region}}`, explicit
  regeneration) and explicit city/product associations.
  See [docs/CITIES.md](./docs/CITIES.md).
- **SEO Intelligence**: SEO, AEO and GEO scorecards with a documented,
  versioned rule engine. See [docs/SEO-INTELLIGENCE.md](./docs/SEO-INTELLIGENCE.md).
- The country-isolation fixes listed under 1.2.0 in the changelog.

Upgrade: deploy (migrations run on start), run the URL scan, review
Conflicts, switch the registry on, then *Recalculate all* in SEO Intelligence.

### Verification

| Check | Result |
|---|---|
| `npm test` | 1,358 passed, 90 files (PostgreSQL 16) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | succeeded |
| Migrations | applied to an empty database and to a seeded one; `migrate diff` shows only the pre-existing `CountrySettings` drift, deliberately not dropped |
| URL scan | dry run and real run agree; a second run registers nothing; no address moves |
| HTTP — before switching on | existing pages, products and articles 200; `/pricing/` 308 → `/pricing` |
| HTTP — `/products/autocad` → `/autocad` → `/software/autocad` | every earlier address 308 straight to `/software/autocad`, query kept; `/ae/products/autocad` 308 → `/ae/autocad` |
| HTTP — redirect CSV | 4 rows written, content address and loop refused; `Location` keeps `?edition=lt#pricing` |
| HTTP — cities | published `/delhi` 200, `/delhi/` 308; draft `/gurugram`, `/ae/dubai`, draft pages 404; sitemap lists only published, indexable pages |
| Canonical / hreflang / JSON-LD | the same registry URL in each; hreflang only for real equivalents; no keywords meta tag |
| Browser — admin | switch on, pattern preview/apply, drawer, CSV import, city publish, generator with product and confirmed regeneration, SEO dashboard and analysis; no page errors |
| Browser — 390px and dark theme | no horizontal overflow on any new screen |
| `scripts/smoke.mjs` | 76/81: `/products/...` and the sitemap checks fail because the verification moved products to `/{slug}` and the sitemap is an index (both stale checks); two admin text checks (Settings, Staff) fail on screens this release does not change |
