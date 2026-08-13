import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Typography, Card, Breadcrumb, Table, Tag, Button, Space,
  Form, Input, Select, DatePicker, Modal, Tabs, Descriptions, InputNumber,
  Tooltip, Row, Col, message, Divider, Checkbox, Badge, Spin, Popconfirm,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, PlusOutlined, SearchOutlined, ReloadOutlined,
  EditOutlined, EyeOutlined, CheckCircleOutlined, StopOutlined,
  DollarOutlined, FileTextOutlined, KeyOutlined, TeamOutlined,
  DownloadOutlined, FileProtectOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
  rmTeal: '#0B6E6E',
};

const RM_BASE = `${APEX_DB_CONFIG.baseUrl}/rm`;

// ORDS sometimes writes the CORS header into the body when HTTP_HEADER_CLOSE is missing.
// Strip everything before the first JSON character { or [ to get clean JSON.
const toJson = (text: string) => {
  const start = text.search(/[{[]/);
  return JSON.parse(start > 0 ? text.slice(start) : text);
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Agreement {
  agreementId: number;
  agreementNumber: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  signDate: string;
  noOfMonths: number;
  frequency: string;
  totalAmount: number;
  frequencyAmount: number;
  noOfPayments: number;
  propertyName: string;
  propertyNumber: string;
  unitNo: string;
  community: string;
  customerName: string;
  customerMobile: string;
  ejariNumber: string;
}

interface Installment {
  installmentId: number;
  installmentNo: number;
  dueDate: string;
  amount: number;
  paymentMethod: string;
  chequeNo: string;
  chequeDate: string;
  bankName: string;
  status: string;
  presentedDate: string;
  clearedDate: string;
  bouncedDate: string;
  receiptNumber: string;
  notes: string;
}

interface MonthlySplit {
  splitId: number;
  year: number;
  month: number;
  periodDate: string;
  amount: number;
  status: string;
  installmentNo: string;
  chequeNo: string;
  instStatus: string;
}

interface AgreementDocument {
  documentId: number;
  docTypeName: string;
  mandatoryFlag: string;
  submittedFlag: string;
  documentNumber: string;
  documentExpiry: string;
  verifiedFlag: string;
  notes: string;
}

interface Property { propertyId: number; propertyNumber: string; propertyName: string; unitNo: string; community: string; }
interface Customer { customerId: number; customerNumber: string; fullName: string; mobile: string; emiratesId: string; }
interface Broker   { brokerId: number; brokerNumber: string; brokerName: string; }

// ─── Status helpers ───────────────────────────────────────────────────────────
const AGR_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default', ACTIVE: 'success', EXPIRED: 'warning',
  TERMINATED: 'error', CANCELLED: 'default',
};
const INST_STATUS_COLOR: Record<string, string> = {
  PENDING: 'blue', PRESENTED: 'processing', CLEARED: 'success',
  BOUNCED: 'error', CANCELLED: 'default', REPLACED: 'warning', WAIVED: 'default',
};
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Main Component ───────────────────────────────────────────────────────────
const ManageAgreements: React.FC = () => {
  console.log('[RM] ManageAgreements mounted. RM_BASE =', RM_BASE);

  const [agreements, setAgreements]   = useState<Agreement[]>([]);
  const [loading, setLoading]         = useState(false);
  const [properties, setProperties]   = useState<Property[]>([]);
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [brokers, setBrokers]         = useState<Broker[]>([]);

  // Modal state
  const [formOpen, setFormOpen]       = useState(false);
  const [viewOpen, setViewOpen]       = useState(false);
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [editMode, setEditMode]       = useState(false);
  const [saving, setSaving]           = useState(false);

  // Detail tabs data
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [splits, setSplits]             = useState<MonthlySplit[]>([]);
  const [documents, setDocuments]       = useState<AgreementDocument[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeAgreement, setActiveAgreement] = useState<any>(null);

  // Installment edit state
  const [instEditRow, setInstEditRow] = useState<number | null>(null);
  const [instForm]                    = Form.useForm();

  const [form]                        = Form.useForm();
  const [searchForm]                  = Form.useForm();

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fetchAgreements = useCallback(async (filters?: any) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters?.status)          params.append('status',           filters.status);
      if (filters?.agreementNumber) params.append('agreement_number', filters.agreementNumber);
      if (filters?.customerId)      params.append('customer_id',      filters.customerId);
      if (filters?.propertyId)      params.append('property_id',      filters.propertyId);

      const url = `${RM_BASE}/agreements?${params}`;
      console.log('[RM] fetchAgreements URL:', url);

      const res  = await fetch(url);
      console.log('[RM] fetchAgreements status:', res.status, res.ok);

      const text = await res.text();
      console.log('[RM] fetchAgreements raw response (first 500):', text.slice(0, 500));

      try {
        const data = toJson(text);
        console.log('[RM] fetchAgreements parsed data:', data);
        console.log('[RM] agreements array length:', data.agreements?.length ?? 'key missing');
        setAgreements(data.agreements || []);
      } catch (parseErr) {
        console.error('[RM] fetchAgreements JSON parse error:', parseErr);
        setAgreements([]);
      }
    } catch (fetchErr) {
      console.error('[RM] fetchAgreements network error:', fetchErr);
      setAgreements([]);
    }
    setLoading(false);
  }, []);

  const fetchLookups = useCallback(async () => {
    try {
      const [pRes, cRes] = await Promise.all([
        fetch(`${RM_BASE}/properties`),
        fetch(`${RM_BASE}/customers`),
      ]);
      console.log('[RM] properties status:', pRes.status, pRes.ok);
      console.log('[RM] customers status:', cRes.status, cRes.ok);
      const pText = await pRes.text();
      const cText = await cRes.text();
      console.log('[RM] properties raw (first 300):', pText.slice(0, 300));
      console.log('[RM] customers raw (first 300):', cText.slice(0, 300));
      try { const d = toJson(pText); setProperties(d.properties || []); } catch (e) { console.error('[RM] properties parse error', e); }
      try { const d = toJson(cText); setCustomers(d.customers || []); }   catch (e) { console.error('[RM] customers parse error', e); }
    } catch (e) { console.error('[RM] fetchLookups network error', e); }
  }, []);

  useEffect(() => { fetchAgreements(); fetchLookups(); }, [fetchAgreements, fetchLookups]);

  const loadDetail = async (id: number) => {
    console.log('[RM] loadDetail starting for id:', id);
    setDetailLoading(true);
    try {
      const [aRes, iRes, sRes] = await Promise.all([
        fetch(`${RM_BASE}/agreements/${id}`),
        fetch(`${RM_BASE}/agreements/${id}/installments`),
        fetch(`${RM_BASE}/agreements/${id}/splits`),
      ]);
      console.log('[RM] loadDetail responses — agreement:', aRes.status, '/ installments:', iRes.status, '/ splits:', sRes.status);
      const aText = await aRes.text(); const iText = await iRes.text(); const sText = await sRes.text();
      console.log('[RM] loadDetail agreement raw (first 200):', aText.slice(0, 200));
      console.log('[RM] loadDetail installments raw (first 200):', iText.slice(0, 200));
      console.log('[RM] loadDetail splits raw (first 200):', sText.slice(0, 200));
      try { setActiveAgreement(toJson(aText)); }  catch (e) { console.error('[RM] agreement detail parse error', e); }
      try { const d = toJson(iText); setInstallments(Array.isArray(d) ? d : []); } catch (e) { console.error('[RM] installments parse error', e); setInstallments([]); }
      try { const d = toJson(sText); setSplits(Array.isArray(d) ? d : []); }       catch (e) { console.error('[RM] splits parse error', e); setSplits([]); }
    } catch { /* skip */ }
    setDetailLoading(false);
  };

  const openView = async (id: number) => {
    console.log('[RM] openView called for id:', id);
    setActiveAgreement(null);   // clear previous data so modal shows spinner, not stale data
    setInstallments([]);
    setSplits([]);
    setSelectedId(id);
    setViewOpen(true);
    await loadDetail(id);
  };

  const openCreate = () => {
    form.resetFields();
    setEditMode(false);
    setSelectedId(null);
    setFormOpen(true);
  };

  const handleSearch = () => {
    const v = searchForm.getFieldsValue();
    fetchAgreements({
      status: v.status,
      agreementNumber: v.agreementNumber,
      customerId: v.customerId,
      propertyId: v.propertyId,
    });
  };

  const handleSave = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);

      const payload = {
        agreementType: v.agreementType,
        signDate: v.signDate?.format('YYYY-MM-DD'),
        startDate: v.dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate:   v.dateRange?.[1]?.format('YYYY-MM-DD'),
        propertyId: v.propertyId,
        customerId: v.customerId,
        brokerId: v.brokerId,
        brokerCommissionPct: v.brokerCommissionPct,
        brokerCommissionAmount: v.brokerCommissionAmount,
        tenantContactPhone: v.tenantContactPhone,
        tenantContactEmail: v.tenantContactEmail,
        paymentFrequency: v.paymentFrequency,
        totalAmount: v.totalAmount,
        currencyCode: 'AED',
        securityDepositAmount: v.securityDepositAmount,
        securityDepositCheque: v.securityDepositCheque,
        securityDepositDate: v.securityDepositDate?.format('YYYY-MM-DD'),
        securityDepositBank: v.securityDepositBank,
        advanceRentAmount: v.advanceRentAmount,
        advanceRentMonths: v.advanceRentMonths,
        ejariNumber: v.ejariNumber,
        municipalityFees: v.municipalityFees,
        noticePeriodDays: v.noticePeriodDays ?? 90,
        gracePeriodDays: v.gracePeriodDays ?? 0,
        renewalOption: v.renewalOption ? 'Y' : 'N',
        specialConditions: v.specialConditions,
        internalNotes: v.internalNotes,
      };

      const url    = editMode ? `${RM_BASE}/agreements/${selectedId}` : `${RM_BASE}/agreements`;
      const method = editMode ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const text   = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* skip */ }

      if (data.status === 'success') {
        message.success(editMode ? 'Agreement updated' : `Agreement created: ${data.agreementNumber}`);
        setFormOpen(false);
        fetchAgreements();
      } else {
        message.error(data.message || data.error || 'Save failed');
      }
    } catch { /* validation failed */ }
    setSaving(false);
  };

  const handleActivate = async (id: number) => {
    const res = await fetch(`${RM_BASE}/agreements/${id}/activate`, { method: 'POST' });
    const text = await res.text();
    try {
      const d = JSON.parse(text);
      if (d.status === 'success') { message.success('Agreement activated'); fetchAgreements(); }
      else message.error(d.message || 'Failed to activate');
    } catch { message.error('Failed'); }
  };

  const handleUpdateInstallment = async (row: Installment) => {
    try {
      const v = await instForm.validateFields();
      const payload = { ...v, installmentId: row.installmentId, chequeDate: v.chequeDate?.format('YYYY-MM-DD') };
      const res  = await fetch(`${RM_BASE}/installments/${row.installmentId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const text = await res.text();
      try {
        const d = JSON.parse(text);
        if (d.status === 'success') { message.success('Installment updated'); setInstEditRow(null); if (selectedId) await loadDetail(selectedId); }
        else message.error(d.message || 'Update failed');
      } catch { message.error('Failed'); }
    } catch { /* validation */ }
  };

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns: ColumnsType<Agreement> = [
    {
      title: 'Agreement #', dataIndex: 'agreementNumber', width: 160, fixed: 'left',
      render: (v, r) => <a onClick={() => openView(r.agreementId)} style={{ color: REDWOOD.info, fontWeight: 600 }}>{v}</a>,
    },
    { title: 'Status',   dataIndex: 'status',       width: 110,
      render: v => <Tag color={AGR_STATUS_COLOR[v] || 'default'}>{v}</Tag> },
    { title: 'Property', dataIndex: 'propertyName', width: 200, ellipsis: true,
      render: (v, r) => <span>{v} {r.unitNo ? `· ${r.unitNo}` : ''}</span> },
    { title: 'Tenant',   dataIndex: 'customerName', width: 180, ellipsis: true },
    { title: 'Start',    dataIndex: 'startDate',    width: 110 },
    { title: 'End',      dataIndex: 'endDate',      width: 110 },
    { title: 'Months',   dataIndex: 'noOfMonths',   width: 80, align: 'center' },
    { title: 'Frequency',dataIndex: 'frequency',    width: 120,
      render: v => v?.replace('_',' ') },
    { title: 'Total AED',dataIndex: 'totalAmount',  width: 130, align: 'right',
      render: v => `AED ${Number(v).toLocaleString()}` },
    { title: 'Freq. Amt',dataIndex: 'frequencyAmount', width: 120, align: 'right',
      render: v => `AED ${Number(v).toLocaleString()}` },
    { title: 'Payments', dataIndex: 'noOfPayments', width: 90, align: 'center' },
    { title: 'Ejari #',  dataIndex: 'ejariNumber',  width: 130, ellipsis: true },
    {
      title: 'Actions', key: 'actions', width: 130, fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View"><Button size="small" icon={<EyeOutlined />} onClick={() => openView(r.agreementId)} /></Tooltip>
          {r.status === 'DRAFT' && (
            <Tooltip title="Activate">
              <Popconfirm title="Activate this agreement?" onConfirm={() => handleActivate(r.agreementId)}>
                <Button size="small" type="primary" icon={<CheckCircleOutlined />} style={{ background: REDWOOD.success, border: 'none' }} />
              </Popconfirm>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const installmentColumns: ColumnsType<Installment> = [
    { title: '#',        dataIndex: 'installmentNo', width: 50, align: 'center' },
    { title: 'Due Date', dataIndex: 'dueDate',       width: 110 },
    { title: 'Amount',   dataIndex: 'amount',        width: 120, align: 'right',
      render: v => `AED ${Number(v).toLocaleString()}` },
    { title: 'Method',   dataIndex: 'paymentMethod', width: 110,
      render: (v, r) =>
        instEditRow === r.installmentId
          ? <Form.Item name="paymentMethod" noStyle initialValue={v}><Select size="small" style={{ width: 100 }}>
              {['CHEQUE','BANK_TRANSFER','CASH','CARD','ONLINE'].map(m => <Option key={m} value={m}>{m.replace('_',' ')}</Option>)}
            </Select></Form.Item>
          : v?.replace('_',' ') },
    { title: 'Cheque #', dataIndex: 'chequeNo',      width: 130,
      render: (v, r) =>
        instEditRow === r.installmentId
          ? <Form.Item name="chequeNo" noStyle initialValue={v}><Input size="small" style={{ width: 110 }} /></Form.Item>
          : v },
    { title: 'Cheque Date', dataIndex: 'chequeDate', width: 120,
      render: (v, r) =>
        instEditRow === r.installmentId
          ? <Form.Item name="chequeDate" noStyle initialValue={v ? dayjs(v) : null}><DatePicker size="small" style={{ width: 110 }} /></Form.Item>
          : v },
    { title: 'Bank',     dataIndex: 'bankName',      width: 140,
      render: (v, r) =>
        instEditRow === r.installmentId
          ? <Form.Item name="bankName" noStyle initialValue={v}><Input size="small" style={{ width: 120 }} /></Form.Item>
          : v },
    { title: 'Status',   dataIndex: 'status',        width: 110,
      render: (v, r) =>
        instEditRow === r.installmentId
          ? <Form.Item name="status" noStyle initialValue={v}><Select size="small" style={{ width: 100 }}>
              {['PENDING','PRESENTED','CLEARED','BOUNCED','WAIVED','CANCELLED'].map(s => <Option key={s} value={s}>{s}</Option>)}
            </Select></Form.Item>
          : <Tag color={INST_STATUS_COLOR[v] || 'default'} style={{ fontSize: 11 }}>{v}</Tag> },
    { title: 'Receipt #',dataIndex: 'receiptNumber', width: 120,
      render: (v, r) =>
        instEditRow === r.installmentId
          ? <Form.Item name="receiptNumber" noStyle initialValue={v}><Input size="small" style={{ width: 100 }} /></Form.Item>
          : v },
    {
      title: 'Action', key: 'act', width: 100,
      render: (_, r) =>
        instEditRow === r.installmentId
          ? <Space size={4}>
              <Button size="small" type="primary" onClick={() => handleUpdateInstallment(r)}
                style={{ background: REDWOOD.success, border: 'none', fontSize: 11 }}>Save</Button>
              <Button size="small" onClick={() => setInstEditRow(null)}>✕</Button>
            </Space>
          : <Button size="small" icon={<EditOutlined />} onClick={() => { instForm.resetFields(); setInstEditRow(r.installmentId); }}>Edit</Button>,
    },
  ];

  const splitColumns: ColumnsType<MonthlySplit> = [
    { title: 'Month',       key: 'period', width: 110,
      render: (_, r) => `${MONTH_NAMES[r.month-1]} ${r.year}` },
    { title: 'Amount AED',  dataIndex: 'amount', width: 130, align: 'right',
      render: v => `AED ${Number(v).toLocaleString()}` },
    { title: 'Status',      dataIndex: 'status', width: 120,
      render: v => <Tag color={v === 'RECOGNIZED' ? 'success' : v === 'REVERSED' ? 'error' : 'blue'}>{v}</Tag> },
    { title: 'Instalment#', dataIndex: 'installmentNo', width: 110 },
    { title: 'Cheque #',    dataIndex: 'chequeNo',      width: 130 },
    { title: 'Cheque Status', dataIndex: 'instStatus',  width: 120,
      render: v => v ? <Tag color={INST_STATUS_COLOR[v] || 'default'} style={{ fontSize: 11 }}>{v}</Tag> : null },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ background: REDWOOD.neutral100, minHeight: 'calc(100vh - 64px)' }}>
      <Content style={{ padding: '20px 28px' }}>

        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 16 }} items={[
          { title: <Link to="/home"><HomeOutlined /></Link> },
          { title: <Link to="/rm">Rental Management</Link> },
          { title: 'Manage Agreements' },
        ]} />

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Title level={4} style={{ margin: 0 }}>
            <FileProtectOutlined style={{ color: REDWOOD.rmTeal, marginRight: 8 }} />
            Manage Rental Agreements
          </Title>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
            style={{ background: REDWOOD.rmTeal, border: 'none' }}>
            New Agreement
          </Button>
        </div>

        {/* Search bar */}
        <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
          <Form form={searchForm} layout="inline" onFinish={handleSearch}>
            <Form.Item name="status" style={{ marginBottom: 0 }}>
              <Select placeholder="Status" style={{ width: 130 }} allowClear>
                {['DRAFT','ACTIVE','EXPIRED','TERMINATED','CANCELLED'].map(s =>
                  <Option key={s} value={s}>{s}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item name="agreementNumber" style={{ marginBottom: 0 }}>
              <Input placeholder="Agreement #" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="propertyId" style={{ marginBottom: 0 }}>
              <Select placeholder="Property" style={{ width: 200 }} allowClear showSearch
                optionFilterProp="children">
                {properties.map(p => <Option key={p.propertyId} value={p.propertyId}>{p.propertyName} {p.unitNo}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item name="customerId" style={{ marginBottom: 0 }}>
              <Select placeholder="Tenant" style={{ width: 180 }} allowClear showSearch optionFilterProp="children">
                {customers.map(c => <Option key={c.customerId} value={c.customerId}>{c.fullName}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                <Button htmlType="submit" icon={<SearchOutlined />} type="primary"
                  style={{ background: REDWOOD.info, border: 'none' }}>Search</Button>
                <Button icon={<ReloadOutlined />} onClick={() => { searchForm.resetFields(); fetchAgreements(); }}>Reset</Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        {/* Agreements table */}
        <Card style={{ borderRadius: 8 }}>
          <Table
            columns={columns}
            dataSource={agreements}
            rowKey="agreementId"
            loading={loading}
            size="small"
            scroll={{ x: 1600 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} agreements` }}
          />
        </Card>
      </Content>

      {/* ── VIEW / DETAIL MODAL ─────────────────────────────────────────── */}
      <Modal
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        title={<span><FileProtectOutlined style={{ color: REDWOOD.rmTeal, marginRight: 8 }} />Agreement Detail</span>}
        width={1100}
        footer={null}
        destroyOnClose
      >
        <Spin spinning={detailLoading}>
          {/* API URL bar */}
          {selectedId && (
            <div style={{
              background: '#1a1a2e', borderRadius: 6, padding: '6px 12px',
              marginBottom: 12, fontSize: 11, fontFamily: 'monospace',
              display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              <div><span style={{ color: '#1D7B4D', fontWeight: 700, marginRight: 8 }}>GET</span><span style={{ color: '#e0e0e0' }}>{RM_BASE}/agreements/{selectedId}</span></div>
              <div><span style={{ color: '#1D7B4D', fontWeight: 700, marginRight: 8 }}>GET</span><span style={{ color: '#e0e0e0' }}>{RM_BASE}/agreements/{selectedId}/installments</span></div>
              <div><span style={{ color: '#1D7B4D', fontWeight: 700, marginRight: 8 }}>GET</span><span style={{ color: '#e0e0e0' }}>{RM_BASE}/agreements/{selectedId}/splits</span></div>
            </div>
          )}

          <div style={{ minHeight: 300 }}>
          {!detailLoading && !activeAgreement && (
            <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>
              Failed to load agreement details — check console for errors.
            </div>
          )}
          {activeAgreement && (
            <Tabs defaultActiveKey="header" size="small">

              {/* ── Tab 1: Header ─────────────────────────────────────── */}
              <TabPane tab="Header" key="header">
                <Row gutter={24}>
                  <Col span={12}>
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="Agreement #">
                        <strong>{activeAgreement.agreementNumber}</strong>
                      </Descriptions.Item>
                      <Descriptions.Item label="Status">
                        <Tag color={AGR_STATUS_COLOR[activeAgreement.status]}>{activeAgreement.status}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Type">{activeAgreement.agreementType}</Descriptions.Item>
                      <Descriptions.Item label="Sign Date">{activeAgreement.signDate}</Descriptions.Item>
                      <Descriptions.Item label="Period">
                        {activeAgreement.startDate} → {activeAgreement.endDate}
                        <Text type="secondary" style={{ marginLeft: 8 }}>({activeAgreement.noOfMonths} months)</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Frequency">{activeAgreement.paymentFrequency?.replace('_',' ')}</Descriptions.Item>
                      <Descriptions.Item label="Payments">{activeAgreement.noOfPayments}</Descriptions.Item>
                    </Descriptions>
                  </Col>
                  <Col span={12}>
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="Total Rent">
                        <strong style={{ color: REDWOOD.success }}>AED {Number(activeAgreement.totalAmount).toLocaleString()}</strong>
                      </Descriptions.Item>
                      <Descriptions.Item label="Per Payment">
                        AED {Number(activeAgreement.frequencyAmount).toLocaleString()}
                      </Descriptions.Item>
                      <Descriptions.Item label="Security Deposit">
                        AED {Number(activeAgreement.securityDepositAmount || 0).toLocaleString()}
                        <Tag style={{ marginLeft: 8 }}>{activeAgreement.securityDepositStatus}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Municipality Fees">
                        AED {Number(activeAgreement.municipalityFees || 0).toLocaleString()}
                        <Tag color={activeAgreement.municipalityFeesPaid === 'Y' ? 'success' : 'default'} style={{ marginLeft: 8 }}>
                          {activeAgreement.municipalityFeesPaid === 'Y' ? 'Paid' : 'Unpaid'}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Ejari #">{activeAgreement.ejariNumber}</Descriptions.Item>
                      <Descriptions.Item label="Notice Period">{activeAgreement.noticePeriodDays} days</Descriptions.Item>
                    </Descriptions>
                  </Col>
                </Row>

                <Divider style={{ margin: '16px 0' }} />

                <Row gutter={24}>
                  <Col span={12}>
                    <Descriptions size="small" column={1} bordered title="Property">
                      <Descriptions.Item label="Property">{activeAgreement.propertyNumber} — {activeAgreement.propertyName}</Descriptions.Item>
                      <Descriptions.Item label="Unit">{activeAgreement.unitNo}</Descriptions.Item>
                      <Descriptions.Item label="Community">{activeAgreement.community}</Descriptions.Item>
                    </Descriptions>
                  </Col>
                  <Col span={12}>
                    <Descriptions size="small" column={1} bordered title="Tenant">
                      <Descriptions.Item label="Tenant">{activeAgreement.customerName}</Descriptions.Item>
                      <Descriptions.Item label="Mobile">{activeAgreement.customerMobile}</Descriptions.Item>
                      <Descriptions.Item label="Email">{activeAgreement.tenantContactEmail}</Descriptions.Item>
                    </Descriptions>
                  </Col>
                </Row>

                {activeAgreement.specialConditions && (
                  <>
                    <Divider style={{ margin: '12px 0' }} />
                    <Text strong>Special Conditions:</Text>
                    <div style={{ marginTop: 6, padding: 10, background: REDWOOD.neutral100, borderRadius: 6, fontSize: 13 }}>
                      {activeAgreement.specialConditions}
                    </div>
                  </>
                )}
              </TabPane>

              {/* ── Tab 2: Installments ──────────────────────────────── */}
              <TabPane
                tab={<span><DollarOutlined /> Installments <Badge count={installments.length} size="small" /></span>}
                key="installments"
              >
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Click Edit on a row to update cheque number, bank, and payment status.
                  </Text>
                </div>
                <Form form={instForm}>
                  <Table
                    columns={installmentColumns}
                    dataSource={installments}
                    rowKey="installmentId"
                    size="small"
                    scroll={{ x: 1000 }}
                    pagination={false}
                    rowClassName={r => r.status === 'BOUNCED' ? 'ant-table-row-danger' : ''}
                  />
                </Form>
                <div style={{ marginTop: 12, padding: 12, background: REDWOOD.neutral100, borderRadius: 6, display: 'flex', gap: 24 }}>
                  <Text>Total: <strong>AED {installments.reduce((s,i) => s + Number(i.amount), 0).toLocaleString()}</strong></Text>
                  <Text>Cleared: <strong style={{ color: REDWOOD.success }}>{installments.filter(i => i.status === 'CLEARED').length}</strong></Text>
                  <Text>Pending: <strong style={{ color: REDWOOD.warning }}>{installments.filter(i => i.status === 'PENDING').length}</strong></Text>
                  <Text>Bounced: <strong style={{ color: REDWOOD.primary }}>{installments.filter(i => i.status === 'BOUNCED').length}</strong></Text>
                </div>
              </TabPane>

              {/* ── Tab 3: Monthly Revenue Split ─────────────────────── */}
              <TabPane
                tab={<span><FileTextOutlined /> Monthly Revenue Split <Badge count={splits.length} size="small" /></span>}
                key="splits"
              >
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Monthly prorated revenue recognition — one row per calendar month.
                    Status becomes RECOGNIZED when the linked cheque is cleared.
                  </Text>
                </div>
                <Table
                  columns={splitColumns}
                  dataSource={splits}
                  rowKey="splitId"
                  size="small"
                  pagination={false}
                  scroll={{ x: 700 }}
                />
                <div style={{ marginTop: 12, padding: 12, background: REDWOOD.neutral100, borderRadius: 6, display: 'flex', gap: 24 }}>
                  <Text>Total Monthly: <strong>AED {splits.reduce((s,m) => s + Number(m.amount), 0).toLocaleString()}</strong></Text>
                  <Text>Recognized: <strong style={{ color: REDWOOD.success }}>{splits.filter(m => m.status === 'RECOGNIZED').length} months</strong></Text>
                  <Text>Accrued: <strong style={{ color: REDWOOD.info }}>{splits.filter(m => m.status === 'ACCRUED').length} months</strong></Text>
                </div>
              </TabPane>

              {/* ── Tab 4: Documents ─────────────────────────────────── */}
              <TabPane
                tab={<span><FileTextOutlined /> Documents</span>}
                key="documents"
              >
                <Table
                  dataSource={documents}
                  rowKey="documentId"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: 'Document Type',   dataIndex: 'docTypeName',    width: 200 },
                    { title: 'Required',         dataIndex: 'mandatoryFlag',  width: 90,
                      render: v => v === 'Y' ? <Tag color="red">Required</Tag> : <Tag>Optional</Tag> },
                    { title: 'Submitted',        dataIndex: 'submittedFlag',  width: 100,
                      render: v => <Tag color={v === 'Y' ? 'success' : 'default'}>{v === 'Y' ? '✓ Yes' : 'Pending'}</Tag> },
                    { title: 'Document #',       dataIndex: 'documentNumber', width: 150 },
                    { title: 'Expiry',           dataIndex: 'documentExpiry', width: 120 },
                    { title: 'Verified',         dataIndex: 'verifiedFlag',   width: 90,
                      render: v => <Tag color={v === 'Y' ? 'success' : 'warning'}>{v === 'Y' ? 'Verified' : 'Pending'}</Tag> },
                    { title: 'Notes',            dataIndex: 'notes',          ellipsis: true },
                  ]}
                />
              </TabPane>

            </Tabs>
          )}
          </div>
        </Spin>
      </Modal>

      {/* ── CREATE / EDIT FORM MODAL ──────────────────────────────────────── */}
      <Modal
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        title={<span><FileProtectOutlined style={{ color: REDWOOD.rmTeal, marginRight: 8 }} />
          {editMode ? 'Edit Agreement' : 'New Rental Agreement'}</span>}
        width={900}
        onOk={handleSave}
        okText={saving ? 'Saving…' : editMode ? 'Update' : 'Create Agreement'}
        confirmLoading={saving}
        okButtonProps={{ style: { background: REDWOOD.rmTeal, border: 'none' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" size="small">
          <Tabs defaultActiveKey="agreement">

            {/* ── Agreement & Dates ── */}
            <TabPane tab="Agreement" key="agreement">
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="agreementType" label="Type" initialValue="NEW">
                    <Select><Option value="NEW">New</Option><Option value="RENEWAL">Renewal</Option><Option value="TRANSFER">Transfer</Option></Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="signDate" label="Sign Date" rules={[{ required: true }]}>
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="paymentFrequency" label="Payment Frequency" rules={[{ required: true }]}>
                    <Select>
                      <Option value="MONTHLY">Monthly (12 cheques)</Option>
                      <Option value="QUARTERLY">Quarterly (4 cheques)</Option>
                      <Option value="HALF_YEARLY">Half-Yearly (2 cheques)</Option>
                      <Option value="YEARLY">Yearly (1 cheque)</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={16}>
                  <Form.Item name="dateRange" label="Agreement Period (Start → End)" rules={[{ required: true }]}>
                    <RangePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="totalAmount" label="Total Annual Rent (AED)" rules={[{ required: true }]}>
                    <InputNumber style={{ width: '100%' }} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} min={0} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="noticePeriodDays" label="Notice Period (days)" initialValue={90}>
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="gracePeriodDays" label="Grace Period (days)" initialValue={0}>
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="renewalOption" label="Renewal Option" valuePropName="checked">
                    <Checkbox>Allow Renewal</Checkbox>
                  </Form.Item>
                </Col>
              </Row>
            </TabPane>

            {/* ── Property & Tenant ── */}
            <TabPane tab="Property & Tenant" key="property">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="propertyId" label="Property" rules={[{ required: true }]}>
                    <Select showSearch optionFilterProp="children" placeholder="Select property">
                      {properties.map(p => (
                        <Option key={p.propertyId} value={p.propertyId}>
                          {p.propertyNumber} — {p.propertyName} {p.unitNo ? `· ${p.unitNo}` : ''}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="customerId" label="Tenant" rules={[{ required: true }]}>
                    <Select showSearch optionFilterProp="children" placeholder="Select tenant">
                      {customers.map(c => (
                        <Option key={c.customerId} value={c.customerId}>
                          {c.fullName} — {c.mobile}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="tenantContactPhone" label="Tenant Contact Phone">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="tenantContactEmail" label="Tenant Contact Email">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="brokerId" label="Broker (if any)">
                    <Select allowClear showSearch optionFilterProp="children" placeholder="Select broker">
                      {brokers.map(b => <Option key={b.brokerId} value={b.brokerId}>{b.brokerName}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="brokerCommissionPct" label="Broker Commission %">
                    <InputNumber style={{ width: '100%' }} min={0} max={100} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="brokerCommissionAmount" label="Broker Commission AED">
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                </Col>
              </Row>
            </TabPane>

            {/* ── Financial & Deposit ── */}
            <TabPane tab="Financial" key="financial">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="securityDepositAmount" label="Security Deposit (AED)">
                    <InputNumber style={{ width: '100%' }} min={0} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="securityDepositCheque" label="Security Deposit Cheque #">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="securityDepositDate" label="Security Deposit Date">
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="securityDepositBank" label="Security Deposit Bank">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="advanceRentAmount" label="Advance Rent (AED)">
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="advanceRentMonths" label="Advance Rent (Months)">
                    <InputNumber style={{ width: '100%' }} min={0} max={12} />
                  </Form.Item>
                </Col>
              </Row>
            </TabPane>

            {/* ── Dubai Compliance ── */}
            <TabPane tab="Dubai / Ejari" key="dubai">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="ejariNumber" label="Ejari Number">
                    <Input placeholder="Ejari registration number" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="municipalityFees" label="Municipality Fees — 5% AED">
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="specialConditions" label="Special Conditions">
                <TextArea rows={4} placeholder="Any special terms, break clauses, maintenance responsibilities…" />
              </Form.Item>
              <Form.Item name="internalNotes" label="Internal Notes">
                <TextArea rows={3} placeholder="Internal notes (not visible to tenant)" />
              </Form.Item>
            </TabPane>

          </Tabs>
        </Form>
      </Modal>

      
    </Layout>
  );
};

export default ManageAgreements;
