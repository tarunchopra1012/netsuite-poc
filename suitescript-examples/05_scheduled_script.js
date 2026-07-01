/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 *
 * Scheduled script — a batch job that runs on a schedule (like a cron).
 * This mirrors the program-sync story from your Node POC, but running
 * INSIDE NetSuite.
 *
 * NICE DEMO OPTION: after deploying, open the Script Deployment and use
 * "Save & Execute" to run it on demand, then read the Execution Log.
 *
 * Entry point: execute.
 */
define(['N/query', 'N/log'], (query, log) => {

  const execute = (context) => {
    log.audit({ title: 'Scheduled sync started', details: new Date().toISOString() });

    const rows = query.runSuiteQL({
      query: `
        SELECT id, entityid, companyname, email
        FROM customer
        WHERE isinactive = 'F'
        ORDER BY lastmodifieddate DESC
      `,
    }).asMappedResults();

    log.audit({ title: 'Active customers fetched', details: rows.length });

    // In a real sync you would loop and upsert each row into a downstream
    // system (the POC did INSERT ... ON CONFLICT into Postgres).
    rows.slice(0, 5).forEach((r) => {
      log.debug({ title: `Customer ${r.id}`, details: `${r.companyname} <${r.email}>` });
    });

    log.audit({ title: 'Scheduled sync done', details: `processed=${rows.length}` });
  };

  return { execute };
});
