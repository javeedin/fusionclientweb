import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Typography,
  Breadcrumb,
  Tag,
  Row,
  Col,
  Spin,
  Alert,
  Tabs,
  List,
  Empty,
  Tooltip,
  Modal,
  Form,
  Input,
  Divider,
  message,
} from 'antd';
import {
  HomeOutlined,
  BankOutlined,
  BranchesOutlined,
  CreditCardOutlined,
  ReloadOutlined,
  DatabaseOutlined,
  CloudOutlined,
  CloseOutlined,
  GlobalOutlined,
  CheckCircleOutlined,
  DollarOutlined,
  EditOutlined,
  SearchOutlined,
  FileTextOutlined,
  BookOutlined,
  BugOutlined,
  ApiOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { ORACLE_FUSION_CONFIG } from '../../config/api.config';
import FloatingMenu from '../../components/FloatingMenu';
import AccountSelector from '../../components/AccountSelector';

const FUSION_AUTH = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
const fusionHeaders = { Authorization: FUSION_AUTH, Accept: 'application/json' };

const { Content } = Layout;
const { Title, Text } = Typography;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  error: '#C74634',
  info: '#0572CE',
  neutral: '#383838',
  surface: '#FFFFFF',
  surfaceSecondary: '#F7F7F7',
  border: '#E5E5E5',
  textPrimary: '#1A1A1A',
  textSecondary: '#6B6B6B',
};

// Types
interface Bank {
  BankPartyId: number;
  BankName: string;
  BankNameAlt: string | null;
  BankNumber: string;
  Description: string | null;
  CountryName: string;
  BankPartyNumber: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
  LastUpdatedBy: string;
}

interface BankBranch {
  BranchPartyId: number;
  BankName: string;
  BankBranchName: string;
  BankBranchNameAlt: string | null;
  BranchNumber: string;
  BankNumber: string;
  Description: string | null;
  EFTSWIFTCode: string | null;
  CountryName: string;
  BranchPartyNumber: string;
  BankPartyNumber: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
}

interface BankAccount {
  BankAccountId: number;
  BankAccountName: string;
  BankAccountNumber: string;
  BankAccountNumberElectronic: string;
  MaskedAccountNumber: string;
  CurrencyCode: string;
  BankName: string;
  BankBranchName: string;
  BranchNumber: string;
  LegalEntityName: string;
  Description: string | null;
  AccountType: string;
  ApUseAllowedFlag: boolean;
  ArUseAllowedFlag: boolean;
  CashAccountCombination: string;
  CashClearingAccountCombination: string;
  ReconciliationDifferenceAccountCombination: string;
  PdcAccountCombination: string;
  ReconStartDate: string;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
}

interface BankTab {
  key: string;
  bank: Bank;
  branches: BankBranch[];
  branchLoading: boolean;
  selectedBranch: BankBranch | null;
  accountTabs: AccountTab[];
}

interface AccountTab {
  key: string;
  branch: BankBranch;
  accounts: BankAccount[];
  loading: boolean;
}

interface PaymentDocument {
  PaymentDocumentId: number;
  PaymentDocumentName: string;
  PaymentMethodCode: string;
  PaymentMethodName: string;
  FormatCode: string;
  FormatName: string;
  FirstAvailableDocumentNumber: number | null;
  LastAvailableDocumentNumber: number | null;
  LastIssuedCheckNumber: number | null;
  PaperStockType: string | null;
  PaymentDocumentCategory: string | null;
  ActiveFlag: boolean;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
}

interface Checkbook {
  CheckbookId: number;
  CheckbookName: string;
  CheckDigits: number | null;
  FirstAvailableCheckNumber: number;
  LastAvailableCheckNumber: number;
  LastIssuedCheckNumber: number | null;
  CheckbookStatus: string;
  ActiveFlag: boolean;
  CreatedBy: string;
  CreationDate: string;
  LastUpdateDate: string;
}

