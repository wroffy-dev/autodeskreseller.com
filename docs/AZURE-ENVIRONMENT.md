# Azure environment reference

Every variable the application reads, what it does, and whether it must be stored
as an Azure secret.

Companion to [docs/AZURE-DEPLOYMENT.md](AZURE-DEPLOYMENT.md), which walks through
the deployment itself.

---

## How Azure handles the two kinds of value

Azure Container Apps keeps these in two different places, and the difference
matters:

- **Environment variables** (Container App → **Containers** → **Edit and deploy**
  → container → **Environment variables**) are visible to anyone who can read the
  app's configuration in the portal, and they appear in `az containerapp show`
  output.
- **Secrets** (Container App → **Settings** → **Secrets**) are write-only once
  saved. You reference them from an environment variable by choosing
  **Reference a secret** as the Source.

So a value is a secret if seeing it would let someone do damage. Everything else
is a plain variable.

---

## Secrets to create

Container App → **Settings** → **Secrets** → **+ Add**, once per row.

| Secret name | Holds | Where it comes from |
| --- | --- | --- |
| `database-url` | Full PostgreSQL connection string, password included | Step 4 of the deployment guide |
| `auth-secret` | Signs session cookies | `openssl rand -base64 32` |
| `encryption-key` | Encrypts integration secrets stored in the database | `openssl rand -base64 32` |
| `mfa-encryption-key` | Encrypts two-step verification secrets | `openssl rand -base64 32` |
| `cron-secret` | Authorises the scheduled-backup endpoint | `openssl rand -hex 32` |
| `seed-admin-password` | First admin's password — delete after setup | You choose it |
| `media-access-key` | R2/S3 access key for the media bucket | Cloudflare R2 token |
| `media-secret-key` | R2/S3 secret key for the media bucket | Cloudflare R2 token |
| `backup-access-key` | R2/S3 access key for the backup bucket | A **separate** R2 token |
| `backup-secret-key` | R2/S3 secret key for the backup bucket | A **separate** R2 token |
| `backup-encryption-key` | Reserved; leave unset unless you have key custody | `openssl rand -base64 32` |
| `smtp-password` | Email account password or API key | Your email provider |

Use two different R2 tokens for media and backups. The media key is used on every
upload; the backup key protects a file containing your entire database. A leak of
one should not reach the other.

---

## Mapping secrets to variables

In the **Environment variables** tab, set **Source** to **Reference a secret**
and pick the name.

| Environment variable | Secret reference |
| --- | --- |
| `DATABASE_URL` | `secretref:database-url` |
| `AUTH_SECRET` | `secretref:auth-secret` |
| `ENCRYPTION_KEY` | `secretref:encryption-key` |
| `MFA_ENCRYPTION_KEY` | `secretref:mfa-encryption-key` |
| `CRON_SECRET` | `secretref:cron-secret` |
| `SEED_ADMIN_PASSWORD` | `secretref:seed-admin-password` |
| `S3_ACCESS_KEY` | `secretref:media-access-key` |
| `S3_SECRET_KEY` | `secretref:media-secret-key` |
| `BACKUP_S3_ACCESS_KEY_ID` | `secretref:backup-access-key` |
| `BACKUP_S3_SECRET_ACCESS_KEY` | `secretref:backup-secret-key` |
| `BACKUP_ENCRYPTION_KEY` | `secretref:backup-encryption-key` |
| `SMTP_PASSWORD` | `secretref:smtp-password` |

Everything else is entered directly.

---

## The full template

Copy this, fill it in, and work through it row by row in the portal. Lines marked
`# SECRET` go in **Secrets** and are referenced, not typed into the variable.

