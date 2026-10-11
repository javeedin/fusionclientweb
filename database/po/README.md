# Purchasing-RR (module PO): database install

Design: `docs/design/PO_Module_Requirements_Design.md` (RD v1.1).

## Run order (schema owner, SQL Developer / SQLcl, run as a script, F5)

| # | Script | Creates |
|---|--------|---------|
| 1 | `300_po_core.sql` | `RR_PO_SEQ`, all `RR_PO_*` tables, indexes, seed UOMs and categories |
| 2 | `301_po_views.sql` | `RR_PO_V_*` read views (adds them to the AI-gateway ACL only when the ACL is in whitelist mode) |
| 3 | `302_po_packages.sql` | `RR_PO_UTIL/SETUP/REQ/DOC/RCV/ACCT_PKG`, `BUSINESS_UNIT_ID` + `CATEGORY_CODE` on `RR_APPROVAL_RULES` (the approval package is in 309 — `RR_PO_REQ_PKG` / `RR_PO_DOC_PKG` compile once 309 has run) |
| 4 | `303_po_execute.sql` | `RR_PO_EXECUTE` dispatcher, procedure registry, ORDS `POST reerp/po/execute` |
| 5 | `304_po_attachments.sql` | `RR_PO_ATTACHMENTS`, `RR_PO_ATTACH_PKG`, ORDS `po/attachments/:entity_type/:entity_id[/:attachment_id]` (PO and requisition attachments) |
| 6 | `305_po_invoice_match.sql` | `RR_PO_INVOICE_MATCHES`, `RR_PO_MATCH_PKG` (record / cancel / status of AP invoices created from POs), `RR_PO_V_INVOICEABLE_LINES`, `RR_PO_V_INVOICE_MATCHES`, trigger `RR_PO_AP_INVOICE_SYNC_TRG` on `RR_AP_INVOICES_ALL` (cancel in AP reopens PO lines) |
| 7 | `../ap/147_ap_create_invoice_po_match.sql` | `RR_AP_CREATE_INVOICE_PKG` body: `POST ap/createinvoicefull` matches AP lines that carry `PONumber`/`POLineNumber` (or `POLineId`/`PODistributionId`) to the PO **in the same transaction**. A refused match rolls the invoice back |
| 8 | `../ap/148_ap_update_invoice_po_match.sql` | `RR_AP_UPDATE_INVOICE_PKG` body: `PUT ap/createinvoicefull/:id` re-matches the PO from the edited lines (previous match reversed → `REPLACED`). A refused re-match rolls the edit back |
| 9 | `306_po_terms.sql` | Terms and conditions: `RR_PO_TERMS` clause library, `RR_PO_ORDER_TERMS` (each PO's clauses, wording kept as sent), `RR_PO_TERMS_PKG` (save / delete / reorder clauses, set a PO's clauses), views `RR_PO_V_TERMS` and `RR_PO_V_ORDER_TERMS`, trigger `RR_PO_ORDER_TERMS_DEFAULT_TRG` (new POs get the default and mandatory clauses). The first run turns each business unit's old free-text terms into a library clause and copies it onto existing POs |
| 10 | `307_report_branding.sql` | Report branding: `RR_REPORT_BRANDING` (logo, company name, address, TRN, contacts, brand colour per business unit and document type — ALL / PO / AP / AR / CM / GL / FA), `RR_REPORT_BRANDING_PKG`, views `RR_REPORT_V_BRANDING` and `RR_REPORT_V_BRANDING_LOGO`. Used by the printed purchase order |
| 11 | `308_po_upgrade_columns.sql` | Existing installs: adds the columns later changes need (`RR_PO_BU_OPTIONS.AP_LIABILITY_ACCOUNT`, `RR_PO_CATEGORIES.DEFAULT_CHARGE_ACCOUNT`, `RR_APPROVAL_RULES.BUSINESS_UNIT_ID` / `CATEGORY_CODE`), recompiles, and reports what is still invalid. Fixes ORA-00904 "AP_LIABILITY_ACCOUNT" on Purchasing Options |
| 12 | `309_po_approval_inapp.sql` | Single-level in-app approval: `RR_PO_APPROVAL_PKG` (submit a PO / requisition to a chosen approver — `SUBMIT_PO_TO`, `SUBMIT_REQ_TO`; `DECIDE`; rule-based routing; change orders go to the PO's approver when no rule), triggers `RR_PO_APPROVAL_DECISION_TRG` and `RR_PO_APPROVAL_STAMP_TRG`, `DECIDED_BY` / `DECIDED_DATE` on `RR_APPROVAL_REQUESTS`, view `RR_PO_V_DOC_APPROVAL` |

The PO match always follows the AP invoice lines. Any other insert, update or delete on `RR_AP_INVOICE_LINES_ALL` is re-matched by trigger `RR_PO_AP_LINES_SYNC_TRG` (305). A refused re-match raises ORA-20951 and rolls back that change. Cancelling or deleting the invoice reverses the match (`RR_PO_AP_INVOICE_SYNC_TRG`). No AP table changes.

Every script can be run again safely. After step 3, the last query must return no rows from `user_errors`. After step 4, every `RR_PO_%` object must be `VALID`.

## Before first use (app → Purchasing-RR → Setup)

1. **Purchasing options**: save them once per business unit.
   - Functional currency.
   - Receipt accrual (GRNI) account. This is required when accruing at receipt.
   - Tolerances.
   - Approval flags.
   - `Require requisitions` = N (direct POs are allowed).
2. **Locations**: ship-to and bill-to addresses that print on the PO.
3. **Categories**: set a natural account (segment 4) on each one. Six categories are seeded.
4. **Requester defaults**: a charge-account template per user and business unit. The category's natural account replaces segment 4. If a user has no default, they type the account on each line.
5. **Buyers**: optional. If no buyers are defined, everyone may buy.
6. **Approval rules**: set them up in Admin → Approval Engine.
   - Module: `PROCUREMENT`.
   - Types: `REQUISITION`, `PURCHASE_ORDER`, `PO_CHANGE_ORDER`.
   - Optionally restrict a rule to a business unit or a category.
   - If no rule matches, submission fails, unless the "approval required" option is N.
7. **Suppliers** come from the existing `RR_SUPPLIER_*` tables. A site appears for a business unit when both are true:
   - `PURCHASING_FLAG = 'Y'`;
   - the site is assigned to the business unit (`RR_SUPPLIER_SITE_ASSIGNMENTS.CLIENT_BU_ID`), or the business unit is the site's `PROCUREMENT_BU_ID`.

## How the app talks to the database

- **Reads**: `POST reerp/ai/executequery`, the existing guarded SELECT gateway, against the `RR_PO_V_*` views.
- **Writes**: `POST reerp/po/execute` with `{ proc, params, user }`.
  - It can call only procedures listed in `RR_PO_PROC_REGISTRY`.
  - It commits on S/W and rolls back on E.
  - Every call is logged in `RR_PO_EXEC_LOG`.
- **Journals**: created by the page through the existing pipeline: `sla/accounting/create` → `journals/create` → `gl/journals/:id/post`. They are then stamped with `RR_PO_ACCT_PKG.MARK_ACCOUNTED`.
  - JE source: `Purchasing`.
  - JE categories: `Receipts`, `Accrual`, `Accrual Write-Off`. These names must exist in GL categories if your GL validates them.

Matching AP invoices to POs and receipts is the next phase. Until then, billed quantities stay 0.
