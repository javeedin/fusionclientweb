import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Layout, Card, Form, Input, Button, Space, Typography, Table, Tabs,
  Breadcrumb, Tooltip, message, Tag, Spin, Descriptions, Badge, Empty, Alert,
  Modal, Select,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined,
  UserOutlined, BankOutlined, IdcardOutlined, DownloadOutlined,
  ApiOutlined, CopyOutlined, CloseOutlined, EnvironmentOutlined,
  ApartmentOutlined, InfoCircleOutlined, PlusOutlined, EditOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import FloatingMenu from '../../components/FloatingMenu';
import AccountSelector from '../../components/AccountSelector';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  surface:    '#FFFFFF',
  border:     '#E5E5E5',
};

const BASE = APEX_DB_CONFIG.baseUrl;

// ── Types ────────────────────────────────────────────────────────────────────

interface PartyRow {
  key: string;
  partyId: number;
  partyNumber: string;
  partyName: string;
  partyType: string;
  country: string;
  address1: string;
  address2: string;
  city: string;
  status: string;
}

interface PartyTab {
  key: string;
  party: PartyRow;
  detail: Record<string, any> | null;   // raw /ar/parties/:id row
  detailLoading: boolean;
  detailUrl: string;
  accounts: BuAssignment[];              // RR_BU_ACCOUNTS_ASSIGNMENTS rows for the party
  accountsLoading: boolean;
  accountsLoaded: boolean;
  accountsUrl: string;
  accountsError: string;
}

// One row of RR_BU_ACCOUNTS_ASSIGNMENTS (keys as the GET handler emits them)
interface BuAssignment {
  assignmentId: number;
  partyId: number;
  partyName: string | null;
  businessUnitName: string;
  companyCode: string | null;
  receivablesAccount: string | null;
  revenueAccount: string | null;
  taxAccount: string | null;
  freightAccount: string | null;
  unbilledAccount: string | null;
  unearnedAccount: string | null;
  clearingAccount: string | null;
  status: string | null;
}

// Account types assignable per BU (Fusion AutoAccounting classes)
const ACCOUNT_TYPES: { key: keyof BuAssignment & string; label: string }[] = [
  { key: 'receivablesAccount', label: 'Receivables' },
  { key: 'revenueAccount',     label: 'Revenue' },
  { key: 'taxAccount',         label: 'Tax' },
  { key: 'freightAccount',     label: 'Freight' },
  { key: 'unbilledAccount',    label: 'Unbilled Receivable' },
  { key: 'unearnedAccount',    label: 'Unearned Revenue' },
  { key: 'clearingAccount',    label: 'AutoInvoice Clearing' },
];

// Draft being edited in the Assign/Edit BU dialog
interface BuDraft {
  assignmentId?: number;
  businessUnitName: string;
  companyCode: string;
  accounts: Record<string, string>;   // ACCOUNT_TYPES key -> code combination
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const prettyKey = (k: string) =>
  k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Uppercase display so the grid is uniform regardless of how the data is stored;
// filtering stays case-insensitive so any-case input still matches.
const up = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  return v.toString().toUpperCase();
};

const fmtVal = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
};

const statusColor = (s: string) => {
  const u = (s || '').toUpperCase();
  if (u === 'A' || u === 'ACTIVE') return 'green';
  if (u === 'I' || u === 'INACTIVE') return 'red';
  return 'default';
};

// ── Component ─────────────────────────────────────────────────────────────────

