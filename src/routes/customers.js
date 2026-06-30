'use strict';

const express = require('express');
const dataSource = require('../dataSource');
const queries = require('../queries');
const { setSourceHeader, asyncHandler } = require('./helpers');
const { ApiError } = require('../errors');

const router = express.Router();

// GET /netsuite/customers/:programId — customer by NetSuite internal id.
// (Named :programId to match the real controller's route param.)
router.get(
  '/:programId',
  asyncHandler(async (req, res) => {
    const { programId } = req.params;
    try {
      queries.normalizeInternalId(programId);
    } catch {
      throw new ApiError(400, `Invalid customer internal id: ${programId}`);
    }

    const { source, response } = await dataSource.getCustomerById(programId);
    setSourceHeader(res, source);

    const customer = response.items && response.items[0];
    if (!customer) {
      throw new ApiError(404, `Customer ${programId} not found`);
    }
    res.json(customer);
  }),
);

module.exports = router;
