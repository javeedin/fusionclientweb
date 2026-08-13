import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Typography, Card, Breadcrumb, Table, Tag, Button, Space,
  Form, Input, Select, DatePicker, Modal, Row, Col, message, Tabs,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', rmTeal: '#0B6E6E',
};
const RM_BASE = `${APEX_DB_CONFIG.baseUrl}/rm`;

const STATUS_COLOR: Record<string,string> = { ACTIVE: 'success', INACTIVE: 'default', BLACKLISTED: 'error' };

interface Customer {
  customerId: number; customerNumber: string; customerType: string; fullName: string;
  companyName: string; email: string; mobile: string; nationality: string;
  emiratesId: string; passportNo: string; passportExpiry: string;
  emiratesIdExpiry: string; tradeLicenseNo: string; occupation: string; city: string; status: string;
}

const ManageCustomers: React.FC = () => {
  const [data, setData]       = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId]   = useState<number | null>(null);
  const [saving, setSaving]   = useState(false);
  const [form]                = Form.useForm();
  const [searchForm]          = Form.useForm();

  const fetchData = useCallback(async (filters?: any) => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters?.status) p.append('status', filters.status);
      if (filters?.search) p.append('search', filters.search);
      const res  = await fetch(`${RM_BASE}/customers?${p}`);
      const text = await res.text();
      try { const d = JSON.parse(text); setData(d.customers || []); } catch { setData([]); }
    } catch { setData([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => { form.resetFields(); setEditId(null); setModalOpen(true); };
  const openEdit   = (r: Customer) => {
    setEditId(r.customerId);
    form.setFieldsValue({
      ...r,
      passportExpiry:   r.passportExpiry   ? dayjs(r.passportExpiry)   : null,
      emiratesIdExpiry: r.emiratesIdExpiry ? dayjs(r.emiratesIdExpiry) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const payload = {
        ...v,
        passportExpiry:   v.passportExpiry?.format('YYYY-MM-DD'),
        emiratesIdExpiry: v.emiratesIdExpiry?.format('YYYY-MM-DD'),
        tradeLicenseExpiry: v.tradeLicenseExpiry?.format('YYYY-MM-DD'),
      };
      const url    = editId ? `${RM_BASE}/customers/${editId}` : `${RM_BASE}/customers`;
      const method = editId ? 'PUT' : 'POST';
      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const text = await res.text();
      try {
        const d = JSON.parse(text);
        if (d.status === 'success') { message.success(editId ? 'Customer updated' : `Customer created: ${d.customerNumber}`); setModalOpen(false); fetchData(); }
        else message.error(d.message || 'Save failed');
      } catch { message.error('Failed'); }
    } catch { /* validation */ }
    setSaving(false);
  };

  const columns: ColumnsType<Customer> = [
    { title: 'Customer #',   dataIndex: 'customerNumber', width: 130 },
    { title: 'Type',         dataIndex: 'customerType',   width: 100,
      render: v => <Tag>{v}</Tag> },
    { title: 'Full Name',    dataIndex: 'fullName',       width: 200, ellipsis: true },
    { title: 'Company',      dataIndex: 'companyName',    width: 180, ellipsis: true },
    { title: 'Mobile',       dataIndex: 'mobile',         width: 130 },
    { title: 'Email',        dataIndex: 'email',          width: 190, ellipsis: true },
    { title: 'Nationality',  dataIndex: 'nationality',    width: 110 },
    { title: 'Emirates ID',  dataIndex: 'emiratesId',     width: 140 },
    { title: 'Passport #',   dataIndex: 'passportNo',     width: 130 },
    { title: 'Passport Exp', dataIndex: 'passportExpiry', width: 120 },
    { title: 'Occupation',   dataIndex: 'occupation',     width: 150, ellipsis: true },
    { title: 'Status',       dataIndex: 'status',         width: 100,
      render: v => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag> },
    {
      title: 'Actions', key: 'act', width: 80,
      render: (_, r) => <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>,
    },
  ];

  return (
    <Layout style={{ background: REDWOOD.neutral100, minHeight: 'calc(100vh - 64px)' }}>
      <Content style={{ padding: '20px 28px' }}>
        <Breadcrumb style={{ marginBottom: 16 }}>
          <Breadcrumb.Item><Link to="/home"><HomeOutlined /></Link></Breadcrumb.Item>
          <Breadcrumb.Item><Link to="/rm">Rental Management</Link></Breadcrumb.Item>
          <Breadcrumb.Item>Tenants / Customers</Breadcrumb.Item>
        </Breadcrumb>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>Tenants / Customers</Title>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
            style={{ background: REDWOOD.rmTeal, border: 'none' }}>Add Customer</Button>
        </div>
        <Card style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
          <Form form={searchForm} layout="inline">
            <Form.Item name="status"><Select placeholder="Status" style={{ width: 130 }} allowClear>
              {['ACTIVE','INACTIVE','BLACKLISTED'].map(s => <Option key={s} value={s}>{s}</Option>)}
            </Select></Form.Item>
            <Form.Item name="search"><Input placeholder="Name / Mobile / Emirates ID" style={{ width: 220 }} /></Form.Item>
            <Space>
              <Button icon={<SearchOutlined />} type="primary" onClick={() => fetchData(searchForm.getFieldsValue())}
                style={{ background: REDWOOD.info, border: 'none' }}>Search</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { searchForm.resetFields(); fetchData(); }}>Reset</Button>
            </Space>
          </Form>
        </Card>
        <Card style={{ borderRadius: 8 }}>
          <Table columns={columns} dataSource={data} rowKey="customerId" loading={loading}
            size="small" scroll={{ x: 1600 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} customers` }} />
        </Card>
      </Content>

      <Modal open={modalOpen} onCancel={() => setModalOpen(false)}
        title={editId ? 'Edit Customer' : 'New Tenant / Customer'}
        width={780} onOk={handleSave} confirmLoading={saving}
        okText={editId ? 'Update' : 'Create Customer'}
        okButtonProps={{ style: { background: REDWOOD.rmTeal, border: 'none' } }}
        destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          <Tabs defaultActiveKey="basic">
            <TabPane tab="Basic Info" key="basic">
              <Row gutter={16}>
                <Col span={12}><Form.Item name="customerType" label="Type" initialValue="INDIVIDUAL">
                  <Select><Option value="INDIVIDUAL">Individual</Option><Option value="COMPANY">Company</Option></Select>
                </Form.Item></Col>
                <Col span={12}><Form.Item name="status" label="Status" initialValue="ACTIVE">
                  <Select>{['ACTIVE','INACTIVE','BLACKLISTED'].map(s => <Option key={s} value={s}>{s}</Option>)}</Select>
                </Form.Item></Col>
                <Col span={8}><Form.Item name="firstName" label="First Name"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="lastName"  label="Last Name"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="fullName"  label="Full Name" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="companyName" label="Company Name"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="nationality" label="Nationality"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="mobile" label="Mobile" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="phone"  label="Phone"><Input /></Form.Item></Col>
                <Col span={24}><Form.Item name="email"  label="Email"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="occupation"   label="Occupation"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="employerName" label="Employer"><Input /></Form.Item></Col>
              </Row>
            </TabPane>
            <TabPane tab="ID Documents" key="ids">
              <Row gutter={16}>
                <Col span={12}><Form.Item name="emiratesId" label="Emirates ID #"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="emiratesIdExpiry" label="Emirates ID Expiry"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                <Col span={12}><Form.Item name="passportNo" label="Passport #"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="passportExpiry" label="Passport Expiry"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                <Col span={12}><Form.Item name="tradeLicenseNo" label="Trade License #"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="tradeLicenseExpiry" label="Trade License Expiry"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
              </Row>
            </TabPane>
            <TabPane tab="Address" key="address">
              <Row gutter={16}>
                <Col span={24}><Form.Item name="addressLine1" label="Address Line 1"><Input /></Form.Item></Col>
                <Col span={24}><Form.Item name="addressLine2" label="Address Line 2"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="city"    label="City"    initialValue="Dubai"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="emirate" label="Emirate" initialValue="Dubai"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="country" label="Country" initialValue="UAE"><Input /></Form.Item></Col>
              </Row>
            </TabPane>
          </Tabs>
        </Form>
      </Modal>
    </Layout>
  );
};

export default ManageCustomers;
