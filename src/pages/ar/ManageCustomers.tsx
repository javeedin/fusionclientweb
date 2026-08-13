import React, { useState, useCallback, useRef } from 'react';
import {
  Layout, Card, Form, Input, Button, Space, Typography, Table, Tabs,
  Breadcrumb, Tooltip, message, Tag, Spin, Descriptions, Badge, Empty, Alert,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined,
  UserOutlined, BankOutlined, IdcardOutlined, DownloadOutlined,
  ApiOutlined, CopyOutlined, CloseOutlined, EnvironmentOutlined,
  ApartmentOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import FloatingMenu from '../../components/FloatingMenu';
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
  accounts: Record<string, any>[];       // raw /ar/parties/:id/accounts rows
  accountsLoading: boolean;
  accountsLoaded: boolean;
  accountsUrl: string;
  accountsError: string;
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

// Build table columns dynamically from the returned rows (schema-agnostic),
// putting a few well-known columns first.
const buildDynamicColumns = (rows: Record<string, any>[], preferred: string[]): ColumnsType<any> => {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const ordered = [
    ...preferred.filter(k => keys.includes(k)),
    ...keys.filter(k => !preferred.includes(k)),
  ];
  return ordered.map(k => ({
    title: prettyKey(k),
    dataIndex: k,
    key: k,
    width: 170,
    ellipsis: true,
    render: (v: any) => (
      <Tooltip title={fmtVal(v)}>
        <Text style={{ fontSize: 12, fontFamily: /id|number|amount|date/i.test(k) ? 'monospace' : undefined }}>
          {fmtVal(v)}
        </Text>
      </Tooltip>
    ),
  }));
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
    const accountsUrl = `${BASE}/ar/parties/${party.partyId}/accounts`;
    setTabs(prev => [...prev, {
      key, party,
      detail: null, detailLoading: false, detailUrl,
      accounts: [], accountsLoading: false, accountsLoaded: false, accountsUrl, accountsError: '',
    }]);
    setActiveKey(key);
    loadDetail(key, party.partyId);
    loadAccounts(key, party.partyId);
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

  // ── Load party accounts ───────────────────────────────────────────────────

  const loadAccounts = useCallback(async (tabKey: string, partyId: number) => {
    if (loadedRef.current.has(`acct-${tabKey}`)) return;
    loadedRef.current.add(`acct-${tabKey}`);
    setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, accountsLoading: true, accountsError: '' } : t));
    try {
      const res = await fetch(`${BASE}/ar/parties/${partyId}/accounts`, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status} — ${raw.slice(0, 200)}`);
      const items: any[] = data.items ?? data.rows ?? (Array.isArray(data) ? data : []);
      setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, accountsLoading: false, accounts: items, accountsLoaded: true } : t));
    } catch (e: any) {
      loadedRef.current.delete(`acct-${tabKey}`);
      setTabs(prev => prev.map(t => t.key === tabKey ? { ...t, accountsLoading: false, accountsLoaded: true, accountsError: e.message || String(e) } : t));
    }
  }, []);

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
    const accountsCols = buildDynamicColumns(tab.accounts,
      ['ACCOUNT_NUMBER', 'ACCOUNT_NAME', 'STATUS', 'CUST_ACCOUNT_ID', 'PARTY_ID']);

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
              <span style={{ fontWeight: 600 }}>Customer Accounts</span>
              {tab.accountsLoaded && <Badge count={tab.accounts.length} style={{ backgroundColor: REDWOOD.info }} showZero />}
            </Space>
          }
          extra={
            <Space>
              <Tooltip title={<Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#fff', wordBreak: 'break-all' }}>{`GET ${tab.accountsUrl}`}</Text>}>
                <Button type="text" size="small" icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                  onClick={() => { navigator.clipboard.writeText(tab.accountsUrl); message.success('URL copied'); }} />
              </Tooltip>
              <Button size="small" icon={<ReloadOutlined />}
                onClick={() => { loadedRef.current.delete(`acct-${tab.key}`); loadAccounts(tab.key, p.partyId); }}>
                Reload
              </Button>
            </Space>
          }
        >
          {tab.accountsLoading
            ? <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Loading accounts…" /></div>
            : tab.accountsError
              ? <Alert type="error" showIcon style={{ margin: 12 }}
                  message="Failed to load accounts"
                  description={<div><div>{tab.accountsError}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>GET {tab.accountsUrl}</div></div>} />
              : tab.accounts.length === 0
                ? <Empty description="No customer accounts for this party" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 24 }} />
                : <Table
                    dataSource={tab.accounts.map((a, i) => ({ ...a, _k: i }))}
                    rowKey="_k"
                    columns={accountsCols}
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} accounts` }}
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
      <FloatingMenu />
    </Layout>
  );
};

export default ManageCustomers;
