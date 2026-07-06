# NetSuite Integration POC (Express + plain JS)

**🚧 Migration in progress — Express → Nx monorepo (NestJS + React).**
This repository is being incrementally migrated, following a phase-by-phase
playbook kept locally in `.cursor/Docs/migration/` (untracked — not on GitHub).

**Status: Phase 1 complete** — Nx 23 workspace foundation added; Express app unchanged.

A small but production-credible **proof of concept** that integrates with **NetSuite**,
built as a standalone **Node.js + Express (CommonJS)** app. It mirrors the real Team Shop
Plus integration: OAuth 2.0 JWT client-credentials with a **Redis-cached** access token,
**SuiteQL** execution with a **query-variant fallback**, a **two-level retry** strategy,
an **idempotent NetSuite → Postgres program sync**, and interactive **Swagger UI**.

It is designed to demo live over screen-share: `docker compose up` brings everything online
and — because it defaults to **`auto` mode with mock fallback** — **every endpoint returns
realistic data even with no NetSuite credentials** (the sandbox can be completely down and the
demo still works). See [`SUMMARY.md`](./SUMMARY.md) for how the real production code works.

> Standalone: nothing here imports the existing NestJS app under `../src`.

---

## Monorepo (Nx) — work in progress

This repo is becoming an Nx monorepo. Foundation is in place; apps and libraries arrive in
later phases.

```bash
nvm use                 # Node 22 (see .nvmrc)
npm install
npx nx show projects    # lists Nx projects (empty until Phase 2)
npx nx graph            # dependency graph
```

Everything under **"Legacy Express app"** below still runs as before.

---

## Legacy Express app (being retired) — quick start (`docker compose up`)

```bash
cd netsuite-poc
npm run dev:start      # creates dev/pgsql/data, then docker compose up -d --build
# or directly:
docker compose up --build
```

Helper scripts:

| Script                | What it does                                   |
| --------------------- | ---------------------------------------------- |
| `npm run dev:prepare` | Creates the `dev/pgsql/data` bind-mount dir    |
| `npm run dev:start`   | `dev:prepare` + `docker compose up -d --build` |
| `npm run dev:stop`    | `docker compose down --remove-orphans`         |
| `npm run dev:restart` | `dev:stop` then `dev:start`                    |
| `npm run dev:logs`    | Tail the app container logs                    |

Postgres persists to **`dev/pgsql/data`** (bind mount), so synced programs survive
`docker compose down` and a restart.

Then open:

- **Swagger UI:** http://localhost:8080/docs
- **Health:** http://localhost:8080/health

That's it — no credentials required. The app starts in `auto` mode; with no NetSuite creds it
serves mock data through the same mappers as live data. To exercise **live** NetSuite, add your
creds to the `app` service env in `docker-compose.yml` (or an `.env`) and set `NETSUITE_MODE=live`.

### Run locally without Docker

```bash
cd netsuite-poc
cp .env.example .env       # defaults are fine for mock/auto
npm install
# needs a local Redis + Postgres, or just run via docker compose
npm run legacy:dev
```

---

## Endpoints

| Method | Path                             | Description                                                    |
| ------ | -------------------------------- | -------------------------------------------------------------- |
| GET    | `/netsuite/orders`               | Paginated/filtered/searchable sales orders list                |
| GET    | `/netsuite/orders/:id`           | Sales order detail (header + line items)                       |
| GET    | `/netsuite/orders/:id/lines`     | Order line items                                               |
| GET    | `/netsuite/customers/:programId` | Customer by NetSuite internal id                               |
| GET    | `/netsuite/items`                | Item master list                                               |
| GET    | `/netsuite/items/:itemId`        | Item detail                                                    |
| POST   | `/netsuite/sync/programs`        | Run NetSuite → Postgres program sync; returns a summary        |
| GET    | `/netsuite/sync/programs/status` | Last sync status                                               |
| GET    | `/programs`                      | List synced programs from Postgres (proves the sync persisted) |
| GET    | `/health`                        | `{ status, mode, netsuiteReachable, redis, postgres }`         |
| GET    | `/docs`                          | Swagger UI                                                     |

Every response includes an **`x-data-source: live|mock`** header so you can see, live, which
source served the data.

### `/netsuite/orders` query params

