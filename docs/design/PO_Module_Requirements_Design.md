# Re-ERP Procurement Module — Requirements & Design (RD)

**Version 1.1 — October 2026 · Module code `PO` · Status: draft for review**

| Version | Change |
|---|---|
| 1.1 | Purchase orders can be created **directly, without a requisition** (default); requisitions are optional. Supplier data comes **only from the existing `RR_SUPPLIER_*` tables** — section 4.10 lists every table and column used. |
| 1.0 | First issue |

Prepared for the Re-ERP product team. Defines the scope, processes, data model, accounting, services, screens and
validations of the native Re-ERP Procurement (Purchasing) module, built primarily for **expense (non-stock)
purchasing**: services, consumables, office supplies, IT equipment below the asset threshold, maintenance, rent,
professional fees. It plugs into the existing Re-ERP Suppliers, Payables, Tax, Approvals, SLA and General Ledger,
and keeps the hooks the Inventory RD (v2.8) reserved for stock purchasing.

---

## 1. Executive Summary

Re-ERP today runs Payables, Receivables, Cash, Fixed Assets, Tax and General Ledger natively. Purchasing is
only *viewed* from Oracle Fusion (the `/procurement/*` screens read Fusion REST). This module makes
Procure-to-Pay native:

```
 Need ──► Requisition ──► Approval ──► Purchase Order ──► Approval ──► Supplier
                                                                         │
 Payment ◄── AP Invoice ◄── Match (2-way / 3-way) ◄── Receipt ◄──────────┘
 (existing)   (existing,        holds, variances      quantity or amount,
               extended)                              accrual accounting
```

The four design principles:

1. **Expense first.** Every line is charged to a GL account at order time. There is no on-hand stock; a receipt
   confirms goods arrived or a service was performed, and (optionally) accrues the liability.
2. **One quantity ledger.** Each PO distribution carries ordered, received, billed and cancelled quantities and
   amounts. Receiving and invoicing only move these counters, so open commitments, uninvoiced receipts (GRNI) and
   PO status are always derivable and always reconcile.
3. **Reuse, don't rebuild.** Suppliers (`RR_SUPPLIER_MASTER` / `RR_SUPPLIER_SITES`), tax codes
   (`RR_INPUT_OUTPUT_TAX`), business units (`RR_GL_BUSINESS_UNITS`), the approval engine (`RR_APPROVAL_*`, which
   already lists `PROCUREMENT` as a module), SLA (`RR_SLA_ACCOUNTING_HEADERS/LINES`), GL journals and AP invoices
   (whose lines already have `PURCHASE_ORDER_NUMBER`, `RECEIPT_NUMBER` columns) are used as they are.
4. **Same service style as Inventory.** Reads go through the guarded read gateway (`ai/executequery`) on
   `RR_PO_V_*` views; writes go through one dispatcher endpoint (`po/execute`) that calls whitelisted package
   procedures. All rules live in PL/SQL packages.

### 1.1 Functional coverage map

| Area | Contents | Section |
|---|---|---|
| Setup | BU purchasing options, locations, categories, expense-item catalog, buyers, requester defaults, account derivation, numbering; suppliers from the existing `RR_SUPPLIER_*` tables (+ optional site options) | 4 |
| Requisitions | Catalog and free-text requests, multi-distribution charge accounts, approval, buyer assignment, return to requester | 5.1, 6.1 |
| Purchase orders | **Direct POs without a requisition (standard path)**, quantity and amount (service) lines, schedules, distributions, approval, PDF and email to supplier | 5.2, 6.2 |
| Autocreate | Approved requisition lines → POs, grouped by supplier, site, currency and BU | 6.3 |
| Change orders | Revisions with re-approval, archive of every approved version | 5.3, 6.4 |
| Receiving | Receive by quantity or amount, returns, corrections, receipt accrual | 5.4, 6.5 |
| Invoice matching | 2-way and 3-way match from AP, tolerances, holds, price and exchange variances | 5.5, 6.6 |
| Accruals | Receipt accrual or period-end accrual, uninvoiced-receipts reconciliation, write-off | 6.7, 7 |
| Close and cancel | Automatic close for receiving and invoicing, manual close, final close, cancel | 6.8 |
| Accounting | Event model, Dr/Cr rules, worked examples, SLA and GL hand-off | 7 |
| Security | Roles, BU scoping, segregation of duties | 8 |
| Services and UI | Read views, package specifications, menu, screens, wireframes | 9, 10 |
| Reports | Open POs, 3-way status, GRNI, spend, aging, approval turnaround | 11 |
| Rules | Validation catalog per feature | 12 |
| Rollout | Scripts, seeding, migration from Fusion, phases, open decisions | 13–15 |

### 1.2 Out of scope (later phases or other modules)

* **Inventory (stock) lines** — line type `INVENTORY` and the `PO_RECEIPT` inventory transaction reserved in the
  Inventory RD; delivered in Phase 2b once Inventory 1c (transaction engine) is live.
* **Blanket purchase agreements and releases** — Phase 2 (tables named in 5.7 so Phase 1 columns are ready).
* **Budgetary control and encumbrance** — Phase 3 (funds check hooks in 6.9).
* **Sourcing** (RFQs, quotations, bid analysis), **supplier portal**, **punch-out catalogs** — Phase 4.
* **Supplier onboarding** — suppliers stay mastered where they are today (Fusion sync / AP). Procurement only
  adds purchasing options per supplier site.
* **Capital purchases** — a category can be flagged `CAPEX`; the AP-to-Fixed-Assets hand-off remains the existing
  FA additions process.

---

## 2. Business Process

### 2.1 Roles

| Role | Does |
|---|---|
| Requester | Raises requisitions for what they need; receives services/goods delivered to them |
| Preparer | Raises a requisition on behalf of a requester |
| Approver | Approves requisitions, POs and change orders (existing approval engine users) |
| Buyer | Converts requisitions to POs, negotiates price, sends the PO, manages changes and closure |
| Receiver | Records receipts, returns and corrections (often the requester) |
| AP clerk | Enters supplier invoices and matches them to POs/receipts; releases holds |
| Procurement manager | Setup, reports, final close, write-offs |

### 2.2 End-to-end flow

```
REQUESTER                APPROVER            BUYER                    SUPPLIER   RECEIVER          AP / GL
─────────                ────────            ─────                    ────────   ────────          ───────
Create requisition
(catalog/free text,
 account derived)
 │ submit
 ▼                        approve ──────────► Process requisitions
INCOMPLETE→PENDING        (rule by amount,    (autocreate PO,
→APPROVED                  BU, category)       set supplier/price)
                                               │ submit PO
                          approve ◄────────────┘
                          PO APPROVED ───────► communicate (PDF+email) ──► delivers
                                                                            │
                                                                            ▼
                                                                         Receive qty/amount
                                                                         (receipt accrual
                                                                          Dr Expense Cr GRNI)
                                                                            │
                                                                            ▼
                                                                                      Invoice entered
                                                                                      Match to PO/receipt
                                                                                      holds? → release
                                                                                      account (Dr GRNI/
                                                                                      Expense, Cr Liab.)
                                                                                      Pay (existing)
                          ◄───────── PO auto-closes when received and billed within tolerance ─────────
```

Short paths are supported without bending the model:

* **Direct PO (standard path)** — a buyer creates the PO straight away, without a requisition (section 6.2.0).
  Requisitions are optional; a BU can make them mandatory with `REQUIRE_REQUISITION = Y`.
* **Two-way services** — an amount line with match level `TWO_WAY` is invoiced directly against the PO; no
  receipt is needed.
* **Emergency / after-the-fact** — allowed only when the BU option `ALLOW_AFTER_FACT_PO = Y`; such POs are flagged
  and listed in the compliance report.

### 2.3 Line types

| Line type | Ordered as | Received as | Matched as | Typical use |
|---|---|---|---|---|
| `QUANTITY` | quantity × unit price, with UOM | quantity | quantity × invoice price | Office chairs, toner, laptops, PPE |
| `AMOUNT` | amount only (quantity is 1 and implied) | amount | amount | Consultancy, maintenance, rent, events, milestones |

Both line types are expense lines: the charge account is on the distribution. `INVENTORY` (Phase 2b) will add a
destination type of inventory and route the receipt to the Inventory engine.

---

## 3. Architecture and Conventions

### 3.1 Where the module sits

```
                 +------------------------------------------------------+
  Users ───────► |                 PROCUREMENT  (PO)                     |
  (roles 2.1,    |  setup · requisitions · POs · change orders           |
   BU access)    |  receiving · matching · accruals · close              |
                 +-----+-----------+-----------+-----------+------------+
                       |           |           |           |
      suppliers/sites  |   tax     |  approval |   SLA → GL journals
   RR_SUPPLIER_MASTER  | RR_INPUT_ | RR_APPROV-| RR_SLA_ACCOUNTING_*
   RR_SUPPLIER_SITES   | OUTPUT_TAX| AL_*      | (REFERENCE5 = PO_RECEIPTS /
   (existing)          | (existing)| (existing)|  PO_ACCRUALS)
                       |           |           |
                       +-----► AP invoices (existing, extended with matching + holds)
                                 RR_AP_INVOICES_ALL / RR_AP_INVOICE_LINES_ALL
                                 └─► payments (existing; held invoices excluded)
```

### 3.2 Conventions (same as the Inventory RD)

* **Tables** are prefixed `RR_PO_`; one AP-side table, `RR_AP_INVOICE_HOLDS`, is added to Payables.
* **Primary keys** come from one sequence `RR_PO_SEQ` starting at `6000000001` (Inventory uses `5000000001`).
* **WHO columns** on every table: `CREATED_BY VARCHAR2(150)`, `CREATION_DATE TIMESTAMP DEFAULT SYSTIMESTAMP`,
  `LAST_UPDATED_BY VARCHAR2(150)`, `LAST_UPDATE_DATE TIMESTAMP`, `LAST_UPDATE_LOGIN VARCHAR2(100)`. Stamped by the
  packages from `p_user`. Immutable tables (receipt transactions, matches, revisions, accrual lines, action
  history, execution log) are insert-only. Where a table below says *Audit columns* it means exactly this set.
* **Business unit** is always `BUSINESS_UNIT_ID` (the Fusion BU id kept in `RR_GL_BUSINESS_UNITS`), never the name.
* **Money**: every document carries its transaction currency plus `RATE_TYPE`, `RATE_DATE`, `RATE`
  (from `RR_CURRENCY_DAILY_RATES`). Functional amounts are computed with the frozen rate and rounded to 2 decimals.
* **Accounts** are full code combinations as strings (`01-10-200-6105001-0000-000-00-000-000`), validated
  against the GL combinations table, the same way AP stores `DISTRIBUTION_COMBINATION`.
* **Dates** are `DATE` (no time) for business dates; `TIMESTAMP` for audit.
* **Soft rules, hard data**: nothing is physically deleted after approval. Drafts can be deleted; everything
  else is cancelled or closed.

### 3.3 Entity-relationship overview

```
SETUP                                    TRANSACTIONS
─────                                    ────────────
RR_PO_BU_OPTIONS (1 per BU)              RR_PO_REQ_HEADERS
RR_PO_LOCATIONS                            └─< RR_PO_REQ_LINES
RR_PO_CATEGORIES (tree)                         └─< RR_PO_REQ_DISTRIBUTIONS ─────────┐
  └─< RR_PO_EXPENSE_ITEMS                                                             │ (req_distribution_id)
RR_PO_BUYERS                             RR_PO_HEADERS ───< RR_PO_REVISIONS          │
RR_PO_REQUESTER_DEFAULTS                   │        └────< RR_PO_CHANGE_ORDERS        │
RR_PO_ACCOUNT_RULES                        └─< RR_PO_LINES                            │
RR_PO_DOC_SEQUENCES                              └─< RR_PO_SCHEDULES                  │
RR_PO_SUPPLIER_SITE_OPTIONS ── RR_SUPPLIER_SITES       └─< RR_PO_DISTRIBUTIONS ◄──────┘
                                                              ▲   ▲   ▲
GATEWAY                                  RR_PO_RCV_HEADERS    │   │   │
RR_PO_PROC_REGISTRY                        └─< RR_PO_RCV_TRANSACTIONS │   │
RR_PO_EXEC_LOG                                   └─< RR_PO_RCV_DISTRIBUTIONS ─┘   │
                                                                                  │
CROSS-CUTTING                            RR_AP_INVOICE_LINES_ALL ──< RR_PO_INVOICE_MATCHES
RR_PO_ATTACHMENTS                        RR_AP_INVOICES_ALL ─────< RR_AP_INVOICE_HOLDS
RR_PO_ACTION_HISTORY                     RR_PO_ACCRUAL_RUNS ─────< RR_PO_ACCRUAL_LINES ─┘
RR_PO_COMMUNICATIONS                     RR_PO_ACCRUAL_WRITE_OFFS
```

### 3.4 Complete database object inventory

| Object | Kind | Phase | Purpose |
|---|---|---|---|
| `RR_PO_SEQ` | sequence | 1a | All primary keys |
| `RR_PO_BU_OPTIONS` | table | 1a | Purchasing options per business unit |
| `RR_PO_LOCATIONS` | table | 1a | Ship-to, bill-to and deliver-to addresses |
| `RR_PO_CATEGORIES` | table | 1a | Purchasing category tree with default expense account |
| `RR_PO_EXPENSE_ITEMS` | table | 1a | Expense-item catalog (non-stock) |
| `RR_PO_UOMS` | table | 1a | Units of measure (shared definition with `RR_INV_UOMS`, see 4.5) |
| `RR_PO_BUYERS` | table | 1a | Who can buy, for which BU / category |
| `RR_PO_REQUESTER_DEFAULTS` | table | 1a | Requester's default BU, deliver-to and charge account |
| `RR_PO_ACCOUNT_RULES` | table | 1a | Segment overrides for charge-account derivation |
| `RR_PO_DOC_SEQUENCES` | table | 1a | Document numbering per BU and document type |
| `RR_PO_SUPPLIER_SITE_OPTIONS` | table | 1a | Purchasing options per supplier site |
| `RR_PO_REQ_HEADERS` / `_LINES` / `_DISTRIBUTIONS` | tables | 1b | Requisitions |
| `RR_PO_HEADERS` / `_LINES` / `_SCHEDULES` / `_DISTRIBUTIONS` | tables | 1c | Purchase orders |
| `RR_PO_REVISIONS` | table | 1c | JSON snapshot of every approved PO revision |
| `RR_PO_CHANGE_ORDERS` | table | 1g | Proposed changes awaiting approval |
| `RR_PO_RCV_HEADERS` / `_TRANSACTIONS` / `_DISTRIBUTIONS` | tables | 1d | Receipts, returns, corrections |
| `RR_PO_INVOICE_MATCHES` | table | 1e | Invoice line ↔ PO distribution / receipt links |
| `RR_AP_INVOICE_HOLDS` | table | 1e | Matching holds on AP invoices (Payables-owned) |
| `RR_PO_ACCRUAL_RUNS` / `_LINES` | tables | 1f | Period-end accrual runs |
| `RR_PO_ACCRUAL_WRITE_OFFS` | table | 1f | Write-off of old uninvoiced receipt accruals |
| `RR_PO_ATTACHMENTS` | table | 1b | Files on requisitions, POs, receipts |
| `RR_PO_ACTION_HISTORY` | table | 1b | Status changes and actions on every document |
| `RR_PO_COMMUNICATIONS` | table | 1c | PO sent to supplier log |
| `RR_PO_PROC_REGISTRY` / `RR_PO_EXEC_LOG` | tables | 1a | Write-gateway whitelist and call log |
| `RR_PO_AGREEMENTS` / `_LINES` | tables | 2 | Blanket agreements (reserved) |
| `RR_PO_BUDGETS` / `RR_PO_FUNDS_LEDGER` | tables | 3 | Budgetary control (reserved) |
| `RR_PO_V_*` (section 9.1) | views | 1a–1f | One read view per screen |
| `RR_PO_*_PKG` (section 9.3) | packages | 1a–1g | All business logic |
| `RR_APPROVAL_CALLBACKS` | table | 1b | Approval-engine extension: who to call on a decision |
| `RR_APPROVAL_RULES` + `BUSINESS_UNIT_ID`, `CATEGORY_CODE` | columns | 1b | Approval-engine extension: rule filters |

