'use strict';

// ─────────────────────────────────────────────────────────────
// REQUIREMENT 6 — NetSuite customer -> Postgres Program sync.
// Ports the mapping logic from
//   src/program/providers/netsuite-program-sync.provider.ts
// and the batched, idempotent upsert from
//   src/program/initiator/SyncProgramsUseCase.ts
// Re-runs UPDATE in place via INSERT ... ON CONFLICT (netsuiteId) DO UPDATE,
// so they never create duplicates.
// ─────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { Config } = require('../config');
const { pool } = require('../db');
const dataSource = require('../dataSource');

// ── mapping helpers (ported from NetSuiteProgramSyncProvider) ──

function splitFullName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function resolveOwner(record) {
  const ownerId = String(record.custentity_ra_primary_contact_id || record.id);
  const ownerEmail = (
    record.custentity_ra_primary_contact_email ||
    record.email ||
    ''
  ).trim();

  let ownerFirstName = (
    record.custentity_ra_primary_contact_first_name ||
    record.firstname ||
    ''
  ).trim();
  let ownerLastName = (
    record.custentity_ra_primary_contact_last_name ||
    record.lastname ||
    ''
  ).trim();

  if (!ownerFirstName || !ownerLastName) {
    const full = splitFullName(record.custentity_ra_primary_contact_full_name);
    ownerFirstName = ownerFirstName || full.firstName;
    ownerLastName = ownerLastName || full.lastName;
  }

  // Last-resort derivation from the email local part.
  if (ownerEmail && (!ownerFirstName || !ownerLastName)) {
    const localPart = ownerEmail.split('@')[0] || '';
    const localNameParts = localPart.split(/[._+\-]/).filter(Boolean);
    if (!ownerFirstName) {
      ownerFirstName = localNameParts[0] || (record.companyname || '').trim() || localPart || 'Owner';
    }
    if (!ownerLastName) {
      ownerLastName = localNameParts.slice(1).join(' ') || (record.companyname || '').trim() || 'Account';
    }
  }

  return { ownerId, ownerEmail, ownerFirstName, ownerLastName };
}

function resolveAddress(record) {
  const shipping = {
    street: (record.shippingstreet || '').trim() || null,
    city: (record.shippingcity || '').trim() || null,
    state: (record.shippingstate || '').trim() || null,
    zipCode: (record.shippingzip || '').trim() || null,
  };
  const billing = {
    street: (record.billingstreet || '').trim() || null,
    city: (record.billingcity || '').trim() || null,
    state: (record.billingstate || '').trim() || null,
    zipCode: (record.billingzip || '').trim() || null,
  };

  if (shipping.street || shipping.city || shipping.state || shipping.zipCode) return shipping;
  if (billing.street || billing.city || billing.state || billing.zipCode) return billing;
  return { street: null, city: null, state: null, zipCode: null };
}

function resolveProgramType(record) {
  const type = String(record.programtype || '').trim();
  const subType = String(record.programsubtype || '').trim();
  return {
    type: type || (record.isperson === 'T' ? 'individual' : 'company'),
    subType,
  };
}

// Transform one raw NetSuite customer row into a Program row, or null to skip.
function transformRecord(record) {
  if (!record.id) return null;

  const owner = resolveOwner(record);
  const { type, subType } = resolveProgramType(record);
  const address = resolveAddress(record);

  return {
    id: randomUUID(),
    netsuiteId: String(record.id),
    salesforceId: (record.custentity_ra_legacy_sfc_number || '').toString().trim() || null,
    name: record.companyname || record.entityid || `Customer ${record.id}`,
    ownerId: owner.ownerId,
    ownerEmail: owner.ownerEmail,
    ownerFirstName: owner.ownerFirstName,
    ownerLastName: owner.ownerLastName,
    phone: record.phone || '',
    type,
    subType,
    isDeleted: record.isinactive === 'T',
    street: address.street,
    city: address.city,
    state: address.state,
    zipCode: address.zipCode,
    createdAt: record.datecreated ? new Date(record.datecreated) : new Date(),
    updatedAt: record.lastmodifieddate ? new Date(record.lastmodifieddate) : new Date(),
  };
}

