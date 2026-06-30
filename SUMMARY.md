# SUMMARY — How the real Team Shop Plus NetSuite integration works

This document captures how the **existing NestJS application** (`src/...`) integrates with
NetSuite, so that the standalone Express POC under `netsuite-poc/` can faithfully reproduce
the same behaviour. Everything below is a description of the **production code**, not the POC.

Files studied:

- `src/shared/netsuite/netsuite.service.ts` — OAuth JWT auth, token caching, SuiteQL executor, query-variant fallback, all queries
- `src/shared/netsuite/sales-orders-list.util.ts` — search/sort/filter/pagination SuiteQL builders + input sanitisation
- `src/netsuite/netsuite.controller.ts` — REST endpoints + auth model
- `src/netsuite/map-sales-order.util.ts` — raw NetSuite row → clean DTO mapping
- `src/netsuite/netsuite-order.types.ts` — response shapes + status code A–H map
- `src/netsuite/initiator/GetSalesOrdersUseCase.ts`, `GetSalesOrderDetailUseCase.ts`
- `src/program/providers/netsuite-program-sync.provider.ts` — NetSuite customer → Program mapping + query field fallback
- `src/program/initiator/SyncProgramsUseCase.ts` — batched, idempotent upsert/reconcile logic
- `src/utils/config.ts` — `Config.NetSuite` env vars

---

## 1. OAuth 2.0 — JWT client-credentials (machine-to-machine)

`NetSuiteService._generateClientAssertion()` builds and signs a JWT that NetSuite exchanges
for an access token. No username/password — this is the **OAuth 2.0 client-credentials**
flow using a **signed client assertion**.

**JWT claims** (`payload`):

| Claim   | Value                                                        |
| ------- | ------------------------------------------------------------ |
| `iss`   | `Config.NetSuite.ClientId` (the integration's consumer key)  |
| `scope` | `Config.NetSuite.Scopes` (e.g. `restlets,rest_webservices`)  |
| `aud`   | `Config.NetSuite.Audience` (the NetSuite token endpoint URL) |
| `iat`   | `now` (seconds)                                              |
| `exp`   | `now + JwtExpireDurationInMinute*60` (default **5 min**)     |

**JWT header**: `{ alg, typ: 'JWT', kid: Config.NetSuite.KeyId }`.
The `kid` is the **certificate id** registered in NetSuite; NetSuite uses it to pick the
public key that verifies the signature.

**Signing algorithm**: `Config.NetSuite.JwtAlgorithm` (default **`PS256`**; `RS256`/`ES256`/`ES512`
also supported). Signed with the integration's **private key**.

**Private key handling** (`_processPrivateKey`): replaces literal `\n` with real newlines,
trims, and validates that the PEM contains both `-----BEGIN` and `-----END` markers — throwing
a clear error otherwise.

**Token request** (`fetchAccessToken`) — `POST Config.NetSuite.TokenUrl` with
`Content-Type: application/x-www-form-urlencoded` and body:

```
grant_type=client_credentials
client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
client_assertion=<signed JWT>
```

The response is `{ access_token, token_type, expires_in }`.

## 2. Token caching (until ~60s before expiry)

`getAccessToken()`:

1. Reads `CacheKey.NetSuiteAccessToken` from the cache (Redis-backed). On hit → return it.
2. On miss → `fetchAccessToken()`, then cache the token with
   **TTL = `max(expires_in - 60, 60)` seconds** (i.e. expire ~60s early so an in-flight
   request never uses a token that dies mid-call).
3. `clearAccessToken()` deletes the cache key — used to force a re-mint (e.g. after a 401).

## 3. SuiteQL execution

`executeSuiteQL(query, limit, offset)`:

- URL: `${BaseUrl}/query/v1/suiteql?limit=<limit>&offset=<offset>`
- `POST` with body `{ q: query }` and headers:
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
  - **`Prefer: transient`** ← required by NetSuite. **Exact casing matters** — `prefer`
    (lowercase) is rejected. `transient` means "run this query without persisting a saved
    search", which is what ad-hoc SuiteQL needs.
- Returns `{ links, count, hasMore, items, offset, totalResults }`.

### Query-variant fallback (`_executeSuiteQLWithVariants` + `_isInvalidSuiteQLQueryError`)

NetSuite sandboxes differ in which columns/tables/custom fields exist. So the service builds
an **ordered list of query attempts** from richest → simplest and tries each in turn.
If an attempt fails with a _schema_ error (detected by scanning the error text /
`o:errorDetails` for phrases like `unknown identifier`, `was not found`, `invalid column`,
`field not found`, `no such table`, `syntax error`, `failed to parse sql`, `fetch first`,
etc.), it logs a warning and tries the **next simpler variant**. Any _non-schema_ error
(auth, network, 5xx) is re-thrown immediately. `_executeLogQueryWithFallback` is a softer
variant that returns an **empty result set** when a whole table is unavailable.

## 4. The sales-order query and its joins

`_buildSalesOrdersQuery` composes a SuiteQL statement against `transaction` filtered by
`t.type = 'SalesOrd'`, with the following joins/sub-selects (each toggled by the current
variant so they can be dropped on schema errors):

- **`transaction t` → `customer c`** : `LEFT JOIN customer c ON t.entity = c.id`
  (customer name, email, phone, `entityid`, `isperson`, legacy SFC number as `programid`).
- **Shipping address** : `LEFT JOIN CustomerAddressBookEntityAddress shipaddr ON shipaddr.nkey = c.defaultshippingaddress` (addressee/street/city/state/zip).
- **Shipment / shipping method** (detail only) : `LEFT JOIN TransactionShipment ts ON ts.doc = t.id` → `BUILTIN.DF(ts.shippingmethod)`.
- **Opportunity** : `BUILTIN.DF(t.opportunity) AS opportunityname`.
- **Custom body fields** (two candidate sets tried): order type / style description /
  additional description (`custbody_ra_order_type` … then `custbody_order_type` …).
- **Line enrichment sub-selects** against `transactionline tl` (with `tl.mainline='F' AND tl.taxline='F'`):
  - `itemcount` = `COUNT(*)` of real lines
  - `itemname` = first line's `BUILTIN.DF(tl.item)` (via `ROWNUM<=1`, or `MIN()` in the
    aggregate variant for accounts where `ROWNUM` is unsupported)
  - `firstitemdisplayname` = first line's `item.displayname` (joins `item i ON i.id = tl.item`)
  - **`trackingnumber`** = from the related fulfillment: a sub-select over `transaction ful`
    joined to `transactionline ftl` where `ful.type = 'ItemShip'` and `ftl.createdfrom = t.id`,
    reading `BUILTIN.DF(ful.trackingnumberlist)`.

