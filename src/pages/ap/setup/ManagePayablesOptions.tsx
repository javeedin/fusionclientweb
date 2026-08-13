import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout,
  Card,
  Table,
  Button,
  Space,
  Typography,
  Breadcrumb,
  Tabs,
  Form,
  Input,
  Select,
  Switch,
  Row,
  Col,
  Descriptions,
  Tag,
  Alert,
  Spin,
  message,
  Tooltip,
  Badge,
  Divider,
} from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  SyncOutlined,
  EditOutlined,
  SaveOutlined,
  ReloadOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  BankOutlined,
} from '@ant-design/icons';
import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  surface: '#FFFFFF',
};

const FUSION_AUTH = btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
const APEX_OPTIONS_URL = `${APEX_DB_CONFIG.baseUrl}/ap/system-options`;

interface SystemOption {
  optionId?: number;
  businessUnitId: number;
  businessUnitName: string;
  ledgerId?: number;
  ledgerCurrency?: string;
  invoiceCurrency?: string;
  paymentCurrency?: string;
  payDateBasis?: string;
  termsDateBasis?: string;
  budgetDateBasis?: string;
  accountingDateBasis?: string;
  accountForPayment?: string;
  paymentPriority?: number;
  paymentTerms?: string;
  prepaymentPaymentTerms?: string;
  paymentRequestPaymentTerms?: string;
  payGroup?: string;
  discountAllocationMethod?: string;
  enableInvoiceApprovalFlag?: string;
  requireValidationBeforeApproval?: string;
  allowForceApprovalFlag?: string;
  allowAdjustmentsToPaidInvFlag?: string;
  createInterestInvoicesFlag?: string;
  alwaysTakeDiscFlag?: string;
  showAvailPrepaymentsFlag?: string;
  requireConvRateForPmtsFlag?: string;
  useDistFromPoFlag?: string;
  exchangeGainLossAccount?: string;
  lastUpdateDate?: string;
  lastUpdatedBy?: string;
  createdBy?: string;
  creationDate?: string;
  syncDate?: string;
}

interface EditTab {
  key: string;
  option: SystemOption;
  dirty: boolean;
}

const boolTag = (v?: string) =>
  v === 'Y'
    ? <Tag icon={<CheckCircleOutlined />} color="success">Yes</Tag>
    : <Tag icon={<CloseCircleOutlined />} color="default">No</Tag>;

