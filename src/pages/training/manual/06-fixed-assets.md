Fixed Assets keeps the asset register, calculates and posts monthly depreciation, and handles retirements (sale, scrapping, theft). Open it from the **Fixed Assets** tile on Home.

### Find an asset

1. Go to **Fixed Assets → Manage Assets** (*Asset Workbench*). The search runs straight away for *Active* assets.
2. Filter by **Book**, **Asset Number**, **Description**, **Asset Type** or **Category**. Change **Status** to *Retired* (or clear it) to see retired assets.
3. Click **Search**, then an asset number to open it.

![Asset Workbench](fa-01-manage-assets.webp)

The asset opens in its own tab with cost, NBV and depreciation reserve at the top and these tabs: **Financial**, Descriptive, Books, **Depreciation**, Assignments, Source Lines, Transactions, Category Accounts, Attributes and Retirements.

![An asset: Financial tab](fa-02-asset-detail.webp)

- **Financial** tab: **Create Accounting** for the addition, or **View Accounting** once done.
- **Depreciation** tab: **Adjust Cost**, **Retire** and **Preview Depreciation**.

### Add an asset

Go to **Fixed Assets → Create Asset**. The wizard has four steps; use **Next** and **Back**.

1. **Asset Details**: **Asset Type**, **Category** and **Description** (required), plus tag and serial number, manufacturer, model, units, and whether it is in use, owned or leased, new or used. The asset number shown is a preview; the real number is given on save.

![Create asset, step 1: asset details](fa-03-create-asset-details.webp)

2. **Book & Financials**: **Book Type**, **Date Placed in Service** and **Cost** (required), salvage value, whether to depreciate, and the **Depreciation Method** (for example *Straight Line, 60 months*). **Preview Depreciation** shows the schedule once a method is chosen.

![Create asset, step 2: book and financials](fa-04-create-asset-book.webp)

3. **Assignment**: location and expense account. The account fills from the category; both are optional.
4. **Review & Submit**: check everything and click **Create Asset**.

### Review depreciation

**Fixed Assets → Depreciation** (*Depreciation Workbench*) is read-only. Choose the **Book** and **Period** (the latest is loaded first) and click **Search** to see each asset's depreciation for the period, YTD depreciation, reserve and NBV, with totals at the top.

![Depreciation Workbench](fa-05-depreciation-workbench.webp)

### Run depreciation for a period

1. Open **Calculate Depreciation** from the Fixed Assets home page (it is not in the menu search).
2. Click **Status by Period**, choose the **Period** yourself (the default can be a future month) and click **Show**.
3. The cards show how many assets are posted and not posted. The grid compares the **Calculated** amount with what is already **Posted**, with the debit account.
4. Tick the *Not Posted* rows (posted rows and zero amounts cannot be ticked) and click **Create Depreciation (n)**.
5. Click **Create Accounting for All (n)** to account the posted lines that are not yet accounted.

![Depreciation status for Oct-26](fa-06-calculate-deprn-status.webp)

![Two assets selected to post](fa-07-calculate-deprn-grid.webp)

Depreciation is straight line by a daily rate, starting the month after the date placed in service.

### Retire an asset

1. Open the asset and go to its **Depreciation** tab. Click **Retire**.
2. Enter the date, type (ordinary, sale, theft, …), cost retired and proceeds.
3. Click **Preview Accounting**, check that every line has an account, and click **Retire Asset**.

**Fixed Assets → Retirements** lists all retirements with cost and NBV retired, proceeds and **Gain / Loss** (green gain, red loss). Status *PENDING* means the accounting is still to be done; *PROCESSED* means it is done.

![Asset Retirements](fa-08-retirements.webp)

Click the accounting icon on a pending retirement to preview the journal: accumulated depreciation and proceeds debited, cost credited, and the gain or loss. **Show Steps** then creates the accounting, posts it to the GL journal and marks the retirement accounted.

![Accounting preview for a sale](fa-09-retirement-accounting.webp)
