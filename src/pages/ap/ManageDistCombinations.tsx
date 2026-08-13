import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Layout, Card, Typography, Breadcrumb, Tabs, Form, Input, Select,
  Button, Table, Tag, Row, Col, Space, Modal, message, Tooltip, Collapse,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import {
  HomeOutlined, SettingOutlined, PlusOutlined, SearchOutlined,
  ReloadOutlined, EditOutlined, DeleteOutlined,
  BankOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import FloatingMenu from '../../components/FloatingMenu';
import AccountSelector from '../../components/AccountSelector';
import ApiDocsModal, { type ApiEndpoint } from '../../components/ApiDocsModal';
import { useAuth } from '../../context/AuthContext';
import { APEX_DB_CONFIG } from '../../config/api.config';
import {
  searchCombinations, createCombination, updateCombination, deleteCombination,
  MODULES,
  type DistCombination,
} from '../../services/distCombinations.service';

const { Content } = Layout;
const { Text } = Typography;
const { Option } = Select;

const DIST_BASE = `${APEX_DB_CONFIG.baseUrl}/distributions`;

const DIST_API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: 'GET',
    url: `${DIST_BASE}/combinations`,
    description: 'Search distribution combinations with optional filters',
    params: 'q (name contains), module (AP|PC|GL|FA|AR|CASH|ALL), status (ACTIVE|INACTIVE), bu (business unit)',
  },
  {
    method: 'POST',
    url: `${DIST_BASE}/combinations`,
    description: 'Create a new distribution combination',
    body: 'combinationName* (required), businessUnit, glAccountCcid, glAccountDesc, module* (required), description, status (default ACTIVE), createdBy',
    sampleBody: JSON.stringify({
      combinationName: 'Office Supplies',
      businessUnit: 'BCL DIFC Branch',
      glAccountDesc: '01-100-6010-000',
      glAccountCcid: null,
      module: 'PC',
      description: 'General office supplies expense',
      status: 'ACTIVE',
      createdBy: 'ADMIN',
    }, null, 2),
  },
  {
    method: 'PUT',
    url: `${DIST_BASE}/combinations/:combinationId`,
    description: 'Update an existing distribution combination',
    body: 'combinationName, businessUnit, glAccountCcid, glAccountDesc, module, description, status, updatedBy',
    sampleBody: JSON.stringify({
      status: 'INACTIVE',
      updatedBy: 'ADMIN',
    }, null, 2),
  },
  {
    method: 'DELETE',
    url: `${DIST_BASE}/combinations/:combinationId`,
    description: 'Delete a distribution combination permanently',
  },
];

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
};

const MODULE_COLORS: Record<string, string> = {
  AP: 'blue', PC: 'gold', GL: 'green', FA: 'purple',
  AR: 'cyan', CASH: 'orange', ALL: 'geekblue',
};

interface EditTab {
  key: string;
  combination: DistCombination;
}

