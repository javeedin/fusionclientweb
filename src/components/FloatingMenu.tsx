import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Typography, Tooltip, Space, Button, Form, Input, Select, DatePicker, Modal, InputNumber, message, Table, Tag, Checkbox } from 'antd';
import {
  WalletOutlined,
  CheckSquareOutlined,
  BarChartOutlined,
  SearchOutlined,
  ReconciliationOutlined,
  CloseOutlined,
  FileTextOutlined,
  FileAddOutlined,
  FolderOutlined,
  ScheduleOutlined,
  SwapOutlined,
  CheckCircleOutlined,
  AuditOutlined,
  ImportOutlined,
  ExceptionOutlined,
  WarningOutlined,
  BookOutlined,
  FileSearchOutlined,
  PieChartOutlined,
  CalendarOutlined,
  DollarOutlined,
  CreditCardOutlined,
  FileDoneOutlined,
  PrinterOutlined,
  SafetyOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  BankOutlined,
  ReloadOutlined,
  ApiOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleFilled,
  LoadingOutlined,
  EyeInvisibleOutlined,
  RightOutlined,
  CloudDownloadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { APEX_DB_CONFIG } from '../config/api.config';

const { Text, Title } = Typography;
const { Option } = Select;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  taskBlue: '#0572CE',
  reportGreen: '#1D7B4D',
  searchPurple: '#6B4C9A',
  matchOrange: '#D4A800',
};

const APEX_SUPPLIERS_URL = `${APEX_DB_CONFIG.baseUrl}/suppliers`;

// Supplier record for quick-create dialog
interface QuickCreateSupplier {
  key: string;
  supplierId: number;
  supplier: string;
  supplierNumber: string;
  alternativeName: string;
  status: string;
}

// Menu item type
interface MenuItemType {
  key: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  color?: string;
  path?: string;
}

// Task items
const invoiceTaskItems: MenuItemType[] = [
  { key: 'create-invoice', icon: <FileAddOutlined />, label: 'Create Payable Invoice', description: 'Create new supplier invoice', color: REDWOOD.taskBlue },
  { key: 'create-invoice-spreadsheet', icon: <ImportOutlined />, label: 'Create Invoice from Spreadsheet', description: 'Import invoices from file', color: REDWOOD.info },
  { key: 'create-recurring', icon: <ScheduleOutlined />, label: 'Create Recurring Invoices', description: 'Set up recurring invoices', color: REDWOOD.success },
  { key: 'manage-invoices', icon: <FileTextOutlined />, label: 'Manage Invoices', description: 'Search and manage invoices', color: REDWOOD.primary, path: '/ap/manage-invoices' },
  { key: 'apply-conversion-rates', icon: <SwapOutlined />, label: 'Apply Missing Conversion Rates', description: 'Update currency rates', color: REDWOOD.warning },
  { key: 'validate-invoices', icon: <CheckCircleOutlined />, label: 'Validate Invoices', description: 'Validate invoice entries', color: REDWOOD.success },
  { key: 'initiate-approval', icon: <AuditOutlined />, label: 'Initiate Approval Workflow', description: 'Start approval process', color: REDWOOD.info },
  { key: 'import-invoices', icon: <ImportOutlined />, label: 'Import Invoices', description: 'Batch import invoices', color: REDWOOD.taskBlue },
  { key: 'correct-import-errors', icon: <ExceptionOutlined />, label: 'Correct Import Errors', description: 'Fix import issues', color: REDWOOD.primary },
  { key: 'payables-exceptions', icon: <WarningOutlined />, label: 'Run Payables Exceptions Listing', description: 'Review exceptions', color: REDWOOD.warning },
];

const accountingTaskItems: MenuItemType[] = [
  { key: 'create-accounting', icon: <BookOutlined />, label: 'Create Accounting', description: 'Generate accounting entries', color: REDWOOD.taskBlue },
  { key: 'create-adjustment', icon: <ReconciliationOutlined />, label: 'Create Adjustment Journal', description: 'Create adjustments', color: REDWOOD.info },
  { key: 'review-journal-entries', icon: <FileSearchOutlined />, label: 'Review Journal Entries', description: 'Review posted journals', color: REDWOOD.success },
  { key: 'payables-reconciliation', icon: <ReconciliationOutlined />, label: 'Payables to Ledger Reconciliation', description: 'Reconcile with GL', color: REDWOOD.warning },
];

const assetsTaskItems: MenuItemType[] = [
  { key: 'create-mass-additions', icon: <PieChartOutlined />, label: 'Create Mass Additions', description: 'Add assets in bulk', color: REDWOOD.primary },
];

const periodsTaskItems: MenuItemType[] = [
  { key: 'manage-periods', icon: <CalendarOutlined />, label: 'Manage Accounting Periods', description: 'Open/close periods', color: REDWOOD.info },
];

