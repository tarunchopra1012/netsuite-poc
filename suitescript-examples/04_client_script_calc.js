/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * Client script — runs in the BROWSER on the record form (not the server).
 * Used for live field calculations and save-time validation.
 *
 * Entry points:
 *   pageInit      — form finished loading
 *   fieldChanged  — a field's value changed
 *   validateField — validate a single field
 *   saveRecord    — user clicked Save (return false to block)
 *
 * DEPLOY: Client scripts are usually attached to a record type via a
 *   Script Deployment (Applies To = <record>). Hardest of the set to demo
 *   live — showing the code is enough for the interview.
 */
define(['N/log'], (log) => {

  const pageInit = (context) => {
    log.debug({ title: 'pageInit', details: `mode=${context.mode}` });
  };

  // Recalculate amount = quantity × rate whenever either changes.
  const fieldChanged = (context) => {
    const rec = context.currentRecord;
    if (context.fieldId === 'quantity' || context.fieldId === 'rate') {
      const qty = Number(rec.getValue({ fieldId: 'quantity' })) || 0;
      const rate = Number(rec.getValue({ fieldId: 'rate' })) || 0;
      rec.setValue({ fieldId: 'amount', value: qty * rate });
    }
  };

  // Block the save if a required field is empty.
  const saveRecord = (context) => {
    const rec = context.currentRecord;
    if (!rec.getValue({ fieldId: 'email' })) {
      alert('Email is required before saving.');
      return false; // stops the save
    }
    return true;
  };

  return { pageInit, fieldChanged, saveRecord };
});
