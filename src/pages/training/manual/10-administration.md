Open **Administration** from Home. Each card opens one administration tool. This chapter covers the ones every company needs: users, the Approval Engine and the FTP Manager.

![Administration home](admin-00-administration-home.webp)

### Users and access

**Administration → User Management** lists every user with person number, status, administrator flag and creation date.

![User Management](admin-01-user-management.webp)

**Create a user**

1. Click **Create User**.
2. Enter the e-mail address as the username, and tick **Administrator** only for people who manage the system.
3. Click **Create User**.
4. Ask the new user to open the sign-in page and use **Reset / Set Password** to set their own password (see Getting started).

**Row actions** (left to right):

| Icon | Action |
| --- | --- |
| ✎ Edit | Change the user's details or switch **Suspended** on. |
| 🔒 Reset password | Set a new password (at least 8 characters, entered twice). |
| ⊘ / ✓ Suspend / Activate | Block or restore sign-in. You are asked to confirm. |
| ▦ Manage Access | Choose the modules and business units the user can work in. |

In **Manage Access**, switch modules on or off on the *Modules* tab and business units on the *Business Units* tab. Each switch saves immediately.

![Manage Access: modules a user may open](admin-02-user-manage-access.webp)

### Approval Engine

**Administration → Approval Engine** decides who approves what in every module: AP invoices, cash external transactions, purchasing documents and the rest. Set it up before anyone sends a document for approval.

**1. Add the approvers.** On the **Approvers** tab click **Add Approver**.

![Approvers: who may approve, their limit and modules](admin-03-approval-engine-approvers.webp)

1. Optionally pick the person under *Select from existing ERP users*. This fills the e-mail; type the **Full Name** yourself.
2. Enter **Full Name** and **Email Address**. The e-mail must be the one the person signs in with, because that is how the bell finds their requests.
3. Add phone, department and job title if you like.
4. Set **Currency** and **Max Approval Amount**. Leave the amount blank for no limit.
5. Choose the **Modules Authorized to Approve**: AP, AR, CASH, GL, FA, PROCUREMENT.
6. Keep **Status** *Active* and click **Create Approver**.

![Add New Approver](admin-04-approval-add-approver.webp)

**2. Add the rules.** On the **Approval Rules** tab click **Add Rule**.

![Approval Rules](admin-05-approval-engine-rules.webp)

1. Enter a **Rule Name** and a **Priority** (1 is the highest; the default is 10).
2. Choose the **Module** and **Transaction Type**:

| Module | Transaction types |
| --- | --- |
| AP | INVOICE, PAYMENT, CREDIT\_NOTE |
| AR | INVOICE, RECEIPT |
| CASH | EXTERNAL\_TXN, BANK\_TRANSFER |
| GL | JOURNAL |
| FA | ASSET\_ADDITION, DISPOSAL |
| PROCUREMENT | PURCHASE\_ORDER, REQUISITION, PO\_CHANGE\_ORDER |

3. Enter the amount range: **Min Amount** and **Max Amount** (blank means no upper limit), and the **Currency**.
4. Choose the **Approval Type**: *Sequential* (one after another), *Parallel* (all at the same time) or *Any One*.
5. Under **Approvers**, add one or more approvers and put them in order with the ↑ ↓ arrows. Only active approvers authorized for the chosen module are listed, so add the approver first.
6. Click **Create Rule**.

![Add New Approval Rule for purchase orders](admin-06-approval-add-rule.webp)

> 💡 A rule can be saved without approvers (you only get a warning), but nothing can then be approved under it. Changing the module clears the transaction type. Deleting a rule also removes its approver assignments.

**3. Follow requests.** The **Requests & History** tab lists every approval request across all modules, with its status, who asked, the current approver and a **History** button.

![Requests & History](admin-07-approval-requests-history.webp)

### FTP Manager: OCI Bastion tunnel

**Administration → FTP Manager** transfers files to the servers behind the OCI Bastion. To open the tunnel with the SSH command from the OCI console:

1. Copy the SSH command from the bastion session in OCI. It contains the placeholders `<privateKey>` and `<localPort>`.
2. In FTP Manager click **Paste SSH command…** and paste it.
3. The command is read and the placeholders are replaced automatically: the private key with `C:\Bastion keys\reerp-bastion.key` and the local port with `2222`. The window lists what was substituted and shows the finished command.
4. Click **Copy** to copy the ready command, or **Fill in** to put the values into the connection fields.

The button is disabled while a bastion session is already running.
