-- Deskzo CRM sync.
--
-- Every lead can be pushed to the Deskzo CRM through its lead capture API.
-- These columns record where that push stands, so a lead the CRM could not
-- take (the CRM was down, the key was wrong) is retried rather than lost, and
-- an administrator can see from the lead itself whether it reached the CRM.
--
-- Existing leads get NULL: they were never queued, and nothing is sent for
-- them until someone chooses to from Settings → CRM integration.

CREATE TYPE "CrmSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'ROUTED', 'FAILED');

ALTER TABLE "Lead"
  ADD COLUMN "crmSyncStatus"    "CrmSyncStatus",
  ADD COLUMN "crmLeadId"        TEXT,
  ADD COLUMN "crmReference"     TEXT,
  ADD COLUMN "crmSyncAttempts"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "crmNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "crmSyncedAt"      TIMESTAMP(3),
  ADD COLUMN "crmLastError"     TEXT;

CREATE INDEX "Lead_crmSyncStatus_crmNextAttemptAt_idx" ON "Lead"("crmSyncStatus", "crmNextAttemptAt");