```env
# --- Core -------------------------------------------------------------------
DATABASE_URL=                      # SECRET → database-url
AUTH_SECRET=                       # SECRET → auth-secret
NEXTAUTH_URL=                      # https://your-domain.com  (no trailing slash)
NEXT_PUBLIC_SITE_URL=              # the same value
ENCRYPTION_KEY=                    # SECRET → encryption-key

# --- Runtime ----------------------------------------------------------------
PORT=3000
RUN_MIGRATIONS=true
RUN_SEED=false                     # true for the FIRST deploy only

# --- First admin (delete once created) --------------------------------------
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=               # SECRET → seed-admin-password
SEED_ADMIN_NAME=Super Admin
SEED_DEMO_CONTENT=false

# --- Email ------------------------------------------------------------------
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=                     # SECRET → smtp-password
SMTP_ENCRYPTION=tls
MAIL_FROM=

# --- Media storage ----------------------------------------------------------
# Two supported shapes on Azure. Either this (a bucket), or STORAGE_DRIVER=local
# with an Azure Files share mounted at /data/uploads and every S3_* left empty.
# What is NOT supported is `local` with no mount: the container filesystem is
# ephemeral and is not shared between replicas.
STORAGE_DRIVER=r2
S3_ENDPOINT=                       # https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY=                     # SECRET → media-access-key
S3_SECRET_KEY=                     # SECRET → media-secret-key
S3_PUBLIC_URL=                     # https://pub-xxxxx.r2.dev or your CDN domain
S3_FORCE_PATH_STYLE=true

# Largest file the uploader accepts. Applies to every driver. Unset keeps the
# deliberately small 150 KB default.
MAX_UPLOAD_SIZE_MB=10

# --- Analytics (optional) ---------------------------------------------------
NEXT_PUBLIC_GA_ID=
NEXT_PUBLIC_GTM_ID=

# --- Backups (must NOT be local on Azure) -----------------------------------
BACKUP_STORAGE_DRIVER=s3
BACKUP_S3_ENDPOINT=                # https://ACCOUNT_ID.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=                  # a PRIVATE bucket, separate from media
BACKUP_S3_ACCESS_KEY_ID=           # SECRET → backup-access-key
BACKUP_S3_SECRET_ACCESS_KEY=       # SECRET → backup-secret-key
BACKUP_S3_FORCE_PATH_STYLE=true
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_RETENTION_MONTHLY=3
BACKUP_MAX_IMPORT_MB=2048
BACKUP_ENCRYPTION_KEY=             # SECRET → backup-encryption-key (optional)
CRON_SECRET=                       # SECRET → cron-secret

# --- Two-step verification --------------------------------------------------
MFA_ISSUER=Wroffy
MFA_ENCRYPTION_KEY=                # SECRET → mfa-encryption-key
```

---

## What each one does

### Core

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Must include `sslmode=require` on Azure. Add `connection_limit=5` so replicas do not exhaust the server's connections. |
| `AUTH_SECRET` | ✅ | 16 characters minimum, 32+ recommended. Changing it signs everyone out; nothing else breaks. |
| `NEXTAUTH_URL` | ✅ | Must be `https://` in production and must not end in `/`. Wrong value breaks sign-in redirects. |
| `NEXT_PUBLIC_SITE_URL` | ✅ | Used for canonical URLs, the sitemap and social previews. Normally identical to `NEXTAUTH_URL`. Also the canonical host: requests on its bare-domain or `www` twin are redirected to it (308). |
| `ENCRYPTION_KEY` | ✅ | 32 characters minimum. Encrypts secrets saved through the admin, such as an SMTP password. |