---

## 4. Setup Data Model

### 4.1 RR_PO_BU_OPTIONS — purchasing options per business unit (1 row per BU)

Everything a BU decides once: currency defaults, match level, tolerances, accrual method, accounts, approvals and
numbering behaviour. Values that drive accounting or matching are **copied onto the PO schedule at approval**, so
changing an option later never changes the meaning of an approved PO.

| Column | Type | Req | Description |
|---|---|---|---|
| BU_OPTION_ID | NUMBER | Y | PK |
| BUSINESS_UNIT_ID | NUMBER | Y | `RR_GL_BUSINESS_UNITS.BUSINESS_UNIT_ID`, unique |
| FUNCTIONAL_CURRENCY | VARCHAR2(15) | Y | From the BU's primary ledger (e.g. AED) |
| DEFAULT_RATE_TYPE | VARCHAR2(30) | Y | Default `Corporate` |
| DEFAULT_SHIP_TO_LOCATION_ID | NUMBER | N | `RR_PO_LOCATIONS` |
| DEFAULT_BILL_TO_LOCATION_ID | NUMBER | N | `RR_PO_LOCATIONS` |
| MATCH_LEVEL_QUANTITY | VARCHAR2(10) | Y | `TWO_WAY` / `THREE_WAY` for quantity lines (default `THREE_WAY`) |
| MATCH_LEVEL_AMOUNT | VARCHAR2(10) | Y | Same for amount (service) lines (default `TWO_WAY`) |
| ACCRUE_AT_RECEIPT_FLAG | VARCHAR2(1) | Y | `Y` = receipt accrual; `N` = period-end accrual (see 7.1) |
| RECEIPT_ACCRUAL_ACCOUNT | VARCHAR2(200) | Y | GRNI / accrued liabilities combination |
| PRICE_VARIANCE_ACCOUNT | VARCHAR2(200) | N | IPV account; NULL = post variance to the charge account (usual for expense) |
| EXCHANGE_GAIN_ACCOUNT | VARCHAR2(200) | Y | Realised ERV gain on match |
| EXCHANGE_LOSS_ACCOUNT | VARCHAR2(200) | Y | Realised ERV loss on match |
| ACCRUAL_WRITE_OFF_ACCOUNT | VARCHAR2(200) | N | Default account for write-offs (6.7.3) |
| ACCRUAL_WRITE_OFF_AGE_DAYS | NUMBER | N | Open distributions with receipt accruals older than this may be written off (NULL = closed distributions only) |
| SOD_BUYER_RECEIVE | VARCHAR2(1) | Y | `N` = the PO's buyer may not receive against it (default `Y`) |
| OVER_RECEIPT_TOLERANCE_PCT | NUMBER(5,2) | Y | Default 0 |
| OVER_RECEIPT_ACTION | VARCHAR2(10) | Y | `REJECT` / `WARNING` |
| EARLY_RECEIPT_DAYS | NUMBER | N | Receipt allowed this many days before need-by (NULL = no check) |
| INVOICE_QTY_TOLERANCE_PCT | NUMBER(5,2) | Y | Billed vs ordered/received (default 0) |
| INVOICE_PRICE_TOLERANCE_PCT | NUMBER(5,2) | Y | Invoice price vs PO price (default 0) |
| INVOICE_AMOUNT_TOLERANCE | NUMBER | N | Absolute amount tolerance in functional currency |
| RECEIPT_CLOSE_TOLERANCE_PCT | NUMBER(5,2) | Y | Auto *closed for receiving* when received ≥ ordered × (1 − tol) |
| INVOICE_CLOSE_TOLERANCE_PCT | NUMBER(5,2) | Y | Auto *closed for invoicing* when billed ≥ basis × (1 − tol) |
| REQ_APPROVAL_REQUIRED | VARCHAR2(1) | Y | Default Y |
| PO_APPROVAL_REQUIRED | VARCHAR2(1) | Y | Default Y |
| CO_REAPPROVAL_THRESHOLD_PCT | NUMBER(5,2) | Y | Change orders that raise the PO total by more than this need approval (default 0 = always) |
| AUTOCREATE_MODE | VARCHAR2(10) | Y | `MANUAL` (buyer workbench) / `AUTO` (approved catalog lines with a preferred supplier become POs automatically) |
| REQUIRE_REQUISITION | VARCHAR2(1) | Y | Default **`N`**: POs can be created directly. `Y` = POs only from requisitions (except buyers with `DIRECT_PO_ALLOWED`) |
| ALLOW_AFTER_FACT_PO | VARCHAR2(1) | Y | Allow PO dated after the invoice / receipt (flagged) |
| BUDGET_CONTROL_LEVEL | VARCHAR2(10) | Y | `NONE` (Phase 1) / `ADVISORY` / `ABSOLUTE` (Phase 3) |
| PO_TERMS_TEXT | CLOB | N | Standard terms and conditions printed on the PO |
| PO_EMAIL_SUBJECT / PO_EMAIL_BODY | VARCHAR2(400) / CLOB | N | Templates for sending POs (placeholders `{PO_NUMBER}`, `{SUPPLIER}`) |
| STATUS | VARCHAR2(10) | Y | `ACTIVE` / `INACTIVE` |
| Audit columns | - | Y | - |

### 4.2 RR_PO_LOCATIONS

| Column | Type | Req | Description |
|---|---|---|---|
| LOCATION_ID | NUMBER | Y | PK |
| LOCATION_CODE | VARCHAR2(30) | Y | Unique (e.g. `DIFC-HQ`) |
| LOCATION_NAME | VARCHAR2(240) | Y | |
| BUSINESS_UNIT_ID | NUMBER | N | NULL = usable by every BU |
| ADDRESS_LINE1..3, CITY, REGION, COUNTRY, PO_BOX | VARCHAR2 | N | Printed on the PO |
| CONTACT_NAME, PHONE, EMAIL | VARCHAR2 | N | Delivery contact |
| SHIP_TO_FLAG / BILL_TO_FLAG / DELIVER_TO_FLAG | VARCHAR2(1) | Y | Where the location may be used |
| STATUS | VARCHAR2(10) | Y | `ACTIVE` / `INACTIVE` |
| Audit columns | - | Y | - |

### 4.3 RR_PO_CATEGORIES — purchasing categories

Categories classify spend and **drive the natural account**. A requester picks "IT Accessories" and never types an
account; the category supplies segment 4 (natural account).

| Column | Type | Req | Description |
|---|---|---|---|
| CATEGORY_ID | NUMBER | Y | PK |
| CATEGORY_CODE | VARCHAR2(40) | Y | Unique (e.g. `IT.ACCESSORIES`) |
| CATEGORY_NAME | VARCHAR2(240) | Y | |
| PARENT_CATEGORY_ID | NUMBER | N | Tree (2–3 levels typical: `IT` › `IT.ACCESSORIES`) |
| DEFAULT_NATURAL_ACCOUNT | VARCHAR2(30) | N | Segment-4 value; inherited from the parent when NULL |
| DEFAULT_LINE_TYPE | VARCHAR2(10) | Y | `QUANTITY` / `AMOUNT` |
| DEFAULT_UOM | VARCHAR2(10) | N | For quantity lines |
| DEFAULT_TAX_CODE | VARCHAR2(50) | N | `RR_INPUT_OUTPUT_TAX.TAX_CODE` (input tax) |
| RECEIPT_REQUIRED_FLAG | VARCHAR2(1) | Y | `Y` forces `THREE_WAY` on its lines regardless of BU default |
| CAPEX_FLAG | VARCHAR2(1) | Y | Asset-type spend; lines are flagged for the FA additions process |
| REQUESTABLE_FLAG | VARCHAR2(1) | Y | Visible to requesters (parents often `N`) |
| STATUS | VARCHAR2(10) | Y | `ACTIVE` / `INACTIVE` |
| Audit columns | - | Y | - |

### 4.4 RR_PO_EXPENSE_ITEMS — expense-item catalog

A light catalog of things the company buys repeatedly. Not stock items: no on-hand, no cost. A requester can
always order free text instead; catalog items just pre-fill description, category, UOM, price and supplier.

| Column | Type | Req | Description |
|---|---|---|---|
| EXPENSE_ITEM_ID | NUMBER | Y | PK |
| ITEM_CODE | VARCHAR2(40) | Y | Unique (e.g. `EXP-TONER-HP26A`) |
| DESCRIPTION | VARCHAR2(240) | Y | |
| LONG_DESCRIPTION | VARCHAR2(4000) | N | |
| CATEGORY_ID | NUMBER | Y | `RR_PO_CATEGORIES` |
| LINE_TYPE | VARCHAR2(10) | Y | From the category, overridable |
| UOM_CODE | VARCHAR2(10) | N | Required for quantity items |
| LIST_PRICE / CURRENCY_CODE | NUMBER / VARCHAR2(15) | N | Indicative price |
| PREFERRED_SUPPLIER_ID / PREFERRED_SUPPLIER_SITE_ID | NUMBER | N | Used by autocreate |
| SUPPLIER_ITEM_NUM | VARCHAR2(60) | N | Supplier's part number |
| LEAD_TIME_DAYS | NUMBER | N | Need-by default = today + lead time |
| NATURAL_ACCOUNT_OVERRIDE | VARCHAR2(30) | N | Overrides the category's account |
| TAX_CODE | VARCHAR2(50) | N | Overrides the category's tax code |
| INV_ITEM_ID | NUMBER | N | Reserved: link to `RR_INV_ITEMS` when the item becomes stocked (Phase 2b) |
| STATUS | VARCHAR2(10) | Y | `ACTIVE` / `INACTIVE` |
| Audit columns | - | Y | - |

### 4.5 RR_PO_UOMS — units of measure

Same columns as `RR_INV_UOMS` in the Inventory RD 4.7 (`UOM_CODE`, `UOM_NAME`, `UOM_CLASS`, `BASE_UOM_FLAG`,
`CONVERSION_TO_BASE`, `STATUS`). Script 301 creates `RR_PO_UOMS` only if `RR_INV_UOMS` does not exist, and creates
a synonym in the other direction otherwise, so both modules always read one list. Seeded: `EA`, `BOX`, `PK`,
`SET`, `HR`, `DAY`, `MON`, `YR`, `KG`, `LTR`, `M`, `LOT`.

### 4.6 RR_PO_BUYERS

| Column | Type | Req | Description |
|---|---|---|---|
| BUYER_ID | NUMBER | Y | PK |
| USER_NAME | VARCHAR2(150) | Y | Re-ERP login |
| BUSINESS_UNIT_ID | NUMBER | N | NULL = all BUs the user has access to |
| CATEGORY_ID | NUMBER | N | Specialisation used by buyer assignment (6.1.4) |
| DIRECT_PO_ALLOWED | VARCHAR2(1) | Y | Default `Y`. Only matters when the BU sets `REQUIRE_REQUISITION = Y`: buyers with `Y` may still create direct POs |
| EMAIL / PHONE | VARCHAR2 | N | Printed on the PO as the contact |
| DEFAULT_FLAG | VARCHAR2(1) | Y | Fallback buyer for the BU |
| STATUS | VARCHAR2(10) | Y | `ACTIVE` / `INACTIVE` |
| Audit columns | - | Y | - |

### 4.7 RR_PO_REQUESTER_DEFAULTS

| Column | Type | Req | Description |
|---|---|---|---|
| DEFAULT_ID | NUMBER | Y | PK |
| USER_NAME | VARCHAR2(150) | Y | Unique with BUSINESS_UNIT_ID |
| BUSINESS_UNIT_ID | NUMBER | Y | Default BU for the user's requisitions |
| DELIVER_TO_LOCATION_ID | NUMBER | N | |
| CHARGE_ACCOUNT_TEMPLATE | VARCHAR2(200) | Y | Full combination giving the user's cost centre segments; segment 4 is replaced by the category's account (6.1.3) |
| MANAGER_USER_NAME | VARCHAR2(150) | N | Reserved for supervisor-chain approvals (open decision D3) |
| Audit columns | - | Y | - |

### 4.8 RR_PO_ACCOUNT_RULES — charge-account derivation overrides

Optional rules applied after the default derivation, in `PRIORITY` order; the first matching rule per segment wins.