`BUILTIN.DF(x)` = NetSuite "Display Field" — resolves an internal id to its human label.

**Order lines** (`_buildOrderLineItemsQuery`): `transactionline tl LEFT JOIN item i` filtered
to `tl.mainline='F' AND tl.taxline='F'`, returning quantity, `rate` (unit price),
`amount` (line total), item code/name, and optionally fulfillment quantities
(`quantitypicked/packed/fulfilled/billed`) and `isclosed` as line status — again behind
variant toggles.

## 5. List filters, search, sort, pagination (`sales-orders-list.util.ts`)

- **Limit / offset**: `normalizeSalesOrdersLimit` → default **50**, max **1000**;
  `normalizeSalesOrdersOffset` → default **0**, never negative.
- **Search** (`buildSalesOrdersListFilterSql`): matches `t.tranid` (order number),
  `c.companyname` (customer), and `BUILTIN.DF(t.opportunity)` (opportunity), all
  `UPPER(...) LIKE '%term%'`.
- **`sanitizeSearchTerm`**: strips LIKE wildcards `%` and `_` and trims; single quotes are
  escaped via `_escapeSuiteQLString` (`'` → `''`) — together these prevent SuiteQL injection.
- **statusCode / orderStatus**: `resolveStatusCodeFilter` accepts a raw code (A–H) or maps a
  label (case-insensitive) to a code, then filters `t.status = '<code>'`.
- **delivery**: `IPP` → `c.isperson = 'T'`; `Bulk` → `(c.isperson = 'F' OR c.isperson IS NULL)`.
- **sort**: `sortBy` `orderId`→`t.id`, `date`→`t.trandate`, else `t.lastmodifieddate`;
  `sortDir` `ASC`/`DESC` (default `DESC`).

## 6. Row → DTO mapping (`map-sales-order.util.ts`, `netsuite-order.types.ts`)

**Status code → label** (`NETSUITE_STATUS_CODE_MAP`):

