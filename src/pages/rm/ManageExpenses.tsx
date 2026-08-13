import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Typography, Card, Breadcrumb, Table, Tag, Button, Space,
  Form, Input, Select, DatePicker, Modal, InputNumber, Row, Col, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', rmTeal: '#0B6E6E',
};
const RM_BASE = `${APEX_DB_CONFIG.baseUrl}/rm`;

const STATUS_COLOR: Record<string,string> = { PENDING: 'default', APPROVED: 'processing', PAID: 'success', CANCELLED: 'error' };

interface Expense {
  expenseId: number; expenseNumber: string; expenseDate: string;
  description: string; amount: number; currencyCode: string;
  paidBy: string; status: string; receiptNo: string;
  vendorName: string; propertyName: string; expenseTypeName: string; category: string;
}
interface Property { propertyId: number; propertyNumber: string; propertyName: string; }
interface ExpenseType { expenseTypeId: number; expenseTypeName: string; category: string; }

const ManageExpenses: React.FC = () => {
  const [data, setData]           = useState<Expense[]>([]);
  const [loading, setLoading]     = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [expTypes, setExpTypes]   = useState<ExpenseType[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId]       = useState<number | null>(null);
  const [saving, setSaving]       = useState(false);
  const [form]                    = Form.useForm();
  const [searchForm]              = Form.useForm();

  const fetchData = useCallback(async (filters?: any) => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters?.status)     p.append('status',      filters.status);
      if (filters?.propertyId) p.append('property_id', filters.propertyId);
      if (filters?.dateFrom)   p.append('date_from',   filters.dateFrom?.format('YYYY-MM-DD'));
      if (filters?.dateTo)     p.append('date_to',     filters.dateTo?.format('YYYY-MM-DD'));
      const res  = await fetch(`${RM_BASE}/expenses?${p}`);
      const text = await res.text();
      try { const d = JSON.parse(text); setData(d.expenses || []); } catch { setData([]); }
    } catch { setData([]); }
    setLoading(false);
  }, []);

  const fetchLookups = useCallback(async () => {
    try {
      const res  = await fetch(`${RM_BASE}/properties`);
      const text = await res.text();
      try { const d = JSON.parse(text); setProperties(d.properties || []); } catch { /* skip */ }
    } catch { /* skip */ }
    // expense types are static — define inline for now
    setExpTypes([
      { expenseTypeId: 100, expenseTypeName: 'AC Maintenance', category: 'MAINTENANCE' },
      { expenseTypeId: 101, expenseTypeName: 'Plumbing',        category: 'MAINTENANCE' },
      { expenseTypeId: 102, expenseTypeName: 'Electrical',      category: 'MAINTENANCE' },
      { expenseTypeId: 103, expenseTypeName: 'Painting',        category: 'MAINTENANCE' },
      { expenseTypeId: 104, expenseTypeName: 'General Maintenance', category: 'MAINTENANCE' },
      { expenseTypeId: 105, expenseTypeName: 'DEWA',            category: 'UTILITY' },
      { expenseTypeId: 106, expenseTypeName: 'District Cooling', category: 'UTILITY' },
      { expenseTypeId: 107, expenseTypeName: 'Internet',        category: 'UTILITY' },
      { expenseTypeId: 108, expenseTypeName: 'Ejari Fee',       category: 'LEGAL' },
      { expenseTypeId: 109, expenseTypeName: 'Municipality Fees', category: 'ADMIN' },
      { expenseTypeId: 110, expenseTypeName: 'Broker Fee',      category: 'ADMIN' },
      { expenseTypeId: 111, expenseTypeName: 'Service Charge',  category: 'ADMIN' },
      { expenseTypeId: 112, expenseTypeName: 'Insurance',       category: 'INSURANCE' },
      { expenseTypeId: 113, expenseTypeName: 'Renovation',      category: 'CAPITAL' },
      { expenseTypeId: 114, expenseTypeName: 'Legal Fees',      category: 'LEGAL' },
      { expenseTypeId: 115, expenseTypeName: 'Other',           category: 'OTHER' },
    ]);
  }, []);

  useEffect(() => { fetchData(); fetchLookups(); }, [fetchData, fetchLookups]);

  const openCreate = () => { form.resetFields(); setEditId(null); setModalOpen(true); };
  const openEdit   = (r: Expense) => {
    setEditId(r.expenseId);
    form.setFieldsValue({ ...r, expenseDate: r.expenseDate ? dayjs(r.expenseDate) : null });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const payload = { ...v, expenseDate: v.expenseDate?.format('YYYY-MM-DD') };
      const url    = editId ? `${RM_BASE}/expenses/${editId}` : `${RM_BASE}/expenses`;
      const method = editId ? 'PUT' : 'POST';
      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const text = await res.text();
      try {
        const d = JSON.parse(text);
        if (d.status === 'success') { message.success(editId ? 'Expense updated' : `Expense recorded: ${d.expenseNumber}`); setModalOpen(false); fetchData(); }
        else message.error(d.message || 'Save failed');
      } catch { message.error('Failed'); }
    } catch { /* validation */ }
    setSaving(false);
  };

  const columns: ColumnsType<Expense> = [
    { title: 'Expense #',  dataIndex: 'expenseNumber',   width: 150 },
    { title: 'Date',       dataIndex: 'expenseDate',      width: 110 },
    { title: 'Property',   dataIndex: 'propertyName',     width: 180, ellipsis: true },
    { title: 'Type',       dataIndex: 'expenseTypeName',  width: 160, ellipsis: true },
    { title: 'Category',   dataIndex: 'category',         width: 120 },
    { title: 'Description',dataIndex: 'description',      width: 220, ellipsis: true },
    { title: 'Amount',     dataIndex: 'amount',           width: 130, align: 'right',
      render: (v, r) => `${r.currencyCode} ${Number(v).toLocaleString()}` },
    { title: 'Paid By',    dataIndex: 'paidBy',           width: 90 },
    { title: 'Vendor',     dataIndex: 'vendorName',        width: 160, ellipsis: true },
    { title: 'Receipt #',  dataIndex: 'receiptNo',         width: 130 },
    { title: 'Status',     dataIndex: 'status',            width: 110,
      render: v => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> },
    {
      title: 'Actions', key: 'act', width: 80,
      render: (_, r) => <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>,
    },
  ];

  const totalAmount = data.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <Layout style={{ background: REDWOOD.neutral100, minHeight: 'calc(100vh - 64px)' }}>
      <Content style={{ padding: '20px 28px' }}>
        <Breadcrumb style={{ marginBottom: 16 }}>
          <Breadcrumb.Item><Link to="/home"><HomeOutlined /></Link></Breadcrumb.Item>
          <Breadcrumb.Item><Link to="/rm">Rental Management</Link></Breadcrumb.Item>
          <Breadcrumb.Item>Property Expenses</Breadcrumb.Item>
        </Breadcrumb>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>Property Expenses</Title>
            {data.length > 0 && (
              <span style={{ fontSize: 13, color: REDWOOD.primary, fontWeight: 600 }}>
                Total: AED {totalAmount.toLocaleString()}
              </span>
            )}
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
            style={{ background: REDWOOD.rmTeal, border: 'none' }}>Record Expense</Button>
        </div>

        <Card style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
          <Form form={searchForm} layout="inline">
            <Form.Item name="status"><Select placeholder="Status" style={{ width: 120 }} allowClear>
              {['PENDING','APPROVED','PAID','CANCELLED'].map(s => <Option key={s} value={s}>{s}</Option>)}
            </Select></Form.Item>
            <Form.Item name="propertyId"><Select placeholder="Property" style={{ width: 200 }} allowClear showSearch optionFilterProp="children">
              {properties.map(p => <Option key={p.propertyId} value={p.propertyId}>{p.propertyName}</Option>)}
            </Select></Form.Item>
            <Form.Item name="dateFrom"><DatePicker placeholder="From date" style={{ width: 130 }} /></Form.Item>
            <Form.Item name="dateTo"><DatePicker placeholder="To date" style={{ width: 130 }} /></Form.Item>
            <Space>
              <Button icon={<SearchOutlined />} type="primary" onClick={() => fetchData(searchForm.getFieldsValue())}
                style={{ background: REDWOOD.info, border: 'none' }}>Search</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { searchForm.resetFields(); fetchData(); }}>Reset</Button>
            </Space>
          </Form>
        </Card>

        <Card style={{ borderRadius: 8 }}>
          <Table columns={columns} dataSource={data} rowKey="expenseId" loading={loading}
            size="small" scroll={{ x: 1500 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} expenses` }} />
        </Card>
      </Content>

      <Modal open={modalOpen} onCancel={() => setModalOpen(false)}
        title={editId ? 'Edit Expense' : 'Record Property Expense'}
        width={680} onOk={handleSave} confirmLoading={saving}
        okText={editId ? 'Update' : 'Record Expense'}
        okButtonProps={{ style: { background: REDWOOD.rmTeal, border: 'none' } }}
        destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          <Row gutter={16}>
            <Col span={12}><Form.Item name="propertyId" label="Property" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="children">
                {properties.map(p => <Option key={p.propertyId} value={p.propertyId}>{p.propertyName}</Option>)}
              </Select>
            </Form.Item></Col>
            <Col span={12}><Form.Item name="expenseTypeId" label="Expense Type" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="children">
                {expTypes.map(t => <Option key={t.expenseTypeId} value={t.expenseTypeId}>{t.expenseTypeName} ({t.category})</Option>)}
              </Select>
            </Form.Item></Col>
            <Col span={12}><Form.Item name="expenseDate" label="Date" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="amount" label="Amount (AED)" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
            </Form.Item></Col>
            <Col span={24}><Form.Item name="description" label="Description" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="paidBy" label="Paid By" initialValue="OWNER">
              <Select><Option value="OWNER">Owner</Option><Option value="TENANT">Tenant</Option></Select>
            </Form.Item></Col>
            <Col span={12}><Form.Item name="paymentMethod" label="Payment Method">
              <Select allowClear>
                {['CHEQUE','BANK_TRANSFER','CASH','CARD'].map(m => <Option key={m} value={m}>{m.replace('_',' ')}</Option>)}
              </Select>
            </Form.Item></Col>
            <Col span={12}><Form.Item name="vendorName" label="Vendor / Supplier"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="vendorContact" label="Vendor Contact"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="receiptNo" label="Receipt #"><Input /></Form.Item></Col>
            {editId && (
              <Col span={12}><Form.Item name="status" label="Status">
                <Select>{['PENDING','APPROVED','PAID','CANCELLED'].map(s => <Option key={s} value={s}>{s}</Option>)}</Select>
              </Form.Item></Col>
            )}
            <Col span={24}><Form.Item name="notes" label="Notes"><TextArea rows={3} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </Layout>
  );
};

export default ManageExpenses;