| Column | Type | Req | Description |
|---|---|---|---|
| RULE_ID | NUMBER | Y | PK |
| BUSINESS_UNIT_ID | NUMBER | N | NULL = any BU |
| CATEGORY_ID | NUMBER | N | NULL = any category (child categories match their parent's rule) |
| EXPENSE_ITEM_ID | NUMBER | N | NULL = any item |
| SEGMENT_NUM | NUMBER(2) | Y | 1–10 |
| SEGMENT_VALUE | VARCHAR2(30) | Y | Value forced into that segment |
| PRIORITY | NUMBER | Y | Lower runs first |
| STATUS | VARCHAR2(10) | Y | |
| Audit columns | - | Y | - |

Example: "all `FACILITIES.*` spend in BU DIFC goes to cost centre 900" → `SEGMENT_NUM = 3, SEGMENT_VALUE = '900'`.

### 4.9 RR_PO_DOC_SEQUENCES — document numbering

| Column | Type | Req | Description |
|---|---|---|---|
| DOC_SEQ_ID | NUMBER | Y | PK |
| BUSINESS_UNIT_ID | NUMBER | Y | |
| DOC_TYPE | VARCHAR2(10) | Y | `REQ`, `PO`, `RCV`, `CO`, `AGR` |
| PREFIX | VARCHAR2(20) | N | e.g. `PO-DIFC-` |
| YEAR_IN_NUMBER | VARCHAR2(1) | Y | `Y` gives `PO-DIFC-2026-00017` |
| NEXT_NUMBER | NUMBER | Y | Incremented with `SELECT … FOR UPDATE` inside the creating transaction (gap-free per committed document) |
| PAD_LENGTH | NUMBER | Y | Default 5 |
| RESET_YEARLY | VARCHAR2(1) | Y | Restart at 1 each fiscal year |
| CURRENT_YEAR | NUMBER(4) | N | Year the counter belongs to |
| Audit columns | - | Y | - |

Numbers are assigned **on creation** for POs, receipts and change orders, and **on submit** for requisitions (drafts
show `Draft #<id>`), so abandoned drafts never burn numbers.

### 4.10 Suppliers — existing `RR_SUPPLIER_*` tables

Procurement has **no supplier master of its own**. Every supplier, site and address on a PO comes from the existing
Re-ERP supplier tables, which Payables already uses and the current supplier sync keeps up to date. Procurement only
reads them; the one extension (`RR_PO_SUPPLIER_SITE_OPTIONS`, below) is a 1:1 add-on per site and holds no supplier
data.

| Existing table | Used for | Columns used |
|---|---|---|
| `RR_SUPPLIER_MASTER` | Supplier LOV, status, tax registration on the PO print | `SUPPLIER_ID`, `SUPPLIER`, `SUPPLIER_NUMBER`, `ALTERNATE_NAME`, `STATUS`, `INACTIVE_DATE`, `TAX_REGISTRATION_NUMBER`, `TAXPAYER_ID`, `ONE_TIME_SUPPLIER_FLAG` |
| `RR_SUPPLIER_SITES` | Site LOV, purchasing flags, payment terms default, procurement BU | `SUPPLIER_SITE_ID`, `SUPPLIER_ID`, `SUPPLIER_SITE`, `SUPPLIER_SITE_CODE`, `PROCUREMENT_BU_ID`, `PURCHASING_FLAG`, `PAY_SITE_FLAG`, `PAYMENT_TERMS`, `PAYMENT_TERMS_ID`, `ADDRESS_NAME`, inactive date / status |
| `RR_SUPPLIER_ADDRESS` | Address printed on the PO (ordering purpose) and shown on the PO header | `SUPPLIER_ID` + `ADDRESS_NAME` (join to the site), `ADDRESS_LINE1..4`, `CITY`, `STATE`, `COUNTRY`, `POSTAL_CODE`, `FORMATTED_ADDRESS`, `ADDR_PURPOSE_ORDERING`, phone and fax |
| `RR_SUPPLIER_SITE_ASSIGNMENTS` | Which business units may use the site; bill-to BU; default ship-to / bill-to locations | `SUPPLIER_SITE_ID`, `CLIENT_BU_ID`, `BILL_TO_BU_ID`, `SHIP_TO_LOCATION_CODE`, `BILL_TO_LOCATION_CODE`, `STATUS`, `INACTIVE_DATE` |

Rules that use them (PO-02, MAT-01):

* Supplier `STATUS` active and `INACTIVE_DATE` empty or in the future.
* Site active, `PURCHASING_FLAG = 'Y'`, and usable by the PO's BU: an active `RR_SUPPLIER_SITE_ASSIGNMENTS` row with
  `CLIENT_BU_ID = PO.BUSINESS_UNIT_ID`, or `RR_SUPPLIER_SITES.PROCUREMENT_BU_ID = PO.BUSINESS_UNIT_ID`.
* The supplier LOV on the PO shows only suppliers with at least one such site; picking the supplier filters the
  sites; picking the site defaults payment terms (site) and ship-to / bill-to (assignment codes matched to
  `RR_PO_LOCATIONS.LOCATION_CODE`, else the BU defaults).
* AP matching uses the same site (or another pay site of the same supplier), so the PO, the invoice and the payment
  all point at one supplier record.
* Supplier creation and maintenance stay where they are today; a supplier added there is immediately available to
  Procurement.

#### RR_PO_SUPPLIER_SITE_OPTIONS — purchasing options per supplier site (extension)

Holds only purchasing settings that the supplier tables do not have. Optional: a site with no row uses the BU
defaults. Any NULL column also falls back to the BU option.

| Column | Type | Req | Description |
|---|---|---|---|
| SITE_OPTION_ID | NUMBER | Y | PK |
| SUPPLIER_SITE_ID | NUMBER | Y | Unique; `RR_SUPPLIER_SITES.SUPPLIER_SITE_ID` |
| PO_COMMUNICATION | VARCHAR2(10) | Y | `EMAIL` / `PRINT` / `NONE` |
| PO_EMAIL | VARCHAR2(300) | N | Where POs are sent |
| DEFAULT_CURRENCY | VARCHAR2(15) | N | |
| MATCH_LEVEL | VARCHAR2(10) | N | Overrides BU default |
| INVOICE_QTY_TOLERANCE_PCT / INVOICE_PRICE_TOLERANCE_PCT | NUMBER(5,2) | N | Overrides |
| PURCHASING_HOLD_FLAG | VARCHAR2(1) | Y | `Y` blocks new POs to the site (e.g. compliance issue) |
| HOLD_REASON | VARCHAR2(400) | N | |
| Audit columns | - | Y | - |

Payment terms on the PO default from `RR_SUPPLIER_SITES.PAYMENT_TERMS` / `PAYMENT_TERMS_ID`.

---

## 5. Transaction Data Model

### 5.1 Requisitions

A requisition is an **internal request**; it has no supplier commitment and no accounting.

**RR_PO_REQ_HEADERS**

| Column | Type | Req | Description |
|---|---|---|---|
| REQ_HEADER_ID | NUMBER | Y | PK |
| REQ_NUMBER | VARCHAR2(40) | N | Assigned on submit; unique per BU |
| BUSINESS_UNIT_ID | NUMBER | Y | |
| DESCRIPTION | VARCHAR2(240) | Y | |
| JUSTIFICATION | VARCHAR2(2000) | N | Shown to approvers |
| PREPARER_USER | VARCHAR2(150) | Y | Who keyed it |
| URGENT_FLAG | VARCHAR2(1) | Y | |
| STATUS | VARCHAR2(20) | Y | 6.1.1 |
| FUNCTIONAL_CURRENCY | VARCHAR2(15) | Y | From BU options |
| TOTAL_AMOUNT_FUNC | NUMBER | Y | Maintained by the package (sum of line functional amounts) |
| APPROVAL_REQUEST_ID | NUMBER | N | `RR_APPROVAL_REQUESTS.REQUEST_ID` of the current cycle |
| SUBMITTED_DATE / APPROVED_DATE | DATE | N | |
| FUNDS_STATUS | VARCHAR2(10) | N | Phase 3 (`PASSED`, `ADVISORY`, `FAILED`) |
| Audit columns | - | Y | - |

**RR_PO_REQ_LINES**

| Column | Type | Req | Description |
|---|---|---|---|
| REQ_LINE_ID | NUMBER | Y | PK |
| REQ_HEADER_ID | NUMBER | Y | FK |
| LINE_NUM | NUMBER | Y | Unique within header |
| LINE_TYPE | VARCHAR2(10) | Y | `QUANTITY` / `AMOUNT` |
| EXPENSE_ITEM_ID | NUMBER | N | Catalog item; NULL for free text |
| CATEGORY_ID | NUMBER | Y | |
| ITEM_DESCRIPTION | VARCHAR2(240) | Y | |
| UOM_CODE | VARCHAR2(10) | Q | Required for quantity lines |
| QUANTITY | NUMBER | Q | > 0 for quantity lines; 1 for amount lines |
| UNIT_PRICE | NUMBER | Q | Estimated price in line currency |
| AMOUNT | NUMBER | Y | Quantity × price, or the entered amount |
| CURRENCY_CODE, RATE_TYPE, RATE_DATE, RATE | - | Y | Rate 1 for functional currency |
| AMOUNT_FUNC | NUMBER | Y | AMOUNT × RATE |
| TAX_CODE | VARCHAR2(50) | N | Estimated tax (informational on the requisition) |
| NEED_BY_DATE | DATE | Y | ≥ today |
| DELIVER_TO_LOCATION_ID | NUMBER | Y | |
| REQUESTER_USER | VARCHAR2(150) | Y | Defaults to the preparer |
| SUGGESTED_SUPPLIER_ID / SUGGESTED_SUPPLIER_SITE_ID | NUMBER | N | |
| SUGGESTED_SUPPLIER_NAME | VARCHAR2(360) | N | Free text when the supplier is not set up |
| SUPPLIER_ITEM_NUM | VARCHAR2(60) | N | |
| NOTE_TO_BUYER | VARCHAR2(1000) | N | |
| BUYER_ID | NUMBER | N | Assigned on approval (6.1.4) |
| LINE_STATUS | VARCHAR2(15) | Y | `OPEN`, `ON_PO`, `RETURNED`, `CANCELLED` |
| PO_LINE_ID | NUMBER | N | Set when the line is placed on a PO |
| AGREEMENT_LINE_ID | NUMBER | N | Phase 2 (sourced from a blanket agreement) |
| Audit columns | - | Y | - |

**RR_PO_REQ_DISTRIBUTIONS** — where the cost will be charged. One per line by default; split by percentage when a
cost is shared between cost centres.

| Column | Type | Req | Description |
|---|---|---|---|
| REQ_DISTRIBUTION_ID | NUMBER | Y | PK |
| REQ_LINE_ID | NUMBER | Y | FK |
| DIST_NUM | NUMBER | Y | |
| PERCENT | NUMBER(7,4) | Y | Sum per line = 100 |
| QUANTITY / AMOUNT | NUMBER | Y | Line value × percent (last distribution absorbs rounding) |
| CHARGE_ACCOUNT | VARCHAR2(200) | Y | Derived (6.1.3), editable when the user has the `EDIT_ACCOUNT` privilege |
| BUDGET_DATE | DATE | Y | Defaults to need-by date; used by Phase 3 funds check |
| FUNDS_RESERVED_AMOUNT | NUMBER | N | Phase 3 |
| Audit columns | - | Y | - |

### 5.2 Purchase orders

A PO has four levels. Each level answers one question:

| Level | Table | Answers |
|---|---|---|
| Header | `RR_PO_HEADERS` | Who are we buying from, in what currency, on what terms? |
| Line | `RR_PO_LINES` | What are we buying and at what price? |
| Schedule | `RR_PO_SCHEDULES` | When and where is it delivered, and how is it matched? (one line can be delivered in several schedules, e.g. monthly service) |
| Distribution | `RR_PO_DISTRIBUTIONS` | Which account pays for it? Holds the **quantity ledger** (ordered / delivered / billed / cancelled). |

**RR_PO_HEADERS**

| Column | Type | Req | Description |
|---|---|---|---|
| PO_HEADER_ID | NUMBER | Y | PK |
| PO_NUMBER | VARCHAR2(40) | Y | Unique per BU |
| REVISION_NUM | NUMBER | Y | 0 on first approval; +1 per applied change order |
| BUSINESS_UNIT_ID | NUMBER | Y | |
| PO_TYPE | VARCHAR2(15) | Y | `STANDARD` (Phase 1), `RELEASE` (Phase 2) |
| ORIGIN | VARCHAR2(15) | Y | `REQUISITION`, `MANUAL`, `IMPORT` |
| SUPPLIER_ID / SUPPLIER_SITE_ID | NUMBER | Y | Site must be a purchasing site, not on purchasing hold |
| SUPPLIER_CONTACT | VARCHAR2(240) | N | |
| BUYER_ID | NUMBER | Y | |
| CURRENCY_CODE, RATE_TYPE, RATE_DATE, RATE | - | Y | Rate frozen at approval |
| PAYMENT_TERMS / PAYMENT_TERMS_ID | VARCHAR2 / NUMBER | Y | Default from supplier site |
| SHIP_TO_LOCATION_ID / BILL_TO_LOCATION_ID | NUMBER | Y | |
| DESCRIPTION | VARCHAR2(240) | N | |
| NOTE_TO_SUPPLIER | VARCHAR2(2000) | N | Printed |
| DOCUMENT_STATUS | VARCHAR2(20) | Y | 6.2.1 |
| CLOSURE_STATUS | VARCHAR2(25) | Y | Rolled up from schedules (6.8) |
| HOLD_FLAG / HOLD_REASON | VARCHAR2 | N | Buyer hold: no receiving or matching while `Y` |
| TOTAL_AMOUNT / TOTAL_AMOUNT_FUNC | NUMBER | Y | Excluding tax; maintained by the package |
| TOTAL_TAX_ESTIMATE | NUMBER | N | Informational (tax is recognised on the invoice) |
| APPROVAL_REQUEST_ID | NUMBER | N | Current approval cycle |
| SUBMITTED_DATE / APPROVED_DATE | DATE | N | |
| COMMUNICATED_DATE | DATE | N | Last time sent to the supplier |
| ACCEPTANCE_REQUIRED / ACCEPTED_DATE | VARCHAR2(1) / DATE | N | Optional supplier acknowledgement, recorded by the buyer |
| AGREEMENT_ID | NUMBER | N | Phase 2 |
| AFTER_FACT_FLAG | VARCHAR2(1) | Y | PO created after receipt / invoice date |
| LEGACY_PO_NUMBER | VARCHAR2(60) | N | Fusion PO number for migrated POs |
| Audit columns | - | Y | - |

**RR_PO_LINES**

| Column | Type | Req | Description |
|---|---|---|---|
| PO_LINE_ID | NUMBER | Y | PK |
| PO_HEADER_ID | NUMBER | Y | FK |
| LINE_NUM | NUMBER | Y | |
| LINE_TYPE | VARCHAR2(10) | Y | `QUANTITY` / `AMOUNT` (`INVENTORY` Phase 2b) |
| EXPENSE_ITEM_ID | NUMBER | N | |
| CATEGORY_ID | NUMBER | Y | |
| ITEM_DESCRIPTION | VARCHAR2(240) | Y | |
| SUPPLIER_ITEM_NUM | VARCHAR2(60) | N | |
| UOM_CODE | VARCHAR2(10) | Q | Quantity lines |
| QUANTITY | NUMBER | Q | Sum of schedule quantities |
| UNIT_PRICE | NUMBER | Q | Agreed price (quantity lines) |
| AMOUNT | NUMBER | Y | Quantity × price, or the amount for service lines |
| TAX_CODE | VARCHAR2(50) | N | Default for schedules |
| LINE_STATUS | VARCHAR2(15) | Y | `OPEN`, `CLOSED`, `CANCELLED` (roll-up) |
| CANCEL_REASON | VARCHAR2(400) | N | |
| CAPEX_FLAG | VARCHAR2(1) | Y | From category |
| AGREEMENT_LINE_ID | NUMBER | N | Phase 2 |
| NOTE_TO_SUPPLIER | VARCHAR2(1000) | N | |
| Audit columns | - | Y | - |

**RR_PO_SCHEDULES** — delivery and matching control

| Column | Type | Req | Description |
|---|---|---|---|
| SCHEDULE_ID | NUMBER | Y | PK |
| PO_LINE_ID / PO_HEADER_ID | NUMBER | Y | FK (header denormalised for queries) |
| SCHEDULE_NUM | NUMBER | Y | |
| SHIP_TO_LOCATION_ID | NUMBER | Y | |
| NEED_BY_DATE / PROMISED_DATE | DATE | Y / N | |
| QUANTITY / AMOUNT | NUMBER | Y | Ordered on this schedule |
| QUANTITY_RECEIVED / AMOUNT_RECEIVED | NUMBER | Y | Net of returns and corrections |
| QUANTITY_BILLED / AMOUNT_BILLED | NUMBER | Y | Net of reversed matches |
| QUANTITY_CANCELLED / AMOUNT_CANCELLED | NUMBER | Y | |
| MATCH_LEVEL | VARCHAR2(10) | Y | **Frozen at approval** |
| ACCRUE_AT_RECEIPT_FLAG | VARCHAR2(1) | Y | **Frozen at approval** |
| OVER_RECEIPT_TOL_PCT, INV_QTY_TOL_PCT, INV_PRICE_TOL_PCT, RCV_CLOSE_TOL_PCT, INV_CLOSE_TOL_PCT | NUMBER(5,2) | Y | **Frozen at approval** (site option → BU option) |
| TAX_CODE | VARCHAR2(50) | N | |
| CLOSURE_STATUS | VARCHAR2(25) | Y | `OPEN`, `CLOSED_FOR_RECEIVING`, `CLOSED_FOR_INVOICING`, `CLOSED`, `FINALLY_CLOSED` |
| CANCELLED_FLAG | VARCHAR2(1) | Y | |
| Audit columns | - | Y | - |

**RR_PO_DISTRIBUTIONS** — the quantity ledger and the accounts

| Column | Type | Req | Description |
|---|---|---|---|
| DISTRIBUTION_ID | NUMBER | Y | PK |
| SCHEDULE_ID / PO_LINE_ID / PO_HEADER_ID | NUMBER | Y | FK (denormalised) |
| DIST_NUM | NUMBER | Y | |
| QUANTITY_ORDERED / AMOUNT_ORDERED | NUMBER | Y | |
| QUANTITY_DELIVERED / AMOUNT_DELIVERED | NUMBER | Y | From receipts |
| QUANTITY_BILLED / AMOUNT_BILLED | NUMBER | Y | From matches |
| QUANTITY_CANCELLED / AMOUNT_CANCELLED | NUMBER | Y | |
| CHARGE_ACCOUNT | VARCHAR2(200) | Y | Expense account |
| ACCRUAL_ACCOUNT | VARCHAR2(200) | Y | GRNI, frozen at approval from BU options |
| VARIANCE_ACCOUNT | VARCHAR2(200) | Y | IPV account, frozen (= charge account when the BU option is NULL) |
| RATE | NUMBER | Y | Frozen PO rate (copied from header at approval) |
| BUDGET_DATE | DATE | Y | |
| REQ_DISTRIBUTION_ID | NUMBER | N | Back-link to the requisition |
| REQUESTER_USER / DELIVER_TO_LOCATION_ID | - | Y | Receiving notifications go to the requester |
| ACCRUED_AMOUNT_FUNC | NUMBER | Y | Receipt accruals posted, net of matches and write-offs (GRNI balance of this distribution) |
| ENCUMBERED_AMOUNT | NUMBER | N | Phase 3 |
| Audit columns | - | Y | - |

**The quantity ledger invariants** (enforced by the packages, asserted by the simulation in Appendix A):

```
Σ distributions.QUANTITY_ORDERED            = schedule.QUANTITY            (same for amount)
Σ schedules.QUANTITY                         = line.QUANTITY
QUANTITY_DELIVERED  ≤ (ORDERED − CANCELLED) × (1 + OVER_RECEIPT_TOL)       if OVER_RECEIPT_ACTION = REJECT
QUANTITY_BILLED     ≤ basis × (1 + INV_QTY_TOL)   basis = DELIVERED (3-way) or ORDERED − CANCELLED (2-way)
QUANTITY_CANCELLED  ≤ ORDERED − max(DELIVERED, BILLED)                     cannot cancel what was received/billed
ACCRUED_AMOUNT_FUNC = Σ receipt accruals − Σ accrual relieved by matches − Σ write-offs   (receipt-accrual POs)
open commitment     = (ORDERED − CANCELLED − BILLED) × price × rate        feeds the commitments report
```

### 5.3 Revisions and change orders

**RR_PO_REVISIONS** — one row per approved revision, insert-only.

| Column | Type | Req | Description |
|---|---|---|---|
| REVISION_ID | NUMBER | Y | PK |
| PO_HEADER_ID | NUMBER | Y | |
| REVISION_NUM | NUMBER | Y | Unique with PO_HEADER_ID |
| SNAPSHOT_JSON | CLOB | Y | Header, lines, schedules and distributions as approved (`IS JSON` check) |
| CHANGE_ORDER_ID | NUMBER | N | NULL for revision 0 |
| CHANGE_SUMMARY | VARCHAR2(2000) | N | Human-readable diff ("Line 2 qty 10 → 12") |
| Audit columns | - | Y | Insert only |

**RR_PO_CHANGE_ORDERS** — a proposed change to an approved PO. The PO stays open at its current approved values
until the change order is approved and applied, so receiving and matching never see half-approved data.

| Column | Type | Req | Description |
|---|---|---|---|
| CHANGE_ORDER_ID | NUMBER | Y | PK |
| PO_HEADER_ID | NUMBER | Y | |
| CO_NUMBER | VARCHAR2(40) | Y | e.g. `PO-DIFC-2026-00017-CO1` |
| FROM_REVISION | NUMBER | Y | Revision the change was drafted against (stale check) |
| STATUS | VARCHAR2(20) | Y | `DRAFT`, `PENDING_APPROVAL`, `APPLIED`, `REJECTED`, `CANCELLED` |
| REASON | VARCHAR2(1000) | Y | |
| CHANGES_JSON | CLOB | Y | List of changes: `{"op":"UPDATE_QTY","scheduleId":…,"from":10,"to":12}`, `ADD_LINE`, `CANCEL_LINE`, `UPDATE_PRICE`, `UPDATE_DATE`, `UPDATE_ACCOUNT`, `UPDATE_TEXT` |
| AMOUNT_DELTA_FUNC | NUMBER | Y | Effect on the PO total (drives re-approval) |
| APPROVAL_REQUEST_ID | NUMBER | N | |
| APPLIED_DATE | DATE | N | |
| Audit columns | - | Y | - |

### 5.4 Receiving

**RR_PO_RCV_HEADERS** — one receipt = one delivery note from one supplier (may cover several POs of that supplier).

| Column | Type | Req | Description |
|---|---|---|---|
| RECEIPT_HEADER_ID | NUMBER | Y | PK |
| RECEIPT_NUMBER | VARCHAR2(40) | Y | Unique per BU |
| BUSINESS_UNIT_ID | NUMBER | Y | |
| SUPPLIER_ID / SUPPLIER_SITE_ID | NUMBER | Y | |
| RECEIPT_DATE | DATE | Y | ≤ today; open GL period |
| DELIVERY_NOTE_NUM | VARCHAR2(60) | N | Supplier's packing slip / service sheet number |
| COMMENTS | VARCHAR2(1000) | N | |
| RECEIVED_BY | VARCHAR2(150) | Y | |
| Audit columns | - | Y | - |

**RR_PO_RCV_TRANSACTIONS** — insert-only ledger of receiving events (expense receipts use one-step *receive and
deliver*; there is no inspection or put-away for expense lines).

| Column | Type | Req | Description |
|---|---|---|---|
| RCV_TRANSACTION_ID | NUMBER | Y | PK |
| RECEIPT_HEADER_ID | NUMBER | Y | FK |
| TRANSACTION_TYPE | VARCHAR2(20) | Y | `RECEIVE`, `RETURN_TO_SUPPLIER`, `CORRECT` |
| PARENT_TRANSACTION_ID | NUMBER | N | The `RECEIVE` a return or correction refers to |
| TRANSACTION_DATE | DATE | Y | |
| PO_HEADER_ID / PO_LINE_ID / SCHEDULE_ID | NUMBER | Y | |
| QUANTITY / UOM_CODE | NUMBER / VARCHAR2 | Q | Signed: returns and negative corrections are negative |
| AMOUNT | NUMBER | Y | Quantity × PO price, or the received amount (service lines); signed |
| CURRENCY_CODE / RATE | - | Y | PO currency, PO rate (accrual is at PO rate) |
| AMOUNT_FUNC | NUMBER | Y | |
| REASON_CODE | VARCHAR2(30) | N | Returns: `DAMAGED`, `WRONG_ITEM`, `NOT_ORDERED`, `QUALITY`, `OTHER` |
| ACCOUNTING_STATUS | VARCHAR2(15) | Y | `UNACCOUNTED`, `ACCOUNTED`, `NOT_REQUIRED` (period-end-accrual POs) |
| SLA_HEADER_ID / GL_BATCH_ID | NUMBER | N | Written back by Create Accounting |
| Audit columns | - | Y | Insert only |

**RR_PO_RCV_DISTRIBUTIONS** — how each receiving event is spread over the schedule's distributions (pro-rata to
open quantity; the last distribution absorbs rounding). This is what the accrual and the 3-way match use.

