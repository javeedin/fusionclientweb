import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

// Endpoints:
//   BUs:            GET/POST gl/businessunits      (existing — POST is the sync-style {items:[...]} upsert)
//   Legal entities: GET/POST gl/legalentities      (existing — same style)
//   Ledgers:        GET gl/setup/ledgers, POST gl/ledgers/create (patch 129)
// Manual records get ids generated client-side in the reserved 900000001+ range.

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

type Raw = Record<string, unknown>;
const s = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const n = (v: unknown): number | undefined => (v === null || v === undefined || v === '' ? undefined : Number(v));
const fmtTs = (v: unknown): string | undefined => {
  const t = s(v);
  return t ? t.replace('T', ' ').slice(0, 16) : undefined;
};

const mapBu = (i: Raw): BusinessUnit => ({
  businessUnitId: n(i.business_unit_id ?? i.businessUnitId) ?? 0,
  businessUnitName: s(i.business_unit_name ?? i.businessUnitName) ?? '',
  company: s(i.company ?? i.Company),
  activeFlag: s(i.active_flag ?? i.activeFlag),
  profitCenterFlag: s(i.profit_center_flag ?? i.profitCenterFlag),
  legalEntityId: n(i.legal_entity_id ?? i.legalEntityId),
  legalEntityName: s(i.legal_entity_name ?? i.legalEntityName),
  primaryLedgerId: n(i.primary_ledger_id ?? i.primaryLedgerId),
  ledger: s(i.ledger ?? i.Ledger),
  createdBy: s(i.created_by ?? i.createdBy),
  creationDate: fmtTs(i.creation_date ?? i.creationDate),
  syncDate: fmtTs(i.sync_date ?? i.syncDate),
});

const mapLe = (i: Raw): LegalEntity => ({
  legalEntityId: n(i.legal_entity_id ?? i.legalEntityId) ?? 0,
  name: s(i.name ?? i.Name) ?? '',
  legalEntityIdentifier: s(i.legal_entity_identifier ?? i.legalEntityIdentifier),
  createdBy: s(i.created_by ?? i.createdBy),
  creationDate: fmtTs(i.creation_date ?? i.creationDate),
  syncDate: fmtTs(i.sync_date ?? i.syncDate),
});

const mapLedger = (i: Raw): Ledger => ({
  ledgerId: n(i.ledger_id ?? i.ledgerId) ?? 0,
  ledgerName: s(i.ledger_name ?? i.ledgerName) ?? '',
  description: s(i.description),
  currencyCode: s(i.currency_code ?? i.currencyCode),
  ledgerCategoryCode: s(i.ledger_category_code ?? i.ledgerCategoryCode),
  createdBy: s(i.created_by ?? i.createdBy),
  creationDate: fmtTs(i.creation_date ?? i.creationDate),
});

const getItems = async (url: string): Promise<Raw[]> => {
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
  const text = await res.text();
  let data: { status?: string; success?: boolean; message?: string; businessUnitId?: number; legalEntityId?: number; ledgerId?: number } = {};
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  const ok = res.ok && data.status !== 'error' && data.success !== false;
  return {
    ok,
    message: data.message || (ok ? 'Saved' : `HTTP ${res.status}: ${text.slice(0, 200)}`),
    id: data.businessUnitId ?? data.legalEntityId ?? data.ledgerId,
  };
};

