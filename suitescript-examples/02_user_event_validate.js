/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * User Event script — the MOST COMMON SuiteScript type. It runs on the
 * SERVER when a record is loaded or saved. Great "I understand the record
 * lifecycle" demo: edit a Sales Order and watch the Execution Log.
 *
 * Entry points:
 *   beforeLoad   — as the record is opened
 *   beforeSubmit — before it is saved   (use for validation)
 *   afterSubmit  — after it is saved     (use for side effects)
 *
 * DEPLOY: upload → create Script record → add Deployment, and set
 *   "Applies To = Sales Order" (or any record you like) → Status = Released.
 *   Then edit that record type and open the script's "View Execution Log".
 */
define(['N/log', 'N/error'], (log, error) => {

  const beforeLoad = (context) => {
    log.debug({ title: 'beforeLoad', details: `type=${context.type}` });
  };

  const beforeSubmit = (context) => {
    // Only validate on create/edit (not on delete).
    if (context.type === context.UserEventType.DELETE) return;

    const rec = context.newRecord;
    const memo = rec.getValue({ fieldId: 'memo' });

    // Block the save with a clean error if a required field is missing.
    if (!memo) {
      throw error.create({
        name: 'MISSING_MEMO',
        message: 'Memo is required before saving this order.',
      });
    }
  };

  const afterSubmit = (context) => {
    if (context.type === context.UserEventType.DELETE) return;
    // Runs after the save succeeds — this is where you'd trigger a sync,
    // send an email, or create a related record.
    log.audit({
      title: 'Sales order saved',
      details: `id=${context.newRecord.id}, event=${context.type}`,
    });
  };

  return { beforeLoad, beforeSubmit, afterSubmit };
});
