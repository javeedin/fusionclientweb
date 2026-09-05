import React, { useCallback, useEffect, useState } from 'react';
import {
  Breadcrumb, Button, Card, Divider, Form, Input, Modal, Select, Space, Switch,
  Table, Tabs, Tag, Tooltip, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ApartmentOutlined, BankOutlined, HomeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';

const { Title, Text } = Typography;
const APEX = APEX_DB_CONFIG.baseUrl;

interface BusinessUnit {
  businessUnitId: number;
  businessUnitName: string;
  company?: string;
  activeFlag?: string;
  profitCenterFlag?: string;
  legalEntityId?: number;
  legalEntityName?: string;
  primaryLedgerId?: number;
  ledger?: string;
  createdBy?: string;
  creationDate?: string;
  syncDate?: string;
}

interface LegalEntity {
  legalEntityId: number;
  name: string;
  legalEntityIdentifier?: string;
  createdBy?: string;
  creationDate?: string;
  syncDate?: string;
}

interface Ledger {
  ledgerId: number;
  ledgerName: string;
  description?: string;
  currencyCode?: string;
  ledgerCategoryCode?: string;
  createdBy?: string;
  creationDate?: string;
}

const getItems = async <T,>(url: string): Promise<T[]> => {
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.items || [];
};

const postJson = async (url: string, body: unknown): Promise<{ ok: boolean; message: string; id?: number }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok && data.success !== false,
    message: data.message || (res.ok ? 'Saved' : `HTTP ${res.status}`),
    id: data.businessUnitId ?? data.legalEntityId ?? data.ledgerId,
  };
};

