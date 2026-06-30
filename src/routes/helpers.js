'use strict';

// Shared route helpers.

// Mirrors the real app's getNextOffset(limit, offset, total).
function getNextOffset(limit, offset, total) {
  const next = offset + limit;
  return next < total ? next : null;
}

// Tag every response with which source served it (live vs mock) — REQUIREMENT 2.
function setSourceHeader(res, source) {
  res.set('x-data-source', source);
}

// Small async wrapper so thrown errors reach the centralized error handler.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { getNextOffset, setSourceHeader, asyncHandler };
