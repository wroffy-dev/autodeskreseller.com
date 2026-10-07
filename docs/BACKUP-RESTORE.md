# Backup & restore

Full-site backups: the PostgreSQL database, the media library, and a manifest
describing both, packed into one `.zip` archive that can be downloaded, stored
off-site, and restored.

Admin screen: **Admin → Settings → Backup & restore** (`/admin/settings/backups`).

---

## What a backup contains

A backup archive is a plain `.zip` with a fixed layout:

```
backup/manifest.json           metadata: version, app version, counts, checksums
backup/database/database.dump  pg_dump custom-format archive (binary, compressed)
backup/media/…                 every file in the media library, at its storage path
```

`backup/manifest.json` records the archive's own format version, the application
version, what the archive includes, and the SHA-256 of the database dump. It
**never** contains credentials, connection strings, API keys, or environment
variables — this is verified by a test.

Three types:

| Type       | Database | Media | Use it for                                |
| ---------- | -------- | ----- | ----------------------------------------- |
| `FULL`     | ✅        | ✅     | The real backup. Take this before upgrades. |
| `DATABASE` | ✅        | ❌     | Quick, small, frequent.                    |
| `MEDIA`    | ❌        | ✅     | After a large upload batch.                |

---

## Requirements

- **`pg_dump` and `pg_restore`**, matching the PostgreSQL server's major
  version. The production image installs `postgresql16-client`. Without them
  the admin screen shows a red banner and only `MEDIA` backups can run.
- **A persistent volume** at `BACKUP_LOCAL_PATH` when using local storage. A
  container filesystem is discarded on every deploy; a backup written to one
  disappears with it.

---

## Environment variables

| Variable                       | Default        | Notes                                          |
| ------------------------------ | -------------- | ---------------------------------------------- |
| `BACKUP_STORAGE_DRIVER`        | `local`        | `local` or `s3`.                               |
| `BACKUP_LOCAL_PATH`            | `/app/backups` | Must be a mounted volume in production.        |
| `BACKUP_S3_ENDPOINT`           | —              | R2: `https://<account>.r2.cloudflarestorage.com` |
| `BACKUP_S3_REGION`             | `auto`         |                                                |
| `BACKUP_S3_BUCKET`             | —              | Use a **private** bucket.                      |
| `BACKUP_S3_ACCESS_KEY_ID`      | —              |                                                |
| `BACKUP_S3_SECRET_ACCESS_KEY`  | —              |                                                |
| `BACKUP_S3_FORCE_PATH_STYLE`   | `true`         | Required by MinIO and most R2 setups.          |
| `BACKUP_RETENTION_DAILY`       | `7`            | Fallback when no schedule row exists.          |
| `BACKUP_RETENTION_WEEKLY`      | `4`            |                                                |
| `BACKUP_RETENTION_MONTHLY`     | `3`            |                                                |
| `BACKUP_MAX_IMPORT_MB`         | `2048`         | Upload limit for imported archives.            |
| `BACKUP_ENCRYPTION_KEY`        | —              | Reserved; see *Encryption* below.              |
| `CRON_SECRET`                  | —              | Enables the scheduled-backup endpoint.         |

The backup bucket must be **separate from the media bucket**. Media is public;
a backup archive contains the entire database and must never be reachable by
URL.

---

## Storage

**Local** — archives are written under `BACKUP_LOCAL_PATH`, streamed to a
`.part` file and renamed on success so a killed process never leaves a
truncated archive that looks complete. Downloads are streamed through an
authenticated route; there is no public path to the directory.

**S3 / R2** — archives are uploaded with multipart upload, so a 5 GB archive
never has to fit in memory. Downloads redirect to a signed URL valid for ten
minutes, which keeps the bucket private.

---

## Scheduling

The application does not run its own scheduler — a Next.js container may be
replaced or scaled at any moment, and an in-process timer would either miss
runs or duplicate them. Instead, an external scheduler calls:

```
POST /api/internal/cron/backup
Authorization: Bearer $CRON_SECRET
```

The endpoint is cheap and idempotent: it checks whether the configured schedule
is actually due, runs a backup only if it is, applies retention, and recomputes
the next run. Calling it every 15 minutes is fine and is the recommended
cadence — it means a missed window is picked up quickly.

