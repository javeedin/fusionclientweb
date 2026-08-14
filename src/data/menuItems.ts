import { getCurrentCompany } from '../config/company.config';

export interface MenuSearchItem {
  key:          string;
  label:        string;
  module:       string;       // short code shown in badge
  moduleLabel:  string;       // full module name
  path:         string;
  description?: string;
  keywords?:    string;       // extra terms to match on search
}

export const ALL_MENU_ITEMS: MenuSearchItem[] = [
  // ── Home ────────────────────────────────────────────────────────────────────
  { key: 'home',                  label: 'Home',                        module: 'HOME', moduleLabel: 'Home',                   path: '/home',                           description: 'Main dashboard', keywords: 'dashboard modules home' },

  // ── General Ledger ──────────────────────────────────────────────────────────
  { key: 'gl',                    label: 'General Ledger',              module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl',                             description: 'GL module home' },
  { key: 'gl-manage-journals',    label: 'Manage Journals',             module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/manage-journals',             description: 'Search and manage journal entries', keywords: 'je journal batch posted unposted' },
  { key: 'gl-create-journal',     label: 'Create Journal',              module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/create-journal',              description: 'Create a new manual journal entry' },
  { key: 'gl-account-analysis',   label: 'Account Analysis',            module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/account-analysis',            description: 'Drill into account balances and transactions' },
  { key: 'gl-account-analysis-v2', label: 'Account Analysis V2',        module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/account-analysis-v2',         description: 'Redesigned account analysis with flat columns' },
  { key: 'gl-chart-of-accounts',  label: 'Chart of Accounts',           module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/chart-of-accounts',           description: 'Browse and maintain the chart of accounts', keywords: 'coa accounts ledger' },
  { key: 'gl-coa-segments',       label: 'COA Segments',                module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/coa-segments',               description: 'Manage account segment values', keywords: 'segment values coa structure' },
  { key: 'gl-manage-structures',  label: 'Manage Structures',           module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/manage-structures',           description: 'Define account structure instances' },
  { key: 'gl-account-combos',     label: 'Account Combinations',        module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/account-combinations',        description: 'Valid account combination maintenance' },
  { key: 'gl-accounting-periods', label: 'Accounting Periods',          module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/accounting-periods',          description: 'Open and close accounting periods', keywords: 'period open close' },
  { key: 'gl-trial-balance',      label: 'Trial Balance',               module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/trial-balance',               description: 'View trial balance report', keywords: 'tb report balance' },
  { key: 'gl-gen-trial-balance',  label: 'Generate Trial Balance',      module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/generate-trial-balance',      description: 'Generate and refresh trial balance data' },
  { key: 'gl-income-stmt-tpl',    label: 'Income Statement Templates',  module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/income-statement-templates',  description: 'Configure financial statement row sets' },
  { key: 'gl-currencies',         label: 'Currencies',                  module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/currencies',                  description: 'Manage currencies and exchange rates', keywords: 'currency exchange rates fx' },
  { key: 'gl-reconciliation',     label: 'Journal Reconciliation',      module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/journal-reconciliation',      description: 'Reconcile journal entries' },
  { key: 'gl-revaluation',        label: 'Manage Revaluation',          module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/revaluation',                 description: 'FX revaluation — create and account revaluation journals', keywords: 'revaluation fx foreign currency revalue reval' },
  { key: 'gl-categories',         label: 'GL Categories',               module: 'GL',   moduleLabel: 'General Ledger',          path: '/gl/categories',                  description: 'Manage journal entry categories', keywords: 'category je journal category source' },

  // ── Fixed Assets ────────────────────────────────────────────────────────────
  { key: 'fa',                    label: 'Fixed Assets',                module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa',                             description: 'FA module home' },
  { key: 'fa-assets',             label: 'Manage Assets',               module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/assets',                      description: 'Search and manage fixed assets', keywords: 'asset register capital' },
  { key: 'fa-create-asset',       label: 'Create Asset',                module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/create-asset',                description: 'Add a new fixed asset' },
  { key: 'fa-depreciation',       label: 'Depreciation',                module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/depreciation',                description: 'Run and review asset depreciation', keywords: 'depr amortisation' },
  { key: 'fa-retirements',        label: 'Retirements',                 module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/retirements',                 description: 'Retire disposed or sold assets', keywords: 'disposal retire write-off' },
  { key: 'fa-categories',         label: 'Asset Categories',            module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/setup/categories',            description: 'Configure asset category codes' },
  { key: 'fa-depr-methods',       label: 'Depreciation Methods',        module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/setup/methods',               description: 'Define depreciation calculation methods' },
  { key: 'fa-locations',          label: 'Locations',                   module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/setup/locations',             description: 'Maintain asset physical locations' },
  { key: 'fa-book-controls',      label: 'Book Controls',               module: 'FA',   moduleLabel: 'Fixed Assets',            path: '/fa/setup/book-controls',         description: 'Configure asset books and depreciation rules' },

  // ── Accounts Payable ────────────────────────────────────────────────────────
  { key: 'ap',                    label: 'Accounts Payable',            module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap',                             description: 'AP module home' },
  { key: 'ap-manage-invoices',    label: 'Manage Invoices',             module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/manage-invoices',             description: 'Search and manage supplier invoices', keywords: 'invoice supplier payable vendor bill' },
  { key: 'ap-manage-payments',    label: 'Manage Payments',             module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/manage-payments',             description: 'Search and manage AP payments', keywords: 'payment disbursement' },
  { key: 'ap-banks',              label: 'Banks',                       module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/banks',                       description: 'Manage banks, branches and accounts', keywords: 'bank account branch' },
  { key: 'ap-invoice-holds',      label: 'Invoice Holds',               module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/invoice-holds',               description: 'View and manage invoice hold codes', keywords: 'hold block invoice' },
  { key: 'ap-sla-journals',       label: 'SLA Journals',                module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/sla-journals',                description: 'Sub-ledger accounting journals', keywords: 'sla subledger journal' },
  { key: 'ap-create-accounting',  label: 'Create Accounting (AP)',      module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/create-accounting',           description: 'Generate accounting entries for AP' },
  { key: 'ap-multiperiod',       label: 'Multiperiod Accounting',      module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/multiperiod',                 description: 'Manage and post multiperiod accrual schedules', keywords: 'multiperiod accrual schedule spread prepaid' },
  { key: 'ap-prepayments',        label: 'Prepayment Applications',     module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/prepayment-applications',     description: 'Apply prepayments to invoices', keywords: 'prepay advance deposit' },
  { key: 'ap-check-migration',    label: 'Check Migration',             module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/check-migration',             description: 'Validate and check AP data migration from source systems', keywords: 'migration check validate data import legacy' },
  { key: 'ap-gl-reconcile',      label: 'AP–GL Reconciliation',        module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/gl-reconcile',                description: 'Reconcile AP journal lines against AP payment transactions', keywords: 'reconcile gl journal ap payment match subledger' },
  { key: 'ap-reports',            label: 'AP Reports',                  module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/reports',                     description: 'Accounts payable reports' },
  { key: 'ap-dist-combos',        label: 'Distribution Combinations',   module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/distribution-combinations',   description: 'Manage AP distribution account combinations' },
  { key: 'ap-bank-transfers',     label: 'Bank Transfers (AP)',          module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/bank-transfers',              description: 'Manage AP bank transfer transactions', keywords: 'transfer wire' },
  { key: 'ap-ext-transactions',   label: 'External Transactions (AP)',   module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/external-transactions',       description: 'External bank transactions for AP' },
  { key: 'ap-suppliers',          label: 'Suppliers',                   module: 'AP',   moduleLabel: 'Accounts Payable',        path: '/ap/suppliers',                   description: 'Manage supplier master data', keywords: 'vendor supplier party' },

  // ── Accounts Receivable ─────────────────────────────────────────────────────
  { key: 'ar',                    label: 'Accounts Receivable',         module: 'AR',   moduleLabel: 'Accounts Receivable',     path: '/ar',                             description: 'AR module home' },
  { key: 'ar-manage-receivables',  label: 'Manage Receivable Invoices',  module: 'AR',   moduleLabel: 'Accounts Receivable',     path: '/ar/manage-receivables',          description: 'Create and manage AR invoices and transactions', keywords: 'receivables invoice create ar customer transaction debit memo credit memo' },
  { key: 'ar-manage-customers',    label: 'Manage Customers',            module: 'AR',   moduleLabel: 'Accounts Receivable',     path: '/ar/manage-customers',            description: 'View and manage customer accounts', keywords: 'customer account party receivable' },
  { key: 'ar-manage-receipts',     label: 'Manage Receipts',             module: 'AR',   moduleLabel: 'Accounts Receivable',     path: '/ar/manage-receipts',             description: 'Search and manage cash receipts', keywords: 'receipt cash collection payment receivable' },
  { key: 'ar-manage-credit-memos', label: 'Manage Credit Memos',         module: 'AR',   moduleLabel: 'Accounts Receivable',     path: '/ar/manage-credit-memos',         description: 'Search and view AR credit memos synced from Oracle Fusion', keywords: 'credit memo cm ar transaction receivable credit reason discount' },
  { key: 'ar-sync-cm-applications', label: 'Sync CM Applications',       module: 'AR',   moduleLabel: 'Accounts Receivable',     path: '/ar/sync-cm-applications',        description: 'Sync AR credit memo applications per customer from Oracle Fusion', keywords: 'credit memo application sync customer cm applied fusion' },

  // ── Cash Management ─────────────────────────────────────────────────────────
  { key: 'cash',                  label: 'Cash Management',             module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash',                           description: 'Cash module home' },
  { key: 'cash-bank-transfers',   label: 'Bank Transfers',              module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash/bank-transfers',            description: 'Manage cash bank transfers', keywords: 'transfer wire bank' },
  { key: 'cash-ext-transactions', label: 'External Transactions',       module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash/external-transactions',     description: 'Import and manage external bank transactions' },
  { key: 'cash-bank-statements',  label: 'Bank Statements',             module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash/bank-statements',           description: 'View bank statements', keywords: 'statement bank' },
  { key: 'cash-bank-recon',       label: 'Bank Reconciliation',         module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash/bank-reconciliation',       description: 'Reconcile bank statements', keywords: 'reconcile bank recon' },
  { key: 'cash-txn-codes',        label: 'Transaction Codes',           module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash/transaction-codes',         description: 'Maintain bank statement transaction codes', keywords: 'transaction code bank charge neft rtgs' },
  { key: 'cash-pdf-templates',    label: 'PDF Statement Templates',     module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash/pdf-templates',             description: 'Design templates for parsing PDF bank statements', keywords: 'pdf template bank statement import parse columns' },
  { key: 'cash-payees',          label: 'Manage Payees',               module: 'CASH', moduleLabel: 'Cash Management',         path: '/cash/payees',                    description: 'Create and manage ad-hoc payees and bank accounts', keywords: 'payee adhoc payment beneficiary bank account' },

  // ── Tax Setup ────────────────────────────────────────────────────────────────
  { key: 'setup-taxes',           label: 'Tax Setup',                   module: 'SETUP', moduleLabel: 'Setup',                   path: '/setup/taxes',                    description: 'Define input/output taxes and assign to business units with GL accounts', keywords: 'tax vat gst input output rate code business unit assignment gl account' },
  { key: 'ap-taxes',              label: 'Tax Setup',                   module: 'AP',    moduleLabel: 'Accounts Payable',        path: '/setup/taxes',                    description: 'Define input/output taxes and assign to business units with GL accounts', keywords: 'tax vat gst input output rate code business unit assignment gl account' },

  // ── Petty Cash ──────────────────────────────────────────────────────────────
  { key: 'pc-registers',          label: 'Petty Cash Registers',        module: 'PC',   moduleLabel: 'Petty Cash',              path: '/pc/registers',                   description: 'Manage petty cash registers and transactions', keywords: 'petty cash pc register custodian' },

  // ── Real Estate / Rent Management ───────────────────────────────────────────
  { key: 'rm',                    label: 'Rent Management',             module: 'RM',   moduleLabel: 'Rent Management',         path: '/rm',                             description: 'RM module home', keywords: 'real estate rent property' },
  { key: 'rm-agreements',         label: 'Manage Agreements',           module: 'RM',   moduleLabel: 'Rent Management',         path: '/rm/agreements',                  description: 'View and manage lease agreements', keywords: 'lease agreement contract tenant' },
  { key: 'rm-properties',         label: 'Manage Properties',           module: 'RM',   moduleLabel: 'Rent Management',         path: '/rm/properties',                  description: 'Manage property master data', keywords: 'property building unit' },
  { key: 'rm-customers',          label: 'Manage Customers',            module: 'RM',   moduleLabel: 'Rent Management',         path: '/rm/customers',                   description: 'Manage tenants and customers', keywords: 'tenant customer party' },
  { key: 'rm-expenses',           label: 'Manage Expenses',             module: 'RM',   moduleLabel: 'Rent Management',         path: '/rm/expenses',                    description: 'Track and manage rental expenses' },

  // ── PMS (Portfolio Management) ───────────────────────────────────────────────
  { key: 'pms',                   label: 'Portfolio Management',        module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms',                            description: 'PMS module home', keywords: 'investment portfolio pms fund' },
  { key: 'pms-watchlist',         label: 'Watchlist',                   module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/watchlist',                  description: 'Monitor watched securities' },
  { key: 'pms-portfolio',         label: 'Portfolio',                   module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/portfolio',                  description: 'View portfolio positions and performance' },
  { key: 'pms-funds',             label: 'Fund Management',             module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/funds',                      description: 'Manage investment funds' },
  { key: 'pms-orders',            label: 'Order Management',            module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/orders',                     description: 'Manage trade orders', keywords: 'trade order buy sell' },
  { key: 'pms-transactions',      label: 'Transactions',                module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/transactions',               description: 'View transaction history' },
  { key: 'pms-investors',         label: 'Investors / Clients',         module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/investors',                  description: 'Manage investor and client records', keywords: 'client investor customer' },
  { key: 'pms-risk',              label: 'Risk Analytics',              module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/risk',                       description: 'Portfolio risk metrics and analytics' },
  { key: 'pms-compliance',        label: 'Compliance',                  module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/compliance',                 description: 'Regulatory compliance tracking' },
  { key: 'pms-reports',           label: 'PMS Reports',                 module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/reports',                    description: 'Portfolio management reports' },
  { key: 'pms-model-portfolio',   label: 'Model Portfolio',             module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/model-portfolio',            description: 'Define and manage model portfolios' },
  { key: 'pms-fees',              label: 'Fee Management',              module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/fees',                       description: 'Manage investment management fees' },
  { key: 'pms-benchmark',         label: 'Benchmark Comparison',        module: 'PMS',  moduleLabel: 'Portfolio Management',    path: '/pms/benchmark',                  description: 'Compare portfolio against benchmarks' },

  // ── Fusion Supply Chain / Inventory ─────────────────────────────────────────
  { key: 'fsc-item-master',       label: 'Item Master',                module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/inventory/items',                                   description: 'Item catalog with attributes, pricing and flags', keywords: 'item master inventory product' },
  { key: 'fsc-subinventories',    label: 'Subinventories',             module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/inventory/subinventories',                         description: 'Warehouse and subinventory hierarchy by business unit', keywords: 'subinventory warehouse inventory location' },
  { key: 'fsc-on-hand',           label: 'On-Hand',                    module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/inventory/onhand',                                  description: 'View current on-hand stock levels by item and location', keywords: 'on-hand stock inventory level quantity' },

  // ── Fusion Supply Chain / Purchasing ─────────────────────────────────────────
  { key: 'fsc-purchase-orders',   label: 'Purchase Orders',            module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/procurement/purchase-orders',                      description: 'Search and manage purchase orders', keywords: 'purchase order po requisition supplier' },
  { key: 'fsc-suppliers',         label: 'Suppliers',                  module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/procurement/suppliers',                            description: 'Supplier master data management', keywords: 'vendor supplier party contact' },

  // ── Fusion Supply Chain / Sales & Order Management ────────────────────────────
  { key: 'fsc-sales-orders',      label: 'Sales Orders',               module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/procurement/sales-orders',                         description: 'Search sales orders and drill into header & lines', keywords: 'sales order so customer' },
  { key: 'fsc-price-list',        label: 'Price List',                 module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/procurement/price-list',                           description: 'Manage and review price lists', keywords: 'price list pricing discount' },

  // ── Fusion Supply Chain / Receiving & Fulfillment ─────────────────────────────
  { key: 'fsc-expected-po-receipts', label: 'Expected PO Receipts',     module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/procurement/expected-receipts',                    description: 'View and manage purchase order lines pending receipt in Oracle Fusion', keywords: 'po receipts expected purchase order pending receipt' },
  { key: 'fsc-create-asn',        label: 'Create ASN',                 module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/procurement/create-asn',                           description: 'Query a purchase order and create an Advance Shipment Notice (ASN) in Oracle Fusion', keywords: 'asn advance shipment notice po' },
  { key: 'fsc-transfer-orders',   label: 'Transfer Orders',            module: 'FSC',  moduleLabel: 'Fusion Supply Chain',     path: '/procurement/transfer-orders',                      description: 'Transfer stock between inventory organizations (search & create via SCO)', keywords: 'transfer order stock movement organization inventory' },

  // ── Procurement (Legacy) ─────────────────────────────────────────────────────
  { key: 'proc-tb-loading',      label: 'Trial Balance Loading',       module: 'PROC', moduleLabel: 'Procurement (Legacy)',    path: '/procurement/tb-loading',         description: 'Load trial balance from Excel, filter and review data', keywords: 'trial balance tb excel upload load procurement' },

  // ── Setup Data ──────────────────────────────────────────
  { key: 'setup-data',            label: 'Setup Data Overview',         module: 'SETUP', moduleLabel: 'Setup Data',             path: '/procurement/setup-data',              description: 'Upload a Fusion Setup Data Export and review all setup tasks + a per-module dashboard', keywords: 'setup fsm export configuration dashboard tasks bu' },
  { key: 'setup-data-fin',        label: 'Financials',                  module: 'SETUP', moduleLabel: 'Setup Data',             path: '/procurement/setup-data/financials',   description: 'Financials setup tasks from a Fusion setup export', keywords: 'setup fsm export financials gl ap ar tax ledger configuration' },
  { key: 'setup-data-scm',        label: 'Supply Chain',                module: 'SETUP', moduleLabel: 'Setup Data',             path: '/procurement/setup-data/supply-chain', description: 'Supply Chain setup tasks from a Fusion setup export', keywords: 'setup fsm export supply chain scm inventory item configuration' },
  { key: 'browse-data',           label: 'Browse Data',                 module: 'SETUP', moduleLabel: 'Setup Data',             path: '/procurement/browse-data',             description: 'Run read-only GET services and see, per business unit, in how many modules you have data + an API explorer', keywords: 'browse data rest api explorer get services business unit coverage transactions masters sales orders invoices receipts payments' },

  // ── Admin ────────────────────────────────────────────────────────────────────
  { key: 'admin',                 label: 'Administration',              module: 'ADMIN', moduleLabel: 'Administration',         path: '/admin',                          description: 'System administration', keywords: 'admin system settings' },
  { key: 'admin-users',           label: 'User Management',             module: 'ADMIN', moduleLabel: 'Administration',         path: '/admin/users',                    description: 'Manage system users and roles', keywords: 'users roles permissions security' },
  { key: 'admin-claude-key',      label: 'Claude AI Key Settings',      module: 'ADMIN', moduleLabel: 'Administration',         path: '/admin/claude-key',               description: 'Manage Anthropic Claude API keys for AI agents', keywords: 'claude ai anthropic api key agent reconciliation' },
  { key: 'admin-ai-assistant',    label: 'AI Assistant',                module: 'ADMIN', moduleLabel: 'Administration',         path: '/admin/ai-assistant',             description: 'RAG-powered AI chat — query documents and live ERP data', keywords: 'ai chat rag assistant documents erp query natural language help' },

  // ── Sync ─────────────────────────────────────────────────────────────────────
  { key: 'sync',                  label: 'Sync Data',                   module: 'SYNC',  moduleLabel: 'Data Sync',              path: '/sync',                           description: 'Synchronise data from Oracle Fusion', keywords: 'sync fusion oracle import data' },

  // ── Support ──────────────────────────────────────────────────────────────────
  { key: 'support',               label: 'Support',                     module: 'SUPP',  moduleLabel: 'Support',                path: '/support',                        description: 'Support module home', keywords: 'help support ticket' },
  { key: 'support-tickets',       label: 'Manage Tickets',              module: 'SUPP',  moduleLabel: 'Support',                path: '/support/tickets',                description: 'View and manage support tickets', keywords: 'ticket issue helpdesk' },
  { key: 'support-my-tickets',    label: 'My Tickets',                  module: 'SUPP',  moduleLabel: 'Support',                path: '/support/my-tickets',             description: 'View my support tickets' },

  // ── Oracle Fusion / Training ─────────────────────────────────────────────────
  { key: 'oracle-fusion',         label: 'Oracle Fusion',               module: 'EXT',   moduleLabel: 'External',               path: '/oracle-fusion',                  description: 'Oracle Fusion integration panel', keywords: 'fusion oracle erp' },
  { key: 'training',              label: 'Training Library',            module: 'EXT',   moduleLabel: 'External',               path: '/training',                       description: 'Training videos and documentation', keywords: 'training help docs tutorial' },
];

// Get filtered menu items based on current company
export const getFilteredMenuItems = (): MenuSearchItem[] => {
  const company = getCurrentCompany();
  const isBumeric = company.code === 'BUIMERC';

  if (isBumeric) {
    return ALL_MENU_ITEMS;
  }

  // For MITSUMI and GRAYSINC: filter out PMS and RM modules
  return ALL_MENU_ITEMS.filter(
    item => item.module !== 'PMS' && item.module !== 'RM'
  );
};

// Grouped for use in Select options
export const MENU_ITEMS_GROUPED = (() => {
  const map = new Map<string, { moduleLabel: string; items: MenuSearchItem[] }>();
  for (const item of ALL_MENU_ITEMS) {
    if (!map.has(item.module)) map.set(item.module, { moduleLabel: item.moduleLabel, items: [] });
    map.get(item.module)!.items.push(item);
  }
  return Array.from(map.entries()).map(([, group]) => ({
    label: group.moduleLabel,
    options: group.items.map(item => ({
      value: item.path,
      label: item.label,
      searchText: [item.label, item.module, item.moduleLabel, item.description, item.keywords]
        .filter(Boolean).join(' ').toLowerCase(),
      item,
    })),
  }));
})();

// Get grouped menu items filtered by company
export const getFilteredMenuItemsGrouped = () => {
  const company = getCurrentCompany();
  const isBumeric = company.code === 'BUIMERC';

  const map = new Map<string, { moduleLabel: string; items: MenuSearchItem[] }>();
  const items = isBumeric ? ALL_MENU_ITEMS : ALL_MENU_ITEMS.filter(
    item => item.module !== 'PMS' && item.module !== 'RM'
  );

  for (const item of items) {
    if (!map.has(item.module)) map.set(item.module, { moduleLabel: item.moduleLabel, items: [] });
    map.get(item.module)!.items.push(item);
  }

  return Array.from(map.entries()).map(([, group]) => ({
    label: group.moduleLabel,
    options: group.items.map(item => ({
      value: item.path,
      label: item.label,
      searchText: [item.label, item.module, item.moduleLabel, item.description, item.keywords]
        .filter(Boolean).join(' ').toLowerCase(),
      item,
    })),
  }));
};
