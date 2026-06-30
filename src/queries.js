'use strict';

// ─────────────────────────────────────────────────────────────
// SuiteQL builders + input sanitisation.
// Ported from:
//   src/shared/netsuite/sales-orders-list.util.ts
//   src/shared/netsuite/netsuite.service.ts  (_buildSalesOrdersQuery etc.)
//   src/program/providers/netsuite-program-sync.provider.ts (_buildFetchProgramsQuery)
// ─────────────────────────────────────────────────────────────

const SALES_ORDERS_DEFAULT_LIMIT = 50;
const SALES_ORDERS_MAX_LIMIT = 1000;
const SALES_ORDER_TYPE = 'SalesOrd';

// NetSuite status code -> display label (transaction.status).
const NETSUITE_STATUS_CODE_MAP = {
  A: 'Pending Approval',
  B: 'Pending Fulfillment',
  C: 'Cancelled',
  D: 'Partially Fulfilled',
  E: 'Pending Billing / Partially Fulfilled',
  F: 'Pending Billing',
  G: 'Billed',
  H: 'Closed',
};

// Reverse map (label -> code), lowercased keys.
const ORDER_STATUS_LABEL_TO_CODE = {
  'pending approval': 'A',
  'pending fulfillment': 'B',
  cancelled: 'C',
  'partially fulfilled': 'D',
  'pending billing / partially fulfilled': 'E',
  'pending billing': 'F',
  billed: 'G',
  closed: 'H',
};

const STATUS_CODE_VALUES = Object.keys(NETSUITE_STATUS_CODE_MAP);
const ORDER_STATUS_VALUES = Object.values(NETSUITE_STATUS_CODE_MAP);
const SORT_BY_VALUES = ['orderId', 'date'];
const SORT_DIR_VALUES = ['ASC', 'DESC'];
const DELIVERY_VALUES = ['Bulk', 'IPP'];

// ── normalisation ──

function normalizeSalesOrdersLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return SALES_ORDERS_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), SALES_ORDERS_MAX_LIMIT);
}

