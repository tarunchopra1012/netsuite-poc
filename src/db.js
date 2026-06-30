'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { Config } = require('./config');

// Single shared pg pool.
const pool = new Pool({ connectionString: Config.Database.Url });

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.warn(`[postgres] pool error: ${err.message}`);
});

// Ensure the Program schema exists. We run init.sql so the DDL lives in one place,
// but it is written with CREATE TABLE IF NOT EXISTS so it is safe on every boot.
async function ensureSchema() {
  const initSqlPath = path.join(__dirname, '..', 'init.sql');
  const ddl = fs.readFileSync(initSqlPath, 'utf8');
  await pool.query(ddl);
}

// Retry connecting a few times so we tolerate Postgres still booting under
// docker-compose even with healthchecks.
async function connectPostgres(attempts = 10, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      await ensureSchema();
      return;
    } catch (err) {
      lastErr = err;
      // eslint-disable-next-line no-console
      console.warn(
        `[postgres] not ready (attempt ${i + 1}/${attempts}): ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function pingPostgres() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

module.exports = { pool, ensureSchema, connectPostgres, pingPostgres };