When `CRON_SECRET` is unset or shorter than 16 characters the endpoint is
**disabled** (503), not open.

### Coolify

1. **Persistent volume** — Application → *Storages* → *Add*:
   - Name: `backups`
   - Destination path: `/app/backups`
   (Keep the media volume at `/data/uploads` as well — see
   [MEDIA-STORAGE.md](MEDIA-STORAGE.md). A backup covers the database and the
   media library, and a restore needs both.)

2. **Environment variables** — Application → *Environment Variables*: add the
   `BACKUP_*` values above plus `CRON_SECRET`. Generate the secret with
   `openssl rand -hex 32`. Coolify marks values as build- or runtime-scoped;
   these are runtime only.

3. **Scheduled task** — Application → *Scheduled Tasks* → *Add*:
   - Name: `backup-tick`
   - Frequency: `*/15 * * * *`
   - Command:
     ```sh
     curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
       http://127.0.0.1:3000/api/internal/cron/backup
     ```
   The task runs inside the container, so `CRON_SECRET` is already in the
   environment and the request never leaves the host.

4. Set the schedule itself (time, frequency, retention) in
   **Admin → Settings → Backup & restore**, not in the cron expression. The
   cron only asks "is anything due?".

### Any other host

A system crontab, a GitHub Actions schedule, or an uptime pinger works equally
well — anything that can send an authenticated `POST` on a timer. Do not expose
`CRON_SECRET` to a browser.

---

## Retention

Retention keeps a number of backups per tier rather than deleting after N days,
so the answer to "how far back can I go?" is always a count and pruning can
never empty the shelf:

- the newest `BACKUP_RETENTION_DAILY` backups,
- one per week for `BACKUP_RETENTION_WEEKLY` weeks,
- one per month for `BACKUP_RETENTION_MONTHLY` months.

**Never pruned:** manual backups, imported archives, and pre-restore safety
backups. Retention runs only after a scheduled backup has succeeded, so a
failed run cannot delete the last good archive.

---

## Restoring

Restore is deliberately hard to trigger by accident. It needs the
`backup.restore` permission (super-admin only by default) and the word
`RESTORE` typed into the confirmation dialog.

The sequence:

1. **A safety backup of the current site is taken first.** This is the rollback
   point and is never deleted automatically — including when the restore fails.
2. The archive is downloaded from storage and its SHA-256 checksum verified
   against the value recorded when it was created. A mismatch aborts before
   anything is written.
3. The manifest is read; an archive from another application, or in a format
   this build does not support, is refused.
4. **Maintenance mode is turned on**, so visitors see a holding page instead of
   a half-restored site. Signed-in staff are exempt.
5. The database is restored with
   `pg_restore --clean --if-exists --single-transaction --exit-on-error`, so a
   failure rolls the whole thing back rather than leaving a partial schema.
6. Media files are extracted, each path validated against traversal before it
   is written.
7. **Maintenance mode is turned off** — in a `finally` block, so a crash cannot
   leave the site dark.

Maintenance mode can also be toggled on its own from
**Admin → Settings → Website settings**. Turning it on calls
`revalidatePath('/', 'layout')`, which is what makes prerendered blog and
product pages re-render and pick the flag up — a statically cached page would
otherwise keep serving until its own revalidation window elapsed.

Because a database restore replaces the `Backup` table itself, the backup
inventory is snapshotted before the restore and merged back afterwards.
Otherwise the safety backup — the only way back — would vanish along with
everything else.

Only one backup or restore runs at a time, enforced by a lock row guarded by a
transaction-scoped advisory lock. The claim carries a six-hour expiry so a
killed container cannot wedge the system permanently.

### URL registry, cities and SEO Intelligence (1.2.0)

Their data is ordinary tables in the same database — `UrlRoute`,
`UrlPattern`, `UrlHistory`, `UrlNotFound`, `UrlOperation`, `UrlSettings`,
`City`, `CityPageBatch`, `CityProduct`, `SeoAudit`, plus columns on `Page`,
`Redirect` and the keyword columns — so every database backup contains it and
a restore brings it back consistent with the content restored alongside it.
The CHECK constraints and triggers that guard city address spaces and city
status are part of the schema the dump recreates; `pg_dump` places triggers
after the table data, so they never fire against half-restored rows.