### Runtime

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | Must match the Container App's target port. |
| `RUN_MIGRATIONS` | `true` | Runs `prisma migrate deploy` at startup. Only ever applies existing migrations. |
| `RUN_SEED` | `false` | `true` for one deployment to create the first admin, then back to `false`. |
| `MIGRATION_MAX_ATTEMPTS` | `7` | Retry budget for a database that is still waking up. Raise it if your server is slow to start. |
| `CANONICAL_HOST_REDIRECT` | `true` | `false` when Front Door or another proxy already redirects the bare domain to `www` (or the reverse). See [URL-REGISTRY.md](./URL-REGISTRY.md#redirects). |
| `SKIP_ENV_VALIDATION` | unset | Escape hatch for the Docker build only. Never set it on a running deployment — it disables the startup check that catches misconfiguration. |

### First admin

Only read when `RUN_SEED=true`. The seed is safe to re-run: an account that
already exists is never given a new password and never recreated.

`SEED_ADMIN_PASSWORD` is rejected unless it has 14+ characters, upper and lower
case, a number, a symbol, and contains no common word such as "password",
"changeme" or "admin123". The password is never written to a log — a rejection
says what is missing, not what you typed.

`SEED_DEMO_CONTENT` defaults to `false`. Set it to `true` only if you want sample
pages, products, blog posts and fake leads.

### Media storage

| `STORAGE_DRIVER` | Use for |
| --- | --- |
| `local` | Local development, and any deployment with a persistent volume mounted at `UPLOAD_DIR` — including Azure, with an Azure Files share |
| `r2` | Cloudflare R2 — needs `S3_ENDPOINT` |
| `s3` | AWS S3 — leave `S3_ENDPOINT` empty, set a real `S3_REGION` |

`STORAGE_PROVIDER` is the previous name and is still read when `STORAGE_DRIVER`
is unset.

On Azure Container Apps, `local` needs a share mounted at `UPLOAD_DIR`
(`/data/uploads`) — see
[MEDIA-STORAGE.md](MEDIA-STORAGE.md#azure-container-apps). Without one, a file
uploaded through one replica is invisible to the others and is destroyed by the
next deployment.

`S3_PUBLIC_URL` is the address browsers load images from — the R2 public domain
or your CDN — not the API endpoint.

### Backups

Same reasoning: `BACKUP_STORAGE_DRIVER=s3` on Azure, because a backup written to
the container filesystem disappears with the container that made it.

The backup bucket must be **private**. Retention keeps a number of automatic
backups per tier; manual, imported and pre-restore safety backups are never
pruned.

`CRON_SECRET` must be at least 16 characters. When unset, the scheduled-backup
endpoint returns 503 rather than being open.

### Two-step verification

`MFA_ENCRYPTION_KEY` is the single most consequential value here.

It encrypts every user's authenticator secret and keys their recovery-code
hashes. **Changing it makes all of them permanently unreadable** — every user
would have to enrol again, and there is no recovery procedure.

It is deliberately kept out of database backups: an archive containing both the
encrypted secrets and the key that opens them would not be encrypted in any
meaningful sense. The consequence is that restoring a database onto a deployment
with a *different* key leaves the MFA secrets unreadable. The application handles
this safely — affected users are treated as not enrolled and walked through
enrolment again — but everyone has to re-enrol.

Store it with your disaster-recovery notes, not only in Azure.

---

## Checklist before going live

- [ ] All 12 secrets created, none typed directly into a variable
- [ ] `NEXTAUTH_URL` and `NEXT_PUBLIC_SITE_URL` both use `https://` and your real
      domain, with no trailing slash
- [ ] `STORAGE_DRIVER` is `r2`/`s3`, **or** `local` with a share mounted at `/data/uploads`
- [ ] `BACKUP_STORAGE_DRIVER` is `s3`, never `local`
- [ ] The backup bucket has public access switched **off**
- [ ] Media and backup buckets use **different** API tokens
- [ ] `RUN_SEED` is back to `false` and `SEED_ADMIN_PASSWORD` deleted
- [ ] `MFA_ENCRYPTION_KEY` saved somewhere outside Azure
- [ ] `DATABASE_URL` contains `sslmode=require` and `connection_limit=5`
- [ ] `SKIP_ENV_VALIDATION` is **not** set
- [ ] `https://your-domain/api/health` returns `"status":"ok"`
- [ ] `https://your-domain/api/ready` returns `"status":"ready"`
