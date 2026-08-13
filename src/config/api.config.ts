// Proxy Server Configuration - Use to avoid CORS issues in production
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
export const PROXY_CONFIG = {
  baseUrl: isElectron ? 'http://localhost:3001/api' : '/api',
  enabled: true,    // Enable proxy to bypass CORS restrictions
};

// Oracle Fusion API Configuration
const fusionDirectUrl = 'https://iaaobn.fa.ocs.oraclecloud.com/fscmRestApi/resources/11.13.18.05';
const fusionProxyUrl = `${PROXY_CONFIG.baseUrl}/fusion/fscmRestApi/resources/11.13.18.05`;
export const ORACLE_FUSION_CONFIG = {
  baseUrl: PROXY_CONFIG.enabled ? fusionProxyUrl : fusionDirectUrl,
  username: 'ratheesh@buimerccorp.com',
  password: 'BCL#261285',
  defaultLimit: 500,
  testLimit: 25, // Limit for testing
  singleRecordLimit: 1, // Limit for single record debugging
};

// APEX Database Configuration
export const APEX_DB_CONFIG = {
  baseUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp',
  endpoints: {
    // GL Endpoints
    journalBatches: 'gl/journalbatches',
    journalHeaders: 'gl/journals/headers',
    journalLines: 'gl/journals/lines',
    glBalances: 'gl/trialbalance',
    periodsStatus: 'periodsstatus/create',
    rrTrialBalance: 'gl/rr-trialbalance',
    rrTrialBalanceGenerate: 'gl/rr-trialbalance/generate',
    rrTrialBalanceLedgers: 'gl/rr-trialbalance/ledgers',
    rrTrialBalancePeriods: 'gl/rr-trialbalance/periods',
    getLedgerName: 'gl/getledgername',
    rrTrialBalanceCompanies: 'gl/rr-trialbalance/companies',
    rrTrialBalanceStandard:   'gl/rr-trialbalance/standard',
    rrTrialBalanceStandardRE: 'gl/rr-trialbalance/standardRE',
    rrTrialBalanceLines:    'gl/rr-trialbalance/lines',
    glLinesSummary: 'gl/lines-summary',
    retainedEarnings: 'gl/retained-earnings',
    retainedEarningsSave: 'gl/retained-earnings/save',
    // SLA Endpoints
    slaAccountingCreate:  'sla/accounting/create',
    slaAccountingPost:    'sla/accounting/post',
    slaAccountingError:   'sla/accounting/error',
    slaAccounting:        'sla/accounting',
    slaAccountingExists:  'sla/accounting/exists',
    slaJournals:          'sla/journals',
    slaJournalLines:      'sla/journals/lines',
    // AR Endpoints
    arReceipts: 'ar/receipts',
    arReceiptsBulk: 'ar/receipts/bulk',
    arReceiptApplications: 'ar/receipt-applications',
    arReceiptApplicationsBulk: 'ar/receipt-applications/bulk',
    arAdjustments: 'ar/adjustments',
    arAdjustmentsBulk: 'ar/adjustments/bulk',
    // AP Endpoints
    apInvoices: 'ap/invoices',
    apInvoicesBulk: 'ap/invoices/bulk',
    apInvoicesStats: 'ap/invoices/stats',
    apPayments: 'ap/payments',
    apPaymentByCheckId: 'ap/payments',  // append /:check_id
    // Rental Management endpoints
    rmAgreements:  'rm/agreements',
    rmProperties:  'rm/properties',
    rmCustomers:   'rm/customers',
    rmExpenses:    'rm/expenses',
    rmInstallments:'rm/installments',
    // Cash Endpoints
    bankAccountTransfers: 'cash/banktransfers',
    externalCashTransactions: 'cash/externaltransactions',
    // Revaluation Endpoints
    revaluation: 'gl/revaluation',
    // Approval Engine
    approvalUsers:    'approvals/users',
    approvalRules:    'approvals/rules',
    approvalRequests: 'approvals/requests',
    approvalNotify:   'approvals/notify',
  },
};

