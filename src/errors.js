'use strict';

// Lightweight HTTP error carrying a status code, surfaced by the centralized
// Express error handler as clean JSON { error }.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

module.exports = { ApiError };
