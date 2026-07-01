/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  THE BRIDGE TO YOUR POC. A RESTlet is a custom REST endpoint that     │
 * │  runs INSIDE NetSuite — it is exactly what the Node POC was calling   │
 * │  from the OUTSIDE. Here we run the same SuiteQL via N/query.          │
 * │                                                                       │
 * │  "I built both sides: an external Node client (OAuth JWT + REST       │
 * │   SuiteQL) AND a RESTlet inside NetSuite that such a client calls."   │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * NOTE: A RESTlet needs an Authorization header (OAuth/TBA) to call, so it
 * is NOT ideal for a browser demo. Show the CODE, and if you have Postman +
 * a token you can hit it. For the live browser demo use 01_hello_suitelet.js.
 *
 * Entry points map to HTTP verbs: get, post, put, delete.
 */
define(['N/query', 'N/log'], (query, log) => {

  // GET /...?type=SalesOrd&limit=5  → returns matching transactions as JSON.
  const get = (requestParams) => {
    const type = String(requestParams.type || 'SalesOrd').replace(/[^A-Za-z]/g, '');
    let limit = parseInt(requestParams.limit, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 50) limit = 5;

    const results = query.runSuiteQL({
      query: `
        SELECT id, tranid, trandate, BUILTIN.DF(entity) AS customer
        FROM transaction
        WHERE type = ?
        ORDER BY trandate DESC
      `,
      params: [type],
    }).asMappedResults();

    return { count: Math.min(results.length, limit), items: results.slice(0, limit) };
  };

  // POST — NetSuite parses the JSON body into `requestBody` for you.
  const post = (requestBody) => {
    log.debug({ title: 'RESTlet POST body', details: JSON.stringify(requestBody) });
    return { received: true, echo: requestBody };
  };

  return { get, post };
});