// Required owner fields must all be present (mirrors the skip rule in SyncProgramsUseCase).
function hasCompleteOwner(p) {
  return Boolean(p.ownerId && p.ownerFirstName && p.ownerLastName && p.ownerEmail);
}

// ── idempotent upsert ──

// INSERT ... ON CONFLICT (netsuiteId) DO UPDATE keeps the existing row's id and
// updates the CRM-owned fields in place, so re-running the sync never duplicates.
const UPSERT_SQL = `
  INSERT INTO "Program" (
    "id","netsuiteId","salesforceId","name","ownerId","ownerEmail",
    "ownerFirstName","ownerLastName","phone","type","subType",
    "street","city","state","zipCode","isDeleted","createdAt","updatedAt"
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
  )
  ON CONFLICT ("netsuiteId") DO UPDATE SET
    "salesforceId"   = EXCLUDED."salesforceId",
    "name"           = EXCLUDED."name",
    "ownerId"        = EXCLUDED."ownerId",
    "ownerEmail"     = EXCLUDED."ownerEmail",
    "ownerFirstName" = EXCLUDED."ownerFirstName",
    "ownerLastName"  = EXCLUDED."ownerLastName",
    "phone"          = EXCLUDED."phone",
    "type"           = EXCLUDED."type",
    "subType"        = EXCLUDED."subType",
    "street"         = EXCLUDED."street",
    "city"           = EXCLUDED."city",
    "state"          = EXCLUDED."state",
    "zipCode"        = EXCLUDED."zipCode",
    "isDeleted"      = EXCLUDED."isDeleted",
    "updatedAt"      = EXCLUDED."updatedAt"
  RETURNING (xmax = 0) AS inserted;
`;

async function upsertProgram(p) {
  const res = await pool.query(UPSERT_SQL, [
    p.id,
    p.netsuiteId,
    p.salesforceId,
    p.name,
    p.ownerId,
    p.ownerEmail,
    p.ownerFirstName,
    p.ownerLastName,
    p.phone,
    p.type,
    p.subType,
    p.street,
    p.city,
    p.state,
    p.zipCode,
    p.isDeleted,
    p.createdAt,
    p.updatedAt,
  ]);
  // xmax = 0 means a fresh INSERT; otherwise it was an UPDATE.
  return res.rows[0] && res.rows[0].inserted ? 'inserted' : 'updated';
}

/**
 * Run the full sync: fetch customers page-by-page from the active data source,
 * transform, skip incomplete owners, and idempotently upsert into Postgres.
 * Returns a summary { totalFetched, upserted, inserted, updated, skipped, source }.
 */
async function runProgramSync() {
  const batchSize = Config.ProgramSync.BatchSize;
  let offset = 0;
  let totalFetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let source = 'mock';

  // Loop pages until a short page (fewer rows than the batch size) is returned.
  // (Mock returns all rows in one page; live paginates via hasMore/offset.)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { source: pageSource, response } = await dataSource.getProgramCustomers({
      limit: batchSize,
      offset,
    });
    source = pageSource;
    const records = response.items || [];
    totalFetched += records.length;

    for (const record of records) {
      const program = transformRecord(record);
      if (!program || !hasCompleteOwner(program)) {
        skipped += 1;
        continue;
      }
      const result = await upsertProgram(program);
      if (result === 'inserted') inserted += 1;
      else updated += 1;
    }

    const morePages = response.hasMore === true && records.length > 0;
    if (!morePages || records.length < batchSize) break;
    offset += records.length;
  }

  return {
    totalFetched,
    upserted: inserted + updated,
    inserted,
    updated,
    skipped,
    source,
  };
}

// Read synced programs back from Postgres (used by GET /programs to prove persistence).
async function listPrograms({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 1000);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM "Program"');
  const total = countRes.rows[0].total;

  const res = await pool.query(
    `SELECT "id","netsuiteId","salesforceId","name","ownerId","ownerEmail",
            "ownerFirstName","ownerLastName","phone","type","subType",
            "street","city","state","zipCode","isDeleted","createdAt","updatedAt"
     FROM "Program"
     ORDER BY "updatedAt" DESC
     LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset],
  );

  return { data: res.rows, total, limit: safeLimit, offset: safeOffset };
}

module.exports = {
  runProgramSync,
  listPrograms,
  transformRecord,
  resolveOwner,
  resolveAddress,
  resolveProgramType,
};
