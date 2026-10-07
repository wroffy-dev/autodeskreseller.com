-- Cities: a local address space inside a market.
--
-- Additive only: two new tables, five new nullable or defaulted columns on
-- "Page", new indexes, constraints and triggers. Nothing existing is renamed,
-- rewritten or dropped, and no public address changes when this runs: every
-- existing page gets "cityId" = NULL and "isCityHomepage" = false, which is
-- exactly how a page outside any city behaves.
--
-- Deliberately NOT included: `prisma migrate diff` also proposes dropping
-- "CountrySettings"."copyrightText" and "footerDescription". Those columns are
-- drift left by an earlier migration and are unrelated to this change, and a
-- migration that is meant to be non-destructive does not drop data on the
-- side.

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "generatedFromPageId" TEXT,
ADD COLUMN     "generationBatchId" TEXT,
ADD COLUMN     "isCityHomepage" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "region" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "salesPhone" TEXT,
    "whatsappNumber" TEXT,
    "salesEmail" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "latitude" TEXT,
    "longitude" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "primaryKeyword1" TEXT,
    "primaryKeyword2" TEXT,
    "primaryKeyword3" TEXT,
    "noIndex" BOOLEAN NOT NULL DEFAULT false,
    "excludeFromSitemap" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CityPageBatch" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "sourcePageId" TEXT,
    "sourceTitle" TEXT NOT NULL,
    "sourceSlug" TEXT NOT NULL,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '[]',
    "actorId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityPageBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "City_countryId_idx" ON "City"("countryId");

-- CreateIndex
CREATE INDEX "City_countryId_isActive_idx" ON "City"("countryId", "isActive");

-- CreateIndex
CREATE INDEX "City_countryId_isPublished_idx" ON "City"("countryId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "City_countryId_slug_key" ON "City"("countryId", "slug");

-- CreateIndex
CREATE INDEX "CityPageBatch_countryId_createdAt_idx" ON "CityPageBatch"("countryId", "createdAt");

-- CreateIndex
CREATE INDEX "CityPageBatch_sourcePageId_idx" ON "CityPageBatch"("sourcePageId");

-- CreateIndex
CREATE INDEX "Page_cityId_idx" ON "Page"("cityId");

-- CreateIndex
CREATE INDEX "Page_generatedFromPageId_idx" ON "Page"("generatedFromPageId");

-- CreateIndex
CREATE INDEX "Page_generationBatchId_idx" ON "Page"("generationBatchId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_generatedFromPageId_fkey" FOREIGN KEY ("generatedFromPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_generationBatchId_fkey" FOREIGN KEY ("generationBatchId") REFERENCES "CityPageBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityPageBatch" ADD CONSTRAINT "CityPageBatch_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityPageBatch" ADD CONSTRAINT "CityPageBatch_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Guarantees Prisma cannot express, written in SQL. `prisma migrate diff`
-- does not introspect partial indexes, CHECK constraints or triggers, so they
-- cause no drift.
-- ---------------------------------------------------------------------------

-- Only a city page can be a city's landing page.
ALTER TABLE "Page" ADD CONSTRAINT "Page_city_homepage_has_city"
    CHECK ("isCityHomepage" = false OR "cityId" IS NOT NULL);

-- At most one live landing page per city. A page in the recycle bin keeps its
-- flag, so restoring it can put it back, and does not count.
CREATE UNIQUE INDEX "Page_one_city_homepage" ON "Page"("cityId")
    WHERE "isCityHomepage" = true AND "deletedAt" IS NULL;

-- A city page belongs to its city's market. A composite foreign key would say
-- this, but Prisma cannot model one over an optional and a required column,
-- so a trigger does.
CREATE OR REPLACE FUNCTION "page_city_in_country"() RETURNS trigger AS $$
BEGIN
    IF NEW."cityId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "City" c WHERE c."id" = NEW."cityId" AND c."countryId" = NEW."countryId"
    ) THEN
        RAISE EXCEPTION 'Page % cannot belong to city %: the city is in another country', NEW."id", NEW."cityId"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Page_city_in_country"
    BEFORE INSERT OR UPDATE OF "cityId", "countryId" ON "Page"
    FOR EACH ROW EXECUTE FUNCTION "page_city_in_country"();

-- And a city with pages cannot move to another market from under them.
CREATE OR REPLACE FUNCTION "city_country_fixed"() RETURNS trigger AS $$
BEGIN
    IF NEW."countryId" IS DISTINCT FROM OLD."countryId" AND EXISTS (
        SELECT 1 FROM "Page" p WHERE p."cityId" = OLD."id"
    ) THEN
        RAISE EXCEPTION 'City % has pages and cannot move to another country', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "City_country_fixed"
    BEFORE UPDATE OF "countryId" ON "City"
    FOR EACH ROW EXECUTE FUNCTION "city_country_fixed"();