| Column | Type | Req | Description |
|---|---|---|---|
| RCV_DIST_ID | NUMBER | Y | PK |
| RCV_TRANSACTION_ID | NUMBER | Y | FK |
| DISTRIBUTION_ID | NUMBER | Y | FK |
| QUANTITY / AMOUNT / AMOUNT_FUNC | NUMBER | Y | Signed |
| CHARGE_ACCOUNT / ACCRUAL_ACCOUNT | VARCHAR2(200) | Y | Copied from the distribution |
| QUANTITY_BILLED / AMOUNT_BILLED | NUMBER | Y | Matched against this receipt (3-way consumption) |
| Audit columns | - | Y | - |

### 5.5 Invoice matching (AP integration)

**RR_PO_INVOICE_MATCHES** — every link between an AP invoice line and a PO distribution (and, for 3-way, the
receipt distribution consumed). Insert-only; a match is undone by a reversing row.

| Column | Type | Req | Description |
|---|---|---|---|
| MATCH_ID | NUMBER | Y | PK |
| INVOICE_ID / INVOICE_LINE_NUMBER | NUMBER | Y | `RR_AP_INVOICE_LINES_ALL` |
| PO_HEADER_ID / PO_LINE_ID / SCHEDULE_ID / DISTRIBUTION_ID | NUMBER | Y | |
| RCV_DIST_ID | NUMBER | N | Receipt consumed (`THREE_WAY`); NULL while matched ahead of receipt (held `QTY_REC`), filled when received |
| MATCH_TYPE | VARCHAR2(10) | Y | `PO` (2-way) / `RECEIPT` (3-way) |
| QUANTITY / AMOUNT | NUMBER | Y | Invoiced, in invoice currency; signed (credit memos negative) |
| INVOICE_UNIT_PRICE / PO_UNIT_PRICE | NUMBER | Q | |
| INVOICE_RATE / BASE_RATE | NUMBER | Y | Base = PO rate (2-way) or receipt rate (3-way) |
| DEBIT_ACCOUNT | VARCHAR2(200) | Y | ACCRUAL_ACCOUNT if accrued at receipt, else CHARGE_ACCOUNT |
| BASE_AMOUNT_FUNC | NUMBER | Y | Quantity × PO price × base rate (relieves the accrual) |
| PRICE_VARIANCE_FUNC | NUMBER | Y | (invoice price − PO price) × qty × invoice rate |
| EXCHANGE_VARIANCE_FUNC | NUMBER | Y | Quantity × PO price × (invoice rate − base rate) |
| REVERSAL_OF_MATCH_ID | NUMBER | N | Set on the reversing row |
| MATCH_STATUS | VARCHAR2(10) | Y | `ACTIVE`, `REVERSED` |
| Audit columns | - | Y | Insert only (status updated once on reversal) |

**RR_AP_INVOICE_HOLDS** (Payables-owned, created by Procurement script 3xx) — an unreleased hold stops the invoice
from being accounted and paid.

| Column | Type | Req | Description |
|---|---|---|---|
| HOLD_ID | NUMBER | Y | PK |
| INVOICE_ID | NUMBER | Y | |
| INVOICE_LINE_NUMBER | NUMBER | N | NULL = header-level hold |
| HOLD_CODE | VARCHAR2(30) | Y | 6.6.3 |
| HOLD_REASON | VARCHAR2(1000) | Y | Generated text, e.g. "Billed 12 > received 10 (tol 0%)" |
| HELD_BY | VARCHAR2(150) | Y | `SYSTEM` for validation holds |
| HOLD_DATE | DATE | Y | |
| RELEASE_CODE | VARCHAR2(30) | N | `RESOLVED` (system, condition cleared), `APPROVED_VARIANCE`, `QTY_OK`, `PRICE_OK`, `OTHER` |
| RELEASE_REASON | VARCHAR2(1000) | N | |
| RELEASED_BY / RELEASE_DATE | - | N | |
| Audit columns | - | Y | - |

### 5.6 Accruals

**RR_PO_ACCRUAL_RUNS** — period-end accrual for POs with `ACCRUE_AT_RECEIPT_FLAG = N`.

| Column | Type | Req | Description |
|---|---|---|---|
| RUN_ID | NUMBER | Y | PK |
| BUSINESS_UNIT_ID / PERIOD_NAME | - | Y | One `POSTED` run per BU and period |
| ACCRUAL_DATE | DATE | Y | Last day of the period |
| REVERSAL_DATE | DATE | Y | First day of the next period |
| STATUS | VARCHAR2(15) | Y | `DRAFT` (review), `POSTED`, `CANCELLED` |
| TOTAL_AMOUNT_FUNC | NUMBER | Y | |
| SLA_HEADER_ID / GL_BATCH_ID / REVERSAL_GL_BATCH_ID | NUMBER | N | |
| Audit columns | - | Y | - |

**RR_PO_ACCRUAL_LINES** — one per distribution with received-not-billed value at period end.

| Column | Type | Req | Description |
|---|---|---|---|
| ACCRUAL_LINE_ID | NUMBER | Y | PK |
| RUN_ID / DISTRIBUTION_ID | NUMBER | Y | |
| QUANTITY / AMOUNT_FUNC | NUMBER | Y | (delivered − billed) at the period end, valued at PO price × PO rate |
| CHARGE_ACCOUNT / ACCRUAL_ACCOUNT | VARCHAR2(200) | Y | |
| Audit columns | - | Y | Insert only |

**RR_PO_ACCRUAL_WRITE_OFFS** — clears receipt accruals that will never be invoiced (supplier waived, PO closed
under-billed).

| Column | Type | Req | Description |
|---|---|---|---|
| WRITE_OFF_ID | NUMBER | Y | PK |
| DISTRIBUTION_ID | NUMBER | Y | |
| AMOUNT_FUNC | NUMBER | Y | ≤ the distribution's `ACCRUED_AMOUNT_FUNC` |
| WRITE_OFF_ACCOUNT | VARCHAR2(200) | Y | Default BU option, or back to the charge account |
| WRITE_OFF_DATE / REASON | DATE / VARCHAR2(1000) | Y | |
| SLA_HEADER_ID / GL_BATCH_ID | NUMBER | N | |
| Audit columns | - | Y | Insert only |

### 5.7 Cross-cutting and reserved tables

| Table | Key columns | Notes |
|---|---|---|
| `RR_PO_ATTACHMENTS` | ATTACHMENT_ID, ENTITY_TYPE (`REQ`, `PO`, `CO`, `RCV`), ENTITY_ID, FILE_NAME, MIME_TYPE, FILE_BLOB, CATEGORY (`QUOTATION`, `SPECIFICATION`, `DELIVERY_NOTE`, `OTHER`), SEND_TO_SUPPLIER_FLAG | Same upload/download endpoint pattern as AP payment attachments; files flagged `SEND_TO_SUPPLIER_FLAG` are attached to the PO email |
| `RR_PO_ACTION_HISTORY` | HISTORY_ID, ENTITY_TYPE, ENTITY_ID, ACTION, FROM_STATUS, TO_STATUS, ACTION_BY, ACTION_DATE, COMMENTS | Insert-only audit of every action (submit, approve, return, cancel, close, communicate …); approvals also keep `RR_APPROVAL_HISTORY` |
| `RR_PO_COMMUNICATIONS` | COMM_ID, PO_HEADER_ID, REVISION_NUM, METHOD, TO_EMAIL, CC_EMAIL, SENT_DATE, STATUS, ERROR_TEXT, PDF_ATTACHMENT_ID | Uses the existing server-side email (Brevo) used by approvals |
| `RR_PO_PROC_REGISTRY` | PROC_NAME, PARAMS_CSV, ENABLED_FLAG, REQUIRED_ROLE | Write-gateway whitelist (9.2) |
| `RR_PO_EXEC_LOG` | LOG_ID, USER_NAME, PROC_NAME, PARAMS_CLOB, STATUS, MESSAGE, ELAPSED_MS | Every gateway call |
| `RR_PO_AGREEMENTS` / `_LINES` (Phase 2) | Supplier, site, currency, start/end dates, amount limit, released amount; lines: item/category, price, price breaks | POs of type `RELEASE` reference `AGREEMENT_ID`/`AGREEMENT_LINE_ID`; requisition lines can be sourced from them |
| `RR_PO_BUDGETS` / `RR_PO_FUNDS_LEDGER` (Phase 3) | Budget by BU, period, account mask; funds ledger rows of type `PRECOMMITMENT` (req), `COMMITMENT` (PO), `OBLIGATION` (invoice), `ACTUAL`, each with a relieving row | Funds available = budget − Σ unrelieved rows |

