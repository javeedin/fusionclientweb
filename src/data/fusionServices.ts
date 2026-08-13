// Catalog of Oracle Fusion Cloud REST resources (GET only) used by the
// "Browse Data" explorer. This is the single source of truth for the API
// Explorer and the "Run services" data-coverage scan.
//
// Every entry is a read-only GET against the fscmRestApi collection resource.
// The Browse Data page hits `${FUSION_BASE}/${resource}` with pagination and
// then scans returned records for any business-unit-ish attribute so it can
// report, per business unit, in how many modules / services data exists.

export type FusionModule = 'Financials' | 'Supply Chain';
export type ServiceKind = 'Transaction' | 'Master';

export interface FusionService {
  key: string;
  label: string;
  module: FusionModule;
  kind: ServiceKind;
  resource: string;            // fscmRestApi collection resource name
  area: string;                // sub-area (AP, AR, GL, Order Mgmt, Inventory…)
  description: string;
  buFields?: string[];         // extra BU attribute names beyond the generic scan
}

// Generic business-unit attribute detector — matches BusinessUnit,
// BusinessUnitName, RequisitioningBUName, ProcurementBUName, SoldToBusinessUnit…
export const BU_KEY_RE = /(^|_)business_?unit(_?name)?$|bu_?name$|bunit$/i;

// Pull the distinct business-unit values out of one Fusion record, using the
// generic detector plus any resource-specific fields declared in the catalog.
export const buValuesOf = (rec: Record<string, any>, extra?: string[]): string[] => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (v == null || v === '') continue;
    if (BU_KEY_RE.test(k) || (extra && extra.includes(k))) {
      const s = String(v).trim();
      if (s && !/^\d+$/.test(s) && s.length < 120) out.push(s);
    }
  }
  return Array.from(new Set(out));
};

