-- City publication status, explicit city/product associations, a redirect's
-- destination query string and fragment, a generated page's content
-- fingerprint, and database-level guarantees for the city address spaces.
--
-- Additive only: one enum, one table, four nullable or defaulted columns, new
-- indexes, constraints and triggers. Nothing existing is renamed, rewritten or
-- dropped, and no public address changes when this runs.
--
-- Deliberately NOT included: `prisma migrate diff` also proposes dropping
-- "CountrySettings"."copyrightText" and "footerDescription". Those columns are
-- drift left by an earlier migration and unrelated to this change; a
-- non-destructive migration does not drop data on the side.

-- CreateEnum
CREATE TYPE "CityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "City" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "status" "CityStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "isActive" SET DEFAULT false,
ALTER COLUMN "isPublished" SET DEFAULT false;

-- AlterTable
ALTER TABLE "Redirect" ADD COLUMN     "destinationSuffix" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "generatedHash" TEXT;

-- CreateTable
CREATE TABLE "CityProduct" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "pageId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CityProduct_pageId_key" ON "CityProduct"("pageId");

-- CreateIndex
CREATE INDEX "CityProduct_productId_idx" ON "CityProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CityProduct_cityId_productId_key" ON "CityProduct"("cityId", "productId");

-- CreateIndex
CREATE INDEX "City_countryId_status_idx" ON "City"("countryId", "status");

-- AddForeignKey
ALTER TABLE "CityProduct" ADD CONSTRAINT "CityProduct_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityProduct" ADD CONSTRAINT "CityProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityProduct" ADD CONSTRAINT "CityProduct_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Status backfill. A city that was both active and published keeps serving
-- its pages; every other city becomes a draft. Idempotent.
-- ---------------------------------------------------------------------------

UPDATE "City" SET "status" = 'PUBLISHED' WHERE "isActive" = true AND "isPublished" = true AND "status" <> 'ARCHIVED';
UPDATE "City" SET "isActive" = ("status" = 'PUBLISHED'), "isPublished" = ("status" = 'PUBLISHED');

-- The flags every public query filters on are derived from the status and
-- cannot disagree with it.
ALTER TABLE "City" ADD CONSTRAINT "City_status_flags" CHECK (
  ("status" = 'PUBLISHED' AND "isActive" = true AND "isPublished" = true)
  OR ("status" <> 'PUBLISHED' AND "isActive" = false AND "isPublished" = false)
);

