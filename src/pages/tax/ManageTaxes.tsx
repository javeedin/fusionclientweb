import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  Space, Tag, Modal, Popconfirm, message, Tabs, InputNumber, DatePicker, Row, Col,
  Tooltip, Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  SearchOutlined, ReloadOutlined, PercentageOutlined, BankOutlined,
  ApiOutlined, CopyOutlined, CheckOutlined, BugOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import AccountSelector from '../../components/AccountSelector';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const APEX_BASE = buildApexUrl('');

// ── Types ──────────────────────────────────────────────────────────────────────
interface Tax {
  taxId:          number;
  taxName:        string;
  taxCode:        string;
  taxRate:        number;
  taxType:        string;
  applicability:  string;
  description?:   string;
  status:         string;
  creationDate?:  string;
  lastUpdateDate?: string;
}

interface TaxAssignment {
  assignmentId:    number;
  taxId:           number;
  taxName:         string;
  taxCode:         string;
  taxRate:         number;
  taxType:         string;
  applicability:   string;
  businessUnitName: string;
  taxAccount?:     string;
  effectiveFrom?:  string;
  effectiveTo?:    string;
  status:          string;
}

interface BUOption { label: string; value: string; }

const parseApexJson = async (res: Response) => {
  const text = await res.text();
  const fixed = text.replace(/:\s*\.(\d)/g, ': 0.$1').replace(/:\s*-\.(\d)/g, ': -0.$1');
  return JSON.parse(fixed);
};

const STATUS_COLOR: Record<string, string> = { ACTIVE: 'green', INACTIVE: 'default' };
const APP_COLOR:    Record<string, string> = { AP: 'blue', AR: 'purple', BOTH: 'geekblue' };
const TYPE_COLOR:   Record<string, string> = { INPUT: 'cyan', OUTPUT: 'orange', BOTH: 'gold' };

