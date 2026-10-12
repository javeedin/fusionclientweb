Purchasing covers procure-to-receipt for expense purchases: someone asks for goods or services (requisition), a buyer orders them from a supplier (purchase order), the order is approved, the goods are received, and the receipt flows to Payables for the invoice.

**The flow at a glance**

| Step | Who | Screen | Result |
| --- | --- | --- | --- |
| 1. Request | Requester | Requisitions | Requisition, approved |
| 2. Order | Buyer | Buyer Workbench or Purchase Orders | Purchase order (draft) |
| 3. Approve | Approver | Bell icon or Purchasing → Approvals | Purchase order approved |
| 4. Send | Buyer | Purchase order → Print PDF / E-mail supplier | Supplier has the order |
| 5. Receive | Requester or receiver | Receiving | Receipt; accrual if set up |
| 6. Invoice | Payables | Purchase order → Create AP invoice | AP invoice matched to the order |

Steps 1 and 5 are optional: if **Require requisitions** is *No*, buyers create orders directly, and service orders can be invoiced without a receipt.

### Purchasing home

Open **Purchasing** from the menu. The business unit selector at the top right decides which business unit every Purchasing screen works on.

![Purchasing home: KPIs, navigation tiles and My open documents](po-01-po-home.webp)

- **KPI cards** (open PO value, demand waiting, pending approvals, overdue receipts, GRNI balance, spend this month): click one to open the screen behind it.
- **Tiles**: one per Purchasing screen.
- **My open documents**: your requisitions and orders that are in draft, rejected or waiting for approval. Click a row to open it.
- **+ Requisition** / **+ Purchase order** start a new document.

### Requisitions

![Requisitions list with status filters](po-02-requisitions.webp)

1. Go to **Purchasing → Requisitions** and click **New requisition**.
2. Enter a description and add one line per item or service: category, description, quantity and price (or amount for services), need-by date and, if asked, a suggested supplier.
3. Click **Save**, then **Submit**. The *Submit for approval* window opens (the same window as for purchase orders, shown below). Pick the approver and click **Send for approval**.
4. When it is approved, its lines appear in the **Buyer Workbench** as demand. The buyer selects lines and creates a purchase order from them; the *Lines* column on the list shows how many lines are already on an order (for example *1/1 on PO*).

Use the filters at the top (Active, Draft, Pending, Approved, Rejected, Cancelled, All) and **Mine only** to find your documents.

### Create a purchase order

![Purchase orders list](po-03-po-list.webp)

1. Go to **Purchasing → Purchase Orders** and click **New purchase order** (or open a draft from the list).
2. **Supplier**: choose the supplier, then the **Site**. Payment terms come from the site and the supplier card on the right shows the address, TRN and how the site receives orders. Add a **Contact** if the supplier wants one on the order.
3. **Order**: check the **Buyer** and **Currency**, and enter a short **Description** (it shows in lists, notifications and on the PDF). Set **After fact** to *Yes* only for an order raised after the supplier has already delivered (allowed only if Purchasing options permit it).
4. **Delivery & notes**: choose **Ship to** and **Bill to** locations and add a **Note** to the supplier if needed.
5. **Lines** tab: click **Add line** for each item. Pick an expense item or type free text, then the **Category**, **Description** and **Type**. Goods lines take UOM, quantity and price; service lines take an amount. Set the **Need by** date. Expand a line with **+** to check or change its charge account.
6. **Terms & Conditions** tab: the business unit's default and mandatory clauses are already added. You can add, remove (except mandatory ones) or reword clauses for this order.
7. Click **Save**. The order total on the right updates as you go.

![Draft purchase order: supplier, order, delivery and lines](po-04-po-draft.webp)

> 💡 **Copy** creates a new draft from an existing order, which is the quickest way to raise a repeat order.

### Submit for approval

A purchase order **cannot be received, invoiced, changed or sent to the supplier until it is approved**.

1. On the saved draft, click **Submit**.
2. In *Submit for approval*, choose the **Approver**. Approvers named by an approval rule for this amount are pre-selected; approvers whose approval limit is lower than the order amount are greyed out, and you cannot choose yourself.
3. Click **Send for approval**.

![Submit for approval: choose the approver](po-05-po-submit.webp)

The order changes to **Pending Approval** and becomes read-only. A yellow banner shows who has it, and the approver gets a pop-up and a bell notification straight away.