function normalizeSalesOrdersOffset(offset) {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// Validate/normalise a NetSuite internal id (positive integer). Throws on bad input.
function normalizeInternalId(id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid NetSuite internal id: ${id}`);
  }
  return parsed;
}

// ── injection-safe helpers ──

// Escape single quotes for SuiteQL string literals ( ' -> '' ).
function escapeSuiteQLString(value) {
  return String(value).replace(/'/g, "''");
}

// Strip LIKE wildcards (% and _) and trim before wrapping in %...%.
function sanitizeSearchTerm(value) {
  return String(value || '').replace(/[%_]/g, '').trim();
}

function buildLikePattern(term) {
  const pattern = `%${sanitizeSearchTerm(term).toUpperCase()}%`;
  return `'${escapeSuiteQLString(pattern)}'`;
}

// ── filter / sort resolution ──

function resolveStatusCodeFilter(statusCode, orderStatus) {
  const code = (statusCode || '').trim().toUpperCase();
  if (code) return code;
  const label = (orderStatus || '').trim().toLowerCase();
  if (!label) return undefined;
  return ORDER_STATUS_LABEL_TO_CODE[label];
}

function resolveDeliveryFilter(delivery) {
  const normalized = (delivery || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'bulk') return 'Bulk';
  if (normalized === 'ipp' || normalized === 'individual') return 'IPP';
  return undefined;
}

function resolveSalesOrdersSortBy(sortBy) {
  const n = (sortBy || '').trim().toLowerCase();
  if (n === 'orderid' || n === 'order_id') return 't.id';
  if (n === 'date' || n === 'trandate') return 't.trandate';
  return 't.lastmodifieddate';
}

function resolveSalesOrdersSortDir(sortDir) {
  return (sortDir || '').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

function buildSalesOrdersOrderBySql(sortBy, sortDir) {
  return `ORDER BY ${resolveSalesOrdersSortBy(sortBy)} ${resolveSalesOrdersSortDir(sortDir)}`;
}

// Build the AND-clauses for server-side search/filter on the sales-orders list.
function buildSalesOrdersListFilterSql(filters) {
  const clauses = [];

  const search = sanitizeSearchTerm(filters.search);
  if (search) {
    const pattern = buildLikePattern(search);
    clauses.push(`(
      UPPER(t.tranid) LIKE ${pattern}
      OR UPPER(c.companyname) LIKE ${pattern}
      OR UPPER(BUILTIN.DF(t.opportunity)) LIKE ${pattern}
    )`);
  }

  const statusCode = resolveStatusCodeFilter(filters.statusCode, filters.orderStatus);
  if (statusCode) {
    clauses.push(`t.status = '${escapeSuiteQLString(statusCode)}'`);
  }

  const delivery = resolveDeliveryFilter(filters.delivery);
  if (delivery === 'IPP') {
    clauses.push(`c.isperson = 'T'`);
  } else if (delivery === 'Bulk') {
    clauses.push(`(c.isperson = 'F' OR c.isperson IS NULL)`);
  }

  if (clauses.length === 0) return '';
  return `AND ${clauses.join(' AND ')}`;
}

// Match Program.id from sync: entityid, legacy SFC number, or numeric NS customer id.
function buildProgramIdsFilter(programIds) {
  const trimmed = (programIds || []).map((id) => String(id).trim()).filter(Boolean);
  if (trimmed.length === 0) return '';

  const inList = trimmed.map((id) => `'${escapeSuiteQLString(id)}'`).join(', ');
  const clauses = [
    `c.entityid IN (${inList})`,
    `c.custentity_ra_legacy_sfc_number IN (${inList})`,
  ];

  const numericIds = trimmed
    .filter((id) => /^\d+$/.test(id))
    .map((id) => normalizeInternalId(id));
  if (numericIds.length > 0) {
    clauses.push(`c.id IN (${numericIds.join(', ')})`);
  }

  return `AND (${clauses.join(' OR ')})`;
}

// ── sales-order list / detail query builder ──

// Custom body field candidates tried in the variant fallback.
const SALES_ORDER_CUSTOM_FIELD_CANDIDATES = [
  {
    orderType: 'custbody_ra_order_type',
    styleDescription: 'custbody_ra_style_description',
    additionalDescription: 'custbody_ra_additional_description',
  },
  {
    orderType: 'custbody_order_type',
    styleDescription: 'custbody_style_description',
    additionalDescription: 'custbody_additional_description',
  },
];

function buildEnrichmentSelect(aggregate) {
  const lineFilter = `AND tl.mainline = 'F' AND tl.taxline = 'F'`;

  if (aggregate) {
    // MIN/MAX variant for accounts where ROWNUM / FETCH FIRST is unsupported.
    return `(
        SELECT COUNT(*) FROM transactionline tl
        WHERE tl.transaction = t.id ${lineFilter}
      ) AS itemcount,
      (
        SELECT MIN(BUILTIN.DF(tl.item)) FROM transactionline tl
        WHERE tl.transaction = t.id ${lineFilter}
      ) AS itemname,
      (
        SELECT MIN(i.displayname) FROM transactionline tl
        INNER JOIN item i ON i.id = tl.item
        WHERE tl.transaction = t.id ${lineFilter}
      ) AS firstitemdisplayname,
      (
        SELECT MAX(BUILTIN.DF(ful.trackingnumberlist))
        FROM transaction ful
        INNER JOIN transactionline ftl
          ON ftl.transaction = ful.id AND ftl.mainline = 'T'
        WHERE ful.type = 'ItemShip' AND ftl.createdfrom = t.id
      ) AS trackingnumber,`;
  }

  return `(
        SELECT COUNT(*) FROM transactionline tl
        WHERE tl.transaction = t.id ${lineFilter}
      ) AS itemcount,
      (
        SELECT sub.itemname FROM (
          SELECT BUILTIN.DF(tl.item) AS itemname FROM transactionline tl
          WHERE tl.transaction = t.id ${lineFilter}
          ORDER BY tl.id ASC
        ) sub WHERE ROWNUM <= 1
      ) AS itemname,
      (
        SELECT sub.displayname FROM (
          SELECT i.displayname AS displayname FROM transactionline tl
          INNER JOIN item i ON i.id = tl.item
          WHERE tl.transaction = t.id ${lineFilter}
          ORDER BY tl.id ASC
        ) sub WHERE ROWNUM <= 1
      ) AS firstitemdisplayname,
      (
        SELECT sub.trackingnumber FROM (
          SELECT BUILTIN.DF(ful.trackingnumberlist) AS trackingnumber
          FROM transaction ful
          INNER JOIN transactionline ftl
            ON ftl.transaction = ful.id AND ftl.mainline = 'T'
          WHERE ful.type = 'ItemShip' AND ftl.createdfrom = t.id
          ORDER BY ful.trandate DESC
        ) sub WHERE ROWNUM <= 1
      ) AS trackingnumber,`;
}

/**
 * Build a sales-order SuiteQL statement.
 * Joins: transaction t -> customer c (entity), optional shipping address,
 * optional TransactionShipment (shipping method), opportunity, custom body fields,
 * and line-enrichment sub-selects (item count/name, ItemShip tracking number).
 */
function buildSalesOrdersQuery(programFilter, orderId, options, listFilter = '', orderBySql = 'ORDER BY t.lastmodifieddate DESC') {
  const orderFilter = orderId ? `AND t.id = ${normalizeInternalId(orderId)}` : '';

  const shippingJoin = options.includeShipping
    ? `LEFT JOIN CustomerAddressBookEntityAddress shipaddr ON shipaddr.nkey = c.defaultshippingaddress`
    : '';
  const shipmentJoin = options.includeShipmentJoin
    ? `LEFT JOIN TransactionShipment ts ON ts.doc = t.id`
    : '';
  const shippingSelect = options.includeShipping
    ? `shipaddr.addressee AS shipaddressee,
        shipaddr.addr1 AS shipstreet,
        shipaddr.city AS shipcity,
        shipaddr.state AS shipstate,
        shipaddr.zip AS shipzip,`
    : '';
  const shipmentSelect = options.includeShipmentJoin
    ? `BUILTIN.DF(ts.shippingmethod) AS shippingmethod,`
    : '';
  const opportunitySelect = options.includeOpportunity
    ? `BUILTIN.DF(t.opportunity) AS opportunityname,`
    : '';
  const customFieldSelect = options.customFieldSet
    ? `t.${options.customFieldSet.orderType} AS ordertype,
        t.${options.customFieldSet.styleDescription} AS styledescription,
        t.${options.customFieldSet.additionalDescription} AS additionaldescription,`
    : '';
  const enrichmentSelect = options.includeEnrichment
    ? buildEnrichmentSelect(options.enrichmentAggregate === true)
    : '';

  return `
    SELECT
      t.id,
      t.tranid,
      t.status,
      t.trandate,
      t.createddate,
      t.lastmodifieddate,
      t.entity,
      BUILTIN.DF(t.status) as statusname,
      BUILTIN.DF(t.entity) as customername,
      t.memo,
      t.otherrefnum,
      t.foreigntotal,
      ${opportunitySelect}
      ${customFieldSelect}
      ${shipmentSelect}
      ${shippingSelect}
      ${enrichmentSelect}
      c.companyname,
      c.email,
      c.phone,
      c.entityid,
      c.isperson,
      c.custentity_ra_legacy_sfc_number as programid
    FROM transaction t
    LEFT JOIN customer c ON t.entity = c.id
    ${shippingJoin}
    ${shipmentJoin}
    WHERE t.type = '${SALES_ORDER_TYPE}'
    ${programFilter}
    ${orderFilter}
    ${listFilter}
    ${orderBySql}
  `;
}

// Ordered variant options (richest -> simplest), without custom fields first.
function getSalesOrderQueryAttempts(forDetail) {
  const full = {
    includeShipping: true,
    includeShipmentJoin: forDetail,
    includeEnrichment: true,
    includeOpportunity: true,
  };

  const withCustom = SALES_ORDER_CUSTOM_FIELD_CANDIDATES.map((customFieldSet) => ({
    ...full,
    customFieldSet,
  }));

  const withoutCustom = [
    { ...full, includeShipmentJoin: false, enrichmentAggregate: true },
    { ...full, includeShipmentJoin: false },
    { ...full },
    { ...full, includeShipmentJoin: false, includeEnrichment: false },
    { includeShipping: true, includeShipmentJoin: false, includeEnrichment: false, includeOpportunity: false },
    { includeShipping: false, includeShipmentJoin: false, includeEnrichment: false, includeOpportunity: false },
  ];

  return [...withoutCustom, ...withCustom];
}

function describeOptions(o) {
  return [
    `shipping=${o.includeShipping}`,
    `shipment=${o.includeShipmentJoin || false}`,
    `enrichment=${o.includeEnrichment}`,
    `opportunity=${o.includeOpportunity}`,
    `customFields=${(o.customFieldSet && o.customFieldSet.orderType) || 'none'}`,
    `aggregate=${o.enrichmentAggregate || false}`,
  ].join(', ');
}

// ── order line items ──

function buildOrderLineItemsQuery(orderId, options) {
  const safeOrderId = normalizeInternalId(orderId);
  const fulfillmentSelect = options.includeFulfillmentQuantities
    ? `tl.quantitypicked,
        tl.quantitypacked,
        tl.quantityfulfilled,
        tl.quantitybilled,`
    : '';
  const lineStatusSelect = options.includeLineStatus ? `tl.isclosed as linestatus,` : '';

  return `
    SELECT
      tl.id,
      tl.transaction,
      tl.item,
      tl.quantity,
      ${fulfillmentSelect}
      tl.rate as unitprice,
      tl.amount as linetotal,
      tl.taxline,
      tl.mainline,
      ${lineStatusSelect}
      i.itemid as itemcode,
      BUILTIN.DF(tl.item) as itemdisplayname,
      i.displayname as itemname
    FROM transactionline tl
    LEFT JOIN item i ON tl.item = i.id
    WHERE tl.transaction = ${safeOrderId}
      AND tl.mainline = 'F'
      AND tl.taxline = 'F'
    ORDER BY tl.id ASC
  `;
}

function getOrderLineItemAttempts() {
  return [
    { includeFulfillmentQuantities: false, includeLineStatus: true },
    { includeFulfillmentQuantities: false, includeLineStatus: false },
    { includeFulfillmentQuantities: true, includeLineStatus: true },
  ];
}

// ── customers / items / programs ──

function buildCustomerByIdQuery(customerId) {
  const safeId = normalizeInternalId(customerId);
  return `
    SELECT
      c.id,
      c.entityid,
      c.companyname,
      c.email,
      c.phone,
      c.defaultbillingaddress,
      c.defaultshippingaddress,
      BUILTIN.DF(c.defaultbillingaddress) AS defaultbillingaddresstext,
      BUILTIN.DF(c.defaultshippingaddress) AS defaultshippingaddresstext,
      c.datecreated,
      c.lastmodifieddate
    FROM customer c
    WHERE c.id = ${safeId}
  `;
}

function buildItemsQuery() {
  return 'SELECT * FROM item';
}

function buildItemByIdQuery(itemId) {
  const safeItemId = normalizeInternalId(itemId);
  return `SELECT * FROM item WHERE id = ${safeItemId}`;
}

// Program-type custom field candidates for the sync fetch.
const PROGRAM_TYPE_FIELD_CANDIDATES = [
  { typeField: 'custentity_ra_account_type', subTypeField: 'custentity_ra_account_subtype' },
  { typeField: 'custentity_program_type', subTypeField: 'custentity_program_subtype' },
];

// Build the customer fetch used by the program sync. `options` selects optional
// program type/subtype custom fields (tried via the candidate fallback).
function buildFetchProgramsQuery(options) {
  const optional = [];
  if (options && options.typeField) {
    optional.push(`BUILTIN.DF(c.${options.typeField}) AS programtype`);
  }
  if (options && options.subTypeField) {
    optional.push(`BUILTIN.DF(c.${options.subTypeField}) AS programsubtype`);
  }
  const optionalSelect = optional.length ? `,\n          ${optional.join(',\n          ')}` : '';

  return `
    SELECT
      c.id,
      c.entityid,
      c.companyname,
      c.email,
      c.phone,
      c.firstname,
      c.lastname,
      c.isperson,
      c.isinactive,
      c.datecreated,
      c.lastmodifieddate,
      c.custentity_ra_primary_contact_email,
      c.custentity_ra_primary_contact_first_name,
      c.custentity_ra_primary_contact_last_name,
      c.custentity_ra_primary_contact_id,
      c.custentity_ra_primary_contact_full_name,
      c.custentity_ra_legacy_sfc_number${optionalSelect},
      shipaddr.addr1 AS shippingstreet,
      shipaddr.city AS shippingcity,
      shipaddr.state AS shippingstate,
      shipaddr.zip AS shippingzip,
      billaddr.addr1 AS billingstreet,
      billaddr.city AS billingcity,
      billaddr.state AS billingstate,
      billaddr.zip AS billingzip
    FROM customer c
    LEFT JOIN CustomerAddressBookEntityAddress shipaddr
      ON shipaddr.nkey = c.defaultshippingaddress
    LEFT JOIN CustomerAddressBookEntityAddress billaddr
      ON billaddr.nkey = c.defaultbillingaddress
    ORDER BY c.lastmodifieddate DESC
  `;
}

module.exports = {
  // constants
  SALES_ORDERS_DEFAULT_LIMIT,
  SALES_ORDERS_MAX_LIMIT,
  NETSUITE_STATUS_CODE_MAP,
  STATUS_CODE_VALUES,
  ORDER_STATUS_VALUES,
  SORT_BY_VALUES,
  SORT_DIR_VALUES,
  DELIVERY_VALUES,
  PROGRAM_TYPE_FIELD_CANDIDATES,
  // normalisation + safety
  normalizeSalesOrdersLimit,
  normalizeSalesOrdersOffset,
  normalizeInternalId,
  escapeSuiteQLString,
  sanitizeSearchTerm,
  // filters / sort
  resolveStatusCodeFilter,
  resolveDeliveryFilter,
  buildSalesOrdersListFilterSql,
  buildSalesOrdersOrderBySql,
  buildProgramIdsFilter,
  // builders
  buildSalesOrdersQuery,
  getSalesOrderQueryAttempts,
  describeOptions,
  buildOrderLineItemsQuery,
  getOrderLineItemAttempts,
  buildCustomerByIdQuery,
  buildItemsQuery,
  buildItemByIdQuery,
  buildFetchProgramsQuery,
};