const ManageCustomers: React.FC = () => {
  const [form] = Form.useForm();

  // Search state
  const [searching, setSearching]     = useState(false);
  const [parties, setParties]         = useState<PartyRow[]>([]);
  const [searched, setSearched]       = useState(false);
  const [lastUrl, setLastUrl]         = useState('');   // last search endpoint (API icon)
  const [searchError, setSearchError] = useState('');   // last search error
  const [gridFilter, setGridFilter]   = useState('');   // client-side quick filter on results

  // Tabs state
  const [tabs, setTabs]               = useState<PartyTab[]>([]);
  const [activeKey, setActiveKey]     = useState<string>('search');

  const loadedRef = useRef<Set<string>>(new Set());

  // ── Search parties ──────────────────────────────────────────────────────────

  const handleSearch = useCallback(async (values: any) => {
    setSearching(true);
    setSearched(false);
    setSearchError('');
    setGridFilter('');
    const p = new URLSearchParams();
    if (values.q) p.append('q', values.q);
    if (values.status) p.append('status', values.status);
    const url = `${BASE}/ar/parties?${p}`;
    setLastUrl(url);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON body */ }
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status} — ${raw.slice(0, 300) || res.statusText}`);
      }
      const items: any[] = data.items ?? data.rows ?? (Array.isArray(data) ? data : []);
      setParties(items.map((r: any, i: number) => ({
        key:         String(r.party_id ?? r.PARTY_ID ?? i),
        partyId:     r.party_id      ?? r.PARTY_ID      ?? 0,
        partyNumber: r.party_number  ?? r.PARTY_NUMBER  ?? '',
        partyName:   r.party_name    ?? r.PARTY_NAME    ?? '',
        partyType:   r.party_type    ?? r.PARTY_TYPE    ?? '',
        country:     r.country       ?? r.COUNTRY       ?? '',
        address1:    r.address1      ?? r.ADDRESS1      ?? '',
        address2:    r.address2      ?? r.ADDRESS2      ?? '',
        city:        r.city          ?? r.CITY          ?? '',
        status:      r.status        ?? r.STATUS        ?? '',
      })));
      setSearched(true);
    } catch (e: any) {
      setSearchError(e.message || String(e));
      setSearched(true);
      message.error('Party search failed: ' + e.message);
    } finally {
      setSearching(false);
    }
  }, []);

  // ── Open party tab ────────────────────────────────────────────────────────

  const openPartyTab = useCallback((party: PartyRow) => {
    const key = `party-${party.partyId}`;
    if (tabs.find(t => t.key === key)) { setActiveKey(key); return; }
    const detailUrl   = `${BASE}/ar/parties/${party.partyId}`;
    const accountsUrl = `GET ${BASE}/ar/buaccounts?party_id=${party.partyId}`;
    setTabs(prev => [...prev, {
      key, party,
      detail: null, detailLoading: false, detailUrl,
      accounts: [], accountsLoading: false, accountsLoaded: false, accountsUrl, accountsError: '',
    }]);
    setActiveKey(key);
    loadDetail(key, party.partyId);
    loadAccounts(key, party);
  }, [tabs]);

  // ── Load party detail ─────────────────────────────────────────────────────

  const loadDetail = useCallback(async (tabKey: string, partyId: number) => {
    if (loadedRef.current.has(`detail-${tabKey}`)) return;
    loadedRef.current.add(`detail-${tabKey}`);
    setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, detailLoading: true } : t));
    try {
      const res  = await fetch(`${BASE}/ar/parties/${partyId}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const item = (data.items ?? data.rows ?? (Array.isArray(data) ? data : []))[0] ?? null;
      setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, detailLoading: false, detail: item } : t));
    } catch {
      loadedRef.current.delete(`detail-${tabKey}`);
      setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, detailLoading: false } : t));
    }
  }, []);

  // ── Load BU account assignments (RR_BU_ACCOUNTS_ASSIGNMENTS) ──────────────
  const loadAccounts = useCallback(async (tabKey: string, party: PartyRow) => {
    if (loadedRef.current.has(`acct-${tabKey}`)) return;
    loadedRef.current.add(`acct-${tabKey}`);
    const url = `${BASE}/ar/buaccounts?party_id=${party.partyId}`;
    setTabs(prev => prev.map(t => t.key === tabKey
      ? { ...t, accountsLoading: true, accountsError: '', accountsUrl: `GET ${url}` } : t));
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON */ }
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || `HTTP ${res.status} — ${raw.slice(0, 200)} (run DB script 154 if the endpoint is missing)`);
      }
      const items: BuAssignment[] = data.items ?? [];
      setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, accountsLoading: false, accounts: items, accountsLoaded: true } : t));
    } catch (e: any) {
      loadedRef.current.delete(`acct-${tabKey}`);
      setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, accountsLoading: false, accountsLoaded: true, accountsError: e.message || String(e) } : t));
    }
  }, []);

  // ── Business units (for the Assign BU dialog; company code drives the
  //     locked first segment of every account picker) ───────────────────────
  const [businessUnits, setBusinessUnits] = useState<{ name: string; companyCode: string }[]>([]);
  useEffect(() => {
    fetch(`${BASE}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        setBusinessUnits(
          ((data.items || []) as any[])
            .map((i: any) => ({ name: i.business_unit_name || '', companyCode: i.company_code ?? i.company ?? '' }))
            .filter(b => b.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => {});
  }, []);

  // ── Assign / edit BU accounts dialog ──────────────────────────────────────
  const [buModal, setBuModal]   = useState<{ tabKey: string; party: PartyRow; draft: BuDraft } | null>(null);
  const [savingBu, setSavingBu] = useState(false);
  // which ACCOUNT_TYPES key the AccountSelector is currently picking for
  const [acctPickKey, setAcctPickKey] = useState<string | null>(null);

  const openBuModal = (tabKey: string, party: PartyRow, existing?: BuAssignment) => {
    const accounts: Record<string, string> = {};
    if (existing) ACCOUNT_TYPES.forEach(t => { accounts[t.key] = String(existing[t.key] ?? ''); });
    setBuModal({
      tabKey, party,
      draft: existing
        ? { assignmentId: existing.assignmentId, businessUnitName: existing.businessUnitName,
            companyCode: existing.companyCode || '', accounts }
        : { businessUnitName: '', companyCode: '', accounts: {} },
    });
  };

  const saveBuAssignment = async () => {
    if (!buModal) return;
    const { tabKey, party, draft } = buModal;
    if (!draft.businessUnitName) { message.error('Select a business unit'); return; }
    if (!ACCOUNT_TYPES.some(t => draft.accounts[t.key])) { message.error('Assign at least one account'); return; }
    setSavingBu(true);
    let user = 'REACTERP';
    try {
      const u = JSON.parse(localStorage.getItem('erp_user') || 'null');
      user = u?.email || u?.username || 'REACTERP';
    } catch { /* fall back */ }
    const body: Record<string, any> = {
      partyId: party.partyId,
      partyName: party.partyName,
      businessUnitName: draft.businessUnitName,
      companyCode: draft.companyCode,
      createdBy: user,
      updatedBy: user,
    };
    ACCOUNT_TYPES.forEach(t => { body[t.key] = draft.accounts[t.key] || null; });
    // first time → POST creates the row; existing assignment → PUT updates it
    const url = draft.assignmentId
      ? `${BASE}/ar/buaccounts/${draft.assignmentId}`
      : `${BASE}/ar/buaccounts`;
    try {
      const res = await fetch(url, {
        method: draft.assignmentId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
      message.success(draft.assignmentId
        ? `Assignment updated (${draft.businessUnitName})`
        : `Business unit ${draft.businessUnitName} assigned`);
      setBuModal(null);
      loadedRef.current.delete(`acct-${tabKey}`);
      loadAccounts(tabKey, party);
    } catch (e: any) {
      message.error('Save failed: ' + (e.message || String(e)));
    } finally {
      setSavingBu(false);
    }
  };

  // ── Close tab ─────────────────────────────────────────────────────────────

  const closeTab = (key: string) => {
    const idx = tabs.findIndex(t => t.key === key);
    const nextKey = idx > 0 ? tabs[idx - 1].key : 'search';
    setTabs(prev => prev.filter(t => t.key !== key));
    loadedRef.current.delete(`detail-${key}`);
    loadedRef.current.delete(`acct-${key}`);
    if (activeKey === key) setActiveKey(nextKey);
  };

  // ── Export parties ──────────────────────────────────────────────────────────

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(parties.map(r => ({
      'Party Number': r.partyNumber,
      'Party Name':   r.partyName,
      'Party Type':   r.partyType,
      'Country':      r.country,
      'Address 1':    r.address1,
      'Address 2':    r.address2,
      'City':         r.city,
      'Status':       r.status,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Parties');
    XLSX.writeFile(wb, 'parties.xlsx');
  };

  // ── Per-column search filter (funnel on each column header) ────────────────

  const colSearch = (dataIndex: keyof PartyRow) => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
      <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          placeholder="Filter…"
          value={selectedKeys[0]}
          onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => confirm()}
          style={{ width: 200, marginBottom: 8, display: 'block' }}
        />
        <Space>
          <Button type="primary" size="small" icon={<SearchOutlined />} onClick={() => confirm()} style={{ width: 90 }}>
            Filter
          </Button>
          <Button size="small" onClick={() => { clearFilters?.(); confirm(); }} style={{ width: 90 }}>
            Reset
          </Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => (
      <SearchOutlined style={{ color: filtered ? REDWOOD.primary : undefined }} />
    ),
    onFilter: (value: any, record: PartyRow) =>
      (record[dataIndex] ?? '').toString().toLowerCase().includes(String(value).toLowerCase()),
  });

  // ── Search columns ────────────────────────────────────────────────────────

  const searchColumns: ColumnsType<PartyRow> = [
    {
      title: 'Party Name', dataIndex: 'partyName', key: 'partyName', fixed: 'left', width: 260,
      ...colSearch('partyName'),
      sorter: (a, b) => (a.partyName || '').localeCompare(b.partyName || ''),
      render: (v: string, r: PartyRow) => (
        <Button type="link" style={{ padding: 0, textAlign: 'left', height: 'auto', fontSize: 13, fontWeight: 600, color: REDWOOD.info }}
          onClick={() => openPartyTab(r)}>
          {up(v)}
        </Button>
      ),
    },
    { title: 'Party #', dataIndex: 'partyNumber', width: 130, ...colSearch('partyNumber'),
      sorter: (a, b) => (a.partyNumber || '').localeCompare(b.partyNumber || ''),
      render: (v: string) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{up(v)}</Text> },
    { title: 'Type', dataIndex: 'partyType', width: 130, ...colSearch('partyType'),
      render: (v: string) => <Text style={{ fontSize: 12 }}>{up(v)}</Text> },
    { title: 'Country', dataIndex: 'country', width: 100, ...colSearch('country'),
      render: (v: string) => <Text style={{ fontSize: 12 }}>{up(v)}</Text> },
    { title: 'City', dataIndex: 'city', width: 120, ...colSearch('city'),
      render: (v: string) => <Text style={{ fontSize: 12 }}>{up(v)}</Text> },
    { title: 'Address', dataIndex: 'address1', width: 240, ellipsis: true, ...colSearch('address1'),
      render: (_: any, r: PartyRow) => {
        const a = [r.address1, r.address2].filter(Boolean).join(', ');
        return <Tooltip title={up(a)}><Text style={{ fontSize: 12 }}>{up(a)}</Text></Tooltip>;
      } },
    { title: 'Status', dataIndex: 'status', width: 100, ...colSearch('status'),
      render: (v: string) => <Tag color={statusColor(v)} style={{ fontSize: 11 }}>{up(v)}</Tag> },
    {
      title: '', key: 'open', width: 90, fixed: 'right',
      render: (_: any, r: PartyRow) => (
        <Button size="small" icon={<ApartmentOutlined />} onClick={() => openPartyTab(r)} style={{ fontSize: 11 }}>
          Accounts
        </Button>
      ),
    },
  ];

  // ── Party detail + accounts panel ─────────────────────────────────────────

  const renderPartyDetail = (tab: PartyTab) => {
    const p = tab.party;
    const detail = tab.detail;
    const acctCell = (v: string | null) => v
      ? <Tooltip title={v}><Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text></Tooltip>
      : <Text type="secondary">—</Text>;
    const accountsCols: ColumnsType<BuAssignment> = [
      { title: 'Business Unit', dataIndex: 'businessUnitName', key: 'bu', fixed: 'left', width: 200,
        render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
      { title: 'Company', dataIndex: 'companyCode', key: 'co', width: 90, align: 'center',
        render: (v: string) => v ? <Tag color="geekblue" style={{ fontFamily: 'monospace' }}>{v}</Tag> : '—' },
      ...ACCOUNT_TYPES.map(t => ({
        title: t.label, dataIndex: t.key, key: t.key, width: 210,
        render: (v: string | null) => acctCell(v),
      })),
      { title: 'Status', dataIndex: 'status', key: 'st', width: 90,
        render: (v: string) => <Tag color={statusColor(v || '')} style={{ fontSize: 11 }}>{v || '—'}</Tag> },
      { title: '', key: 'edit', width: 70, fixed: 'right',
        render: (_: any, r: BuAssignment) => (
          <Button size="small" icon={<EditOutlined />} style={{ fontSize: 11 }}
            onClick={() => openBuModal(tab.key, p, r)}>Edit</Button>
        ) },
    ];

    return (
      <div style={{ padding: '0 4px' }}>
        {/* ── Party detail ── */}
        <Card
          size="small"
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.border}`, marginBottom: 16 }}
          title={
            <Space>
              <UserOutlined style={{ color: REDWOOD.primary }} />
              <span style={{ fontWeight: 600 }}>Party — {p.partyName}</span>
              <Tag color={statusColor(p.status)} style={{ fontSize: 11 }}>{p.status || '—'}</Tag>
            </Space>
          }
          extra={
            <Tooltip title={<Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#fff', wordBreak: 'break-all' }}>{`GET ${tab.detailUrl}`}</Text>}>
              <Button type="text" size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                onClick={() => { navigator.clipboard.writeText(tab.detailUrl); message.success('URL copied'); }} />
            </Tooltip>
          }
        >
          {tab.detailLoading
            ? <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
            : (
              <Descriptions size="small" bordered column={3}
                labelStyle={{ background: REDWOOD.neutral100, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}
                contentStyle={{ fontSize: 12 }}>
                <Descriptions.Item label={<Space size={4}><IdcardOutlined />Party #</Space>}>
                  <Text style={{ fontFamily: 'monospace' }}>{p.partyNumber || '—'}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Party ID">
                  <Text style={{ fontFamily: 'monospace' }}>{p.partyId || '—'}</Text>
                </Descriptions.Item>
                <Descriptions.Item label={<Space size={4}><InfoCircleOutlined />Type</Space>}>{p.partyType || '—'}</Descriptions.Item>
                <Descriptions.Item label={<Space size={4}><EnvironmentOutlined />Address</Space>} span={2}>
                  {[p.address1, p.address2].filter(Boolean).join(', ') || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="City">{p.city || '—'}</Descriptions.Item>
                <Descriptions.Item label="Country">{p.country || '—'}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <Tag color={statusColor(p.status)}>{p.status || '—'}</Tag>
                </Descriptions.Item>
                {/* Any extra fields returned by /ar/parties/:id that aren't in the row above */}
                {detail && Object.entries(detail)
                  .filter(([k]) => !/^(party_id|party_number|party_name|party_type|country|address1|address2|city|status)$/i.test(k))
                  .slice(0, 12)
                  .map(([k, v]) => (
                    <Descriptions.Item key={k} label={prettyKey(k)}>{fmtVal(v)}</Descriptions.Item>
                  ))}
              </Descriptions>
            )}
        </Card>

        {/* ── Accounts ── */}
        <Card
          size="small"
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.border}` }}
          bodyStyle={{ padding: 0 }}
          title={
            <Space>
              <ApartmentOutlined style={{ color: REDWOOD.info }} />
              <span style={{ fontWeight: 600 }}>Customer Accounts — BU Assignments</span>
              {tab.accountsLoaded && <Badge count={tab.accounts.length} style={{ backgroundColor: REDWOOD.info }} showZero />}
            </Space>
          }
          extra={
            <Space>
              <Tooltip title={<Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#fff', wordBreak: 'break-all' }}>{tab.accountsUrl}</Text>}>
                <Button type="text" size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                  onClick={() => { navigator.clipboard.writeText(tab.accountsUrl); message.success('Copied'); }} />
              </Tooltip>
              <Button size="small" icon={<ReloadOutlined />}
                onClick={() => { loadedRef.current.delete(`acct-${tab.key}`); loadAccounts(tab.key, p); }}>
                Reload
              </Button>
              <Button size="small" type="primary" icon={<PlusOutlined />}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={() => openBuModal(tab.key, p)}>
                Assign BU
              </Button>
            </Space>
          }
        >
          {tab.accountsLoading
            ? <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading assignments…" /></div>
            : tab.accountsError
              ? <Alert type="error" showIcon style={{ margin: 12 }}
                  message="Failed to load BU account assignments"
                  description={<div><div>{tab.accountsError}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>{tab.accountsUrl}</div></div>} />
              : tab.accounts.length === 0
                ? <Empty description={<span>No business units assigned yet — use <b>Assign BU</b> to add the first one</span>}
                    image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 24 }} />
                : <Table
                    dataSource={tab.accounts}
                    rowKey="assignmentId"
                    columns={accountsCols}
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} business units` }}
                    scroll={{ x: 'max-content' }}
                  />
          }
        </Card>
      </div>
    );
  };

  // ── Tab items ─────────────────────────────────────────────────────────────

  const tabItems = [
    {
      key: 'search',
      label: <Space size={4}><SearchOutlined />Parties</Space>,
      children: (
        <div style={{ padding: '0 4px' }}>
          {/* Search form */}
          <Card
            size="small"
            style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.border}` }}
            bodyStyle={{ padding: '16px 20px 8px' }}
          >
            <Form form={form} layout="inline" onFinish={handleSearch} initialValues={{ q: '', status: '' }}>
              <Form.Item name="q" style={{ marginBottom: 8 }}>
                <Input
                  prefix={<UserOutlined style={{ color: REDWOOD.neutral600 }} />}
                  placeholder="Party name or number"
                  style={{ width: 300 }}
                  allowClear
                />
              </Form.Item>
              <Form.Item name="status" style={{ marginBottom: 8 }}>
                <Input
                  prefix={<InfoCircleOutlined style={{ color: REDWOOD.neutral600 }} />}
                  placeholder="Status (optional)"
                  style={{ width: 180 }}
                  allowClear
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: 8 }}>
                <Space>
                  <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={searching}
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                    Search
                  </Button>
                  <Button icon={<ReloadOutlined />}
                    onClick={() => { form.resetFields(); setParties([]); setSearched(false); setSearchError(''); setGridFilter(''); }}>
                    Reset
                  </Button>
                  {parties.length > 0 && (
                    <Button icon={<DownloadOutlined />} onClick={exportXlsx}>Export</Button>
                  )}
                  <Tooltip
                    title={
                      <div style={{ maxWidth: 460 }}>
                        <div style={{ fontSize: 11, marginBottom: 4, opacity: 0.85 }}>Party search endpoint:</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#fff', wordBreak: 'break-all' }}>
                          GET {lastUrl || `${BASE}/ar/parties?q=&status=`}
                        </div>
                        <div style={{ fontSize: 10, marginTop: 6, opacity: 0.75 }}>Click to copy</div>
                      </div>
                    }>
                    <Button type="text" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                      onClick={() => {
                        const u = lastUrl || `${BASE}/ar/parties`;
                        navigator.clipboard.writeText(u);
                        message.success('Endpoint URL copied');
                      }} />
                  </Tooltip>
                </Space>
              </Form.Item>
            </Form>
            {searchError && (
              <Alert
                type="error" showIcon style={{ marginTop: 4 }}
                message="Party search failed"
                description={
                  <div>
                    <div style={{ marginBottom: 6 }}>{searchError}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.neutral600 }}>
                      GET {lastUrl}
                    </div>
                    <Button size="small" type="link" icon={<CopyOutlined />} style={{ paddingLeft: 0 }}
                      onClick={() => { navigator.clipboard.writeText(lastUrl); message.success('URL copied'); }}>
                      Copy URL
                    </Button>
                  </div>
                }
              />
            )}
          </Card>

          {/* Results */}
          {!searched && !searching && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: REDWOOD.neutral600 }}>
              <UserOutlined style={{ fontSize: 48, color: REDWOOD.neutral200, display: 'block', marginBottom: 12 }} />
              <Text type="secondary">Enter a party name or number and click Search</Text>
            </div>
          )}

          {searched && (() => {
            const q = gridFilter.trim().toLowerCase();
            const filtered = q
              ? parties.filter(r =>
                  [r.partyName, r.partyNumber, r.partyType, r.country, r.city, r.address1, r.address2, r.status]
                    .some(v => (v || '').toString().toLowerCase().includes(q)))
              : parties;
            return (
            <Card
              size="small"
              style={{ borderRadius: 8, border: `1px solid ${REDWOOD.border}` }}
              bodyStyle={{ padding: 0 }}
              title={
                <Space>
                  <UserOutlined style={{ color: REDWOOD.primary }} />
                  <span style={{ fontWeight: 600 }}>
                    {q ? `${filtered.length} of ${parties.length}` : parties.length} part{(q ? filtered.length : parties.length) !== 1 ? 'ies' : 'y'} found
                  </span>
                </Space>
              }
              extra={
                <Input
                  allowClear
                  size="small"
                  prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                  placeholder="Filter all columns…"
                  value={gridFilter}
                  onChange={e => setGridFilter(e.target.value)}
                  style={{ width: 240 }}
                />
              }
            >
              <Table
                dataSource={filtered}
                columns={searchColumns}
                size="small"
                loading={searching}
                scroll={{ x: 'max-content' }}
                pagination={{
                  pageSize: 25, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100'],
                  showTotal: (total, [start, end]) => `${start}–${end} of ${total}`,
                }}
                onRow={(r) => ({ onDoubleClick: () => openPartyTab(r), style: { cursor: 'pointer' } })}
              />
            </Card>
            );
          })()}
        </div>
      ),
    },
    ...tabs.map((tab) => ({
      key: tab.key,
      label: (
        <Space size={4} style={{ maxWidth: 220, overflow: 'hidden' }}>
          <UserOutlined />
          <span style={{ fontSize: 13, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
            {tab.party.partyName}
          </span>
          <CloseOutlined style={{ fontSize: 10, color: REDWOOD.neutral600, marginLeft: 2 }}
            onClick={(e) => { e.stopPropagation(); closeTab(tab.key); }} />
        </Space>
      ),
      children: renderPartyDetail(tab),
    })),
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 24px' }}>
        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 12 }}>
          <Breadcrumb.Item><Link to="/"><HomeOutlined /></Link></Breadcrumb.Item>
          <Breadcrumb.Item>Accounts Receivable</Breadcrumb.Item>
          <Breadcrumb.Item>Manage Customers</Breadcrumb.Item>
        </Breadcrumb>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
          <UserOutlined style={{ fontSize: 22, color: REDWOOD.primary }} />
          <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>Manage Customers</Title>
          {tabs.length > 0 && (
            <Badge count={tabs.length} style={{ backgroundColor: REDWOOD.info }}
              title={`${tabs.length} party tab${tabs.length > 1 ? 's' : ''} open`} />
          )}
        </div>

        {/* Main tabs */}
        <Card bodyStyle={{ padding: '0 0 16px' }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.border}` }}>
          <Tabs
            activeKey={activeKey}
            onChange={setActiveKey}
            type="card"
            size="small"
            style={{ padding: '8px 16px 0' }}
            items={tabItems}
          />
        </Card>
      </Content>

      {/* ── Assign / Edit BU accounts dialog ── */}
      <Modal
        open={!!buModal}
        onCancel={() => setBuModal(null)}
        width={640}
        title={
          <Space>
            <ApartmentOutlined style={{ color: REDWOOD.primary }} />
            <span>{buModal?.draft.assignmentId ? 'Edit BU Account Assignment' : 'Assign Business Unit'}</span>
            {buModal && <Tag color="blue" style={{ fontSize: 11 }}>{buModal.party.partyName}</Tag>}
          </Space>
        }
        footer={[
          <Button key="cancel" onClick={() => setBuModal(null)}>Cancel</Button>,
          <Button key="save" type="primary" loading={savingBu}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={saveBuAssignment}>
            {buModal?.draft.assignmentId ? 'Update' : 'Save'}
          </Button>,
        ]}
      >
        {buModal && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Business Unit</Text>
              <Space>
                <Select
                  showSearch
                  style={{ width: 340 }}
                  placeholder="Select business unit"
                  value={buModal.draft.businessUnitName || undefined}
                  disabled={!!buModal.draft.assignmentId}
                  optionFilterProp="label"
                  options={businessUnits.map(b => ({
                    value: b.name,
                    label: b.name,
                    // creating: hide BUs already assigned to this party
                    disabled: !buModal.draft.assignmentId &&
                      (tabs.find(t => t.key === buModal.tabKey)?.accounts ?? [])
                        .some(a => a.businessUnitName === b.name),
                  }))}
                  onChange={(name: string) => {
                    const bu = businessUnits.find(b => b.name === name);
                    // BU changed → company changes → previously picked accounts
                    // belong to the old company, so clear them
                    setBuModal(m => m && ({ ...m, draft: {
                      ...m.draft, businessUnitName: name,
                      companyCode: bu?.companyCode || '', accounts: {},
                    } }));
                  }}
                />
                {buModal.draft.companyCode && (
                  <Tooltip title="Company segment — locked in the account picker">
                    <Tag color="geekblue" style={{ fontFamily: 'monospace' }}>Company {buModal.draft.companyCode}</Tag>
                  </Tooltip>
                )}
              </Space>
            </div>

            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Accounts (code combinations)</Text>
            {ACCOUNT_TYPES.map(t => (
              <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Text style={{ width: 150, fontSize: 12 }}>{t.label}</Text>
                <Input
                  readOnly
                  size="small"
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: 11.5, background: '#FAFAFA' }}
                  placeholder="Pick from segments →"
                  value={buModal.draft.accounts[t.key] || ''}
                  onClick={() => buModal.draft.businessUnitName && setAcctPickKey(t.key)}
                />
                <Button size="small" disabled={!buModal.draft.businessUnitName}
                  onClick={() => setAcctPickKey(t.key)}>Pick</Button>
                {buModal.draft.accounts[t.key] && (
                  <Button size="small" type="text" icon={<CloseOutlined style={{ fontSize: 10 }} />}
                    onClick={() => setBuModal(m => m && ({ ...m, draft: {
                      ...m.draft, accounts: { ...m.draft.accounts, [t.key]: '' },
                    } }))} />
                )}
              </div>
            ))}
            {!buModal.draft.businessUnitName && (
              <Alert type="info" showIcon style={{ marginTop: 8 }}
                message="Select the business unit first — the company segment of every account comes from it" />
            )}
          </div>
        )}
      </Modal>

      {/* ── Segment-based account picker (company segment locked to the BU) ── */}
      {acctPickKey && buModal && (
        <AccountSelector
          visible={!!acctPickKey}
          lockedFirstSegment={buModal.draft.companyCode || undefined}
          initialValue={buModal.draft.accounts[acctPickKey] || undefined}
          onSelect={(code) => {
            setBuModal(m => m && ({ ...m, draft: {
              ...m.draft, accounts: { ...m.draft.accounts, [acctPickKey]: code },
            } }));
            setAcctPickKey(null);
          }}
          onCancel={() => setAcctPickKey(null)}
        />
      )}

      <FloatingMenu />
    </Layout>
  );
};

export default ManageCustomers;