const ManageDistCombinations: React.FC = () => {
  const { user } = useAuth();
  const currentUser = user?.username || 'SYSTEM';

  const [searchForm] = Form.useForm();
  const [createForm] = Form.useForm();
  const [editForm]   = Form.useForm();

  const [activeTab, setActiveTab]         = useState('search');
  const [createOpen, setCreateOpen]       = useState(false);
  const [editTabs, setEditTabs]           = useState<EditTab[]>([]);
  const openingKeys = useRef<Set<string>>(new Set());

  const [rows, setRows]                   = useState<DistCombination[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saveLoading, setSaveLoading]     = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);
  const [businessUnits, setBusinessUnits] = useState<string[]>([]);

  // COA selector state for create form
  const [coaCreateOpen, setCoaCreateOpen] = useState(false);
  const [coaEditOpen, setCoaEditOpen]     = useState(false);

  // ── Load Business Units ───────────────────────────────────
  useEffect(() => {
    fetch(`https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const items: any[] = Array.isArray(data) ? data : (data.items || []);
        setBusinessUnits(items.map((i: any) => i.business_unit_name || '').filter(Boolean));
      })
      .catch(() => {});
  }, []);

  // ── Search ────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setSearchLoading(true);
    try {
      const v = searchForm.getFieldsValue();
      const data = await searchCombinations({
        q:      v.name         || undefined,
        module: v.module       || undefined,
        status: v.status       || undefined,
        bu:     v.businessUnit || undefined,
      });
      setRows(data);
    } catch (e: any) {
      message.error(e?.message ?? 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }, [searchForm]);

  useEffect(() => { handleSearch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open edit tab ─────────────────────────────────────────
  const openEditTab = useCallback((rec: DistCombination) => {
    const key = `edit-${rec.combinationId}`;
    if (openingKeys.current.has(key)) { setActiveTab(key); return; }
    if (editTabs.find(t => t.key === key)) { setActiveTab(key); return; }
    openingKeys.current.add(key);
    setEditTabs(prev => {
      if (prev.find(t => t.key === key)) return prev;
      return [...prev, { key, combination: rec }];
    });
    setActiveTab(key);
    openingKeys.current.delete(key);
  }, [editTabs]);

  // ── Close edit tab ────────────────────────────────────────
  const closeEditTab = (key: string) => {
    const remaining = editTabs.filter(t => t.key !== key);
    setEditTabs(remaining);
    if (activeTab === key) setActiveTab(remaining.length ? remaining[remaining.length - 1].key : 'search');
  };

  // ── Create ────────────────────────────────────────────────
  const handleCreate = async (values: any) => {
    setSaveLoading(true);
    try {
      const result = await createCombination({
        combinationName: values.combinationName,
        businessUnit:    values.businessUnit   || null,
        glAccountCcid:   values.glAccountCcid  || null,
        glAccountDesc:   values.glAccountDesc  || null,
        module:          values.module,
        description:     values.description    || null,
        status:          values.status         || 'ACTIVE',
        createdBy:       currentUser,
      });
      message.success(`Combination #${result.combinationId} created`);
      createForm.resetFields();
      setCreateOpen(false);
      setActiveTab('search');
      await handleSearch();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to create combination');
    } finally {
      setSaveLoading(false);
    }
  };

  // ── Update (from edit tab) ────────────────────────────────
  const handleUpdate = async (key: string, combinationId: number, values: any) => {
    setSaveLoading(true);
    try {
      await updateCombination(combinationId, {
        combinationName: values.combinationName,
        businessUnit:    values.businessUnit   || null,
        glAccountCcid:   values.glAccountCcid  || null,
        glAccountDesc:   values.glAccountDesc  || null,
        module:          values.module,
        description:     values.description    || null,
        status:          values.status,
        updatedBy:       currentUser,
      });
      message.success('Combination updated');
      setEditTabs(prev => prev.map(t =>
        t.key === key
          ? { ...t, combination: { ...t.combination, ...values } }
          : t
      ));
      await handleSearch();
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to update');
    } finally {
      setSaveLoading(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = (rec: DistCombination, e: React.MouseEvent) => {
    e.stopPropagation();
    Modal.confirm({
      title:   `Delete "${rec.combinationName}"?`,
      content: 'This combination will be permanently removed.',
      okText:  'Delete', okButtonProps: { danger: true },
      onOk: async () => {
        setDeleteLoading(rec.combinationId);
        try {
          await deleteCombination(rec.combinationId);
          message.success('Combination deleted');
          closeEditTab(`edit-${rec.combinationId}`);
          await handleSearch();
        } catch (e: any) {
          message.error(e?.message ?? 'Delete failed');
        } finally {
          setDeleteLoading(null);
        }
      },
    });
  };

  // ── Table columns ─────────────────────────────────────────
  const columns: ColumnsType<DistCombination> = [
    {
      title: 'ID', dataIndex: 'combinationId', width: 70, align: 'center',
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Combination Name', dataIndex: 'combinationName',
      render: (v, rec) => (
        <Button type="link" style={{ padding: 0, fontSize: 13, fontWeight: 500 }}
          onClick={(e) => { e.stopPropagation(); openEditTab(rec); }}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Business Unit', dataIndex: 'businessUnit', width: 180, ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Module', dataIndex: 'module', width: 90, align: 'center',
      render: (v) => <Tag color={MODULE_COLORS[v] || 'default'} style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: 'GL Account', dataIndex: 'glAccountDesc', ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Description', dataIndex: 'description', ellipsis: true,
      render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 90,
      render: (v) => (
        <Tag color={v === 'ACTIVE' ? 'green' : 'default'} style={{ fontSize: 11 }}>{v}</Tag>
      ),
    },
    {
      title: 'Created By', dataIndex: 'createdBy', width: 130, ellipsis: true,
      render: (v) => <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v || '—'}</Text>,
    },
    {
      title: '', key: 'actions', width: 90, align: 'center',
      render: (_, rec) => (
        <Space size={4}>
          <Tooltip title="Edit">
            <Button type="text" size="small" icon={<EditOutlined />}
              onClick={(e) => { e.stopPropagation(); openEditTab(rec); }} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button type="text" danger size="small" icon={<DeleteOutlined />}
              loading={deleteLoading === rec.combinationId}
              onClick={(e) => handleDelete(rec, e)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // ── Combination Form (shared for create & edit) ───────────
  const CombinationForm: React.FC<{
    form: ReturnType<typeof Form.useForm>[0];
    onFinish: (values: any) => void;
    onCancel: () => void;
    coaOpen: boolean;
    setCoaOpen: (v: boolean) => void;
    initialValues?: Partial<DistCombination>;
    isEdit?: boolean;
  }> = ({ form, onFinish, onCancel, coaOpen, setCoaOpen, isEdit }) => (
    <Form form={form} layout="vertical" size="small" onFinish={onFinish}
      initialValues={{ status: 'ACTIVE', module: 'PC' }}>
      <Row gutter={16}>
        <Col span={16}>
          <Form.Item label="Combination Name" name="combinationName"
            rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Office Supplies — AP" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="Module" name="module"
            rules={[{ required: true, message: 'Required' }]}>
            <Select placeholder="Select module">
              {MODULES.map(m => (
                <Option key={m} value={m}>
                  <Tag color={MODULE_COLORS[m]} style={{ marginRight: 4 }}>{m}</Tag>
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>

      <Form.Item label="Business Unit" name="businessUnit">
        <Select placeholder="All Business Units (leave blank)" allowClear showSearch
          filterOption={(v, o) => String(o?.value ?? '').toLowerCase().includes(v.toLowerCase())}>
          {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
        </Select>
      </Form.Item>

      <Form.Item label="GL Account" style={{ marginBottom: 0 }}>
        <Row gutter={8} align="middle">
          <Col flex="1">
            <Form.Item name="glAccountDesc" noStyle>
              <Input placeholder="e.g. 01-100-6010-000" />
            </Form.Item>
          </Col>
          <Col>
            <Button icon={<BankOutlined />} onClick={() => setCoaOpen(true)} size="small">
              Browse
            </Button>
          </Col>
        </Row>
        <Form.Item name="glAccountCcid" hidden><Input /></Form.Item>
      </Form.Item>
      <div style={{ marginBottom: 12 }} />

      <Form.Item label="Description" name="description">
        <Input.TextArea rows={2} placeholder="Optional description" />
      </Form.Item>

      <Form.Item label="Status" name="status" rules={[{ required: true }]}>
        <Select>
          <Option value="ACTIVE">
            <Tag color="green">ACTIVE</Tag>
          </Option>
          <Option value="INACTIVE">
            <Tag>INACTIVE</Tag>
          </Option>
        </Select>
      </Form.Item>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="primary" htmlType="submit" loading={saveLoading}
          style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
          {isEdit ? 'Save Changes' : 'Create Combination'}
        </Button>
      </div>

      <AccountSelector
        visible={coaOpen}
        onCancel={() => setCoaOpen(false)}
        initialValue={form.getFieldValue('glAccountDesc') || undefined}
        onSelect={(accountCode, _segments) => {
          form.setFieldsValue({ glAccountDesc: accountCode });
          setCoaOpen(false);
        }}
      />
    </Form>
  );

  // ── Tab items ─────────────────────────────────────────────
  const tabItems = [
    {
      key: 'search',
      label: <Space><SearchOutlined />Combinations</Space>,
      closable: false,
      children: (
        <div style={{ padding: '12px 0' }}>
          <Collapse defaultActiveKey={['search']} style={{ marginBottom: 12, borderRadius: 8 }}
            items={[{
              key: 'search',
              label: <Text style={{ fontWeight: 500 }}>Search Criteria</Text>,
              children: (
                <Form form={searchForm} layout="vertical" size="small">
                  <Row gutter={16}>
                    <Col span={6}>
                      <Form.Item label="Name" name="name">
                        <Input placeholder="Search by name" allowClear />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="Business Unit" name="businessUnit">
                        <Select placeholder="All BUs" allowClear showSearch
                          filterOption={(v, o) => String(o?.value ?? '').toLowerCase().includes(v.toLowerCase())}>
                          {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label="Module" name="module">
                        <Select placeholder="All" allowClear>
                          {MODULES.map(m => (
                            <Option key={m} value={m}>
                              <Tag color={MODULE_COLORS[m]}>{m}</Tag>
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label="Status" name="status">
                        <Select placeholder="All" allowClear>
                          <Option value="ACTIVE"><Tag color="green">ACTIVE</Tag></Option>
                          <Option value="INACTIVE"><Tag>INACTIVE</Tag></Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={4} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                      <Space>
                        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}
                          loading={searchLoading}
                          style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
                          Search
                        </Button>
                        <Button icon={<ReloadOutlined />}
                          onClick={() => { searchForm.resetFields(); handleSearch(); }}>
                          Reset
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                </Form>
              ),
            }]}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
              {rows.length} combination{rows.length !== 1 ? 's' : ''}
            </Text>
            <Button type="primary" icon={<PlusOutlined />}
              style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
              onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>
              New Combination
            </Button>
          </div>

          <Table<DistCombination>
            dataSource={rows}
            columns={columns}
            rowKey="combinationId"
            size="small"
            loading={searchLoading}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} combinations` }}
            scroll={{ x: 1000 }}
            onRow={(rec) => ({
              style: { cursor: 'pointer' },
              onClick: () => openEditTab(rec),
            })}
            locale={{ emptyText: 'No combinations found. Click "New Combination" to create one.' }}
          />
        </div>
      ),
    },
    ...editTabs.map((tab) => ({
      key: tab.key,
      label: (
        <Space size={4}>
          <EditOutlined style={{ fontSize: 11 }} />
          <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
            {tab.combination.combinationName}
          </span>
        </Space>
      ),
      children: (
        <div style={{ padding: '12px 0', maxWidth: 700 }}>
          <Card
            title={
              <Space>
                <CheckCircleOutlined style={{ color: REDWOOD.info }} />
                <Text strong>Edit Combination</Text>
                <Tag color={MODULE_COLORS[tab.combination.module] || 'default'}>{tab.combination.module}</Tag>
              </Space>
            }
            style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
            size="small"
          >
            <EditCombinationForm
              tab={tab}
              currentUser={currentUser}
              saveLoading={saveLoading}
              businessUnits={businessUnits}
              onUpdate={handleUpdate}
              onClose={() => closeEditTab(tab.key)}
              onDelete={(rec, e) => handleDelete(rec, e)}
              deleteLoading={deleteLoading}
            />
          </Card>
        </div>
      ),
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/ap">Payables</Link> },
              { title: 'Manage Distribution Combinations' },
            ]}
          />
        </div>

        {/* Page header */}
        <div style={{ padding: '16px 24px 0', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Space align="center">
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.info} 0%, #0452a3 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 3px 8px ${REDWOOD.info}40`,
              }}>
                <SettingOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Text strong style={{ fontSize: 18, color: REDWOOD.neutral900, display: 'block' }}>
                  Manage Distribution Combinations
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Define expense type combinations with GL accounts for use in transactions
                </Text>
              </div>
            </Space>
            <ApiDocsModal
              title="Distribution Combinations"
              endpoints={DIST_API_ENDPOINTS}
            />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding: '0 24px 24px' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type="editable-card"
            hideAdd
            onEdit={(key, action) => { if (action === 'remove') closeEditTab(key as string); }}
            items={tabItems}
            style={{ background: REDWOOD.surface }}
          />
        </div>
      </Content>

      {/* Create Modal */}
      <Modal
        title={<Space><PlusOutlined style={{ color: REDWOOD.success }} /> New Distribution Combination</Space>}
        open={createOpen}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        footer={null}
        width={640}
        destroyOnClose
      >
        <CombinationForm
          form={createForm}
          onFinish={handleCreate}
          onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
          coaOpen={coaCreateOpen}
          setCoaOpen={setCoaCreateOpen}
        />
      </Modal>

      <FloatingMenu />
    </Layout>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Edit Combination Form (separate component to keep state isolated per tab)
// ─────────────────────────────────────────────────────────────────────────────
const EditCombinationForm: React.FC<{
  tab: EditTab;
  currentUser: string;
  saveLoading: boolean;
  businessUnits: string[];
  onUpdate: (key: string, id: number, values: any) => void;
  onClose: () => void;
  onDelete: (rec: DistCombination, e: React.MouseEvent) => void;
  deleteLoading: number | null;
}> = ({ tab, currentUser: _currentUser, saveLoading, businessUnits: buList, onUpdate, onClose, onDelete, deleteLoading }) => {
  const [form] = Form.useForm();
  const [coaOpen, setCoaOpen] = useState(false);
  const { combination } = tab;

  useEffect(() => {
    form.setFieldsValue({
      combinationName: combination.combinationName,
      businessUnit:    combination.businessUnit,
      glAccountDesc:   combination.glAccountDesc,
      glAccountCcid:   combination.glAccountCcid,
      module:          combination.module,
      description:     combination.description,
      status:          combination.status,
    });
  }, [combination, form]);

  return (
    <Form form={form} layout="vertical" size="small"
      onFinish={(v) => onUpdate(tab.key, combination.combinationId, v)}>
      <Row gutter={16}>
        <Col span={16}>
          <Form.Item label="Combination Name" name="combinationName"
            rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Office Supplies — AP" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="Module" name="module"
            rules={[{ required: true, message: 'Required' }]}>
            <Select placeholder="Select module">
              {MODULES.map(m => (
                <Option key={m} value={m}>
                  <Tag color={MODULE_COLORS[m]} style={{ marginRight: 4 }}>{m}</Tag>
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>

      <Form.Item label="Business Unit" name="businessUnit">
        <Select placeholder="All Business Units (leave blank)" allowClear showSearch
          filterOption={(v, o) => String(o?.value ?? '').toLowerCase().includes(v.toLowerCase())}>
          {buList.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
        </Select>
      </Form.Item>

      <Form.Item label="GL Account" style={{ marginBottom: 0 }}>
        <Row gutter={8} align="middle">
          <Col flex="1">
            <Form.Item name="glAccountDesc" noStyle>
              <Input placeholder="e.g. 01-100-6010-000" />
            </Form.Item>
          </Col>
          <Col>
            <Button icon={<BankOutlined />} onClick={() => setCoaOpen(true)} size="small">
              Browse
            </Button>
          </Col>
        </Row>
        <Form.Item name="glAccountCcid" hidden><Input /></Form.Item>
      </Form.Item>
      <div style={{ marginBottom: 12 }} />

      <Form.Item label="Description" name="description">
        <Input.TextArea rows={2} placeholder="Optional description" />
      </Form.Item>

      <Form.Item label="Status" name="status" rules={[{ required: true }]}>
        <Select>
          <Option value="ACTIVE"><Tag color="green">ACTIVE</Tag></Option>
          <Option value="INACTIVE"><Tag>INACTIVE</Tag></Option>
        </Select>
      </Form.Item>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Button danger icon={<DeleteOutlined />}
          loading={deleteLoading === combination.combinationId}
          onClick={(e) => onDelete(combination, e as any)}>
          Delete
        </Button>
        <Space>
          <Button onClick={onClose}>Close</Button>
          <Button type="primary" htmlType="submit" loading={saveLoading}
            style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
            Save Changes
          </Button>
        </Space>
      </div>

      <AccountSelector
        visible={coaOpen}
        onCancel={() => setCoaOpen(false)}
        initialValue={form.getFieldValue('glAccountDesc') || undefined}
        onSelect={(accountCode, _segments) => {
          form.setFieldsValue({ glAccountDesc: accountCode });
          setCoaOpen(false);
        }}
      />
    </Form>
  );
};

export default ManageDistCombinations;