| Code | Label                                 |
| ---- | ------------------------------------- |
| A    | Pending Approval                      |
| B    | Pending Fulfillment                   |
| C    | Cancelled                             |
| D    | Partially Fulfilled                   |
| E    | Pending Billing / Partially Fulfilled |
| F    | Pending Billing                       |
| G    | Billed                                |
| H    | Closed                                |

`mapNetSuiteStatusLabel` resolves by code first, then falls back to parsing `statusname`
(stripping a leading `Sales Order :` prefix). Default when unknown is **`Pending Fulfillment`** (B).

**Delivery** (`mapDeliveryType`): explicit `Bulk`/`IPP`/`individual` text wins; otherwise
`isperson = 'T'` ⇒ **IPP** else **Bulk**. `mapDeliveryLabel`: IPP → `Individual Order`,
Bulk → `Bulk Order`.

**Other mappings**: `mapCustomerName` (customername→companyname), `mapOpportunityName`
(opportunity, else `style + additional` description), `mapProgramId` (entityid → legacy SFC →
`A-#####`/leading-number parsed from customer name → entity id), `mapItemName`,
`parseTotal` (`foreigntotal`), `parseTrackingNumber` (first of a comma list, `-`→null),
`buildShippingInfo` / `buildShipTo` / `buildShippingDetail`. The **detail** mapper
(`mapSalesOrderDetail`) merges header list fields with `lineItems`, prefers the first line's
item name, and adds PO number, style/additional descriptions, created/modified dates and the
shipping detail block.

**List response shape** returned by `GetSalesOrdersUseCase`:
`{ items, total, count, offset, limit, hasMore, nextOffset }`, where `total = totalResults`
and `nextOffset = getNextOffset(limit, offset, total)`.

## 7. Auth model on the controller

`@Controller('netsuite')`. Endpoints:
`GET orders` (role Admin/ProgramOwner, `programId` required; ProgramOwner is access-checked via
`UserService.hasAccessToProgram`), `GET orders/:id`, `GET orders/:id/lines`,
`GET customers/:programId` and `GET items`, `GET items/:itemId` (dev-api-key + NetSuite
permission). Controllers only call use cases and return DTOs.

## 8. NetSuite customer → Program sync (idempotent)

`NetSuiteProgramSyncProvider`:

- **Fetch** (`_buildFetchProgramsQuery` + `_executeProgramSyncQuery`): selects customers with
  primary-contact custom fields (`custentity_ra_primary_contact_*`), legacy SFC number, and
  ship/bill address via two `CustomerAddressBookEntityAddress` joins. The **program type/subtype**
  custom fields differ per account, so it tries field-candidate sets
  (`custentity_ra_account_type/subtype`, then `custentity_program_type/subtype`) and retries on
  "was not found" / "invalid search query".
- **Transform** (`transformRecords`): builds `Program` rows. `_resolveOwner` derives
  ownerId/email/first/last from primary-contact fields with fallbacks (customer email,
  full-name split, email local-part). `_resolveAddress` prefers structured shipping, else
  billing, else nulls. `_resolveProgramType` defaults to `individual`/`company` from
  `isperson`. `salesforceId` = legacy SFC number; `netsuiteId` = the NS internal id.

`SyncProgramsUseCase`:

- Runs under a cron guard, **batched** (`Config.Salesforce.BatchProcessingLimit`, default 50),
  looping while `nextRecordsUrl` is returned.
- **Skips** any program missing required owner fields (id/email/first/last).
- **Idempotent reconcile** (`_reconcileExistingProgramIds`): before saving a batch it looks up
  existing rows by `salesforceId` (preferred) or `netsuiteId`; on a match it adopts the
  existing row's uuid (`reconcileId`) so the save **UPDATES in place** instead of inserting a
  duplicate, and preserves app-owned fields (logo/banner/brandTheme).

---

## How the POC mirrors this

The POC ports the OAuth JWT + Redis token cache (`netsuiteAuth.js`), the SuiteQL executor with
`Prefer: transient` and query-variant fallback (`netsuiteClient.js`), the query builders
(`queries.js`), the sanitisation/filter/sort/status logic and row→DTO mappers (`queries.js` +
`mappers.js`), and the idempotent customer→Program sync (`sync/programSync.js`) using Postgres
`INSERT ... ON CONFLICT (netsuiteId) DO UPDATE`. A `NETSUITE_MODE` switch (`live`/`mock`/`auto`)
plus a health check lets the demo fall back to realistic mock data through the **same mappers**
when the sandbox is unreachable, so it never breaks on screen-share.