// Oracle BI Publisher SOAP Configuration
export const ORACLE_SOAP_CONFIG = {
  prod: {
    baseUrl: 'https://iaaobn.fa.ocs.oraclecloud.com/xmlpserver/services/v2/ReportService',
    username: 'ratheesh@buimerccorp.com',
    password: 'BCL#261285',
  },
  test: {
    baseUrl: 'https://iaaobn-test.fa.ocs.oraclecloud.com/xmlpserver/services/v2/ReportService',
    username: 'javeedindia@gmail.com',
    password: 'Bumeric2026',
  },
  reports: {
    glBalances: '/Custom/FA_REPORTS/GL_REPORTS/GL_BALANCES_BIP.xdo',
  },
};

// Sync Objects Configuration
export interface SyncObjectConfig {
  id: string;
  name: string;
  description: string;
  oracleEndpoint: string;
  apexEndpoint: string;
  parameters: ParameterConfig[];
  apiType?: 'REST' | 'SOAP';  // Default is REST
  soapConfig?: {
    reportPath: string;
    environment?: 'prod' | 'test';
  };
  hasChildren?: boolean;
  childConfig?: {
    headers?: {
      linkName: string;
      apexEndpoint: string;
    };
    lines?: {
      linkName: string;
      apexEndpoint: string;
    };
  };
}

export interface ParameterConfig {
  key: string;
  label: string;
  type: 'text' | 'select' | 'date' | 'api-select';
  required: boolean;
  options?: { label: string; value: string }[];
  apiUrl?: string;           // for type='api-select': URL to fetch options from
  apiLabelKey?: string;      // response item key to use as label
  apiValueKey?: string;      // response item key to use as value
  apiSubLabelKey?: string;   // optional secondary label shown below the main label
  apiCountKey?: string;      // optional count key to show alongside label
  dependsOn?: string;        // re-fetch when this other param key changes
  apiFilterParam?: string;   // query-string param name to pass the dependsOn value as a filter
  defaultValue?: string;
  placeholder?: string;
}

