General Ledger holds the journals of every ledger, the trial balance, the financial statement templates and the accounting periods. Open it from the **General Ledger** tile on Home or from the menu.

### Find and review journals

1. Go to **General Ledger → Manage Journals**.
2. Choose the **Ledger** and the **Period** (both required). The period list defaults to the first open period.
3. Narrow the search if needed: batch and journal name or description (*Starts with*, *Equals*, *Contains*, *Ends with*), **Category**, **Source**, **Accounting Date** and **Batch Status**.
4. Click **Search**. The grid shows every batch with its category, source and a *Posted* or *Unposted* tag. **Export Excel** downloads the results.

![Manage Journals: search parameters and results](gl-01-manage-journals-results.webp)

Click a batch or journal name to open it in its own tab. The tab shows the batch header, the journal fields and the lines with a **Balanced** bar at the bottom.

![A manual journal opened from the search results](gl-02-journal-detail.webp)

| Button | When it is available |
| --- | --- |
| **Reverse**, **Copy** | Always. They create an unsaved draft in a new tab. |
| **Edit**, **Post**, **Delete Batch** | Only for *Manual* journals that are not yet posted. |
| *Subledger — Read Only* / *Posted — Read Only* | Journals created by a subledger (Payables, Receivables, Cash, Assets, Purchasing) or already posted cannot be changed here. |

### Create a journal

1. Go to **General Ledger → Create Journal** and check the **Ledger** in the top bar.
2. **Batch**: enter a description and pick the **Accounting Period**. Only open and future-entry periods are listed. The batch name is generated for you (`JB-YYYYMMDD-HHmmss-…`).
3. **Journal**: enter the journal description, the **Business Unit** (its company code is shown underneath), the **Accounting Date** (within the period) and the **Category**.
4. **Journal Lines** appear once the business unit and category are set. For each line:
   - pick a **Distribution** to fill the account, or click ⊕ to choose the account segment by segment;
   - enter a **Debit** or a **Credit**;
   - click ✎ to enter the line **Description**, then **OK**. Use **Add Row** and **Delete Row** for more or fewer lines.
5. Click **Save**, check the *Review Journal Data Before Saving* summary, and click **Confirm & Save**.
6. Click **Post**. A checklist runs; when everything passes click **All Checks Passed — Proceed to Post**. Posted journals are locked.

![Create Journal: an accrual with three lines](gl-03-create-journal.webp)

A journal posts only when:

- it has at least one line, and every line has an account, an amount on one side only and a description;
- debits equal credits (to within 0.01); otherwise you see *Journal is not balanced: Debit … ≠ Credit …*;
- the period is open;
- all lines belong to the same company segment.

### Trial balance

1. Go to **General Ledger → Trial Balance** and choose the **Ledger** (and a year to filter the periods).
2. On the period row, click the report you want:
   - **ReERP TB**: builds the trial balance from Re-ERP journals and shows it;
   - **Dynamic PTD TB** / **Dynamic YTD TB**: period-to-date or year-to-date balances read live, without building;
   - **Fusion TB**: balances from Oracle Fusion.

![Trial Balance: periods with the four report buttons](gl-04-trial-balance-periods.webp)

The report opens in a tab with opening balance, debits, credits, closing balance and YTD net per account, and a total row where debits equal credits. Positive amounts are debit balances; amounts in (brackets) are credit balances. Filter by company or currency, search for an account, toggle *Entered* amounts, or use **Excel**, **Export Both**, **Reconcile** and **Revalue**.

![Trial balance report for Oct-26](gl-05-trial-balance-report.webp)

### Income statement templates

Templates define how accounts roll up into a P&L, balance sheet or cash flow statement.

![P&L Statement Templates list](gl-06-is-templates-list.webp)

1. Go to **General Ledger → Income Statement Templates** and click **New Template**, or **Edit** on an existing one.
2. Click **Add Group** (for example *Revenue*, *Operating Expenses*).
3. Click **+** on a group to add a section, and **+** on a section to add accounts: one account or a from–to range.
4. Click **Add Calculated Total** for subtotals such as gross profit or net income.
5. Click **Run Income Statement** (or **Run** in the list) to produce the statement. **Preview**, **Clone** and **Edit in Excel** are also available.

An account placed in two sections would be counted twice. The template marks it **Duplicate**, shows a warning bar and a *1 Duplicate* button.

![Template with an account in two sections](gl-07-is-template-duplicates.webp)

Click **Review duplicates** and then the section chip where the account should *not* be. It is removed there and kept in the other section. When you add accounts, ones already in the template are refused (*… is already in this template … Remove it there first*).

![Duplicate Accounts: click a section to remove the account from it](gl-08-is-duplicates-modal.webp)

### Accounting periods

1. Go to **General Ledger → Accounting Periods**. The **Period Status** tab shows the prior, current and next period of every ledger and application (GL, AP, AR, FA, CE, PO).
2. Click a ledger name to open its periods for that application.
3. Click **Open Period** on a closed, future or never-opened period, or **Close Period** on an open one and confirm. Closing stops new transactions for that application; the period can be re-opened. Permanently closed periods have no action.

![Period status for every ledger and application](gl-09-accounting-periods-status.webp)

![Periods of one ledger with Open and Close buttons](gl-10-accounting-periods-ledger.webp)
