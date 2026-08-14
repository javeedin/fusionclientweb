import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Form, Input, Select, DatePicker, Button,
  Tag, Typography, Space, Tooltip, Spin, Row, Col, message, Modal, Empty,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, FileSearchOutlined, SearchOutlined, ReloadOutlined, ClearOutlined,
  ApiOutlined, CopyOutlined, InfoCircleOutlined, ProfileOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { FUSION_POD_HOST, FUSION_POD_AUTH, getFusionInstance } from '../../config/fusionInstance';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const { Title, Text } = Typography;

const FUSION_BASE = `${getFusionBase()}`;
const AUTH_HEADER = FUSION_POD_AUTH;
const FUSION_HDRS = { Authorization: AUTH_HEADER, Accept: 'application/json' };
const PAGE_LIMIT = 500;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#B07700', info: '#0572CE',
  error: '#D93025', teal: '#00918A', neutral100: '#F7F7F7', neutral200: '#E5E5E5',
  neutral300: '#C7C7C7', neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const fmtDate = (d?: string) => { if (!d) return '—'; try { return dayjs(d).format('D-MMM-YYYY HH:mm'); } catch { return d; } };
const fmtQty = (v?: any) => (v == null || v === '' ? '—' : new Intl.NumberFormat('en-US').format(Number(v)));
const pick = (r: any, keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v != null && v !== '') return v; } return undefined; };
const isHiddenKey = (k: string) => /Id$/.test(k) || k === 'links';
const isEmpty = (v: any) => v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v ?? {}).length === 0);

const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
  const stripped = baseUrl.replace(/[?&]limit=\d+/gi, '').replace(/[?&]offset=\d+/gi, '').replace(/\?&/, '?').replace(/&&/g, '&');
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const sep = stripped.includes('?') ? '&' : '?';
    const url = `${stripped}${sep}limit=${PAGE_LIMIT}&offset=${offset}`;
    const r = await fetch(url, { headers: FUSION_HDRS });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    const d = await r.json();
    const items: any[] = Array.isArray(d) ? d : (d.items ?? []);
    all.push(...items);
    if (!d.hasMore || items.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return all;
};

interface Filters { org?: string; item?: string; dateOp?: string; date?: Dayjs | null; }

