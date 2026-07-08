// ─────────────────────────────────────────────────────────────
// The Nest module that binds the ported NetSuite integration together.
// Provides the typed config, the shared Redis connection, and the two
// stateful services (auth + SuiteQL client), and re-exports them so
// downstream backend modules (crm-service in Phase 4) can consume them.
// Backend-only: never import this from web / libs/ui / libs/data-access.
// ─────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NetSuiteConfig } from './config/netsuite.config';
import { redisProvider, REDIS } from './redis/redis.provider';
import { NetSuiteAuthService } from './auth/netsuite-auth.service';
import { NetSuiteClient } from './client/netsuite-client.service';

@Module({
  imports: [ConfigModule],
  providers: [NetSuiteConfig, redisProvider, NetSuiteAuthService, NetSuiteClient],
  exports: [NetSuiteConfig, NetSuiteAuthService, NetSuiteClient, REDIS],
})
export class NetSuiteModule {}