export default function ManagePayablesOptions() {
  const [options, setOptions] = useState<SystemOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('search');
  const [editTabs, setEditTabs] = useState<EditTab[]>([]);
  const [filterBuId, setFilterBuId] = useState<string>('');
  const [forms] = useState<Record<string, ReturnType<typeof Form.useForm>[0]>>({});

  const loadOptions = useCallback(async (buId?: string) => {
    setLoading(true);
    try {
      const params = buId ? `?businessUnitId=${encodeURIComponent(buId)}` : '';
      const res = await fetch(`${APEX_OPTIONS_URL}${params}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setOptions(data.items ?? []);
    } catch {
      message.error('Failed to load payables options');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  const handleSearch = () => loadOptions(filterBuId || undefined);

  const syncFromFusion = async () => {
    setSyncing(true);
    setSyncLog([]);
    const log: string[] = [];
    try {
      log.push('Fetching from Oracle Fusion...');
      setSyncLog([...log]);

      const res = await fetch(
        `${ORACLE_FUSION_CONFIG.baseUrl}/fscmRestApi/resources/11.13.18.05/payablesOptions?limit=100`,
        { headers: { Authorization: `Basic ${FUSION_AUTH}`, Accept: 'application/json' } }
      );
      if (!res.ok) throw new Error(`Fusion returned HTTP ${res.status}`);
      const data = await res.json();
      const items = data.items ?? [];
      log.push(`Found ${items.length} record(s) from Fusion.`);
      setSyncLog([...log]);

      let saved = 0;
      for (const item of items) {
        const payload = {
          businessUnitId: item.businessUnitId,
          businessUnitName: item.businessUnitName,
          ledgerId: item.ledgerId,
          ledgerCurrency: item.ledgerCurrency,
          invoiceCurrency: item.invoiceCurrency,
          paymentCurrency: item.paymentCurrency,
          payDateBasis: item.payDateBasis,
          termsDateBasis: item.termsDateBasis,
          budgetDateBasis: item.budgetDateBasis,
          accountingDateBasis: item.AccountingDateBasis,
          accountForPayment: item.accountForPayment,
          paymentPriority: item.paymentPriority,
          paymentTerms: item.paymentTerms,
          prepaymentPaymentTerms: item.prepaymentPaymentTerms,
          paymentRequestPaymentTerms: item.paymentRequestPaymentTerms,
          payGroup: item.payGroup,
          discountAllocationMethod: item.discountAllocationMethod,
          enableInvoiceApprovalFlag: item.enableInvoiceApprovalFlag,
          requireValidationBeforeApprovalFlag: item.requireValidationBeforeApprovalFlag,
          allowForceApprovalFlag: item.allowForceApprovalFlag,
          allowAdjustmentsToPaidInvoicesFlag: item.allowAdjustmentsToPaidInvoicesFlag,
          createInterestInvoicesFlag: item.createInterestInvoicesFlag,
          alwaysTakeDiscFlag: item.alwaysTakeDiscFlag,
          showAvailablePrepaymentsDuringInvoiceEntryFlag: item.showAvailablePrepaymentsDuringInvoiceEntryFlag,
          requireConversionRateEntryForPaymentsFlag: item.requireConversionRateEntryForPaymentsFlag,
          useDistributionFromPurchaseOrderFlag: item.useDistributionFromPurchaseOrderFlag,
          lastUpdateDate: item.lastUpdateDate,
          lastUpdatedBy: item.lastUpdatedBy,
          createdBy: item.createdBy,
          creationDate: item.creationDate,
          // exchangeGainLossAccount not from Fusion — preserve existing
        };
        const postRes = await fetch(APEX_OPTIONS_URL, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (postRes.ok) {
          saved++;
          log.push(`✓ Saved: ${item.businessUnitName}`);
        } else {
          log.push(`✗ Failed: ${item.businessUnitName}`);
        }
        setSyncLog([...log]);
      }

      log.push(`Sync complete. ${saved}/${items.length} saved.`);
      setSyncLog([...log]);
      await loadOptions();
      message.success(`Synced ${saved} record(s) from Fusion`);
    } catch (e: any) {
      log.push(`Error: ${e?.message}`);
      setSyncLog([...log]);
      message.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const openEditTab = (opt: SystemOption) => {
    const key = `edit-${opt.businessUnitId}`;
    if (!editTabs.find(t => t.key === key)) {
      setEditTabs(prev => [...prev, { key, option: { ...opt }, dirty: false }]);
    }
    setActiveTab(key);
  };

  const closeEditTab = (key: string) => {
    setEditTabs(prev => prev.filter(t => t.key !== key));
    setActiveTab('search');
  };

  const saveOption = async (tabKey: string, opt: SystemOption) => {
    try {
      const res = await fetch(APEX_OPTIONS_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...opt,
          enableInvoiceApprovalFlag: opt.enableInvoiceApprovalFlag,
          requireValidationBeforeApprovalFlag: opt.requireValidationBeforeApproval === 'Y',
          allowForceApprovalFlag: opt.allowForceApprovalFlag === 'Y',
          allowAdjustmentsToPaidInvoicesFlag: opt.allowAdjustmentsToPaidInvFlag === 'Y',
          createInterestInvoicesFlag: opt.createInterestInvoicesFlag === 'Y',
          alwaysTakeDiscFlag: opt.alwaysTakeDiscFlag === 'Y',
          showAvailablePrepaymentsDuringInvoiceEntryFlag: opt.showAvailPrepaymentsFlag === 'Y',
          requireConversionRateEntryForPaymentsFlag: opt.requireConvRateForPmtsFlag === 'Y',
          useDistributionFromPurchaseOrderFlag: opt.useDistFromPoFlag === 'Y',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success('Saved successfully');
      setEditTabs(prev => prev.map(t => t.key === tabKey ? { ...t, dirty: false, option: opt } : t));
      await loadOptions();
    } catch (e: any) {
      message.error(`Save failed: ${e?.message}`);
    }
  };

  const columns = [
    {
      title: 'Business Unit',
      dataIndex: 'businessUnitName',
      key: 'businessUnitName',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    { title: 'Ledger Currency', dataIndex: 'ledgerCurrency', key: 'ledgerCurrency', width: 120 },
    { title: 'Invoice Currency', dataIndex: 'invoiceCurrency', key: 'invoiceCurrency', width: 130 },
    { title: 'Payment Currency', dataIndex: 'paymentCurrency', key: 'paymentCurrency', width: 140 },
    { title: 'Account For Payment', dataIndex: 'accountForPayment', key: 'accountForPayment', width: 160 },
    {
      title: 'FX Gain/Loss Account',
      dataIndex: 'exchangeGainLossAccount',
      key: 'exchangeGainLossAccount',
      render: (v: string) => v
        ? <Tag color="purple" style={{ fontFamily: 'monospace' }}>{v}</Tag>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Invoice Approval',
      dataIndex: 'enableInvoiceApprovalFlag',
      key: 'enableInvoiceApprovalFlag',
      width: 130,
      render: boolTag,
    },
    {
      title: 'Last Sync',
      dataIndex: 'syncDate',
      key: 'syncDate',
      width: 150,
      render: (v: string) => v ? <Text type="secondary" style={{ fontSize: 12 }}>{v?.slice(0, 16).replace('T', ' ')}</Text> : '—',
    },
    {
      title: 'Action',
      key: 'action',
      width: 80,
      render: (_: any, record: SystemOption) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openEditTab(record)}>
          Edit
        </Button>
      ),
    },
  ];

  const SearchTab = (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          placeholder="Business Unit ID"
          value={filterBuId}
          onChange={e => setFilterBuId(e.target.value)}
          onPressEnter={handleSearch}
          allowClear
          onClear={() => { setFilterBuId(''); loadOptions(); }}
          style={{ width: 180 }}
          prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
        />
        <Button type="default" icon={<SearchOutlined />} onClick={handleSearch} loading={loading}>
          Search
        </Button>
        <Divider type="vertical" />
        <Button
          type="primary"
          icon={<SyncOutlined spin={syncing} />}
          loading={syncing}
          onClick={syncFromFusion}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
        >
          Sync from Fusion
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => { setFilterBuId(''); loadOptions(); }} loading={loading}>
          Refresh
        </Button>
        <Badge count={options.length} style={{ background: REDWOOD.info }}>
          <Tag style={{ fontSize: 13, padding: '2px 10px' }}>Records</Tag>
        </Badge>
      </Space>

      {syncLog.length > 0 && (
        <Alert
          type="info"
          style={{ marginBottom: 12, fontFamily: 'monospace', fontSize: 12 }}
          message="Sync Log"
          description={
            <div style={{ maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {syncLog.join('\n')}
            </div>
          }
          closable
          onClose={() => setSyncLog([])}
        />
      )}

      <Table
        dataSource={options}
        columns={columns}
        rowKey="businessUnitId"
        loading={loading}
        size="small"
        bordered
        pagination={{ pageSize: 20 }}
      />
    </div>
  );

  const renderEditTab = (tab: EditTab) => {
    const opt = tab.option;
    const update = (field: keyof SystemOption, value: any) => {
      setEditTabs(prev => prev.map(t =>
        t.key === tab.key ? { ...t, dirty: true, option: { ...t.option, [field]: value } } : t
      ));
    };

    const YNSwitch = (field: keyof SystemOption, label: string) => (
      <Col span={12}>
        <Form.Item label={label}>
          <Switch
            checked={opt[field] === 'Y'}
            onChange={v => update(field, v ? 'Y' : 'N')}
            checkedChildren="Yes"
            unCheckedChildren="No"
          />
        </Form.Item>
      </Col>
    );

    return (
      <div>
        <Space style={{ marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => saveOption(tab.key, opt)}
            style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
          >
            Save
          </Button>
          <Button onClick={() => closeEditTab(tab.key)}>Close</Button>
          {tab.dirty && <Tag color="warning">Unsaved changes</Tag>}
        </Space>

        <Card title="Business Unit Info" size="small" style={{ marginBottom: 12 }}>
          <Descriptions column={3} size="small" bordered>
            <Descriptions.Item label="Business Unit">{opt.businessUnitName}</Descriptions.Item>
            <Descriptions.Item label="BU ID">{opt.businessUnitId}</Descriptions.Item>
            <Descriptions.Item label="Ledger ID">{opt.ledgerId}</Descriptions.Item>
            <Descriptions.Item label="Ledger Currency">{opt.ledgerCurrency}</Descriptions.Item>
            <Descriptions.Item label="Invoice Currency">{opt.invoiceCurrency}</Descriptions.Item>
            <Descriptions.Item label="Payment Currency">{opt.paymentCurrency}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="Custom Settings" size="small" style={{ marginBottom: 12, borderColor: REDWOOD.primary }}>
          <Form layout="vertical" size="small">
            <Form.Item
              label={<span><span style={{ color: REDWOOD.primary }}>★</span> FX Gain/Loss Account</span>}
              help="GL account combination for FX realized gain/loss (e.g. 01-000-7710-0000)"
            >
              <Input
                value={opt.exchangeGainLossAccount ?? ''}
                onChange={e => update('exchangeGainLossAccount', e.target.value)}
                placeholder="e.g. 01-000-7710-0000"
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          </Form>
        </Card>

        <Card title="Payment Settings" size="small" style={{ marginBottom: 12 }}>
          <Form layout="vertical" size="small">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="Pay Date Basis">
                  <Input value={opt.payDateBasis ?? ''} onChange={e => update('payDateBasis', e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Terms Date Basis">
                  <Input value={opt.termsDateBasis ?? ''} onChange={e => update('termsDateBasis', e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Accounting Date Basis">
                  <Input value={opt.accountingDateBasis ?? ''} onChange={e => update('accountingDateBasis', e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Account For Payment">
                  <Input value={opt.accountForPayment ?? ''} onChange={e => update('accountForPayment', e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Payment Priority">
                  <Input type="number" value={opt.paymentPriority ?? ''} onChange={e => update('paymentPriority', Number(e.target.value))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Discount Allocation Method">
                  <Input value={opt.discountAllocationMethod ?? ''} onChange={e => update('discountAllocationMethod', e.target.value)} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Card>

        <Card title="Payment Terms" size="small" style={{ marginBottom: 12 }}>
          <Form layout="vertical" size="small">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="Payment Terms">
                  <Input value={opt.paymentTerms ?? ''} onChange={e => update('paymentTerms', e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Prepayment Terms">
                  <Input value={opt.prepaymentPaymentTerms ?? ''} onChange={e => update('prepaymentPaymentTerms', e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Payment Request Terms">
                  <Input value={opt.paymentRequestPaymentTerms ?? ''} onChange={e => update('paymentRequestPaymentTerms', e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Pay Group">
                  <Input value={opt.payGroup ?? ''} onChange={e => update('payGroup', e.target.value)} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Card>

        <Card title="Approval & Flags" size="small" style={{ marginBottom: 12 }}>
          <Form layout="vertical" size="small">
            <Row gutter={16}>
              {YNSwitch('enableInvoiceApprovalFlag', 'Enable Invoice Approval')}
              {YNSwitch('requireValidationBeforeApproval', 'Require Validation Before Approval')}
              {YNSwitch('allowForceApprovalFlag', 'Allow Force Approval')}
              {YNSwitch('allowAdjustmentsToPaidInvFlag', 'Allow Adjustments to Paid Invoices')}
              {YNSwitch('createInterestInvoicesFlag', 'Create Interest Invoices')}
              {YNSwitch('alwaysTakeDiscFlag', 'Always Take Discount')}
              {YNSwitch('showAvailPrepaymentsFlag', 'Show Available Prepayments')}
              {YNSwitch('requireConvRateForPmtsFlag', 'Require Conversion Rate for Payments')}
              {YNSwitch('useDistFromPoFlag', 'Use Distribution from PO')}
            </Row>
          </Form>
        </Card>

        <Card title="Audit" size="small">
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="Created By">{opt.createdBy}</Descriptions.Item>
            <Descriptions.Item label="Creation Date">{opt.creationDate?.slice(0, 16).replace('T', ' ')}</Descriptions.Item>
            <Descriptions.Item label="Last Updated By">{opt.lastUpdatedBy}</Descriptions.Item>
            <Descriptions.Item label="Last Update Date">{opt.lastUpdateDate?.slice(0, 16).replace('T', ' ')}</Descriptions.Item>
            <Descriptions.Item label="Last Sync">{opt.syncDate?.slice(0, 16).replace('T', ' ')}</Descriptions.Item>
          </Descriptions>
        </Card>
      </div>
    );
  };

  const tabItems = [
    {
      key: 'search',
      label: (
        <span><SearchOutlined /> Search</span>
      ),
      children: SearchTab,
    },
    ...editTabs.map(tab => ({
      key: tab.key,
      label: (
        <span>
          <SettingOutlined />
          {' '}{tab.option.businessUnitName?.split(' ')[0] ?? 'Edit'}
          {tab.dirty && <span style={{ color: REDWOOD.warning }}> •</span>}
        </span>
      ),
      closable: true,
      children: renderEditTab(tab),
    })),
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 24px' }}>
        <Breadcrumb style={{ marginBottom: 12 }}>
          <Breadcrumb.Item href="#/"><HomeOutlined /></Breadcrumb.Item>
          <Breadcrumb.Item>Setup &amp; Maintenance</Breadcrumb.Item>
          <Breadcrumb.Item>Payables</Breadcrumb.Item>
          <Breadcrumb.Item>Payables System Options</Breadcrumb.Item>
        </Breadcrumb>

        <Card
          title={
            <Space>
              <BankOutlined style={{ color: REDWOOD.primary, fontSize: 18 }} />
              <Title level={4} style={{ margin: 0 }}>Manage Payables System Options</Title>
            </Space>
          }
          style={{ borderTop: `3px solid ${REDWOOD.primary}` }}
        >
          <Tabs
            type="editable-card"
            hideAdd
            activeKey={activeTab}
            onChange={setActiveTab}
            onEdit={(key, action) => {
              if (action === 'remove') closeEditTab(key as string);
            }}
            items={tabItems}
          />
        </Card>
      </Content>
    </Layout>
  );
}
