Cash Management records bank movements that do not come from Payables or Receivables (external transactions), loads bank statements, reconciles them against the books, and archives each finished reconciliation. Open it from the **Cash Management** tile on Home.

### External transactions

External transactions are bank charges, interest, ad-hoc payments and other receipts or payments made directly on a bank account.

**Find transactions**

1. Go to **Cash Management → Manage External Transactions** and expand **Search**.
2. Set the **Transaction Date** range (required; the default is the last 5 days) and any other filters.
3. Click **Search**.

![External transactions with their approval status](cash-01-external-transactions-list.webp)

Above the results you can filter *All / Unrecon / Recon* and *All / Posted / Not Posted*, pick a **Created By** user, show the accounting of every transaction, or export to **Excel** or **PDF**.

> ⚠️ **Created By** starts with your own e-mail, so other people's transactions are hidden. Clear it to see everyone's.

| Column | Values |
| --- | --- |
| **Status** | Unreconciled, Reconciled, Cleared, Cancelled |
| **Accounted** | *Posted* when the GL journal exists; otherwise *No* |
| **Approval** | — (not sent), Pending, Approved, Rejected, Cancelled |

A reconciled or posted transaction can no longer be edited.

**Create a transaction**

1. Click **Create Transaction**. A *New Transaction* tab opens.
2. **Organisation & Bank**: choose the **Business Unit**, then the **Bank Account**. The cash account and currency fill in from the bank.
3. **Transaction Details**: choose **Money In** or **Money Out**, the **Transaction Date** (value, cleared and conversion dates follow it) and the **Transaction Type**. Add the reference, payment method and document numbers.
4. For an **Adhoc Payment**, choose the **Payee Name** (use **+** to create a new payee). Adhoc payments are always *Money Out* and have one line.
5. **Transaction Lines**: pick a **Distribution Set** (fills the offset account), a description and the **Amount**. The sign is set for you: positive for money in, negative for money out.
6. Click **Save**. With several lines the button reads *Save N Transactions* and creates one transaction per line (references *ref-1*, *ref-2*, …).
7. After saving you can attach files, **Create Accounting** and **Send for Approval**.

![New external transaction: an ad-hoc payment](cash-02-new-external-transaction.webp)

Required: business unit, bank account, transaction date, transaction type, and an offset account and amount on every line. For a currency other than AED, also the conversion rate type and rate.

**Send for approval**

1. On a saved transaction click the paper-plane icon (row) or **Send for Approval** (form).
2. Choose the approver under **Select Approver**. Approvers come from the active CASH / EXTERNAL\_TXN approval rules.
3. Optionally tick **Also email the approver** to send approve / reject links as well (single use, valid 72 hours).
4. Click **Send**. The approval changes to **Pending** and the approver gets a pop-up and a bell notification.

![Send for Approval](cash-03-send-for-approval.webp)

Once sent, the icon opens the approval status and history instead. You can send again only after a rejection or cancellation. See *Approvals & notifications*.

### Bank statements

1. Go to **Cash Management → Manage Bank Statements**. Click **Search** to list statements, or **Create Statement**.
2. Enter the **Business Unit**, **Bank Account**, **Statement Number** and **Statement Date**, and the opening and closing balances.
3. Add the lines with **Add Line**, or load them with **Import CSV** (needs *amount* and *transaction\_date* columns) or **Import PDF**. *CR* lines are deposits; *DR* lines are withdrawals.
4. Check the balance bar: opening + credits − debits should equal the actual closing balance, with a *Difference* of 0.00. It is a guide only and does not block saving.
5. Click **Create Statement** or **Save Changes**.

![Bank statements and their status](cash-04-bank-statements-list.webp)

Statuses: DRAFT, SUBMITTED, RECONCILING, RECONCILED, CLOSED. The *Lines* column counts reconciled ✓ and unreconciled ✗ lines. Reconciled lines cannot be deleted, and the business unit and bank account are locked once the statement exists.

![A statement with its balance check and lines](cash-05-bank-statement-lines.webp)

### Bank reconciliation

1. Go to **Cash Management → Bank Reconciliation**, set the filters and click **Search**, then click a statement.
2. In **Bank Statement Lines** (showing *Unrecon* lines), tick the lines to match.
3. In the system transactions panel on the right (dated to the statement month by default), filter by *AP Payment*, *External Txn*, *Bank Transfer* or *GL Journal* and tick the matching items.
4. Check that **Difference** is 0.00, then click **Reconcile Selected**.

![Bank reconciliation: a bank line matched to a system transaction](cash-06-bank-reconciliation.webp)

> ⚠️ **Reconcile Selected** does not insist on a zero difference. Check it yourself before you click.

Other tools: **Auto Recon** matches automatically, **View Matching** shows suggested pairs, **AI Suggest** and **Reconcile with Claude** propose matches, **Create Ext Txn** creates a missing bank charge or interest entry straight from a line, and **Export Excel**.

### Archive a reconciliation

When a statement is reconciled, archive it. The archive freezes the statement, the GL account analysis of the bank's cash account for the period, your manual reconciliation working and supporting files.

1. Select the statement and click **Archive** (in the card header, or the box icon on the row).
2. Check **Date from** (defaults to the day after the previous statement) and **Date to** (the statement date).
3. Add **Comments** and drop **Attachments** (up to 20 MB each), for example the bank's PDF statement.
4. On the **Manual Reconciled Data** tab, paste your reconciliation working from Excel (items in transit, unpresented cheques, …).
5. Click **Archive**.

![Archive Bank Reconciliation](cash-07-archive-popup.webp)

If statement lines are still unreconciled you get a note, but you can still archive; explain the open items in the manual data. A filled green box icon on a statement means it is already archived; click it to open the archive.

### Archived statements

**Cash Management → Archived Statements** lists every archive with the bank closing, GL closing and **Difference** (bank minus GL). Green 0.00 means the bank agrees with the GL; red shows an amount to explain.

![Archived statements](cash-08-archived-statements.webp)

Click an archive number to open it. When the manual data adds up to the difference, a green message confirms that *the reconciliation ties out*.

![An archive: balances, account analysis and manual reconciled data](cash-09-archived-statement-detail.webp)

Inside an archive you can **Take again** (refresh the account analysis), **Export to Excel**, **Save** changes, or **Cancel archive** with a reason (the record is kept for audit and the statement can be archived again).

### Payees

**Cash Management → Manage Payees** holds the payees used on ad-hoc payments.

1. Click **Create New Payee**, enter the **Payee Name** and details, and click **Create Payee**.
2. Open the payee again with the edit icon and add bank accounts on the **Bank Accounts** tab with **Add Bank Account** (the tab is available once the payee is saved).

![Edit Payee: bank accounts](cash-10-manage-payees.webp)

Inactive payees are not offered on external transactions.