ALTER TABLE "City" ADD CONSTRAINT "City_archived_at" CHECK (
  ("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- City address spaces, enforced by the database.
--
-- A city owns the first segment of addresses in its market (`/delhi/...`,
-- `/ae/dubai/...`). The application refuses collisions with a readable
-- message first; these triggers are the backstop that holds whatever writes
-- the rows:
--
--  * only pages may be registered inside a city's address space — never a
--    product, an article, a category/brand landing page or the archive;
--  * no manual redirect may claim a city's own address (an automatic redirect
--    left by a moved landing page may);
--  * a city cannot be given a slug whose address space already holds any of
--    the above, nor a root-market slug that is a market prefix;
--  * a market prefix cannot be a root-market city's slug.
-- ---------------------------------------------------------------------------

-- The city segment of a registry key in a market, or NULL: `/delhi/x` in the
-- root market gives "delhi"; `/ae/dubai/x` in the "ae" market gives "dubai".
CREATE OR REPLACE FUNCTION "url_city_segment"(country_id TEXT, key TEXT) RETURNS TEXT AS $$
DECLARE
    prefix TEXT;
BEGIN
    SELECT lower(c."slug") INTO prefix FROM "Country" c WHERE c."id" = country_id;
    IF prefix IS NULL THEN
        RETURN NULL;
    END IF;
    IF prefix = '' THEN
        RETURN NULLIF(split_part(key, '/', 2), '');
    END IF;
    IF split_part(key, '/', 2) = prefix THEN
        RETURN NULLIF(split_part(key, '/', 3), '');
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- The key of a city's own address: "/delhi", "/ae/dubai".
CREATE OR REPLACE FUNCTION "url_city_root_key"(country_id TEXT, city_slug TEXT) RETURNS TEXT AS $$
    SELECT CASE WHEN c."slug" = '' THEN '/' || lower(city_slug)
                ELSE '/' || lower(c."slug") || '/' || lower(city_slug) END
    FROM "Country" c WHERE c."id" = country_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION "url_route_city_namespace"() RETURNS trigger AS $$
DECLARE
    segment TEXT;
    city_name TEXT;
    city_slug TEXT;
    redirect_origin TEXT;
BEGIN
    segment := "url_city_segment"(NEW."countryId", NEW."pathKey");
    IF segment IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT ci."name", ci."slug" INTO city_name, city_slug
    FROM "City" ci WHERE ci."countryId" = NEW."countryId" AND lower(ci."slug") = segment;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF NEW."kind" = 'CONTENT' AND NEW."type" <> 'PAGE' THEN
        RAISE EXCEPTION '% is in the address space of the city %; only its pages can live there', NEW."pathKey", city_name
            USING ERRCODE = 'check_violation', CONSTRAINT = 'UrlRoute_city_namespace';
    END IF;

    IF NEW."kind" = 'REDIRECT' AND NEW."pathKey" = "url_city_root_key"(NEW."countryId", city_slug) THEN
        SELECT r."origin"::TEXT INTO redirect_origin FROM "Redirect" r WHERE r."id" = NEW."redirectId";
        IF redirect_origin IS DISTINCT FROM 'AUTOMATIC' THEN
            RAISE EXCEPTION '% is the address of the city %; a redirect cannot take it', NEW."pathKey", city_name
                USING ERRCODE = 'check_violation', CONSTRAINT = 'UrlRoute_city_namespace';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "UrlRoute_city_namespace"
    BEFORE INSERT OR UPDATE OF "pathKey", "kind", "type", "countryId", "redirectId" ON "UrlRoute"
    FOR EACH ROW EXECUTE FUNCTION "url_route_city_namespace"();

CREATE OR REPLACE FUNCTION "city_namespace_free"() RETURNS trigger AS $$
DECLARE
    root_key TEXT;
    holder TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."slug" = OLD."slug" AND NEW."countryId" = OLD."countryId" THEN
        RETURN NEW;
    END IF;

    -- A root-market city cannot share its segment with a market prefix.
    IF EXISTS (SELECT 1 FROM "Country" c WHERE c."id" = NEW."countryId" AND c."isDefault" = true)
       AND EXISTS (SELECT 1 FROM "Country" m WHERE m."slug" <> '' AND lower(m."slug") = lower(NEW."slug")) THEN
        RAISE EXCEPTION '/% is a market prefix and cannot be a city', NEW."slug"
            USING ERRCODE = 'check_violation', CONSTRAINT = 'City_namespace_free';
    END IF;

    root_key := "url_city_root_key"(NEW."countryId", NEW."slug");
    SELECT r."path" INTO holder
    FROM "UrlRoute" r
    LEFT JOIN "Redirect" rd ON rd."id" = r."redirectId"
    WHERE r."countryId" = NEW."countryId"
      AND (r."pathKey" = root_key OR r."pathKey" LIKE root_key || '/%')
      AND (
        (r."kind" = 'CONTENT' AND r."type" <> 'PAGE')
        OR (r."kind" = 'REDIRECT' AND r."pathKey" = root_key AND rd."origin" IS DISTINCT FROM 'AUTOMATIC')
      )
    LIMIT 1;
    IF holder IS NOT NULL THEN
        RAISE EXCEPTION '% is already used by something that is not a city page', holder
            USING ERRCODE = 'check_violation', CONSTRAINT = 'City_namespace_free';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "City_namespace_free"
    BEFORE INSERT OR UPDATE OF "slug", "countryId" ON "City"
    FOR EACH ROW EXECUTE FUNCTION "city_namespace_free"();

CREATE OR REPLACE FUNCTION "country_prefix_not_city"() RETURNS trigger AS $$
BEGIN
    IF NEW."slug" <> '' AND (TG_OP = 'INSERT' OR NEW."slug" IS DISTINCT FROM OLD."slug") AND EXISTS (
        SELECT 1 FROM "City" ci JOIN "Country" d ON d."id" = ci."countryId"
        WHERE d."isDefault" = true AND lower(ci."slug") = lower(NEW."slug")
    ) THEN
        RAISE EXCEPTION '/% is the address of a city in the root market and cannot be a market prefix', NEW."slug"
            USING ERRCODE = 'check_violation', CONSTRAINT = 'Country_prefix_not_city';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Country_prefix_not_city"
    BEFORE INSERT OR UPDATE OF "slug" ON "Country"
    FOR EACH ROW EXECUTE FUNCTION "country_prefix_not_city"();

-- ---------------------------------------------------------------------------
-- City/product associations: the page, when there is one, is the city's own.
-- A page that leaves the city leaves the association too (its pageId is
-- cleared; the association itself stays, so nothing is lost).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "city_product_page_in_city"() RETURNS trigger AS $$
BEGIN
    IF NEW."pageId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Page" p WHERE p."id" = NEW."pageId" AND p."cityId" = NEW."cityId"
    ) THEN
        RAISE EXCEPTION 'Page % is not one of city %''s pages', NEW."pageId", NEW."cityId"
            USING ERRCODE = 'check_violation', CONSTRAINT = 'CityProduct_page_in_city';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CityProduct_page_in_city"
    BEFORE INSERT OR UPDATE OF "pageId", "cityId" ON "CityProduct"
    FOR EACH ROW EXECUTE FUNCTION "city_product_page_in_city"();

CREATE OR REPLACE FUNCTION "page_left_city_product"() RETURNS trigger AS $$
BEGIN
    IF NEW."cityId" IS DISTINCT FROM OLD."cityId" THEN
        UPDATE "CityProduct" SET "pageId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "pageId" = NEW."id" AND "cityId" IS DISTINCT FROM NEW."cityId";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Page_left_city_product"
    AFTER UPDATE OF "cityId" ON "Page"
    FOR EACH ROW EXECUTE FUNCTION "page_left_city_product"();