const paymentTaskItems: MenuItemType[] = [
  { key: 'manage-payments', icon: <DollarOutlined />, label: 'Manage Payments', description: 'Search and manage payments', color: REDWOOD.taskBlue, path: '/ap/manage-payments' },
  { key: 'submit-payment-request', icon: <SendOutlined />, label: 'Submit Payment Process Request', description: 'Initiate payment run', color: REDWOOD.info, path: '/ap/submit-payment' },
  { key: 'manage-payment-templates', icon: <SettingOutlined />, label: 'Manage Payment Process Request Templates', description: 'Configure templates', color: REDWOOD.success },
  { key: 'create-payment', icon: <CreditCardOutlined />, label: 'Create Payment', description: 'Create single payment', color: REDWOOD.primary, path: '/ap/create-payment' },
  { key: 'create-electronic-files', icon: <FileDoneOutlined />, label: 'Create Electronic Payment Files', description: 'Generate EFT files', color: REDWOOD.taskBlue },
  { key: 'create-printed-files', icon: <PrinterOutlined />, label: 'Create Printed Payment Files', description: 'Generate check files', color: REDWOOD.info },
  { key: 'manage-payment-files', icon: <FolderOutlined />, label: 'Manage Payment Files', description: 'View payment files', color: REDWOOD.success },
  { key: 'apply-payment-rates', icon: <SwapOutlined />, label: 'Apply Missing Conversion Rates', description: 'Update currency rates', color: REDWOOD.warning },
  { key: 'create-positive-pay', icon: <SafetyOutlined />, label: 'Create Positive Pay File', description: 'Generate positive pay', color: REDWOOD.primary },
  { key: 'send-remittance', icon: <SendOutlined />, label: 'Send Separate Remittance Advice', description: 'Email remittance', color: REDWOOD.taskBlue },
  { key: 'regulatory-reporting', icon: <AuditOutlined />, label: 'Create Regulatory Reporting', description: 'Generate reports', color: REDWOOD.info },
  { key: 'payment-letter', icon: <FileTextOutlined />, label: 'Payment File Accompanying Letter', description: 'Create cover letters', color: REDWOOD.success },
  { key: 'retrieve-acknowledgments', icon: <CheckCircleOutlined />, label: 'Retrieve Disbursement Acknowledgments', description: 'Get bank responses', color: REDWOOD.warning },
];

const setupItems: MenuItemType[] = [
  { key: 'banks', icon: <BankOutlined />, label: 'Banks', description: 'Manage banks, branches & accounts', color: REDWOOD.info, path: '/ap/banks' },
  { key: 'suppliers', icon: <FileTextOutlined />, label: 'Suppliers', description: 'Manage supplier master data', color: REDWOOD.success, path: '/ap/suppliers' },
  { key: 'payment-terms', icon: <CalendarOutlined />, label: 'Payment Terms', description: 'Configure payment terms', color: REDWOOD.warning },
  { key: 'payment-methods', icon: <CreditCardOutlined />, label: 'Payment Methods', description: 'Setup payment methods', color: REDWOOD.primary },
  { key: 'invoice-holds', icon: <StopOutlined />, label: 'Manage Invoice Holds', description: 'View and manage invoice hold codes', color: REDWOOD.primary, path: '/ap/invoice-holds' },
];

const pettyCashItems: MenuItemType[] = [
  { key: 'petty-cash-registers', icon: <WalletOutlined />, label: 'Petty Cash Registers', description: 'Manage petty cash registers and transactions', color: REDWOOD.success, path: '/pc/registers' },
];

const administrationItems: MenuItemType[] = [
  { key: 'attachments', icon: <CloudDownloadOutlined />, label: 'Attachments', description: 'Download invoice attachments from Oracle Fusion in bulk', color: '#722ed1', path: '/ap/attachments' },
];

const arTaskItems: MenuItemType[] = [
  { key: 'ar-manage-customers',    icon: <UserOutlined />,     label: 'Manage Customers',        description: 'Search customers and view activity', color: REDWOOD.info,     path: '/ar/manage-customers' },
  { key: 'ar-manage-receipts',     icon: <DollarOutlined />,   label: 'Manage Receipts',          description: 'Search and manage AR receipts',      color: REDWOOD.success,  path: '/ar/manage-receipts' },
  { key: 'ar-manage-receivables',  icon: <FileTextOutlined />, label: 'Manage Receivables',       description: 'View AR invoices and balances',       color: REDWOOD.primary,  path: '/ar/manage-receivables' },
  { key: 'ar-customer-activities', icon: <BankOutlined />,     label: 'Customer Site Activities', description: 'Customer site-level AR summary',      color: '#722ed1',         path: '/ar/customer-site-activities' },
];

const supplyChainItems: MenuItemType[] = [
  { key: 'sc-purchase-orders', icon: <FileTextOutlined />, label: 'Manage Purchase Orders', description: 'Search and manage purchase orders', color: REDWOOD.info, path: '/sc/purchase-orders' },
  { key: 'sc-purchase-requisitions', icon: <FileAddOutlined />, label: 'Purchase Requisitions', description: 'Create and manage requisitions', color: REDWOOD.taskBlue, path: '/sc/requisitions' },
  { key: 'sc-receipts', icon: <CheckCircleOutlined />, label: 'Manage Receipts', description: 'Record and manage receipts', color: REDWOOD.success, path: '/sc/receipts' },
  { key: 'sc-suppliers', icon: <FileTextOutlined />, label: 'Suppliers', description: 'Manage supplier master data', color: REDWOOD.primary, path: '/sc/suppliers' },
  { key: 'sc-shipments', icon: <SendOutlined />, label: 'Manage Shipments', description: 'Track and manage shipments', color: REDWOOD.warning, path: '/sc/shipments' },
  { key: 'sc-returns', icon: <SwapOutlined />, label: 'Manage Returns', description: 'Process returns and exchanges', color: REDWOOD.neutral600, path: '/sc/returns' },
  { key: 'sc-inventory', icon: <PieChartOutlined />, label: 'Inventory Management', description: 'View and manage inventory levels', color: REDWOOD.info, path: '/sc/inventory' },
  { key: 'sc-catalog', icon: <FolderOutlined />, label: 'Item Catalog', description: 'Manage product and item catalog', color: REDWOOD.success, path: '/sc/catalog' },
];

