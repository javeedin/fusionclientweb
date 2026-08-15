import { getFusionAuthHeaders } from '../../config/api.helper';
import React, { useState, useCallback, useEffect } from 'react';
import { getCurrentCompany } from '../../config/company.config';
import dayjs from 'dayjs';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  Row, Col, Space, Tag, Tabs, message, Spin, Empty, Modal, Tooltip, Dropdown,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, EyeOutlined,
  TeamOutlined, EnvironmentOutlined, BankOutlined, ContactsOutlined,
  FileTextOutlined, InfoCircleOutlined, DownOutlined, ApiOutlined,
  CopyOutlined, ApartmentOutlined, PaperClipOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#B07700', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};

const BASE_URL   = getFusionBase();
const HEADERS = getFusionAuthHeaders();
const PAGE_SIZE  = 25;

// ── Types ─────────────────────────────────────────────────────────────────────
interface OraLink { rel: string; href: string; name: string; kind: string }

interface RawSupplier {
  SupplierId: number;
  SupplierPartyId?: number;
  Supplier: string;
  SupplierNumber: string;
  AlternateName?: string;
  TaxOrganizationTypeCode?: string;
  TaxOrganizationType?: string;
  SupplierTypeCode?: string;
  SupplierType?: string;
  InactiveDate?: string;
  Status: string;
  BusinessRelationshipCode?: string;
  BusinessRelationship?: string;
  RelationshipDisplay?: string;
  CreationDate?: string;
  CreatedBy?: string;
  LastUpdateDate?: string;
  LastUpdatedBy?: string;
  CreationSourceCode?: string;
  CreationSource?: string;
  DUNSNumber?: string;
  RegistryId?: string;
  CustomerNumber?: string;
  TaxRegistrationCountryCode?: string;
  TaxRegistrationCountry?: string;
  TaxRegistrationNumber?: string;
  TaxpayerCountryCode?: string;
  TaxpayerCountry?: string;
  TaxpayerId?: string;
  TaxpayerIdExistsFlag?: boolean;
  FederalReportableFlag?: boolean;
  CorporateWebsite?: string;
  YearEstablished?: number;
  StandardIndustryClass?: string;
  IndustryCategory?: string;
  PreferredFunctionalCurrencyCode?: string;
  PreferredFunctionalCurrency?: string;
  OneTimeSupplierFlag?: boolean;
  ParentSupplierId?: number;
  ParentSupplier?: string;
  ParentSupplierNumber?: string;
  links?: OraLink[];
}

interface ChildRecord { [key: string]: any }

interface SearchParams {
  supplier?: string;
  supplierNumber?: string;
  status?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  try { return dayjs(d).format('D-MMM-YYYY'); } catch { return d; }
};

const statusTag = (s?: string) => {
  if (!s) return <Tag>—</Tag>;
  const up = s.toUpperCase();
  if (up === 'ACTIVE') return <Tag color="green" style={{ fontSize: 11 }}>Active</Tag>;
  if (up === 'INACTIVE') return <Tag color="default" style={{ fontSize: 11 }}>Inactive</Tag>;
  return <Tag style={{ fontSize: 11 }}>{s}</Tag>;
};

const buildQ = (p: SearchParams) => {
  const parts: string[] = [];
  if (p.supplier)       parts.push(`Supplier like "${p.supplier}*"`);
  if (p.supplierNumber) parts.push(`SupplierNumber="${p.supplierNumber}"`);
  if (p.status)         parts.push(`Status="${p.status}"`);
  return parts.join(';');
};

const getChildUrl = (supplier: RawSupplier, name: string): string => {
  const link = supplier.links?.find(l => l.name === name);
  return link?.href ?? `${BASE_URL}/suppliers/${supplier.SupplierId}/child/${name}`;
};

