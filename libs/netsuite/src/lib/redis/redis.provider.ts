// ─────────────────────────────────────────────────────────────
// Shared ioredis connection as a Nest provider — port of src/redisClient.js.
// `lazyConnect` so the app can boot even when Redis is briefly unavailable;
// maxRetriesPerRequest keeps commands queued through short reconnects instead
// of failing hard. Exposed via an injection token so this lib (token cache)
// and auth-service (optional refresh denylist, Phase 5) can reuse it.
// ─────────────────────────────────────────────────────────────

import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

export const redisProvider: Provider = {
  provide: REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    redis.on('error', (err) => new Logger('Redis').warn(`connection error: ${err.message}`));
    void redis
      .connect()
      .catch((e) => new Logger('Redis').warn(`initial connect failed: ${e.message}`));
    return redis;
  },
};

/** Best-effort PING used by health checks. */
export async function pingRedis(redis: Redis): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
