'use strict';

const jwt = require('jsonwebtoken');
const { Config } = require('./config');
const { redis } = require('./redisClient');
const { createHttpClient } = require('./httpRetry');

// ─────────────────────────────────────────────────────────────
// OAuth 2.0 client-credentials with a signed JWT client assertion.
// Ported from NetSuiteService._generateClientAssertion / getAccessToken.
// ─────────────────────────────────────────────────────────────

const GRANT_TYPE = 'client_credentials';
const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

// Redis key for the cached access token (mirrors CacheKey.NetSuiteAccessToken).
const TOKEN_CACHE_KEY = 'netsuite:access_token';

// Plain axios-with-retry client for the token endpoint (no 401 interceptor here —
// a 401 on the token call means bad creds, not an expired bearer).
const tokenHttp = createHttpClient({ retries: 3, timeout: 15000 });

/**
 * Normalise the PEM private key:
 *  - turn literal "\n" into real newlines (env vars are single-line)
 *  - validate BEGIN/END markers so we fail with a clear message
 */
function processPrivateKey(privateKey) {
  if (!privateKey) {
    throw new Error('NetSuite private key is not configured');
  }
  const processed = privateKey.replace(/\\n/g, '\n').trim();
  if (!processed.includes('-----BEGIN')) {
    throw new Error('Invalid private key format: missing BEGIN marker');
  }
  if (!processed.includes('-----END')) {
    throw new Error('Invalid private key format: missing END marker');
  }
  return processed;
}

/**
 * Build + sign the JWT used as the OAuth client assertion.
 * Claims: iss=clientId, scope, aud=audience, iat, exp (~5 min).
 * Header: { alg (PS256 default), typ:'JWT', kid=keyId }.
 */
function generateClientAssertion() {
  const privateKey = processPrivateKey(Config.NetSuite.PrivateKey);
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Config.NetSuite.JwtExpireDurationInMinute * 60;

  const payload = {
    iss: Config.NetSuite.ClientId,
    scope: Config.NetSuite.Scopes, // array form, same as the real app
    iat: now,
    exp: now + expiresIn,
    aud: Config.NetSuite.Audience,
  };

  const algorithm = Config.NetSuite.JwtAlgorithm || 'PS256';
  const header = { alg: algorithm, typ: 'JWT', kid: Config.NetSuite.KeyId };

  return jwt.sign(payload, privateKey, { algorithm, header });
}

/** POST the client assertion to the token URL and return { access_token, expires_in, ... }. */
async function fetchAccessToken() {
  const body = new URLSearchParams({
    grant_type: GRANT_TYPE,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: generateClientAssertion(),
  });

  const { data } = await tokenHttp.post(Config.NetSuite.TokenUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!data || !data.access_token) {
    throw new Error('NetSuite OAuth response missing access_token');
  }
  return data;
}

/**
 * Return a usable access token, caching it in Redis.
 * Cache TTL = max(expires_in - 60, 60) so we expire ~60s early and never use a
 * token that dies mid-request. On cache hit we reuse; on miss we mint + store.
 */
async function getAccessToken() {
  try {
    const cached = await redis.get(TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }
  } catch (err) {
    // Redis down — degrade gracefully and just mint a fresh token.
    // eslint-disable-next-line no-console
    console.warn(`[netsuiteAuth] token cache read failed: ${err.message}`);
  }

  const tokenResponse = await fetchAccessToken();
  const ttl = Math.max((tokenResponse.expires_in || 3600) - 60, 60);

  try {
    await redis.set(TOKEN_CACHE_KEY, tokenResponse.access_token, 'EX', ttl);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[netsuiteAuth] token cache write failed: ${err.message}`);
  }

  return tokenResponse.access_token;
}

/** Drop the cached token (used after a 401 to force a re-mint). */
async function clearToken() {
  try {
    await redis.del(TOKEN_CACHE_KEY);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[netsuiteAuth] token cache clear failed: ${err.message}`);
  }
}

module.exports = {
  getAccessToken,
  fetchAccessToken,
  clearToken,
  generateClientAssertion,
  processPrivateKey,
  TOKEN_CACHE_KEY,
};