// ── Generic child-tab component ───────────────────────────────────────────────
const ChildTab: React.FC<{ url: string; label: string }> = ({ url, label }) => {
  const [data, setData]       = useState<ChildRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [detail, setDetail]   = useState<ChildRecord | null>(null);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const fetchUrl = url.includes('?') ? `${url}&limit=500` : `${url}?limit=500`;
      const r = await fetch(fetchUrl, { headers: HEADERS });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const items: ChildRecord[] = Array.isArray(d) ? d : (d.items ?? []);
      setData(items);
      setFetched(true);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin tip={`Loading ${label}…`} /></div>;
  if (error)   return <div style={{ padding: 16, margin: 12, borderRadius: 6, background: REDWOOD.error + '12', color: REDWOOD.error }}><InfoCircleOutlined style={{ marginRight: 6 }} />{error}</div>;
  if (!fetched || data.length === 0) return <Empty description={`No ${label.toLowerCase()} found`} style={{ padding: 60 }} />;

  // Build columns from first record's keys (skip links / internal)
  const skip = new Set(['links', 'SupplierId', 'SupplierPartyId']);
  const keys = Object.keys(data[0]).filter(k => !skip.has(k));

  // Priority keys shown as dedicated columns (rest visible via detail modal)
  const priorityKeys = keys.slice(0, 8);
  const cols: ColumnsType<ChildRecord> = [
    ...priorityKeys.map(k => ({
      title: k.replace(/([A-Z])/g, ' $1').trim(),
      dataIndex: k,
      ellipsis: true,
      width: 140,
      render: (v: any) => {
        if (v == null) return <Text style={{ color: REDWOOD.neutral300 }}>—</Text>;
        if (typeof v === 'boolean') return <Tag color={v ? 'green' : 'default'}>{v ? 'Yes' : 'No'}</Tag>;
        if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) return <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>;
        return <Text style={{ fontSize: 12 }}>{String(v)}</Text>;
      },
    })),
    {
      title: '', key: '_detail', width: 42, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, rec: ChildRecord) => (
        <Tooltip title="More details">
          <Button size="small" type="text" icon={<InfoCircleOutlined />}
            style={{ color: REDWOOD.info }} onClick={() => setDetail(rec)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <>
      <Table
        columns={cols} dataSource={data}
        rowKey={(_, i) => String(i)}
        size="small" pagination={false} scroll={{ x: 'max-content' }}
        rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''}
      />

      <Modal
        open={!!detail} onCancel={() => setDetail(null)}
        title={<Space><InfoCircleOutlined style={{ color: REDWOOD.info }} />{label} Details</Space>}
        footer={<Button onClick={() => setDetail(null)}>Close</Button>}
        width={780}
      >
        {detail && (
          <Row gutter={[12, 4]}>
            {Object.entries(detail).filter(([k]) => k !== 'links').map(([k, v]) => (
              <Col xs={24} sm={12} md={8} key={k}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {k.replace(/([A-Z])/g, ' $1').trim()}
                  </div>
                  <div style={{ fontSize: 12, color: REDWOOD.neutral900, marginTop: 2, wordBreak: 'break-word' }}>
                    {v == null ? '—'
                      : typeof v === 'boolean' ? (v ? 'Yes' : 'No')
                      : typeof v === 'object' ? JSON.stringify(v)
                      : (String(k).toLowerCase().includes('date') && v) ? fmtDate(String(v))
                      : String(v)}
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        )}
      </Modal>
    </>
  );
};

// ── Supplier Detail Page ──────────────────────────────────────────────────────
const SupplierDetailPage: React.FC<{ supplier: RawSupplier; onClose?: () => void }> = ({ supplier: initialSupplier, onClose }) => {
  const [supplier, setSupplier]   = useState<RawSupplier>(initialSupplier);
  const [loading, setLoading]     = useState(true);
  const [activeSubTab, setActiveSubTab] = useState('addresses');

  // Fetch full record — search results may omit some fields
  useEffect(() => {
    const url = initialSupplier.links?.find(l => l.name === 'self')?.href
      ?? `${BASE_URL}/suppliers/${initialSupplier.SupplierId}`;
    fetch(url, { headers: HEADERS })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setSupplier({ ...d, links: d.links ?? initialSupplier.links }))
      .catch(() => { /* keep search-result data */ })
      .finally(() => setLoading(false));
  }, [initialSupplier.SupplierId]);

  const actionItems: MenuProps['items'] = [
    { key: 'edit',       label: 'Edit' },
    { key: 'merge',      label: 'Merge Supplier' },
    { type: 'divider' },
    { key: 'agreement',  label: 'Create Agreement' },
    { key: 'classify',   label: 'Business Classification' },
    { type: 'divider' },
    { key: 'audit',      label: 'View Audit History' },
    { key: 'deactivate', label: 'Deactivate', danger: true },
  ];

  // Row/Col label-value — avoids Ant Design Descriptions Item wrapping issue
  const LV: React.FC<{ label: string; value?: React.ReactNode; cols?: number }> = ({ label, value, cols = 1 }) => (
    <Col xs={24} sm={12} md={6 * cols}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: REDWOOD.neutral600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: REDWOOD.neutral900 }}>{value ?? <span style={{ color: REDWOOD.neutral300 }}>—</span>}</div>
      </div>
    </Col>
  );

  const SecHead: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
    <Col xs={24}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, color: REDWOOD.primary, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `2px solid ${REDWOOD.primary}25`, paddingBottom: 6, marginTop: 8, marginBottom: 4 }}>
        {icon} {title}
      </div>
    </Col>
  );

  const subTabs = [
    { key: 'addresses',   label: <Space><EnvironmentOutlined />Addresses</Space>,  url: getChildUrl(supplier, 'addresses') },
    { key: 'sites',       label: <Space><BankOutlined />Sites</Space>,              url: getChildUrl(supplier, 'sites') },
    { key: 'contacts',    label: <Space><ContactsOutlined />Contacts</Space>,       url: getChildUrl(supplier, 'contacts') },
    { key: 'globalDFF',   label: <Space><ApartmentOutlined />Global DFF</Space>,    url: getChildUrl(supplier, 'globalDFF') },
    { key: 'attachments', label: <Space><PaperClipOutlined />Attachments</Space>,   url: getChildUrl(supplier, 'attachments') },
    { key: 'DFF',         label: <Space><FileTextOutlined />DFF</Space>,            url: getChildUrl(supplier, 'DFF') },
  ];

  return (
    <div style={{ background: REDWOOD.neutral100, minHeight: '100%' }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={{ background: REDWOOD.surface, padding: '10px 20px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        <Dropdown menu={{ items: actionItems, onClick: ({ key }) => message.info(`"${key}" not yet implemented`) }} trigger={['click']}>
          <Button style={{ background: '#00918A', borderColor: '#00918A', color: '#fff', fontWeight: 600, borderRadius: 4 }}>
            Actions <DownOutlined style={{ fontSize: 11 }} />
          </Button>
        </Dropdown>
        <Button style={{ background: '#00918A', borderColor: '#00918A', color: '#fff', fontWeight: 600, borderRadius: 4 }}
          icon={<ReloadOutlined />}
          onClick={() => {
            setLoading(true);
            const url = supplier.links?.find(l => l.name === 'self')?.href ?? `${BASE_URL}/suppliers/${supplier.SupplierId}`;
            fetch(url, { headers: HEADERS }).then(r => r.json()).then(d => setSupplier({ ...d, links: d.links ?? supplier.links })).finally(() => setLoading(false));
          }}>
          Refresh
        </Button>
        <Button style={{ background: '#00918A', borderColor: '#00918A', color: '#fff', fontWeight: 600, borderRadius: 4 }} onClick={onClose}>
          Done
        </Button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" tip="Loading supplier…" /></div>
      ) : (
        <>
          {/* ── Header summary ─────────────────────────────────────────────── */}
          <div style={{ background: REDWOOD.surface, padding: '20px 28px', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: REDWOOD.neutral600 }}>Supplier</div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2, color: REDWOOD.neutral900 }}>{supplier.Supplier}</div>
                <div style={{ fontSize: 13, color: REDWOOD.neutral600, marginTop: 4 }}>#{supplier.SupplierNumber}</div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {statusTag(supplier.Status)}
                  {supplier.BusinessRelationship && <Tag color="blue" style={{ fontSize: 11 }}>{supplier.BusinessRelationship}</Tag>}
                  {supplier.TaxOrganizationType && <Tag style={{ fontSize: 11 }}>{supplier.TaxOrganizationType}</Tag>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {supplier.TaxRegistrationNumber && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: REDWOOD.neutral600 }}>TRN</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: REDWOOD.neutral900 }}>{supplier.TaxRegistrationNumber}</div>
                    <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{supplier.TaxRegistrationCountry}</div>
                  </div>
                )}
                {supplier.TaxpayerId && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: REDWOOD.neutral600 }}>Tax ID</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: REDWOOD.neutral900 }}>{supplier.TaxpayerId}</div>
                    <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{supplier.TaxpayerCountry}</div>
                  </div>
                )}
                {supplier.DUNSNumber && (
                  <div style={{ textAlign: 'right', borderLeft: `2px solid ${REDWOOD.neutral200}`, paddingLeft: 24 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: REDWOOD.neutral600 }}>DUNS</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: REDWOOD.neutral900 }}>{supplier.DUNSNumber}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── General Details ─────────────────────────────────────────── */}
            <Card
              styles={{ body: { padding: '16px 20px' } }}
              style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
              title={<Space style={{ fontSize: 13 }}><TeamOutlined style={{ color: REDWOOD.primary }} /><Text strong>Supplier Details</Text></Space>}
            >
              <Row gutter={[16, 0]}>
                <SecHead icon={<InfoCircleOutlined />} title="General" />
                <LV label="Supplier ID"       value={String(supplier.SupplierId)} />
                <LV label="Supplier Number"   value={supplier.SupplierNumber} />
                <LV label="Status"            value={statusTag(supplier.Status)} />
                <LV label="Relationship"      value={supplier.RelationshipDisplay ?? supplier.BusinessRelationship} />
                <LV label="Alternate Name"    value={supplier.AlternateName} />
                <LV label="Supplier Type"     value={supplier.SupplierType} />
                <LV label="Tax Org Type"      value={supplier.TaxOrganizationType} />
                <LV label="Registry ID"       value={supplier.RegistryId} />
                <LV label="DUNS Number"       value={supplier.DUNSNumber} />
                <LV label="Customer Number"   value={supplier.CustomerNumber} />
                <LV label="Website"           value={supplier.CorporateWebsite} />
                <LV label="Year Established"  value={supplier.YearEstablished != null ? String(supplier.YearEstablished) : undefined} />
                <LV label="Industry"          value={supplier.IndustryCategory} />
                <LV label="Std Industry Class" value={supplier.StandardIndustryClass} />
                <LV label="Pref Currency"     value={supplier.PreferredFunctionalCurrency ?? supplier.PreferredFunctionalCurrencyCode} />
                <LV label="One-Time Supplier" value={supplier.OneTimeSupplierFlag != null ? (supplier.OneTimeSupplierFlag ? 'Yes' : 'No') : undefined} />
                <LV label="Parent Supplier"   value={supplier.ParentSupplier} />
                <LV label="Creation Source"   value={supplier.CreationSource} />

                <SecHead icon={<FileTextOutlined />} title="Tax Information" />
                <LV label="Tax Registration #"  value={supplier.TaxRegistrationNumber} />
                <LV label="Tax Reg Country"      value={supplier.TaxRegistrationCountry} />
                <LV label="Taxpayer ID"          value={supplier.TaxpayerId} />
                <LV label="Taxpayer Country"     value={supplier.TaxpayerCountry} />
                <LV label="Federal Reportable"   value={supplier.FederalReportableFlag != null ? (supplier.FederalReportableFlag ? 'Yes' : 'No') : undefined} />

                <SecHead icon={<TeamOutlined />} title="Audit" />
                <LV label="Created By"      value={supplier.CreatedBy} />
                <LV label="Created"         value={fmtDate(supplier.CreationDate)} />
                <LV label="Last Updated By" value={supplier.LastUpdatedBy} />
                <LV label="Last Updated"    value={fmtDate(supplier.LastUpdateDate)} />
                <LV label="Inactive Date"   value={fmtDate(supplier.InactiveDate)} />
              </Row>
            </Card>

            {/* ── Child resource tabs ─────────────────────────────────────── */}
            <Card
              styles={{ body: { padding: 0 } }}
              style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
              title={<Space style={{ fontSize: 13 }}><InfoCircleOutlined style={{ color: REDWOOD.primary }} /><Text strong>Supplier Information</Text></Space>}
            >
              <Tabs
                activeKey={activeSubTab}
                onChange={setActiveSubTab}
                size="small"
                style={{ paddingLeft: 16, paddingRight: 16 }}
                tabBarStyle={{ marginBottom: 0, borderBottom: `1px solid ${REDWOOD.neutral200}` }}
                items={subTabs.map(t => ({
                  key: t.key,
                  label: t.label,
                  children: <ChildTab key={t.url} url={t.url} label={t.key} />,
                }))}
              />
            </Card>

          </div>
        </>
      )}
    </div>
  );
};