![Pending approval: banner, status button and the approver's pop-up](po-06-po-pending.webp)

- **Pending — with *name*** opens the approval status and history.
- **Withdraw** takes the order back to draft so you can edit it. Submit it again when ready.

### Approve or reject (approver)

Approvers can decide in three places: the pop-up that appears when the request arrives, the **bell icon** (Notifications → filter *Approvals*), or **Purchasing → Approvals**.

1. Click **View** on the pop-up, or the eye icon in the bell list. The request shows the order header, supplier, business unit, payment terms and every line with the total.
2. Click **Open purchase order** to see the full order if needed.
3. Click **Approve**, or **Reject** and give a reason. The reason is shown to the buyer.

![Approval request for a purchase order, opened from the bell](po-07-po-bell-detail.webp)

**Purchasing → Approvals** lists all requisitions, purchase orders and change orders waiting for a decision. Filter by status and type. **Approve** is active only on rows assigned to you.

![Purchasing Approvals worklist](po-11-po-approvals.webp)

### After approval

The buyer's screen updates on its own. The status becomes **Approved** and the green **Approved by *name*** button shows who approved it.

![Approved purchase order with all actions available](po-08-po-approved.webp)

| Button | What it does |
| --- | --- |
| **Receive** | Opens Receiving for this order. |
| **Create AP invoice** | Creates a Payables invoice matched to the order lines. |
| **Change order** | Proposes changes to quantities, prices, dates or lines. A change above the re-approval % in Purchasing options goes through approval again. |
| **Close** | Closes the order for receiving, for invoicing, or finally. |
| **Hold** | Stops receiving and invoicing until the hold is released. |
| **Cancel PO** | Cancels the remaining quantity. |
| **Print PDF** | Opens the printable order (see below). Saving or printing records the order as sent to the supplier. |
| **E-mail supplier** | Sends the PDF to the supplier contact. |
| **History** | All changes made to the order. |

Click **Approved by *name*** (or the status icon on the Purchase Orders list) to see the full approval history: who sent it, to whom, when, and the approver's comments.

![Approval history of a purchase order](po-09-po-approval-history.webp)

If the order is **rejected**, a red banner shows the approver's reason. Correct the order, save it and submit it again; the earlier request is kept in the history.

### Print the purchase order

Click **Print PDF**. The preview uses the **Report Branding** set for the business unit (logo, legal name, address, TRN and brand colour), the supplier, ship-to and bill-to, the lines and the terms and conditions. Use **Print** or **Save PDF**.

![Purchase order PDF with the business unit's logo](po-10-po-pdf.webp)

### Receiving

1. Go to **Purchasing → Receiving** (or click **Receive** on an approved order). The **Receive** tab lists every open line; use *Requested by me* to see only your own.
2. Tick the lines that arrived and enter the **Receive now** quantity (it defaults to the remaining quantity).
3. Enter the **Receipt date**, the supplier's **Delivery note / waybill** and any comments.
4. Click **Receive**.

![Receiving: open lines ready to receive](po-12-receiving.webp)

Need-by dates in red are overdue. The **Receipts** tab shows earlier receipts, where you can return goods to the supplier or correct a quantity.

### Terms & Conditions

**Purchasing → Terms & Conditions** holds the clauses printed on purchase orders.

![Terms & Conditions library with live preview](po-13-terms.webp)

1. Click **New clause**. Enter a code, title, category and the text. The text can contain merge fields, for example `{PO_NUMBER}`, `{PAYMENT_TERMS}`, `{CURRENCY}` and `{BILL_TO}`, which are filled in from the order when it prints.
2. Choose the business unit (or *All business units*).
3. Tick **Default** to add it to every new order, and **Mandatory** if buyers must not remove it.
4. Drag clauses to set the print order. The panel on the right previews what a new order gets; switch between *Sample values* and *Merge fields*.
5. **Sample PDF** prints a sample order with the current clauses.

### Report Branding

**Purchasing → Report Branding** sets the logo and company details printed on documents, per business unit and per module.

![Report Branding: coverage grid and branding cards](po-14-report-branding.webp)

The grid at the top shows what each document prints for each business unit. A filled chip is that module's own branding, a dotted one comes from the business unit's *All documents* branding, and **+ Name only** means nothing is set (click it to add one).

1. Click **New branding** (or the pencil on a card).
2. Choose the **Business unit**.
3. Under **Printed on**, tick **All documents** or the modules that should use it: Purchasing, Payables, Receivables, Cash Management, General Ledger, Fixed Assets. Two active brandings cannot cover the same business unit and module.
4. Drop the **Logo** (PNG, JPG, SVG or WebP). Empty margins are trimmed and the image is scaled for print automatically.
5. Pick the **Header**: *Logo + company name*, *Logo only* (for logos that already contain the name) or *Name only*.
6. Enter the **Company name** as it should print, then address, TRN, phone, e-mail and website, and a **Brand colour** (suggested from the logo). It colours the bar, title and table headings.
7. Check the **Live preview**, or click **Preview PDF** for a full sample, then **Save**.

![Branding editor with live preview](po-14b-branding-editor.webp)

Which branding prints: the module's own branding first, then the business unit's *All documents* branding, then just the business unit name. The card buttons are **Edit**, **Preview**, **Copy to another business unit** and **Delete**.

### Setup

**Purchasing → Setup** holds the options for each business unit and the reference data. Pick the business unit at the top right first.

![Purchasing options for a business unit](po-15-setup-options.webp)

| Tab | What you set |
| --- | --- |
| **Purchasing options** | Functional currency, rate type, default ship-to and bill-to, whether requisitions are required, after-the-fact POs, autocreate; approvals (requisition and PO approval required, change-order re-approval %, buyer may not receive own PO, budget control); accounting (accrue at receipt, receipt accrual account, AP liability account). Click **Save options**. |
| **Locations** | Ship-to and bill-to addresses. |
| **Categories** | Purchasing categories and their default charge accounts. |
| **Expense items** | Catalogue items with UOM, list price and preferred supplier. |
| **Units of measure** | Units and classes. |
| **Buyers** | Who may raise purchase orders. |
| **Requester defaults** | Default business unit, location and account per requester. |
| **Account rules** | How the charge account is built for a line. |
| **Document numbering** | Prefixes and next numbers for requisitions, orders and receipts. |
| **Supplier site options** | Which supplier sites may be used for purchasing and how they receive orders. |

**Approval rules.** With *PO approval required* = *Yes*, add rules in **Administration → Approval Engine → Approval Rules** with module **PROCUREMENT** and transaction type **REQUISITION**, **PURCHASE\_ORDER** or **PO\_CHANGE\_ORDER**, and make sure each approver is active on the **Approvers** tab, authorized for PROCUREMENT, with a high enough limit (see Administration).

> ⚠️ If saving options fails with *ORA-00904 … invalid identifier*, the database is missing an upgrade step. The screen still saves the other fields and names the missing column; ask the administrator to run `database/po/308_po_upgrade_columns.sql` (see the Appendix).
