AP invoices, cash external transactions, and purchasing documents (requisitions, purchase orders, change orders) all use the same approval process. Approvals happen **inside the app**: the approver sees a pop-up and a bell notification, and decides there. E-mail is optional.

### How it works

| Step | Who | What happens |
| --- | --- | --- |
| 1. Send | Preparer | Chooses an approver and clicks *Send*. The document becomes **Pending**. |
| 2. Notify | — | The approver gets a yellow pop-up and a bell notification, immediately if they are signed in, otherwise at their next sign-in. |
| 3. Decide | Approver | Opens the request, checks the details and clicks **Approve** or **Reject** (with a reason). |
| 4. Update | — | The preparer's screen updates on its own: the status icon turns green or red, and the decision is added to the history. |

### Status at a glance

Every document shows the same five states, on its row icon and in its approval window.

| State | Colour | Meaning | What you can do |
| --- | --- | --- | --- |
| Not sent | Red paper plane / — | Never sent for approval | Send it |
| **Pending** | Orange | Waiting for the approver | Wait, or (purchasing) **Withdraw** it |
| **Approved** | Green | Approved; the history shows by whom and when | Continue: pay, post, receive, send to supplier |
| **Rejected** | Red | Rejected; the reason is shown | Correct it and send it again |
| **Cancelled** | Grey | Withdrawn, or replaced by a newer request | Send it again |

> 🔒 A **purchase order cannot be received, invoiced, changed or sent to the supplier** until it is approved. Requisition lines reach the Buyer Workbench only when the requisition is approved.

### Send for approval

| Document | Where | Approvers offered |
| --- | --- | --- |
| AP invoice | Manage Invoices: red paper-plane icon, or **Send for Approval** | Active AP / INVOICE rules |
| External transaction | Manage External Transactions: paper-plane icon, or **Send for Approval** on the form | Active CASH / EXTERNAL\_TXN rules |
| Requisition / purchase order | The document's **Submit** button | PROCUREMENT rules pre-selected; any authorized approver with a high enough limit |

In the window, choose the approver and click *Send*. Tick **Also email the approver** if they should also get approve / reject links by e-mail.

![Sending an AP invoice for approval](ap-04a-send-for-approval.webp)

Sending a document again (after a rejection) cancels the earlier pending request; the history shows it as *Replaced by a new request*.

### Approve or reject

You can decide from three places:

1. **The pop-up** that appears when the request arrives: **Approve**, **Reject**, or **View** for the details.
2. **The bell** (Notifications panel, *Approvals* filter): the eye icon opens the details, and the green and red buttons decide.
3. **Purchasing → Approvals**, for requisitions, purchase orders and change orders.

![Pending approvals in the bell](start-04-notifications.webp)

The details window shows everything needed to decide: the document header and every line with the total. For invoices it shows the supplier and amounts; for purchase orders the supplier, site, business unit and payment terms. **Open invoice** / **Open purchase order** jumps to the full document.

![Request details before deciding](po-07-po-bell-detail.webp)

When you reject, enter the reason; the preparer sees it. Rejecting from the pop-up rejects straight away, without a reason, so open the details if you want to explain.

> You cannot approve a purchasing document you submitted yourself. Send it to a colleague.

### Approval history

Click the status icon on any document (or the *Approved by …* / *Pending — with …* button on a purchase order) to open its approval window: current state, who sent it and when, the approver, the decision date and the full history of every request.

![Approval history](ap-04b-approval-history.webp)

### Setting up approvers and rules

An administrator sets up who approves what in **Administration → Approval Engine**: first the **Approvers** (name, sign-in e-mail, limit, modules), then the **Approval Rules** (module, transaction type, amount range, approvers). See *Administration* for the steps. Without an active rule and approver, *Send for approval* shows a warning and nothing is sent.

![Approval rules](admin-05-approval-engine-rules.webp)
