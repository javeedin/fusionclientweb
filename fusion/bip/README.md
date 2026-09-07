# Fusion SQL — BI Publisher "Query Runner" report

The **Fusion SQL** admin page (`/admin/fusion-sql`) runs live SELECT statements
against the Oracle Fusion pod. There is no direct database connection to a
Fusion SaaS pod — instead the app calls BI Publisher's SOAP service
`ExternalReportWSSService.runReport`, targeting a small **query-runner report**
whose data model executes an arbitrary, base64-encoded statement.

This is the same technique commercial tools (e.g. CloudMiner) use. You deploy
**one** report once; the app's schema browser bootstraps itself by running
data-dictionary queries through that same runner, so nothing else is needed.

## Fastest path: auto-deploy from the app

Fusion SQL → **Connection settings** → **Deploy runner report**. With a Fusion
login that has **BI Author / Administrator** rights, this creates the folder,
data model and report for you via `CatalogService` (`createFolder` +
`uploadObject`) — no manual BIP steps. Set the **BI data source name** first
(BIP → Administration → JDBC Connection; Financials pods are usually
`ApplicationDB_FSCM`). If your pod rejects the generated object (BIP catalog
formats vary by version), the failure is shown with the SOAP fault — fall back
to the manual steps below.

> **Read-only.** BI Publisher data-model cursors cannot run DML — only SELECT.
> The statement runs as whatever Fusion user the app authenticates with and is
> audited as that user. **Use a dedicated, least-privilege BI account on
> production**, not a super-user login.

---

## 1. Create the Data Model

BI Publisher → **Catalog** → New → **Data Model**.

> **Create the parameter FIRST — BIP will not add it for you.** BIP only
> auto-detects `:bind` variables (and offers to create a matching parameter)
> for a **Standard SQL** data set. Our runner is a PL/SQL block, so the data
> set must be **Non-standard SQL**, and BIP does **not** scan it for binds —
> no prompt appears and no parameter is created. You must add the parameter
> by hand, then the `:P_QRY_STMT` bind resolves to it by name at runtime.

- **Parameters** (left panel) → **＋ Create Parameter**:
  - Name: `P_QRY_STMT`  *(case-sensitive — must match the bind exactly)*
  - Data Type: `String`
  - Parameter Type: `Text`  *(leave the default value empty)*
- Add a **Data Set** of type **SQL Query**, name it `Q1`, data source = the
  Fusion transactional DB, set **Type of SQL = Non-standard SQL** (NOT
  "Standard SQL" — that validates the PL/SQL as plain SQL and fails with
  `ORA-00907`), and paste the PL/SQL runner from
  [`query_runner_datamodel.sql`](./query_runner_datamodel.sql). The block
  ends by opening a ref cursor from the decoded statement.
- Save the Data Model as **`QueryRunnerDM`** in a folder you control, e.g.
  `/Custom/ReERP/`.

> **If running the data model then errors with `PLS-00306: wrong number or
> types of arguments in call to 'GETLENGTH'`** (or similar LOB errors): a
> BIP **Text** parameter binds as `VARCHAR2`, not a LOB, so the `dbms_lob.*`
> calls on `:P_QRY_STMT` fail. Use the CLOB-safe runner variant in
> [`query_runner_datamodel.sql`](./query_runner_datamodel.sql) (it copies the
> bind into a CLOB first, then base64-decodes).

## 2. Create the Report

New → **Report**, using `QueryRunnerDM` as its data model.

- Skip the guided layout; add one minimal layout so the report is runnable.
- **Enable CSV output** (Report → Properties → Formats → CSV) — the app parses
  CSV first, falling back to XML. Enabling both is fine.
- Save the report as **`QueryRunner`** in the same folder.
- The **absolute path** is then `/Custom/ReERP/QueryRunner.xdo` — put this in
  the app's **Connection settings → Query-runner report path** (and the pod
  URL, e.g. `https://efmh-test.fa.em3.oraclecloud.com`).

## 3. Grant access

The Fusion account the app uses needs, at minimum:
- **BI Consumer** (run reports), and
- SELECT access (via its data roles) to the tables you intend to query.

Setup of the report itself needs an author role (**BI Author** / **BI
Administrator**) once.

---

## How it works (mechanism)

1. You type SQL in Fusion SQL. The app wraps it with a `ROWNUM` cap and
   **base64-encodes** it (safe transport through SOAP/XML).
2. The app POSTs a `runReport` SOAP envelope to
   `<pod>/xmlpserver/services/ExternalReportWSSService`, passing the encoded
   statement as parameter `P_QRY_STMT` and your Fusion credentials.
3. The report's data model **base64-decodes** the statement and does
   `OPEN :xdo_cursor FOR <your SQL>` — BI Publisher runs it inside the pod and
   returns the rows as CSV/XML (base64 in `<reportBytes>`).
4. The app decodes and parses that into the results grid.

The **schema browser** just runs dictionary queries through the same path,
e.g. `SELECT object_name FROM all_objects WHERE owner='FUSION' AND
object_type='TABLE' …` and `all_tab_columns` for a table's columns.

## Roadmap

Once this report exists, the same `fusion-sql:execute` channel can be exposed
to **Claude Chat** as a tool, so Claude can query live Fusion data directly
(write SQL → run → load into the SQLite/analysis layer), alongside the existing
ORDS-synced data.