`limit` (default 50, max 1000), `offset` (default 0), `search`, `sortBy` (`orderId|date`),
`sortDir` (`ASC|DESC`), `statusCode` (A–H), `orderStatus` (label), `delivery` (`Bulk|IPP`),
and optional `programId`. Response shape:

```json
{
  "count": 0,
  "total": 0,
  "offset": 0,
  "limit": 50,
  "nextOffset": null,
  "hasMore": false,
  "items": []
}
```

Status codes map A–H → labels (Pending Approval … Closed) and delivery → Bulk/IPP exactly like
the real app.

### curl examples

```bash
# List two orders
curl 'http://localhost:8080/netsuite/orders?limit=2'

# Search + filter + sort
curl 'http://localhost:8080/netsuite/orders?search=prodigy&statusCode=B&sortBy=date&sortDir=DESC'

# Order detail + lines
curl 'http://localhost:8080/netsuite/orders/3091'
curl 'http://localhost:8080/netsuite/orders/3091/lines'

# Customer / items
curl 'http://localhost:8080/netsuite/customers/2006'
curl 'http://localhost:8080/netsuite/items?limit=5'
curl 'http://localhost:8080/netsuite/items/9001'

# Run the program sync, then read the programs back from Postgres
curl -X POST 'http://localhost:8080/netsuite/sync/programs'
curl 'http://localhost:8080/programs'

# Health
curl 'http://localhost:8080/health'
```

---

## How it works (demo talking points)

### OAuth + Redis token caching (`netsuiteAuth.js`)

Builds a JWT signed with the integration private key (default **PS256**, configurable):
claims `iss`=clientId, `scope`, `aud`=audience, `iat`, `exp` (~5 min), header `kid`=keyId.
POSTs it as a `client_assertion` (`grant_type=client_credentials`,
`client_assertion_type=...jwt-bearer`) to the token URL. The access token is cached in
**Redis** with **TTL = `expires_in − 60s`** so we don't re-mint on every request; `clearToken()`
forces a re-mint.

### SuiteQL execution (`netsuiteClient.js`)

POSTs `{ q }` to `/query/v1/suiteql?limit&offset` with the required **`Prefer: transient`**
header (exact casing). The sales-order query joins `transaction → customer`,
`transactionline → item`, the shipping address, the `ItemShip` fulfillment (tracking number),
the opportunity, and custom body fields.

### Retry — two levels (`httpRetry.js` + `netsuiteClient.js`)

1. **Transport retry:** axios + exponential backoff (3 attempts) on network errors, 429, and
   5xx. On **401** it clears the cached token, re-mints once, and retries.
2. **Query-variant fallback:** if NetSuite rejects a field/table/column ("unknown identifier",
   "invalid column", "field not found", …), it retries with progressively simpler SuiteQL
   variants before giving up.

### Mock / auto fallback (`dataSource.js`)

`NETSUITE_MODE` = `live` | `mock` | `auto` (default `auto`). In `auto`, the app tries live and,
on any OAuth/SuiteQL failure, **automatically falls back to mock data** (flagged via
`x-data-source: mock`). Route handlers are identical regardless of source — only `dataSource.js`
differs — so the demo never breaks.

### Program sync (`sync/programSync.js`)

Fetches NetSuite **customer** records (with the same field-candidate fallback as the real app),
maps them to `Program` rows (ported `_resolveOwner` / `_resolveAddress` / `_resolveProgramType`),
skips records missing required owner fields, and **idempotently upserts** into Postgres via
`INSERT ... ON CONFLICT ("netsuiteId") DO UPDATE`. Re-running updates in place instead of
inserting duplicates. `GET /programs` reads them back to prove persistence.

### Security

Search input is sanitized (single quotes escaped, LIKE wildcards `%`/`_` stripped) before
composing SuiteQL, and numeric ids are validated/normalized. A centralized Express error handler
returns clean JSON `{ error }` with sensible status codes (400 invalid input, 404 not found,
502/503 upstream).

---

## Environment variables

See [`.env.example`](./.env.example). Key ones:

`NETSUITE_MODE`, `NETSUITE_BASE_URL`, `NETSUITE_TOKEN_URL`, `NETSUITE_CLIENT_ID`,
`NETSUITE_PRIVATE_KEY`, `NETSUITE_KEY_ID`, `NETSUITE_AUDIENCE`, `NETSUITE_SCOPES`,
`NETSUITE_JWT_ALGORITHM`, `REDIS_URL`, `DATABASE_URL`, `PORT`.
