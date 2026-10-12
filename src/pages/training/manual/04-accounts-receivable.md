Accounts Receivable holds customer invoices, credit and debit memos, customers and their accounts, and the receipts that pay the invoices. Open it from the **Accounts Receivable** tile on Home.

### Find invoices

1. Go to **Accounts Receivable → Manage Receivable Invoices**.
2. Choose the **Business Unit** (required). Optionally enter a transaction number, pick a **Customer** (opens a search list), a **Class** (Invoice, Credit Memo, Debit Memo), a **Status** and a date range.
3. Click **Search**.

![Receivable invoices](ar-01-receivables-search.webp)

Scroll right for the **Balance**, **Status** and **Sync** columns.

![Balance, status and sync columns](ar-02-receivables-status-columns.webp)

| Column | Values |
| --- | --- |
| **Status** | Complete (green), Incomplete (orange), Void (red) |
| **Sync** | *NEW*: created in Re-ERP. *FUSION*: synced from Oracle Fusion. *UPDATE*: changed in Fusion. *ERROR*: sync failed. |
| **Balance** | Amount still due. Red when above zero. |

Invoices with Sync *FUSION* or *UPDATE* open **Read Only** and have no Save button.

### Create or open an invoice

1. Click **Create New Invoice** (a tab marked *New — Not Saved* opens), or click a transaction number.
2. **General Information**: transaction class and type, **Business Unit**, **Transaction Date**, accounting date and **Currency**. Leave **Transaction Number** blank to have it generated.
3. **Customer** tab: choose the **Bill-to** customer; the account number fills in. Add ship-to, sold-to and paying customer if they differ.
4. **Invoice Lines**: one line per item or service, with description, memo line, UOM, **Quantity**, **Unit Price** (amount = quantity × price) and **Tax Classification**. Click **Add Line** for more.
5. Click **Save** or **Save and Close**.

![A receivable invoice: header and customer](ar-03-receivable-invoice.webp)

![Invoice lines](ar-04-receivable-invoice-lines.webp)

Required to save: bill-to customer, business unit, transaction date and currency. The red balance tag in the header opens **Balance Details**. **Actions** offers *Review Installments*, *Review Distributions* and *Delete Invoice*; **PDF** prints the invoice. An invoice can be deleted only while it has no GL lines, receipts applied or adjustments.

### Customers

1. Go to **Accounts Receivable → Manage Customers**.
2. Type a party name or number and click **Search**.
3. Click **Accounts** on a row, or the party name, to see its business-unit accounts.

![Customers](ar-05-customers.webp)

Status *A* is active, *I* inactive. The **Customer Accounts — BU Assignments** panel shows the receivables, revenue, tax, freight and unbilled receivable accounts the customer uses in each business unit.

![A customer and its business-unit accounts](ar-06-customer-accounts.webp)

To use a customer in another business unit, click **Assign BU**, choose the business unit first (the **Pick** buttons stay disabled until you do), and enter at least one account. The company segment is fixed by the business unit. **Edit** on a row changes an existing assignment.

### Receipts

1. Go to **Accounts Receivable → Manage Receipts**.
2. Choose the **Business Unit** (required) and, if needed, customer, receipt number, **Receipt Type** (CASH or MISC), currency, state and status.
3. Pick a **Receipt Date** range (*Today*, *Last 7d*, *Last 30d* or a custom *Range*) and click **Search**.
4. Click the ID or receipt number to open it.

![Receipts](ar-07-receipts-search.webp)

| Column | Values |
| --- | --- |
| **State** | Applied (green), Unapplied (blue), On Account (purple), Reversed / NSF / Stop (red) |
| **Status** | Cleared (green), Uncleared (orange), Remitted (blue), Reversed (red) |
| **Acctg Status** | Accounted, Unaccounted |

**Create a receipt**

1. Click **Create New Receipt**.
2. Enter the business unit, **Receipt Type**, **Receipt Method**, **Receipt Date**, currency, **Amount**, **Customer** and **Comments**.
3. Check the **Dr. Account** (the bank) and **Cr. Account**; for a new receipt the credit account fills from the customer's receivables account in that business unit.
4. Under **Receipt Applications**, apply the receipt to the customer's invoices. The applied amounts must add up to the receipt amount.
5. Click **Save**, then **Create Accounting**.

![A receipt applied to an invoice](ar-08-receipt-detail.webp)

A saved receipt opens read-only; click **Edit** to change it. Accounted receipts, and receipts synced from Fusion, cannot be edited. **Delete** is available until the receipt is accounted, and **Actions** offers *Copy Receipt* and *Reverse Receipt*.
