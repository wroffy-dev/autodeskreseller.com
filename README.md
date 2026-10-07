# Dropbox Reseller Platform

A production-ready website, CMS and CRM for a Dropbox reseller. The public site
is entirely content-managed: pages, products, blog posts, navigation, branding,
SEO and tracking are all edited from the admin panel, with no code changes and
no redeploy.

**Version 1.2.0** — see [CHANGELOG.md](./CHANGELOG.md) for what changed and
[VERSION_README.md](./VERSION_README.md) for how releases are versioned and
deployed. The running version is shown in Admin → Settings → Application
information.

---

## Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database and migrations](#database-and-migrations)
- [Seeding and the first administrator](#seeding-and-the-first-administrator)
- [Running the tests](#running-the-tests)
- [Production build](#production-build)
- [Docker](#docker)
- [Deploying with Coolify](#deploying-with-coolify)
- [Deploying to Microsoft Azure](#deploying-to-microsoft-azure)
- [File storage: local, S3 and Cloudflare R2](#file-storage-local-s3-and-cloudflare-r2)
- [Backup and restore](#backup-and-restore)
- [URLs, slugs and redirects](#urls-slugs-and-redirects)
- [SEO Intelligence](#seo-intelligence)
- [Forms](#forms)
- [Email and SMTP](#email-and-smtp)
- [Marketing and tracking](#marketing-and-tracking)
- [Adding a new CMS block](#adding-a-new-cms-block)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Countries](docs/MULTI-COUNTRY.md)
- [Cities](docs/CITIES.md)
- [URL registry and Slug & URL Manager](docs/URL-REGISTRY.md)
- [SEO Intelligence](docs/SEO-INTELLIGENCE.md)
- [Admin design system](docs/ADMIN-DESIGN-SYSTEM.md)
- [Versioning and releases](VERSION_README.md)
- [Changelog](CHANGELOG.md)

---

## What it does

**Multiple countries, one application**
- India is served from the site root and the UAE from `/ae/`, each with its own
  pages, articles, menus, pricing, contact details, SEO and leads — sharing one
  brand, one media library and one product catalogue.
- Adding a country is a database row plus its content: routing, settings,
  pricing and SEO all read the `Country` table, so no route, component or
  deployment changes. Full reference:
  **[docs/MULTI-COUNTRY.md](docs/MULTI-COUNTRY.md)**.

**Cities inside a market**
- Local landing pages at `/delhi`, `/gurugram` and `/ae/dubai` — and later
  city/product pages such as `/delhi/autocad` — each an ordinary page built in
  the Page Builder. A city is a draft, published or archived; cities can be
  imported from a CSV. The City Page Generator copies a page into many cities
  as drafts, filling `{{city}}`, `{{region}}` and `{{country}}`; every copy is
  independent from the moment it exists, and regenerating one is an explicit,
  previewed choice. Full reference: **[docs/CITIES.md](docs/CITIES.md)**.

**SEO Intelligence**
- SEO, AEO and GEO scores (0–100, overall 50/25/25) for every page, product
  market, article, archive and city page, with prioritised fixes, filters by
  country, type, score, severity and audit status, and stale-result detection.
  Deterministic and versioned; AEO and GEO are internal content-readiness
  assessments. Full reference:
  **[docs/SEO-INTELLIGENCE.md](docs/SEO-INTELLIGENCE.md)**.

**Public website**
- Every page — the homepage included — is a database row built from ordered CMS
  sections. Nothing is hardcoded: 23 block types ship in the box and the same
  catch-all route renders all of them.
- Product pages, a blog with categories, tags, search and pagination.
- Metadata, canonical URLs, Open Graph, Twitter cards, JSON-LD (Organization,
  WebSite, Product, Article, FAQ, Breadcrumb), `sitemap.xml` and `robots.txt`
  are all generated from the content.
- Colours, fonts, logos and navigation come from the database, so the whole
  look changes from the admin panel.

**Page builder**
- Drag-and-drop section ordering, plus duplicate, hide, show, move up/down and
  delete. Hiding a section keeps it in the page without publishing it.
- Every section gets the same Design panel: margin and padding per side in
  px/%/rem/em/vw/vh, width and min-height, row/column/content/card gaps,
  solid/gradient/image backgrounds with overlay, a full colour set with picker
  and hex, and an anchor ID validated to be unique on the page.
- Design values can be set independently for desktop, tablet and mobile, and
  inherit downwards when left blank.
- Preview any page at desktop, tablet and mobile widths before publishing;
  drafts never reach the public site.

**Lead capture**
- There is no checkout. Product buttons open the configured lead form, and each
  submission records the product, page, button label, referrer and both
  first-touch and last-touch UTM parameters.
- Forms are built in the admin: text, email, phone, number, textarea, dropdown,
  radio, checkbox, date, URL, hidden and consent fields, each with validation,
  help text, default value, duplicate and drag-to-reorder — plus success
  message, redirect and notification recipients. Any active form can be dropped
  into a hero, a section, a product button or a popup.

**CRM**
- Lead list with search, filters, bulk actions and CSV export.
- Kanban pipeline with drag-and-drop between stages.
- Notes, an activity timeline, assignment with email notification, and
  conversion of a won lead into a customer.
- Reports by date, source, campaign, product and landing page.

**Administration**
- Role-based access control checked on the server for every action.
- Media library, audit log, staff management, popups and lead magnets.
- Products with categories, brands, drag-and-drop catalogue ordering and a
  separate featured order — any number of products can be featured.
- Global design settings: searchable Google Font pickers for body, heading,
  navigation and button text, weights, sizes, line height and letter spacing,
  plus container width, section spacing, radii and button styling. Only the
  fonts and weights actually selected are downloaded by the site.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, React Server Components) |
| Language | TypeScript, strict mode |
| Styling | Tailwind CSS with runtime CSS variables for branding |
| Database | PostgreSQL 16 |
| ORM | Prisma 6 — `Decimal` for every monetary value |
| Auth | Auth.js (NextAuth v5), credentials provider, JWT sessions |
| Validation | Zod, on the server for every mutation |
| Storage | Pluggable: local filesystem, S3, or Cloudflare R2 |
| Email | Nodemailer over SMTP, configured from the admin panel |
| Tests | Vitest (unit + integration) plus an HTTP smoke suite |

---

## Local setup

**Requirements:** Node.js 22+, PostgreSQL 16+.

```bash
git clone <repository-url>
cd dropbox-reseller
npm install

cp .env.example .env
# Fill in DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY and the seed admin details.

npx prisma migrate deploy
npm run db:seed

npm run dev
```

The site runs at <http://localhost:3000>. Sign in at
<http://localhost:3000/auth-control-panel/admin>, which is the only way in —
the admin does not advertise itself.

**The sign-in screen is not on `/login`,** because `/login` is the first path
a credential-stuffing bot tries. Its path is defined once, as `LOGIN_PATH` in
`src/lib/auth/routes.ts`, and every guard, sign-out and script reads it from
there — so moving it again is a one-line change plus renaming the matching
directory under `src/app`. `/login` itself 404s.

**`/admin` 404s when you are signed out,** rather than redirecting to the
sign-in screen. A redirect would put that screen's path in a Location header,
which would hand it to anything that probed `/admin` and undo the move
entirely. `/preview` and the two-step screens answer the same way, for the
same reason. So bookmark the sign-in URL: signed out, nothing else leads to
it.

Generate the two secrets with:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
```

### Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Generate the Prisma client and build for production |
| `npm start` | Start the production server (see the note under [Production build](#production-build)) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Vitest — unit and integration |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply existing migrations (production) |
| `npm run db:seed` | Seed roles, permissions, the admin and demo content |
| `npm run db:studio` | Prisma Studio |
| `npm run db:rehearse` | Rehearse pending migrations against a restored production dump |
| `npm run urls:backfill` | Register every public address in the URL registry (`-- --dry-run` to report without writing) |
| `./scripts/smoke.sh` | Boot the production build and run the HTTP smoke suite |

---

## Environment variables

`.env.example` is the authoritative list. The essentials:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session tokens. At least 16 characters |
| `ENCRYPTION_KEY` | recommended | Encrypts the stored SMTP password. Falls back to `AUTH_SECRET` |
| `NEXTAUTH_URL` | yes in production | The deployment's public URL — the address visitors end up on after any redirect |
| `NEXT_PUBLIC_SITE_URL` | yes in production | Used for canonical URLs, the sitemap and email links. Same value as `NEXTAUTH_URL`: if the bare domain redirects to www, both are `https://www.…` |
| `STORAGE_DRIVER` | no | `local` (default), `s3` or `r2`. Nothing else is needed for `local` |
| `UPLOAD_DIR` | no | Where `local` writes. Default `/data/uploads`. Must be a persistent volume |
| `MEDIA_PUBLIC_PATH` | no | URL prefix media is served under. Default `/media` |
| `MAX_UPLOAD_SIZE_MB` | no | Upload size cap. Default 150 KB; `.env.example` ships 10 MB |
| `SMTP_*`, `MAIL_FROM` | no | Bootstrap SMTP. Admin → Settings → Email overrides these |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed only | The first administrator |
| `SEED_DEMO_CONTENT` | no | `false` skips the demo pages, products and posts |

Never commit a real `.env`. `.gitignore` already excludes it.

---

## Database and migrations

Migrations live in `prisma/migrations` and are applied with `migrate deploy`,
which only ever applies migrations that already exist — it never generates,
resets or drops anything. That is what makes it safe to run automatically on
container start.

```bash
npm run db:migrate -- --name add_something   # development: create + apply
npm run db:deploy                            # production: apply only
```

After changing `prisma/schema.prisma`, always create a migration rather than
using `db push`, so production has the same history.

Before applying a migration that touches existing data, rehearse it against a
copy of production. This restores a dump into a scratch database, migrates it,
and asserts that no rows were lost, no slug changed and the result matches
`prisma/schema.prisma` with no drift:

```bash
pg_dump -Fc "$PRODUCTION_DATABASE_URL" -f production.dump
REHEARSAL_DATABASE_URL=postgresql://user@localhost:5432/rehearsal \
  npm run db:rehearse -- ./production.dump
```

It exits non-zero and names the failing checks if anything is wrong, so it also
works as a CI gate. It refuses to run against `DATABASE_URL`, and writes only to
the scratch database. See
[docs/MULTI-COUNTRY.md](docs/MULTI-COUNTRY.md#rehearsing-the-migration).

---

## Seeding and the first administrator

The seed is idempotent — running it twice is safe:

- Creates the permission catalogue and the four built-in roles (Super Admin,
  Admin, Sales, Content & Marketing).
- Creates the first administrator from `SEED_ADMIN_EMAIL` and
  `SEED_ADMIN_PASSWORD`. If that email already exists the password is left
  alone; only the role is restored.
- With `SEED_DEMO_CONTENT=true`, adds demo products, pages, blog posts,
  navigation, forms and sample leads so the admin is not empty on first sight.

Credentials are never hardcoded. For production, set the two seed variables for
one run, sign in, change the password, then unset them.

---

## Running the tests

```bash
npm test            # 124 unit + integration tests
./scripts/smoke.sh  # 61 HTTP checks against a real production build
```

Integration tests run real Server Actions against the database named in
`DATABASE_URL` and clean up after themselves. Point them at a scratch database
if you would rather not touch your development data.

The smoke suite builds nothing itself — run `npm run build` first. It picks a
free port, boots the standalone server, signs in with the seeded credentials and
asserts the public routes, 404 handling, sitemap, authentication and every admin
route.

---

## Production build

```bash
npm run build
node .next/standalone/server.js
```

The build uses Next.js standalone output. `npm start` will warn that it does not
work with standalone output — use `node .next/standalone/server.js`, which is
what the Docker image does. The standalone bundle does not copy `public/` or
`.next/static/`; the Dockerfile handles that, and `scripts/smoke.sh` does the
same for local runs.

The build tolerates an unreachable database: `generateStaticParams` falls back
to on-demand rendering, so an image can be built without a database available.

---

## Docker

```bash
cp .env.example .env    # set AUTH_SECRET and ENCRYPTION_KEY at minimum
docker compose up --build
```

This starts PostgreSQL and the application. The entrypoint applies migrations
before the server starts, retrying while the database comes up. Set
`RUN_SEED=true` on the first boot to create the administrator.

The image:

- builds in three stages, so dependencies cache independently of source changes;
- runs as a non-root user (`nextjs`) on Node 22, from the Next.js standalone
  output;
- ships a PostgreSQL 16 client, verified at build time, because `pg_dump`
  refuses to read a database newer than itself and the backup system depends on
  it;
- exposes `/api/health` (liveness) and `/api/ready` (readiness — it also checks
  migrations have been applied), both returning 503 rather than a misleading
  200 when the database is unreachable;
- declares volumes at `/data/uploads` and `/app/backups` for media and backups,
  both outside the part of the filesystem a new image replaces;
- contains **no secrets**. Configuration is supplied at runtime, so the same
  image can be promoted between environments unchanged.

---

## Deploying with Coolify

1. **Create the database.** Add a PostgreSQL resource in Coolify and copy its
   internal connection string.
2. **Create the application.** Point it at this repository, choose the
   Dockerfile build pack, and set the port to `3000`.
3. **Set the environment variables** listed above. At minimum: `DATABASE_URL`,
   `AUTH_SECRET`, `ENCRYPTION_KEY`, `NEXTAUTH_URL` and `NEXT_PUBLIC_SITE_URL`,
   the last two set to your real domain.
4. **First deploy.** Set `RUN_SEED=true` together with `SEED_ADMIN_EMAIL` and
   `SEED_ADMIN_PASSWORD`. Deploy, sign in at `/admin`, change the password, then
   remove those three variables and redeploy.
5. **Persist uploads.** Add a persistent volume mounted at `/data/uploads`
   (**Storages** → **Add**). This is not optional on the default `local`
   driver: Coolify rebuilds the image on every deploy, so an unmounted
   directory loses the whole media library — silently, because everything keeps
   working until someone looks for an older image. Only a deployment using S3
   or R2 can skip it.
6. **Health check.** Coolify picks up the Dockerfile `HEALTHCHECK`
   automatically; if you configure one manually, use `/api/health`.

`RUN_MIGRATIONS` defaults to `true`, so each deploy applies pending migrations
before serving traffic. Set it to `false` if you would rather run them yourself.

---

## Deploying to Microsoft Azure

Azure Container Apps is the supported managed target. The flow is:

```
GitHub main → GitHub Actions → Azure Container Registry → Azure Container Apps
                                                              ├─ Azure PostgreSQL 16
                                                              ├─ R2/S3 for media
                                                              └─ private R2/S3 for backups
```

Pushing to `main` runs lint, typecheck, tests and a build; only if all four pass
does it build the image, push it, start a new revision, wait for that revision to
report healthy, and smoke-test the public URL. A failure at any point stops the
deployment — nothing is masked.

Two things differ from a single-server deployment and are not optional:

- **Media needs shared, persistent storage.** Several copies of the app run at
  once and the filesystem is replaced on each release, so an upload written to
  a container's own disk is invisible to the other copies and gone at the next
  deploy. Either mount an Azure Files share at `/data/uploads` and keep
  `STORAGE_DRIVER=local`, or set `STORAGE_DRIVER=r2`/`s3`. Both are supported;
  see [docs/MEDIA-STORAGE.md](docs/MEDIA-STORAGE.md).
- **`BACKUP_STORAGE_DRIVER` must be `s3`**, for the same reason.

Everything else — the same Dockerfile, the same entrypoint, the same environment
variables — is shared with the Docker and Coolify paths. No Azure SDK is a
runtime dependency, so the application stays portable.

- **[docs/AZURE-DEPLOYMENT.md](docs/AZURE-DEPLOYMENT.md)** — the full walkthrough,
  written for someone who has not used Azure before: portal steps, first
  deployment, admin creation, custom domain, troubleshooting and rollback.
- **[docs/AZURE-ENVIRONMENT.md](docs/AZURE-ENVIRONMENT.md)** — every variable,
  which ones must be Azure secrets, and a copy-paste template.

Once deployed, check it from anywhere:

```bash
npm run verify:production -- https://your-domain.com
```

That checks the homepage, `/api/health`, `/api/ready`, `robots.txt`,
`sitemap.xml`, the login page, and that `/admin` is gated. No credentials needed,
nothing destructive.

Two more checks, both read-only:

```bash
# Every address (bare and www, http and https) arrives at the real one with a
# permanent redirect, keeping the path and query, and the canonical tags,
# og:url, robots.txt and the sitemaps all use that address.
npm run check:domain -- https://www.your-domain.com /pricing

# Which pages ask not to be indexed: X-Robots-Tag and the robots meta tag.
npm run check:indexing -- https://www.your-domain.com / /pricing /ae
```

## File storage: local, S3 and Cloudflare R2

The CMS never knows which backend is in use — everything goes through
`StorageService` in `src/lib/storage`. Full detail, including the deployment
recipes and the security rules, is in
[docs/MEDIA-STORAGE.md](docs/MEDIA-STORAGE.md).

**Local** (default, and a complete setup on its own — no bucket, no account, no
key):

```env
STORAGE_DRIVER=local
UPLOAD_DIR=/data/uploads
MEDIA_PUBLIC_PATH=/media
```

Files are written under `UPLOAD_DIR` and served from `/media/...`; the
filesystem path is never exposed. Mount that directory as a persistent volume
in production, or uploads vanish on redeploy. The previous default,
`public/uploads`, is still read so an upgraded installation keeps serving what
it already had.

**Cloudflare R2:**

```env
STORAGE_DRIVER=r2
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=your-bucket
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PUBLIC_URL=https://cdn.yourdomain.com
```

**AWS S3:**

```env
STORAGE_DRIVER=s3
S3_REGION=ap-south-1
S3_BUCKET=your-bucket
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=false
```

`S3_PUBLIC_URL` should point at whatever actually serves the bucket — a CDN
domain, or the R2 public bucket URL. Switching providers does not migrate
existing files; each `Media` row records the provider it was stored with.

---

## Backup and restore

Full-site backups — database plus media library — from
**Admin → Settings → Backup & restore**. Take one by hand, schedule them, keep
them on disk or in a private S3/R2 bucket, download them, and restore the site
from one when something goes wrong.

Two things are required in production and easy to forget:

```env
BACKUP_LOCAL_PATH=/app/backups   # must be a persistent volume
CRON_SECRET=...                  # openssl rand -hex 32; enables scheduled runs
```

The container image installs `postgresql16-client` for `pg_dump` and
`pg_restore`; the major version must match your PostgreSQL server. A restore
always takes a safety backup first, verifies the archive checksum before
writing anything, and puts the public site into maintenance mode until it
finishes.

`backup.restore` and `backup.delete` are granted to super-admins only by
default.

Full setup, the Coolify volume and cron configuration, retention rules and
troubleshooting: **[docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)**.

---

## URLs, slugs and redirects

Every public address belongs to exactly one thing — a page, a product in one
market, an article, a redirect — recorded in the **URL registry** and managed in
**Admin → SEO → Slug & URL Manager**:

- move `/products/autocad` to `/autocad` for every product with one pattern, or
  for one market only (`/ae/products/autocad` → `/ae/autocad`);
- give one page or product its own address (`/autocad` → `/software/autocad`);
- move the blog (`/blog/article` → `/insights/article`);
- bulk changes and CSV import/export, each previewed before anything moves;
- bulk redirects from a two-column CSV (`URL,Destination URL`), validated
  against every existing redirect and content address before anything is
  written, with explicit keep-or-replace decisions for conflicts;
- automatic permanent redirects from every address that has been public,
  straight to the content — never through a chain — with query strings kept;
- conflicts, a full history with restore, and URL Health (404s, broken
  redirects, broken internal links).

The registry ships switched off, so upgrading changes nothing. To adopt it:
deploy, run the scan (`npm run urls:backfill -- --dry-run` to rehearse it),
review Conflicts, then switch it on in the manager. Switching it off again is
the rollback.

Requests on the bare domain are redirected to the configured `www` host (or the
other way round), keeping path and query; set `CANONICAL_HOST_REDIRECT=false`
if a proxy already does it.

Full reference — how an address is decided, rollout, recovery, permissions and
limitations: **[docs/URL-REGISTRY.md](docs/URL-REGISTRY.md)**.

---

## SEO Intelligence

**Admin → Content & SEO → SEO Intelligence** scores every public URL for SEO,
AEO and GEO from 0 to 100, with an overall score weighted SEO 50%, AEO 25%,
GEO 25%. Every check explains what it found and how to fix it; checks that do
not apply to a page are N/A and leave the denominator. Scores are cached with
the content version and audit time they were calculated for, and a score whose
content, address, settings or engine version has moved is shown as outdated.
Up to three target keywords per page, product, article or category are
analysis inputs only — no keywords meta tag is output.

AEO and GEO are **internal content-readiness assessments**: they do not
measure AI citations, rankings or visibility. Full reference, including every
rule: **[docs/SEO-INTELLIGENCE.md](docs/SEO-INTELLIGENCE.md)**.

---

## Forms

Every form on the site — lead, contact, popup, hero, CTA, product enquiry, CMS
block — is drawn by one renderer (`src/components/forms/public-form.tsx`) from
one design schema (`src/lib/forms/form-design.ts`). There is no per-location
form styling, so a form dropped somewhere new gets the full control set for
free.

Design and per-field settings live at **Admin → Forms → (form) → Design**:
layout and columns per breakpoint, spacing, container background and border,
typography, input and button states, validation messages, and the success
message. Fields carry their own label visibility, column span, validation and
conditional-display rules.

Every rule is re-enforced server-side from the stored definitions — a tampered
payload cannot relax a required field, rewrite a read-only value, or claim a
product enquiry was about a different product.

Full reference: **[docs/FORM-DESIGN-SYSTEM.md](docs/FORM-DESIGN-SYSTEM.md)**.

---

## Email and SMTP

Configure SMTP at **Admin → Settings → Email**. Database values take precedence
over the `SMTP_*` environment variables, so a non-technical administrator can
change providers without a redeploy.

- The password is encrypted with AES-256-GCM before it is stored and is never
  sent to the browser. Leaving the field blank keeps the stored value.
- **Test connection** verifies the SMTP handshake; **Send test** delivers a real
  message end to end.
- Templates for new-lead, assignment, submission and lead-confirmation emails
  are editable, each with its own list of available tokens.

Email failures never block a visitor: notifications are dispatched after the
form response is returned.

---

## Marketing and tracking

**Admin → Marketing** configures GA4, Google Tag Manager, Google Ads, Meta
Pixel, Microsoft UET, Hotjar, the LinkedIn Insight Tag and the TikTok Pixel.

Each vendor tag is emitted from a fixed template with only a format-validated ID
interpolated, so the marketing screen cannot be used to inject arbitrary
JavaScript. Genuinely custom scripts are a separate, explicitly privileged
feature: they require `marketing.manage`, can be scoped to an environment and to
consent, and every change is written to the audit log with the full body.

With consent required, no tag loads until the visitor accepts.

UTM parameters and the referrer are captured by middleware into first-touch and
last-touch cookies, and both are attached to every lead.

---

## Adding a new CMS block

Three steps, no changes to the page builder:

1. **Describe it** in `src/lib/cms/blocks.ts` — a Zod schema for the content and
   a list of field descriptors. The admin editor is generated from these.
2. **Render it** with a component under `src/components/cms/blocks/`.
3. **Register the renderer** in the switch in
   `src/components/cms/section-renderer.tsx`.

The block appears in the "Add section" dialog immediately, with a working
editor, validation, and the shared Design panel — spacing, width, background,
colours, responsive breakpoints and anchor ID — without writing any of it.

---

## Security notes

- Every mutation runs through a Server Action that validates its input with Zod
  and checks a specific permission on the server. Hiding a button is never the
  authorisation mechanism.
- Passwords are hashed with bcrypt (cost 12). Sign-in is rate limited per email
  address and per source IP.
- All admin-authored HTML is sanitised before storage and again before render.
  `javascript:` and `data:` URLs are stripped from every link field.
- Uploads are validated by magic bytes, not the declared MIME type; SVGs
  containing script are rejected; storage keys are namespaced and unguessable.
  Uploaded files are served with `nosniff` and a sandboxing CSP.
- Security headers (frame denial, nosniff, referrer policy, permissions policy,
  HSTS) are set in `next.config.mjs`.
- IP addresses are only ever stored as a salted hash.
- `/admin` answers a signed-out visitor with a 404 rather than a redirect, so
  probing it reveals neither the admin nor the path of the sign-in screen.
  Authentication is enforced in the admin layout and every permission is
  re-checked in the action that needs it; nothing relies on middleware.

### A note on `npm audit`

`npm audit` reports an advisory against `nodemailer` (`GHSA-p6gq-j5cr-w38f`)
which concerns the message-level `raw` option. This codebase never uses `raw`;
all mail is composed from typed fields in `src/lib/email/mailer.ts`.

---

## Troubleshooting

**"Can't reach database server" during a build.** Expected and harmless — the
build falls back to on-demand rendering. It is only fatal at runtime.

**Uploads disappear after a deploy.** `STORAGE_DRIVER=local` without a
persistent volume. Mount one at `UPLOAD_DIR` (`/data/uploads` by default), or
switch to S3/R2. The startup log says which directory was checked and whether
it was writable.

**Sign-in loops back to `/auth-control-panel/admin`.** `NEXTAUTH_URL` does not
match the URL you are actually visiting, so the session cookie is scoped to a
different origin.

**Canonical URLs and the sitemap point at an address that redirects.** The
domain moved — typically the bare domain now redirects to www — and
`NEXT_PUBLIC_SITE_URL` / `NEXTAUTH_URL` still name the old address. Admin →
SEO warns when the address you are browsing differs from the site address.
Set both to the address the redirect ends on and redeploy; they are read at
startup, so no rebuild of the image is needed. `npm run check:domain` confirms
it.

**Emails are not arriving.** Check that email is switched on in Admin →
Settings → Email, then use **Test connection** followed by **Send test** — the
error message from the SMTP server is surfaced directly.

**A published page still 404s.** Confirm its status is Published and that any
scheduled publish date has passed. `/admin/preview/<id>` renders any page,
published or not.

---

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the system is put together.
