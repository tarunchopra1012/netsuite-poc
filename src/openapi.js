'use strict';

// REQUIREMENT 3 — OpenAPI 3 spec built in code (kept in one place so it never
// drifts from the routes). Mounted as interactive Swagger UI at /docs.

const { Config } = require('./config');
const queries = require('./queries');

const shippingInfoSchema = {
  type: 'object',
  properties: {
    address: { type: 'string', nullable: true },
    street: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    state: { type: 'string', nullable: true },
    zip: { type: 'string', nullable: true },
  },
};

const lineItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: '50011' },
    itemId: { type: 'string', nullable: true, example: '9001' },
    itemCode: { type: 'string', nullable: true, example: 'JER-PRO' },
    itemName: { type: 'string', nullable: true, example: 'Pro Series Jersey - Royal' },
    quantity: { type: 'number', example: 16 },
    picked: { type: 'number', example: 0 },
    packed: { type: 'number', example: 0 },
    fulfilled: { type: 'number', example: 0 },
    invoiced: { type: 'number', example: 0 },
    unitPrice: { type: 'number', nullable: true, example: 95 },
    lineTotal: { type: 'number', nullable: true, example: 1520 },
  },
};

const listItemSchema = {
  type: 'object',
  properties: {
    orderId: { type: 'string', example: '3091' },
    orderNumber: { type: 'string', example: 'SO-100345' },
    customerName: { type: 'string', nullable: true, example: 'Prodigy All Stars' },
    opportunityName: { type: 'string', nullable: true, example: 'Prodigy 2026 Team Package' },
    memo: { type: 'string', nullable: true },
    itemName: { type: 'string', nullable: true, example: 'Pro Series Jersey' },
    orderType: { type: 'string', nullable: true, example: 'Team Uniform' },
    date: { type: 'string', nullable: true, example: '2026-06-18' },
    items: { type: 'integer', example: 3 },
    delivery: { type: 'string', enum: queries.DELIVERY_VALUES, example: 'Bulk' },
    deliveryLabel: { type: 'string', example: 'Bulk Order' },
    statusCode: { type: 'string', nullable: true, example: 'B' },
    orderStatus: { type: 'string', example: 'Pending Fulfillment' },
    shipping: shippingInfoSchema,
    tracking: { type: 'string', nullable: true },
    programId: { type: 'string', nullable: true, example: 'A-00001516' },
    customerInternalId: { type: 'string', nullable: true, example: '2006' },
    entity: { type: 'string', nullable: true, example: '2006' },
    total: { type: 'number', nullable: true, example: 4820 },
  },
};

