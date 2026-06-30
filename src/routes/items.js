'use strict';

const express = require('express');
const dataSource = require('../dataSource');
const queries = require('../queries');
const { setSourceHeader, asyncHandler } = require('./helpers');
const { ApiError } = require('../errors');

const router = express.Router();

// GET /netsuite/items — item master list.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = queries.normalizeSalesOrdersLimit(req.query.limit);
    const { source, response } = await dataSource.getItems(limit);
    setSourceHeader(res, source);
    res.json({
      count: (response.items || []).length,
      total: response.totalResults != null ? response.totalResults : (response.items || []).length,
      items: response.items || [],
    });
  }),
);

// GET /netsuite/items/:itemId — item detail.
router.get(
  '/:itemId',
  asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    try {
      queries.normalizeInternalId(itemId);
    } catch {
      throw new ApiError(400, `Invalid item id: ${itemId}`);
    }
    const { source, response } = await dataSource.getItemById(itemId);
    setSourceHeader(res, source);

    const item = response.items && response.items[0];
    if (!item) {
      throw new ApiError(404, `Item ${itemId} not found`);
    }
    res.json(item);
  }),
);

module.exports = router;
