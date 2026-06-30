'use strict';

const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');

// ─────────────────────────────────────────────────────────────
// Retry mechanism — LEVEL 1 (transport).
// An axios instance with exponential backoff that retries on:
//   - network errors (ECONNRESET, ETIMEDOUT, DNS, sandbox unreachable)
//   - HTTP 429 (rate limited)
//   - HTTP 5xx (NetSuite transient server errors)
// Plus a 401 handler: on an expired/invalid token we clear the cached token,
// re-mint once via `onUnauthorized`, and retry the original request a single time.
// (The SuiteQL "query-variant" fallback is LEVEL 2 and lives in netsuiteClient.js.)
// ─────────────────────────────────────────────────────────────

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * @param {object} opts
 * @param {number} [opts.retries=3]            max backoff attempts
 * @param {number} [opts.timeout=20000]        per-request timeout (ms)
 * @param {function} [opts.onUnauthorized]     async () => newToken; called once on 401
 */
function createHttpClient(opts = {}) {
  const { retries = 3, timeout = 20000, onUnauthorized } = opts;

  const client = axios.create({ timeout });

  axiosRetry(client, {
    retries,
    // 2^n * 1000ms with jitter: ~1s, ~2s, ~4s ...
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
      if (axiosRetry.isNetworkOrIdempotentRequestError(error)) {
        return true;
      }
      const status = error.response && error.response.status;
      return status ? isRetryableStatus(status) : true;
    },
    onRetry: (retryCount, error, requestConfig) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[httpRetry] attempt ${retryCount} for ${requestConfig.method?.toUpperCase()} ${
          requestConfig.url
        } (${error.code || (error.response && error.response.status) || error.message})`,
      );
    },
  });

  if (typeof onUnauthorized === 'function') {
    client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const original = error.config || {};
        const status = error.response && error.response.status;

        // Re-mint a token at most once per request to avoid infinite loops.
        if (status === 401 && !original.__retriedAfter401) {
          original.__retriedAfter401 = true;
          // eslint-disable-next-line no-console
          console.warn('[httpRetry] 401 received — clearing token and re-minting once');
          try {
            const newToken = await onUnauthorized();
            if (newToken) {
              original.headers = original.headers || {};
              original.headers.Authorization = `Bearer ${newToken}`;
            }
            return client(original);
          } catch (refreshErr) {
            return Promise.reject(refreshErr);
          }
        }

        return Promise.reject(error);
      },
    );
  }

  return client;
}

module.exports = { createHttpClient, isRetryableStatus };