---

## 6. Processes and Business Rules

### 6.1 Requisitions

#### 6.1.1 Requisition status model

```
            create                submit (6.1.2)            final approval
 (none) ──────────► INCOMPLETE ─────────────────► PENDING_APPROVAL ─────────────► APPROVED
                      ▲    │                         │      │                       │
                      │    │ delete (draft only)     │      │ reject                │ buyer returns line(s)
                      │    ▼                         │      ▼                       ▼
                      │  (deleted)        withdraw   │   REJECTED ── edit ──► INCOMPLETE
                      └──────────────────────────────┘                        (RETURNED lines reopen
                                                                                the requisition)
 APPROVED ── all lines ON_PO / CANCELLED ──► (header shows "Fully ordered")
 APPROVED or INCOMPLETE ── cancel ──► CANCELLED   (only lines not yet on a PO)
```

#### 6.1.2 Submit — validations and steps

1. Requester and preparer have module access and BU access; the BU has `ACTIVE` options.
2. At least one line; every line has category, description, need-by date ≥ today, deliver-to location, amount > 0.
3. Quantity lines have UOM, quantity > 0, unit price ≥ 0; amount lines have amount > 0.
4. Every line has distributions summing to 100 %; every charge account is a valid, enabled combination whose
   segment 1 equals the BU's company (`RR_GL_BUSINESS_UNITS.COMPANY`).
5. Rate available for every foreign-currency line on the rate date (`RR_CURRENCY_DAILY_RATES`); compute
   `AMOUNT_FUNC`, header `TOTAL_AMOUNT_FUNC`.
6. Assign `REQ_NUMBER` (4.9) if not yet assigned.
7. Phase 3: funds check per distribution when `BUDGET_CONTROL_LEVEL ≠ NONE`.
8. If `REQ_APPROVAL_REQUIRED = N` → `APPROVED` directly; else create the approval request (6.10) →
   `PENDING_APPROVAL`.
9. Write `RR_PO_ACTION_HISTORY`.

#### 6.1.3 Charge-account derivation

```
 start   = RR_PO_REQUESTER_DEFAULTS.CHARGE_ACCOUNT_TEMPLATE  (requester + BU)
 seg 1   = RR_GL_BUSINESS_UNITS.COMPANY of the requisition BU
 seg 4   = EXPENSE_ITEM.NATURAL_ACCOUNT_OVERRIDE
           else CATEGORY.DEFAULT_NATURAL_ACCOUNT (walk up the category tree)
           else keep the template's segment 4  (warning: "category has no account")
 then    = apply RR_PO_ACCOUNT_RULES matching (BU, category or ancestor, item), by PRIORITY, per segment
 finally = validate the combination exists and is enabled; if the combination does not exist
           but every segment value is valid, create it through the existing GL combination
           procedure (same behaviour as AP distribution entry), else error REQ-08
```

The derived account is shown on the line; users with `EDIT_ACCOUNT` can change it, and the change is kept.

#### 6.1.4 Buyer assignment (on approval)

First match wins: buyer specialised in the line's category (or an ancestor) for the BU → buyer for the BU with
no category → BU default buyer (`DEFAULT_FLAG = Y`). No buyer found → line stays unassigned and appears in the
"Unassigned requisition lines" queue of the procurement manager.

### 6.2 Purchase orders

#### 6.2.0 Creating a PO directly (no requisition)

This is the standard way to buy. **Create Purchase Order** (`/po/orders/new`):

1. **Header** — BU (from the user's BU access), supplier and site (LOVs from the existing `RR_SUPPLIER_*` tables,
   filtered to sites usable by the BU), currency (site default, else functional), payment terms (site), ship-to /
   bill-to (site assignment, else BU defaults), buyer (the user, when they are a buyer), description.
2. **Lines** — pick a catalog item or type free text; category; quantity × price or amount; need-by date; tax code
   (category / item default). One schedule per line is created automatically (more can be added for split
   deliveries).
3. **Charge account** — derived exactly as for requisitions (6.1.3) using the line's **requester**, which defaults
   to the person creating the PO (or can be set to the employee the purchase is for); editable with
   `EDIT_ACCOUNT`; split into several distributions by percentage when the cost is shared.
4. **Save** (`INCOMPLETE`, PO number assigned) → **Submit** → approval (6.10) → approved → sent to the supplier.

From here a direct PO is identical to one created from a requisition: same receiving, matching, accruals, change
orders and close. Its distributions simply have no `REQ_DISTRIBUTION_ID` and the header has `ORIGIN = MANUAL`.
Copy-PO (from any earlier PO, with new dates) makes repeat purchases one click.

#### 6.2.1 PO document status model

```
           create / autocreate         submit (6.2.2)                final approval
 (none) ──────────────────► INCOMPLETE ──────────► PENDING_APPROVAL ──────────────► APPROVED ──► communicate
                              ▲  │ delete            │        │ reject                │
                              │  ▼ (never approved)  │        ▼                       │ change order
                              │                      │     REJECTED ── edit ──► INCOMPLETE
                              └──── withdraw ────────┘                              │ (approved separately,
                                                                                    │  PO stays APPROVED)
 APPROVED ── cancel (nothing received/billed) ──► CANCELLED
 APPROVED ── closure roll-up (6.8) ──► CLOSURE_STATUS changes; DOCUMENT_STATUS stays APPROVED
```

Receiving and matching are allowed only when `DOCUMENT_STATUS = APPROVED`, `HOLD_FLAG = N` and the schedule's
closure status allows it (receiving: `OPEN` or `CLOSED_FOR_INVOICING`; invoicing: `OPEN` or
`CLOSED_FOR_RECEIVING`).

#### 6.2.2 Submit PO — validations and steps

1. Buyer is an active buyer for the BU; supplier and site valid for the BU per 4.10 (existing `RR_SUPPLIER_*`
   tables), not on purchasing hold.
2. Currency rate available; payment terms set; ship-to and bill-to locations valid for the BU.
3. Lines, schedules and distributions complete; quantity ledger sums consistent (5.2 invariants); charge
   accounts valid; tax codes active and assigned to the BU (`RR_TAX_ASSIGNMENTS`).
4. Freeze on each schedule: `MATCH_LEVEL` (category `RECEIPT_REQUIRED_FLAG` → site option → BU option by line
   type), `ACCRUE_AT_RECEIPT_FLAG`, all tolerances; on each distribution: `ACCRUAL_ACCOUNT`, `VARIANCE_ACCOUNT`,
   `RATE`.
5. Separation of duties: the submitter cannot be the only approver (approval engine skips the submitter and
   escalates to the next approver in the rule).
6. Approval request (6.10) or direct approval when `PO_APPROVAL_REQUIRED = N` (or amount below the lowest rule).
7. On approval: write `RR_PO_REVISIONS` (revision 0), set requisition lines `ON_PO`, notify the buyer, and if the
   site's `PO_COMMUNICATION = EMAIL` send the PO automatically (6.2.3).

#### 6.2.3 Communicate to supplier

The PO PDF is generated client-side with the existing jsPDF stack (same approach as the P&L and payment PDFs):
company letterhead, PO number and revision, supplier and site address, ship-to and bill-to, buyer contact,
lines with schedules, tax estimate, total, payment terms and `PO_TERMS_TEXT`. The page uploads it as a
`RR_PO_ATTACHMENTS` row, then calls `RR_PO_DOC_PKG.COMMUNICATE` which emails it through the existing server-side
mail service and logs `RR_PO_COMMUNICATIONS`. Revised POs print "Revision n" and a change summary.

### 6.3 Autocreate (requisition → PO)

The buyer workbench lists approved, unassigned-to-PO requisition lines for the buyer's BUs. The buyer selects lines,
sets or confirms the supplier, site and price, and creates POs:

```
 group key  = BU + supplier + supplier site + currency + ship-to   → one PO per group
 lines      = one PO line per requisition line; requisition lines with the same item/description,
              UOM, price and need-by may be combined into one PO line (option on the workbench)
 schedules  = one per requisition line (need-by, deliver-to)
 dists      = copied 1:1 from requisition distributions (REQ_DISTRIBUTION_ID kept)
 status     = INCOMPLETE (buyer reviews, then submits)   — or submitted immediately in AUTO mode
```

`AUTOCREATE_MODE = AUTO` creates and submits POs without a buyer step for approved catalog lines that have a
preferred supplier and site and a list price; anything else falls back to the workbench.

### 6.4 Change orders

| Change | Allowed when | Re-approval |
|---|---|---|
| Increase quantity / amount | Schedule not finally closed | If total increase > `CO_REAPPROVAL_THRESHOLD_PCT` |
| Decrease quantity / amount | New value ≥ max(delivered, billed) | No |
| Change unit price | Nothing billed on the line | If total increases beyond the threshold |
| Change need-by / promised date, notes | Always (until closed) | No |
| Change charge account | Nothing delivered or billed on the distribution | No (logged) |
| Add a line | Always | Yes (counts as an increase) |
| Cancel a line / schedule | Nothing delivered or billed (else decrease to delivered) | No |
| Change supplier or currency | **Never** — cancel and re-create | - |

Applying a change order (on approval, or immediately when no approval is needed): lock the PO (`FOR UPDATE`),
check `FROM_REVISION = REVISION_NUM` (else "PO changed since this change order was drafted"), apply every change in
`CHANGES_JSON`, re-run the PO validations, `REVISION_NUM + 1`, insert `RR_PO_REVISIONS`, re-communicate.

### 6.5 Receiving

#### 6.5.1 Receive

The receiver searches open schedules (by PO number, supplier, requester or deliver-to) and enters the quantity
(quantity lines) or amount (amount lines) received, per schedule, under one receipt header.

1. PO approved, not on hold; schedule `OPEN` or `CLOSED_FOR_INVOICING`; match level irrelevant (2-way schedules can
   still be received, for example to confirm a service).
2. Receipt date ≤ today, not before the PO approval date, in an open GL period; early-receipt check
   (`EARLY_RECEIPT_DAYS`).
3. Over-receipt: `delivered + new ≤ (ordered − cancelled) × (1 + tol)`; `REJECT` → error, `WARNING` → allowed with
   a warning in the response and in the action history.
4. Insert `RR_PO_RCV_TRANSACTIONS` (`RECEIVE`) and `RR_PO_RCV_DISTRIBUTIONS` (pro-rata to each distribution's open
   quantity); update `QUANTITY_DELIVERED` / `AMOUNT_DELIVERED` on distributions and `QUANTITY_RECEIVED` /
   `AMOUNT_RECEIVED` on the schedule.
5. Accounting status: `UNACCOUNTED` when `ACCRUE_AT_RECEIPT_FLAG = Y`, else `NOT_REQUIRED`.
6. Closure roll-up (6.8). Notify the requester ("Your order PO-… has been received").

#### 6.5.2 Return to supplier

Against a `RECEIVE` transaction: quantity ≤ received − already returned − already billed against that receipt
(3-way). Creates negative rows, reduces delivered quantities, reverses the accrual pro-rata (accounting 7.3),
reopens the schedule for receiving if it had auto-closed. A reason code is mandatory. Optionally the AP clerk
raises a debit memo (existing AP credit-memo flow, matched to the PO with negative quantity).

#### 6.5.3 Correction

Positive or negative adjustment of a `RECEIVE` (typing error). Negative corrections obey the same limit as returns;
positive corrections obey the over-receipt rule. Accounting as a receipt or return.

### 6.6 Invoice matching (in Payables)

#### 6.6.1 Matching from the AP invoice

`Create Invoice` gains a **Match to PO** mode (screen in 10.2). The AP clerk picks the supplier site, then:

* **2-way schedules**: pick PO schedules; enter quantity (or amount) and invoice unit price.
* **3-way schedules**: pick receipts (receipt lines of those schedules with unbilled quantity); enter quantity and
  price. The match consumes `RR_PO_RCV_DISTRIBUTIONS.QUANTITY_BILLED` FIFO by receipt date unless a specific
  receipt is chosen. If the invoice arrives before the goods, the not-yet-received quantity may still be matched to
  the schedule: it is recorded without a receipt link and the invoice is held `QTY_REC`; when the receipt is entered
  the link is filled and the hold releases automatically.

