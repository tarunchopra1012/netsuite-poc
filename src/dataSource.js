'use strict';

// ─────────────────────────────────────────────────────────────
// REQUIREMENT 2 — single switch point for live NetSuite vs mock data.
// Route handlers call these functions and never know which source served them;
// only this file differs. Each function returns:
//     { source: 'live' | 'mock', response: <SuiteQL-shaped envelope> }
// where the envelope is { items, count, totalResults, hasMore, offset } — exactly
// the shape live SuiteQL returns — so the SAME mappers run on either source.
// ─────────────────────────────────────────────────────────────

const { Config } = require('./config');
const client = require('./netsuiteClient');
const queries = require('./queries');
const mock = require('./mockData');

const MODE = Config.Mode; // live | mock | auto

function envelope(items, { offset = 0, total } = {}) {
  const list = items || [];
  return {
    links: [],
    count: list.length,
    hasMore: false,
    items: list,
    offset,
    totalResults: total != null ? total : list.length,
  };
}

// ── health ──

// True if we even have enough config + a working OAuth handshake to call NetSuite.
async function isNetSuiteReachable() {
  if (!Config.NetSuite.IsConfigured) return false;
  try {
    // A token mint exercises OAuth + Redis cache without hitting SuiteQL.
    const { getAccessToken } = require('./netsuiteAuth');
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}

// Decide whether a given call should use live. In 'auto' we attempt live and let
// the caller fall back; this just encodes the hard modes.
function forcedSource() {
  if (MODE === 'mock') return 'mock';
  if (MODE === 'live') return 'live';
  return 'auto';
}

// Wrap a live attempt with auto-fallback to a mock builder.
// In 'mock' mode we skip live entirely. In 'live' mode we never fall back.
async function withFallback(liveFn, mockFn, label) {
  const mode = forcedSource();

  if (mode === 'mock') {
    return { source: 'mock', response: mockFn() };
  }

  if (mode === 'live') {
    return { source: 'live', response: await liveFn() };
  }

  // auto: try live, fall back to mock on any failure (sandbox down, network, etc.)
  if (!Config.NetSuite.IsConfigured) {
    return { source: 'mock', response: mockFn() };
  }
  try {
    return { source: 'live', response: await liveFn() };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[dataSource] live ${label} failed (${err.message}); falling back to mock.`);
    return { source: 'mock', response: mockFn() };
  }
}

// ── mock query engine (mirrors the SuiteQL filters/sort/pagination) ──

function filterAndPageSalesOrders(query) {
  const {
    programIds,
    search,
    statusCode,
    orderStatus,
    delivery,
    sortBy,
    sortDir,
  } = query;
  const limit = queries.normalizeSalesOrdersLimit(query.limit);
  const offset = queries.normalizeSalesOrdersOffset(query.offset);

  let rows = mock.salesOrderRows.slice();

  // program filter (match entityid / legacy SFC / numeric id)
  if (Array.isArray(programIds) && programIds.length > 0) {
    const ids = programIds.map((x) => String(x).trim());
    rows = rows.filter(
      (r) =>
        ids.includes(String(r.entityid)) ||
        ids.includes(String(r.programid)) ||
        ids.includes(String(r.entity)),
    );
  }

  // search across order number / customer / opportunity
  const term = queries.sanitizeSearchTerm(search).toUpperCase();
  if (term) {
    rows = rows.filter((r) =>
      [r.tranid, r.companyname, r.opportunityname]
        .map((v) => String(v || '').toUpperCase())
        .some((v) => v.includes(term)),
    );
  }

  // status filter (code or label)
  const code = queries.resolveStatusCodeFilter(statusCode, orderStatus);
  if (code) {
    rows = rows.filter((r) => String(r.status).toUpperCase() === code);
  }

  // delivery filter
  const del = queries.resolveDeliveryFilter(delivery);
  if (del === 'IPP') {
    rows = rows.filter((r) => String(r.isperson).toUpperCase() === 'T');
  } else if (del === 'Bulk') {
    rows = rows.filter((r) => String(r.isperson).toUpperCase() !== 'T');
  }

  // sort
  const sortField =
    (sortBy || '').toLowerCase() === 'orderid'
      ? 'id'
      : (sortBy || '').toLowerCase() === 'date'
        ? 'trandate'
        : 'lastmodifieddate';
  const dir = (sortDir || '').toUpperCase() === 'ASC' ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });

  const total = rows.length;
  const paged = rows.slice(offset, offset + limit);
  return envelope(paged, { offset, total });
}

// ── public data accessors ──

async function getSalesOrders(query) {
  const safeLimit = queries.normalizeSalesOrdersLimit(query.limit);
  const safeOffset = queries.normalizeSalesOrdersOffset(query.offset);

  const liveFn = async () => {
    const programFilter =
      Array.isArray(query.programIds) && query.programIds.length > 0
        ? queries.buildProgramIdsFilter(query.programIds)
        : '';
    const listFilter = queries.buildSalesOrdersListFilterSql({
      search: query.search,
      statusCode: query.statusCode,
      orderStatus: query.orderStatus,
      delivery: query.delivery,
    });
    const orderBySql = queries.buildSalesOrdersOrderBySql(query.sortBy, query.sortDir);

    return client.executeSuiteQLWithVariants({
      limit: safeLimit,
      offset: safeOffset,
      logLabel: 'sales-orders',
      attempts: queries.getSalesOrderQueryAttempts(false).map((options) => ({
        label: queries.describeOptions(options),
        buildQuery: () =>
          queries.buildSalesOrdersQuery(programFilter, undefined, options, listFilter, orderBySql),
      })),
    });
  };

  return withFallback(liveFn, () => filterAndPageSalesOrders(query), 'sales-orders');
}

async function getSalesOrderDetail(orderId) {
  const liveFn = async () => {
    return client.executeSuiteQLWithVariants({
      limit: 1,
      offset: 0,
      logLabel: 'sales-order-detail',
      attempts: queries.getSalesOrderQueryAttempts(true).map((options) => ({
        label: queries.describeOptions(options),
        buildQuery: () =>
          queries.buildSalesOrdersQuery('', orderId, options, '', 'ORDER BY t.lastmodifieddate DESC'),
      })),
    });
  };

  const mockFn = () => {
    const row = mock.salesOrderRows.find((r) => String(r.id) === String(orderId));
    return envelope(row ? [row] : []);
  };

  return withFallback(liveFn, mockFn, 'sales-order-detail');
}

async function getOrderLines(orderId, limit = 500) {
  const liveFn = async () => {
    return client.executeSuiteQLWithVariants({
      limit: queries.normalizeSalesOrdersLimit(limit),
      offset: 0,
      logLabel: 'order-lines',
      attempts: queries.getOrderLineItemAttempts().map((options) => ({
        label: `fulfillment=${options.includeFulfillmentQuantities}, lineStatus=${options.includeLineStatus}`,
        buildQuery: () => queries.buildOrderLineItemsQuery(orderId, options),
      })),
    });
  };

  const mockFn = () => envelope(mock.orderLinesByOrderId[String(orderId)] || []);

  return withFallback(liveFn, mockFn, 'order-lines');
}

async function getCustomerById(customerId) {
  const liveFn = async () =>
    client.executeSuiteQLWithEmptyFallback(
      queries.buildCustomerByIdQuery(customerId),
      1,
      'customer-by-id',
    );

  const mockFn = () => {
    const row = mock.customersById[String(customerId)];
    return envelope(row ? [row] : []);
  };

  return withFallback(liveFn, mockFn, 'customer-by-id');
}

async function getItems(limit = 50) {
  const liveFn = async () =>
    client.executeSuiteQLWithEmptyFallback(
      queries.buildItemsQuery(),
      queries.normalizeSalesOrdersLimit(limit),
      'items',
    );

  const mockFn = () => envelope(mock.items.slice(0, queries.normalizeSalesOrdersLimit(limit)), {
    total: mock.items.length,
  });

  return withFallback(liveFn, mockFn, 'items');
}

async function getItemById(itemId) {
  const liveFn = async () =>
    client.executeSuiteQLWithEmptyFallback(
      queries.buildItemByIdQuery(itemId),
      1,
      'item-by-id',
    );

  const mockFn = () => {
    const row = mock.items.find((i) => String(i.id) === String(itemId));
    return envelope(row ? [row] : []);
  };

  return withFallback(liveFn, mockFn, 'item-by-id');
}

// Used by the program sync. Returns one page of raw customer rows.
async function getProgramCustomers({ limit, offset }) {
  const liveFn = async () => {
    const attempts = [{}, ...queries.PROGRAM_TYPE_FIELD_CANDIDATES];
    return client.executeSuiteQLWithVariants({
      limit,
      offset,
      logLabel: 'program-sync',
      attempts: attempts.map((candidate) => ({
        label: JSON.stringify(candidate),
        buildQuery: () => queries.buildFetchProgramsQuery(candidate),
      })),
    });
  };

  const mockFn = () => {
    const all = mock.programCustomerRows;
    const page = all.slice(offset, offset + limit);
    return envelope(page, { offset, total: all.length });
  };

  return withFallback(liveFn, mockFn, 'program-sync');
}

module.exports = {
  MODE,
  isNetSuiteReachable,
  getSalesOrders,
  getSalesOrderDetail,
  getOrderLines,
  getCustomerById,
  getItems,
  getItemById,
  getProgramCustomers,
};
