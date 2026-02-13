-- Phase 151a production schema migration (run before code deploy)
-- Safe additive DDL only.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "linkedinCompanyUrl" text NULL,
  ADD COLUMN IF NOT EXISTS "smsLastBlockedAt" timestamp NULL,
  ADD COLUMN IF NOT EXISTS "smsLastBlockedReason" text NULL,
  ADD COLUMN IF NOT EXISTS "smsConsecutiveBlockedCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "smsLastSuccessAt" timestamp NULL;

-- If your migration runner supports CONCURRENTLY, run these separately outside a transaction:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "Lead_linkedinCompanyUrl_not_null_idx"
--   ON "Lead" ("linkedinCompanyUrl")
--   WHERE "linkedinCompanyUrl" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Lead_linkedinCompanyUrl_idx" ON "Lead" ("linkedinCompanyUrl");
CREATE INDEX IF NOT EXISTS "Lead_smsLastBlockedAt_idx" ON "Lead" ("smsLastBlockedAt");
CREATE INDEX IF NOT EXISTS "Lead_smsLastSuccessAt_idx" ON "Lead" ("smsLastSuccessAt");
