### A. Database scripts for administrators

Some features need a database script to have been run once. The app keeps working without them, but the feature shows an error or falls back to a slower path. All scripts are in the `database` folder of the repository and are safe to run again.

| Script | Enables | Symptom when it has not been run |
| --- | --- | --- |
| `po/300` → `po/303` | The Purchasing module (tables, views, packages, write service) | *Purchasing data could not be read* on Purchasing home |
| `po/306_po_terms.sql` | Terms & Conditions library; default and mandatory clauses on new orders | Terms & Conditions screen empty or failing; no clauses on the PDF |
| `po/307_report_branding.sql` | Report Branding (logos and company details on printed documents) | Report Branding screen fails to load; the PO PDF prints only the business unit name |
| `po/308_po_upgrade_columns.sql` | Columns added after the first install (AP liability account, category charge account, approval rule per business unit and category) | *ORA-00904: "AP\_LIABILITY\_ACCOUNT": invalid identifier* on Purchasing → Setup |
| `po/309_po_approval_inapp.sql` | In-app approval of requisitions, purchase orders and change orders, with the chosen approver and decision history | Submit fails, or approving in the bell does not release the purchase order |
| `approvals/22_ai_gateway_access.sql` | Fast approval history for AP invoices and external transactions | The approval history dialog is slow or shows only the latest request |
| `cash/169_cm_execute.sql`, then `cash/170_cm_archive_bank_statements.sql` | Cash Management write service and bank reconciliation archives | Archive actions fail with a missing service or table |

Run order for a new Purchasing install: `300 → 301 → 302 → 303 → 304 → 305 → 306 → 307 → 308 → 309`. See `database/po/README.md` for details and the checks to run afterwards.

### B. Troubleshooting

| Message or problem | Cause | What to do |
| --- | --- | --- |
| *No approval rule for PROCUREMENT / PURCHASE\_ORDER covering AED …* | *PO approval required* is *Yes* and no rule covers this amount, business unit or category. | Add a rule in **Approval Engine → Approval Rules**, or choose an approver in *Submit for approval*. Setting *PO approval required* to *No* skips approval altogether. |
| *No approvers* warning when sending an external transaction or invoice | No active rule with approvers exists for that module and type (for example CASH / EXTERNAL\_TXN). | Add the approver on the **Approvers** tab, then a rule on **Approval Rules**. |
| The approver does not see Approve / Reject in the bell | The list is showing other notifications. | In the bell panel choose the **Approvals** filter, or use the pop-up that appears when the request arrives. |
| A request does not appear for the approver | The bell checks for new requests every minute; requests sent from the same browser appear at once. | Wait a minute or click refresh in the bell panel. Check that the approver is active on the **Approvers** tab with the e-mail they sign in with. |
| *You cannot approve your own document* / *You cannot send your own document to yourself for approval* | Purchasing documents cannot be approved by the person who submitted them. | Send it to a different approver. |
| A purchase order stays *Pending Approval* after the bell shows it approved | `309_po_approval_inapp.sql` has not been run. | Ask the administrator to run it. |
| The PO PDF has no logo | No branding covers this business unit and Purchasing. | Add one in **Purchasing → Report Branding** (needs script 307). |
| *ORA-00904 … invalid identifier* when saving Purchasing options | A column from a later upgrade is missing. | The screen saves the other fields and names the column. Run script 308. |
| *APEX\_DB\_CONFIG is not defined* when sending for approval | Older app version. | Update to version 3.2.6 or later (shown under the Re-ERP logo). |
| External Transactions shows only some transactions | The **Created By** filter defaults to you. | Clear the Created By filter to see everyone's transactions. |
| *OTP generated but email failed* on Reset / Set Password | The e-mail service is not reachable. | Use the desktop app, or ask the administrator to reset the password in User Management. |
| FTP Manager: the bastion command still contains `<privateKey>` / `<localPort>` | It was typed into a field directly. | Use **Paste SSH command…**; the placeholders are replaced with `C:\Bastion keys\reerp-bastion.key` and `2222`. |
| A screen shows *HTTP 200 — ORA-…* | The database rejected the request; the text after *ORA-* is the reason. | Note the message and the screen and send them to the administrator, or use **Raise a Support Ticket** in the top bar. |

### C. Glossary

| Term | Meaning |
| --- | --- |
| **Business unit (BU)** | The company or division a document belongs to. Most screens have a BU selector at the top right. |
| **Ledger** | The set of books (chart of accounts, calendar, currency) that a business unit posts to. |
| **Charge account** | The full GL account string a cost is booked to, for example `101-1000-000-511205-…`. |
| **Period** | An accounting month. Journals can be posted only into an open period. |
| **Requisition** | An internal request to buy goods or services. |
| **Purchase order (PO)** | The order sent to the supplier. |
| **Change order** | A proposed change to an approved PO, approved before it takes effect. |
| **After-the-fact PO** | A PO raised after the supplier has already delivered. |
| **Receipt** | Confirmation that ordered goods or services arrived. |
| **GRNI / accrual** | *Goods received not invoiced*: the liability booked at receipt until the supplier's invoice arrives. |
| **SLA** | Subledger accounting: the accounting entries a subledger document (invoice, payment, receipt) creates before they are posted to GL. |
| **TRN** | Tax registration number, printed on tax documents. |
| **UOM** | Unit of measure (each, box, hour …). |
| **Approval Engine** | The shared approvals set-up: approvers with their limits, and rules that decide who approves what. |
| **Report Branding** | The logo and company details printed on documents, per business unit and module. |
