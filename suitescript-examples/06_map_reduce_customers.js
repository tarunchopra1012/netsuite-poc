/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Map/Reduce script — for LARGE-VOLUME, parallel processing that respects
 * NetSuite governance (usage limits). This is the answer to "how do you
 * process thousands of records without blowing the usage limit?" — NetSuite
 * yields between stages so each unit of work stays within governance.
 *
 * NICE DEMO OPTION: deploy, then "Save & Execute" from the deployment and
 * watch the Map/Reduce status page + Execution Log.
 *
 * Four stages, run in order:
 *   getInputData → map → reduce → summarize
 */
define(['N/query', 'N/log'], (query, log) => {

  // 1) Return the dataset to process (array or a query/search).
  const getInputData = () =>
    query.runSuiteQL({
      query: `SELECT id, companyname FROM customer WHERE isinactive = 'F'`,
    }).asMappedResults();

  // 2) map runs once per input row. context.value is a JSON string.
  const map = (context) => {
    const row = JSON.parse(context.value);
    // write(key, value) groups values by key and hands them to reduce.
    context.write({ key: String(row.id), value: row.companyname });
  };

  // 3) reduce runs once per unique key (with all its values).
  const reduce = (context) => {
    log.debug({ title: `Processing customer ${context.key}`, details: context.values.join(', ') });
    // ...do the real per-record work here (update, sync, email, etc.)
  };

  // 4) summarize runs once at the end — totals, errors, timing.
  const summarize = (summary) => {
    let errorCount = 0;
    summary.mapSummary.errors.iterator().each((key, err) => {
      errorCount += 1;
      log.error({ title: `Error on key ${key}`, details: err });
      return true;
    });
    log.audit({
      title: 'Map/Reduce complete',
      details: `usage=${summary.usage}, concurrency=${summary.concurrency}, errors=${errorCount}`,
    });
  };

  return { getInputData, map, reduce, summarize };
});
