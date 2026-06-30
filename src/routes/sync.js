'use strict';

const express = require('express');
const { runProgramSync } = require('../sync/programSync');
const { setSourceHeader, asyncHandler } = require('./helpers');

const router = express.Router();

// Tracks the last sync result so a status GET can report it (demo talking point).
let lastSync = null;
let running = false;

// POST /netsuite/sync/programs — run the NetSuite -> Postgres program sync.
router.post(
  '/programs',
  asyncHandler(async (req, res) => {
    if (running) {
      return res.status(409).json({ error: 'A program sync is already running' });
    }
    running = true;
    try {
      const summary = await runProgramSync();
      lastSync = { ...summary, finishedAt: new Date().toISOString() };
      setSourceHeader(res, summary.source);
      return res.json(summary);
    } finally {
      running = false;
    }
  }),
);

// GET /netsuite/sync/programs/status — last sync summary + whether one is running.
router.get('/programs/status', (req, res) => {
  res.json({ running, lastSync });
});

module.exports = router;
