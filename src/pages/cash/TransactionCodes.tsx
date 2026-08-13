import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  Space, Tag, Modal, Popconfirm, message, Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, BankOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  SearchOutlined, ReloadOutlined, ApiOutlined, TableOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
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

interface TransactionCode {
  tcId:                       number;
  businessUnitName:           string;
  transactionCode:            string;
  description?:               string;
  defaultAccountCombination?: string;
  endTransaction?:            string;
}

interface BUOption { label: string; value: string; }

const parseApexJson = async (res: Response) => {
  const text = await res.text();
  const fixed = text
    .replace(/:(-?)\.(\d)/g, ':$10.$2')
    .replace(/(\d)\.([,}\]])/g, '$1$2');
  return JSON.parse(fixed);
};

const END_TXN_OPTIONS = ['External Transaction', 'Manual Journal', 'Bank Transfer', 'Other'];

const endTxnColor: Record<string, string> = {
  'External Transaction': REDWOOD.info,
  'Manual Journal':       REDWOOD.warning,
  'Bank Transfer':        REDWOOD.success,
  'Other':                REDWOOD.neutral600,
};

const TransactionCodes: React.FC = () => {
  const [records, setRecords]       = useState<TransactionCode[]>([]);
  const [buOptions, setBuOptions]   = useState<BUOption[]>([]);
  const [filterBu, setFilterBu]     = useState<string | undefined>();
  const [loading, setLoading]       = useState(false);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editRecord, setEditRecord] = useState<TransactionCode | null>(null);
  const [saving, setSaving]           = useState(false);
  const [apiModal, setApiModal]       = useState(false);
  const [acctSelector, setAcctSelector] = useState(false);
  const [acctDesc, setAcctDesc]       = useState('');
  const [form] = Form.useForm();

  // Load Business Units (gl/businessunits returns snake_case)
  useEffect(() => {
    fetch(`${APEX_BASE}/gl/businessunits`)
      .then(res => res.json())
      .then((data) => {
        setBuOptions(
          (data.items ?? [])
            .map((b: any) => ({ label: b.business_unit_name || '', value: b.business_unit_name || '' }))
            .filter((o: BUOption) => o.value)
            .sort((a: BUOption, b: BUOption) => a.label.localeCompare(b.label))
        );
      })
      .catch(() => {});
  }, []);

  // Load transaction codes
  // GET handler uses quoted aliases → response keys are camelCase
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterBu) params.set('business_unit', filterBu);
      const res  = await fetch(`${APEX_BASE}/cash/transaction-codes?${params}`);
      const data = await parseApexJson(res);
      setRecords(
        (data.items ?? []).map((r: any) => ({
          tcId:                      r.tcid,
          businessUnitName:          r.businessunitname          ?? '',
          transactionCode:           r.transactioncode           ?? '',
          description:               r.description,
          defaultAccountCombination: r.defaultaccountcombination,
          endTransaction:            r.endtransaction,
        }))
      );
    } catch {
      message.error('Failed to load transaction codes');
    } finally {
      setLoading(false);
    }
  }, [filterBu]);

  useEffect(() => { loadData(); }, [loadData]);

  // Populate form whenever modal opens (handles destroyOnHide / remount)
  useEffect(() => {
    if (!modalOpen) { setAcctDesc(''); return; }
    if (editRecord) {
      form.setFieldsValue({
        businessUnitName:          editRecord.businessUnitName,
        transactionCode:           editRecord.transactionCode,
        description:               editRecord.description       ?? '',
        defaultAccountCombination: editRecord.defaultAccountCombination ?? '',
        endTransaction:            editRecord.endTransaction,
      });
      setAcctDesc(editRecord.defaultAccountCombination ? '' : '');
    } else {
      form.resetFields();
      setAcctDesc('');
    }
  }, [modalOpen, editRecord, form]);

  const openModal  = (record?: TransactionCode) => {
    setEditRecord(record ?? null);
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditRecord(null); };

  // Save (upsert)
  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        business_unit_name:          values.businessUnitName,
        transaction_code:            String(values.transactionCode).toUpperCase(),
        description:                 values.description             || null,
        default_account_combination: values.defaultAccountCombination || null,
        end_transaction:             values.endTransaction           || null,
        last_updated_by:             'APP_USER',
      };
      if (editRecord?.tcId) {
        payload.tc_id      = editRecord.tcId;
      } else {
        payload.created_by = 'APP_USER';
      }

      const res  = await fetch(`${APEX_BASE}/cash/transaction-codes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        message.success(editRecord ? 'Transaction code updated' : 'Transaction code created');
        closeModal();
        loadData();
      } else {
        message.error(data.message ?? 'Save failed');
      }
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async (tcId: number) => {
    try {
      const res  = await fetch(`${APEX_BASE}/cash/transaction-codes/${tcId}`, { method: 'DELETE' });
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        message.success('Transaction code deleted');
        loadData();
      } else {
        message.error(data.message ?? 'Delete failed');
      }
    } catch {
      message.error('Delete request failed');
    }
  };

  const columns: ColumnsType<TransactionCode> = [
    {
      title: 'Transaction Code', dataIndex: 'transactionCode', key: 'transactionCode', width: 160,
      render: (v: string) => <Text strong style={{ color: REDWOOD.primary }}>{v}</Text>,
    },
    {
      title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v?: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Business Unit', dataIndex: 'businessUnitName', key: 'businessUnitName', width: 220, ellipsis: true,
    },
    {
      title: 'Default Account', dataIndex: 'defaultAccountCombination', key: 'defaultAccountCombination', width: 200, ellipsis: true,
      render: (v?: string) => v ? <code style={{ fontSize: 11 }}>{v}</code> : <Text type="secondary">—</Text>,
    },
    {
      title: 'End Transaction', dataIndex: 'endTransaction', key: 'endTransaction', width: 175,
      render: (v?: string) => v ? (
        <Tag style={{ borderRadius: 4, background: endTxnColor[v] ?? REDWOOD.neutral600, color: '#fff', border: 'none', fontSize: 11 }}>
          {v}
        </Tag>
      ) : <Text type="secondary">—</Text>,
    },
    {
      title: '', key: 'actions', width: 80, align: 'center',
      render: (_: unknown, record: TransactionCode) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EditOutlined />}
            style={{ color: REDWOOD.info }} onClick={() => openModal(record)} />
          <Popconfirm
            title="Delete this transaction code?"
            description="This action cannot be undone."
            onConfirm={() => handleDelete(record.tcId)}
            okText="Delete" okButtonProps={{ danger: true }} cancelText="Cancel"
          >
            <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: REDWOOD.error }} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // API info content
  const getApiUrl = (suffix = '') =>
    `${APEX_BASE}/cash/transaction-codes${suffix}`;

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 24px' }}>
        <Breadcrumb style={{ marginBottom: 12 }}>
          <Breadcrumb.Item><Link to="/"><HomeOutlined /> Home</Link></Breadcrumb.Item>
          <Breadcrumb.Item><Link to="/cash"><BankOutlined /> Cash Management</Link></Breadcrumb.Item>
          <Breadcrumb.Item>Transaction Codes</Breadcrumb.Item>
        </Breadcrumb>

        <Card bordered={false} style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
          styles={{ body: { padding: 16 } }}>

          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>Transaction Codes</Title>
            <Space>
              <Button icon={<ApiOutlined />} style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={() => setApiModal(true)}>
                API
              </Button>
              <Button type="primary" icon={<PlusOutlined />}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                onClick={() => openModal()}>
                New Code
              </Button>
            </Space>
          </div>

          {/* Filter bar */}
          <Space style={{ marginBottom: 12 }} wrap>
            <Select allowClear showSearch placeholder="Business Unit" style={{ width: 280 }}
              value={filterBu} onChange={setFilterBu} options={buOptions}
              filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
            />
            <Button type="primary" icon={<SearchOutlined />}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={loadData}>
              Search
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => { setFilterBu(undefined); }}>Reset</Button>
          </Space>

          <Table<TransactionCode>
            dataSource={records} columns={columns} rowKey="tcId"
            loading={loading} size="small"
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} records` }}
          />
        </Card>

        {/* ── Add / Edit Modal ── */}
        <Modal
          title={<Space>{editRecord ? <EditOutlined /> : <PlusOutlined />}<span>{editRecord ? 'Edit Transaction Code' : 'New Transaction Code'}</span></Space>}
          open={modalOpen} onCancel={closeModal} onOk={handleSave}
          confirmLoading={saving}
          okText={editRecord ? 'Update' : 'Create'}
          okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
          width={560}
        >
          <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item name="businessUnitName" label="Business Unit"
              rules={[{ required: true, message: 'Required' }]}>
              <Select showSearch placeholder="Select business unit" options={buOptions}
                filterOption={(input, opt) =>
                  (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())} />
            </Form.Item>
            <Form.Item name="transactionCode" label="Transaction Code"
              rules={[{ required: true, message: 'Required' }]}
              normalize={(v: string) => v?.toUpperCase()}>
              <Input placeholder="e.g. NEFT, RTGS, CHQ" maxLength={50} />
            </Form.Item>
            <Form.Item name="description" label="Description">
              <Input.TextArea rows={2} placeholder="Short description" maxLength={500} />
            </Form.Item>
            <Form.Item name="defaultAccountCombination" label="Default Account Combination">
              <Input
                placeholder="e.g. 100-0000-1130100-000"
                maxLength={360}
                addonAfter={
                  <Button
                    type="link" size="small" icon={<TableOutlined />}
                    style={{ padding: 0, height: 'auto', color: REDWOOD.info }}
                    onClick={() => setAcctSelector(true)}
                  />
                }
              />
            </Form.Item>
            {acctDesc && (
              <div style={{ marginTop: -10, marginBottom: 12, paddingLeft: 2 }}>
                <Text style={{ fontSize: 11, color: REDWOOD.success }}>{acctDesc}</Text>
              </div>
            )}
            <Form.Item name="endTransaction" label="End Transaction">
              <Select allowClear placeholder="Select type">
                {END_TXN_OPTIONS.map(opt => <Option key={opt} value={opt}>{opt}</Option>)}
              </Select>
            </Form.Item>
          </Form>
        </Modal>

        {/* ── Account Selector ── */}
        <AccountSelector
          visible={acctSelector}
          onCancel={() => setAcctSelector(false)}
          initialValue={form.getFieldValue('defaultAccountCombination') || undefined}
          onSelect={(accountCode, segments) => {
            form.setFieldValue('defaultAccountCombination', accountCode);
            const acctSeg = Object.entries(segments).find(([key, seg]) =>
              key.toUpperCase().includes('ACCOUNT') ||
              ((seg as any).name ?? '').toUpperCase().includes('ACCOUNT')
            );
            setAcctDesc(acctSeg ? `${acctSeg[1].value} — ${acctSeg[1].description}` : accountCode);
            setAcctSelector(false);
          }}
        />

        {/* ── API Info Modal ── */}
        <Modal
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Reference — Transaction Codes</span></Space>}
          open={apiModal} onCancel={() => setApiModal(false)} footer={null} width={700}
          styles={{ body: { padding: '16px 24px' } }}
        >
          {[
            { method: 'GET',    color: REDWOOD.success, url: getApiUrl(`?business_unit={bu}&transaction_code={code}`), note: 'List all codes; both params optional' },
            { method: 'POST',   color: REDWOOD.info,    url: getApiUrl(),   note: 'Create (no tc_id) or Update (with tc_id)' },
            { method: 'DELETE', color: REDWOOD.error,   url: getApiUrl('/{id}'), note: 'Delete by TC_ID' },
          ].map(({ method, color, url, note }) => (
            <div key={method} style={{ marginBottom: 14 }}>
              <Space align="start">
                <Tag style={{ background: color, color: '#fff', border: 'none', fontWeight: 600, minWidth: 60, textAlign: 'center' }}>
                  {method}
                </Tag>
                <div>
                  <Text code copyable style={{ fontSize: 11 }}>{url}</Text>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>{note}</Text>
                </div>
              </Space>
            </div>
          ))}

          <Divider style={{ margin: '12px 0 10px' }} />
          <Text strong style={{ fontSize: 12 }}>POST body fields</Text>
          <pre style={{
            background: '#1e1e2e', color: '#cdd6f4', padding: 14, borderRadius: 6,
            fontSize: 11, marginTop: 8, overflowX: 'auto',
          }}>{JSON.stringify({
            tc_id: '(number — omit for create, include for update)',
            business_unit_name: 'string (required)',
            transaction_code: 'string (required, uppercase)',
            description: 'string | null',
            default_account_combination: 'string | null',
            end_transaction: 'External Transaction | Manual Journal | Bank Transfer | Other | null',
            created_by: 'APP_USER',
            last_updated_by: 'APP_USER',
          }, null, 2)}</pre>
        </Modal>
      </Content>
    </Layout>
  );
};

export default TransactionCodes;
