'use strict';

const express = require('express');
const morgan = require('morgan');
const cron = require('node-cron');
const swaggerUi = require('swagger-ui-express');

const { Config } = require('./config');
const { connectRedis, pingRedis } = require('./redisClient');
const { connectPostgres, pingPostgres } = require('./db');
const dataSource = require('./dataSource');
const { spec } = require('./openapi');
const { listPrograms, runProgramSync } = require('./sync/programSync');
const { asyncHandler } = require('./routes/helpers');

const ordersRouter = require('./routes/orders');
const customersRouter = require('./routes/customers');
const itemsRouter = require('./routes/items');
const syncRouter = require('./routes/sync');

const app = express();
app.use(express.json());
app.use(morgan('dev'));

// Interactive Swagger UI — REQUIREMENT 3. Click "Try it out" → "Execute" live.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { explorer: true }));
app.get('/openapi.json', (req, res) => res.json(spec));

// NetSuite-faithful routes.
app.use('/netsuite/orders', ordersRouter);
app.use('/netsuite/customers', customersRouter);
app.use('/netsuite/items', itemsRouter);
app.use('/netsuite/sync', syncRouter);

// GET /programs — read synced programs back from Postgres (proves the sync worked).
app.get(
  '/programs',
  asyncHandler(async (req, res) => {
    const result = await listPrograms({ limit: req.query.limit, offset: req.query.offset });
    res.json(result);
  }),
);

// GET /health — mode + dependency reachability.
app.get(
  '/health',
  asyncHandler(async (req, res) => {
    const [redisOk, pgOk, netsuiteReachable] = await Promise.all([
      pingRedis(),
      pingPostgres(),
      dataSource.isNetSuiteReachable(),
    ]);
    res.json({
      status: 'ok',
      mode: Config.Mode,
      netsuiteReachable,
      redis: redisOk,
      postgres: pgOk,
    });
  }),
);

app.get('/', (req, res) => {
  res.json({
    name: 'netsuite-poc',
    mode: Config.Mode,
    docs: '/docs',
    health: '/health',
  });
});

// 404 for anything unmatched.
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// Centralized error handler -> clean JSON { error } with a sensible status.
// (Schema/field SuiteQL errors are handled deeper; this catches the rest.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.response ? 502 : 500);
  // eslint-disable-next-line no-console
  console.error(`[error] ${req.method} ${req.path}: ${err.message}`);
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

async function bootstrap() {
  // Connect dependencies. Both are best-effort so read-only mock endpoints still
  // serve even if a dependency is briefly unavailable; the sync/programs endpoints
  // surface a clean error if Postgres is genuinely down. Under docker-compose the
  // app waits for both to be healthy before starting anyway.
  await connectRedis();
  try {
    await connectPostgres();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[postgres] not reachable at boot: ${err.message} (sync/programs will retry)`);
  }

  // Optional scheduled sync.
  if (Config.ProgramSync.Cron && cron.validate(Config.ProgramSync.Cron)) {
    cron.schedule(Config.ProgramSync.Cron, async () => {
      try {
        const summary = await runProgramSync();
        // eslint-disable-next-line no-console
        console.log(`[cron] program sync done: ${JSON.stringify(summary)}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[cron] program sync failed: ${e.message}`);
      }
    });
    // eslint-disable-next-line no-console
    console.log(`[cron] program sync scheduled: ${Config.ProgramSync.Cron}`);
  }

  app.listen(Config.Server.Port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `\n  netsuite-poc listening on http://localhost:${Config.Server.Port}` +
        `\n  mode:    ${Config.Mode}` +
        `\n  docs:    http://localhost:${Config.Server.Port}/docs` +
        `\n  health:  http://localhost:${Config.Server.Port}/health\n`,
    );
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[fatal] failed to start: ${err.message}`);
  process.exit(1);
});

module.exports = app;