- **Restoring a backup taken before 1.2.0** onto 1.2.0: the restore puts the
  old schema back, so run `prisma migrate deploy` (it runs on start) and then
  a URL scan (Slug & URL Manager → *Run first scan*, or `npm run urls:backfill`)
  — the same as a first rollout. Cities start empty; SEO scores recalculate
  from the dashboard.
- **Restoring a 1.2.0 backup**: nothing else is needed. Each server reloads
  the URL registry on its next request, and SEO scores whose content changed
  show as outdated until recalculated.
- `SeoAudit` is a cache: if it is ever lost, *Recalculate all* rebuilds it.

---

## Importing an archive

**Admin → Settings → Backup & restore → Import archive** accepts a `.zip`
produced by this system. It is validated (zip structure, manifest present,
manifest version supported, dump present when claimed), checksummed, and stored
as a `COMPLETED` backup with origin `IMPORTED`.

Importing never restores. Restoring is a second, explicit step.

---

## Permissions

| Permission        | Default holders           |
| ----------------- | ------------------------- |
| `backup.view`     | Admin, super-admin        |
| `backup.create`   | Admin, super-admin        |
| `backup.download` | Admin, super-admin        |
| `backup.settings` | Admin, super-admin        |
| `backup.restore`  | **Super-admin only**      |
| `backup.delete`   | **Super-admin only**      |

Restore replaces the entire database and delete destroys a rollback point, so
neither is granted to ordinary admins by default. Both can be assigned per role
in **Admin → Settings → Roles & Permissions**.

On an **existing deployment** the six `backup.*` permissions are new, so no
role holds them until they are assigned. A super-admin always has access —
`userCan` grants that role everything without consulting the list — so nobody
is locked out. To give the seeded Admin role its defaults, either tick the
permissions in Roles & Permissions or re-run the seed with `RUN_SEED=true`.
Note that the seed rewrites every system role's permissions from the code, so
it also discards custom grants made to those roles.

---

## Security

- Secrets are never written to a manifest, an archive, an audit row, a log
  line, or an API response. Every error leaving the subsystem passes through a
  redactor that strips `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, SMTP
  passwords and any `postgres://user:pass@host` form — `pg_dump` and
  `pg_restore` echo the connection string in several of their error messages.
- `pg_dump` and `pg_restore` are invoked with `spawn()` and an argument array.
  No string is ever concatenated into a shell command.
- Every archive entry path is validated before extraction: `../`, absolute
  paths, Windows drive letters, UNC paths and null bytes are rejected (Zip
  Slip).
- Storage keys are generated by the application and validated against an
  allowlist pattern before reaching the filesystem.
- Backup archives are never served from a public path. Local storage streams
  through an authenticated route; S3 storage issues a ten-minute signed URL.
- The cron endpoint compares its bearer token with `timingSafeEqual`.
- Downloads, restores, deletions and settings changes are all written to the
  audit log.

---

## Encryption

`BACKUP_ENCRYPTION_KEY` is reserved and **not yet applied to archives** — the
storage interface is in place, but archives are currently written unencrypted.
Until it lands, protect archives with storage-level controls: a private bucket
with server-side encryption (SSE-S3 or SSE-KMS), or an encrypted volume.

Anyone adding it should note the trade-off that has kept it out: an encryption
key that is lost makes every archive encrypted with it unreadable, which
converts a backup system into a way to lose data. It needs key rotation and a
documented escrow procedure, not just a cipher.

---

## Troubleshooting

**"Database backups are unavailable"** — `pg_dump` is missing from the
container. Confirm the image installs `postgresql16-client` and redeploy.

**`pg_dump: server version mismatch`** — the client is older than the server.
Bump the `postgresql<N>-client` package in the `Dockerfile` to the server's
major version.

**"Another backup or restore is running"** — expected while one is in flight.
If nothing is actually running, the claim lapses after six hours; the
`clearStaleLock()` helper releases it sooner.

**Scheduled backups never run** — the cron endpoint is not being called. Check
that `CRON_SECRET` is set (≥16 characters) and that the scheduled task exists.
Call it manually with `?force=1` to test:

```sh
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  'http://127.0.0.1:3000/api/internal/cron/backup?force=1'
```

**Backups vanish after a deploy** — `BACKUP_LOCAL_PATH` is not on a persistent
volume. Add the volume, and use S3/R2 for anything you cannot afford to lose.
