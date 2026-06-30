'use strict';

const express = require('express');
const dataSource = require('../dataSource');
const queries = require('../queries');
const { mapSalesOrderListItem, mapSalesOrderDetail } = require('../mappers');
const { getNextOffset, setSourceHeader, asyncHandler } = require('./helpers');
const { ApiError } = require('../errors');

const router = express.Router();

// GET /netsuite/orders — paginated/filtered/searchable sales orders list.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = queries.normalizeSalesOrdersLimit(req.query.limit);
    const offset = queries.normalizeSalesOrdersOffset(req.query.offset);

    const query = {
      // programId is optional in the POC so Swagger "Try it out" works with no params.
      programIds: req.query.programId ? [String(req.query.programId)] : undefined,
      limit,
      offset,
      search: req.query.search,
      statusCode: req.query.statusCode,
      orderStatus: req.query.orderStatus,
      delivery: req.query.delivery,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
    };

    const { source, response } = await dataSource.getSalesOrders(query);
    setSourceHeader(res, source);

    const items = (response.items || []).map(mapSalesOrderListItem);
    const total = response.totalResults != null ? response.totalResults : items.length;

    res.json({
      count: items.length,
      total,
      offset: response.offset != null ? response.offset : offset,
      limit,
      nextOffset: getNextOffset(limit, offset, total),
      hasMore: Boolean(response.hasMore) || offset + limit < total,
      items,
    });
  }),
);

// GET /netsuite/orders/:id — sales order detail (header + line items).
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Validate numeric internal id up front -> clean 400.
    try {
      queries.normalizeInternalId(id);
    } catch {
      throw new ApiError(400, `Invalid order id: ${id}`);
    }

    const [{ source: hSource, response: header }, { source: lSource, response: lines }] =
      await Promise.all([
        dataSource.getSalesOrderDetail(id),
        dataSource.getOrderLines(id, 500),
      ]);

    setSourceHeader(res, hSource === 'live' && lSource === 'live' ? 'live' : hSource);

    const headerRow = header.items && header.items[0];
    if (!headerRow) {
      throw new ApiError(404, `Sales order ${id} not found`);
    }

    res.json(mapSalesOrderDetail(headerRow, lines.items || []));
  }),
);

// GET /netsuite/orders/:id/lines — order line items only.
router.get(
  '/:id/lines',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    try {
      queries.normalizeInternalId(id);
    } catch {
      throw new ApiError(400, `Invalid order id: ${id}`);
    }
    const limit = queries.normalizeSalesOrdersLimit(req.query.limit);

    const { source, response } = await dataSource.getOrderLines(id, limit);
    setSourceHeader(res, source);

    const { mapSalesOrderLineItem } = require('../mappers');
    const items = (response.items || []).map(mapSalesOrderLineItem);
    res.json({ count: items.length, items });
  }),
);

module.exports = router;