const taskSections = [
  { key: 'ar', label: 'Accounts Receivable', items: arTaskItems },
  { key: 'invoices', label: 'Invoices', items: invoiceTaskItems },
  { key: 'accounting', label: 'Accounting', items: accountingTaskItems },
  { key: 'petty-cash', label: 'Petty Cash', items: pettyCashItems },
  { key: 'assets', label: 'Assets', items: assetsTaskItems },
  { key: 'periods', label: 'Payables Periods', items: periodsTaskItems },
  { key: 'payments', label: 'Payments', items: paymentTaskItems },
  { key: 'supply-chain', label: 'Supply Chain', items: supplyChainItems },
  { key: 'setup', label: 'Setup & Maintenance', items: setupItems },
  { key: 'administration', label: 'Administration', items: administrationItems },
];

// FloatingIcon sub-component
const FloatingIcon = ({
  icon,
  label,
  color,
  isActive,
  onClick,
  position,
  panelOpen,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  isActive: boolean;
  onClick: () => void;
  position: 'first' | 'middle' | 'last';
  panelOpen: boolean;
}) => {
  const getBorderRadius = () => {
    if (panelOpen) {
      if (position === 'first') return '8px 0 0 0';
      if (position === 'last') return '0 0 0 8px';
      return '0';
    } else {
      if (position === 'first') return '8px 8px 0 0';
      if (position === 'last') return '0 0 8px 8px';
      return '0';
    }
  };

  return (
    <Tooltip title={!isActive ? label : ''} placement="left">
      <div
        onClick={onClick}
        style={{
          width: 40,
          height: 40,
          borderRadius: getBorderRadius(),
          background: isActive ? color : REDWOOD.surface,
          border: `2px solid ${panelOpen ? REDWOOD.neutral200 : color}`,
          borderBottom: position !== 'last' ? 'none' : `2px solid ${panelOpen ? REDWOOD.neutral200 : color}`,
          borderTop: position !== 'first' ? 'none' : `2px solid ${panelOpen ? REDWOOD.neutral200 : color}`,
          borderRight: panelOpen ? 'none' : `2px solid ${color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          boxShadow: isActive ? `0 4px 12px ${color}40` : (panelOpen ? 'none' : '0 2px 8px rgba(0,0,0,0.1)'),
          color: isActive ? '#fff' : color,
          fontSize: 18,
        }}
      >
        {icon}
      </div>
    </Tooltip>
  );
};

// API endpoint status type
type EndpointStatus = 'idle' | 'checking' | 'ok' | 'error';

interface EndpointInfo {
  key: string;
  label: string;
  url: string;
  method: 'GET' | 'POST';
  status: EndpointStatus;
  statusCode?: number;
  latency?: number;
}

// Build endpoint list from api.config
const buildEndpoints = (): EndpointInfo[] =>
  Object.entries(APEX_DB_CONFIG.endpoints).map(([key, path]) => ({
    key,
    label: key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim(),
    url: `${APEX_DB_CONFIG.baseUrl}/${path}`,
    method: path.includes('create') || path.includes('post') || path.includes('error') ? 'POST' : 'GET',
    status: 'idle',
  }));

const FloatingMenu: React.FC = () => {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<'none' | 'tasks' | 'search' | 'reports' | 'match' | 'api'>('none');
  const [isClosing, setIsClosing] = useState(false);
  const [menuHidden, setMenuHidden] = useState<boolean>(() => localStorage.getItem('floatingMenuHidden') === 'true');

  const toggleMenuVisibility = () => {
    const next = !menuHidden;
    setMenuHidden(next);
    localStorage.setItem('floatingMenuHidden', String(next));
    if (next) closePanel();
  };
  const [selectedTaskSection, setSelectedTaskSection] = useState<string>('invoices');
  const panelRef = useRef<HTMLDivElement>(null);
  const floatingIconsRef = useRef<HTMLDivElement>(null);
  const [searchForm] = Form.useForm();
  const [matchForm] = Form.useForm();
  const [quickCreateForm] = Form.useForm();

  // API panel state
  const [endpoints, setEndpoints] = useState<EndpointInfo[]>(buildEndpoints);
  const [pingAll, setPingAll] = useState(false);

  const checkEndpoint = async (ep: EndpointInfo): Promise<Partial<EndpointInfo>> => {
    const start = Date.now();
    try {
      const res = await fetch(ep.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      return { status: res.ok || res.status === 400 ? 'ok' : 'error', statusCode: res.status, latency: Date.now() - start };
    } catch {
      return { status: 'error', latency: Date.now() - start };
    }
  };

  const handlePingAll = async () => {
    setPingAll(true);
    setEndpoints((prev) => prev.map((ep) => ({ ...ep, status: 'checking' })));
    const updated = await Promise.all(
      endpoints.map(async (ep) => ({ ...ep, ...(await checkEndpoint(ep)) }))
    );
    setEndpoints(updated as EndpointInfo[]);
    setPingAll(false);
  };

  const handlePingOne = async (key: string) => {
    setEndpoints((prev) => prev.map((ep) => ep.key === key ? { ...ep, status: 'checking' } : ep));
    const ep = endpoints.find((e) => e.key === key)!;
    const result = await checkEndpoint(ep);
    setEndpoints((prev) => prev.map((e) => e.key === key ? { ...e, ...result } : e));
  };

  // Quick Create Invoice dialog state
  const [quickCreateVisible, setQuickCreateVisible] = useState(false);
  const [supplierModalVisible, setSupplierModalVisible] = useState(false);
  const [qcSuppliers, setQcSuppliers] = useState<QuickCreateSupplier[]>([]);
  const [qcSupplierLoading, setQcSupplierLoading] = useState(false);
  const [qcSupplierSearch, setQcSupplierSearch] = useState('');

  // Global Search panel state
  const [globalSearchTerm, setGlobalSearchTerm] = useState('');
  const [openInNewTab, setOpenInNewTab] = useState(localStorage.getItem('floatingMenuOpenInNewTab') === 'true');

  // Fetch suppliers for quick-create
  const fetchQcSuppliers = async () => {
    setQcSupplierLoading(true);
    try {
      const response = await fetch(APEX_SUPPLIERS_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const items = data.items || data || [];
      if (Array.isArray(items)) {
        setQcSuppliers(
          items.map((item: any, index: number) => ({
            key: item.supplier_id?.toString() || index.toString(),
            supplierId: item.supplier_id,
            supplier: item.supplier || '',
            supplierNumber: item.supplier_number || '',
            alternativeName: item.alternate_name || '',
            status: item.status || '',
          }))
        );
      }
    } catch (error) {
      console.error('Supplier fetch error:', error);
      message.error('Failed to fetch suppliers');
    } finally {
      setQcSupplierLoading(false);
    }
  };

  const filteredQcSuppliers = useMemo(() => {
    if (!qcSupplierSearch) return qcSuppliers;
    const search = qcSupplierSearch.toLowerCase();
    return qcSuppliers.filter(
      (s) =>
        s.supplier.toLowerCase().includes(search) ||
        s.supplierNumber.toLowerCase().includes(search) ||
        (s.alternativeName && s.alternativeName.toLowerCase().includes(search))
    );
  }, [qcSuppliers, qcSupplierSearch]);

  const qcSupplierColumns: ColumnsType<QuickCreateSupplier> = [
    { title: 'Number', dataIndex: 'supplierNumber', key: 'supplierNumber', width: 100, sorter: (a, b) => a.supplierNumber.localeCompare(b.supplierNumber) },
    { title: 'Supplier Name', dataIndex: 'supplier', key: 'supplier', width: 250, ellipsis: true, sorter: (a, b) => a.supplier.localeCompare(b.supplier) },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 80, render: (status: string) => <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>{status}</Tag> },
    {
      title: 'Action', key: 'action', width: 70,
      render: (_: any, record: QuickCreateSupplier) => (
        <Button type="link" size="small" style={{ color: REDWOOD.info }} onClick={() => {
          quickCreateForm.setFieldsValue({ supplier: record.supplier, supplierNumber: record.supplierNumber });
          setSupplierModalVisible(false);
        }}>Select</Button>
      ),
    },
  ];

  const openQuickCreate = () => {
    closePanel();
    setQuickCreateVisible(true);
    quickCreateForm.resetFields();
  };

  const handleQuickCreateSubmit = () => {
    quickCreateForm.validateFields().then((values) => {
      setQuickCreateVisible(false);
      // Navigate to ManageInvoices with quick-create data
      navigate('/ap/manage-invoices', {
        state: {
          quickCreate: true,
          quickCreateData: {
            supplier: values.supplier,
            supplierNumber: values.supplierNumber,
            invoiceNumber: values.invoiceNumber,
            invoiceAmount: values.amount,
            invoiceDate: values.invoiceDate,
            description: values.description,
            taxCode: values.taxCode,
            includingTax: values.includingTax || false,
          },
        },
      });
    }).catch(() => {
      message.error('Please fill in all required fields');
    });
  };

  const getPanelWidth = () => {
    if (activePanel === 'match') return 360;
    if (activePanel === 'api') return 400;
    if (activePanel === 'search') return 360;
    if (activePanel === 'tasks') return 320;
    if (activePanel === 'reports') return 320;
    return 0;
  };

  const getCurrentSectionItems = () => {
    const section = taskSections.find(s => s.key === selectedTaskSection);
    return section?.items || [];
  };

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isOutsidePanel = panelRef.current && !panelRef.current.contains(target);
      const isOutsideFloatingIcons = floatingIconsRef.current && !floatingIconsRef.current.contains(target);
      const isDropdownClick = target.closest('.ant-select-dropdown') ||
                              target.closest('.ant-picker-dropdown') ||
                              target.closest('.ant-dropdown') ||
                              target.closest('.ant-modal-root');

      if (isOutsidePanel && isOutsideFloatingIcons && !isDropdownClick) {
        closePanel();
      }
    };

    if (activePanel !== 'none') {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activePanel]);

  const closePanel = () => {
    setIsClosing(true);
    setTimeout(() => {
      setActivePanel('none');
      setIsClosing(false);
    }, 250);
  };

  const handleMenuItemClick = (key: string, path?: string) => {
    if (key === 'create-invoice') {
      openQuickCreate();
      return;
    }
    closePanel();
    if (path) {
      if (openInNewTab) {
        window.open(path, '_blank');
      } else {
        navigate(path);
      }
    }
  };

  const togglePanel = (panel: 'tasks' | 'search' | 'reports' | 'match' | 'api') => {
    if (activePanel === panel) {
      closePanel();
    } else {
      setIsClosing(false);
      setActivePanel(panel);
    }
  };

  // Task Menu Item
  const TaskMenuItem = ({ item }: { item: MenuItemType }) => (
    <div
      onClick={() => handleMenuItemClick(item.key, item.path)}
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        transition: 'all 0.2s ease',
        marginBottom: 4,
        background: REDWOOD.surface,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = REDWOOD.neutral100; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = REDWOOD.surface; }}
    >
      <div style={{ color: REDWOOD.taskBlue, fontSize: 12 }}>{item.icon}</div>
      <Text style={{ fontSize: 12, color: REDWOOD.neutral900 }}>{item.label}</Text>
    </div>
  );

  const panelBaseStyle: React.CSSProperties = {
    position: 'fixed',
    right: 0,
    top: 64,
    bottom: 0,
    background: REDWOOD.surface,
    boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
    overflow: 'hidden',
    animation: isClosing ? 'slideOut 0.25s ease-in forwards' : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
    zIndex: 1001,
    display: 'flex',
    flexDirection: 'column',
  };

  // Tasks Slide Panel
  const TasksSlidePanel = () => (
    <div style={{ ...panelBaseStyle, width: 320 }}>
      <div style={{ padding: '10px 14px', background: REDWOOD.taskBlue, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <Text strong style={{ color: '#fff', fontSize: 14 }}>Tasks</Text>
        <CloseOutlined style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }} onClick={closePanel} />
      </div>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
        <Select value={selectedTaskSection} onChange={setSelectedTaskSection} style={{ width: '100%' }} size="middle">
          {taskSections.map(section => (
            <Option key={section.key} value={section.key}>{section.label}</Option>
          ))}
        </Select>
      </div>
      <div style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
        {getCurrentSectionItems().map((item) => (
          <TaskMenuItem key={item.key} item={item} />
        ))}
      </div>
    </div>
  );

  // Get all searchable menu items
  const getAllMenuItems = useMemo(() => {
    const allItems: (MenuItemType & { section: string })[] = [];
    taskSections.forEach(section => {
      section.items.forEach(item => {
        allItems.push({ ...item, section: section.label });
      });
    });
    return allItems;
  }, []);

  // Filter menu items based on search term
  const filteredMenuItems = useMemo(() => {
    if (!globalSearchTerm.trim()) return getAllMenuItems;
    const search = globalSearchTerm.toLowerCase();
    return getAllMenuItems.filter(item =>
      item.label.toLowerCase().includes(search) ||
      item.description?.toLowerCase().includes(search) ||
      item.section.toLowerCase().includes(search) ||
      item.key.toLowerCase().includes(search)
    );
  }, [globalSearchTerm, getAllMenuItems]);

  // Search Slide Panel
  const SearchSlidePanel = () => (
    <div style={{ ...panelBaseStyle, width: 360 }}>
      <div style={{ padding: '10px 14px', background: REDWOOD.searchPurple, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <Text strong style={{ color: '#fff', fontSize: 14 }}>Search Menu</Text>
        <CloseOutlined style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }} onClick={closePanel} />
      </div>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          placeholder="Search menu items..."
          prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
          value={globalSearchTerm}
          onChange={(e) => setGlobalSearchTerm(e.target.value)}
          size="small"
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ padding: '8px 14px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox
          checked={openInNewTab}
          onChange={(e) => {
            const newValue = e.target.checked;
            setOpenInNewTab(newValue);
            localStorage.setItem('floatingMenuOpenInNewTab', String(newValue));
          }}
        />
        <Text style={{ fontSize: 12 }}>Open in New Tab</Text>
      </div>
      <div style={{ padding: 8, flex: 1, overflowY: 'auto' }}>
        {filteredMenuItems.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>No menu items found</Text>
          </div>
        ) : (
          <div>
            <Text type="secondary" style={{ fontSize: 11, padding: '0 8px', display: 'block', marginBottom: 8 }}>
              Found {filteredMenuItems.length} items
            </Text>
            {filteredMenuItems.map((item) => (
              <div
                key={item.key}
                onClick={() => handleMenuItemClick(item.key, item.path)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  cursor: item.path ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  transition: 'all 0.2s ease',
                  marginBottom: 6,
                  background: REDWOOD.surface,
                  borderLeft: `3px solid ${item.color || REDWOOD.neutral300}`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = REDWOOD.neutral100; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = REDWOOD.surface; }}
              >
                <div style={{ color: item.color || REDWOOD.neutral600, fontSize: 14, flexShrink: 0, marginTop: 2 }}>{item.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12, fontWeight: 500, color: REDWOOD.neutral900, display: 'block' }}>{item.label}</Text>
                  {item.description && (
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>{item.description}</Text>
                  )}
                  <Text style={{ fontSize: 10, color: REDWOOD.neutral300, display: 'block', marginTop: 2 }}>{item.section}</Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Reports Slide Panel
  const ReportsSlidePanel = () => (
    <div style={{ ...panelBaseStyle, width: 320 }}>
      <div style={{ padding: '10px 14px', background: REDWOOD.reportGreen, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <Space>
          <Button size="small" icon={<FileAddOutlined />} style={{ fontSize: 11 }}>Create</Button>
        </Space>
        <CloseOutlined style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }} onClick={closePanel} />
      </div>
      <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
        <div style={{ marginBottom: 8 }}>
          <Space>
            <FolderOutlined style={{ color: REDWOOD.matchOrange }} />
            <Text style={{ fontSize: 13, color: REDWOOD.info, cursor: 'pointer' }}>My Folders</Text>
          </Space>
        </div>
        <div>
          <Space>
            <FolderOutlined style={{ color: REDWOOD.matchOrange }} />
            <Text style={{ fontSize: 13, color: REDWOOD.info, cursor: 'pointer' }}>Shared Reports and Analytics</Text>
          </Space>
        </div>
      </div>
    </div>
  );

  // Match in Full Slide Panel
  const MatchSlidePanel = () => (
    <div style={{ ...panelBaseStyle, width: 360 }}>
      <div style={{ padding: '10px 14px', background: REDWOOD.matchOrange, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <Text strong style={{ color: '#fff', fontSize: 14 }}>Match in Full</Text>
        <CloseOutlined style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }} onClick={closePanel} />
      </div>
      <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
        <Title level={5} style={{ marginBottom: 16, textAlign: 'center' }}>Match in Full</Title>
        <Form form={matchForm} layout="horizontal" size="small" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }}>
          <Form.Item label={<Text style={{ fontSize: 12 }}><span style={{ color: REDWOOD.primary }}>*</span> Purchase Order</Text>} name="purchaseOrder" required>
            <Input suffix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />} />
          </Form.Item>
          <Form.Item label={<Text style={{ fontSize: 12 }}>Business Unit</Text>} name="businessUnit">
            <Input disabled style={{ background: REDWOOD.neutral100 }} />
          </Form.Item>
          <Form.Item label={<Text style={{ fontSize: 12 }}>Supplier</Text>} name="supplier">
            <Input disabled style={{ background: REDWOOD.neutral100 }} />
          </Form.Item>
          <Form.Item label={<Text style={{ fontSize: 12 }}>Site</Text>} name="site">
            <Select placeholder="Select site" allowClear>
              <Option value="site1">Site 1</Option>
              <Option value="site2">Site 2</Option>
            </Select>
          </Form.Item>
          <Form.Item label={<Text style={{ fontSize: 12 }}>Invoice Number</Text>} name="invoiceNumber">
            <Input />
          </Form.Item>
          <Form.Item label={<Text style={{ fontSize: 12 }}>Date</Text>} name="date">
            <DatePicker format="DD-MMM-YYYY" style={{ width: '100%' }} placeholder="dd-mmm-yyyy" />
          </Form.Item>
          <Form.Item label={<Text style={{ fontSize: 12 }}>Total</Text>} name="total">
            <Input disabled style={{ background: REDWOOD.neutral100 }} />
          </Form.Item>
          <Form.Item style={{ marginTop: 24, marginBottom: 0 }} wrapperCol={{ offset: 10, span: 14 }}>
            <Space>
              <Button type="primary" style={{ background: REDWOOD.primary }}>Create Invoice</Button>
              <Button onClick={() => matchForm.resetFields()}>Reset</Button>
            </Space>
          </Form.Item>
        </Form>
      </div>
    </div>
  );

  // Status icon helper
  const StatusIcon = ({ status }: { status: EndpointStatus }) => {
    if (status === 'checking') return <LoadingOutlined style={{ color: '#888' }} spin />;
    if (status === 'ok')    return <CheckCircleFilled style={{ color: REDWOOD.success }} />;
    if (status === 'error') return <CloseCircleFilled style={{ color: REDWOOD.primary }} />;
    return <MinusCircleFilled style={{ color: REDWOOD.neutral300 }} />;
  };

  // API Services Slide Panel
  const ApiSlidePanel = () => {
    const okCount    = endpoints.filter((e) => e.status === 'ok').length;
    const errorCount = endpoints.filter((e) => e.status === 'error').length;
    const idleCount  = endpoints.filter((e) => e.status === 'idle').length;

    return (
      <div style={{ ...panelBaseStyle, width: 400 }}>
        {/* Header */}
        <div style={{ padding: '10px 14px', background: '#1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <Space>
            <ApiOutlined style={{ color: '#4fc3f7', fontSize: 16 }} />
            <Text strong style={{ color: '#fff', fontSize: 14 }}>API Services</Text>
          </Space>
          <CloseOutlined style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }} onClick={closePanel} />
        </div>

        {/* Base URL */}
        <div style={{ padding: '8px 14px', background: '#0d1117', borderBottom: '1px solid #30363d' }}>
          <Text style={{ fontSize: 10, color: '#8b949e', display: 'block', marginBottom: 2 }}>BASE URL</Text>
          <Text style={{ fontSize: 11, color: '#58a6ff', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {APEX_DB_CONFIG.baseUrl}
          </Text>
        </div>

        {/* Summary strip */}
        <div style={{ padding: '8px 14px', background: '#161b22', borderBottom: '1px solid #30363d', display: 'flex', gap: 16 }}>
          <Space size={4}><CheckCircleFilled style={{ color: REDWOOD.success, fontSize: 12 }} /><Text style={{ fontSize: 12, color: '#c9d1d9' }}>{okCount} OK</Text></Space>
          <Space size={4}><CloseCircleFilled style={{ color: REDWOOD.primary, fontSize: 12 }} /><Text style={{ fontSize: 12, color: '#c9d1d9' }}>{errorCount} Error</Text></Space>
          <Space size={4}><MinusCircleFilled style={{ color: REDWOOD.neutral300, fontSize: 12 }} /><Text style={{ fontSize: 12, color: '#c9d1d9' }}>{idleCount} Not tested</Text></Space>
          <div style={{ marginLeft: 'auto' }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={pingAll}
              onClick={handlePingAll}
              style={{ fontSize: 11, background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9' }}
            >
              Ping All
            </Button>
          </div>
        </div>

        {/* Endpoint list */}
        <div style={{ flex: 1, overflowY: 'auto', background: '#0d1117' }}>
          {endpoints.map((ep) => (
            <div
              key={ep.key}
              style={{
                padding: '8px 14px',
                borderBottom: '1px solid #21262d',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {/* Method badge */}
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                fontFamily: 'monospace',
                padding: '1px 5px',
                borderRadius: 3,
                background: ep.method === 'GET' ? '#1f6feb' : '#388bfd22',
                color: ep.method === 'GET' ? '#fff' : '#58a6ff',
                border: ep.method === 'POST' ? '1px solid #388bfd' : 'none',
                flexShrink: 0,
                width: 34,
                textAlign: 'center',
              }}>
                {ep.method}
              </span>

              {/* Endpoint path */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 500, display: 'block' }}>{ep.label}</Text>
                <Text style={{ fontSize: 10, color: '#8b949e', fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  /{ep.url.replace(APEX_DB_CONFIG.baseUrl + '/', '')}
                </Text>
              </div>

              {/* Latency */}
              {ep.latency !== undefined && (
                <Text style={{ fontSize: 10, color: ep.latency < 500 ? REDWOOD.success : REDWOOD.warning, flexShrink: 0 }}>
                  {ep.latency}ms
                </Text>
              )}

              {/* Status + ping button */}
              <Tooltip title={ep.statusCode ? `HTTP ${ep.statusCode}` : ep.status}>
                <span style={{ cursor: 'pointer' }} onClick={() => handlePingOne(ep.key)}>
                  <StatusIcon status={ep.status} />
                </span>
              </Tooltip>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Restore tab — shown only when menu is hidden */}
      {menuHidden && (
        <Tooltip title="Show floating menu" placement="left">
          <div
            onClick={toggleMenuVisibility}
            style={{
              position: 'fixed',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1002,
              width: 16,
              height: 56,
              background: REDWOOD.neutral300,
              borderRadius: '6px 0 0 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background 0.2s',
              color: REDWOOD.neutral600,
              fontSize: 10,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = REDWOOD.neutral600; (e.currentTarget as HTMLDivElement).style.color = '#fff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = REDWOOD.neutral300; (e.currentTarget as HTMLDivElement).style.color = REDWOOD.neutral600; }}
          >
            <RightOutlined style={{ fontSize: 8 }} />
          </div>
        </Tooltip>
      )}

      {/* Floating Connected Icons */}
      {!menuHidden && (
      <div
        ref={floatingIconsRef}
        style={{
          position: 'fixed',
          right: activePanel !== 'none' && !isClosing ? getPanelWidth() : 24,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1002,
          display: 'flex',
          flexDirection: 'column',
          transition: 'right 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <FloatingIcon
          icon={<CheckSquareOutlined />}
          label="Tasks"
          color={REDWOOD.taskBlue}
          isActive={activePanel === 'tasks'}
          onClick={() => togglePanel('tasks')}
          position="first"
          panelOpen={activePanel !== 'none' && !isClosing}
        />
        <FloatingIcon
          icon={<SearchOutlined />}
          label="Search"
          color={REDWOOD.searchPurple}
          isActive={activePanel === 'search'}
          onClick={() => togglePanel('search')}
          position="middle"
          panelOpen={activePanel !== 'none' && !isClosing}
        />
        <FloatingIcon
          icon={<BarChartOutlined />}
          label="Reports"
          color={REDWOOD.reportGreen}
          isActive={activePanel === 'reports'}
          onClick={() => togglePanel('reports')}
          position="middle"
          panelOpen={activePanel !== 'none' && !isClosing}
        />
        <FloatingIcon
          icon={<ReconciliationOutlined />}
          label="Match in Full"
          color={REDWOOD.matchOrange}
          isActive={activePanel === 'match'}
          onClick={() => togglePanel('match')}
          position="middle"
          panelOpen={activePanel !== 'none' && !isClosing}
        />
        <FloatingIcon
          icon={<ApiOutlined />}
          label="API Services"
          color="#1a1a2e"
          isActive={activePanel === 'api'}
          onClick={() => togglePanel('api')}
          position="middle"
          panelOpen={activePanel !== 'none' && !isClosing}
        />
        <Tooltip title="Hide floating menu" placement="left">
          <div
            onClick={toggleMenuVisibility}
            style={{
              width: 40,
              height: 40,
              borderRadius: activePanel !== 'none' && !isClosing ? '0 0 0 8px' : '0 0 8px 8px',
              background: REDWOOD.surface,
              border: `2px solid ${REDWOOD.neutral300}`,
              borderTop: 'none',
              borderRight: activePanel !== 'none' && !isClosing ? 'none' : `2px solid ${REDWOOD.neutral300}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: REDWOOD.neutral300,
              fontSize: 14,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = REDWOOD.neutral100; (e.currentTarget as HTMLDivElement).style.color = REDWOOD.neutral600; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = REDWOOD.surface; (e.currentTarget as HTMLDivElement).style.color = REDWOOD.neutral300; }}
          >
            <EyeInvisibleOutlined />
          </div>
        </Tooltip>
      </div>
      )}

      {/* Backdrop Overlay */}
      {activePanel !== 'none' && (
        <div
          onClick={closePanel}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 1000,
            animation: isClosing ? 'fadeOut 0.25s ease forwards' : 'fadeIn 0.3s ease forwards',
          }}
        />
      )}

      {/* Slide-out Panels */}
      <div ref={panelRef}>
        {activePanel === 'tasks' && <TasksSlidePanel />}
        {activePanel === 'search' && <SearchSlidePanel />}
        {activePanel === 'reports' && <ReportsSlidePanel />}
        {activePanel === 'match' && <MatchSlidePanel />}
        {activePanel === 'api' && <ApiSlidePanel />}
      </div>

      {/* ========== QUICK CREATE INVOICE MODAL ========== */}
      <Modal
        title={
          <Space>
            <FileAddOutlined style={{ color: REDWOOD.taskBlue }} />
            <span>Create Payable Invoice</span>
          </Space>
        }
        open={quickCreateVisible}
        onCancel={() => setQuickCreateVisible(false)}
        width={520}
        zIndex={2000}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setQuickCreateVisible(false)}>Cancel</Button>
            <Button type="primary" onClick={handleQuickCreateSubmit} style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
              Create Invoice
            </Button>
          </div>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
            Fill in basic details to quickly create a payable invoice.
          </Text>
          <Form
            form={quickCreateForm}
            layout="horizontal"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 16 }}
            size="small"
          >
            <Form.Item
              label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Supplier</Text>}
              name="supplier"
              rules={[{ required: true, message: 'Select a supplier' }]}
              style={{ marginBottom: 12 }}
            >
              <Input
                placeholder="Search and select supplier..."
                readOnly
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setSupplierModalVisible(true);
                  setQcSupplierSearch('');
                  if (qcSuppliers.length === 0) fetchQcSuppliers();
                }}
                suffix={<SearchOutlined style={{ color: REDWOOD.info, cursor: 'pointer' }} />}
              />
            </Form.Item>
            <Form.Item name="supplierNumber" hidden><Input /></Form.Item>
            <Form.Item
              label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Invoice Number</Text>}
              name="invoiceNumber"
              rules={[{ required: true, message: 'Enter invoice number' }]}
              style={{ marginBottom: 12 }}
            >
              <Input placeholder="Enter invoice number" />
            </Form.Item>
            <Form.Item
              label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Amount</Text>}
              name="amount"
              rules={[{ required: true, message: 'Enter amount' }]}
              style={{ marginBottom: 12 }}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="0.00"
                precision={2}
                min={0}
                formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(value) => value!.replace(/,/g, '') as any}
              />
            </Form.Item>
            <Form.Item
              label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Invoice Date</Text>}
              name="invoiceDate"
              rules={[{ required: true, message: 'Select date' }]}
              style={{ marginBottom: 12 }}
            >
              <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="dd-mmm-yyyy" />
            </Form.Item>
            <Form.Item
              label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Description</Text>}
              name="description"
              style={{ marginBottom: 12 }}
            >
              <Input.TextArea rows={2} placeholder="Enter description" />
            </Form.Item>
            <Form.Item
              label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>Tax Code</Text>}
              name="taxCode"
              rules={[{ required: true, message: 'Select tax code' }]}
              style={{ marginBottom: 12 }}
            >
              <Select placeholder="Select tax code" size="small">
                <Option value="VAT 5%">VAT 5%</Option>
                <Option value="Zero Rated">Zero Rated</Option>
                <Option value="Exempt">Exempt</Option>
                <Option value="Reverse Charge">Reverse Charge</Option>
                <Option value="Out of Scope">Out of Scope</Option>
              </Select>
            </Form.Item>
            <Form.Item
              label={<Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}> </Text>}
              name="includingTax"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Checkbox>Amount Including Tax</Checkbox>
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* ========== SUPPLIER SEARCH MODAL (for Quick Create) ========== */}
      <Modal
        title={
          <Space>
            <SearchOutlined style={{ color: REDWOOD.info }} />
            <span>Search Suppliers</span>
          </Space>
        }
        open={supplierModalVisible}
        onCancel={() => setSupplierModalVisible(false)}
        footer={null}
        width={700}
        zIndex={2100}
        styles={{ body: { padding: '12px 24px' } }}
      >
        <div style={{ marginBottom: 12 }}>
          <Input
            placeholder="Search by name, number, or alternate name..."
            prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
            value={qcSupplierSearch}
            onChange={(e) => setQcSupplierSearch(e.target.value)}
            allowClear
            size="middle"
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {filteredQcSuppliers.length} supplier{filteredQcSuppliers.length !== 1 ? 's' : ''} found
            </Text>
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchQcSuppliers} loading={qcSupplierLoading}>
              Refresh
            </Button>
          </div>
        </div>
        <Table
          columns={qcSupplierColumns}
          dataSource={filteredQcSuppliers}
          loading={qcSupplierLoading}
          size="small"
          pagination={{ pageSize: 8, showSizeChanger: false, showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}` }}
          scroll={{ y: 300 }}
          onRow={(record) => ({
            onDoubleClick: () => {
              quickCreateForm.setFieldsValue({ supplier: record.supplier, supplierNumber: record.supplierNumber });
              setSupplierModalVisible(false);
            },
            style: { cursor: 'pointer' },
          })}
        />
      </Modal>

      {/* CSS Animations */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideOut {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `}</style>
    </>
  );
};

export default FloatingMenu;
