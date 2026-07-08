// ─────────────────────────────────────────────────────────────
// SuiteQL builders + input sanitisation.
// 1:1 TypeScript port of src/queries.js — the SuiteQL strings, the status-code
// map, and the sanitisation MUST stay byte-identical to the legacy Express app.
// ─────────────────────────────────────────────────────────────

export const SALES_ORDERS_DEFAULT_LIMIT = 50;
export const SALES_ORDERS_MAX_LIMIT = 1000;
const SALES_ORDER_TYPE = 'SalesOrd';

// NetSuite status code -> display label (transaction.status).
export const NETSUITE_STATUS_CODE_MAP: Record<string, string> = {
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
const ORDER_STATUS_LABEL_TO_CODE: Record<string, string> = {
  'pending approval': 'A',
  'pending fulfillment': 'B',
  cancelled: 'C',
  'partially fulfilled': 'D',
  'pending billing / partially fulfilled': 'E',
  'pending billing': 'F',
  billed: 'G',
  closed: 'H',
};

export const STATUS_CODE_VALUES = Object.keys(NETSUITE_STATUS_CODE_MAP);
export const ORDER_STATUS_VALUES = Object.values(NETSUITE_STATUS_CODE_MAP);
export const SORT_BY_VALUES = ['orderId', 'date'];
export const SORT_DIR_VALUES = ['ASC', 'DESC'];
export const DELIVERY_VALUES = ['Bulk', 'IPP'];

export interface SalesOrdersListFilters {
  search?: unknown;
  statusCode?: unknown;
  orderStatus?: unknown;
  delivery?: unknown;
}

export interface CustomFieldSet {
  orderType: string;
  styleDescription: string;
  additionalDescription: string;
}

export interface SalesOrderQueryOptions {
  includeShipping?: boolean;
  includeShipmentJoin?: boolean;
  includeEnrichment?: boolean;
  includeOpportunity?: boolean;
  customFieldSet?: CustomFieldSet;
  enrichmentAggregate?: boolean;
}

export interface OrderLineItemQueryOptions {
  includeFulfillmentQuantities: boolean;
  includeLineStatus: boolean;
}

export interface ProgramTypeFieldCandidate {
  typeField?: string;
  subTypeField?: string;
}

// ── normalisation ──

export function normalizeSalesOrdersLimit(limit: unknown): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return SALES_ORDERS_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), SALES_ORDERS_MAX_LIMIT);
}