// Manual ids live in a reserved range so they never collide with Fusion ids
const MANUAL_MIN = 900000001;
const MANUAL_MAX = 999999999;
const nextManualId = (ids: (number | undefined)[]): number => {
  const inRange = ids.filter((v): v is number => v !== undefined && v >= MANUAL_MIN && v <= MANUAL_MAX);
  return inRange.length ? Math.max(...inRange) + 1 : MANUAL_MIN;
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
      setBus((await getItems(`${APEX}/gl/businessunits`)).map(mapBu));
    } catch (e) {
      message.error(`Could not load business units: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPickers = useCallback(async () => {
    try {
      const [leList, ledgerList] = await Promise.all([
        getItems(`${APEX}/gl/legalentities`),
        getItems(`${APEX}/gl/setup/ledgers`),
      ]);
      setLes(leList.map(mapLe));
      setLedgers(ledgerList.map(mapLedger));
    } catch { /* pickers load lazily — surfaced when dialogs open */ }
  }, []);

  useEffect(() => { loadBus(); }, [loadBus]);
  useEffect(() => { loadPickers(); }, [loadPickers]);

  // live client-side filtering (the existing GET has no filter parameters)
  const filteredBus = useMemo(() => bus.filter(b =>
    (!search || b.businessUnitName.toUpperCase().includes(search.toUpperCase())) &&
    (!activeFilter || (b.activeFlag ?? 'Y').toUpperCase() === activeFilter),
  ), [bus, search, activeFilter]);

  // ── create handlers ────────────────────────────────────────────────────────
  const createLegalEntity = async () => {
    const v = await leForm.validateFields();
    const dup = les.some(le => le.name.toUpperCase() === String(v.name).trim().toUpperCase());
    if (dup) { message.error(`Legal entity "${v.name}" already exists`); return; }
    const newId = nextManualId(les.map(le => le.legalEntityId));
    setSaving(true);
    // existing sync-style POST: {items:[{PascalCase fields}]}
    const r = await postJson(`${APEX}/gl/legalentities`, {
      items: [{
        LegalEntityId: newId,
        Name: String(v.name).trim(),
        LegalEntityIdentifier: v.identifier || null,
        EffectiveFrom: null,
        EffectiveTo: null,
        PartyId: null,
        CreatedBy: currentUser,
        CreationDate: new Date().toISOString(),
        LastUpdateDate: null,
        LastUpdateLogin: null,
        LastUpdatedBy: null,
      }],
    });
    setSaving(false);
    if (!r.ok) { message.error(r.message); return; }
    message.success(`Legal entity created (id ${newId})`);
    setLeOpen(false);
    leForm.resetFields();
    await loadPickers();
    if (buOpen) buForm.setFieldValue('legalEntityId', newId);
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
    const dup = bus.some(b => b.businessUnitName.toUpperCase() === String(v.businessUnitName).trim().toUpperCase());
    if (dup) { message.error(`Business unit "${v.businessUnitName}" already exists`); return; }
    const le = les.find(x => x.legalEntityId === v.legalEntityId);
    const ldg = ledgers.find(x => x.ledgerId === v.primaryLedgerId);
    const newId = nextManualId(bus.map(b => b.businessUnitId));
    setSaving(true);
    // existing sync-style POST: {items:[{PascalCase fields}]}; the extra
    // name/audit fields are included for handlers that map them and are
    // ignored otherwise
    const r = await postJson(`${APEX}/gl/businessunits`, {
      items: [{
        BusinessUnitId: newId,
        BusinessUnitName: String(v.businessUnitName).trim(),
        ActiveFlag: 'Y',
        PrimaryLedgerId: v.primaryLedgerId,
        LocationId: null,
        ManagerId: null,
        LegalEntityId: v.legalEntityId,
        ProfitCenterFlag: v.profitCenterFlag ? 'Y' : 'N',
        Company: v.company,
        LegalEntityName: le?.name || '',
        Ledger: ldg?.ledgerName || '',
        CreatedBy: currentUser,
        CreationDate: new Date().toISOString(),
      }],
    });
    setSaving(false);
    if (!r.ok) { message.error(r.message); return; }
    message.success(`Business unit created (id ${newId})`);
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
              label: <span><ApartmentOutlined /> Business Units ({filteredBus.length})</span>,
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
                    />
                    <Select
                      placeholder="Active?"
                      allowClear
                      style={{ width: 110 }}
                      value={activeFilter}
                      onChange={setActiveFilter}
                      options={[{ value: 'Y', label: 'Active' }, { value: 'N', label: 'Inactive' }]}
                    />
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
                    dataSource={filteredBus}
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
