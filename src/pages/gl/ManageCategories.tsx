import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Card, Table, Button, Space, Typography, Breadcrumb,
  Input, Form, Row, Col, Spin, Alert, Tooltip, Popconfirm,
  message, Tag, Modal, Checkbox,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, PlusOutlined,
  EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined,
  TagsOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const ORDS_BASE = APEX_DB_CONFIG.baseUrl;

const REDWOOD = {
  primary:       '#C74634',
  primaryDark:   '#A33B2C',
  success:       '#1D7B4D',
  warning:       '#D4A800',
  info:          '#0572CE',
  surface:       '#FFFFFF',
  surfaceAlt:    '#F7F7F7',
  border:        '#E5E5E5',
  textPrimary:   '#1A1A1A',
  textSecondary: '#6B6B6B',
  error:         '#D32F2F',
};

interface Category {
  jeCategoryName: string;
  userJeCategoryName: string;
  description: string;
  disallowMjeFlag: string | null;
  lastSyncDate: string | null;
}

interface CategoryForm {
  jeCategoryName: string;
  userJeCategoryName: string;
  description: string;
  disallowMjeFlag: boolean;
}

const emptyForm = (): CategoryForm => ({
  jeCategoryName: '',
  userJeCategoryName: '',
  description: '',
  disallowMjeFlag: false,
});

