'use strict';

const Redis = require('ioredis');
const { Config } = require('./config');

// Single shared ioredis connection. `lazyConnect` so the app can boot even when
// Redis is briefly unavailable; we connect explicitly in server bootstrap.
// maxRetriesPerRequest:null keeps commands queued through short reconnects instead
// of throwing, which matters during `docker compose up` startup ordering.
const redis = new Redis(Config.Redis.Url, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

let connected = false;

redis.on('connect', () => {
  connected = true;
});
redis.on('end', () => {
  connected = false;
});
redis.on('error', (err) => {
  connected = false;
  // Don't crash the process — token caching degrades gracefully without Redis.
  // eslint-disable-next-line no-console
  console.warn(`[redis] connection error: ${err.message}`);
});

async function connectRedis() {
  try {
    await redis.connect();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[redis] initial connect failed: ${err.message}`);
  }
}

// Lightweight health probe used by GET /health.
async function pingRedis() {
  try {
    const res = await redis.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}

function isRedisConnected() {
  return connected;
}

module.exports = { redis, connectRedis, pingRedis, isRedisConnected };
