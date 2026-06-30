-- ─────────────────────────────────────────────────────────────
-- Program table DDL (NetSuite -> Postgres sync target)
-- Mirrors the fields the real app maps from a NetSuite customer.
-- Idempotent: safe to run on every boot.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Program" (
  "id"             uuid PRIMARY KEY,
  -- Unique match key for NetSuite-origin programs. UNIQUE so that
  -- INSERT ... ON CONFLICT ("netsuiteId") DO UPDATE makes re-runs idempotent.
  "netsuiteId"     varchar UNIQUE,
  "salesforceId"   varchar,
  "name"           varchar NOT NULL,
  "ownerId"        varchar,
  "ownerEmail"     varchar,
  "ownerFirstName" varchar,
  "ownerLastName"  varchar,
  "phone"          varchar,
  "type"           varchar,
  "subType"        varchar,
  "street"         varchar,
  "city"           varchar,
  "state"          varchar,
  "zipCode"        varchar,
  "isDeleted"      boolean NOT NULL DEFAULT false,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

-- Helps the reconcile lookups by salesforce id used during sync.
CREATE INDEX IF NOT EXISTS "IDX_Program_salesforceId" ON "Program" ("salesforceId");