const ManageCategories: React.FC = () => {
  const [categories, setCategories]       = useState<Category[]>([]);
  const [filtered, setFiltered]           = useState<Category[]>([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  // Search
  const [searchName, setSearchName]       = useState('');
  const [searchDesc, setSearchDesc]       = useState('');

  // Add/Edit modal
  const [modalVisible, setModalVisible]   = useState(false);
  const [modalMode, setModalMode]         = useState<'add' | 'edit'>('add');
  const [modalLoading, setModalLoading]   = useState(false);
  const [form]                            = Form.useForm<CategoryForm>();
  const [editingKey, setEditingKey]       = useState<string | null>(null);

  // Delete
  const [deletingKey, setDeletingKey]     = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────────
  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${ORDS_BASE}/gl/categories`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items: Category[] = (data.items || []);
      setCategories(items);
      setFiltered(items);
    } catch (e: any) {
      setError(e.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  // ── Filter ───────────────────────────────────────────────────
  useEffect(() => {
    const name = searchName.toLowerCase();
    const desc = searchDesc.toLowerCase();
    setFiltered(categories.filter(c =>
      (c.userJeCategoryName || c.jeCategoryName).toLowerCase().includes(name) &&
      (c.description || '').toLowerCase().includes(desc)
    ));
  }, [searchName, searchDesc, categories]);

  // ── Open modal ───────────────────────────────────────────────
  const openAdd = () => {
    setModalMode('add');
    setEditingKey(null);
    form.setFieldsValue(emptyForm());
    setModalVisible(true);
  };

  const openEdit = (row: Category) => {
    setModalMode('edit');
    setEditingKey(row.jeCategoryName);
    form.setFieldsValue({
      jeCategoryName:     row.jeCategoryName,
      userJeCategoryName: row.userJeCategoryName || '',
      description:        row.description || '',
      disallowMjeFlag:    row.disallowMjeFlag === 'Y',
    });
    setModalVisible(true);
  };

  // ── Save (add or edit) ───────────────────────────────────────
  const handleSave = async () => {
    let values: CategoryForm;
    try { values = await form.validateFields(); }
    catch { return; }

    setModalLoading(true);
    try {
      const payload = {
        items: [{
          JeCategoryName:     values.jeCategoryName.trim(),
          UserJeCategoryName: values.userJeCategoryName.trim() || values.jeCategoryName.trim(),
          Description:        values.description.trim(),
          DisallowMjeFlag:    values.disallowMjeFlag ? 'Y' : null,
        }],
      };

      const resp = await fetch(`${ORDS_BASE}/gl/categories/sync`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok || data.status === 'ERROR') {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }

      message.success(modalMode === 'add' ? 'Category created successfully' : 'Category updated successfully');
      setModalVisible(false);
      fetchCategories();
    } catch (e: any) {
      message.error(e.message || 'Save failed');
    } finally {
      setModalLoading(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────
  const handleDelete = async (jeCategoryName: string) => {
    setDeletingKey(jeCategoryName);
    try {
      const resp = await fetch(
        `${ORDS_BASE}/gl/categories/${encodeURIComponent(jeCategoryName)}`,
        { method: 'DELETE' }
      );
      if (!resp.ok && resp.status !== 404) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      message.success(`Category "${jeCategoryName}" deleted`);
      fetchCategories();
    } catch (e: any) {
      message.error(e.message || 'Delete failed');
    } finally {
      setDeletingKey(null);
    }
  };

  // ── Columns ──────────────────────────────────────────────────
  const columns = [
    {
      title: 'Category Name',
      dataIndex: 'jeCategoryName',
      key: 'jeCategoryName',
      width: 160,
      render: (v: string) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'User Category Name',
      dataIndex: 'userJeCategoryName',
      key: 'userJeCategoryName',
      width: 180,
      render: (v: string) => <Text style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => <Text style={{ fontSize: 13, color: REDWOOD.textSecondary }}>{v || '—'}</Text>,
    },
    {
      title: 'Disallow MJE',
      dataIndex: 'disallowMjeFlag',
      key: 'disallowMjeFlag',
      width: 120,
      align: 'center' as const,
      render: (v: string | null) => v === 'Y'
        ? <CheckCircleOutlined style={{ color: REDWOOD.error, fontSize: 16 }} />
        : <CloseCircleOutlined style={{ color: REDWOOD.textSecondary, fontSize: 16 }} />,
    },
    {
      title: 'Last Sync',
      dataIndex: 'lastSyncDate',
      key: 'lastSyncDate',
      width: 140,
      render: (v: string | null) => v
        ? <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>{v.substring(0, 10)}</Text>
        : <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>—</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: any, row: Category) => (
        <Space size={4}>
          <Tooltip title="Edit">
            <Button
              type="text" size="small"
              icon={<EditOutlined style={{ color: REDWOOD.info }} />}
              onClick={() => openEdit(row)}
            />
          </Tooltip>
          <Popconfirm
            title={`Delete "${row.jeCategoryName}"?`}
            description="This will permanently remove the category."
            okText="Delete" okButtonProps={{ danger: true }}
            cancelText="Cancel"
            onConfirm={() => handleDelete(row.jeCategoryName)}
          >
            <Tooltip title="Delete">
              <Button
                type="text" size="small"
                icon={<DeleteOutlined style={{ color: REDWOOD.error }} />}
                loading={deletingKey === row.jeCategoryName}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.surfaceAlt }}>
      <Content style={{ padding: '20px 24px' }}>

        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 16 }}
          items={[
            { title: <Link to="/"><HomeOutlined /></Link> },
            { title: <Link to="/gl">General Ledger</Link> },
            { title: 'Manage Categories' },
          ]}
        />

        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Space align="center">
            <div style={{ width: 40, height: 40, borderRadius: 10, background: REDWOOD.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TagsOutlined style={{ color: '#fff', fontSize: 20 }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0, color: REDWOOD.textPrimary }}>Manage Categories</Title>
              <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>
                {filtered.length} of {categories.length} categories
              </Text>
            </div>
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchCategories} loading={loading}>
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openAdd}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, borderRadius: 8 }}
            >
              Add Category
            </Button>
          </Space>
        </div>

        {/* Error */}
        {error && (
          <Alert type="error" message={error} showIcon closable style={{ marginBottom: 16, borderRadius: 8 }} />
        )}

        {/* Search Card */}
        <Card
          style={{ borderRadius: 12, border: `1px solid ${REDWOOD.border}`, marginBottom: 16 }}
          bodyStyle={{ padding: '12px 16px' }}
        >
          <Row gutter={16} align="middle">
            <Col xs={24} sm={10}>
              <Text style={{ fontSize: 12, color: REDWOOD.textSecondary, display: 'block', marginBottom: 4 }}>Category Name</Text>
              <Input
                prefix={<SearchOutlined style={{ color: REDWOOD.textSecondary }} />}
                placeholder="Search by name…"
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                allowClear
                size="small"
                style={{ borderRadius: 6 }}
              />
            </Col>
            <Col xs={24} sm={10}>
              <Text style={{ fontSize: 12, color: REDWOOD.textSecondary, display: 'block', marginBottom: 4 }}>Description</Text>
              <Input
                prefix={<SearchOutlined style={{ color: REDWOOD.textSecondary }} />}
                placeholder="Search by description…"
                value={searchDesc}
                onChange={e => setSearchDesc(e.target.value)}
                allowClear
                size="small"
                style={{ borderRadius: 6 }}
              />
            </Col>
            <Col xs={24} sm={4} style={{ paddingTop: 20 }}>
              <Button size="small" onClick={() => { setSearchName(''); setSearchDesc(''); }} block>
                Clear
              </Button>
            </Col>
          </Row>
        </Card>

        {/* Table Card */}
        <Card
          style={{ borderRadius: 12, border: `1px solid ${REDWOOD.border}` }}
          bodyStyle={{ padding: 0 }}
        >
          <Table
            dataSource={filtered}
            columns={columns}
            rowKey="jeCategoryName"
            loading={{ spinning: loading, indicator: <Spin indicator={<ReloadOutlined spin />} /> }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`,
              size: 'small',
            }}
            size="small"
            style={{ borderRadius: 12 }}
            rowClassName={(_, index) => index % 2 === 0 ? '' : 'ant-table-row-alt'}
            locale={{ emptyText: 'No categories found. Sync from Oracle Fusion or add manually.' }}
          />
        </Card>

        {/* Summary row */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <Tag color="default" style={{ borderRadius: 10 }}>
            Total: {categories.length}
          </Tag>
          <Tag color="blue" style={{ borderRadius: 10 }}>
            Filtered: {filtered.length}
          </Tag>
          <Tag color="red" style={{ borderRadius: 10 }}>
            Disallow MJE: {categories.filter(c => c.disallowMjeFlag === 'Y').length}
          </Tag>
        </div>
      </Content>

      {/* Add / Edit Modal */}
      <Modal
        title={
          <Space>
            <TagsOutlined style={{ color: REDWOOD.primary }} />
            <span>{modalMode === 'add' ? 'Add New Category' : `Edit: ${editingKey}`}</span>
          </Space>
        }
        open={modalVisible}
        onCancel={() => { setModalVisible(false); form.resetFields(); }}
        footer={[
          <Button key="cancel" icon={<CloseOutlined />} onClick={() => { setModalVisible(false); form.resetFields(); }}>
            Cancel
          </Button>,
          <Button
            key="save"
            type="primary"
            icon={<SaveOutlined />}
            loading={modalLoading}
            onClick={handleSave}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
          >
            {modalMode === 'add' ? 'Create Category' : 'Save Changes'}
          </Button>,
        ]}
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            label="Category Name (JE_CATEGORY_NAME)"
            name="jeCategoryName"
            rules={[
              { required: true, message: 'Category name is required' },
              { max: 25, message: 'Max 25 characters' },
              { pattern: /^[A-Za-z0-9_\- ]+$/, message: 'Letters, digits, spaces, - and _ only' },
            ]}
            tooltip="Internal key — must be unique. Cannot be changed after creation."
          >
            <Input
              placeholder="e.g. Adjustment"
              maxLength={25}
              disabled={modalMode === 'edit'}
              style={{ borderRadius: 6 }}
            />
          </Form.Item>

          <Form.Item
            label="User Category Name"
            name="userJeCategoryName"
            rules={[{ max: 80, message: 'Max 80 characters' }]}
            tooltip="Display name shown to users"
          >
            <Input placeholder="e.g. Adjustment" maxLength={80} style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item
            label="Description"
            name="description"
            rules={[{ max: 240, message: 'Max 240 characters' }]}
          >
            <Input.TextArea
              placeholder="e.g. Month-end adjusting entries"
              maxLength={240}
              rows={3}
              style={{ borderRadius: 6 }}
              showCount
            />
          </Form.Item>

          <Form.Item
            name="disallowMjeFlag"
            valuePropName="checked"
          >
            <Checkbox>
              <Space>
                <Text>Disallow Manual Journal Entries (MJE)</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>Prevents users from creating manual journals in this category</Text>
              </Space>
            </Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default ManageCategories;