For each matched quantity the package creates the AP invoice line (line type `Item`,
`PURCHASE_ORDER_NUMBER`, `PURCHASE_ORDER_LINE_NUMBER`, `RECEIPT_NUMBER`, `RECEIPT_LINE_NUMBER` filled,
`DISTRIBUTION_COMBINATION` = the match's `DEBIT_ACCOUNT`, `TAX_CLASSIFICATION` = schedule tax code), one
`RR_PO_INVOICE_MATCHES` row per distribution (pro-rata), and increases billed quantities on distributions,
schedules and receipt distributions. Tax lines are calculated by the existing AP tax logic from the tax code.

Freight or miscellaneous charges on the invoice that are not on the PO are entered as normal non-matched AP lines.

#### 6.6.2 Invoice validation (holds)

`RR_PO_MATCH_PKG.VALIDATE_INVOICE(p_invoice_id)` runs when the invoice is saved, re-validated, or a related PO,
receipt or match changes. It **releases** system holds whose condition has cleared (`RELEASE_CODE = RESOLVED`)
and **places** holds for every failing condition:

#### 6.6.3 Hold codes

| Hold code | Condition (per schedule, all matched invoices together) | Typical resolution |
|---|---|---|
| `QTY_ORD` | billed > (ordered − cancelled) × (1 + inv qty tol) | Change order raising the quantity, or credit memo |
| `QTY_REC` | 3-way: billed > received × (1 + inv qty tol) | Receive the goods; hold auto-releases |
| `PRICE` | invoice price > PO price × (1 + inv price tol) | Change order on price, or manual release `APPROVED_VARIANCE` |
| `AMOUNT` | amount lines: billed amount > ordered amount × (1 + tol) or > `INVOICE_AMOUNT_TOLERANCE` | Change order or release |
| `PO_NOT_APPROVED` | PO on hold, or a pending change order affects the matched schedule | Approve the change order / remove hold |
| `FINAL_MATCH` | schedule finally closed after the invoice was matched | Reverse the match |
| `CURRENCY` | invoice currency ≠ PO currency | Re-enter the invoice in PO currency |

Manual holds (`MANUAL`) can also be placed by AP. **An invoice with any unreleased hold cannot be accounted, cannot
be selected for payment, and is shown with a red "On hold" tag** in Manage Invoices. The payment selection
(`rr_ap_available_installments_get`) and Create Accounting for AP invoices add a `NOT EXISTS` on unreleased holds.

#### 6.6.4 Variances

For every match row (functional currency, rounded at the row):

```
 base_func     = qty × PO_price × base_rate                 base_rate = PO rate (2-way) / receipt rate (3-way)
 IPV           = qty × (invoice_price − PO_price) × invoice_rate
 ERV           = qty × PO_price × (invoice_rate − base_rate)
 invoice_func  = qty × invoice_price × invoice_rate  = base_func + IPV + ERV          (identity)
```

IPV posts to the distribution's `VARIANCE_ACCOUNT` (the charge account unless the BU sets a central IPV account);
ERV posts to the BU exchange gain or loss account. For period-end-accrual POs ERV is still separated so expense
stays at the PO value; this is configurable (open decision D6).

### 6.7 Accruals

#### 6.7.1 Receipt accrual (`ACCRUE_AT_RECEIPT_FLAG = Y`)

The receipt books the cost and the liability immediately (Dr expense, Cr GRNI). The invoice match relieves GRNI.
The **uninvoiced receipts** report (= GRNI sub-ledger) is `Σ ACCRUED_AMOUNT_FUNC` per distribution and must equal the
GL balance of the accrual account — the reconciliation report shows both and the difference.

#### 6.7.2 Period-end accrual (`ACCRUE_AT_RECEIPT_FLAG = N`)

Receipts create no accounting. At period end, **Run Period-End Accrual** for a BU and period:

```
 for each distribution with ACCRUE_AT_RECEIPT_FLAG = N:
   qty_unbilled = delivered_as_of(period_end) − billed_as_of(period_end)      (as-of dates, not today's counters)
   if qty_unbilled > 0: accrual line = qty_unbilled × PO price × PO rate
 DRAFT run → review grid (by supplier / PO / account) → Post:
   journal on ACCRUAL_DATE   Dr charge account / Cr accrual account
   reversal on REVERSAL_DATE Cr charge account / Dr accrual account   (auto-reversing)
```

One posted run per BU and period; re-running cancels the previous draft. A posted run can be cancelled only before
the period closes (creates reversing entries).

#### 6.7.3 Accrual write-off

For receipt-accrual distributions that are closed (or older than `ACCRUAL_WRITE_OFF_AGE_DAYS`) with `ACCRUED_AMOUNT_FUNC > 0`: select,
enter reason, post `Dr GRNI / Cr write-off account`. The distribution's accrued balance is reduced; the PO can then be
finally closed.

### 6.8 Close and cancel

Closure is evaluated per schedule after every receipt, return, correction, match, match reversal and cancel:

```
 rcv_done = received ≥ (ordered − cancelled) × (1 − RCV_CLOSE_TOL)      or match level is TWO_WAY and billed ≥ that
 inv_done = billed   ≥ basis × (1 − INV_CLOSE_TOL)                       basis = received (3-way) / ordered − cancelled (2-way)

 rcv_done and inv_done → CLOSED
 rcv_done only         → CLOSED_FOR_RECEIVING
 inv_done only         → CLOSED_FOR_INVOICING
 neither               → OPEN
 FINALLY_CLOSED is never set automatically and never re-opened
```

Automatic statuses are recomputed on every event, so they move both ways: a 3-way schedule with 12 received and 12
billed (of 20) is `CLOSED_FOR_INVOICING`, and becomes `OPEN` again when 3 more are received (simulation A2).

Line and header closure statuses are the "least closed" of their children (`OPEN` < `CLOSED_FOR_RECEIVING` /
`CLOSED_FOR_INVOICING` < `CLOSED` < `FINALLY_CLOSED`, cancelled children ignored). Manual actions:

* **Close / reopen** (buyer) — sets or clears a manual close on a schedule, line or header.
* **Finally close** (procurement manager) — irreversible; requires no unreleased holds on matched invoices and,
  for receipt-accrual distributions, `ACCRUED_AMOUNT_FUNC = 0` (write off first). Releases the remaining
  commitment (and Phase 3 encumbrance).
* **Cancel** (buyer) — header, line or schedule; only the unreceived and unbilled part is cancelled
  (`QUANTITY_CANCELLED = ordered − max(delivered, billed)`); a requisition line linked to a cancelled PO line can be
  returned to the buyer pool (`RECREATE_DEMAND = Y`) or cancelled.

### 6.9 Budgetary control hooks (Phase 3)

Every requisition and PO distribution carries `BUDGET_DATE`; packages call `RR_PO_BUDGET_PKG.CHECK_FUNDS` /
`RESERVE_FUNDS` at submit and approval when the BU's `BUDGET_CONTROL_LEVEL ≠ NONE`. Phase 1 implements these as
no-ops returning `PASSED`, so enabling Phase 3 needs no change to the requisition or PO code paths.

### 6.10 Approvals (existing engine, extended)

Requisitions, POs and change orders use the existing approval engine:

| Document | MODULE | TRANSACTION_TYPE | TRANSACTION_ID | AMOUNT |
|---|---|---|---|---|
| Requisition | `PROCUREMENT` | `REQUISITION` | REQ_HEADER_ID | TOTAL_AMOUNT_FUNC |
| Purchase order | `PROCUREMENT` | `PURCHASE_ORDER` | PO_HEADER_ID | TOTAL_AMOUNT_FUNC |
| Change order | `PROCUREMENT` | `PO_CHANGE_ORDER` | CHANGE_ORDER_ID | new PO total (func) |

Two additive extensions to the engine (script 3xx; existing AP/AR/Cash rules keep working unchanged):

1. `RR_APPROVAL_RULES` gets nullable `BUSINESS_UNIT_ID` and `CATEGORY_CODE`. Rule selection adds
   `(rule.BUSINESS_UNIT_ID IS NULL OR = doc BU)` and, for requisitions/POs, `(rule.CATEGORY_CODE IS NULL OR the
   document has a line in that category or a child of it)`; still ordered by `PRIORITY`.
2. `RR_APPROVAL_CALLBACKS (MODULE, TRANSACTION_TYPE, CALLBACK_PROC)`: when a request reaches a final state
   (`APPROVED`, `REJECTED`, `RECALLED`, `CANCELLED`), the engine calls
   `CALLBACK_PROC(p_request_id, p_transaction_id, p_decision, p_user)`. Procurement registers
   `RR_PO_APPROVAL_PKG.ON_DECISION`, which moves the document to its next status. Email links, tokens and the
   Requests tab work as today.

No rule found → error "No approval rule for PROCUREMENT/REQUISITION, BU …, amount …" unless the BU option says
approval is not required.

---

## 7. Accounting

### 7.1 Choosing the accrual method

| | Receipt accrual (`Y`) | Period-end accrual (`N`) |
|---|---|---|
| When cost hits the P&L | At receipt | At invoice, plus month-end accrual journal (auto-reversed) |
| Uninvoiced liability visible | Always (GRNI account) | Only at month end |
| Entries per order | Receipt + match | Invoice only (+ monthly accrual) |
| Best for | Goods and services where receipt date matters, strict cut-off | High-volume low-value expense, services billed monthly |
| Re-ERP default | **`Y` for quantity lines**, configurable (open decision D1) | |

### 7.2 Event types

| Event | Source | SLA `SOURCE_TABLE` / `EVENT_TYPE_CODE` | GL `REFERENCE5` |
|---|---|---|---|
| Receive | `RR_PO_RCV_TRANSACTIONS` | `RR_PO_RCV_TRANSACTIONS` / `PO_RECEIVE` | `PO_RECEIPTS` |
| Return | same | `PO_RETURN` | `PO_RECEIPTS` |
| Correction | same | `PO_CORRECT` | `PO_RECEIPTS` |
| Period-end accrual | `RR_PO_ACCRUAL_RUNS` | `RR_PO_ACCRUAL_RUNS` / `PO_PERIOD_END_ACCRUAL` (+ reversal) | `PO_ACCRUALS` |
| Accrual write-off | `RR_PO_ACCRUAL_WRITE_OFFS` | `PO_ACCRUAL_WRITE_OFF` | `PO_ACCRUALS` |
| Matched invoice | existing AP invoice event | `AP_INVOICES` (existing) — distribution accounts come from the match | `AP_INVOICES` |

`REFERENCE2` = the source id (`RCV_TRANSACTION_ID`, `RUN_ID`, `WRITE_OFF_ID`), the convention AP, AR, Cash and
Inventory use, so Check Accounting and journal drill-down link back automatically. Create Accounting for receipts
groups `UNACCOUNTED` receiving transactions by BU and accounting date into one batch, writes `SLA_HEADER_ID` /
`GL_BATCH_ID` back and sets `ACCOUNTED`. Unbalanced batches are impossible by construction and are also rejected by
the existing GL journal guard.

### 7.3 Accounting rules

| Event | Debit | Credit | Amount (functional) |
|---|---|---|---|
| Receive (accrue at receipt) | Charge account | Accrual (GRNI) | qty × PO price × PO rate |
| Return / negative correction | Accrual (GRNI) | Charge account | same, negative event reversed |
| Invoice match, accrued PO | Accrual (GRNI) — base amount | AP liability (existing) — invoice total | base_func |
| — price variance | Variance account (IPV) | | IPV (credit if negative) |
| — exchange variance | Exchange loss | (or Cr exchange gain) | ERV |
| — recoverable input tax | Tax account (`RR_TAX_ASSIGNMENTS.TAX_ACCOUNT`) | | tax amount (existing AP logic) |
| Invoice match, period-end PO | Charge account — base | AP liability | base_func |
| — price variance | Variance account (IPV; = charge account unless a central IPV account is set) | | IPV |
| — exchange variance | Exchange loss / gain | | ERV |
| Period-end accrual | Charge account | Accrual account | (delivered − billed) × PO price × PO rate |
| — automatic reversal (next period) | Accrual account | Charge account | same |
| Accrual write-off | Accrual (GRNI) | Write-off account | written-off amount |
| PO approval / cancel | — | — | no accounting in Phase 1 (encumbrance in Phase 3) |

### 7.4 Worked examples (BU DIFC, functional currency AED, VAT 5 % recoverable)

**A. Office chairs — quantity line, 3-way, receipt accrual**

PO: 20 chairs × 450.00 AED = 9,000.00, charge `01-10-200-6105001-…` (Office furniture expense).

| Step | Entry |
|---|---|
| Receive 20 | Dr Office furniture expense 9,000.00 / Cr GRNI 9,000.00 |
| Invoice: 20 × 460.00 + VAT 5 % = 9,660.00 (price tol 5 %: +2.2 % OK) | Dr GRNI 9,000.00 · Dr Office furniture expense (IPV) 200.00 · Dr Input VAT 460.00 / Cr AP liability 9,660.00 |
| Result | GRNI 0.00; expense 9,200.00 (actual price); PO `CLOSED` |

**B. Annual AC maintenance — amount line, 2-way, four quarterly schedules of 3,000.00**

| Step | Entry |
|---|---|
| Q1 invoice 3,000.00 + VAT 150.00, matched to schedule 1 | Dr Repairs & maintenance 3,000.00 · Dr Input VAT 150.00 / Cr AP liability 3,150.00 |
| Schedule 1 | billed 3,000 = ordered → `CLOSED` (2-way: receiving considered done by billing) |

**C. Software licences — USD PO, receipt accrual**

PO 10 × 120.00 USD, PO rate 3.6725. Receipt at PO rate. Invoice 10 × 120.00 at rate 3.6800.

| Step | Entry |
|---|---|
| Receive 10 | Dr Software expense 4,407.00 / Cr GRNI 4,407.00 (1,200 × 3.6725) |
| Invoice 1,200.00 USD = 4,416.00 AED (+ VAT) | Dr GRNI 4,407.00 · Dr Exchange loss 9.00 · Dr Input VAT 220.80 / Cr AP liability 4,636.80 |

**D. Return**

Of example A, 2 chairs returned before invoicing: Dr GRNI 900.00 / Cr Office furniture expense 900.00. Invoice for
18 chairs matches the remaining 18 received.

**E. Period-end accrual**

Stationery PO (accrue at receipt `N`), 500.00 received 28 Sep, invoice arrives 5 Oct.

| Date | Entry |
|---|---|
| 30 Sep (accrual run) | Dr Stationery expense 500.00 / Cr Accrued liabilities 500.00 |
| 1 Oct (auto-reversal) | Dr Accrued liabilities 500.00 / Cr Stationery expense 500.00 |
| 5 Oct invoice | Dr Stationery expense 500.00 · Dr Input VAT 25.00 / Cr AP liability 525.00 |

All five examples are executed by the simulation in Appendix A, which checks that every journal balances, GRNI
returns to zero, and the identity `invoice = base + IPV + ERV` holds.

### 7.5 Reconciliation

* **GRNI reconciliation**: `RR_PO_V_ACCRUAL_RECON` = Σ `ACCRUED_AMOUNT_FUNC` by accrual account and BU, versus
  the GL balance of the same account (from the TB service) → difference with drill to the receipts/matches that are
  unaccounted or posted outside Procurement.
* **Commitments**: open commitment per PO distribution (5.2) by supplier, category, cost centre.
* **Three-way status**: per schedule ordered / received / billed / cancelled / open with holds.

---

## 8. Security and Access

| Privilege (module `PO`) | Requester | Buyer | Receiver | Proc. manager | AP clerk | Admin |
|---|---|---|---|---|---|---|
| Create / submit own requisitions | ✓ | ✓ | | ✓ | | ✓ |
| Create purchase orders directly (6.2.0) | | ✓ | | ✓ | | ✓ |
| Requisition on behalf of others | | ✓ | | ✓ | | ✓ |
| `EDIT_ACCOUNT` on lines | | ✓ | | ✓ | | ✓ |
| Process requisitions / create POs | | ✓ | | ✓ | | ✓ |
| Change orders, cancel, close | | ✓ | | ✓ | | ✓ |
| Finally close, write off accruals | | | | ✓ | | ✓ |
| Receive / return / correct | own lines | ✓ | ✓ | ✓ | | ✓ |
| Match invoices, release holds | | | | | ✓ | ✓ |
| Period-end accrual, reconciliation | | | | ✓ | ✓ | ✓ |
| Setup | | | | ✓ | | ✓ |

* Module access and BU scoping reuse `RR_USER_MODULE_ACCESS` and `RR_USER_BU_ACCESS`: every package checks the
  user's BU access for the document's BU, every read view is filtered by the user's BUs.
* Requesters see their own requisitions and receipts; buyers see documents of their BUs; approvers see what they
  approve through the approval engine.
* Segregation of duties enforced in packages: an approver cannot approve a document they submitted; a receiver
  cannot receive on a PO they are the buyer of when the BU option `SOD_BUYER_RECEIVE = N`; the user who matched an
  invoice cannot release its price hold.

---

## 9. Service Architecture

Identical to the Inventory RD section 13: no per-feature ORDS endpoints. Two gateways, all logic in packages.

### 9.1 Read path — `POST ai/executequery` (existing), appUser `PROCUREMENT`

| View | Feeds |
|---|---|
| `RR_PO_V_REQUISITIONS` / `RR_PO_V_REQ_LINES` | My Requisitions, requisition detail, buyer workbench |
| `RR_PO_V_ORDERS` | Purchase Orders grid (header + supplier + buyer + totals + closure) |
| `RR_PO_V_ORDER_LINES` | PO detail: lines → schedules → distributions with the quantity ledger |
| `RR_PO_V_OPEN_SCHEDULES` | Receive screen, invoice matching (2-way) |
| `RR_PO_V_RECEIPTS` | Receipts grid, return/correct, invoice matching (3-way, with unbilled qty) |
| `RR_PO_V_MATCHES` | Invoice ↔ PO drill (both directions) |
| `RR_PO_V_INVOICE_HOLDS` | Invoice holds workbench |
| `RR_PO_V_CHANGE_ORDERS` / `RR_PO_V_REVISIONS` | Change history |
| `RR_PO_V_ACCRUALS` / `RR_PO_V_ACCRUAL_RECON` | Uninvoiced receipts, GRNI reconciliation |
| `RR_PO_V_SPEND` | Spend analysis (matched invoices + receipts by category/supplier/cost centre/month) |
| `RR_PO_V_SETUP_*` | Setup pages (one per setup table, with resolved names) |

### 9.2 Write path — `POST po/execute` (one new endpoint)

Same handler template as `inv/execute`: look the procedure up in `RR_PO_PROC_REGISTRY`, bind every JSON parameter by
name (never concatenated), execute, log to `RR_PO_EXEC_LOG`, return
`{ "success": true, "id": …, "number": "PO-DIFC-2026-00017", "message": "…", "warnings": [...] }` or
`{ "success": false, "error": "…" }` with 400/403/404/409. If Inventory is built first, both modules may share one
dispatcher with a `MODULE` column on the registry (open decision D8).

Procedure signature convention: `IN p_xxx` (strings, numbers, ISO dates; complex payloads as `p_lines_json CLOB`),
`IN p_user`, `OUT p_id NUMBER`, `OUT p_number VARCHAR2`, `OUT p_status VARCHAR2 ('S'/'W'/'E')`,
`OUT p_message VARCHAR2`.

### 9.3 Package specifications

| Package | Procedures (all with `p_user` and the OUT set) | Key validations (section 12) |
|---|---|---|
| `RR_PO_SETUP_PKG` | `SAVE_BU_OPTIONS`, `SAVE_LOCATION`, `SAVE_CATEGORY`, `SAVE_EXPENSE_ITEM`, `SAVE_BUYER`, `SAVE_REQUESTER_DEFAULT`, `SAVE_ACCOUNT_RULE`, `SAVE_DOC_SEQUENCE`, `SAVE_SITE_OPTIONS`, `SET_STATUS(p_entity, p_id, p_status)` | S-01…S-12 |
| `RR_PO_ACCOUNT_PKG` | functions `DERIVE_CHARGE_ACCOUNT(bu, requester, category, item)`, `VALIDATE_ACCOUNT(combo, bu)`, `NEXT_DOC_NUMBER(bu, doc_type)` | S-08, REQ-08 |
| `RR_PO_REQ_PKG` | `SAVE_REQUISITION(p_header_json, p_lines_json)` (create/update draft incl. distributions), `DELETE_DRAFT`, `SUBMIT`, `WITHDRAW`, `CANCEL(p_req_header_id, p_line_ids)`, `RETURN_LINES(p_line_ids, p_reason)` (buyer → requester), `COPY_REQUISITION` | REQ-01…REQ-15 |
| `RR_PO_DOC_PKG` | `CREATE_PO(p_header_json, p_lines_json)` (direct PO, 6.2.0), `COPY_PO(p_po_header_id)`, `UPDATE_PO` (INCOMPLETE/REJECTED only), `DELETE_PO` (never approved), `AUTOCREATE(p_req_line_ids_json, p_options_json)`, `SUBMIT`, `WITHDRAW`, `HOLD`/`RELEASE_HOLD`, `CANCEL(p_level, p_id, p_reason, p_recreate_demand)`, `CLOSE`/`REOPEN(p_level, p_id)`, `FINAL_CLOSE(p_po_header_id)`, `COMMUNICATE(p_po_header_id, p_attachment_id, p_to, p_cc)`, `RECORD_ACCEPTANCE` | PO-01…PO-20 |
| `RR_PO_CHANGE_PKG` | `SAVE_CHANGE_ORDER(p_po_header_id, p_changes_json, p_reason)`, `SUBMIT`, `CANCEL`, `APPLY` (internal, from approval callback) | CO-01…CO-09 |
| `RR_PO_RCV_PKG` | `RECEIVE(p_header_json, p_lines_json)` (many schedules, one delivery note), `RETURN_TO_SUPPLIER(p_rcv_transaction_id, p_qty_or_amount, p_reason, p_date)`, `CORRECT(p_rcv_transaction_id, p_delta, p_date)`; function `CLOSURE_ROLLUP(p_schedule_id)` | RCV-01…RCV-12 |
| `RR_PO_MATCH_PKG` | `MATCH_TO_PO(p_invoice_id, p_matches_json)`, `MATCH_TO_RECEIPT(p_invoice_id, p_matches_json)`, `REVERSE_MATCH(p_match_id)`, `VALIDATE_INVOICE(p_invoice_id)`, `RELEASE_HOLD(p_hold_id, p_release_code, p_reason)`, `PLACE_MANUAL_HOLD` | MAT-01…MAT-14 |
| `RR_PO_ACCT_PKG` | `CREATE_RECEIPT_ACCOUNTING(p_bu, p_to_date)`, `RUN_PERIOD_END_ACCRUAL(p_bu, p_period)`, `POST_ACCRUAL_RUN(p_run_id)`, `CANCEL_ACCRUAL_RUN`, `WRITE_OFF_ACCRUALS(p_distribution_ids_json, p_reason, p_date)` | ACC-01…ACC-10 |
| `RR_PO_APPROVAL_PKG` | `REQUEST(p_module, p_type, p_id)` (internal), `ON_DECISION(p_request_id, p_transaction_id, p_decision, p_user)` (approval callback) | APR-01…APR-05 |
| `RR_PO_BUDGET_PKG` | Phase 1 stubs `CHECK_FUNDS`, `RESERVE_FUNDS`, `RELIEVE_FUNDS` returning `PASSED` | Phase 3 |

### 9.4 Frontend service layer

```ts
// src/services/po.service.ts — the only two calls the module uses
export const poQuery = (sql: string) =>
  fetch(`${base}/ai/executequery`, { method: 'POST',
    body: JSON.stringify({ sql, maxRows: 2000, appUser: 'PROCUREMENT' }) });

export const poExec = (procedure: string, params: Record<string, unknown>) =>
  fetch(`${base}/po/execute`, { method: 'POST',
    body: JSON.stringify({ procedure, params, appUser: currentUser }) });

// examples
poExec('RR_PO_REQ_PKG.SUBMIT', { p_req_header_id: 6000000123 });
poExec('RR_PO_RCV_PKG.RECEIVE', {
  p_header_json: JSON.stringify({ supplierSiteId: 300000045, receiptDate: '2026-10-05', deliveryNote: 'DN-8812' }),
  p_lines_json:  JSON.stringify([{ scheduleId: 6000000201, quantity: 20 }]) });
```

---

## 10. Navigation and Screens

### 10.1 Menu (module code `PO`, label "Purchasing")

The native module lives under `/po/*` so it does not collide with the existing Fusion-based `/procurement/*`
screens, which stay available for Fusion users (open decision D9).

| Group | Menu entry | Path |
|---|---|---|
| Requisitions | My Requisitions | `/po/requisitions` |
| | Shop / Create Requisition (catalog + free text) | `/po/requisitions/new` |
| Purchasing | Process Requisitions (buyer workbench) | `/po/workbench` |
| | Purchase Orders | `/po/orders` |
| | Create Purchase Order | `/po/orders/new` |
| | Change Orders | `/po/change-orders` |
| Receiving | Receive | `/po/receive` |
| | Receipts (returns and corrections) | `/po/receipts` |
| Invoicing | Match Invoice to PO (opens AP Create Invoice in match mode) | `/ap/manage-invoices?match=po` |
| | Invoice Holds | `/ap/invoice-holds` |
| Accruals | Uninvoiced Receipts & GRNI Reconciliation | `/po/accruals` |
| | Period-End Accrual | `/po/period-end-accrual` |
| Reports | Open POs, PO Status (3-way), Spend Analysis, Requisition Aging, Approval Turnaround, Supplier Delivery Performance | `/po/reports/*` |
| Setup | Purchasing Options (per BU), Locations, Categories, Expense Item Catalog, Buyers, Requester Defaults, Account Rules, Document Numbering, Supplier Site Options, Approval Rules (existing Approvals page filtered to PROCUREMENT) | `/po/setup/*` |

### 10.2 Screens overview

| Screen | Pattern (consistent with existing Re-ERP pages) |
|---|---|
| Purchasing landing | KPI cards (open requisitions, pending approvals, open PO value, GRNI balance, invoices on hold, overdue deliveries) + menu tiles |
| My Requisitions | Search + grid with status tags; tabs per opened requisition (same multi-tab pattern as Manage Payments) |
| Create Requisition | Catalog cards with search by category, "Add to requisition", free-text line form; right panel = cart with derived account per line; Submit |
| Buyer workbench | Grid of approved lines grouped by suggested supplier; select → Autocreate dialog (supplier, site, currency, combine lines) |
| PO form | Header form + lines grid with expandable schedules/distributions; quantity-ledger columns (ordered / received / billed / cancelled) read-only after approval; Actions menu: Submit, Change, Cancel, Close, Final close, Communicate, Print PDF, View revisions |
| Receive | Search open schedules → editable "Receive now" column → one receipt; shows over-receipt warnings inline |
| Match Invoice (AP) | In Create Invoice: "Match to PO" switch → pick schedules or receipts → qty/price grid with live IPV/ERV and tolerance status → creates invoice lines |
| Invoice holds | Grid of held invoices by hold code with release dialog (release code + reason) |
| Accruals | Uninvoiced receipts grid; GRNI recon card (sub-ledger vs GL); period-end accrual draft → post |

Every screen keeps the existing API-transparency button showing the exact `po/execute` call and response.

### 10.3 Key wireframes

```
Create Requisition                                                     [Save draft] [Submit]
┌──────────────────────────────────────────────────────────────┬─────────────────────────────┐
│ Category ▾ [IT ▸ Accessories]   Search [toner           ]    │ CART  (BU: DIFC)            │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │ 1 HP 26A toner  ×4  1,120.00│
│ │HP 26A    │ │USB-C dock│ │Headset   │                       │   01-10-200-6106002-…   ✎   │
│ │280 AED/EA│ │390 AED/EA│ │150 AED/EA│   [+ Free-text item]  │ 2 Consultancy (AMOUNT)      │
│ │[Add]     │ │[Add]     │ │[Add]     │                       │   15,000.00  split 60/40 ✎  │
│ └──────────┘ └──────────┘ └──────────┘                       │ Need by 15-Oct  Deliver HQ  │
│                                                              │ Total AED 16,120.00         │
└──────────────────────────────────────────────────────────────┴─────────────────────────────┘

PO PO-DIFC-2026-00017  Rev 1   APPROVED · OPEN       [Actions ▾] [PDF] [Send] [API]
Supplier  Gulf Office Supplies LLC — Site DXB-MAIN        Buyer  Aisha K.     AED · Net 30
┌────┬──────────────────────┬─────┬────────┬──────────┬─────────┬─────────┬────────┬────────┐
│Line│Item                  │UOM  │Ordered │ Price    │Received │ Billed  │Cancel  │Status  │
├────┼──────────────────────┼─────┼────────┼──────────┼─────────┼─────────┼────────┼────────┤
│ 1  │Office chair ergonomic│EA   │   20   │  450.00  │   18    │   18    │   2    │CLOSED  │
│ ▸ Sch 1  HQ  need-by 10-Oct  3-way  accrue@receipt                                           │
│   ▸ Dist 1  01-10-200-6105001-…  ordered 20  delivered 18  billed 18  GRNI 0.00             │
│ 2  │AC maintenance (svc)  │ -   │15,000.0│    -     │    -    │ 3,000.00│   -    │OPEN    │
└────┴──────────────────────┴─────┴────────┴──────────┴─────────┴─────────┴────────┴────────┘

Receive                                    Receipt date [05-Oct-2026]  Delivery note [DN-8812 ]
┌──────────────┬────┬──────────────────────┬────────┬──────────┬──────────────┬─────────────┐
│PO            │Line│Item                  │Ordered │ Received │ Receive now  │ Deliver to  │
├──────────────┼────┼──────────────────────┼────────┼──────────┼──────────────┼─────────────┤
│PO-…-00017    │ 1  │Office chair ergonomic│   20   │    0     │ [   20  ]    │ HQ Floor 3  │
│PO-…-00019    │ 1  │Printer paper A4      │  100 BX│   60     │ [   40  ]    │ HQ Store    │
└──────────────┴────┴──────────────────────┴────────┴──────────┴──────────────┴─────────────┘
                                                                       [Cancel] [Receive]
```

---

## 11. Reports

| Report | Content | Source |
|---|---|---|
| Open purchase orders | Open value by supplier, buyer, category, need-by aging | `RR_PO_V_ORDERS` |
| PO status (3-way) | Per schedule: ordered, received, billed, cancelled, open; holds | `RR_PO_V_ORDER_LINES` + matches |
| Uninvoiced receipts / GRNI | Accrued not billed by supplier, age buckets; GL tie-out | `RR_PO_V_ACCRUAL_RECON` |
| Spend analysis | Spend by category, supplier, cost centre, month; PO vs non-PO invoice spend (compliance) | `RR_PO_V_SPEND` + AP invoices without PO |
| Requisition aging | Approved lines not yet on a PO, by buyer, days waiting | `RR_PO_V_REQ_LINES` |
| Approval turnaround | Submit → approval time by approver and document type | `RR_APPROVAL_HISTORY` |
| Supplier delivery performance | On-time receipt %, over/under receipts, returns % | receipts vs need-by / promised |
| Price variance | IPV by supplier and category | `RR_PO_V_MATCHES` |
| Commitments (Phase 3) | Budget vs pre-commitment vs commitment vs actual | funds ledger |

All reports export to Excel and PDF with the existing helpers; the AI assistant can query the `RR_PO_V_*` views
through the same read gateway.

---

## 12. Validation Rules Catalog

Every write validates payload and state before touching data and returns 400 (bad payload), 403 (no access),
404 (record missing) or 409 (business rule) with a specific message the screen shows verbatim. Screens repeat the
cheap checks client-side; the server is authoritative.

### 12.1 Setup (S)
| Code | Rule |
|---|---|
| S-01 | One `RR_PO_BU_OPTIONS` row per BU; BU exists and is active in `RR_GL_BUSINESS_UNITS` |
| S-02 | Accrual, exchange gain/loss and (when set) IPV and write-off accounts are valid combinations of the BU's company |
| S-03 | Tolerances between 0 and 100; `OVER_RECEIPT_ACTION` in (`REJECT`, `WARNING`) |
| S-04 | Location code unique; at least one of ship-to / bill-to / deliver-to flags |
| S-05 | Category code unique; no cycles in the tree; natural account value exists in the account value set |
| S-06 | Expense item code unique; quantity items need a UOM; category active and requestable |
| S-07 | Buyer user exists with `PO` module access; one default buyer per BU |
| S-08 | Requester template account valid; segment 1 = BU company |
| S-09 | Account rule segment number 1–10; value exists in that segment's value set |
| S-10 | One sequence per BU and doc type; `NEXT_NUMBER` ≥ 1 |
| S-11 | Supplier site option: site exists with `PURCHASING_FLAG = Y`; email valid when method `EMAIL` |
| S-12 | Inactivating a category/item/location/buyer used by open documents is allowed (no new use) but warned |

### 12.2 Requisitions (REQ)
| Code | Rule |
|---|---|
| REQ-01 | User has `PO` module access and access to the requisition BU |
| REQ-02 | Only `INCOMPLETE` / `REJECTED` requisitions can be edited; only never-submitted drafts deleted |
| REQ-03 | At least one line; line numbers unique |
| REQ-04 | Category active and requestable; catalog item active |
| REQ-05 | Quantity line: UOM valid, quantity > 0, price ≥ 0; amount line: amount > 0 |
| REQ-06 | Need-by date ≥ submit date |
| REQ-07 | Deliver-to location active and usable by the BU |
| REQ-08 | Distribution percentages sum to 100 per line; every charge account valid for the BU company |
| REQ-09 | Foreign currency requires a rate on the rate date |
| REQ-10 | Suggested supplier site (when given) is a purchasing site of the BU |
| REQ-11 | Submit requires an approval rule unless approval not required |
| REQ-12 | Withdraw only while `PENDING_APPROVAL`; cancels the approval request |
| REQ-13 | Cancel only lines not `ON_PO` |
| REQ-14 | Return-to-requester only by a buyer, only `OPEN` approved lines, reason required |
| REQ-15 | Requester (on behalf) must have access to the BU |

### 12.3 Purchase orders (PO)
| Code | Rule |
|---|---|
| PO-01 | Buyer active for the BU |
| PO-02 | Supplier active (`RR_SUPPLIER_MASTER`); site active, `PURCHASING_FLAG = Y`, assigned to the PO BU (`RR_SUPPLIER_SITE_ASSIGNMENTS.CLIENT_BU_ID` or `PROCUREMENT_BU_ID`), no purchasing hold (4.10) |
| PO-03 | Currency rate available; payment terms present |
| PO-04 | Ship-to / bill-to locations valid for the BU |
| PO-05 | Each line has ≥ 1 schedule; each schedule ≥ 1 distribution; quantity ledger sums consistent |
| PO-06 | Quantity line: UOM, quantity > 0, price ≥ 0; amount line: amount > 0 |
| PO-07 | Charge accounts valid for the BU company; tax codes active and assigned to the BU |
| PO-08 | Direct POs allowed by default; only when the BU sets `REQUIRE_REQUISITION = Y` must a manual PO come from a buyer with `DIRECT_PO_ALLOWED = Y` |
| PO-09 | Requisition lines on autocreate are `APPROVED`/`OPEN`, same BU, not already on a PO (row lock) |
| PO-10 | Autocreate grouping keys equal within one PO |
| PO-11 | Edit only `INCOMPLETE` / `REJECTED`; approved POs change only through change orders |
| PO-12 | Delete only POs never approved; linked requisition lines return to `OPEN` |
| PO-13 | Submitter ≠ sole approver (SoD) |
| PO-14 | Cancel: amount to cancel = ordered − max(delivered, billed) > 0 |
| PO-15 | Close/reopen: not `FINALLY_CLOSED`; reopen recomputes the automatic status |
| PO-16 | Final close: no unreleased holds on matched invoices; receipt-accrual distributions have `ACCRUED_AMOUNT_FUNC = 0` |
| PO-17 | Hold: approved PO; while on hold no receiving or matching |
| PO-18 | Communicate: approved; email address present for `EMAIL` |
| PO-19 | After-the-fact PO only when `ALLOW_AFTER_FACT_PO = Y`; flagged |
| PO-20 | PO total and BU functional amounts recomputed server-side; client totals ignored |

### 12.4 Change orders (CO)
| Code | Rule |
|---|---|
| CO-01 | PO `APPROVED`, not `FINALLY_CLOSED`, not on hold; one open change order per PO |
| CO-02 | `FROM_REVISION` = current revision at submit and at apply |
| CO-03 | New quantity/amount ≥ max(delivered, billed) |
| CO-04 | Price change only when nothing billed on the line |
| CO-05 | Account change only when nothing delivered or billed on the distribution |
| CO-06 | Supplier, site, currency cannot change |
| CO-07 | Re-approval when the increase exceeds `CO_REAPPROVAL_THRESHOLD_PCT` or a line is added |
| CO-08 | Apply re-runs PO-04…PO-07 |
| CO-09 | Apply writes a revision and re-communicates when the site method is `EMAIL` |

### 12.5 Receiving (RCV)
| Code | Rule |
|---|---|
| RCV-01 | User may receive (receiver role, requester of the line, or buyer when SoD allows) |
| RCV-02 | All lines of one receipt belong to one supplier site and one BU |
| RCV-03 | PO approved, not on hold; schedule `OPEN` or `CLOSED_FOR_INVOICING`, not cancelled |
| RCV-04 | Receipt date ≤ today, ≥ PO approval date, in an open GL period |
| RCV-05 | Early receipt check when `EARLY_RECEIPT_DAYS` set |
| RCV-06 | Quantity lines: quantity > 0 in the PO UOM (UOM conversion Phase 2b); amount lines: amount > 0 |
| RCV-07 | Over-receipt tolerance (`REJECT` error / `WARNING` warning) |
| RCV-08 | Return ≤ received − returned − billed against that receipt |
| RCV-09 | Return reason required |
| RCV-10 | Negative correction same limit as return; positive correction obeys RCV-07 |
| RCV-11 | No receiving on a schedule with a pending change order that reduces it below the new total |
| RCV-12 | Delivery note number unique per supplier site (warning) |

### 12.6 Matching (MAT)
| Code | Rule |
|---|---|
| MAT-01 | Invoice supplier = PO supplier; invoice site = PO site or another pay site of the same supplier |
| MAT-02 | Invoice currency = PO currency |
| MAT-03 | PO approved, not on hold; schedule `OPEN` or `CLOSED_FOR_RECEIVING` |
| MAT-04 | 3-way schedules match receipts (quantity not yet received may be matched ahead and is held); 2-way schedules match the PO |
| MAT-05 | Billed beyond received (3-way) or beyond ordered (any) is never an error: it places `QTY_REC` / `QTY_ORD` holds that release when the condition clears |
| MAT-06 | Unit price > 0; variance beyond tolerance → `PRICE` hold (not an error) |
| MAT-07 | Credit memo match: negative quantity ≤ billed |
| MAT-08 | Match rows pro-rated to distributions; rounding to the last distribution |
| MAT-09 | Accounting date in an open AP and GL period |
| MAT-10 | Reverse match only when the invoice is not paid and not accounted (else credit memo) |
| MAT-11 | Validation places/releases holds idempotently (re-running gives the same result) |
| MAT-12 | Manual release requires a release code and reason; releaser ≠ user who matched (price holds) |
| MAT-13 | Invoices with unreleased holds are excluded from accounting and payment selection |
| MAT-14 | Matching recomputes closure for every affected schedule |

### 12.7 Accounting and accruals (ACC)
| Code | Rule |
|---|---|
| ACC-01 | Create Accounting only for `UNACCOUNTED` receiving transactions in open GL periods |
| ACC-02 | Every generated journal balances (functional amounts) |
| ACC-03 | Period-end accrual: GL period open; one posted run per BU/period |
| ACC-04 | Accrual uses as-of-period-end delivered and billed quantities |
| ACC-05 | Draft run can be regenerated; posted run cancellable only while the period is open |
| ACC-06 | Reversal dated first day of next period, which must exist |
| ACC-07 | Write-off ≤ accrued balance; reason required; only closed distributions or older than the BU threshold |
| ACC-08 | Write-off account valid for the BU company |
| ACC-09 | GRNI recon difference reported, never auto-adjusted |
| ACC-10 | REFERENCE2/REFERENCE5 set on every journal line |

### 12.8 Approvals (APR)
| Code | Rule |
|---|---|
| APR-01 | Rule selection: module, type, amount band, BU, category, priority |
| APR-02 | Submitter skipped as approver |
| APR-03 | Callback moves the document only from `PENDING_APPROVAL` (idempotent on repeat calls) |
| APR-04 | Withdraw cancels the open request; resubmit starts a new request |
| APR-05 | Approver acting by email token gets the same validations as in-app approval |

---

## 13. Delivery: Scripts, Seeding, Migration

* Scripts in `database/po/3xx_*.sql`, one per sub-phase, each with a verification query in its footer (same style
  as `database/gl`, `database/ap`). ORDS handler source uses `q'~ … ~'` quoting.
* Seeding: UOMs; categories `IT`, `IT.HARDWARE`, `IT.SOFTWARE`, `IT.ACCESSORIES`, `OFFICE.STATIONERY`,
  `OFFICE.FURNITURE`, `FACILITIES.MAINTENANCE`, `FACILITIES.CLEANING`, `PROF.CONSULTING`, `PROF.LEGAL`,
  `PROF.AUDIT`, `MKT.EVENTS`, `MKT.ADVERTISING`, `TRAVEL`, `RENT` (natural accounts left blank for finance to fill);
  document sequences per active BU; approval callbacks; registry rows for every procedure.
* Migration (optional): open Fusion POs can be imported with `ORIGIN = IMPORT`, `LEGACY_PO_NUMBER` set, ordered /
  received / billed quantities taken from Fusion, accrual balances seeded by a one-off journal so the GRNI
  reconciliation starts at zero difference.
* Feature flags: the menu shows the module only to users with `PO` module access; AP matching UI appears only when
  the BU has `RR_PO_BU_OPTIONS`.

## 14. Delivery Roadmap

| Phase | Content | Depends on |
|---|---|---|
| 1a Setup | Tables, sequence, `po/execute` dispatcher + registry + log, setup packages and pages, read views | - |
| 1b Requisitions | Requisition pages, account derivation, approval engine extensions (rule filters, callbacks), attachments, action history | 1a |
| 1c Purchase orders | PO pages, buyer workbench, autocreate, approval, revisions, PDF and email | 1b |
| 1d Receiving | Receive, returns, corrections, receipt accounting (SLA → GL) | 1c |
| 1e Matching | AP match mode, matches, holds, variances, payment/accounting exclusions | 1d |
| 1f Accruals | Period-end accrual, GRNI reconciliation, write-off, reports | 1e |
| 1g Change & close | Change orders, cancel, close, final close | 1c (1e for billed checks) |
| 2 Agreements | Blanket agreements and releases, sourcing requisitions from agreements | 1g |
| 2b Inventory lines | `INVENTORY` line type, receipt into the Inventory engine (`PO_RECEIPT`) | Inventory 1c |
| 3 Budgetary control | Budgets, funds check, encumbrance accounting | 1f |
| 4 Sourcing & portal | RFQs, quotations, supplier portal acknowledgements | 2 |

Each sub-phase ships as one database script plus its pages and is deployable independently.

## 15. Open Decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Default accrual method | Receipt accrual for quantity lines, period-end for amount (service) lines |
| D2 | Default match level | 3-way for quantity lines, 2-way for services |
| D3 | Approval routing | Amount-band rules per BU/category (existing engine) now; supervisor chain later via `MANAGER_USER_NAME` |
| D4 | Requisitions mandatory? | **Decided (v1.1): no** — POs are created directly by default; requisitions optional per BU |
| D5 | Tolerances | Over-receipt 0 % reject; invoice qty 0 %; invoice price 5 % or 500 AED |
| D6 | ERV on period-end-accrual POs | Separate ERV (keeps expense at PO value) |
| D7 | Non-recoverable VAT | Not needed now (all input VAT recoverable); add a recovery rate on tax codes if required |
| D8 | Shared dispatcher with Inventory | Share one dispatcher with a module column if Inventory is built in the same release |
| D9 | Existing Fusion `/procurement/*` screens | Keep during parallel run; hide per company once POs are native |
| D10 | Supplier master | **Decided (v1.1):** existing `RR_SUPPLIER_*` tables only (kept by the current Fusion sync); no Procurement supplier master. Re-ERP supplier creation only if Fusion is retired |

## 16. Glossary

| Term | Meaning |
|---|---|
| GRNI | Goods received not invoiced — the receipt accrual liability |
| IPV | Invoice price variance — invoice price differs from PO price |
| ERV | Exchange rate variance — invoice rate differs from the PO/receipt rate |
| 2-way match | Invoice checked against the PO only |
| 3-way match | Invoice checked against the PO and the receipt |
| Schedule | A delivery of a PO line (date, location, quantity) — also called a shipment or line location |
| Distribution | The account split of a schedule; holds the quantity ledger |
| Quantity ledger | Ordered, delivered, billed and cancelled counters that every event updates |
| Change order | An approved, versioned modification of an approved PO |

---

## Appendix A — Executable simulation

`docs/design/po_rd_simulation.py` implements the quantity ledger, receiving, 2-way/3-way matching with holds,
variances, returns, period-end accrual and closure exactly as specified in sections 5–7, runs worked examples A–E
and asserts the invariants (every journal balances, GRNI clears to zero after full matching, `invoice = base +
IPV + ERV`, closure statuses as expected, over-receipt and over-billing rejected or held). Run:

```
python3 docs/design/po_rd_simulation.py
```

The output of the last run is reproduced below.

```
A. Office chairs - quantity line, 3-way, receipt accrual
  [PASS] over-receipt 21 of 20 rejected - RCV-07 over-receipt: 21 > 20
  [PASS] receipt accrual Dr expense / Cr GRNI 9,000.00
  [PASS] invoice 20 x 460 + VAT = 9,660.00 - liability 9660.00
  [PASS] IPV 200.00 to expense, ERV 0
  [PASS] price +2.2% within 5% tolerance - no hold - []
  [PASS] GRNI cleared to 0.00
  [PASS] expense = 9,200.00 (actual price)
  [PASS] schedule CLOSED - CLOSED
  [PASS] all journals balanced
A2. Holds - over-billing and price variance
  [PASS] billed 12 > received 10 -> QTY_REC hold - ['QTY_REC', 'PRICE']
  [PASS] 480 vs 450 (+6.7%) > 5% -> PRICE hold - ['QTY_REC', 'PRICE']
  [PASS] after receiving 2 more, QTY_REC releases
  [PASS] 12 received = 12 billed -> CLOSED_FOR_INVOICING (3-way) - CLOSED_FOR_INVOICING
  [PASS] receiving 3 more re-opens it for invoicing -> OPEN - OPEN
  [PASS] all journals balanced
B. AC maintenance - amount line, 2-way, quarterly schedules
  [PASS] Q1 invoice 3,000 + VAT 150 = 3,150.00 - 3150.00
  [PASS] expense 3,000.00 (no accrual account used)
  [PASS] Q1 schedule CLOSED by billing (2-way) - CLOSED
  [PASS] Q2-Q4 still OPEN
  [PASS] all journals balanced
C. Software licences - USD PO, receipt accrual, exchange variance
  [PASS] receipt at PO rate: 1,200 x 3.6725 = 4,407.00
  [PASS] ERV loss 9.00 - 9.00
  [PASS] VAT 60 USD x 3.68 = 220.80 - 220.80
  [PASS] liability 1,260 USD x 3.68 = 4,636.80 - 4636.80
  [PASS] GRNI cleared
  [PASS] all journals balanced
D. Return before invoicing, then cancel the remainder
  [PASS] return 2: GRNI 8,100.00
  [PASS] return beyond received-not-billed rejected - RCV-08 return 19 > received-not-billed 18
  [PASS] invoice 18 clears GRNI
  [PASS] CLOSED_FOR_INVOICING (18 of 20 received) - CLOSED_FOR_INVOICING
  [PASS] cancel remaining 2 -> CLOSED - CLOSED
  [PASS] all journals balanced
E. Stationery - period-end accrual
  [PASS] receipt creates no journal (accrue at receipt = N)
  [PASS] 30 Sep accrual 500.00
  [PASS] Sep expense 500.00 via accrual
  [PASS] accrued liabilities back to 0.00 after reversal
  [PASS] Oct expense net 0.00 (reversal -500 + invoice +500)
  [PASS] second run on 31 Oct accrues nothing (fully billed)
  [PASS] all journals balanced

All scenarios passed.
```