const ManageBusinessUnits: React.FC = () => {
  const { user } = useAuth();
  const currentUser = (user as { username?: string; name?: string } | null)?.username
    ?? (user as { name?: string } | null)?.name ?? 'REERP';

  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [les, setLes] = useState<LegalEntity[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | undefined>();

  const [buOpen, setBuOpen] = useState(false);
  const [leOpen, setLeOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [buForm] = Form.useForm();
  const [leForm] = Form.useForm();
  const [ledgerForm] = Form.useForm();

  const loadBus = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (activeFilter) p.set('active', activeFilter);
      setBus(await getItems<BusinessUnit>(`${APEX}/gl/businessunits/list?${p.toString()}`));
    } catch (e) {
      message.error(`Could not load business units: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter]);

  const loadPickers = useCallback(async () => {
    try {
      const [leList, ledgerList] = await Promise.all([
        getItems<LegalEntity>(`${APEX}/gl/setup/legalentities`),
        getItems<Ledger>(`${APEX}/gl/setup/ledgers`),
      ]);
      setLes(leList);
      setLedgers(ledgerList);
    } catch { /* pickers load lazily — surfaced when dialogs open */ }
  }, []);

  useEffect(() => { loadBus(); }, [loadBus]);
  useEffect(() => { loadPickers(); }, [loadPickers]);

  // ── create handlers ────────────────────────────────────────────────────────
  const createLegalEntity = async () => {
    const v = await leForm.validateFields();
    setSaving(true);
    const r = await postJson(`${APEX}/gl/legalentities/create`, {
      name: v.name, legalEntityIdentifier: v.identifier, createdBy: currentUser,
    });
    setSaving(false);
    if (!r.ok) { message.error(r.message); return; }
    message.success(`Legal entity created (id ${r.id})`);
    setLeOpen(false);
    leForm.resetFields();
    await loadPickers();
    if (buOpen && r.id) buForm.setFieldValue('legalEntityId', r.id);
  };

  const createLedger = async () => {
    const v = await ledgerForm.validateFields();
    setSaving(true);
    const r = await postJson(`${APEX}/gl/ledgers/create`, {
      ledgerName: v.ledgerName, description: v.description, currencyCode: v.currencyCode || 'AED', createdBy: currentUser,
    });
    setSaving(false);
    if (!r.ok) { message.error(r.message); return; }
    message.success(`Ledger created (id ${r.id})`);
    setLedgerOpen(false);
    ledgerForm.resetFields();
    await loadPickers();
    if (buOpen && r.id) buForm.setFieldValue('primaryLedgerId', r.id);
  };

  const createBusinessUnit = async () => {
    const v = await buForm.validateFields();
    const le = les.find(x => x.legalEntityId === v.legalEntityId);
    const ldg = ledgers.find(x => x.ledgerId === v.primaryLedgerId);
    setSaving(true);
    const r = await postJson(`${APEX}/gl/businessunits/create`, {
      businessUnitName: v.businessUnitName,
      company: v.company,
      legalEntityId: v.legalEntityId,
      legalEntityName: le?.name || '',
      primaryLedgerId: v.primaryLedgerId,
      ledger: ldg?.ledgerName || '',
      profitCenterFlag: v.profitCenterFlag ? 'Y' : 'N',
      createdBy: currentUser,
    });
    setSaving(false);
    if (!r.ok) { message.error(r.message); return; }
    message.success(`Business unit created (id ${r.id})`);
    setBuOpen(false);
    buForm.resetFields();
    loadBus();
  };

  // ── columns ────────────────────────────────────────────────────────────────
  const buCols: ColumnsType<BusinessUnit> = [
    { title: 'BU ID', dataIndex: 'businessUnitId', width: 130 },
    { title: 'Business Unit', dataIndex: 'businessUnitName', width: 260, sorter: (a, b) => (a.businessUnitName || '').localeCompare(b.businessUnitName || '') },
    { title: 'Company', dataIndex: 'company', width: 90, align: 'center' },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', width: 240, ellipsis: true },
    { title: 'Ledger', dataIndex: 'ledger', width: 180, ellipsis: true },
    {
      title: 'Active', dataIndex: 'activeFlag', width: 80, align: 'center',
      render: (v?: string) => <Tag color={(v ?? 'Y') === 'Y' ? 'green' : 'red'}>{(v ?? 'Y') === 'Y' ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: 'Profit Center', dataIndex: 'profitCenterFlag', width: 110, align: 'center',
      render: (v?: string) => (v === 'Y' ? <Tag color="blue">Yes</Tag> : <Text type="secondary">No</Text>),
    },
    { title: 'Created By', dataIndex: 'createdBy', width: 120, render: (v?: string) => v || <Text type="secondary">sync</Text> },
    { title: 'Creation Date', dataIndex: 'creationDate', width: 140, render: (v?: string) => v || '—' },
    { title: 'Sync Date', dataIndex: 'syncDate', width: 140, render: (v?: string) => v || '—' },
  ];

  const leCols: ColumnsType<LegalEntity> = [
    { title: 'LE ID', dataIndex: 'legalEntityId', width: 140 },
    { title: 'Name', dataIndex: 'name', sorter: (a, b) => (a.name || '').localeCompare(b.name || '') },
    { title: 'Identifier', dataIndex: 'legalEntityIdentifier', width: 160 },
    { title: 'Created By', dataIndex: 'createdBy', width: 120, render: (v?: string) => v || <Text type="secondary">sync</Text> },
    { title: 'Creation Date', dataIndex: 'creationDate', width: 140, render: (v?: string) => v || '—' },
  ];

  const ledgerCols: ColumnsType<Ledger> = [
    { title: 'Ledger ID', dataIndex: 'ledgerId', width: 140 },
    { title: 'Ledger', dataIndex: 'ledgerName', sorter: (a, b) => (a.ledgerName || '').localeCompare(b.ledgerName || '') },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    { title: 'Currency', dataIndex: 'currencyCode', width: 100, align: 'center' },
    { title: 'Created By', dataIndex: 'createdBy', width: 120, render: (v?: string) => v || <Text type="secondary">sync</Text> },
    { title: 'Creation Date', dataIndex: 'creationDate', width: 140, render: (v?: string) => v || '—' },
  ];

  const pickerFooter = (label: string, onClick: () => void) => (menu: React.ReactNode) => (
    <>
      {menu}
      <Divider style={{ margin: '6px 0' }} />
      <Button type="link" icon={<PlusOutlined />} onClick={onClick} style={{ paddingLeft: 8 }}>
        {label}
      </Button>
    </>
  );

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        items={[
          { title: <Link to="/home"><HomeOutlined /> Home</Link> },
          { title: <Link to="/gl">General Ledger</Link> },
          { title: 'Manage Business Units' },
        ]}
        style={{ marginBottom: 12 }}
      />
      <Title level={4} style={{ marginTop: 0 }}><ApartmentOutlined /> Manage Business Units</Title>

      <Card>
        <Tabs
          defaultActiveKey="bus"
          items={[
            {
              key: 'bus',
              label: <span><ApartmentOutlined /> Business Units ({bus.length})</span>,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Input
                      placeholder="Search business unit name"
                      prefix={<SearchOutlined />}
                      allowClear
                      style={{ width: 260 }}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      onPressEnter={loadBus}
                    />
                    <Select
                      placeholder="Active?"
                      allowClear
                      style={{ width: 110 }}
                      value={activeFilter}
                      onChange={setActiveFilter}
                      options={[{ value: 'Y', label: 'Active' }, { value: 'N', label: 'Inactive' }]}
                    />
                    <Button icon={<SearchOutlined />} onClick={loadBus}>Search</Button>
                    <Tooltip title="Reload"><Button icon={<ReloadOutlined />} onClick={() => { loadBus(); loadPickers(); }} /></Tooltip>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => { setBuOpen(true); loadPickers(); }}>
                      Create Business Unit
                    </Button>
                  </Space>
                  <Table
                    size="small"
                    rowKey="businessUnitId"
                    loading={loading}
                    columns={buCols}
                    dataSource={bus}
                    scroll={{ x: 'max-content' }}
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} business units` }}
                  />
                </>
              ),
            },
            {
              key: 'les',
              label: <span><BankOutlined /> Legal Entities ({les.length})</span>,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Tooltip title="Reload"><Button icon={<ReloadOutlined />} onClick={loadPickers} /></Tooltip>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setLeOpen(true)}>New Legal Entity</Button>
                  </Space>
                  <Table size="small" rowKey="legalEntityId" columns={leCols} dataSource={les}
                    scroll={{ x: 'max-content' }} pagination={{ pageSize: 20, showTotal: t => `${t} legal entities` }} />
                </>
              ),
            },
            {
              key: 'ledgers',
              label: <span><BankOutlined /> Ledgers ({ledgers.length})</span>,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Tooltip title="Reload"><Button icon={<ReloadOutlined />} onClick={loadPickers} /></Tooltip>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setLedgerOpen(true)}>New Ledger</Button>
                  </Space>
                  <Table size="small" rowKey="ledgerId" columns={ledgerCols} dataSource={ledgers}
                    scroll={{ x: 'max-content' }} pagination={{ pageSize: 20, showTotal: t => `${t} ledgers` }} />
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Create Business Unit ── */}
      <Modal
        title={<span><ApartmentOutlined /> Create Business Unit</span>}
        open={buOpen}
        onCancel={() => setBuOpen(false)}
        onOk={createBusinessUnit}
        okText="Create"
        confirmLoading={saving}
        width={560}
        destroyOnClose
      >
        <Form form={buForm} layout="vertical" initialValues={{ profitCenterFlag: false }}>
          <Form.Item name="businessUnitName" label="Business Unit Name" rules={[{ required: true, message: 'Enter the business unit name' }]}>
            <Input maxLength={360} placeholder="e.g. BUIMERC CORP_DIFC_TRADING" />
          </Form.Item>
          <Form.Item
            name="company" label="Company Code"
            rules={[{ required: true, message: 'Enter the company code' }, { max: 5, message: 'Max 5 characters' }]}
            normalize={(v: string) => (v || '').toUpperCase()}
          >
            <Input maxLength={5} style={{ width: 140 }} placeholder="e.g. 01" />
          </Form.Item>
          <Form.Item name="legalEntityId" label="Legal Entity" rules={[{ required: true, message: 'Pick or create a legal entity' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select legal entity"
              options={les.map(le => ({ value: le.legalEntityId, label: `${le.name}${le.legalEntityIdentifier ? ` (${le.legalEntityIdentifier})` : ''}` }))}
              dropdownRender={pickerFooter('Create new Legal Entity', () => setLeOpen(true))}
            />
          </Form.Item>
          <Form.Item name="primaryLedgerId" label="Ledger" rules={[{ required: true, message: 'Pick or create a ledger' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select ledger"
              options={ledgers.map(l => ({ value: l.ledgerId, label: `${l.ledgerName}${l.currencyCode ? ` (${l.currencyCode})` : ''}` }))}
              dropdownRender={pickerFooter('Create new Ledger', () => setLedgerOpen(true))}
            />
          </Form.Item>
          <Form.Item name="profitCenterFlag" label="Profit Center" valuePropName="checked">
            <Switch checkedChildren="Yes" unCheckedChildren="No" />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Created as Active, by {currentUser}. Manual records get IDs in the 900000001+ range so they never clash with Fusion-synced data.
          </Text>
        </Form>
      </Modal>

      {/* ── Create Legal Entity ── */}
      <Modal
        title={<span><BankOutlined /> Create Legal Entity</span>}
        open={leOpen}
        onCancel={() => setLeOpen(false)}
        onOk={createLegalEntity}
        okText="Create"
        confirmLoading={saving}
        width={480}
        destroyOnClose
      >
        <Form form={leForm} layout="vertical">
          <Form.Item name="name" label="Legal Entity Name" rules={[{ required: true, message: 'Enter the legal entity name' }]}>
            <Input maxLength={360} placeholder="e.g. BUIMERC CORPORATION LIMITED" />
          </Form.Item>
          <Form.Item name="identifier" label="Legal Entity Identifier">
            <Input maxLength={60} placeholder="Optional — registration / identifier" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Create Ledger ── */}
      <Modal
        title={<span><BankOutlined /> Create Ledger</span>}
        open={ledgerOpen}
        onCancel={() => setLedgerOpen(false)}
        onOk={createLedger}
        okText="Create"
        confirmLoading={saving}
        width={480}
        destroyOnClose
      >
        <Form form={ledgerForm} layout="vertical" initialValues={{ currencyCode: 'AED' }}>
          <Form.Item name="ledgerName" label="Ledger Name" rules={[{ required: true, message: 'Enter the ledger name' }]}>
            <Input maxLength={100} placeholder="e.g. BUIMERC LEDGER" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="currencyCode" label="Currency" rules={[{ required: true }]}>
            <Select
              showSearch
              style={{ width: 160 }}
              options={['AED', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD'].map(c => ({ value: c, label: c }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ManageBusinessUnits;