// ── Tax Modal ──────────────────────────────────────────────────────────────────
const TaxModal: React.FC<{
  open: boolean;
  editing: Tax | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, editing, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        form.setFieldsValue({
          taxName:      editing.taxName,
          taxCode:      editing.taxCode,
          taxRate:      editing.taxRate,
          taxType:      editing.taxType,
          applicability: editing.applicability,
          description:  editing.description,
          status:       editing.status,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ taxType: 'BOTH', applicability: 'BOTH', status: 'ACTIVE' });
      }
    }
  }, [open, editing, form]);

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload: any = { ...values, lastUpdatedBy: 'ERP_USER' };
      if (editing) payload.taxId = editing.taxId;
      const res  = await fetch(`${APEX_BASE}/tax/taxes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        message.success(editing ? 'Tax updated.' : 'Tax created.');
        onSaved();
        onClose();
      } else {
        message.error(data.message || 'Save failed.');
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open} title={editing ? 'Edit Tax' : 'Create New Tax'}
      onCancel={onClose} width={560}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
          {editing ? 'Update Tax' : 'Create Tax'}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Row gutter={16}>
          <Col span={14}>
            <Form.Item label="Tax Name" name="taxName" rules={[{ required: true, message: 'Required' }]}>
              <Input placeholder="e.g. VAT 5%" />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item label="Tax Code" name="taxCode" rules={[{ required: true, message: 'Required' }]}>
              <Input placeholder="e.g. VAT5" style={{ textTransform: 'uppercase' }}
                onChange={e => form.setFieldValue('taxCode', e.target.value.toUpperCase())} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="Tax Rate (%)" name="taxRate" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={0} max={100} precision={4} style={{ width: '100%' }}
                placeholder="5" suffix="%" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Tax Type" name="taxType" rules={[{ required: true, message: 'Required' }]}>
              <Select>
                <Option value="INPUT">Input</Option>
                <Option value="OUTPUT">Output</Option>
                <Option value="BOTH">Both</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="Applicability" name="applicability" rules={[{ required: true, message: 'Required' }]}>
              <Select>
                <Option value="AP">AP (Payables)</Option>
                <Option value="AR">AR (Receivables)</Option>
                <Option value="BOTH">Both</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="Description" name="description">
          <Input.TextArea rows={2} placeholder="Optional description" />
        </Form.Item>
        <Form.Item label="Status" name="status">
          <Select>
            <Option value="ACTIVE">Active</Option>
            <Option value="INACTIVE">Inactive</Option>
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ── Assignment Modal ───────────────────────────────────────────────────────────
const AssignmentModal: React.FC<{
  open: boolean;
  editing: TaxAssignment | null;
  taxes: Tax[];
  businessUnits: BUOption[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, editing, taxes, businessUnits, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [acctSelectorOpen, setAcctSelectorOpen] = useState(false);
  const [taxAccountDesc,   setTaxAccountDesc]   = useState('');
  const [showDebug,        setShowDebug]        = useState(false);
  const [testing,          setTesting]          = useState(false);
  const [testResponse,     setTestResponse]     = useState<string | null>(null);
  const [copied,           setCopied]           = useState(false);

  useEffect(() => {
    if (open) {
      setShowDebug(false);
      setTestResponse(null);
      if (editing) {
        form.setFieldsValue({
          taxId:           editing.taxId,
          businessUnitName: editing.businessUnitName,
          taxAccount:      editing.taxAccount,
          effectiveFrom:   editing.effectiveFrom ? dayjs(editing.effectiveFrom) : null,
          effectiveTo:     editing.effectiveTo   ? dayjs(editing.effectiveTo)   : null,
          status:          editing.status,
        });
        setTaxAccountDesc('');
      } else {
        form.resetFields();
        form.setFieldsValue({ status: 'ACTIVE' });
        setTaxAccountDesc('');
      }
    }
  }, [open, editing, form]);

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload: any = {
        ...values,
        effectiveFrom: values.effectiveFrom ? values.effectiveFrom.format('YYYY-MM-DD') : null,
        effectiveTo:   values.effectiveTo   ? values.effectiveTo.format('YYYY-MM-DD')   : null,
        lastUpdatedBy: 'ERP_USER',
      };
      if (editing) payload.assignmentId = editing.assignmentId;
      const res  = await fetch(`${APEX_BASE}/tax/assignments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        message.success(editing ? 'Assignment updated.' : 'Assignment created.');
        onSaved();
        onClose();
      } else {
        message.error(data.message || 'Save failed.');
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally { setSaving(false); }
  };

  const buildPayload = () => {
    const values = form.getFieldsValue();
    const payload: any = {
      ...values,
      effectiveFrom: values.effectiveFrom ? values.effectiveFrom.format('YYYY-MM-DD') : null,
      effectiveTo:   values.effectiveTo   ? values.effectiveTo.format('YYYY-MM-DD')   : null,
      lastUpdatedBy: 'ERP_USER',
    };
    if (editing) payload.assignmentId = editing.assignmentId;
    return payload;
  };

  const handleTestApi = async () => {
    const payload = buildPayload();
    setTesting(true);
    setTestResponse(null);
    try {
      const res  = await fetch(`${APEX_BASE}/tax/assignments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      setTestResponse(`HTTP ${res.status} ${res.statusText}\n\n${text}`);
    } catch (e: any) {
      setTestResponse(`Network error: ${e.message}`);
    } finally { setTesting(false); }
  };

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(JSON.stringify(buildPayload(), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const taxAccount = Form.useWatch('taxAccount', form);

  return (
    <>
      <Modal
        open={open} title={editing ? 'Edit Tax Assignment' : 'Assign Tax to Business Unit'}
        onCancel={onClose} width={600}
        footer={[
          <Tooltip key="api-tip" title="Debug API payload">
            <Button
              icon={<ApiOutlined />}
              onClick={() => { setShowDebug(v => !v); setTestResponse(null); }}
              style={{ float: 'left', color: showDebug ? REDWOOD.info : undefined }}
            />
          </Tooltip>,
          <Button key="cancel" onClick={onClose}>Cancel</Button>,
          <Button key="save" type="primary" loading={saving} onClick={handleSave}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
            {editing ? 'Update' : 'Assign Tax'}
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="Tax" name="taxId" rules={[{ required: true, message: 'Required' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Select tax"
              disabled={!!editing}
              options={taxes.map(t => ({
                label: `${t.taxCode} — ${t.taxName} (${t.taxRate}%)`,
                value: t.taxId,
              }))} />
          </Form.Item>
          <Form.Item label="Business Unit" name="businessUnitName" rules={[{ required: true, message: 'Required' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Select business unit"
              disabled={!!editing}
              options={businessUnits} />
          </Form.Item>
          <Form.Item label="Tax Account (GL Combination)" name="taxAccount">
            <Input
              readOnly
              placeholder="Click to select GL account"
              value={taxAccount}
              suffix={
                <Button size="small" type="link" style={{ padding: 0 }}
                  onClick={() => setAcctSelectorOpen(true)}>
                  Select
                </Button>
              }
              onClick={() => setAcctSelectorOpen(true)}
              style={{ cursor: 'pointer' }}
            />
            {taxAccountDesc && (
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                {taxAccountDesc}
              </Text>
            )}
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Effective From" name="effectiveFrom">
                <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Effective To" name="effectiveTo">
                <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Status" name="status">
            <Select>
              <Option value="ACTIVE">Active</Option>
              <Option value="INACTIVE">Inactive</Option>
            </Select>
          </Form.Item>

          {showDebug && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ background: '#0d1117', borderRadius: 8, padding: 12 }}>
                <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Space>
                    <BugOutlined style={{ color: '#58a6ff' }} />
                    <Text style={{ color: '#58a6ff', fontSize: 12, fontFamily: 'monospace' }}>
                      POST {APEX_BASE}/tax/assignments
                    </Text>
                  </Space>
                  <Space>
                    <Tooltip title={copied ? 'Copied!' : 'Copy payload'}>
                      <Button
                        size="small" type="text"
                        icon={copied ? <CheckOutlined style={{ color: '#3fb950' }} /> : <CopyOutlined style={{ color: '#8b949e' }} />}
                        onClick={handleCopyPayload}
                      />
                    </Tooltip>
                    <Button
                      size="small" type="primary" loading={testing}
                      onClick={handleTestApi}
                      style={{ background: '#238636', borderColor: '#238636', fontSize: 12 }}
                    >
                      Send Test
                    </Button>
                  </Space>
                </Space>
                <pre style={{
                  background: '#161b22', color: '#e6edf3', fontSize: 11,
                  padding: 10, borderRadius: 6, margin: 0, overflowX: 'auto',
                  maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace',
                }}>
                  {JSON.stringify(buildPayload(), null, 2)}
                </pre>
                {testResponse !== null && (
                  <>
                    <div style={{ color: '#8b949e', fontSize: 11, marginTop: 8, marginBottom: 4 }}>Response:</div>
                    <pre style={{
                      background: '#161b22', fontSize: 11, padding: 10,
                      borderRadius: 6, margin: 0, overflowX: 'auto',
                      maxHeight: 180, overflowY: 'auto', fontFamily: 'monospace',
                      color: testResponse.includes('"status":"success"') || testResponse.includes('"status": "success"')
                        ? '#3fb950' : '#f85149',
                    }}>
                      {(() => {
                        try {
                          const jsonStart = testResponse.indexOf('\n\n') + 2;
                          const header   = testResponse.substring(0, jsonStart);
                          const body     = JSON.stringify(JSON.parse(testResponse.substring(jsonStart)), null, 2);
                          return header + body;
                        } catch { return testResponse; }
                      })()}
                    </pre>
                  </>
                )}
              </div>
            </>
          )}
        </Form>
      </Modal>
      <AccountSelector
        visible={acctSelectorOpen}
        initialValue={taxAccount || ''}
        onSelect={(accountCode, segments) => {
          form.setFieldValue('taxAccount', accountCode);
          const naturalValue = accountCode.split('-')[3] || '';
          const desc = Object.values(segments).find(s => s.value === naturalValue)?.description || '';
          setTaxAccountDesc(desc);
          setAcctSelectorOpen(false);
        }}
        onCancel={() => setAcctSelectorOpen(false)}
      />
    </>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────────
const ManageTaxes: React.FC = () => {
  const [taxes,         setTaxes]         = useState<Tax[]>([]);
  const [assignments,   setAssignments]   = useState<TaxAssignment[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BUOption[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [asgLoading,    setAsgLoading]    = useState(false);
  const [activeTab,     setActiveTab]     = useState('taxes');

  // Tax list filters
  const [filterCode,   setFilterCode]   = useState('');
  const [filterApp,    setFilterApp]    = useState('');
  const [filterStatus, setFilterStatus] = useState('ACTIVE');

  // Assignment list filters
  const [filterBu,     setFilterBu]     = useState('');
  const [filterTaxId,  setFilterTaxId]  = useState<number | undefined>();
  const [filterAsgSts, setFilterAsgSts] = useState('ACTIVE');

  // Modals
  const [taxModalOpen,  setTaxModalOpen]  = useState(false);
  const [editingTax,    setEditingTax]    = useState<Tax | null>(null);
  const [asgModalOpen,  setAsgModalOpen]  = useState(false);
  const [editingAsg,    setEditingAsg]    = useState<TaxAssignment | null>(null);

  // ── Fetch taxes ──
  const fetchTaxes = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterCode)   p.set('tax_code',    filterCode);
      if (filterApp)    p.set('applicability', filterApp);
      if (filterStatus) p.set('status',       filterStatus);
      const res  = await fetch(`${APEX_BASE}/tax/taxes?${p}`);
      const data = await parseApexJson(res);
      setTaxes(data.items ?? []);
    } catch (e: any) {
      message.error('Failed to load taxes: ' + e.message);
    } finally { setLoading(false); }
  }, [filterCode, filterApp, filterStatus]);

  // ── Fetch assignments ──
  const fetchAssignments = useCallback(async () => {
    setAsgLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterBu)    p.set('business_unit', filterBu);
      if (filterTaxId) p.set('tax_id',        String(filterTaxId));
      if (filterAsgSts) p.set('status',       filterAsgSts);
      const res  = await fetch(`${APEX_BASE}/tax/assignments?${p}`);
      const data = await parseApexJson(res);
      setAssignments(data.items ?? []);
    } catch (e: any) {
      message.error('Failed to load assignments: ' + e.message);
    } finally { setAsgLoading(false); }
  }, [filterBu, filterTaxId, filterAsgSts]);

  // ── Fetch BUs ──
  const fetchBUs = useCallback(async () => {
    try {
      const res  = await fetch(`${APEX_BASE}/gl/businessunits`);
      const data = await res.json();
      const items: any[] = data?.items ?? data ?? [];
      setBusinessUnits(
        items.map((i: any) => ({
          label: i.businessUnitName || i.business_unit_name || '',
          value: i.businessUnitName || i.business_unit_name || '',
        })).filter(x => x.value).sort((a, b) => a.label.localeCompare(b.label))
      );
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchTaxes(); },      [fetchTaxes]);
  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);
  useEffect(() => { fetchBUs(); },         [fetchBUs]);

  // ── Delete tax ──
  const deleteTax = async (tax: Tax) => {
    try {
      const res  = await fetch(`${APEX_BASE}/tax/taxes/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxId: tax.taxId }),
      });
      const data = await parseApexJson(res);
      if (data.status === 'success') { message.success('Tax deleted.'); fetchTaxes(); fetchAssignments(); }
      else message.error(data.message || 'Delete failed.');
    } catch (e: any) { message.error('Network error: ' + e.message); }
  };

  // ── Delete assignment ──
  const deleteAssignment = async (asg: TaxAssignment) => {
    try {
      const res  = await fetch(`${APEX_BASE}/tax/assignments/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: asg.assignmentId }),
      });
      const data = await parseApexJson(res);
      if (data.status === 'success') { message.success('Assignment removed.'); fetchAssignments(); }
      else message.error(data.message || 'Delete failed.');
    } catch (e: any) { message.error('Network error: ' + e.message); }
  };

  // ── Tax table columns ──
  const taxColumns: ColumnsType<Tax> = [
    {
      title: 'Tax Code', dataIndex: 'taxCode', width: 120,
      render: v => <Text style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</Text>,
    },
    { title: 'Tax Name', dataIndex: 'taxName', ellipsis: true },
    {
      title: 'Rate', dataIndex: 'taxRate', width: 90, align: 'right',
      render: v => <Text strong>{Number(v).toFixed(2)}%</Text>,
    },
    {
      title: 'Type', dataIndex: 'taxType', width: 90, align: 'center',
      render: v => <Tag color={TYPE_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: 'Applicability', dataIndex: 'applicability', width: 120, align: 'center',
      render: v => <Tag color={APP_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    {
      title: 'Status', dataIndex: 'status', width: 90, align: 'center',
      render: v => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '', width: 90, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EditOutlined />}
            onClick={() => { setEditingTax(r); setTaxModalOpen(true); }} />
          <Popconfirm title="Delete this tax and all its BU assignments?"
            onConfirm={() => deleteTax(r)} okText="Delete" okButtonProps={{ danger: true }}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Assignment table columns ──
  const asgColumns: ColumnsType<TaxAssignment> = [
    {
      title: 'Business Unit', dataIndex: 'businessUnitName', ellipsis: true,
      render: v => <Text strong>{v}</Text>,
    },
    {
      title: 'Tax Code', dataIndex: 'taxCode', width: 110,
      render: v => <Text style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</Text>,
    },
    { title: 'Tax Name', dataIndex: 'taxName', ellipsis: true },
    {
      title: 'Rate', dataIndex: 'taxRate', width: 80, align: 'right',
      render: v => <Text strong>{Number(v).toFixed(2)}%</Text>,
    },
    {
      title: 'Applicability', dataIndex: 'applicability', width: 110, align: 'center',
      render: v => <Tag color={APP_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: 'Tax Account', dataIndex: 'taxAccount', width: 200,
      render: v => v
        ? <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>,
    },
    {
      title: 'Effective From', dataIndex: 'effectiveFrom', width: 120,
      render: v => v ? dayjs(v).format('D-MMM-YYYY') : '—',
    },
    {
      title: 'Effective To', dataIndex: 'effectiveTo', width: 120,
      render: v => v ? dayjs(v).format('D-MMM-YYYY') : 'Open',
    },
    {
      title: 'Status', dataIndex: 'status', width: 90, align: 'center',
      render: v => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '', width: 80, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EditOutlined />}
            onClick={() => { setEditingAsg(r); setAsgModalOpen(true); }} />
          <Popconfirm title="Remove this tax assignment?"
            onConfirm={() => deleteAssignment(r)} okText="Remove" okButtonProps={{ danger: true }}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '0 24px 24px' }}>
        <Breadcrumb style={{ padding: '16px 0' }} items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: 'Setup' },
          { title: 'Tax Setup' },
        ]} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>Tax Setup</Title>
            <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
              Define taxes and assign them to business units with GL accounts
            </Text>
          </div>
          <Button
            type="primary" icon={<PlusOutlined />}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
            onClick={() => {
              if (activeTab === 'taxes') { setEditingTax(null); setTaxModalOpen(true); }
              else { setEditingAsg(null); setAsgModalOpen(true); }
            }}
          >
            {activeTab === 'taxes' ? 'New Tax' : 'Assign Tax'}
          </Button>
        </div>

        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'taxes',
            label: <span><PercentageOutlined /> Tax Definitions</span>,
            children: (
              <Card style={{ borderRadius: 8 }}>
                {/* Filters */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <Input.Search
                    placeholder="Search tax code or name…"
                    allowClear style={{ width: 240 }}
                    onSearch={v => { setFilterCode(v); }}
                    onChange={e => { if (!e.target.value) setFilterCode(''); }}
                  />
                  <Select placeholder="Applicability" allowClear style={{ width: 160 }}
                    value={filterApp || undefined}
                    onChange={v => setFilterApp(v ?? '')}>
                    <Option value="AP">AP (Payables)</Option>
                    <Option value="AR">AR (Receivables)</Option>
                    <Option value="BOTH">Both</Option>
                  </Select>
                  <Select value={filterStatus || undefined} allowClear style={{ width: 120 }}
                    placeholder="Status"
                    onChange={v => setFilterStatus(v ?? '')}>
                    <Option value="ACTIVE">Active</Option>
                    <Option value="INACTIVE">Inactive</Option>
                  </Select>
                  <Button icon={<SearchOutlined />} type="primary" ghost onClick={fetchTaxes}>Search</Button>
                  <Button icon={<ReloadOutlined />} onClick={() => {
                    setFilterCode(''); setFilterApp(''); setFilterStatus('ACTIVE');
                  }}>Reset</Button>
                </div>

                <Table
                  dataSource={taxes} columns={taxColumns} rowKey="taxId"
                  loading={loading} size="small"
                  pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} taxes` }}
                />
              </Card>
            ),
          },
          {
            key: 'assignments',
            label: <span><BankOutlined /> BU Assignments</span>,
            children: (
              <Card style={{ borderRadius: 8 }}>
                {/* Filters */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <Select showSearch optionFilterProp="label" placeholder="Filter by BU" allowClear
                    style={{ width: 260 }} options={businessUnits}
                    value={filterBu || undefined}
                    onChange={v => setFilterBu(v ?? '')} />
                  <Select showSearch optionFilterProp="label" placeholder="Filter by Tax" allowClear
                    style={{ width: 240 }}
                    value={filterTaxId}
                    onChange={v => setFilterTaxId(v)}
                    options={taxes.map(t => ({ label: `${t.taxCode} — ${t.taxName}`, value: t.taxId }))} />
                  <Select value={filterAsgSts || undefined} allowClear style={{ width: 120 }}
                    placeholder="Status"
                    onChange={v => setFilterAsgSts(v ?? '')}>
                    <Option value="ACTIVE">Active</Option>
                    <Option value="INACTIVE">Inactive</Option>
                  </Select>
                  <Button icon={<SearchOutlined />} type="primary" ghost onClick={fetchAssignments}>Search</Button>
                  <Button icon={<ReloadOutlined />} onClick={() => {
                    setFilterBu(''); setFilterTaxId(undefined); setFilterAsgSts('ACTIVE');
                  }}>Reset</Button>
                </div>

                <Table
                  dataSource={assignments} columns={asgColumns} rowKey="assignmentId"
                  loading={asgLoading} size="small"
                  pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} assignments` }}
                />
              </Card>
            ),
          },
        ]} />

        <TaxModal
          open={taxModalOpen} editing={editingTax}
          onClose={() => setTaxModalOpen(false)}
          onSaved={fetchTaxes}
        />
        <AssignmentModal
          open={asgModalOpen} editing={editingAsg}
          taxes={taxes} businessUnits={businessUnits}
          onClose={() => setAsgModalOpen(false)}
          onSaved={fetchAssignments}
        />
      </Content>
    </Layout>
  );
};

export default ManageTaxes;