export const SYNC_OBJECTS: SyncObjectConfig[] = [
  {
    id: 'gl-journal-batches',
    name: 'GL Journals (Full Sync)',
    description: 'Sync Journal Batches → Headers → Lines from Oracle Fusion',
    oracleEndpoint: 'journalBatches',
    apexEndpoint: 'gl/journalbatches',
    hasChildren: true,
    childConfig: {
      headers: {
        linkName: 'journalHeaders',
        apexEndpoint: 'gl/journals/headers',
      },
      lines: {
        linkName: 'journalLines',
        apexEndpoint: 'gl/journals/lines',
      },
    },
    parameters: [
      {
        key: 'DefaultPeriodName',
        label: 'Period',
        type: 'text',
        required: true,
        defaultValue: 'May-24',
      },
      {
        key: 'JeBatchId',
        label: 'Batch ID (optional)',
        type: 'text',
        required: false,
        defaultValue: '',
        placeholder: 'e.g. 123456 — leave blank for all',
      },
    ],
  },
  {
    id: 'gl-batches-only',
    name: 'GL Batches',
    description: 'Sync only Journal Batches from Oracle Fusion (no headers/lines)',
    oracleEndpoint: 'journalBatches',
    apexEndpoint: 'gl/journalbatches',
    hasChildren: false,
    parameters: [
      {
        key: 'DefaultPeriodName',
        label: 'Period',
        type: 'text',
        required: false,
        defaultValue: '',
      },
      {
        key: 'LedgerId',
        label: 'Ledger ID',
        type: 'text',
        required: false,
        defaultValue: '',
      },
      {
        key: 'JeBatchId',
        label: 'Batch ID (optional)',
        type: 'text',
        required: false,
        defaultValue: '',
        placeholder: 'e.g. 123456 — leave blank for all',
      },
    ],
  },
  {
    id: 'gl-headers-only',
    name: 'GL Headers',
    description: 'Sync Journal Headers for synced batches (requires GL Batches first)',
    oracleEndpoint: 'journalBatches',
    apexEndpoint: 'gl/journals/headers',
    hasChildren: false,
    parameters: [
      {
        key: 'DefaultPeriodName',
        label: 'Period',
        type: 'api-select',
        required: false,
        apiUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/sync/glbatchesperiods',
        apiLabelKey: 'default_period_name',
        apiValueKey: 'default_period_name',
        apiCountKey: 'count',
        placeholder: 'Select period (from synced batches)',
        defaultValue: '',
      },
    ],
  },
  {
    id: 'gl-lines-only',
    name: 'GL Lines',
    description: 'Sync Journal Lines for synced headers (requires GL Headers first)',
    oracleEndpoint: 'journalBatches',
    apexEndpoint: 'gl/journals/lines',
    hasChildren: false,
    parameters: [
      {
        key: 'DefaultPeriodName',
        label: 'Period',
        type: 'api-select',
        required: false,
        apiUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/sync/glbatchesperiods',
        apiLabelKey: 'default_period_name',
        apiValueKey: 'default_period_name',
        apiCountKey: 'count',
        placeholder: 'Select period (from synced batches)',
        defaultValue: '',
      },
    ],
  },
  {
    id: 'gl-code-combinations',
    name: 'GL Code Combinations',
    description: 'Sync GL Account Code Combinations (Chart of Accounts) from Oracle Fusion',
    oracleEndpoint: 'accountCombinationsLOV',
    apexEndpoint: 'glcodecombinations/create',
    parameters: [
      {
        key: 'ChartOfAccountsId',
        label: 'Chart of Accounts ID',
        type: 'text',
        required: false,
        defaultValue: '',
      },
      {
        key: 'EnabledFlag',
        label: 'Enabled Only',
        type: 'select',
        required: false,
        options: [
          { label: 'All', value: '' },
          { label: 'Enabled Only', value: 'Y' },
          { label: 'Disabled Only', value: 'N' },
        ],
      },
    ],
  },
  {
    id: 'ap-invoices',
    name: 'AP Invoices',
    description: 'Sync AP Invoices from Oracle Fusion',
    oracleEndpoint: 'invoices',
    apexEndpoint: 'ap/invoices',
    parameters: [
      {
        key: 'BusinessUnit',
        label: 'Business Unit',
        type: 'api-select',
        required: false,
        apiUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/gl/businessunits',
        apiLabelKey: 'business_unit_name',
        apiValueKey: 'business_unit_name',
        placeholder: 'All business units',
      },
      {
        key: 'SupplierNumber',
        label: 'Supplier',
        type: 'api-select',
        required: false,
        apiUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/suppliers',
        apiLabelKey: 'supplier_number',
        apiValueKey: 'supplier_number',
        apiSubLabelKey: 'supplier',
        dependsOn: 'BusinessUnit',
        apiFilterParam: 'P_BUSINESS_UNIT',
        placeholder: 'All suppliers',
      },
      {
        key: 'InvoiceDateFrom',
        label: 'Invoice Date From',
        type: 'date',
        required: false,
      },
      {
        key: 'InvoiceDateTo',
        label: 'Invoice Date To',
        type: 'date',
        required: false,
      },
    ],
  },
  {
    id: 'gl-accounts',
    name: 'GL Accounts',
    description: 'Sync Chart of Accounts from Oracle Fusion',
    oracleEndpoint: 'accounts',
    apexEndpoint: 'gl/accounts',
    parameters: [],
  },
  {
    id: 'customers',
    name: 'Customers',
    description: 'Sync Customers from Oracle Fusion',
    oracleEndpoint: 'customers',
    apexEndpoint: 'ar/customers',
    parameters: [],
  },
  {
    id: 'ar-invoices',
    name: 'AR Invoices',
    description: 'Sync AR Invoices (Receivables Transactions) from Oracle Fusion',
    oracleEndpoint: 'receivablesInvoices',
    apexEndpoint: 'ar/invoices/bulk',
    parameters: [
      {
        key: 'BusinessUnit',
        label: 'Business Unit',
        type: 'api-select',
        required: false,
        apiUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/gl/businessunits',
        apiLabelKey: 'business_unit_name',
        apiValueKey: 'business_unit_name',
        placeholder: 'All business units',
      },
      {
        key: 'TransactionNumber',
        label: 'Transaction Number',
        type: 'text',
        required: false,
        placeholder: 'e.g. 300486 — leave blank for all',
      },
      {
        key: 'TransactionDateFrom',
        label: 'Transaction Date From',
        type: 'date',
        required: false,
      },
      {
        key: 'TransactionDateTo',
        label: 'Transaction Date To',
        type: 'date',
        required: false,
      },
    ],
  },
  {
    id: 'ar-receipts',
    name: 'AR Receipts',
    description: 'Sync AR Standard Receipts from Oracle Fusion',
    oracleEndpoint: 'standardReceipts',
    apexEndpoint: 'ar/receipts/bulk',
    parameters: [
      {
        key: 'BusinessUnit',
        label: 'Business Unit',
        type: 'api-select',
        required: false,
        apiUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/gl/businessunits',
        apiLabelKey: 'business_unit_name',
        apiValueKey: 'business_unit_name',
        placeholder: 'All business units',
      },
      {
        key: 'ReceiptNumber',
        label: 'Receipt Number',
        type: 'text',
        required: false,
        placeholder: 'e.g. GBMT_BOB_TT — leave blank for all',
      },
      {
        key: 'ReceiptDateFrom',
        label: 'Receipt Date From',
        type: 'date',
        required: false,
      },
      {
        key: 'ReceiptDateTo',
        label: 'Receipt Date To',
        type: 'date',
        required: false,
      },
    ],
  },
  {
    id: 'ar-receipt-applications',
    name: 'AR Receipt Applications',
    description: 'Sync AR Standard Receipt Applications from Oracle Fusion (per customer)',
    oracleEndpoint: 'receipt-applications',
    apexEndpoint: 'ar/receipt-applications/bulk',
    parameters: [
      {
        key: 'CustAccountId',
        label: 'Customer',
        type: 'api-select',
        required: false,
        apiUrl: 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/ar/customers',
        apiLabelKey: 'account_name',
        apiValueKey: 'cust_account_id',
        apiSubLabelKey: 'account_number',
        placeholder: 'All customers',
      },
    ],
  },
  {
    id: 'ar-adjustments',
    name: 'AR Adjustments',
    description: 'Sync AR Adjustments from Oracle Fusion receivablesAdjustments',
    oracleEndpoint: 'receivablesAdjustments',
    apexEndpoint: 'ar/adjustments/bulk',
    parameters: [
      {
        key: 'BusinessUnit',
        label: 'Business Unit',
        type: 'text',
        required: false,
        placeholder: 'e.g. BUIMERC CORP_DIFC_INVST',
      },
      {
        key: 'Status',
        label: 'Status',
        type: 'select',
        required: false,
        options: [
          { label: 'All', value: '' },
          { label: 'Approved', value: 'Approved' },
          { label: 'More Research Required', value: 'More Research Required' },
          { label: 'Rejected', value: 'Rejected' },
        ],
      },
      {
        key: 'AdjustmentDateFrom',
        label: 'Date From',
        type: 'date',
        required: false,
      },
      {
        key: 'AdjustmentDateTo',
        label: 'Date To',
        type: 'date',
        required: false,
      },
    ],
  },
  {
    id: 'ar-invoice-installments',
    name: 'AR Invoice Installments',
    description: 'Sync AR Invoice Installments from Oracle Fusion. If Customer Transaction ID is provided, only that invoice is synced; otherwise all APEX invoices are processed.',
    oracleEndpoint: 'receivablesInvoices',
    apexEndpoint: 'ar/invoices/:id/installments',
    parameters: [
      {
        key: 'CustomerTransactionId',
        label: 'Customer Transaction ID',
        type: 'text',
        required: false,
        placeholder: 'e.g. 300000089305592 — leave blank to sync all',
      },
    ],
  },
  {
    id: 'ar-invoice-dff',
    name: 'AR Invoice DFF Sync',
    description: 'Sync AR Invoice Descriptive Flexfield (Rental Details) — fetches each invoice from APEX then calls Fusion receivablesInvoiceDFF child endpoint.',
    oracleEndpoint: 'receivablesInvoices',
    apexEndpoint: 'ar/invoices/dff/bulk',
    parameters: [
      {
        key: 'CustomerTransactionId',
        label: 'Customer Transaction ID',
        type: 'text',
        required: false,
        placeholder: 'e.g. 300000089305592 — leave blank to sync all',
      },
    ],
  },
  {
    id: 'ar-installment-notes',
    name: 'AR Installment Notes Sync',
    description: 'Sync AR Invoice Installment Notes — fetches invoices from APEX, then loops Fusion receivablesInvoiceInstallments and receivablesInvoiceInstallmentNotes per installment.',
    oracleEndpoint: 'receivablesInvoices',
    apexEndpoint: 'ar/invoices/installments/notes/bulk',
    parameters: [
      {
        key: 'CustomerTransactionId',
        label: 'Customer Transaction ID',
        type: 'text',
        required: false,
        placeholder: 'e.g. 300000089305592 — leave blank to sync all',
      },
    ],
  },
  {
    id: 'ar-invoice-distributions',
    name: 'AR Invoice Distributions',
    description: 'Sync AR Invoice Distributions from Oracle Fusion receivablesInvoiceDistributions. Provide Customer Transaction ID to sync one invoice, or leave blank to sync all.',
    oracleEndpoint: 'receivablesInvoices',
    apexEndpoint: 'ar/invoices/:id/distributions',
    parameters: [
      {
        key: 'CustomerTransactionId',
        label: 'Customer Transaction ID',
        type: 'text',
        required: false,
        placeholder: 'e.g. 300000089305592 — leave blank to sync all',
      },
    ],
  },
  {
    id: 'ar-lookups',
    name: 'AR Lookups',
    description: 'Sync all AR lookup tables in one pass — Payment Terms, Transaction Sources, Transaction Types, Memo Lines, Revenue Scheduling Rules.',
    oracleEndpoint: 'paymentTermsLOV',
    apexEndpoint: 'ar/lookups/bulk',
    parameters: [],
  },
  {
    id: 'ar-credit-memos',
    name: 'AR Credit Memos',
    description: 'Sync AR Credit Memos from Oracle Fusion receivablesCreditMemos',
    oracleEndpoint: 'receivablesCreditMemos',
    apexEndpoint: 'ar/credit-memos/bulk',
    parameters: [
      {
        key: 'BusinessUnit',
        label: 'Business Unit',
        type: 'text',
        required: false,
        placeholder: 'e.g. BUIMERC CORP_DIFC_INVST',
      },
      {
        key: 'CreditMemoStatus',
        label: 'Status',
        type: 'select',
        required: false,
        options: [
          { label: 'All', value: '' },
          { label: 'Complete', value: 'Complete' },
          { label: 'Incomplete', value: 'Incomplete' },
        ],
      },
      {
        key: 'TransactionDateFrom',
        label: 'Date From',
        type: 'date',
        required: false,
      },
      {
        key: 'TransactionDateTo',
        label: 'Date To',
        type: 'date',
        required: false,
      },
    ],
  },
  {
    id: 'gl-period-status',
    name: 'GL Period Status',
    description: 'Sync GL Accounting Period Status from Oracle Fusion',
    oracleEndpoint: 'accountingPeriodStatusLOV',
    apexEndpoint: 'moduleperiodsstatus/create',
    parameters: [
      {
        key: 'LedgerId',
        label: 'Ledger ID',
        type: 'text',
        required: false,
        defaultValue: '',
      },
      {
        key: 'ApplicationId',
        label: 'Application ID',
        type: 'select',
        required: false,
        options: [
          { label: 'All', value: '' },
          { label: 'GL (101)', value: '101' },
          { label: 'AP (200)', value: '200' },
          { label: 'AR (222)', value: '222' },
          { label: 'INV (401)', value: '401' },
        ],
      },
    ],
  },
  {
    id: 'banks',
    name: 'Banks',
    description: 'Sync Banks from Oracle Fusion',
    oracleEndpoint: 'cashBanks',
    apexEndpoint: 'banks/createnewbank',
    parameters: [],
  },
  {
    id: 'bank-branches',
    name: 'Bank Branches',
    description: 'Sync Bank Branches from Oracle Fusion',
    oracleEndpoint: 'cashBankBranches',
    apexEndpoint: 'banks/brankbranches',
    parameters: [],
  },
  {
    id: 'bank-accounts',
    name: 'Bank Accounts',
    description: 'Sync Bank Accounts from Oracle Fusion',
    oracleEndpoint: 'cashBankAccounts',
    apexEndpoint: 'banks/bankaccounts',
    parameters: [],
  },
  {
    id: 'legal-entities',
    name: 'Legal Entities',
    description: 'Sync Legal Entities from Oracle Fusion',
    oracleEndpoint: 'legalEntitiesLOV',
    apexEndpoint: 'gl/legalentities',
    parameters: [],
  },
  {
    id: 'business-units',
    name: 'Business Units',
    description: 'Sync Business Units from Oracle Fusion (finBusinessUnitsLOV)',
    oracleEndpoint: 'finBusinessUnitsLOV',
    apexEndpoint: 'gl/businessunits',
    parameters: [],
  },
  {
    id: 'user-accounts',
    name: 'User Accounts',
    description: 'Sync User Accounts from Oracle Fusion',
    oracleEndpoint: 'userAccounts',
    apexEndpoint: 'useraccounts',
    parameters: [],
  },
  {
    id: 'user-account-roles',
    name: 'User Account Roles',
    description: 'Sync User Account Roles from Oracle HCM (fetches roles for each user)',
    oracleEndpoint: 'userAccounts',
    apexEndpoint: 'useraccounts/userroles',
    hasChildren: true,
    parameters: [],
  },
  {
    id: 'roles',
    name: 'Roles',
    description: 'Sync Roles from Oracle HCM',
    oracleEndpoint: 'rolesLOV',
    apexEndpoint: 'roles',
    parameters: [],
  },
  {
    id: 'suppliers',
    name: 'Suppliers',
    description: 'Sync Suppliers from Oracle Fusion',
    oracleEndpoint: 'suppliers',
    apexEndpoint: 'suppliers',
    parameters: [
      {
        key: 'SupplierNumber',
        label: 'Supplier Number',
        type: 'text' as const,
        required: false,
        placeholder: 'e.g. 1234 — leave blank to sync all',
      },
    ],
  },
  {
    id: 'supplier-addresses',
    name: 'Supplier Addresses',
    description: 'Sync Supplier Addresses from Oracle Fusion (fetches addresses for each supplier)',
    oracleEndpoint: 'suppliers/{id}/child/addresses',
    apexEndpoint: 'suppliers/address',
    parameters: [],
  },
  {
    id: 'supplier-sites',
    name: 'Supplier Sites',
    description: 'Sync Supplier Sites from Oracle Fusion (fetches sites for each supplier)',
    oracleEndpoint: 'suppliers/{id}/child/sites',
    apexEndpoint: 'suppliers/sites',
    parameters: [],
  },
  {
    id: 'supplier-site-assignments',
    name: 'Supplier Site Assignments',
    description: 'Sync Site Assignments from Fusion (requires Sites to be synced first)',
    oracleEndpoint: 'suppliers/{supplierId}/child/sites/{siteId}/child/assignments',
    apexEndpoint: 'suppliers/sites/assignments',
    parameters: [],
  },
  {
    id: 'bank-account-transfers',
    name: 'Bank Account Transfers',
    description: 'Sync Bank Account Transfers from Oracle Fusion',
    oracleEndpoint: 'cashBankAccountTransfers',
    apexEndpoint: 'cash/banktransfers',
    parameters: [
      {
        key: 'TransactionDateFrom',
        label: 'Transaction Date From',
        type: 'date',
        required: false,
      },
      {
        key: 'TransactionDateTo',
        label: 'Transaction Date To',
        type: 'date',
        required: false,
      },
      {
        key: 'Status',
        label: 'Status',
        type: 'select',
        required: false,
        options: [
          { label: 'All', value: '' },
          { label: 'Completed', value: 'Completed' },
          { label: 'Cancelled', value: 'Cancelled' },
          { label: 'Terminated', value: 'Terminated' },
        ],
      },
      {
        key: 'BusinessUnit',
        label: 'Business Unit',
        type: 'text',
        required: false,
      },
    ],
  },
  {
    id: 'ap-payments',
    name: 'AP Payments',
    description: 'Sync AP Payments with Related Invoices from Oracle Fusion',
    oracleEndpoint: 'payablesPayments',
    apexEndpoint: 'ap/payments',
    hasChildren: true,
    childConfig: {
      lines: {
        linkName: 'relatedInvoices',
        apexEndpoint: 'ap/payments/related-invoices',
      },
    },
    parameters: [
      {
        key: 'BusinessUnit',
        label: 'Business Unit',
        type: 'text',
        required: false,
      },
      {
        key: 'SupplierNumber',
        label: 'Supplier Number',
        type: 'text',
        required: false,
        placeholder: 'e.g. A0055',
      },
      {
        key: 'PaymentStatus',
        label: 'Payment Status',
        type: 'select',
        required: false,
        options: [
          { label: 'All', value: '' },
          { label: 'Negotiable', value: 'NEGOTIABLE' },
          { label: 'Voided', value: 'VOIDED' },
          { label: 'Cleared', value: 'CLEARED' },
          { label: 'Reconciled', value: 'RECONCILED' },
        ],
      },
      {
        key: 'PaymentDateFrom',
        label: 'Payment Date From',
        type: 'date',
        required: false,
      },
      {
        key: 'PaymentDateTo',
        label: 'Payment Date To',
        type: 'date',
        required: false,
      },
    ],
  },
  {
    id: 'external-cash-transactions',
    name: 'External Cash Transactions',
    description: 'Sync External Cash Transactions from Oracle Fusion',
    oracleEndpoint: 'cashExternalTransactions',
    apexEndpoint: 'cash/externaltransactions',
    parameters: [
      { key: 'TransactionDateFrom', label: 'Date From',       type: 'date',   required: false },
      { key: 'TransactionDateTo',   label: 'Date To',         type: 'date',   required: false },
      { key: 'Status',              label: 'Status',          type: 'select', required: false,
        options: [
          { label: 'All', value: '' }, { label: 'Reconciled', value: 'REC' },
          { label: 'Unreconciled', value: 'UNR' }, { label: 'Cleared', value: 'CLR' },
        ],
      },
      { key: 'BusinessUnit', label: 'Business Unit', type: 'text', required: false },
      { key: 'BankAccountName', label: 'Bank Account', type: 'text', required: false },
      { key: 'TransactionType', label: 'Transaction Type', type: 'select', required: false,
        options: [
          { label: 'All', value: '' }, { label: 'EFT', value: 'EFT' },
          { label: 'WIRE', value: 'WIRE' }, { label: 'CHECK', value: 'CHECK' },
        ],
      },
    ],
  },
  // ===== SOAP Sync Objects =====
  {
    id: 'gl-balances-soap',
    name: 'GL Balances (Trial Balance)',
    description: 'Sync GL Balances from Oracle Fusion BI Publisher (SOAP)',
    oracleEndpoint: 'soap/glBalances',
    apexEndpoint: 'gl/balances',
    apiType: 'SOAP',
    soapConfig: {
      reportPath: '/Custom/FA_REPORTS/GL_REPORTS/GL_BALANCES_BIP.xdo',
      environment: 'prod',
    },
    parameters: [
      {
        key: 'P_PERIOD_NAME',
        label: 'Period Name',
        type: 'text',
        required: true,
        placeholder: 'e.g. Dec-25, Jan-26',
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        defaultValue: 'prod',
        options: [
          { label: 'Production', value: 'prod' },
          { label: 'Test', value: 'test' },
        ],
      },
    ],
  },
];

export type ApiType = 'REST' | 'SOAP';
