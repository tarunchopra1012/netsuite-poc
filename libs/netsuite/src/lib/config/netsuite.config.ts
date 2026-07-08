// ─────────────────────────────────────────────────────────────
// Typed NetSuite configuration — ports the `Config.NetSuite` block (and the
// data-source Mode) of src/config.js, reading through Nest's ConfigService
// instead of a global. Injected by NetSuiteAuthService / NetSuiteClient.
// ─────────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type NetSuiteMode = 'live' | 'mock' | 'auto';

@Injectable()
export class NetSuiteConfig {
  constructor(private readonly _config: ConfigService) {}

  /** Data-source mode: live | mock | auto (auto = live with automatic mock fallback). */
  get mode(): NetSuiteMode {
    const raw = (this._config.get<string>('NETSUITE_MODE') ?? 'auto').trim().toLowerCase();
    return raw === 'live' || raw === 'mock' ? raw : 'auto';
  }

  get baseUrl(): string {
    return this._config.get<string>('NETSUITE_BASE_URL') ?? '';
  }

  get tokenUrl(): string {
    return this._config.get<string>('NETSUITE_TOKEN_URL') ?? '';
  }

  get clientId(): string {
    return this._config.get<string>('NETSUITE_CLIENT_ID') ?? '';
  }

  get privateKey(): string {
    return this._config.get<string>('NETSUITE_PRIVATE_KEY') ?? '';
  }

  get keyId(): string {
    return this._config.get<string>('NETSUITE_KEY_ID') ?? '';
  }

  get audience(): string {
    return this._config.get<string>('NETSUITE_AUDIENCE') ?? '';
  }

  /** Same default scopes as the real app. */
  get scopes(): string[] {
    return (this._config.get<string>('NETSUITE_SCOPES') ?? 'restlets,rest_webservices').split(',');
  }

  get jwtExpireDurationInMinute(): number {
    return parseInt(this._config.get<string>('NETSUITE_JWT_EXPIRE_DURATION_IN_MINUTE') ?? '5', 10);
  }

  get jwtAlgorithm(): string {
    return this._config.get<string>('NETSUITE_JWT_ALGORITHM') ?? 'PS256';
  }

  /** True only when enough is configured to even attempt a live NetSuite call. */
  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.tokenUrl && this.clientId && this.privateKey && this.keyId);
  }
}
