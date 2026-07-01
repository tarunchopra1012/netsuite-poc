# SuiteScript examples

Six ready-to-upload SuiteScript 2.1 files. **For a live demo in front of the interviewer, deploy `01_hello_suitelet.js`** — it's the only one you can run by just opening a URL in the browser (no Postman, no OAuth).

| File                         | Type          | Live-demo-able?                            |
| ---------------------------- | ------------- | ------------------------------------------ |
| `01_hello_suitelet.js`       | Suitelet      | ⭐ **YES — open URL in browser**           |
| `02_user_event_validate.js`  | User Event    | Yes — edit a record, read the log          |
| `03_restlet_suiteql.js`      | RESTlet       | Needs auth (Postman/OAuth) — show the code |
| `04_client_script_calc.js`   | Client Script | Show the code                              |
| `05_scheduled_script.js`     | Scheduled     | Yes — "Save & Execute", read the log       |
| `06_map_reduce_customers.js` | Map/Reduce    | Yes — "Save & Execute", read the log       |

---

## ⏱️ Do this NOW (≈15 min) — deploy the Suitelet

### Step 0 — Enable SuiteScript (one-time, ~2 min)

`Setup → Company → Enable Features → SuiteCloud` tab →
tick **Client SuiteScript** and **Server SuiteScript** → accept terms → **Save**.

### Step 1 — Upload the script file

`Documents → Files → File Cabinet` → open the **SuiteScripts** folder →
**Add File** → choose `01_hello_suitelet.js` → **Save**.

### Step 2 — Create the Script record

`Customization → Scripting → Scripts → New` →
in the popup pick `01_hello_suitelet.js` → **Create Script Record**.
NetSuite auto-detects the type (Suitelet) from the `@NScriptType` tag →
give it a name like `Hello Suitelet` → **Save**.

### Step 3 — Deploy it

On the script record, go to the **Deployments** subtab (or click **Deploy Script**) →
set **Status = Released** →
(optional, so it works without login) tick **Available Without Login** →
**Save**.

### Step 4 — Run it 🎉

Open the deployment record → click the **URL** link (or copy it into a new tab).
You'll see live NetSuite data as JSON. **That's SuiteScript executing.**

Try appending params to the URL to show you understand input handling:

```
&limit=3
&type=SalesOrd
&type=CustInvc
```

---

## What to SAY while it runs (30-second script)

> "This is a Suitelet — a custom endpoint running inside NetSuite. When I open
> this URL, NetSuite runs my SuiteScript, which uses the `N/query` module to
> execute **SuiteQL** — the same query language I used in my Node POC, except
> here it runs server-side instead of over the REST API. Notice I'm passing the
> record type as a **bind parameter** (`?`), which is the injection-safe way to
> query. The result comes back as JSON, filtered and limited by the URL params."

Then, if they want more:

> "The same `N/query` pattern powers a **RESTlet** (file 03) — which is exactly
> what my Node POC was calling from the outside. So I've now worked both sides
> of a NetSuite integration."

---

## Backup demo (if the Suitelet URL misbehaves)

**Scheduled script (file 05) or Map/Reduce (file 06):** upload → create Script
record → add Deployment → on the deployment click **Save & Execute** → open
**View Execution Log** on the script record to show the `log.audit` output.

**User Event (file 02):** deploy with **Applies To = Sales Order**, then edit any
Sales Order and open the script's **View Execution Log** — proves you understand
the `beforeSubmit` / `afterSubmit` record lifecycle.

---

## SuiteScript facts to have ready (they may quiz you)

- **File structure:** JSDoc header (`@NApiVersion 2.1`, `@NScriptType ...`) +
  `define([modules], (m) => { ...; return { entryPoints }; })` — AMD module pattern.
- **Use 2.1, not 2.0** — 2.1 supports modern JS (arrow functions, `const`/`let`, promises).
- **Common `N/*` modules:** `N/record`, `N/search`, `N/query` (SuiteQL), `N/https`,
  `N/runtime`, `N/email`, `N/ui/serverWidget`, `N/log`, `N/error`, `N/task`.
- **Script types & entry points:**
  - User Event → `beforeLoad`, `beforeSubmit`, `afterSubmit` (server, on record events)
  - Client → `pageInit`, `fieldChanged`, `saveRecord` (browser, on the form)
  - Suitelet → `onRequest` (custom page / HTTP endpoint)
  - RESTlet → `get`, `post`, `put`, `delete` (external REST endpoint)
  - Scheduled → `execute` (cron-like batch)
  - Map/Reduce → `getInputData`, `map`, `reduce`, `summarize` (large-volume, governance-safe)
- **Governance:** NetSuite meters usage units per operation; Map/Reduce yields between
  stages to stay under the limit. (Ties to the 429/backoff handling in your POC.)
- **Deploy model:** script file (File Cabinet) → Script record → Script Deployment
  (status + audience). One script record can have many deployments.

---

## Honest positioning for the interviewer

> "I've written and deployed SuiteScript 2.1 in a sandbox — a Suitelet and a
> RESTlet running SuiteQL via `N/query`, plus a User Event script for validation.
> So I understand the script types, the `define`/entry-point model, and the
> deploy flow. My depth is on the Node integration side, but I've got hands-on
> SuiteScript footing and can build on it quickly."
