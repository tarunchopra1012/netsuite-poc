// ─────────────────────────────────────────────────────────────
// OAuth 2.0 client-credentials with a signed JWT client assertion.
// 1:1 port of src/netsuiteAuth.js as an injectable Nest service.
// THIS IS WHERE THE MACHINE TOKEN LIVES — it never leaves this service
// (and this lib must never be imported by browser code).
// ─────────────────────────────────────────────────────────────

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import { NetSuiteConfig } from '../config/netsuite.config';
import { createHttpClient } from '../http/http-retry';
import { REDIS } from '../redis/redis.provider';

const GRANT_TYPE = 'client_credentials';
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

// Redis key for the cached access token (mirrors CacheKey.NetSuiteAccessToken).
export const TOKEN_CACHE_KEY = 'netsuite:access_token';

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

@Injectable()
export class NetSuiteAuthService {
  private readonly _logger = new Logger(NetSuiteAuthService.name);

  // Plain axios-with-retry client for the token endpoint (no 401 interceptor here —
  // a 401 on the token call means bad creds, not an expired bearer).
  private readonly _tokenHttp = createHttpClient({ retries: 3, timeout: 15000 });

  constructor(
    private readonly _config: NetSuiteConfig,
    @Inject(REDIS) private readonly _redis: Redis,
  ) {}

  /**
   * Normalise the PEM private key:
   *  - turn literal "\n" into real newlines (env vars are single-line)
   *  - validate BEGIN/END markers so we fail with a clear message
   */
  processPrivateKey(privateKey: string): string {
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
  generateClientAssertion(): string {
    const privateKey = this.processPrivateKey(this._config.privateKey);
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this._config.jwtExpireDurationInMinute * 60;

    const payload = {
      iss: this._config.clientId,
      scope: this._config.scopes, // array form, same as the real app
      iat: now,
      exp: now + expiresIn,
      aud: this._config.audience,
    };

    const algorithm = (this._config.jwtAlgorithm || 'PS256') as jwt.Algorithm;
    const header = { alg: algorithm, typ: 'JWT', kid: this._config.keyId };

    return jwt.sign(payload, privateKey, { algorithm, header });
  }

  /** POST the client assertion to the token URL and return { access_token, expires_in, ... }. */
  async fetchAccessToken(): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: GRANT_TYPE,
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: this.generateClientAssertion(),
    });

    const { data } = await this._tokenHttp.post<TokenResponse>(
      this._config.tokenUrl,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

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
  async getAccessToken(): Promise<string> {
    try {
      const cached = await this._redis.get(TOKEN_CACHE_KEY);
      if (cached) {
        return cached;
      }
    } catch (err) {
      // Redis down — degrade gracefully and just mint a fresh token.
      this._logger.warn(`token cache read failed: ${(err as Error).message}`);
    }

    const tokenResponse = await this.fetchAccessToken();
    const ttl = Math.max((tokenResponse.expires_in || 3600) - 60, 60);

    try {
      await this._redis.set(TOKEN_CACHE_KEY, tokenResponse.access_token, 'EX', ttl);
    } catch (err) {
      this._logger.warn(`token cache write failed: ${(err as Error).message}`);
    }

    return tokenResponse.access_token;
  }

  /** Drop the cached token (used after a 401 to force a re-mint). */
  async clearToken(): Promise<void> {
    try {
      await this._redis.del(TOKEN_CACHE_KEY);
    } catch (err) {
      this._logger.warn(`token cache clear failed: ${(err as Error).message}`);
    }
  }
}
