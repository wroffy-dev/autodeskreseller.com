-- SEO Intelligence: three primary keywords per page, product, market version,
-- article and blog category, and a cache of calculated scores.
--
-- Additive only. Every new keyword column is nullable, no column is dropped or
-- renamed, and the only rows written are articles whose focus keyword is
-- copied into their first primary keyword. BlogPost.focusKeyword itself is
-- kept as it is, so no historical focus keyword can be lost.

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "primaryKeyword1" TEXT,
ADD COLUMN     "primaryKeyword2" TEXT,
ADD COLUMN     "primaryKeyword3" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "primaryKeyword1" TEXT,
ADD COLUMN     "primaryKeyword2" TEXT,
ADD COLUMN     "primaryKeyword3" TEXT;

-- AlterTable
ALTER TABLE "ProductCountry" ADD COLUMN     "primaryKeyword1" TEXT,
ADD COLUMN     "primaryKeyword2" TEXT,
ADD COLUMN     "primaryKeyword3" TEXT;

-- AlterTable
ALTER TABLE "BlogCategory" ADD COLUMN     "primaryKeyword1" TEXT,
ADD COLUMN     "primaryKeyword2" TEXT,
ADD COLUMN     "primaryKeyword3" TEXT;

-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "primaryKeyword1" TEXT,
ADD COLUMN     "primaryKeyword2" TEXT,
ADD COLUMN     "primaryKeyword3" TEXT;

-- CreateTable
CREATE TABLE "SeoAudit" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "indexable" BOOLEAN NOT NULL,
    "noIndex" BOOLEAN NOT NULL,
    "seoScore" INTEGER NOT NULL,
    "aeoScore" INTEGER NOT NULL,
    "geoScore" INTEGER NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "suggestionCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "missingMetadata" BOOLEAN NOT NULL DEFAULT false,
    "missingSchema" BOOLEAN NOT NULL DEFAULT false,
    "missingKeywords" BOOLEAN NOT NULL DEFAULT false,
    "indexingConflict" BOOLEAN NOT NULL DEFAULT false,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "engineVersion" TEXT NOT NULL,
    "contentUpdatedAt" TIMESTAMP(3) NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "contextFingerprint" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoAudit_countryId_overallScore_idx" ON "SeoAudit"("countryId", "overallScore");

-- CreateIndex
CREATE INDEX "SeoAudit_entityType_overallScore_idx" ON "SeoAudit"("entityType", "overallScore");

-- CreateIndex
CREATE INDEX "SeoAudit_overallScore_idx" ON "SeoAudit"("overallScore");

-- CreateIndex
CREATE INDEX "SeoAudit_calculatedAt_idx" ON "SeoAudit"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeoAudit_entityType_entityId_countryId_key" ON "SeoAudit"("entityType", "entityId", "countryId");

-- AddForeignKey
ALTER TABLE "SeoAudit" ADD CONSTRAINT "SeoAudit_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An article's focus keyword becomes its first primary keyword: trimmed, runs
-- of whitespace collapsed and capped at the keyword length the editor allows.
-- Only where the article has no first keyword yet, so running this again, or
-- after somebody set one, changes nothing.
UPDATE "BlogPost"
SET "primaryKeyword1" = left(btrim(regexp_replace("focusKeyword", '\s+', ' ', 'g')), 100)
WHERE "primaryKeyword1" IS NULL
  AND "focusKeyword" IS NOT NULL
  AND btrim("focusKeyword") <> '';