// ── Search Tab ────────────────────────────────────────────────────────────────
const SearchTab: React.FC<{ onOpen: (s: RawSupplier) => void }> = ({ onOpen }) => {
  const [form] = Form.useForm();
  const [data, setData]         = useState<RawSupplier[]>([]);
  const [loading, setLoading]   = useState(false);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [params, setParams]     = useState<SearchParams>({});
  const [searched, setSearched] = useState(false);

  const buildUrl = (p: SearchParams, pg: number) => {
    const q = buildQ(p);
    const up = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((pg - 1) * PAGE_SIZE), totalResults: 'true' });
    if (q) up.set('q', q);
    return `${BASE_URL}/suppliers?${up}`;
  };

  const fetchSuppliers = useCallback(async (p: SearchParams, pg: number) => {
    setLoading(true);
    try {
      const res = await fetch(buildUrl(p, pg), { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      setData(json.items ?? []);
      setTotal(json.totalResults ?? json.count ?? (json.items ?? []).length);
    } catch (e: any) {
      message.error(`Failed to load suppliers: ${e.message}`, 6);
      setData([]); setTotal(0);
    } finally { setLoading(false); }
  }, []);

  const handleSearch = () => {
    const v = form.getFieldsValue();
    const p: SearchParams = { supplier: v.supplier, supplierNumber: v.supplierNumber, status: v.status };
    setParams(p); setPage(1); setSearched(true);
    fetchSuppliers(p, 1);
  };

  const handleReset = () => { form.resetFields(); setParams({}); setPage(1); setData([]); setTotal(0); setSearched(false); };

  const columns: ColumnsType<RawSupplier> = [
    {
      title: 'Supplier', dataIndex: 'Supplier', fixed: 'left', width: 220, ellipsis: true,
      render: (v, rec) => (
        <Button type="link" style={{ padding: 0, fontWeight: 700, color: REDWOOD.info, fontSize: 13 }} onClick={() => onOpen(rec)}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Number', dataIndex: 'SupplierNumber', width: 110,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
    },
    { title: 'Status', dataIndex: 'Status', width: 90, render: v => statusTag(v) },
    {
      title: 'Business Relationship', dataIndex: 'BusinessRelationship', width: 180, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Tax Org Type', dataIndex: 'TaxOrganizationType', width: 140, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Tax Reg #', dataIndex: 'TaxRegistrationNumber', width: 120,
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'DUNS', dataIndex: 'DUNSNumber', width: 110,
      render: v => <Text style={{ fontSize: 12 }}>{v ?? '—'}</Text>,
    },
    {
      title: 'Created', dataIndex: 'CreationDate', width: 110, render: d => fmtDate(d),
    },
    {
      title: 'Last Updated', dataIndex: 'LastUpdateDate', width: 110, render: d => fmtDate(d),
    },
    {
      title: '', key: 'actions', width: 80, fixed: 'right', align: 'center',
      render: (_: any, rec: RawSupplier) => (
        <Button size="small" type="primary" icon={<EyeOutlined />} onClick={() => onOpen(rec)}
          style={{ background: REDWOOD.info, borderColor: REDWOOD.info, borderRadius: 4, fontSize: 11 }}>
          Open
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Search panel */}
      <Card styles={{ body: { padding: '14px 18px' } }}
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <Form form={form} layout="vertical">
          <Row gutter={[10, 0]}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="supplier" label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Supplier Name</Text>} style={{ marginBottom: 8 }}>
                <Input placeholder="e.g. TEST_SUPP" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="supplierNumber" label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Supplier Number</Text>} style={{ marginBottom: 8 }}>
                <Input placeholder="e.g. 10001" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="status" label={<Text style={{ fontSize: 12, fontWeight: 600 }}>Status</Text>} style={{ marginBottom: 8 }}>
                <Select placeholder="All" allowClear>
                  <Option value="ACTIVE">Active</Option>
                  <Option value="INACTIVE">Inactive</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, borderRadius: 6, fontWeight: 600 }}>
              Search
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
          </div>
        </Form>
      </Card>

      {/* Results */}
      <Card styles={{ body: { padding: 0 } }}
        style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong style={{ fontSize: 13 }}>
              Suppliers
              {searched && total > 0 && <Text type="secondary" style={{ fontWeight: 400, marginLeft: 8 }}>({total} result{total !== 1 ? 's' : ''})</Text>}
            </Text>
            <Tooltip title={buildUrl(params, page)}>
              <Button
                type="text"
                size="small"
                icon={<ApiOutlined style={{ color: REDWOOD.info, fontSize: 14 }} />}
                style={{ padding: '2px 6px', height: 'auto' }}
              />
            </Tooltip>
            <Tooltip title="Copy API URL">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined style={{ color: REDWOOD.neutral600, fontSize: 12 }} />}
                onClick={() => {
                  navigator.clipboard.writeText(buildUrl(params, page));
                  message.success('API URL copied to clipboard', 2);
                }}
                style={{ padding: '2px 6px', height: 'auto' }}
              />
            </Tooltip>
          </div>
        </div>
        <Table
          columns={columns} dataSource={data} rowKey="SupplierId"
          loading={loading} size="small" scroll={{ x: 1200 }}
          pagination={searched && total > PAGE_SIZE ? {
            current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false,
            onChange: p => { setPage(p); fetchSuppliers(params, p); },
            showTotal: (t, [s, e]) => `${s}–${e} of ${t}`,
            style: { padding: '10px 16px', margin: 0 },
          } : false}
          locale={{
            emptyText: searched
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No suppliers found" style={{ padding: 40 }} />
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Use the search panel to find suppliers" style={{ padding: 40 }} />,
          }}
          rowClassName={(_, i) => i % 2 !== 0 ? 'po-row-alt' : ''}
          onRow={rec => ({ style: { cursor: 'pointer' }, onDoubleClick: () => onOpen(rec) })}
        />
      </Card>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const ManageSuppliers: React.FC = () => {
  const [openSuppliers, setOpenSuppliers] = useState<RawSupplier[]>([]);
  const [activeTab, setActiveTab]         = useState('search');

  const handleOpen = (s: RawSupplier) => {
    const key = String(s.SupplierId);
    if (!openSuppliers.find(x => x.SupplierId === s.SupplierId)) {
      setOpenSuppliers(prev => [...prev, s]);
    }
    setActiveTab(key);
  };

  const handleClose = (key: string) => {
    const remaining = openSuppliers.filter(s => String(s.SupplierId) !== key);
    setOpenSuppliers(remaining);
    if (activeTab === key) {
      setActiveTab(remaining.length > 0 ? String(remaining[remaining.length - 1].SupplierId) : 'search');
    }
  };

  const tabItems = [
    {
      key: 'search',
      label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SearchOutlined style={{ fontSize: 13 }} />Suppliers</span>,
      children: <SearchTab onOpen={handleOpen} />,
      closable: false,
    },
    ...openSuppliers.map(s => ({
      key: String(s.SupplierId),
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TeamOutlined style={{ fontSize: 12, color: REDWOOD.info }} />
          <span style={{ fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.Supplier}
          </span>
        </span>
      ),
      children: <SupplierDetailPage supplier={s} onClose={() => handleClose(String(s.SupplierId))} />,
      closable: true,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Suppliers' },
          ]} />
        </div>
        <Tabs
          type="editable-card" hideAdd
          activeKey={activeTab} onChange={setActiveTab}
          onEdit={(key, action) => { if (action === 'remove') handleClose(String(key)); }}
          items={tabItems}
          style={{ background: REDWOOD.surface }}
          tabBarStyle={{ margin: 0, paddingLeft: 16, borderBottom: `2px solid ${REDWOOD.neutral200}`, background: REDWOOD.surface }}
          tabBarGutter={4}
        />
      </Content>
    </Layout>
  );
};

export default ManageSuppliers;
