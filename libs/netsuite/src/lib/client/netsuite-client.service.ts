// ─────────────────────────────────────────────────────────────
// SuiteQL executor — 1:1 port of src/netsuiteClient.js as an injectable
// Nest service. LEVEL 1 retry (network/429/5xx) + single-shot 401 re-mint
// live in the http client; LEVEL 2 (query-variant fallback) lives here.
// ─────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { NetSuiteConfig } from '../config/netsuite.config';
import { NetSuiteAuthService } from '../auth/netsuite-auth.service';
import { createHttpClient } from '../http/http-retry';

export interface SuiteQLResponse<T = Record<string, unknown>> {
  links: unknown[];
  count: number;
  hasMore: boolean;
  items: T[];
  offset: number;
  totalResults: number;
}

export interface SuiteQLAttempt {
  label: string;
  buildQuery: () => string;
}

export interface SuiteQLVariantsOptions {
  attempts: SuiteQLAttempt[];
  limit?: number;
  offset?: number;
  logLabel: string;
}

export function emptyResponse(): SuiteQLResponse {
  return {
    links: [],
    count: 0,
    hasMore: false,
    items: [],
    offset: 0,
    totalResults: 0,
  };
}

interface NetSuiteErrorDetail {
  detail?: string;
}

// Flatten an axios/NetSuite error into lowercase text we can pattern-match on.
function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
  }
  const details = (
    error as { response?: { data?: { 'o:errorDetails'?: NetSuiteErrorDetail[] } } } | null
  )?.response?.data?.['o:errorDetails'];
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && d.detail) parts.push(d.detail);
    }
  }
  return parts.join(' ').toLowerCase();
}

// LEVEL 2 trigger: true when SuiteQL failed because a field/table/column is not
// available (so we should retry with a simpler query variant), NOT for auth/network.
export function isInvalidSuiteQLQueryError(error: unknown): boolean {
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

@Injectable()
export class NetSuiteClient {
  private readonly _logger = new Logger(NetSuiteClient.name);

  // LEVEL 1 retry (network/429/5xx) + 401 re-mint handled inside this client.
  private readonly _http = createHttpClient({
    retries: 3,
    timeout: 30000,
    onUnauthorized: async () => {
      // Clear cached bearer and mint a brand-new one for the retried request.
      await this._auth.clearToken();
      return this._auth.getAccessToken();
    },
  });

  constructor(
    private readonly _config: NetSuiteConfig,
    private readonly _auth: NetSuiteAuthService,
  ) {}

  /**
   * Execute one SuiteQL statement.
   * POST {q} to /query/v1/suiteql?limit&offset with the REQUIRED `Prefer: transient`
   * header (exact casing — NetSuite rejects lowercase `prefer`). `transient` runs the
   * ad-hoc query without persisting a saved search.
   */
  async executeSuiteQL(query: string, limit = 1000, offset = 0): Promise<SuiteQLResponse> {
    const token = await this._auth.getAccessToken();
    const url = `${this._config.baseUrl}/query/v1/suiteql?limit=${limit}&offset=${offset}`;

    const { data } = await this._http.post<SuiteQLResponse>(
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
   */
  async executeSuiteQLWithVariants({
    attempts,
    limit,
    offset = 0,
    logLabel,
  }: SuiteQLVariantsOptions): Promise<SuiteQLResponse> {
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        return await this.executeSuiteQL(attempt.buildQuery(), limit, offset);
      } catch (error) {
        lastError = error;
        if (!isInvalidSuiteQLQueryError(error)) {
          throw error;
        }
        this._logger.warn(`${logLabel} variant failed (${attempt.label}). Trying a simpler query.`);
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
  async executeSuiteQLWithEmptyFallback(
    query: string,
    limit: number | undefined,
    logLabel: string,
  ): Promise<SuiteQLResponse> {
    try {
      return await this.executeSuiteQL(query, limit);
    } catch (error) {
      if (isInvalidSuiteQLQueryError(error)) {
        this._logger.warn(`${logLabel} unavailable; returning empty result.`);
        return emptyResponse();
      }
      throw error;
    }
  }
}