const detailSchema = {
  allOf: [
    listItemSchema,
    {
      type: 'object',
      properties: {
        poNumber: { type: 'string', nullable: true, example: 'PO-7781' },
        styleDescription: { type: 'string', nullable: true },
        additionalDescription: { type: 'string', nullable: true },
        createdDate: { type: 'string', nullable: true },
        lastModifiedDate: { type: 'string', nullable: true },
        shippingDetail: {
          type: 'object',
          properties: {
            shipDateActual: { type: 'string', nullable: true },
            carrier: { type: 'string', nullable: true },
            method: { type: 'string', nullable: true, example: 'UPS Ground' },
            shipComplete: { type: 'boolean' },
            shipTo: {
              type: 'object',
              properties: {
                addressee: { type: 'string', nullable: true },
                street: { type: 'string', nullable: true },
                city: { type: 'string', nullable: true },
                state: { type: 'string', nullable: true },
                zip: { type: 'string', nullable: true },
                display: { type: 'string', nullable: true },
              },
            },
          },
        },
        lineItems: { type: 'array', items: lineItemSchema },
      },
    },
  ],
};

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string', example: 'Sales order 999 not found' } },
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'NetSuite Integration POC',
    version: '1.0.0',
    description:
      'Standalone Express POC that mirrors the Team Shop Plus NetSuite integration: ' +
      'OAuth JWT + Redis token cache, SuiteQL with query-variant fallback, two-level retry, ' +
      'mock/auto fallback when the sandbox is down, and an idempotent NetSuite→Postgres program sync. ' +
      'Every response carries an `x-data-source: live|mock` header.',
  },
  servers: [{ url: '/', description: 'this server' }],
  tags: [
    { name: 'Orders', description: 'NetSuite sales orders' },
    { name: 'Customers', description: 'NetSuite customers' },
    { name: 'Items', description: 'NetSuite item master' },
    { name: 'Sync', description: 'NetSuite → Postgres program sync' },
    { name: 'Programs', description: 'Synced programs (from Postgres)' },
    { name: 'System', description: 'Health & diagnostics' },
  ],
  paths: {
    '/netsuite/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List sales orders (paginated, searchable, filterable)',
        parameters: [
          { name: 'programId', in: 'query', required: false, schema: { type: 'string' }, example: 'A-00001516', description: 'Optional program filter (entityid / legacy SFC / numeric customer id).' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50, maximum: 1000 }, example: 2 },
          { name: 'offset', in: 'query', required: false, schema: { type: 'integer', default: 0 } },
          { name: 'search', in: 'query', required: false, schema: { type: 'string' }, description: 'Order number, customer name, or opportunity name.' },
          { name: 'sortBy', in: 'query', required: false, schema: { type: 'string', enum: queries.SORT_BY_VALUES } },
          { name: 'sortDir', in: 'query', required: false, schema: { type: 'string', enum: queries.SORT_DIR_VALUES, default: 'DESC' } },
          { name: 'statusCode', in: 'query', required: false, schema: { type: 'string', enum: queries.STATUS_CODE_VALUES }, description: 'NetSuite status code A–H.' },
          { name: 'orderStatus', in: 'query', required: false, schema: { type: 'string', enum: queries.ORDER_STATUS_VALUES }, description: 'Status label (ignored when statusCode is set).' },
          { name: 'delivery', in: 'query', required: false, schema: { type: 'string', enum: queries.DELIVERY_VALUES } },
        ],
        responses: {
          200: {
            description: 'Paginated list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer', example: 2 },
                    total: { type: 'integer', example: 5 },
                    offset: { type: 'integer', example: 0 },
                    limit: { type: 'integer', example: 2 },
                    nextOffset: { type: 'integer', nullable: true, example: 2 },
                    hasMore: { type: 'boolean', example: true },
                    items: { type: 'array', items: listItemSchema },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/netsuite/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Sales order detail (header + line items)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '3091' }],
        responses: {
          200: { description: 'Order detail', content: { 'application/json': { schema: detailSchema } } },
          404: { description: 'Not found', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/netsuite/orders/{id}/lines': {
      get: {
        tags: ['Orders'],
        summary: 'Order line items',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '3091' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: {
            description: 'Lines',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { count: { type: 'integer' }, items: { type: 'array', items: lineItemSchema } },
                },
              },
            },
          },
        },
      },
    },
    '/netsuite/customers/{programId}': {
      get: {
        tags: ['Customers'],
        summary: 'Customer by NetSuite internal id',
        parameters: [{ name: 'programId', in: 'path', required: true, schema: { type: 'string' }, example: '2006' }],
        responses: {
          200: { description: 'Customer' },
          404: { description: 'Not found', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/netsuite/items': {
      get: {
        tags: ['Items'],
        summary: 'Item master list',
        parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } }],
        responses: { 200: { description: 'Items' } },
      },
    },
    '/netsuite/items/{itemId}': {
      get: {
        tags: ['Items'],
        summary: 'Item detail',
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' }, example: '9001' }],
        responses: {
          200: { description: 'Item' },
          404: { description: 'Not found', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/netsuite/sync/programs': {
      post: {
        tags: ['Sync'],
        summary: 'Run the NetSuite → Postgres program sync (idempotent upsert)',
        responses: {
          200: {
            description: 'Sync summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalFetched: { type: 'integer', example: 4 },
                    upserted: { type: 'integer', example: 3 },
                    inserted: { type: 'integer', example: 3 },
                    updated: { type: 'integer', example: 0 },
                    skipped: { type: 'integer', example: 1 },
                    source: { type: 'string', enum: ['live', 'mock'], example: 'mock' },
                  },
                },
              },
            },
          },
          409: { description: 'A sync is already running', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/netsuite/sync/programs/status': {
      get: {
        tags: ['Sync'],
        summary: 'Last program sync status',
        responses: { 200: { description: 'Status' } },
      },
    },
    '/programs': {
      get: {
        tags: ['Programs'],
        summary: 'List synced programs from Postgres (proves the sync persisted)',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', required: false, schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Programs from Postgres' } },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health: mode, NetSuite reachability, Redis, Postgres',
        responses: {
          200: {
            description: 'Healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    mode: { type: 'string', example: Config.Mode },
                    netsuiteReachable: { type: 'boolean', example: false },
                    redis: { type: 'boolean', example: true },
                    postgres: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = { spec };
