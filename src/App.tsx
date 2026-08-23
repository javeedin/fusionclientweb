import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import { AuthProvider } from './context/AuthContext';
import { GlValidationProvider } from './context/GlValidationContext';
import SplashScreen from './components/SplashScreen';
import { NotificationProvider } from './context/NotificationContext';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import { ShowAndTellProvider, ShowAndTellOverlay } from './features/showAndTell';
import { UpdateChecker } from './components/UpdateChecker';

// These two load immediately (login + home are always needed)
import Login from './pages/Login';
import Home from './pages/Home';

// All other pages lazy-loaded — only fetched when the user navigates to them
const GLModule                = lazy(() => import('./pages/gl/GLModule'));
const FAModule                = lazy(() => import('./pages/fa/FAModule'));
const ManageAssets            = lazy(() => import('./pages/fa/ManageAssets'));
const CreateAsset             = lazy(() => import('./pages/fa/CreateAsset'));
const Depreciation            = lazy(() => import('./pages/fa/Depreciation'));
const CalculateDeprn          = lazy(() => import('./pages/fa/CalculateDeprn'));
const FARetirements           = lazy(() => import('./pages/fa/Retirements'));
const FAAssetCategories       = lazy(() => import('./pages/fa/setup/ManageCategories'));
const FADeprnMethods          = lazy(() => import('./pages/fa/setup/DeprnMethods'));
const FALocations             = lazy(() => import('./pages/fa/setup/Locations'));
const FABookControls          = lazy(() => import('./pages/fa/setup/BookControls'));
const ManageJournals          = lazy(() => import('./pages/gl/ManageJournals'));
const EditJournal             = lazy(() => import('./pages/gl/EditJournal'));
const CreateJournal           = lazy(() => import('./pages/gl/CreateJournal'));
const AccountAnalysis         = lazy(() => import('./pages/gl/AccountAnalysis'));
const AccountAnalysisV2       = lazy(() => import('./pages/gl/AccountAnalysisV2'));
const ChartOfAccounts         = lazy(() => import('./pages/gl/ChartOfAccounts'));
const ChartOfAccountsEdit     = lazy(() => import('./pages/gl/ChartOfAccountsEdit'));
const ManageStructures        = lazy(() => import('./pages/gl/ManageStructures'));
const EditStructure           = lazy(() => import('./pages/gl/EditStructure'));
const ManageValues            = lazy(() => import('./pages/gl/ManageValues'));
const COASegments             = lazy(() => import('./pages/gl/COASegments'));
const AccountCombinations     = lazy(() => import('./pages/gl/AccountCombinations'));
const AccountingPeriods       = lazy(() => import('./pages/gl/AccountingPeriods'));
const TrialBalance            = lazy(() => import('./pages/gl/TrialBalance'));
const GenerateTrialBalance    = lazy(() => import('./pages/gl/GenerateTrialBalance'));
const IncomeStatementTemplates= lazy(() => import('./pages/gl/IncomeStatementTemplates'));
const Currencies              = lazy(() => import('./pages/gl/Currencies'));
const GLManageCategories      = lazy(() => import('./pages/gl/ManageCategories'));
const JournalReconciliation   = lazy(() => import('./pages/gl/JournalReconciliation'));
const DeleteJournals          = lazy(() => import('./pages/gl/DeleteJournals'));
const ARModule                = lazy(() => import('./pages/ar/ARModule'));
const ARManageInvoices        = lazy(() => import('./pages/ar/ManageInvoices'));
const ARInvoiceDetail         = lazy(() => import('./pages/ar/InvoiceDetail'));
const ARManageReceivables     = lazy(() => import('./pages/ar/ManageReceivables'));
const ARManageReceipts        = lazy(() => import('./pages/ar/ManageReceipts'));
const ARManageAdjustments     = lazy(() => import('./pages/ar/ManageAdjustments'));
const ARManageCreditMemos     = lazy(() => import('./pages/ar/ManageCreditMemos'));
const ARSyncCMApplications    = lazy(() => import('./pages/ar/SyncCMApplications'));
const ARCustomerSiteActivities = lazy(() => import('./pages/ar/CustomerSiteActivities'));
const ARManageCustomers        = lazy(() => import('./pages/ar/ManageCustomers'));
const ARRevenueRecognition     = lazy(() => import('./pages/ar/RevenueRecognition'));
const ManageInvoices          = lazy(() => import('./pages/ap/ManageInvoices'));
const ManageDistCombinations  = lazy(() => import('./pages/ap/ManageDistCombinations'));
const APReports               = lazy(() => import('./pages/ap/APReports'));
const ManagePayments          = lazy(() => import('./pages/ap/ManagePayments'));
const Banks                   = lazy(() => import('./pages/ap/Banks'));
const InvoiceHolds            = lazy(() => import('./pages/ap/InvoiceHolds'));
const ManageSLAJournals       = lazy(() => import('./pages/ap/ManageSLAJournals'));
const CreateAccounting        = lazy(() => import('./pages/ap/CreateAccounting'));
const PrepaymentApplications  = lazy(() => import('./pages/ap/PrepaymentApplications'));
const ManageMultiperiod       = lazy(() => import('./pages/ap/ManageMultiperiod'));
const CheckMigration          = lazy(() => import('./pages/ap/CheckMigration'));
const DownloadInvoiceAttachments = lazy(() => import('./pages/ap/DownloadInvoiceAttachments'));
const APGLReconcile           = lazy(() => import('./pages/ap/APGLReconcile'));
const ManageSuppliers         = lazy(() => import('./pages/suppliers/ManageSuppliers'));
const APManageSuppliers       = lazy(() => import('./pages/ap/APManageSuppliers'));
const ManagePayablesOptions   = lazy(() => import('./pages/ap/setup/ManagePayablesOptions'));
const SupplierBalance         = lazy(() => import('./pages/suppliers/SupplierBalance'));
const ManageOnhandInventory   = lazy(() => import('./pages/inventory/ManageOnhandInventory'));
const Subinventories          = lazy(() => import('./pages/inventory/Subinventories'));
const BusinessUnits           = lazy(() => import('./pages/procurement').then(m => ({ default: m.BusinessUnits })));
const LegalEntities           = lazy(() => import('./pages/procurement').then(m => ({ default: m.LegalEntities })));
const ItemMaster              = lazy(() => import('./pages/inventory/ItemMaster'));
const OrderManagementModule   = lazy(() => import('./pages/orders/OrderManagementModule'));
const ManageSalesOrders       = lazy(() => import('./pages/orders/ManageSalesOrders'));
const SyncData                = lazy(() => import('./pages/sync/SyncData'));
const PettyCash               = lazy(() => import('./pages/pc/PettyCash'));
const APModule                = lazy(() => import('./pages/ap').then(m => ({ default: m.APModule })));
const PMSModule               = lazy(() => import('./pages/pms').then(m => ({ default: m.PMSModule })));
const FundManagement          = lazy(() => import('./pages/pms').then(m => ({ default: m.FundManagement })));
const OrderManagement         = lazy(() => import('./pages/pms').then(m => ({ default: m.OrderManagement })));
const TransactionsPage        = lazy(() => import('./pages/pms').then(m => ({ default: m.TransactionsPage })));
const ClientManagement        = lazy(() => import('./pages/pms').then(m => ({ default: m.ClientManagement })));
const RiskAnalytics           = lazy(() => import('./pages/pms').then(m => ({ default: m.RiskAnalytics })));
const CompliancePage          = lazy(() => import('./pages/pms').then(m => ({ default: m.CompliancePage })));
const ReportsPage             = lazy(() => import('./pages/pms').then(m => ({ default: m.ReportsPage })));
const ModelPortfolioPage      = lazy(() => import('./pages/pms').then(m => ({ default: m.ModelPortfolioPage })));
const FeeManagementPage       = lazy(() => import('./pages/pms').then(m => ({ default: m.FeeManagementPage })));
const BenchmarkComparison     = lazy(() => import('./pages/pms').then(m => ({ default: m.BenchmarkComparison })));
const InvestmentHoldings      = lazy(() => import('./pages/pms/InvestmentHoldings'));
const AIStockAnalysis         = lazy(() => import('./pages/pms/AIStockAnalysis'));
const PMSWatchlist            = lazy(() => import('./pages/pms/Watchlist'));
const PMSPortfolio            = lazy(() => import('./pages/pms/Portfolio'));
const RMModule                = lazy(() => import('./pages/rm').then(m => ({ default: m.RMModule })));
const ManageAgreements        = lazy(() => import('./pages/rm').then(m => ({ default: m.ManageAgreements })));
const ManageProperties        = lazy(() => import('./pages/rm').then(m => ({ default: m.ManageProperties })));
const ManageCustomers         = lazy(() => import('./pages/rm').then(m => ({ default: m.ManageCustomers })));
const ManageExpenses          = lazy(() => import('./pages/rm').then(m => ({ default: m.ManageExpenses })));
const AdminModule             = lazy(() => import('./pages/admin/index'));
const UserManagement          = lazy(() => import('./pages/admin/UserManagement'));
const ClaudeKeySettings       = lazy(() => import('./pages/admin/ClaudeKeySettings'));
const McpRegistry             = lazy(() => import('./pages/admin/McpRegistry'));
const McpCallLogs             = lazy(() => import('./pages/admin/McpCallLogs'));
const RagAssistant            = lazy(() => import('./pages/admin/RagAssistant'));
const GLAccountAnalysis       = lazy(() => import('./modules/admin/GLAccountAnalysis'));
const ApprovalEngine          = lazy(() => import('./pages/admin/ApprovalEngine'));
const BrevoSettings           = lazy(() => import('./pages/admin/BrevoSettings'));
const ManageChangeRequest     = lazy(() => import('./pages/admin/ManageChangeRequest'));
const ReleaseUploader         = lazy(() => import('./pages/admin/ReleaseUploader'));
const MCPServerManager        = lazy(() => import('./pages/admin/MCPServerManager'));
const CashModule              = lazy(() => import('./pages/cash/CashModule'));
const ManageBankTransfers     = lazy(() => import('./pages/cash/ManageBankTransfers'));
const AccountingDebugPage     = lazy(() => import('./pages/cash/AccountingDebugPage'));
const ManageExternalTransactions = lazy(() => import('./pages/cash/ManageExternalTransactions'));
const ManageBankStatements    = lazy(() => import('./pages/cash/ManageBankStatements'));
const BankReconciliation      = lazy(() => import('./pages/cash/BankReconciliation'));
const TransactionCodes        = lazy(() => import('./pages/cash/TransactionCodes'));
const PdfTemplates            = lazy(() => import('./pages/cash/PdfTemplates'));
const ManagePayees            = lazy(() => import('./pages/cash/ManagePayees'));
const ManageTaxes             = lazy(() => import('./pages/tax/ManageTaxes'));
const SupportModule           = lazy(() => import('./pages/support/SupportModule'));
const ManageTickets           = lazy(() => import('./pages/support/ManageTickets'));
const MyTickets               = lazy(() => import('./pages/support/MyTickets'));
const TrainingModule          = lazy(() => import('./pages/training/TrainingModule'));
const OracleFusion            = lazy(() => import('./pages/oracle/OracleFusion'));
const ManageRevaluation       = lazy(() => import('./pages/gl/ManageRevaluation'));
const GLFinancialIntelligence = lazy(() => import('./pages/gl/GLFinancialIntelligence'));
const ProcurementModule       = lazy(() => import('./pages/procurement').then(m => ({ default: m.ProcurementModule })));
const ManagePurchaseOrders    = lazy(() => import('./pages/procurement').then(m => ({ default: m.ManagePurchaseOrders })));
const CreatePurchaseOrder     = lazy(() => import('./pages/procurement').then(m => ({ default: m.CreatePurchaseOrder })));
const ManageExpectedReceipts  = lazy(() => import('./pages/procurement').then(m => ({ default: m.ManageExpectedReceipts })));
const CreateASN               = lazy(() => import('./pages/procurement').then(m => ({ default: m.CreateASN })));
const ManageItemCost          = lazy(() => import('./pages/procurement').then(m => ({ default: m.ManageItemCost })));
const ManageReceiptCost       = lazy(() => import('./pages/procurement').then(m => ({ default: m.ManageReceiptCost })));
const UATDiagnostics          = lazy(() => import('./pages/procurement').then(m => ({ default: m.UATDiagnostics })));
const TrialBalanceLoading     = lazy(() => import('./pages/procurement').then(m => ({ default: m.TrialBalanceLoading })));
const LoginHistory            = lazy(() => import('./pages/procurement').then(m => ({ default: m.LoginHistory })));
const CostManagement          = lazy(() => import('./pages/procurement').then(m => ({ default: m.CostManagement })));
const TransferOrders          = lazy(() => import('./pages/procurement').then(m => ({ default: m.TransferOrders })));
const ManageShipmentLines     = lazy(() => import('./pages/procurement').then(m => ({ default: m.ManageShipmentLines })));
const ConfirmPicks            = lazy(() => import('./pages/procurement').then(m => ({ default: m.ConfirmPicks })));
const ReviewInventoryTransactions = lazy(() => import('./pages/procurement').then(m => ({ default: m.ReviewInventoryTransactions })));
const SalesOrders             = lazy(() => import('./pages/procurement').then(m => ({ default: m.SalesOrders })));
const Customers               = lazy(() => import('./pages/procurement').then(m => ({ default: m.Customers })));
const PriceList               = lazy(() => import('./pages/procurement').then(m => ({ default: m.PriceList })));
const PurchaseOrderLoading    = lazy(() => import('./pages/procurement').then(m => ({ default: m.PurchaseOrderLoading })));
const ItemLoading             = lazy(() => import('./pages/procurement').then(m => ({ default: m.ItemLoading })));
const StockOnhand             = lazy(() => import('./pages/procurement').then(m => ({ default: m.StockOnhand })));
const SupplierReturns         = lazy(() => import('./pages/procurement').then(m => ({ default: m.SupplierReturns })));
const FusionArchitecture      = lazy(() => import('./pages/procurement').then(m => ({ default: m.FusionArchitecture })));
const ParallelRunStrategy     = lazy(() => import('./pages/procurement').then(m => ({ default: m.ParallelRunStrategy })));
const SetupDataExplorer       = lazy(() => import('./pages/procurement').then(m => ({ default: m.SetupDataExplorer })));
const BrowseData              = lazy(() => import('./pages/procurement').then(m => ({ default: m.BrowseData })));

