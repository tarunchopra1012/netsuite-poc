/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  ⭐ THIS IS THE ONE TO RUN LIVE IN FRONT OF THE INTERVIEWER.          │
 * │                                                                       │
 * │  A Suitelet is a custom endpoint that runs INSIDE NetSuite. Because   │
 * │  you can open its URL in a browser (while logged in), you can show    │
 * │  SuiteScript executing with no Postman / OAuth needed.                │
 * │                                                                       │
 * │  It runs a SuiteQL query via the N/query module — the SAME SuiteQL    │
 * │  language used in the Node POC, just server-side instead of over REST.│
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * DEPLOY (see README): upload → create Script record → add Deployment
 *   (Status = Released) → click the deployment URL.
 *
 * TRY THESE URLS once deployed (append to the deployment URL):
 *   &limit=3
 *   &type=SalesOrd
 *   &type=CustInvc          (customer invoices)
 */
define(['N/query'], (query) => {
  const onRequest = (context) => {
    try {
      const params = context.request.parameters;

      // --- read + sanitize query params (shows you validate input) ---
      const type = String(params.type || 'SalesOrd').replace(/[^A-Za-z]/g, '');
      let limit = parseInt(params.limit, 10);
      if (!Number.isFinite(limit) || limit < 1 || limit > 50) limit = 5;

      // --- run SuiteQL. `params` = bind parameters (?), the injection-safe
      //     way — a nice talking point vs. the string-built queries in the POC.
      const results = query
        .runSuiteQL({
          query: `
          SELECT
            id,
            tranid,
            trandate,
            BUILTIN.DF(entity) AS customer,
            foreigntotal        AS total
          FROM transaction
          WHERE type = ?
          ORDER BY trandate DESC
        `,
          params: [type],
        })
        .asMappedResults();

      const items = results.slice(0, limit);

      // --- return clean JSON ---
      context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      context.response.write(
        JSON.stringify(
          {
            source: 'suitescript-suitelet',
            type,
            count: items.length,
            items,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
      context.response.write(JSON.stringify({ error: e.message }, null, 2));
    }
  };

  return { onRequest };
});