const Banks: React.FC = () => {
  const [dataSource, setDataSource] = useState<'fusion' | 'apex'>('fusion');
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [activeMainTab, setActiveMainTab] = useState('all-banks');
  const [bankTabs, setBankTabs] = useState<BankTab[]>([]);

  // Edit modal state
  const [editBankModalOpen, setEditBankModalOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [editBranchModalOpen, setEditBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BankBranch | null>(null);
  const [editAccountModalOpen, setEditAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);

  // Forms for editing
  const [bankForm] = Form.useForm();
  const [branchForm] = Form.useForm();
  const [accountForm] = Form.useForm();

  // Account selector state
  const [accountSelectorField, setAccountSelectorField] = useState<'cash' | 'clearing' | 'recon' | 'pdc' | null>(null);

  // Payment documents state
  const [paymentDocuments, setPaymentDocuments] = useState<PaymentDocument[]>([]);
  const [paymentDocsLoading, setPaymentDocsLoading] = useState(false);
  const [selectedPaymentDoc, setSelectedPaymentDoc] = useState<PaymentDocument | null>(null);
  const [checkbooks, setCheckbooks] = useState<Checkbook[]>([]);
  const [checkbooksLoading, setCheckbooksLoading] = useState(false);

  // API Log state
  const [apiLogs, setApiLogs] = useState<Array<{ type: string; url: string; status: string; count: number; time: string }>>([]);
  const [showApiLog, setShowApiLog] = useState(false);

  // Fetch banks from selected source
  const fetchBanks = useCallback(async () => {
    setLoading(true);
    setError('');
    setBanks([]);
    setApiLogs([]);

    try {
      const url = `${ORACLE_FUSION_CONFIG.baseUrl}/cashBanks?limit=500&onlyData=true`;
      const t0 = Date.now();
      const response = await fetch(url, { headers: fusionHeaders });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const items = result.items || [];
      setBanks(items);
      setApiLogs(prev => [...prev, { type: 'Banks', url, status: `${response.status} OK`, count: items.length, time: `${Date.now() - t0}ms` }]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch branches for a bank
  const fetchBranches = async (bankName: string): Promise<BankBranch[]> => {
    try {
      const encodedBankName = encodeURIComponent(bankName);
      const url = `${ORACLE_FUSION_CONFIG.baseUrl}/cashBankBranches?q=BankName=${encodedBankName}&limit=500&onlyData=true`;
      const t0 = Date.now();
      const response = await fetch(url, { headers: fusionHeaders });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const items = result.items || [];
      setApiLogs(prev => [...prev, { type: 'Branches', url, status: `${response.status} OK`, count: items.length, time: `${Date.now() - t0}ms` }]);
      return items;
    } catch (err) {
      console.error('Error fetching branches:', err);
      return [];
    }
  };

  // Fetch accounts for a branch
  const fetchAccounts = async (branchName: string): Promise<BankAccount[]> => {
    try {
      const encodedBranchName = encodeURIComponent(branchName);
      const url = `${ORACLE_FUSION_CONFIG.baseUrl}/cashBankAccounts?q=BankBranchName=${encodedBranchName}&limit=500&onlyData=true`;
      const t0 = Date.now();
      const response = await fetch(url, { headers: fusionHeaders });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const items = result.items || [];
      setApiLogs(prev => [...prev, { type: 'Accounts', url, status: `${response.status} OK`, count: items.length, time: `${Date.now() - t0}ms` }]);
      return items;
    } catch (err) {
      console.error('Error fetching accounts:', err);
      return [];
    }
  };

  // Fetch payment documents for a bank account
  const fetchPaymentDocuments = async (bankAccountId: number) => {
    setPaymentDocsLoading(true);
    setPaymentDocuments([]);
    setSelectedPaymentDoc(null);
    setCheckbooks([]);
    setApiLogs([]); // Clear previous logs

    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/cashBankAccounts/${bankAccountId}/child/bankAccountPaymentDocuments?limit=500&onlyData=true`;
    const displayUrl = url;

    console.log('=== PAYMENT DOCUMENTS API CALL ===');
    console.log('URL:', url);
    console.log('Oracle URL:', displayUrl);
    console.log('BankAccountId:', bankAccountId);

    try {
      const response = await fetch(url, { headers: fusionHeaders });

      console.log('Response Status:', response.status);
      console.log('Response OK:', response.ok);

      const result = await response.json();
      console.log('Response Data:', JSON.stringify(result, null, 2));

      const items = result.items || [];
      console.log('Items Count:', items.length);

      const logEntry = {
        type: 'Payment Documents',
        url: displayUrl,
        status: response.ok ? 'Success' : `Failed (${response.status})`,
        count: items.length,
        time: new Date().toLocaleTimeString(),
      };
      setApiLogs(prev => [...prev, logEntry]);

      if (items.length > 0) {
        setPaymentDocuments(items);
      }
    } catch (err) {
      console.error('=== PAYMENT DOCUMENTS ERROR ===');
      console.error('Error Type:', err instanceof Error ? err.constructor.name : typeof err);
      console.error('Error Message:', err instanceof Error ? err.message : String(err));
      console.error('Full Error:', err);

      setApiLogs(prev => [...prev, {
        type: 'Payment Documents',
        url: displayUrl,
        status: `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
        count: 0,
        time: new Date().toLocaleTimeString(),
      }]);
    } finally {
      setPaymentDocsLoading(false);
      console.log('=== END PAYMENT DOCUMENTS ===');
    }
  };

  // Fetch checkbooks for a payment document
  const fetchCheckbooks = async (bankAccountId: number, paymentDocumentId: number) => {
    setCheckbooksLoading(true);
    setCheckbooks([]);

    const url = `${ORACLE_FUSION_CONFIG.baseUrl}/cashBankAccounts/${bankAccountId}/child/bankAccountPaymentDocuments/${paymentDocumentId}/child/bankAccountCheckbooks?limit=500&onlyData=true`;
    const displayUrl = url;

    console.log('=== CHECKBOOKS API CALL ===');
    console.log('URL:', url);
    console.log('Oracle URL:', displayUrl);
    console.log('BankAccountId:', bankAccountId);
    console.log('PaymentDocumentId:', paymentDocumentId);

    try {
      const response = await fetch(url, { headers: fusionHeaders });

      console.log('Response Status:', response.status);
      console.log('Response OK:', response.ok);

      const result = await response.json();
      console.log('Response Data:', JSON.stringify(result, null, 2));

      const items = result.items || [];
      console.log('Items Count:', items.length);

      const logEntry = {
        type: 'Checkbooks',
        url: displayUrl,
        status: response.ok ? 'Success' : `Failed (${response.status})`,
        count: items.length,
        time: new Date().toLocaleTimeString(),
      };
      setApiLogs(prev => [...prev, logEntry]);

      if (items.length > 0) {
        setCheckbooks(items);
      }
    } catch (err) {
      console.error('=== CHECKBOOKS ERROR ===');
      console.error('Error Type:', err instanceof Error ? err.constructor.name : typeof err);
      console.error('Error Message:', err instanceof Error ? err.message : String(err));
      console.error('Full Error:', err);

      setApiLogs(prev => [...prev, {
        type: 'Checkbooks',
        url: displayUrl,
        status: `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
        count: 0,
        time: new Date().toLocaleTimeString(),
      }]);
    } finally {
      setCheckbooksLoading(false);
      console.log('=== END CHECKBOOKS ===');
    }
  };

  // Handle payment document selection
  const handlePaymentDocClick = (doc: PaymentDocument) => {
    setSelectedPaymentDoc(doc);
    if (editingAccount) {
      fetchCheckbooks(editingAccount.BankAccountId, doc.PaymentDocumentId);
    }
  };

  // Fetch on mount
  useEffect(() => {
    fetchBanks();
  }, [fetchBanks]);

  // Toggle data source
  const handleSourceToggle = (checked: boolean) => {
    setDataSource(checked ? 'fusion' : 'apex');
  };

  // Open bank tab
  const handleBankClick = async (bank: Bank) => {
    const tabKey = `bank-${bank.BankPartyId}`;

    // Check if tab already exists
    const existingTab = bankTabs.find(t => t.key === tabKey);
    if (existingTab) {
      setActiveMainTab(tabKey);
      return;
    }

    // Create new tab with loading state
    const newTab: BankTab = {
      key: tabKey,
      bank,
      branches: [],
      branchLoading: true,
      selectedBranch: null,
      accountTabs: [],
    };

    setBankTabs(prev => [...prev, newTab]);
    setActiveMainTab(tabKey);

    // Fetch branches
    const branches = await fetchBranches(bank.BankName);

    setBankTabs(prev => prev.map(t =>
      t.key === tabKey
        ? { ...t, branches, branchLoading: false }
        : t
    ));
  };

  // Select branch and open accounts tab
  const handleBranchClick = async (bankTabKey: string, branch: BankBranch) => {
    const accountTabKey = `account-${branch.BranchPartyId}`;

    setBankTabs(prev => prev.map(t => {
      if (t.key !== bankTabKey) return t;

      // Check if account tab already exists
      const existingAccountTab = t.accountTabs.find(at => at.key === accountTabKey);
      if (existingAccountTab) {
        return { ...t, selectedBranch: branch };
      }

      // Create new account tab
      const newAccountTab: AccountTab = {
        key: accountTabKey,
        branch,
        accounts: [],
        loading: true,
      };

      return {
        ...t,
        selectedBranch: branch,
        accountTabs: [...t.accountTabs, newAccountTab],
      };
    }));

    // Fetch accounts
    const accounts = await fetchAccounts(branch.BankBranchName);

    setBankTabs(prev => prev.map(t => {
      if (t.key !== bankTabKey) return t;

      return {
        ...t,
        accountTabs: t.accountTabs.map(at =>
          at.key === accountTabKey
            ? { ...at, accounts, loading: false }
            : at
        ),
      };
    }));
  };

  // Close bank tab
  const handleCloseBankTab = (tabKey: string) => {
    setBankTabs(prev => prev.filter(t => t.key !== tabKey));
    setActiveMainTab('all-banks');
  };

  // Close account tab
  const handleCloseAccountTab = (bankTabKey: string, accountTabKey: string) => {
    setBankTabs(prev => prev.map(t => {
      if (t.key !== bankTabKey) return t;

      const newAccountTabs = t.accountTabs.filter(at => at.key !== accountTabKey);
      return {
        ...t,
        accountTabs: newAccountTabs,
        selectedBranch: newAccountTabs.length > 0 ? t.selectedBranch : null,
      };
    }));
  };

  // Edit Bank handlers
  const handleEditBank = (bank: Bank) => {
    setEditingBank(bank);
    bankForm.setFieldsValue({
      BankPartyId: bank.BankPartyId,
      BankName: bank.BankName,
      BankNameAlt: bank.BankNameAlt,
      BankNumber: bank.BankNumber,
      Description: bank.Description,
      CountryName: bank.CountryName,
      BankPartyNumber: bank.BankPartyNumber,
      CreatedBy: bank.CreatedBy,
      CreationDate: bank.CreationDate,
      LastUpdateDate: bank.LastUpdateDate,
      LastUpdatedBy: bank.LastUpdatedBy,
    });
    setEditBankModalOpen(true);
  };

  const handleSaveBank = async () => {
    try {
      const values = await bankForm.validateFields();
      // TODO: Implement API call to save bank
      message.success('Bank updated successfully');
      setEditBankModalOpen(false);
      setEditingBank(null);
      fetchBanks();
    } catch (err) {
      console.error('Validation failed:', err);
    }
  };

  // Edit Branch handlers
  const handleEditBranch = (branch: BankBranch) => {
    setEditingBranch(branch);
    branchForm.setFieldsValue({
      BranchPartyId: branch.BranchPartyId,
      BankName: branch.BankName,
      BankBranchName: branch.BankBranchName,
      BankBranchNameAlt: branch.BankBranchNameAlt,
      BranchNumber: branch.BranchNumber,
      BankNumber: branch.BankNumber,
      Description: branch.Description,
      EFTSWIFTCode: branch.EFTSWIFTCode,
      CountryName: branch.CountryName,
      BranchPartyNumber: branch.BranchPartyNumber,
      BankPartyNumber: branch.BankPartyNumber,
      CreatedBy: branch.CreatedBy,
      CreationDate: branch.CreationDate,
      LastUpdateDate: branch.LastUpdateDate,
    });
    setEditBranchModalOpen(true);
  };

  const handleSaveBranch = async () => {
    try {
      const values = await branchForm.validateFields();
      // TODO: Implement API call to save branch
      message.success('Branch updated successfully');
      setEditBranchModalOpen(false);
      setEditingBranch(null);
    } catch (err) {
      console.error('Validation failed:', err);
    }
  };

  // Edit Account handlers
  const handleEditAccount = (account: BankAccount) => {
    setEditingAccount(account);
    accountForm.setFieldsValue({
      BankAccountId: account.BankAccountId,
      BankAccountName: account.BankAccountName,
      BankAccountNumber: account.BankAccountNumber,
      BankAccountNumberElectronic: account.BankAccountNumberElectronic,
      MaskedAccountNumber: account.MaskedAccountNumber,
      CurrencyCode: account.CurrencyCode,
      BankName: account.BankName,
      BankBranchName: account.BankBranchName,
      BranchNumber: account.BranchNumber,
      LegalEntityName: account.LegalEntityName,
      Description: account.Description,
      AccountType: account.AccountType,
      ApUseAllowedFlag: account.ApUseAllowedFlag,
      ArUseAllowedFlag: account.ArUseAllowedFlag,
      CashAccountCombination: account.CashAccountCombination,
      CashClearingAccountCombination: account.CashClearingAccountCombination,
      ReconciliationDifferenceAccountCombination: account.ReconciliationDifferenceAccountCombination,
      PdcAccountCombination: account.PdcAccountCombination,
      ReconStartDate: account.ReconStartDate,
      CreatedBy: account.CreatedBy,
      CreationDate: account.CreationDate,
      LastUpdateDate: account.LastUpdateDate,
    });
    setEditAccountModalOpen(true);
    // Fetch payment documents for this account
    fetchPaymentDocuments(account.BankAccountId);
    // Enrich with local APEX data (PDC account combination is stored locally only)
    fetch(buildApexUrl('banks/bankaccounts'), {
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        const apex = (data.items || []).find((a: any) => Number(a.bank_account_id) === account.BankAccountId);
        if (apex?.pdc_account_combination) {
          accountForm.setFieldsValue({ PdcAccountCombination: apex.pdc_account_combination });
        }
      })
      .catch(() => {/* silently ignore */});
  };

  // Handle account selector selection
  const handleAccountSelect = (accountCode: string) => {
    if (accountSelectorField === 'cash') {
      accountForm.setFieldsValue({ CashAccountCombination: accountCode });
    } else if (accountSelectorField === 'clearing') {
      accountForm.setFieldsValue({ CashClearingAccountCombination: accountCode });
    } else if (accountSelectorField === 'recon') {
      accountForm.setFieldsValue({ ReconciliationDifferenceAccountCombination: accountCode });
    } else if (accountSelectorField === 'pdc') {
      accountForm.setFieldsValue({ PdcAccountCombination: accountCode });
    }
    setAccountSelectorField(null);
  };

  const handleSaveAccount = async () => {
    try {
      const values = await accountForm.validateFields();
      if (!editingAccount?.BankAccountId) return;

      const url = `${buildApexUrl("banks/bankaccounts/${editingAccount.BankAccountId}")}`;
      const body = {
        cashAccountCombination:                 values.CashAccountCombination || null,
        cashClearingAccountCombination:         values.CashClearingAccountCombination || null,
        reconciliationDifferenceAccountCombination: values.ReconciliationDifferenceAccountCombination || null,
        pdcAccountCombination:                  values.PdcAccountCombination || null,
        description:                            values.Description || null,
      };

      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === 'error') {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      message.success('Bank Account updated successfully');
      setEditAccountModalOpen(false);
      setEditingAccount(null);
    } catch (err: any) {
      message.error(err?.message || 'Failed to save bank account');
      console.error('Save account failed:', err);
    }
  };

  // Banks table columns
  const bankColumns = [
    {
      title: 'Bank Name',
      dataIndex: 'BankName',
      key: 'BankName',
      render: (name: string, record: Bank) => (
        <Button type="link" onClick={() => handleBankClick(record)} style={{ padding: 0 }}>
          <Space>
            <BankOutlined style={{ color: REDWOOD.info }} />
            <Text strong>{name}</Text>
          </Space>
        </Button>
      ),
    },
    {
      title: 'Bank Number',
      dataIndex: 'BankNumber',
      key: 'BankNumber',
      width: 120,
    },
    {
      title: 'Country',
      dataIndex: 'CountryName',
      key: 'CountryName',
      width: 150,
      render: (country: string) => (
        <Space>
          <GlobalOutlined style={{ color: REDWOOD.textSecondary }} />
          {country}
        </Space>
      ),
    },
    {
      title: 'Party Number',
      dataIndex: 'BankPartyNumber',
      key: 'BankPartyNumber',
      width: 120,
    },
    {
      title: 'Last Updated',
      dataIndex: 'LastUpdateDate',
      key: 'LastUpdateDate',
      width: 180,
      render: (date: string) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: Bank) => (
        <Tooltip title="Edit Bank">
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleEditBank(record);
            }}
            style={{ color: REDWOOD.info }}
          />
        </Tooltip>
      ),
    },
  ];

  // Accounts table columns
  const accountColumns = [
    {
      title: '',
      key: 'actions',
      width: 44,
      fixed: 'left' as const,
      render: (_: unknown, record: BankAccount) => (
        <Tooltip title="Edit Account">
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleEditAccount(record);
            }}
            size="small"
            style={{ color: REDWOOD.info }}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Account Name',
      dataIndex: 'BankAccountName',
      key: 'BankAccountName',
      width: 260,
      fixed: 'left' as const,
      render: (name: string) => (
        <Text strong style={{ fontSize: 12, whiteSpace: 'normal', wordBreak: 'break-word' }}>{name}</Text>
      ),
    },
    {
      title: 'Account Number',
      dataIndex: 'BankAccountNumber',
      key: 'BankAccountNumber',
      width: 150,
      render: (num: string) => <Text code style={{ fontSize: 11 }}>{num}</Text>,
    },
    {
      title: 'Masked Number',
      dataIndex: 'MaskedAccountNumber',
      key: 'MaskedAccountNumber',
      width: 130,
      render: (num: string) => <Text code style={{ fontSize: 11 }}>{num}</Text>,
    },
    {
      title: 'Currency',
      dataIndex: 'CurrencyCode',
      key: 'CurrencyCode',
      width: 80,
      render: (code: string) => <Tag color="blue">{code}</Tag>,
    },
    {
      title: 'Legal Entity',
      dataIndex: 'LegalEntityName',
      key: 'LegalEntityName',
      width: 200,
      ellipsis: true,
    },
    {
      title: 'AP',
      dataIndex: 'ApUseAllowedFlag',
      key: 'ApUseAllowedFlag',
      width: 50,
      render: (flag: boolean) => flag ? <CheckCircleOutlined style={{ color: REDWOOD.success }} /> : '-',
    },
    {
      title: 'AR',
      dataIndex: 'ArUseAllowedFlag',
      key: 'ArUseAllowedFlag',
      width: 50,
      render: (flag: boolean) => flag ? <CheckCircleOutlined style={{ color: REDWOOD.success }} /> : '-',
    },
    {
      title: 'Cash Account',
      dataIndex: 'CashAccountCombination',
      key: 'CashAccountCombination',
      width: 200,
      ellipsis: true,
      render: (combo: string) => (
        <Tooltip title={combo}>
          <Text code style={{ fontSize: 10 }}>{combo}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'PDC Account',
      dataIndex: 'PdcAccountCombination',
      key: 'PdcAccountCombination',
      width: 200,
      ellipsis: true,
      render: (combo: string) => combo ? (
        <Tooltip title={combo}>
          <Text code style={{ fontSize: 10 }}>{combo}</Text>
        </Tooltip>
      ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
  ];

  // Render bank detail tab content
  const renderBankTabContent = (bankTab: BankTab) => {
    const activeAccountTabKey = bankTab.accountTabs.length > 0
      ? bankTab.accountTabs[bankTab.accountTabs.length - 1].key
      : undefined;

    return (
      <div style={{ display: 'flex', height: '100%', gap: 12 }}>
        {/* Left Panel - Branches */}
        <Card
          style={{
            width: 280,
            flexShrink: 0,
            borderRadius: '0 0 8px 8px',
            border: `1px solid ${REDWOOD.border}`,
            borderTop: 'none',
            display: 'flex',
            flexDirection: 'column',
          }}
          bodyStyle={{ padding: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {/* Bank Header */}
          <div style={{
            padding: '8px 12px',
            background: REDWOOD.info,
            color: '#fff',
          }}>
            <Space size={4}>
              <BankOutlined style={{ fontSize: 14 }} />
              <Text strong style={{ color: '#fff', fontSize: 13 }}>{bankTab.bank.BankName}</Text>
            </Space>
          </div>

          {/* Branches Header */}
          <div style={{
            padding: '6px 12px',
            background: REDWOOD.surfaceSecondary,
            borderBottom: `1px solid ${REDWOOD.border}`,
          }}>
            <Space size={4}>
              <BranchesOutlined style={{ color: REDWOOD.primary, fontSize: 12 }} />
              <Text strong style={{ fontSize: 12 }}>Branches ({bankTab.branches.length})</Text>
            </Space>
          </div>

          {/* Branches List */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {bankTab.branchLoading ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <Spin size="small" tip="Loading..." />
              </div>
            ) : bankTab.branches.length === 0 ? (
              <Empty description="No branches" style={{ padding: 20 }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                size="small"
                dataSource={bankTab.branches}
                renderItem={(branch) => {
                  const isSelected = bankTab.selectedBranch?.BranchPartyId === branch.BranchPartyId;
                  return (
                    <List.Item
                      onClick={() => handleBranchClick(bankTab.key, branch)}
                      style={{
                        padding: '6px 12px',
                        cursor: 'pointer',
                        background: isSelected ? `${REDWOOD.info}15` : 'transparent',
                        borderLeft: isSelected ? `3px solid ${REDWOOD.info}` : '3px solid transparent',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = REDWOOD.surfaceSecondary;
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text strong style={{ display: 'block', fontSize: 12, color: isSelected ? REDWOOD.info : REDWOOD.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {branch.BankBranchName}
                          </Text>
                          <Space size={4} style={{ marginTop: 2 }}>
                            <Text type="secondary" style={{ fontSize: 10 }}>{branch.BranchNumber}</Text>
                            {branch.EFTSWIFTCode && (
                              <Tag style={{ fontSize: 9, margin: 0, padding: '0 4px', lineHeight: '16px' }}>{branch.EFTSWIFTCode}</Tag>
                            )}
                          </Space>
                        </div>
                        <Tooltip title="Edit">
                          <Button
                            type="text"
                            icon={<EditOutlined style={{ fontSize: 12 }} />}
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditBranch(branch);
                            }}
                            style={{ color: REDWOOD.info, padding: '0 4px', height: 20 }}
                          />
                        </Tooltip>
                      </div>
                    </List.Item>
                  );
                }}
              />
            )}
          </div>
        </Card>

        {/* Right Panel - Accounts */}
        <Card
          style={{
            flex: 1,
            borderRadius: '0 0 8px 8px',
            border: `1px solid ${REDWOOD.border}`,
            borderTop: 'none',
            display: 'flex',
            flexDirection: 'column',
          }}
          bodyStyle={{ padding: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {bankTab.accountTabs.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty
                image={<CreditCardOutlined style={{ fontSize: 36, color: REDWOOD.textSecondary }} />}
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>Select a branch to view accounts</Text>
                }
              />
            </div>
          ) : (
            <Tabs
              type="editable-card"
              hideAdd
              size="small"
              activeKey={activeAccountTabKey}
              onChange={(key) => {
                const accountTab = bankTab.accountTabs.find(at => at.key === key);
                if (accountTab) {
                  setBankTabs(prev => prev.map(t =>
                    t.key === bankTab.key ? { ...t, selectedBranch: accountTab.branch } : t
                  ));
                }
              }}
              onEdit={(targetKey, action) => {
                if (action === 'remove') {
                  handleCloseAccountTab(bankTab.key, targetKey as string);
                }
              }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              tabBarStyle={{ margin: 0, padding: '0 12px', background: REDWOOD.surfaceSecondary }}
              items={bankTab.accountTabs.map(accountTab => ({
                key: accountTab.key,
                label: (
                  <Space size={4}>
                    <CreditCardOutlined style={{ fontSize: 12 }} />
                    <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', fontSize: 12 }}>
                      {accountTab.branch.BankBranchName}
                    </span>
                  </Space>
                ),
                children: (
                  <div style={{ padding: 12, height: '100%', overflow: 'auto' }}>
                    {accountTab.loading ? (
                      <div style={{ padding: 20, textAlign: 'center' }}>
                        <Spin size="small" tip="Loading..." />
                      </div>
                    ) : accountTab.accounts.length === 0 ? (
                      <Empty description="No accounts" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <>
                        <div style={{ marginBottom: 8 }}>
                          <Space size={4}>
                            <DollarOutlined style={{ color: REDWOOD.success, fontSize: 12 }} />
                            <Text strong style={{ fontSize: 12 }}>Bank Accounts ({accountTab.accounts.length})</Text>
                          </Space>
                        </div>
                        <Table
                          dataSource={accountTab.accounts}
                          columns={accountColumns}
                          rowKey="BankAccountId"
                          size="small"
                          pagination={{ pageSize: 8, showSizeChanger: false, size: 'small' }}
                          scroll={{ x: 1400 }}
                        />
                      </>
                    )}
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      </div>
    );
  };

  // Build main tabs
  const mainTabItems = [
    {
      key: 'all-banks',
      label: (
        <Space size={4}>
          <BankOutlined />
          All Banks
        </Space>
      ),
      closable: false,
      children: (
        <Card
          style={{
            borderRadius: '0 0 8px 8px',
            border: `1px solid ${REDWOOD.border}`,
            borderTop: 'none',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
          bodyStyle={{ padding: 0, flex: 1, overflow: 'auto' }}
        >
          {error && (
            <Alert
              message="Error Loading Banks"
              description={error}
              type="error"
              showIcon
              closable
              onClose={() => setError('')}
              style={{ margin: 8, borderRadius: 6 }}
            />
          )}
          <Spin spinning={loading} tip="Loading banks...">
            <Table
              dataSource={banks}
              columns={bankColumns}
              rowKey="BankPartyId"
              size="small"
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                size: 'small',
              }}
              onRow={(record) => ({
                style: { cursor: 'pointer' },
                onDoubleClick: () => handleBankClick(record),
              })}
              scroll={{ y: 'calc(100vh - 280px)' }}
            />
          </Spin>
        </Card>
      ),
    },
    ...bankTabs.map(bankTab => ({
      key: bankTab.key,
      label: (
        <Space>
          <BankOutlined style={{ color: REDWOOD.info }} />
          <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
            {bankTab.bank.BankName}
          </span>
        </Space>
      ),
      closable: true,
      children: renderBankTabContent(bankTab),
    })),
  ];

  return (
    <Layout style={{ height: 'calc(100vh - 64px)', background: REDWOOD.surfaceSecondary, overflow: 'hidden' }}>
      <Content style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          padding: '8px 16px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.border}`,
          flexShrink: 0,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/ap">Payables</Link> },
              { title: 'Banks' },
            ]}
          />
        </div>

        <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Title and Controls */}
          <Row justify="space-between" align="middle" style={{ marginBottom: 12, flexShrink: 0 }}>
            <Col>
              <Space align="center">
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: REDWOOD.info,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <BankOutlined style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div>
                  <Title level={4} style={{ margin: 0, color: REDWOOD.textPrimary }}>
                    Banks
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12 }}>Manage banks, branches, and bank accounts</Text>
                </div>
              </Space>
            </Col>
            <Col>
              <Space size={8}>
                <Tooltip title="View API calls">
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    onClick={() => setShowApiLog(true)}
                    style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                    disabled={apiLogs.length === 0}
                  />
                </Tooltip>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={fetchBanks}
                  loading={loading}
                >
                  Refresh
                </Button>
              </Space>
            </Col>
          </Row>

          {/* Main Tabs */}
          <Tabs
            type="editable-card"
            hideAdd
            activeKey={activeMainTab}
            onChange={setActiveMainTab}
            onEdit={(targetKey, action) => {
              if (action === 'remove') {
                handleCloseBankTab(targetKey as string);
              }
            }}
            items={mainTabItems}
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            tabBarStyle={{
              marginBottom: 0,
              background: REDWOOD.surface,
              padding: '4px 12px 0',
              borderRadius: '8px 8px 0 0',
              border: `1px solid ${REDWOOD.border}`,
              borderBottom: 'none',
              flexShrink: 0,
            }}
          />
        </div>
      </Content>

      {/* Edit Bank Modal */}
      <Modal
        title={<Space size={4}><BankOutlined style={{ color: REDWOOD.info }} /><span>Edit Bank</span></Space>}
        open={editBankModalOpen}
        onCancel={() => { setEditBankModalOpen(false); setEditingBank(null); bankForm.resetFields(); }}
        footer={[
          <Button key="cancel" size="small" onClick={() => { setEditBankModalOpen(false); setEditingBank(null); bankForm.resetFields(); }}>Cancel</Button>,
          <Button key="save" size="small" type="primary" onClick={handleSaveBank} style={{ background: REDWOOD.primary }}>Save</Button>,
        ]}
        width={600}
        styles={{ body: { padding: '12px 24px' } }}
      >
        <Form form={bankForm} layout="vertical" size="small" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="BankPartyId" label="Party ID" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="BankPartyNumber" label="Party Number" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="BankNumber" label="Bank Number" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="CountryName" label="Country" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="BankName" label="Bank Name" rules={[{ required: true }]} style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
            <Col span={12}><Form.Item name="BankNameAlt" label="Alternate Name" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
          </Row>
          <Form.Item name="Description" label="Description" style={{ marginBottom: 8 }}><Input.TextArea rows={1} size="small" /></Form.Item>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="CreatedBy" label="Created By" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="CreationDate" label="Created" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="LastUpdatedBy" label="Updated By" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="LastUpdateDate" label="Updated" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* Edit Branch Modal */}
      <Modal
        title={<Space size={4}><BranchesOutlined style={{ color: REDWOOD.primary }} /><span>Edit Branch</span></Space>}
        open={editBranchModalOpen}
        onCancel={() => { setEditBranchModalOpen(false); setEditingBranch(null); branchForm.resetFields(); }}
        footer={[
          <Button key="cancel" size="small" onClick={() => { setEditBranchModalOpen(false); setEditingBranch(null); branchForm.resetFields(); }}>Cancel</Button>,
          <Button key="save" size="small" type="primary" onClick={handleSaveBranch} style={{ background: REDWOOD.primary }}>Save</Button>,
        ]}
        width={600}
        styles={{ body: { padding: '12px 24px' } }}
      >
        <Form form={branchForm} layout="vertical" size="small" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="BranchPartyId" label="Branch ID" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="BranchPartyNumber" label="Party Number" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="BankName" label="Bank" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="BankNumber" label="Bank Number" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="BankBranchName" label="Branch Name" rules={[{ required: true }]} style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
            <Col span={12}><Form.Item name="BankBranchNameAlt" label="Alternate Name" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={6}><Form.Item name="BranchNumber" label="Branch Number" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="EFTSWIFTCode" label="SWIFT Code" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="CountryName" label="Country" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
            <Col span={6}><Form.Item name="BankPartyNumber" label="Bank Party #" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
          </Row>
          <Form.Item name="Description" label="Description" style={{ marginBottom: 8 }}><Input.TextArea rows={1} size="small" /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="CreatedBy" label="Created By" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={8}><Form.Item name="CreationDate" label="Created" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
            <Col span={8}><Form.Item name="LastUpdateDate" label="Updated" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* Edit Account Modal */}
      <Modal
        title={<Space size={4}><CreditCardOutlined style={{ color: REDWOOD.success }} /><span>Edit Bank Account</span></Space>}
        open={editAccountModalOpen}
        onCancel={() => {
          setEditAccountModalOpen(false);
          setEditingAccount(null);
          accountForm.resetFields();
          setPaymentDocuments([]);
          setSelectedPaymentDoc(null);
          setCheckbooks([]);
          setApiLogs([]);
          setShowApiLog(false);
        }}
        footer={[
          <Button key="cancel" size="small" onClick={() => {
            setEditAccountModalOpen(false);
            setEditingAccount(null);
            accountForm.resetFields();
            setPaymentDocuments([]);
            setSelectedPaymentDoc(null);
            setCheckbooks([]);
            setApiLogs([]);
            setShowApiLog(false);
          }}>Cancel</Button>,
          <Button key="save" size="small" type="primary" onClick={handleSaveAccount} style={{ background: REDWOOD.primary }}>Save</Button>,
        ]}
        width={750}
        styles={{ body: { padding: '8px 16px 16px' } }}
      >
        <Form form={accountForm} layout="vertical" size="small">
          <Tabs
            size="small"
            items={[
              {
                key: 'general',
                label: 'General',
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Row gutter={12}>
                      <Col span={8}><Form.Item name="BankAccountId" label="Account ID" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
                      <Col span={8}><Form.Item name="BankName" label="Bank" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
                      <Col span={8}><Form.Item name="BankBranchName" label="Branch" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={8}><Form.Item name="BranchNumber" label="Branch Number" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
                      <Col span={8}><Form.Item name="CurrencyCode" label="Currency" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                      <Col span={8}><Form.Item name="AccountType" label="Account Type" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="BankAccountName" label="Account Name" rules={[{ required: true }]} style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                      <Col span={12}><Form.Item name="BankAccountNumber" label="Account Number" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="MaskedAccountNumber" label="Masked Account #" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
                      <Col span={12}><Form.Item name="BankAccountNumberElectronic" label="Electronic Account #" style={{ marginBottom: 0 }}><Input size="small" /></Form.Item></Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: 'accounts',
                label: 'Accounts',
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="LegalEntityName" label="Legal Entity" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                      <Col span={12}><Form.Item name="BankAccountNumber" label="Account Number" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                    </Row>
                    <Form.Item name="CashAccountCombination" label="Cash Account" style={{ marginBottom: 8 }}>
                      <Input
                        size="small"
                        suffix={
                          <SearchOutlined
                            style={{ color: REDWOOD.info, cursor: 'pointer' }}
                            onClick={() => setAccountSelectorField('cash')}
                          />
                        }
                        onClick={() => setAccountSelectorField('cash')}
                        readOnly
                        style={{ cursor: 'pointer' }}
                      />
                    </Form.Item>
                    <Form.Item name="CashClearingAccountCombination" label="Cash Clearing Account" style={{ marginBottom: 8 }}>
                      <Input
                        size="small"
                        suffix={
                          <SearchOutlined
                            style={{ color: REDWOOD.info, cursor: 'pointer' }}
                            onClick={() => setAccountSelectorField('clearing')}
                          />
                        }
                        onClick={() => setAccountSelectorField('clearing')}
                        readOnly
                        style={{ cursor: 'pointer' }}
                      />
                    </Form.Item>
                    <Form.Item name="ReconciliationDifferenceAccountCombination" label="Recon Difference Account" style={{ marginBottom: 8 }}>
                      <Input
                        size="small"
                        suffix={
                          <SearchOutlined
                            style={{ color: REDWOOD.info, cursor: 'pointer' }}
                            onClick={() => setAccountSelectorField('recon')}
                          />
                        }
                        onClick={() => setAccountSelectorField('recon')}
                        readOnly
                        style={{ cursor: 'pointer' }}
                      />
                    </Form.Item>
                    <Form.Item name="PdcAccountCombination" label="PDC Account" style={{ marginBottom: 8 }}>
                      <Input
                        size="small"
                        suffix={
                          <SearchOutlined
                            style={{ color: REDWOOD.info, cursor: 'pointer' }}
                            onClick={() => setAccountSelectorField('pdc')}
                          />
                        }
                        onClick={() => setAccountSelectorField('pdc')}
                        readOnly
                        style={{ cursor: 'pointer' }}
                      />
                    </Form.Item>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="ApUseAllowedFlag" label="AP Use Allowed" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                      <Col span={12}><Form.Item name="ArUseAllowedFlag" label="AR Use Allowed" style={{ marginBottom: 0 }}><Input size="small" /></Form.Item></Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: 'others',
                label: 'Others',
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="ReconStartDate" label="Reconciliation Start Date" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
                      <Col span={12}><Form.Item name="Description" label="Description" style={{ marginBottom: 8 }}><Input size="small" /></Form.Item></Col>
                    </Row>
                    <Divider style={{ margin: '8px 0' }} orientationMargin={0}><Text type="secondary" style={{ fontSize: 11 }}>Audit Information</Text></Divider>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="CreatedBy" label="Created By" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
                      <Col span={12}><Form.Item name="CreationDate" label="Creation Date" style={{ marginBottom: 8 }}><Input disabled size="small" /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="LastUpdateDate" label="Last Update Date" style={{ marginBottom: 0 }}><Input disabled size="small" /></Form.Item></Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: 'paymentDocs',
                label: <Space size={4}><FileTextOutlined />Payment Documents</Space>,
                children: (
                  <div style={{ paddingTop: 8 }}>
                    {/* API Log Toggle and Refresh */}
                    <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <Tooltip title="Refresh Payment Documents">
                        <Button
                          type="text"
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => editingAccount && fetchPaymentDocuments(editingAccount.BankAccountId)}
                          loading={paymentDocsLoading}
                          style={{ fontSize: 11 }}
                        >
                          Refresh
                        </Button>
                      </Tooltip>
                      <Tooltip title="Toggle API Log">
                        <Button
                          type={showApiLog ? 'primary' : 'text'}
                          size="small"
                          icon={<BugOutlined />}
                          onClick={() => setShowApiLog(!showApiLog)}
                          style={{ fontSize: 11 }}
                        >
                          API Log
                        </Button>
                      </Tooltip>
                    </div>

                    {/* API Log Panel */}
                    {showApiLog && (
                      <div style={{
                        marginBottom: 8,
                        padding: 8,
                        background: '#f5f5f5',
                        borderRadius: 4,
                        border: `1px solid ${REDWOOD.border}`,
                        maxHeight: 120,
                        overflow: 'auto',
                      }}>
                        <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>API Calls:</Text>
                        {apiLogs.length === 0 ? (
                          <Text type="secondary" style={{ fontSize: 10 }}>No API calls yet</Text>
                        ) : (
                          apiLogs.map((log, idx) => (
                            <div key={idx} style={{ marginBottom: 6, fontSize: 10, fontFamily: 'monospace' }}>
                              <div>
                                <Tag color={log.status === 'Success' ? 'green' : 'red'} style={{ fontSize: 9 }}>{log.type}</Tag>
                                <Text type="secondary">{log.time}</Text>
                                <Text style={{ marginLeft: 8 }}>Items: {log.count}</Text>
                              </div>
                              <div style={{ wordBreak: 'break-all', color: '#666', marginTop: 2 }}>
                                {log.url}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <Spin spinning={paymentDocsLoading}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Payment Documents Table - Top Section */}
                        <div>
                          <div style={{ marginBottom: 8 }}>
                            <Space size={4}>
                              <FileTextOutlined style={{ color: REDWOOD.primary }} />
                              <Text strong style={{ fontSize: 12 }}>Payment Documents ({paymentDocuments.length})</Text>
                            </Space>
                          </div>
                          {paymentDocuments.length === 0 ? (
                            <Empty description="No payment documents" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          ) : (
                            <Table
                              dataSource={paymentDocuments}
                              rowKey="PaymentDocumentId"
                              size="small"
                              pagination={false}
                              scroll={{ y: 150 }}
                              rowClassName={(record) =>
                                selectedPaymentDoc?.PaymentDocumentId === record.PaymentDocumentId ? 'ant-table-row-selected' : ''
                              }
                              onRow={(record) => ({
                                onClick: () => handlePaymentDocClick(record),
                                style: {
                                  cursor: 'pointer',
                                  background: selectedPaymentDoc?.PaymentDocumentId === record.PaymentDocumentId ? `${REDWOOD.primary}15` : undefined,
                                },
                              })}
                              columns={[
                                {
                                  title: 'Document Name',
                                  dataIndex: 'PaymentDocumentName',
                                  key: 'PaymentDocumentName',
                                  width: 180,
                                  ellipsis: true,
                                  render: (name: string, record: PaymentDocument) => (
                                    <Space size={4}>
                                      <Text strong style={{ fontSize: 11 }}>{name}</Text>
                                      {record.ActiveFlag && <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 10 }} />}
                                    </Space>
                                  ),
                                },
                                {
                                  title: 'Category',
                                  dataIndex: 'PaymentDocumentCategory',
                                  key: 'PaymentDocumentCategory',
                                  width: 130,
                                  ellipsis: true,
                                  render: (cat: string) => cat ? <Tag style={{ fontSize: 9 }}>{cat}</Tag> : '-',
                                },
                                {
                                  title: 'Format',
                                  dataIndex: 'FormatName',
                                  key: 'FormatName',
                                  width: 180,
                                  ellipsis: true,
                                  render: (name: string) => <Text style={{ fontSize: 10 }}>{name || '-'}</Text>,
                                },
                                {
                                  title: 'Paper Stock',
                                  dataIndex: 'PaperStockType',
                                  key: 'PaperStockType',
                                  width: 120,
                                  ellipsis: true,
                                  render: (type: string) => <Text style={{ fontSize: 10 }}>{type || '-'}</Text>,
                                },
                                {
                                  title: 'First Doc #',
                                  dataIndex: 'FirstAvailableDocumentNumber',
                                  key: 'FirstAvailableDocumentNumber',
                                  width: 90,
                                  render: (num: number | null) => num ? <Text code style={{ fontSize: 10 }}>{num}</Text> : '-',
                                },
                                {
                                  title: 'Last Doc #',
                                  dataIndex: 'LastAvailableDocumentNumber',
                                  key: 'LastAvailableDocumentNumber',
                                  width: 90,
                                  render: (num: number | null) => num ? <Text code style={{ fontSize: 10 }}>{num}</Text> : '-',
                                },
                              ]}
                            />
                          )}
                        </div>

                        {/* Checkbooks Table - Bottom Section */}
                        <div style={{ borderTop: `1px solid ${REDWOOD.border}`, paddingTop: 12 }}>
                          <div style={{ marginBottom: 8 }}>
                            <Space size={4}>
                              <BookOutlined style={{ color: REDWOOD.info }} />
                              <Text strong style={{ fontSize: 12 }}>
                                Checkbooks {selectedPaymentDoc ? `- ${selectedPaymentDoc.PaymentDocumentName} (${checkbooks.length})` : ''}
                              </Text>
                            </Space>
                          </div>
                          <Spin spinning={checkbooksLoading}>
                            {!selectedPaymentDoc ? (
                              <Empty description="Select a payment document above to view checkbooks" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            ) : checkbooks.length === 0 ? (
                              <Empty description="No checkbooks for this payment document" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            ) : (
                              <Table
                                dataSource={checkbooks}
                                rowKey="CheckbookId"
                                size="small"
                                pagination={false}
                                scroll={{ y: 120 }}
                                columns={[
                                  {
                                    title: 'Checkbook Name',
                                    dataIndex: 'CheckbookName',
                                    key: 'CheckbookName',
                                    ellipsis: true,
                                    render: (name: string) => <Text style={{ fontSize: 11 }}>{name}</Text>,
                                  },
                                  {
                                    title: 'First Check #',
                                    dataIndex: 'FirstAvailableCheckNumber',
                                    key: 'FirstAvailableCheckNumber',
                                    width: 100,
                                    render: (num: number) => <Text code style={{ fontSize: 10 }}>{num}</Text>,
                                  },
                                  {
                                    title: 'Last Check #',
                                    dataIndex: 'LastAvailableCheckNumber',
                                    key: 'LastAvailableCheckNumber',
                                    width: 100,
                                    render: (num: number) => <Text code style={{ fontSize: 10 }}>{num}</Text>,
                                  },
                                  {
                                    title: 'Last Issued',
                                    dataIndex: 'LastIssuedCheckNumber',
                                    key: 'LastIssuedCheckNumber',
                                    width: 90,
                                    render: (num: number | null) => num ? <Text code style={{ fontSize: 10 }}>{num}</Text> : '-',
                                  },
                                  {
                                    title: 'Status',
                                    dataIndex: 'CheckbookStatus',
                                    key: 'CheckbookStatus',
                                    width: 80,
                                    render: (status: string) => (
                                      <Tag color={status === 'ACTIVE' ? 'green' : 'default'} style={{ fontSize: 9 }}>{status}</Tag>
                                    ),
                                  },
                                ]}
                              />
                            )}
                          </Spin>
                        </div>
                      </div>
                    </Spin>
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* Account Selector Modal */}
      <AccountSelector
        visible={accountSelectorField !== null}
        onCancel={() => setAccountSelectorField(null)}
        onSelect={handleAccountSelect}
        initialValue={
          accountSelectorField === 'cash'
            ? accountForm.getFieldValue('CashAccountCombination')
            : accountSelectorField === 'clearing'
            ? accountForm.getFieldValue('CashClearingAccountCombination')
            : accountSelectorField === 'recon'
            ? accountForm.getFieldValue('ReconciliationDifferenceAccountCombination')
            : accountSelectorField === 'pdc'
            ? accountForm.getFieldValue('PdcAccountCombination')
            : undefined
        }
      />

      {/* API Calls Modal */}
      <Modal
        open={showApiLog}
        onCancel={() => setShowApiLog(false)}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} />API Calls</Space>}
        footer={<Button onClick={() => setShowApiLog(false)}>Close</Button>}
        width={760}
      >
        {apiLogs.length === 0 ? (
          <Text type="secondary">No API calls recorded yet. Refresh data to see calls.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {apiLogs.map((log, idx) => (
              <div key={idx} style={{ background: '#f8faff', border: '1px solid #e0eaff', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Tag color={log.status.startsWith('2') || log.status === 'Success' ? 'green' : 'red'} style={{ fontSize: 10 }}>
                    {log.type}
                  </Tag>
                  <Tag color="blue" style={{ fontSize: 10 }}>{log.status}</Tag>
                  <Text style={{ fontSize: 11 }}>{log.count} records</Text>
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>{log.time}</Text>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4,
                    padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
                    {log.url}
                  </div>
                  <Tooltip title="Copy URL">
                    <Button size="small" icon={<CopyOutlined />}
                      onClick={() => { navigator.clipboard.writeText(log.url); message.success('Copied'); }} />
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Autopilot Assistant */}
      
      <FloatingMenu />
    </Layout>
  );
};

export default Banks;