// Placeholder component for modules under development
const ComingSoon = ({ moduleName }: { moduleName: string }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: 'calc(100vh - 64px)',
    background: '#f5f5f5'
  }}>
    <h2 style={{ color: '#1a1a2e' }}>{moduleName}</h2>
    <p style={{ color: '#666' }}>This module is under development</p>
  </div>
);

function App() {
  const [splashDone, setSplashDone] = useState(false);
  const [updateCheckerOpen, setUpdateCheckerOpen] = useState(false);
  const handleSplashDone = useCallback(() => setSplashDone(true), []);

  useEffect(() => {
    if (!(window as any).electronAPI) return;

    const handleOpenUpdateChecker = () => {
      setUpdateCheckerOpen(true);
    };

    (window as any).electronAPI.onOpenUpdateChecker(handleOpenUpdateChecker);

    return () => {
      // Clean up listener on unmount
      (window as any).electronAPI.removeOpenUpdateCheckerListener?.();
    };
  }, []);

  return (
    <>
      {!splashDone && <SplashScreen onDone={handleSplashDone} />}
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
          borderRadius: 6,
        },
      }}
    >
      <AuthProvider>
        <NotificationProvider>
        <GlValidationProvider>
        <HashRouter>
          <ShowAndTellProvider>
          <UpdateChecker open={updateCheckerOpen} onClose={() => setUpdateCheckerOpen(false)} />
          <ShowAndTellOverlay />
          <Suspense fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
              <Spin size="large" />
            </div>
          }>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home" element={<Home />} />
              <Route path="gl" element={<GLModule />} />
              <Route path="gl/manage-journals" element={<ManageJournals />} />
              <Route path="gl/account-analysis" element={<AccountAnalysis />} />
              <Route path="gl/account-analysis-v2" element={<AccountAnalysisV2 />} />
              <Route path="gl/chart-of-accounts" element={<ChartOfAccounts />} />
              <Route path="gl/chart-of-accounts/:id/edit" element={<ChartOfAccountsEdit />} />
              <Route path="gl/manage-structures" element={<ManageStructures />} />
              <Route path="gl/structures/:id/edit" element={<EditStructure />} />
              <Route path="gl/values/:segmentCode" element={<ManageValues />} />
              <Route path="gl/coa-segments" element={<COASegments />} />
              <Route path="gl/journals/:id/edit" element={<EditJournal />} />
              <Route path="gl/batch/:batchId/edit" element={<EditJournal />} />
              <Route path="gl/create-journal" element={<CreateJournal />} />
              <Route path="gl/account-combinations" element={<AccountCombinations />} />
              <Route path="gl/accounting-periods" element={<AccountingPeriods />} />
              <Route path="gl/trial-balance" element={<TrialBalance />} />
              <Route path="gl/generate-trial-balance" element={<GenerateTrialBalance />} />
              <Route path="gl/income-statement-templates" element={<IncomeStatementTemplates />} />
              <Route path="gl/currencies" element={<Currencies />} />
              <Route path="gl/journal-reconciliation" element={<JournalReconciliation />} />
              <Route path="gl/categories" element={<GLManageCategories />} />
              <Route path="gl/delete-journals" element={<DeleteJournals />} />
              <Route path="gl/revaluation" element={<ManageRevaluation />} />
              <Route path="gl/financial-intelligence" element={<GLFinancialIntelligence />} />
              {/* Fixed Assets */}
              <Route path="fa"             element={<FAModule />} />
              <Route path="fa/assets"       element={<ManageAssets />} />
              <Route path="fa/create-asset"  element={<CreateAsset />} />
              <Route path="fa/depreciation"         element={<Depreciation />} />
              <Route path="fa/calculate-deprn"     element={<CalculateDeprn />} />
              <Route path="fa/retirements"          element={<FARetirements />} />
              <Route path="fa/setup/categories"   element={<FAAssetCategories />} />
              <Route path="fa/setup/methods"       element={<FADeprnMethods />} />
              <Route path="fa/setup/locations"     element={<FALocations />} />
              <Route path="fa/setup/book-controls" element={<FABookControls />} />
              <Route path="fa/*"           element={<FAModule />} />
              <Route path="ap" element={<APModule />} />
              <Route path="ap/manage-invoices" element={<ManageInvoices />} />
              <Route path="ap/manage-payments" element={<ManagePayments />} />
              <Route path="ap/banks" element={<Banks />} />
              <Route path="ap/invoice-holds" element={<InvoiceHolds />} />
              <Route path="ap/sla-journals" element={<ManageSLAJournals />} />
              <Route path="ap/create-accounting" element={<CreateAccounting />} />
              <Route path="ap/prepayment-applications" element={<PrepaymentApplications />} />
              <Route path="ap/multiperiod" element={<ManageMultiperiod />} />
              <Route path="ap/check-migration" element={<CheckMigration />} />
              <Route path="ap/gl-reconcile" element={<APGLReconcile />} />
              <Route path="ap/reports" element={<APReports />} />
              <Route path="ap/distribution-combinations" element={<ManageDistCombinations />} />
              <Route path="ap/attachments" element={<DownloadInvoiceAttachments />} />
              <Route path="ap/setup/system-options" element={<ManagePayablesOptions />} />
              <Route path="ap/*" element={<APModule />} />
              <Route path="ar/manage-invoices" element={<ARManageInvoices />} />
              <Route path="ar/invoices/:id" element={<ARInvoiceDetail />} />
              <Route path="ar/manage-receivables" element={<ARManageReceivables />} />
              <Route path="ar/manage-receipts"      element={<ARManageReceipts />} />
              <Route path="ar/manage-adjustments" element={<ARManageAdjustments />} />
              <Route path="ar/manage-credit-memos" element={<ARManageCreditMemos />} />
              <Route path="ar/sync-cm-applications" element={<ARSyncCMApplications />} />
              <Route path="ar/customer-site-activities" element={<ARCustomerSiteActivities />} />
              <Route path="ar/manage-customers" element={<ARManageCustomers />} />
              <Route path="ar/revenue-recognition" element={<ARRevenueRecognition />} />
              <Route path="ar/*" element={<ARModule />} />
              <Route path="inventory/onhand" element={<ManageOnhandInventory />} />
              <Route path="inventory/subinventories" element={<Subinventories />} />
              <Route path="inventory/items" element={<ItemMaster />} />
              <Route path="inventory/*" element={<ComingSoon moduleName="Inventory" />} />
              <Route path="om" element={<OrderManagementModule />} />
              <Route path="om/orders" element={<ManageSalesOrders />} />
              <Route path="om/customers" element={<ComingSoon moduleName="Customers" />} />
              <Route path="om/*" element={<OrderManagementModule />} />
              <Route path="procurement/suppliers" element={<ManageSuppliers />} />
              <Route path="procurement/purchase-orders" element={<ManagePurchaseOrders />} />
              <Route path="procurement/create-po" element={<CreatePurchaseOrder />} />
              <Route path="procurement/business-units" element={<BusinessUnits />} />
              <Route path="procurement/legal-entities" element={<LegalEntities />} />
              <Route path="procurement/expected-receipts" element={<ManageExpectedReceipts />} />
              <Route path="procurement/create-asn" element={<CreateASN />} />
              <Route path="procurement/item-costs" element={<ManageItemCost />} />
              <Route path="procurement/receipt-costs" element={<ManageReceiptCost />} />
              <Route path="procurement/uat" element={<UATDiagnostics />} />
              <Route path="procurement/tb-loading" element={<TrialBalanceLoading />} />
              <Route path="procurement/login-history" element={<LoginHistory />} />
              <Route path="procurement/cost-management" element={<CostManagement />} />
              <Route path="procurement/transfer-orders" element={<TransferOrders />} />
              <Route path="procurement/shipment-lines" element={<ManageShipmentLines />} />
              <Route path="procurement/confirm-picks" element={<ConfirmPicks />} />
              <Route path="procurement/inventory-transactions" element={<ReviewInventoryTransactions />} />
              <Route path="procurement/sales-orders" element={<SalesOrders />} />
              <Route path="procurement/customers" element={<Customers />} />
              <Route path="procurement/price-list" element={<PriceList />} />
              <Route path="procurement/po-loading" element={<PurchaseOrderLoading />} />
              <Route path="procurement/item-loading" element={<ItemLoading />} />
              <Route path="procurement/onhand-loading" element={<StockOnhand />} />
              <Route path="procurement/supplier-returns" element={<SupplierReturns />} />
              <Route path="procurement/architecture" element={<FusionArchitecture />} />
              <Route path="procurement/parallel-run" element={<ParallelRunStrategy />} />
              <Route path="procurement/setup-data/financials" element={<SetupDataExplorer defaultModule="Financials" />} />
              <Route path="procurement/setup-data/supply-chain" element={<SetupDataExplorer defaultModule="Supply Chain" />} />
              <Route path="procurement/setup-data" element={<SetupDataExplorer />} />
              <Route path="procurement/browse-data" element={<BrowseData />} />
              <Route path="ap/suppliers" element={<APManageSuppliers />} />
              <Route path="suppliers/manage" element={<ManageSuppliers />} />
              <Route path="suppliers/balance/:supplierNumber" element={<SupplierBalance />} />
              <Route path="procurement/*" element={<ProcurementModule />} />
              <Route path="hr/*" element={<ComingSoon moduleName="Human Resources" />} />
              <Route path="pms" element={<PMSModule />} />
              <Route path="pms/watchlist" element={<PMSWatchlist />} />
              <Route path="pms/portfolio" element={<PMSPortfolio />} />
              <Route path="pms/funds" element={<FundManagement />} />
              <Route path="pms/orders" element={<OrderManagement />} />
              <Route path="pms/transactions" element={<TransactionsPage />} />
              <Route path="pms/investors" element={<ClientManagement />} />
              <Route path="pms/risk" element={<RiskAnalytics />} />
              <Route path="pms/compliance" element={<CompliancePage />} />
              <Route path="pms/reports" element={<ReportsPage />} />
              <Route path="pms/model-portfolio" element={<ModelPortfolioPage />} />
              <Route path="pms/fees" element={<FeeManagementPage />} />
              <Route path="pms/benchmark" element={<BenchmarkComparison />} />
              <Route path="pms/investment-holdings" element={<InvestmentHoldings />} />
              <Route path="pms/ai-analysis" element={<AIStockAnalysis />} />
              <Route path="pms/*" element={<PMSModule />} />
              {/* Rental Management */}
              <Route path="rm"                  element={<RMModule />} />
              <Route path="rm/agreements"       element={<ManageAgreements />} />
              <Route path="rm/agreements/new"   element={<ManageAgreements />} />
              <Route path="rm/properties"       element={<ManageProperties />} />
              <Route path="rm/customers"        element={<ManageCustomers />} />
              <Route path="rm/expenses"         element={<ManageExpenses />} />
              <Route path="rm/*"                element={<RMModule />} />
              <Route path="projects/*" element={<ComingSoon moduleName="Projects" />} />
              <Route path="manufacturing/*" element={<ComingSoon moduleName="Manufacturing" />} />
              <Route path="reports/*" element={<ComingSoon moduleName="Reports & Analytics" />} />
              <Route path="admin" element={<AdminModule />} />
              <Route path="admin/users" element={<UserManagement />} />
              <Route path="admin/claude-key" element={<ClaudeKeySettings />} />
              <Route path="admin/mcp-registry" element={<McpRegistry />} />
              <Route path="admin/mcp-logs" element={<McpCallLogs />} />
              <Route path="admin/ai-assistant" element={<RagAssistant />} />
              <Route path="admin/gl-account-analysis" element={<GLAccountAnalysis />} />
              <Route path="admin/approvals" element={<ApprovalEngine />} />
              <Route path="admin/brevo-settings" element={<BrevoSettings />} />
              <Route path="admin/releases" element={<ReleaseUploader />} />
              <Route path="admin/change-requests" element={<ManageChangeRequest />} />
              <Route path="admin/mcp-servers" element={<MCPServerManager />} />
              {/* Petty Cash */}
              <Route path="pc/registers" element={<PettyCash />} />
              {/* Cash Management */}
              <Route path="cash" element={<CashModule />} />
              <Route path="cash/bank-transfers" element={<ManageBankTransfers module="cash" />} />
              <Route path="cash/bank-transfers/debug" element={<AccountingDebugPage />} />
              {/* AP Bank Transfers (same page, AP context) */}
              <Route path="ap/bank-transfers" element={<ManageBankTransfers module="ap" />} />
              {/* External Cash Transactions */}
              <Route path="cash/external-transactions" element={<ManageExternalTransactions module="cash" />} />
              {/* Bank Statements */}
              <Route path="cash/bank-statements" element={<ManageBankStatements module="cash" />} />
              {/* Bank Reconciliation */}
              <Route path="cash/bank-reconciliation" element={<BankReconciliation />} />
              <Route path="cash/transaction-codes" element={<TransactionCodes />} />
              <Route path="cash/pdf-templates" element={<PdfTemplates />} />
              <Route path="cash/payees" element={<ManagePayees />} />
              <Route path="setup/taxes" element={<ManageTaxes />} />
              <Route path="ap/external-transactions"   element={<ManageExternalTransactions module="ap" />} />
              <Route path="sync/*" element={<SyncData />} />
              {/* Support / Ticketing */}
              <Route path="support"            element={<SupportModule />} />
              <Route path="support/tickets"   element={<ManageTickets />} />
              <Route path="support/my-tickets" element={<MyTickets />} />
              {/* Training Library */}
              <Route path="training" element={<TrainingModule />} />
              {/* Oracle Fusion WebView */}
              <Route path="oracle-fusion" element={<OracleFusion />} />
            </Route>

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
          </Suspense>
          </ShowAndTellProvider>
        </HashRouter>
        </GlValidationProvider>
        </NotificationProvider>
      </AuthProvider>
    </ConfigProvider>
    </>
  );
}

export default App;