const ReviewInventoryTransactions: React.FC = () => {
  const [form] = Form.useForm();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [apiOpen, setApiOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [filterText, setFilterText] = useState('');
  const [orgs, setOrgs] = useState<string[]>([]);

  const [filters, setFilters] = useState<Filters>({ dateOp: '>', date: dayjs().subtract(7, 'day') });

  useEffect(() => {
    fetch(`${FUSION_BASE}/inventoryOrganizations?onlyData=true&limit=500&fields=OrganizationCode`, { headers: FUSION_HDRS })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setOrgs(Array.from(new Set((d.items ?? []).map((o: any) => o.OrganizationCode).filter(Boolean))).sort() as string[]))
      .catch(() => { /* free-type fallback */ });
  }, []);

  const buildQ = useCallback((f: Filters) => {
    const parts: string[] = [];
    if (f.org) parts.push(`Organization=${f.org}`);
    if (f.item?.trim()) parts.push(`Item LIKE '${f.item.trim()}%'`);
    if (f.date) parts.push(`TransactionDate${f.dateOp || '>'}${dayjs(f.date).format('YYYY-MM-DD')}`);
    return parts.join(';');
  }, []);

  const searchUrl = useMemo(() => {
    const q = buildQ(filters);
    const qs = q ? `q=${encodeURIComponent(q)}&` : '';
    return `${FUSION_BASE}/inventoryCompletedTransactions?${qs}orderBy=TransactionDate:desc`;
  }, [filters, buildQ]);

  const runSearch = useCallback(async () => {
    if (!filters.org) { message.warning('Select an organization first'); return; }
    setLoading(true); setError(''); setSearched(true);
    try {
      const items = await fetchAllPages(searchUrl);
      setRows(items);
      if (items.length === 0) setError('No completed transactions matched.');
    } catch (e: any) { setError(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [searchUrl, filters.org]);

  const filtered = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(r => JSON.stringify(r).toLowerCase().includes(t));
  }, [rows, filterText]);

  const columns: ColumnsType<any> = [
    { title: 'Transaction Date', width: 150, fixed: 'left', render: (_, r) => fmtDate(pick(r, ['TransactionDate', 'CreationDate'])),
      sorter: (a, b) => String(pick(a, ['TransactionDate', 'CreationDate']) ?? '').localeCompare(String(pick(b, ['TransactionDate', 'CreationDate']) ?? '')) },
    { title: 'Transaction Type', width: 180, render: (_, r) => <Tag style={{ fontSize: 11 }}>{pick(r, ['TransactionType', 'TransactionTypeName', 'TransactionAction']) ?? '—'}</Tag> },
    { title: 'Item', width: 130, render: (_, r) => <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>{pick(r, ['Item', 'ItemNumber']) ?? '—'}</Text> },
    { title: 'Description', width: 230, ellipsis: true, render: (_, r) => <Text style={{ fontSize: 12 }}>{pick(r, ['ItemDescription', 'Description']) ?? '—'}</Text> },
    { title: 'Org', width: 80, render: (_, r) => <Tag style={{ fontSize: 11 }}>{pick(r, ['Organization', 'OrganizationCode']) ?? '—'}</Tag> },
    { title: 'Subinventory', width: 120, render: (_, r) => pick(r, ['Subinventory', 'SubinventoryCode']) ?? '—' },
    { title: 'Locator', width: 110, render: (_, r) => pick(r, ['Locator', 'LocatorName']) ?? '—' },
    { title: 'Quantity', width: 110, align: 'right', render: (_, r) => {
        const q = pick(r, ['TransactionQuantity', 'PrimaryQuantity', 'Quantity']);
        const uom = pick(r, ['TransactionUOM', 'TransactionUnitOfMeasure', 'UOMCode', 'UOM']);
        return <Text style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: (Number(q) || 0) < 0 ? REDWOOD.error : undefined }}>{fmtQty(q)}{uom ? ` ${uom}` : ''}</Text>;
      } },
    { title: 'Lot', width: 110, render: (_, r) => pick(r, ['LotNumber', 'Lot']) ?? '—' },
    { title: 'Serial', width: 120, render: (_, r) => pick(r, ['SerialNumber', 'Serial']) ?? '—' },
    { title: 'Source / Reference', width: 200, ellipsis: true,
      render: (_, r) => <Text style={{ fontSize: 12 }}>{pick(r, ['TransactionSource', 'TransactionSourceName', 'SourceReference', 'TransactionReference', 'SourceDocumentNumber']) ?? '—'}</Text> },
    { title: '', key: 'more', width: 46, fixed: 'right', align: 'center',
      render: (_, r) => <Tooltip title="All fields"><Button size="small" type="text" icon={<ProfileOutlined />} style={{ color: REDWOOD.info }} onClick={() => setDetail(r)} /></Tooltip> },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Review Inventory Completed Transactions' },
          ]} />
          <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSearchOutlined style={{ color: REDWOOD.primary }} /> Review Inventory Completed Transactions
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— Fusion inventoryCompletedTransactions</Text>
          </Title>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card styles={{ body: { padding: '14px 18px' } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
            <Form form={form} layout="vertical" size="small">
              <Row gutter={[8, 0]}>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Organization <span style={{ color: REDWOOD.error }}>*</span></Text>} style={{ marginBottom: 6 }}>
                    <Select allowClear showSearch placeholder="Select org" value={filters.org}
                      onChange={v => setFilters(f => ({ ...f, org: v }))}
                      options={orgs.map(o => ({ value: o, label: o }))} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8} md={5}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Item (starts with)</Text>} style={{ marginBottom: 6 }}>
                    <Input placeholder="Item code" allowClear value={filters.item}
                      onChange={e => setFilters(f => ({ ...f, item: e.target.value }))} onPressEnter={runSearch} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item label={<Text style={{ fontSize: 11, fontWeight: 600 }}>Transaction Date</Text>} style={{ marginBottom: 6 }}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Select style={{ width: 62 }} value={filters.dateOp} onChange={v => setFilters(f => ({ ...f, dateOp: v }))}
                        options={['>', '>=', '=', '<=', '<'].map(o => ({ value: o, label: o }))} />
                      <DatePicker style={{ width: '100%' }} value={filters.date} onChange={d => setFilters(f => ({ ...f, date: d }))} />
                    </Space.Compact>
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button type="primary" size="small" icon={<SearchOutlined />} loading={loading} onClick={runSearch}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
                <Button size="small" icon={<ClearOutlined />} onClick={() => setFilters({ dateOp: '>', date: dayjs().subtract(7, 'day') })}>Reset</Button>
                <Tooltip title="API Inspector — inventoryCompletedTransactions">
                  <Button size="small" icon={<ApiOutlined />} style={{ marginLeft: 'auto', borderColor: REDWOOD.info, color: REDWOOD.info }}
                    onClick={() => setApiOpen(true)}>API</Button>
                </Tooltip>
              </div>
            </Form>
          </Card>

          <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
            title={<Space><FileSearchOutlined style={{ color: REDWOOD.primary }} /><Text strong>Completed Transactions</Text>
              {rows.length > 0 && <Tag>{filtered.length}{filtered.length !== rows.length ? ` of ${rows.length}` : ''} txn{rows.length !== 1 ? 's' : ''}</Tag>}</Space>}
            extra={<Space>
              <Input placeholder="Filter any column…" allowClear size="small" prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                value={filterText} onChange={e => setFilterText(e.target.value)} style={{ width: 220 }} />
              <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={runSearch}>Refresh</Button>
            </Space>}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" tip="Loading…" /></div>
            ) : error && rows.length === 0 ? (
              <div style={{ padding: 24, color: REDWOOD.error, background: REDWOOD.error + '10', margin: 16, borderRadius: 6 }}>
                <InfoCircleOutlined style={{ marginRight: 8 }} />{error}
              </div>
            ) : !searched ? (
              <Empty description="Pick an organization and search" style={{ padding: 60 }} />
            ) : filtered.length === 0 ? (
              <Empty description="No transactions" style={{ padding: 60 }} />
            ) : (
              <Table columns={columns} dataSource={filtered} rowKey={(r, i) => `${pick(r, ['TransactionId']) ?? i}`} size="small"
                scroll={{ x: 1650 }} pagination={{ pageSize: 25, size: 'small', showSizeChanger: true, showTotal: t => `${t} transactions` }} />
            )}
          </Card>
        </div>

        {/* API inspector */}
        <Modal title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /> Inventory Completed Transactions API</Space>}
          open={apiOpen} onCancel={() => setApiOpen(false)} maskClosable={false} width={860}
          footer={<Button onClick={() => setApiOpen(false)}>Close</Button>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>Search</Text>
            <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto' }}
              onClick={() => { navigator.clipboard.writeText(decodeURIComponent(searchUrl)); message.success('Copied'); }}>Copy</Button>
          </div>
          <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: REDWOOD.info }}>
            <Tag color="blue">GET</Tag>{decodeURIComponent(searchUrl)}
          </div>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>Organization is required; Item uses SQL LIKE, date is unquoted. Auth: Basic [{getFusionInstance().username}].</Text>
        </Modal>

        {/* All-fields detail */}
        <Modal title={<Space><ProfileOutlined style={{ color: REDWOOD.info }} /> Transaction {pick(detail ?? {}, ['TransactionId', 'TransactionNumber'])} — all fields</Space>}
          open={!!detail} onCancel={() => setDetail(null)} maskClosable={false} width={900}
          footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
          {detail && (() => {
            const entries = Object.entries(detail).filter(([k, v]) => !isHiddenKey(k) && !isEmpty(v));
            return (
              <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                <Row gutter={[12, 0]}>
                  {entries.map(([k, v]) => (
                    <Col xs={24} sm={12} md={8} key={k}>
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase' }}>{k.replace(/([A-Z])/g, ' $1').replace(/^ /, '')}</div>
                        <div style={{ fontSize: 12, color: REDWOOD.neutral900, marginTop: 2, wordBreak: 'break-word' }}>
                          {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'object' ? JSON.stringify(v) : /Date$/.test(k) ? fmtDate(String(v)) : String(v)}
                        </div>
                      </div>
                    </Col>
                  ))}
                </Row>
              </div>
            );
          })()}
        </Modal>
      </Content>
    </Layout>
  );
};

export default ReviewInventoryTransactions;
