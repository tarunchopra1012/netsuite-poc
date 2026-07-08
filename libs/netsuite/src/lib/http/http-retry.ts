// ─────────────────────────────────────────────────────────────
// Retry mechanism — LEVEL 1 (transport). 1:1 port of src/httpRetry.js.
// An axios instance with exponential backoff that retries on:
//   - network errors (ECONNRESET, ETIMEDOUT, DNS, sandbox unreachable)
//   - HTTP 429 (rate limited)
//   - HTTP 5xx (NetSuite transient server errors)
// Plus a 401 handler: on an expired/invalid token we clear the cached token,
// re-mint once via `onUnauthorized`, and retry the original request a single time.
// (The SuiteQL "query-variant" fallback is LEVEL 2 and lives in the client service.)
// ─────────────────────────────────────────────────────────────

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';

export interface HttpClientOptions {
  /** max backoff attempts (default 3) */
  retries?: number;
  /** per-request timeout in ms (default 20000) */
  timeout?: number;
  /** async () => newToken; called once on 401 */
  onUnauthorized?: () => Promise<string | undefined>;
}

type RetriableRequestConfig = InternalAxiosRequestConfig & { __retriedAfter401?: boolean };

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function createHttpClient(opts: HttpClientOptions = {}): AxiosInstance {
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
      const status = error.response?.status;
      return status ? isRetryableStatus(status) : true;
    },
    onRetry: (retryCount, error, requestConfig) => {
      console.warn(
        `[httpRetry] attempt ${retryCount} for ${requestConfig.method?.toUpperCase()} ${
          requestConfig.url
        } (${error.code || error.response?.status || error.message})`,
      );
    },
  });

  if (typeof onUnauthorized === 'function') {
    client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original = (error.config ?? {}) as RetriableRequestConfig;
        const status = error.response?.status;

        // Re-mint a token at most once per request to avoid infinite loops.
        if (status === 401 && !original.__retriedAfter401) {
          original.__retriedAfter401 = true;
          console.warn('[httpRetry] 401 received — clearing token and re-minting once');
          try {
            const newToken = await onUnauthorized();
            if (newToken) {
              original.headers = original.headers ?? {};
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
