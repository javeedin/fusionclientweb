Accounts Payable holds supplier invoices, their approval, payments to suppliers, and the accounting of both. Open it from the **Accounts Payable** tile on Home.

### Find invoices

1. Go to **Accounts Payable → Invoice Tasks → Manage Invoices** and expand **Search: Invoice**.
2. Choose the **Business Unit** and an **Invoice Date** condition. The default is *Equal to* today, so pick *This month* or *Between* to see more.
3. Add supplier, invoice number, site, group, type or paid status if needed, and click **Search**.

![Invoice search](ap-01a-invoice-search-form.webp)

Above the grid you can switch *All / Posted / Unposted*, filter the payment type, tick **Show Fully Paid**, and choose whose invoices to show.

> ⚠️ The user list above the grid starts with you. Choose **All Users** to see invoices entered by others.

![Invoices with their approval icons](ap-01-manage-invoices.webp)

The icon next to each invoice number shows its approval: red paper plane = not sent yet (click to send), orange = pending, green = approved, red = rejected. Hover over it for who and when. Scroll right for the status columns:

![Validation, approval and paid status](ap-01b-invoice-statuses.webp)

| Column | Values |
| --- | --- |
| **Validation Status** | Validated, Needs revalidation, Never validated, Canceled |
| **Approval Status** | Not required, PENDING, Manually approved / Workflow approved, Rejected, Cancelled |
| **Accounting Status** | Accounted, Draft Accounted, Not Accounted, Partial, Error |
| **Paid Status** | Unpaid, Partially Paid, Fully Paid, Cancelled |

### View an invoice

Click an invoice number. It opens read-only in its own tab with the header, the lines (distribution, account, tax classification), taxes and totals.

![An invoice opened read-only](ap-02-invoice-tab.webp)

![Invoice lines, taxes and totals](ap-02b-invoice-lines.webp)

- Click **Edit** to change it. The invoice becomes *Needs revalidation* until you validate it again.
- Paid, cancelled and posted invoices, and invoices synced from Oracle Fusion, cannot be edited.
- **Accounting Actions**: *Check Accounting*, *Create Accounting* (draft or final), *Post to Ledger*. These need a validated invoice.

### Enter an invoice

1. Click **+ Create Invoice**. A *New Invoice* tab opens.
2. Choose the **Business Unit** first. The rest of the form unlocks and the company code is shown.
3. Enter the **Invoice Number**, **Invoice Currency** (default AED), **Amount** and **Invoice Date**.
4. Click the **Supplier** search, pick the supplier and click **Select**. The **Supplier Site** fills itself when there is only one.
5. Check **Type** (*Standard*; *Credit Memo* makes the amounts negative), **Payment Terms** and the **Description** (copied to the lines).
6. **Invoice Lines** unlock once the header is complete. For each line enter the **Amount**, a **Distribution Set** (fills the account) and the **Tax Classification**. Use **Add Line** or **Import Lines**.
7. Click **Validate**, fix anything it reports, then **Save**.

![Entering a new invoice](ap-03-create-invoice.webp)

The header amount must equal the lines plus tax. For a currency other than AED enter the conversion rate. *Validate* checks the required fields, the line accounts, the amount tally, the tax set-up and the installments.

### Send an invoice for approval

1. Click the red paper-plane icon on the invoice row (or select the row and click **Send for Approval**).
2. Choose the approver under **Select Approver**. Approvers come from the active AP / INVOICE approval rules.
3. Optionally tick **Also email the approver** to send approve / reject links and the invoice PDF by e-mail as well.
4. Click **Send for Approval**. The status becomes **PENDING** and the approver is notified in the app straight away.

![Send for Approval](ap-04a-send-for-approval.webp)

The approver approves or rejects from the bell. Your list updates by itself: the icon turns green (approved) or red (rejected). Click the coloured icon to see the approval history; a rejected or cancelled invoice can be sent again from there.

![Approval history of an invoice](ap-04b-approval-history.webp)

### Payments

1. Go to **Accounts Payable → Payment Tasks → Manage Payments**.
2. Choose the **Business Unit** and a **Payment Date** range, then **Search**.

![Manage Payments](ap-05-manage-payments.webp)

Payment statuses: *Negotiable*, *Issued* (a post-dated cheque, with its maturity date), *Cleared*, *Voided*, *Stopped*. Row actions: **Void Payment** (not for voided or reconciled payments), **Create Accounting** (until posted), **View / Post Accounting** and **View Details**.

To pay, click **Create Payment** and enter the business unit, payee and site, payment date, payment type, **Disbursement Bank Account**, currency and payment method, then choose the invoices to pay.

### Suppliers

**Accounts Payable → Setup & Maintenance → Suppliers**: enter the business unit and/or supplier number and click **Search**. Use *Filter results…* to narrow by name. Click a supplier to see its details, or **Balance** for what is owed. **Register Supplier** adds a new one (the number is generated if left blank).

![Suppliers](ap-06-suppliers.webp)

### Create accounting

1. Go to **Accounts Payable → Accounting → Create Accounting**.
2. Choose the **Business Unit** (the ledger fills in), the period and a **Date Range**, and click **Search**.
3. Open the **Invoices**, **Payments** or **Prepayment Applications** tab and click **Select Unaccounted**.
4. Click **Create Accounting (n)** ▾ and choose *Create Draft Accounting* or *Create & Post to GL (Final)*.

![Create Accounting: unaccounted invoices selected](ap-07-create-accounting.webp)

The GL period of each entry comes from the invoice or payment date. Already posted items are skipped. The **Payables to GL Reconciliation** tab compares the subledger with the GL for the chosen period.
