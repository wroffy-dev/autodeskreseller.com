# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Dependencies — cached independently of the source tree
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
# `npm ci` runs prisma generate through the postinstall of @prisma/client.
RUN npm ci --ignore-scripts && npx prisma generate

# ---------------------------------------------------------------------------
# Runtime dependencies
# ---------------------------------------------------------------------------
# Exactly what `dependencies` resolves to — installed the way npm would install
# it, then copied into the runtime image whole.
#
# The runtime stage used to hand-pick packages out of the builder's
# node_modules. That cannot work: the Prisma CLI pulls in more than thirty
# transitive modules (@prisma/config -> effect -> fast-check -> ...), so each
# missing one surfaced as the next `Cannot find module` at container start and
# was patched by adding one more COPY. Copying a real install ends that cycle
# and cannot drift when Prisma is upgraded.
FROM node:22-alpine AS prod-deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npx prisma generate

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Placeholders, and only placeholders.
#
# The build reads settings from the database when it can and falls back to
# on-demand rendering when it cannot, so no real database is required. These two
# values exist because Prisma's client and Auth.js both throw at import time
# without them; they are syntactically valid and deliberately useless.
#
# No real secret is ever passed to `docker build`. A value baked into a layer is
# readable by anyone who can pull the image, survives being "changed" later, and
# would tie one image to one environment. Runtime configuration belongs in Azure
# Container Apps secrets — see PHASE 16 in docs/AZURE-DEPLOYMENT.md.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV AUTH_SECRET="build-time-placeholder-value-not-used-at-runtime"
# Skips the production env gate, which would otherwise reject this placeholder
# configuration during the build's static-generation pass.
ENV SKIP_ENV_VALIDATION=true

RUN npm run build

# The seed is compiled to a self-contained bundle here, where devDependencies
# still exist. The runtime image has no tsx, so `tsx prisma/seed.ts` could never
# have worked there.
RUN npm run seed:build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
# postgresql16-client supplies pg_dump and pg_restore for the backup system.
# The major version must match the server: pg_dump refuses to read a database
# newer than itself. Falls back to the unversioned package if the pinned one is
# not in this Alpine release.
RUN apk add --no-cache libc6-compat openssl curl \
 && (apk add --no-cache postgresql16-client || apk add --no-cache postgresql-client) \
 # Fail the build rather than ship an image whose pg_dump cannot read the
 # server. pg_dump refuses to dump from a newer major version, so a 15 client
 # against Azure PostgreSQL 16 would break every backup — and it would break at
 # 3am when the cron fires, not here.
 && pg_dump --version \
 && pg_restore --version \
 && pg_dump --version | grep -qE '\(PostgreSQL\) 1[6-9]'
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The production dependency tree, including the Prisma CLI the entrypoint runs.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# The standalone server, and the modules Next traced for it. Its node_modules
# merges into the tree above rather than replacing it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Schema, migrations, the compiled seed and the Prisma config, so the
# entrypoint can run `migrate deploy` and, when asked, the one-time seed.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./

# Operational scripts run from the container's own shell: the migration
# rehearsal, and the market clone that fills a new storefront. Neither needs a
# dependency of its own — the pg client tools, the Prisma CLI and the generated
# client they drive are already here.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/rehearse-migration.mjs ./scripts/
COPY --from=builder --chown=nextjs:nodejs /app/scripts/clone-market.mjs ./scripts/

COPY --chown=nextjs:nodejs docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Directories that hold data rather than code.
#
# /data/uploads is the media library. It is outside /app on purpose: everything
# under /app is replaced wholesale by the next image, so a library written
# there is destroyed by the deployment that was supposed to keep it. Mounted as
# a persistent volume it survives restarts, rebuilds and redeployments — on a
# VPS, in Docker Compose, on Coolify, and on Azure Container Apps with an Azure
# Files share mounted at this path. The application never learns which of those
# it is; it writes to a directory.
#
# Ownership is set here, at build time, because the container does not run as
# root: a volume mounted over a directory the `nextjs` user cannot write to
# produces an EACCES on the first upload and nothing else.
#
# Azure Container Apps without a mounted share is the one case that does not
# work — its filesystem is ephemeral and replicas do not share it, so a file
# written by one replica is invisible to the others and gone on the next
# revision. See docs/MEDIA-STORAGE.md.
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data/uploads
# The directory uploads were written to before /data/uploads. Still read, so an
# existing volume keeps serving its files; never written to.
RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads
RUN mkdir -p /app/backups && chown -R nextjs:nodejs /app/backups

VOLUME ["/data/uploads", "/app/backups"]

USER nextjs
EXPOSE 3000

# The start period has to cover migrations against a cold database, not just
# Next.js booting. The entrypoint's retry budget is roughly four minutes, so a
# 40-second grace period would mark a legitimately-migrating container unhealthy
# and restart it — repeatedly, and for the wrong reason.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