export function normalizeSalesOrdersOffset(offset: unknown): number {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// Validate/normalise a NetSuite internal id (positive integer). Throws on bad input.
export function normalizeInternalId(id: unknown): number {
  const parsed = Number.parseInt(String(id), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid NetSuite internal id: ${id}`);
  }
  return parsed;
}

// ── injection-safe helpers ──

// Escape single quotes for SuiteQL string literals ( ' -> '' ).
export function escapeSuiteQLString(value: unknown): string {
  return String(value).replace(/'/g, "''");
}

// Strip LIKE wildcards (% and _) and trim before wrapping in %...%.
export function sanitizeSearchTerm(value: unknown): string {
  return String(value || '')
    .replace(/[%_]/g, '')
    .trim();
}

function buildLikePattern(term: string): string {
  const pattern = `%${sanitizeSearchTerm(term).toUpperCase()}%`;
  return `'${escapeSuiteQLString(pattern)}'`;
}

// ── filter / sort resolution ──

export function resolveStatusCodeFilter(
  statusCode: unknown,
  orderStatus: unknown,
): string | undefined {
  const code = String(statusCode || '')
    .trim()
    .toUpperCase();
  if (code) return code;
  const label = String(orderStatus || '')
    .trim()
    .toLowerCase();
  if (!label) return undefined;
  return ORDER_STATUS_LABEL_TO_CODE[label];
}

export function resolveDeliveryFilter(delivery: unknown): 'Bulk' | 'IPP' | undefined {
  const normalized = String(delivery || '')
    .trim()
    .toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'bulk') return 'Bulk';
  if (normalized === 'ipp' || normalized === 'individual') return 'IPP';
  return undefined;
}

function resolveSalesOrdersSortBy(sortBy: unknown): string {
  const n = String(sortBy || '')
    .trim()
    .toLowerCase();
  if (n === 'orderid' || n === 'order_id') return 't.id';
  if (n === 'date' || n === 'trandate') return 't.trandate';
  return 't.lastmodifieddate';
}

function resolveSalesOrdersSortDir(sortDir: unknown): 'ASC' | 'DESC' {
  return String(sortDir || '')
    .trim()
    .toUpperCase() === 'ASC'
    ? 'ASC'
    : 'DESC';
}

export function buildSalesOrdersOrderBySql(sortBy: unknown, sortDir: unknown): string {
  return `ORDER BY ${resolveSalesOrdersSortBy(sortBy)} ${resolveSalesOrdersSortDir(sortDir)}`;
}

// Build the AND-clauses for server-side search/filter on the sales-orders list.
export function buildSalesOrdersListFilterSql(filters: SalesOrdersListFilters): string {
  const clauses: string[] = [];

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
export function buildProgramIdsFilter(programIds: unknown[] | undefined): string {
  const trimmed = (programIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (trimmed.length === 0) return '';

  const inList = trimmed.map((id) => `'${escapeSuiteQLString(id)}'`).join(', ');
  const clauses = [`c.entityid IN (${inList})`, `c.custentity_ra_legacy_sfc_number IN (${inList})`];

  const numericIds = trimmed.filter((id) => /^\d+$/.test(id)).map((id) => normalizeInternalId(id));
  if (numericIds.length > 0) {
    clauses.push(`c.id IN (${numericIds.join(', ')})`);
  }

  return `AND (${clauses.join(' OR ')})`;
}

// ── sales-order list / detail query builder ──

// Custom body field candidates tried in the variant fallback.
export const SALES_ORDER_CUSTOM_FIELD_CANDIDATES: CustomFieldSet[] = [
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

function buildEnrichmentSelect(aggregate: boolean): string {
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
export function buildSalesOrdersQuery(
  programFilter: string,
  orderId: unknown,
  options: SalesOrderQueryOptions,
  listFilter = '',
  orderBySql = 'ORDER BY t.lastmodifieddate DESC',
): string {
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
export function getSalesOrderQueryAttempts(forDetail: boolean): SalesOrderQueryOptions[] {
  const full: SalesOrderQueryOptions = {
    includeShipping: true,
    includeShipmentJoin: forDetail,
    includeEnrichment: true,
    includeOpportunity: true,
  };

  const withCustom = SALES_ORDER_CUSTOM_FIELD_CANDIDATES.map((customFieldSet) => ({
    ...full,
    customFieldSet,
  }));

  const withoutCustom: SalesOrderQueryOptions[] = [
    { ...full, includeShipmentJoin: false, enrichmentAggregate: true },
    { ...full, includeShipmentJoin: false },
    { ...full },
    { ...full, includeShipmentJoin: false, includeEnrichment: false },
    {
      includeShipping: true,
      includeShipmentJoin: false,
      includeEnrichment: false,
      includeOpportunity: false,
    },
    {
      includeShipping: false,
      includeShipmentJoin: false,
      includeEnrichment: false,
      includeOpportunity: false,
    },
  ];

  return [...withoutCustom, ...withCustom];
}

export function describeOptions(o: SalesOrderQueryOptions): string {
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

export function buildOrderLineItemsQuery(
  orderId: unknown,
  options: OrderLineItemQueryOptions,
): string {
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

export function getOrderLineItemAttempts(): OrderLineItemQueryOptions[] {
  return [
    { includeFulfillmentQuantities: false, includeLineStatus: true },
    { includeFulfillmentQuantities: false, includeLineStatus: false },
    { includeFulfillmentQuantities: true, includeLineStatus: true },
  ];
}

// ── customers / items / programs ──

export function buildCustomerByIdQuery(customerId: unknown): string {
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

export function buildItemsQuery(): string {
  return 'SELECT * FROM item';
}

export function buildItemByIdQuery(itemId: unknown): string {
  const safeItemId = normalizeInternalId(itemId);
  return `SELECT * FROM item WHERE id = ${safeItemId}`;
}

// Program-type custom field candidates for the sync fetch.
export const PROGRAM_TYPE_FIELD_CANDIDATES: ProgramTypeFieldCandidate[] = [
  { typeField: 'custentity_ra_account_type', subTypeField: 'custentity_ra_account_subtype' },
  { typeField: 'custentity_program_type', subTypeField: 'custentity_program_subtype' },
];

// Build the customer fetch used by the program sync. `options` selects optional
// program type/subtype custom fields (tried via the candidate fallback).
export function buildFetchProgramsQuery(options?: ProgramTypeFieldCandidate): string {
  const optional: string[] = [];
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
