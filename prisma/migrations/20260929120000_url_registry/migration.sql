-- The URL registry.
--
-- Additive only: new tables, new nullable or defaulted columns, new indexes.
-- Nothing existing is renamed, rewritten or dropped, and no public address
-- changes when this runs. The registry starts empty and switched off; the
-- first scan (Slug & URL Manager, or `npm run urls:backfill`) registers every
-- existing address exactly as it is served today, and public requests are only
-- resolved through it once an administrator switches it on.
--
-- Deliberately NOT included: `prisma migrate diff` also proposes dropping
-- "CountrySettings"."copyrightText" and "footerDescription". Those columns are
-- drift left by an earlier migration and are unrelated to this change, and a
-- migration that is meant to be non-destructive does not drop data on the
-- side.

-- CreateEnum
CREATE TYPE "UrlContentType" AS ENUM ('PAGE', 'CATEGORY_PAGE', 'BRAND_PAGE', 'PRODUCT', 'BLOG_POST', 'BLOG_CATEGORY', 'BLOG_TAG', 'BLOG_ARCHIVE');

-- CreateEnum
CREATE TYPE "UrlRouteKind" AS ENUM ('CONTENT', 'REDIRECT');

-- CreateEnum
CREATE TYPE "UrlRouteMode" AS ENUM ('PATTERN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RedirectOrigin" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "UrlChangeReason" AS ENUM ('CREATE', 'EDIT', 'SLUG', 'PATTERN', 'BULK', 'IMPORT', 'RESTORE', 'DELETE', 'BACKFILL', 'MARKET');

-- CreateEnum
CREATE TYPE "UrlHealthStatus" AS ENUM ('OPEN', 'IGNORED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "UrlOperationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "groupKey" TEXT,
ADD COLUMN     "landingBrandId" TEXT,
ADD COLUMN     "landingCategoryId" TEXT;

-- AlterTable
ALTER TABLE "Redirect" ADD COLUMN     "allMarkets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "countryId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "lastHitAt" TIMESTAMP(3),
ADD COLUMN     "origin" "RedirectOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "targetCountryId" TEXT,
ADD COLUMN     "targetEntityId" TEXT,
ADD COLUMN     "targetType" "UrlContentType",
ADD COLUMN     "updatedById" TEXT;

-- CreateTable
CREATE TABLE "UrlRoute" (
    "id" TEXT NOT NULL,
    "kind" "UrlRouteKind" NOT NULL DEFAULT 'CONTENT',
    "path" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "type" "UrlContentType",
    "entityId" TEXT,
    "mode" "UrlRouteMode" NOT NULL DEFAULT 'PATTERN',
    "redirectId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrlRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlPattern" (
    "id" TEXT NOT NULL,
    "type" "UrlContentType" NOT NULL,
    "countryId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrlPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlHistory" (
    "id" TEXT NOT NULL,
    "type" "UrlContentType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "oldPath" TEXT,
    "newPath" TEXT,
    "reason" "UrlChangeReason" NOT NULL,
    "redirectId" TEXT,
    "batchId" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrlHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlNotFound" (
    "id" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "countryId" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReferrer" TEXT,
    "status" "UrlHealthStatus" NOT NULL DEFAULT 'OPEN',
    "redirectId" TEXT,

    CONSTRAINT "UrlNotFound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlOperation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "UrlOperationStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "plan" JSONB NOT NULL,
    "results" JSONB,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "UrlOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "lastScanAt" TIMESTAMP(3),
    "lastScan" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrlSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UrlRoute_pathKey_key" ON "UrlRoute"("pathKey");

-- CreateIndex
CREATE INDEX "UrlRoute_countryId_kind_type_idx" ON "UrlRoute"("countryId", "kind", "type");

-- CreateIndex
CREATE INDEX "UrlRoute_redirectId_idx" ON "UrlRoute"("redirectId");

-- CreateIndex
CREATE INDEX "UrlRoute_type_idx" ON "UrlRoute"("type");

-- CreateIndex
CREATE UNIQUE INDEX "UrlRoute_entityId_countryId_key" ON "UrlRoute"("entityId", "countryId");

-- CreateIndex
CREATE UNIQUE INDEX "UrlPattern_scopeKey_key" ON "UrlPattern"("scopeKey");

-- CreateIndex
CREATE INDEX "UrlPattern_type_idx" ON "UrlPattern"("type");

-- CreateIndex
CREATE INDEX "UrlHistory_entityId_countryId_createdAt_idx" ON "UrlHistory"("entityId", "countryId", "createdAt");

-- CreateIndex
CREATE INDEX "UrlHistory_createdAt_idx" ON "UrlHistory"("createdAt");

-- CreateIndex
CREATE INDEX "UrlHistory_countryId_idx" ON "UrlHistory"("countryId");

-- CreateIndex
CREATE INDEX "UrlHistory_batchId_idx" ON "UrlHistory"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "UrlNotFound_pathKey_key" ON "UrlNotFound"("pathKey");

-- CreateIndex
CREATE INDEX "UrlNotFound_status_lastSeenAt_idx" ON "UrlNotFound"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "UrlNotFound_hits_idx" ON "UrlNotFound"("hits");

-- CreateIndex
CREATE INDEX "UrlOperation_createdAt_idx" ON "UrlOperation"("createdAt");

-- CreateIndex
CREATE INDEX "Page_groupKey_idx" ON "Page"("groupKey");

-- CreateIndex
CREATE UNIQUE INDEX "Page_countryId_landingCategoryId_key" ON "Page"("countryId", "landingCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_countryId_landingBrandId_key" ON "Page"("countryId", "landingBrandId");

-- Addresses are made unique by "UrlRoute"."pathKey", which every active rule
-- claims. The old unique index on the raw spelling is relaxed to a plain one:
-- no row changes, and a dormant rule written before the registry can share a
-- spelling with the automatic redirect that later takes its address.
DROP INDEX "Redirect_source_key";

-- CreateIndex
CREATE INDEX "Redirect_source_idx" ON "Redirect"("source");

-- CreateIndex
CREATE INDEX "Redirect_origin_idx" ON "Redirect"("origin");

-- CreateIndex
CREATE INDEX "Redirect_countryId_idx" ON "Redirect"("countryId");

-- CreateIndex
CREATE INDEX "Redirect_targetEntityId_targetCountryId_idx" ON "Redirect"("targetEntityId", "targetCountryId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_landingCategoryId_fkey" FOREIGN KEY ("landingCategoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_landingBrandId_fkey" FOREIGN KEY ("landingBrandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlRoute" ADD CONSTRAINT "UrlRoute_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlRoute" ADD CONSTRAINT "UrlRoute_redirectId_fkey" FOREIGN KEY ("redirectId") REFERENCES "Redirect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlPattern" ADD CONSTRAINT "UrlPattern_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A registry row is either content or a redirect claim, never both or neither.
ALTER TABLE "UrlRoute" ADD CONSTRAINT "UrlRoute_kind_shape_check" CHECK (
  ("kind" = 'CONTENT' AND "type" IS NOT NULL AND "entityId" IS NOT NULL AND "redirectId" IS NULL)
  OR
  ("kind" = 'REDIRECT' AND "redirectId" IS NOT NULL AND "entityId" IS NULL AND "type" IS NULL)
);

-- Keys are stored normalised, so uniqueness cannot be dodged by case or a
-- trailing slash: "/AutoCAD/" and "/autocad" are the same address.
ALTER TABLE "UrlRoute" ADD CONSTRAINT "UrlRoute_pathKey_normalised_check" CHECK (
  "pathKey" = lower("pathKey")
  AND left("pathKey", 1) = '/'
  AND ("pathKey" = '/' OR right("pathKey", 1) <> '/')
  AND position('//' in "pathKey") = 0
);

-- One pattern per content type per scope, and a pattern is a path.
ALTER TABLE "UrlPattern" ADD CONSTRAINT "UrlPattern_pattern_path_check" CHECK (left("pattern", 1) = '/');

-- The state row the registry reads on every public request.
INSERT INTO "UrlSettings" ("id", "version", "resolverEnabled", "updatedAt")
VALUES ('singleton', 1, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
