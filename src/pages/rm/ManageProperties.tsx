import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Typography, Card, Breadcrumb, Table, Tag, Button, Space,
  Form, Input, Select, DatePicker, Modal, InputNumber, Row, Col, message, Tabs,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;
const { TextArea } = Input;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800',
  info: '#0572CE', neutral100: '#F7F7F7', neutral200: '#E5E5E5', rmTeal: '#0B6E6E',
};
const RM_BASE = `${APEX_DB_CONFIG.baseUrl}/rm`;

const STATUS_COLOR: Record<string,string> = {
  AVAILABLE: 'success', RENTED: 'processing', MAINTENANCE: 'warning',
  RESERVED: 'default', SOLD: 'error',
};

interface Property {
  propertyId: number; propertyNumber: string; propertyName: string;
  propertyType: string; usageType: string; buildingName: string;
  unitNo: string; community: string; bedrooms: number; bathrooms: number;
  areaSqft: number; ownerName: string; annualMarketRent: number; status: string;
}

const ManageProperties: React.FC = () => {
  const [data, setData]       = useState<Property[]>([]);
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
      if (filters?.status)       p.append('status',        filters.status);
      if (filters?.usageType)    p.append('usage_type',    filters.usageType);
      if (filters?.propertyType) p.append('property_type', filters.propertyType);
      if (filters?.search)       p.append('search',        filters.search);
      const res  = await fetch(`${RM_BASE}/properties?${p}`);
      const text = await res.text();
      try { const d = JSON.parse(text); setData(d.properties || []); } catch { setData([]); }
    } catch { setData([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => { form.resetFields(); setEditId(null); setModalOpen(true); };
  const openEdit   = (r: Property) => {
    setEditId(r.propertyId);
    form.setFieldsValue({ ...r });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const url    = editId ? `${RM_BASE}/properties/${editId}` : `${RM_BASE}/properties`;
      const method = editId ? 'PUT' : 'POST';
      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
      const text = await res.text();
      try {
        const d = JSON.parse(text);
        if (d.status === 'success') { message.success(editId ? 'Property updated' : `Property created: ${d.propertyNumber}`); setModalOpen(false); fetchData(); }
        else message.error(d.message || 'Save failed');
      } catch { message.error('Failed'); }
    } catch { /* validation */ }
    setSaving(false);
  };

  const columns: ColumnsType<Property> = [
    { title: 'Property #',  dataIndex: 'propertyNumber', width: 130 },
    { title: 'Name',        dataIndex: 'propertyName',   width: 200, ellipsis: true },
    { title: 'Type',        dataIndex: 'propertyType',   width: 110 },
    { title: 'Usage',       dataIndex: 'usageType',      width: 110 },
    { title: 'Building',    dataIndex: 'buildingName',   width: 150, ellipsis: true },
    { title: 'Unit',        dataIndex: 'unitNo',         width: 80 },
    { title: 'Community',   dataIndex: 'community',      width: 140, ellipsis: true },
    { title: 'Beds',        dataIndex: 'bedrooms',       width: 60, align: 'center' },
    { title: 'Area sqft',   dataIndex: 'areaSqft',       width: 100, align: 'right',
      render: v => v ? Number(v).toLocaleString() : '—' },
    { title: 'Owner',       dataIndex: 'ownerName',      width: 160, ellipsis: true },
    { title: 'Market Rent', dataIndex: 'annualMarketRent', width: 130, align: 'right',
      render: v => v ? `AED ${Number(v).toLocaleString()}` : '—' },
    { title: 'Status',      dataIndex: 'status',         width: 120,
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
          <Breadcrumb.Item>Properties</Breadcrumb.Item>
        </Breadcrumb>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>Property List</Title>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
            style={{ background: REDWOOD.rmTeal, border: 'none' }}>Add Property</Button>
        </div>

        <Card style={{ marginBottom: 12, borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
          <Form form={searchForm} layout="inline">
            <Form.Item name="status"><Select placeholder="Status" style={{ width: 130 }} allowClear>
              {['AVAILABLE','RENTED','MAINTENANCE','RESERVED','SOLD'].map(s => <Option key={s} value={s}>{s}</Option>)}
            </Select></Form.Item>
            <Form.Item name="usageType"><Select placeholder="Usage" style={{ width: 130 }} allowClear>
              <Option value="RESIDENTIAL">Residential</Option>
              <Option value="COMMERCIAL">Commercial</Option>
              <Option value="MIXED">Mixed</Option>
            </Select></Form.Item>
            <Form.Item name="propertyType"><Select placeholder="Type" style={{ width: 130 }} allowClear>
              {['APARTMENT','VILLA','STUDIO','TOWNHOUSE','OFFICE','SHOP','WAREHOUSE','LAND'].map(t =>
                <Option key={t} value={t}>{t}</Option>)}
            </Select></Form.Item>
            <Form.Item name="search"><Input placeholder="Search name / community" style={{ width: 200 }} /></Form.Item>
            <Space>
              <Button icon={<SearchOutlined />} type="primary" onClick={() => fetchData(searchForm.getFieldsValue())}
                style={{ background: REDWOOD.info, border: 'none' }}>Search</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { searchForm.resetFields(); fetchData(); }}>Reset</Button>
            </Space>
          </Form>
        </Card>

        <Card style={{ borderRadius: 8 }}>
          <Table columns={columns} dataSource={data} rowKey="propertyId" loading={loading}
            size="small" scroll={{ x: 1400 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} properties` }} />
        </Card>
      </Content>

      <Modal open={modalOpen} onCancel={() => setModalOpen(false)}
        title={editId ? 'Edit Property' : 'New Property'}
        width={800} onOk={handleSave} confirmLoading={saving}
        okText={editId ? 'Update' : 'Create Property'}
        okButtonProps={{ style: { background: REDWOOD.rmTeal, border: 'none' } }}
        destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          <Tabs defaultActiveKey="basic">
            <TabPane tab="Basic Info" key="basic">
              <Row gutter={16}>
                <Col span={16}><Form.Item name="propertyName" label="Property Name" rules={[{ required: true }]}><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="status" label="Status" initialValue="AVAILABLE">
                  <Select>{['AVAILABLE','RENTED','MAINTENANCE','RESERVED','SOLD'].map(s => <Option key={s} value={s}>{s}</Option>)}</Select>
                </Form.Item></Col>
                <Col span={12}><Form.Item name="propertyType" label="Property Type" rules={[{ required: true }]}>
                  <Select>{['APARTMENT','VILLA','STUDIO','TOWNHOUSE','OFFICE','SHOP','WAREHOUSE','LAND'].map(t => <Option key={t} value={t}>{t}</Option>)}</Select>
                </Form.Item></Col>
                <Col span={12}><Form.Item name="usageType" label="Usage" rules={[{ required: true }]}>
                  <Select><Option value="RESIDENTIAL">Residential</Option><Option value="COMMERCIAL">Commercial</Option><Option value="MIXED">Mixed</Option></Select>
                </Form.Item></Col>
                <Col span={12}><Form.Item name="buildingName" label="Building Name"><Input /></Form.Item></Col>
                <Col span={6}><Form.Item name="floorNo" label="Floor"><Input /></Form.Item></Col>
                <Col span={6}><Form.Item name="unitNo" label="Unit #"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="bedrooms" label="Bedrooms"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                <Col span={8}><Form.Item name="bathrooms" label="Bathrooms"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                <Col span={8}><Form.Item name="parkingSpaces" label="Parking"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                <Col span={12}><Form.Item name="areaSqft" label="Area (sqft)"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                <Col span={12}><Form.Item name="areaSqmt" label="Area (sqm)"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
              </Row>
            </TabPane>
            <TabPane tab="Location" key="location">
              <Row gutter={16}>
                <Col span={12}><Form.Item name="community" label="Community"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="district" label="District"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="city" label="City" initialValue="Dubai"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="emirate" label="Emirate" initialValue="Dubai"><Input /></Form.Item></Col>
                <Col span={8}><Form.Item name="plotNo" label="Plot #"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="makaniNo" label="Makani # (Dubai Geocode)"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="municipalityNo" label="Municipality #"><Input /></Form.Item></Col>
              </Row>
            </TabPane>
            <TabPane tab="Ownership & Finance" key="owner">
              <Row gutter={16}>
                <Col span={12}><Form.Item name="ownerName" label="Owner Name"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="ownerContact" label="Owner Contact"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="titleDeedNo" label="Title Deed #"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="titleDeedDate" label="Title Deed Date"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                <Col span={12}><Form.Item name="dewaPremiseNo" label="DEWA Premise #"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="dewaAccountNo" label="DEWA Account #"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="annualMarketRent" label="Annual Market Rent (AED)"><InputNumber style={{ width: '100%' }} min={0} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} /></Form.Item></Col>
                <Col span={12}><Form.Item name="purchaseValue" label="Purchase Value (AED)"><InputNumber style={{ width: '100%' }} min={0} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} /></Form.Item></Col>
                <Col span={24}><Form.Item name="features" label="Features (comma-separated)"><Input placeholder="Pool, Gym, Balcony, Maid Room, Study…" /></Form.Item></Col>
                <Col span={24}><Form.Item name="description" label="Description"><TextArea rows={3} /></Form.Item></Col>
              </Row>
            </TabPane>
          </Tabs>
        </Form>
      </Modal>
    </Layout>
  );
};

export default ManageProperties;
