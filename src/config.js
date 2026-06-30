'use strict';

// Loads .env (if present) and mirrors the relevant parts of the real app's
// `Config.NetSuite` plus the DB/Redis settings this POC needs.
require('dotenv').config();

const Config = {
  Server: {
    Port: parseInt(process.env.PORT || '8080', 10),
  },

  // Data source mode: which backend serves the data.
  //   live | mock | auto   (auto = live with automatic mock fallback)
  Mode: (process.env.NETSUITE_MODE || 'auto').trim().toLowerCase(),

  NetSuite: {
    BaseUrl: process.env.NETSUITE_BASE_URL || '',
    TokenUrl: process.env.NETSUITE_TOKEN_URL || '',
    ClientId: process.env.NETSUITE_CLIENT_ID || '',
    PrivateKey: process.env.NETSUITE_PRIVATE_KEY || '',
    KeyId: process.env.NETSUITE_KEY_ID || '',
    Audience: process.env.NETSUITE_AUDIENCE || '',
    // Same default scopes as the real app.
    Scopes: (process.env.NETSUITE_SCOPES || 'restlets,rest_webservices').split(','),
    JwtExpireDurationInMinute: parseInt(
      process.env.NETSUITE_JWT_EXPIRE_DURATION_IN_MINUTE || '5',
      10,
    ),
    JwtAlgorithm: process.env.NETSUITE_JWT_ALGORITHM || 'PS256',
  },

  Redis: {
    Url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  Database: {
    Url:
      process.env.DATABASE_URL ||
      'postgres://poc:poc@localhost:5432/netsuite_poc',
    Schema: process.env.DATABASE_SCHEMA || 'public',
  },

  ProgramSync: {
    // Empty => scheduled sync disabled (manual trigger via POST still works).
    Cron: (process.env.PROGRAM_SYNC_CRON || '').trim(),
    // Page size for batched fetch + upsert (mirrors SF_BATCH_PROCESSING_LIMIT default 50).
    BatchSize: parseInt(process.env.PROGRAM_SYNC_BATCH_SIZE || '50', 10),
  },
};

// True only when enough is configured to even attempt a live NetSuite call.
Config.NetSuite.IsConfigured = Boolean(
  Config.NetSuite.BaseUrl &&
    Config.NetSuite.TokenUrl &&
    Config.NetSuite.ClientId &&
    Config.NetSuite.PrivateKey &&
    Config.NetSuite.KeyId,
);

module.exports = { Config };
