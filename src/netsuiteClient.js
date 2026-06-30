'use strict';

const { Config } = require('./config');
const { getAccessToken, clearToken } = require('./netsuiteAuth');
const { createHttpClient } = require('./httpRetry');

// ─────────────────────────────────────────────────────────────
// SuiteQL executor. Ported from NetSuiteService.executeSuiteQL +
// _executeSuiteQLWithVariants / _isInvalidSuiteQLQueryError.
// ─────────────────────────────────────────────────────────────

// LEVEL 1 retry (network/429/5xx) + 401 re-mint handled inside this client.
const http = createHttpClient({
  retries: 3,
  timeout: 30000,
  onUnauthorized: async () => {
    // Clear cached bearer and mint a brand-new one for the retried request.
    await clearToken();
    return getAccessToken();
  },
});

function emptyResponse() {
  return {
    links: [],
    count: 0,
    hasMore: false,
    items: [],
    offset: 0,
    totalResults: 0,
  };
}

// Flatten an axios/NetSuite error into lowercase text we can pattern-match on.
function collectErrorText(error) {
  const parts = [];
  if (error instanceof Error) {
    parts.push(error.message);
  }
  const details =
    error &&
    error.response &&
    error.response.data &&
    error.response.data['o:errorDetails'];
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && d.detail) parts.push(d.detail);
    }
  }
  return parts.join(' ').toLowerCase();
}

// LEVEL 2 trigger: true when SuiteQL failed because a field/table/column is not
// available (so we should retry with a simpler query variant), NOT for auth/network.
function isInvalidSuiteQLQueryError(error) {
  const detail = collectErrorText(error);
  if (!detail) return false;
  return (
    detail.includes('invalid search type') ||
    detail.includes('invalid or unsupported search') ||
    detail.includes('invalid search query') ||
    detail.includes('unknown identifier') ||
    detail.includes('was not found') ||
    detail.includes('not_exposed') ||
    detail.includes('no such table') ||
    detail.includes('table or view does not exist') ||
    detail.includes('invalid column') ||
    detail.includes('field not found') ||
    detail.includes('syntax error') ||
    detail.includes('failed to parse sql') ||
    detail.includes('fetch first')
  );
}

/**
 * Execute one SuiteQL statement.
 * POST {q} to /query/v1/suiteql?limit&offset with the REQUIRED `Prefer: transient`
 * header (exact casing — NetSuite rejects lowercase `prefer`). `transient` runs the
 * ad-hoc query without persisting a saved search.
 */
async function executeSuiteQL(query, limit = 1000, offset = 0) {
  const token = await getAccessToken();
  const url = `${Config.NetSuite.BaseUrl}/query/v1/suiteql?limit=${limit}&offset=${offset}`;

  const { data } = await http.post(
    url,
    { q: query },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'transient',
      },
    },
  );
  return data;
}

/**
 * LEVEL 2 retry — the SuiteQL "query-variant fallback".
 * Try attempts richest → simplest. On a *schema* error (unknown field/table/column)
 * log and try the next variant; on any other error (auth/network/5xx already retried
 * at level 1) re-throw immediately.
 *
 * @param {{label:string, buildQuery:() => string}[]} attempts
 */
async function executeSuiteQLWithVariants({ attempts, limit, offset = 0, logLabel }) {
  let lastError;
  for (const attempt of attempts) {
    try {
      return await executeSuiteQL(attempt.buildQuery(), limit, offset);
    } catch (error) {
      lastError = error;
      if (!isInvalidSuiteQLQueryError(error)) {
        throw error;
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[netsuiteClient] ${logLabel} variant failed (${attempt.label}). Trying a simpler query.`,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`NetSuite ${logLabel} query failed after all variants`);
}

/**
 * Softer fallback used for "log"-style queries: if the whole table/field is
 * unavailable, return an empty result set instead of throwing.
 */
async function executeSuiteQLWithEmptyFallback(query, limit, logLabel) {
  try {
    return await executeSuiteQL(query, limit);
  } catch (error) {
    if (isInvalidSuiteQLQueryError(error)) {
      // eslint-disable-next-line no-console
      console.warn(`[netsuiteClient] ${logLabel} unavailable; returning empty result.`);
      return emptyResponse();
    }
    throw error;
  }
}

module.exports = {
  executeSuiteQL,
  executeSuiteQLWithVariants,
  executeSuiteQLWithEmptyFallback,
  isInvalidSuiteQLQueryError,
  emptyResponse,
};