export const FUSION_SERVICES: FusionService[] = [
  // ───────────────────────── Financials — Transactions ─────────────────────────
  { key: 'ap-invoices', label: 'AP Invoices', module: 'Financials', kind: 'Transaction', area: 'Payables',
    resource: 'invoices', description: 'Payables invoices (supplier invoices)', buFields: ['BusinessUnit'] },
  { key: 'ap-payments', label: 'AP Payments', module: 'Financials', kind: 'Transaction', area: 'Payables',
    resource: 'payablesPayments', description: 'Payables payments to suppliers', buFields: ['BusinessUnit'] },
  { key: 'ap-holds', label: 'AP Invoice Holds', module: 'Financials', kind: 'Transaction', area: 'Payables',
    resource: 'payablesInvoiceHolds', description: 'Holds placed on payables invoices' },
  { key: 'ar-invoices', label: 'AR Invoices', module: 'Financials', kind: 'Transaction', area: 'Receivables',
    resource: 'receivablesInvoices', description: 'Receivables transactions / customer invoices', buFields: ['BusinessUnit'] },
  { key: 'ar-credit-memos', label: 'AR Credit Memos', module: 'Financials', kind: 'Transaction', area: 'Receivables',
    resource: 'receivablesCreditMemos', description: 'Receivables credit memos', buFields: ['BusinessUnit'] },
  { key: 'ar-receipts', label: 'AR Receipts', module: 'Financials', kind: 'Transaction', area: 'Receivables',
    resource: 'standardReceipts', description: 'Receivables standard receipts', buFields: ['BusinessUnit'] },
  { key: 'ar-adjustments', label: 'AR Adjustments', module: 'Financials', kind: 'Transaction', area: 'Receivables',
    resource: 'receivablesAdjustments', description: 'Receivables adjustments', buFields: ['BusinessUnit'] },
  { key: 'cash-transfers', label: 'Bank Account Transfers', module: 'Financials', kind: 'Transaction', area: 'Cash Mgmt',
    resource: 'cashBankAccountTransfers', description: 'Cash management bank account transfers', buFields: ['BusinessUnit'] },
  { key: 'cash-external', label: 'External Cash Transactions', module: 'Financials', kind: 'Transaction', area: 'Cash Mgmt',
    resource: 'cashExternalTransactions', description: 'External bank / cash transactions', buFields: ['BusinessUnit'] },

  // ───────────────────────── Financials — Masters ─────────────────────────
  { key: 'suppliers', label: 'Suppliers', module: 'Financials', kind: 'Master', area: 'Payables',
    resource: 'suppliers', description: 'Supplier master' },
  { key: 'customers', label: 'Customers', module: 'Financials', kind: 'Master', area: 'Receivables',
    resource: 'receivablesCustomerAccountSites', description: 'Customer account sites' },
  { key: 'payables-options', label: 'Payables Options', module: 'Financials', kind: 'Master', area: 'Payables',
    resource: 'payablesOptions', description: 'Per-BU payables options', buFields: ['businessUnitName', 'BusinessUnitName'] },
  { key: 'business-units', label: 'Business Units', module: 'Financials', kind: 'Master', area: 'Setup',
    resource: 'finBusinessUnitsLOV', description: 'Financials business units', buFields: ['BusinessUnitName'] },
  { key: 'legal-entities', label: 'Legal Entities', module: 'Financials', kind: 'Master', area: 'Setup',
    resource: 'legalEntitiesLOV', description: 'Legal entities' },
  { key: 'banks', label: 'Banks', module: 'Financials', kind: 'Master', area: 'Cash Mgmt',
    resource: 'cashBanks', description: 'Bank definitions' },
  { key: 'bank-branches', label: 'Bank Branches', module: 'Financials', kind: 'Master', area: 'Cash Mgmt',
    resource: 'cashBankBranches', description: 'Bank branch definitions' },
  { key: 'bank-accounts', label: 'Bank Accounts', module: 'Financials', kind: 'Master', area: 'Cash Mgmt',
    resource: 'cashBankAccounts', description: 'Internal bank accounts', buFields: ['BusinessUnitName'] },

  // ───────────────────────── Supply Chain — Transactions ─────────────────────────
  { key: 'sales-orders', label: 'Sales Orders', module: 'Supply Chain', kind: 'Transaction', area: 'Order Mgmt',
    resource: 'salesOrdersForOrderHub', description: 'Order Management sales orders', buFields: ['BusinessUnitName', 'BusinessUnit'] },
  { key: 'shipment-lines', label: 'Shipment Lines', module: 'Supply Chain', kind: 'Transaction', area: 'Shipping',
    resource: 'shipmentLines', description: 'Shipping shipment lines', buFields: ['SellingBusinessUnitName', 'RequestingBusinessUnitName', 'BusinessUnitName'] },
  { key: 'pick-slips', label: 'Pick Slips', module: 'Supply Chain', kind: 'Transaction', area: 'Picking',
    resource: 'pickSlipDetails', description: 'Warehouse picking / pick slip details', buFields: ['BusinessUnitName'] },
  { key: 'inv-reservations', label: 'Inventory Reservations', module: 'Supply Chain', kind: 'Transaction', area: 'Inventory',
    resource: 'inventoryReservations', description: 'Inventory demand/supply reservations' },
  { key: 'inv-onhand', label: 'On-hand Balances', module: 'Supply Chain', kind: 'Transaction', area: 'Inventory',
    resource: 'inventoryOnhandBalances', description: 'Inventory on-hand quantities' },
  { key: 'inv-transactions', label: 'Inventory Transactions', module: 'Supply Chain', kind: 'Transaction', area: 'Inventory',
    resource: 'inventoryCompletedTransactions', description: 'Completed inventory material transactions' },
  { key: 'purchase-orders', label: 'Purchase Orders', module: 'Supply Chain', kind: 'Transaction', area: 'Procurement',
    resource: 'purchaseOrders', description: 'Procurement purchase orders', buFields: ['ProcurementBUName', 'RequisitioningBUName', 'SoldToLegalEntity'] },
  { key: 'purchase-requisitions', label: 'Purchase Requisitions', module: 'Supply Chain', kind: 'Transaction', area: 'Procurement',
    resource: 'purchaseRequisitions', description: 'Self-service / purchase requisitions', buFields: ['RequisitioningBUName'] },
  { key: 'receiving-receipts', label: 'Receiving Receipts', module: 'Supply Chain', kind: 'Transaction', area: 'Receiving',
    resource: 'receivingReceiptRequests', description: 'Receiving receipt requests', buFields: ['BusinessUnitName'] },

  // ───────────────────────── Supply Chain — Masters ─────────────────────────
  { key: 'items', label: 'Items', module: 'Supply Chain', kind: 'Master', area: 'Product',
    resource: 'itemsV2', description: 'Item master (product information management)' },
  { key: 'inv-organizations', label: 'Inventory Organizations', module: 'Supply Chain', kind: 'Master', area: 'Inventory',
    resource: 'inventoryOrganizations', description: 'Inventory / plant organizations', buFields: ['ManagementBusinessUnitName', 'BusinessUnitName'] },
  { key: 'subinventories', label: 'Subinventories', module: 'Supply Chain', kind: 'Master', area: 'Inventory',
    resource: 'subinventories', description: 'Subinventory definitions' },
  { key: 'price-lists', label: 'Price Lists', module: 'Supply Chain', kind: 'Master', area: 'Pricing',
    resource: 'priceLists', description: 'Pricing price lists' },
];

export const SERVICE_MODULES: FusionModule[] = ['Financials', 'Supply Chain'];
