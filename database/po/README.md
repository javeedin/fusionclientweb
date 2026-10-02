# Purchasing-RR (module PO): database install

Design: `docs/design/PO_Module_Requirements_Design.md` (RD v1.1).

## Run order (schema owner, SQL Developer / SQLcl, run as a script, F5)

| # | Script | Creates |
|---|--------|---------|
| 1 | `300_po_core.sql` | `RR_PO_SEQ`, all `RR_PO_*` tables, indexes, seed UOMs and categories |
| 2 | `301_po_views.sql` | `RR_PO_V_*` read views (adds them to the AI-gateway ACL only when the ACL is in whitelist mode) |
| 3 | `302_po_packages.sql` | `RR_PO_UTIL/SETUP/REQ/DOC/RCV/ACCT/APPROVAL_PKG`, `BUSINESS_UNIT_ID` + `CATEGORY_CODE` on `RR_APPROVAL_RULES`, trigger `RR_PO_APPROVAL_DECISION_TRG` |
| 4 | `303_po_execute.sql` | `RR_PO_EXECUTE` dispatcher, procedure registry, ORDS `POST reerp/po/execute` |
| 5 | `304_po_attachments.sql` | `RR_PO_ATTACHMENTS`, `RR_PO_ATTACH_PKG`, ORDS `po/attachments/:entity_type/:entity_id[/:attachment_id]` (PO and requisition attachments) |

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
