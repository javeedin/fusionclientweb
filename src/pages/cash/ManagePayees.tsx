import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input,
  Space, Tag, Modal, Popconfirm, message, Tabs, Checkbox, Divider, Row, Col,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, TeamOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  SearchOutlined, ReloadOutlined, BankOutlined, UserOutlined, ApiOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const APEX_BASE = buildApexUrl('');

// ── Interfaces ────────────────────────────────────────────────

interface Payee {
  payeeId:               number;
  payeeName:             string;
  taxRegistrationNumber: string | null;
  description:           string | null;
  active:                string;
}

interface PayeeBankAccount {
  payeeBankAccountId: number;
  payeeId:            number;
  country:            string | null;
  accountNumber:      string | null;
  currencyCode:       string | null;
  iban:               string | null;
  accountHolderName:  string | null;
  bankName:           string | null;
  bankBranch:         string | null;
  bicCode:            string | null;
  active:             string;
}

// ── Helper ────────────────────────────────────────────────────

const parseApex = async (res: Response) => {
  const text = await res.text();
  const fixed = text
    .replace(/:(-?)\.(\d)/g, ':$10.$2')
    .replace(/(\d)\.([,}\]])/g, '$1$2');
  return JSON.parse(fixed);
};

// ── Component ─────────────────────────────────────────────────

const ManagePayees: React.FC = () => {
  const [payees, setPayees]               = useState<Payee[]>([]);
  const [loading, setLoading]             = useState(false);
  const [filterName, setFilterName]       = useState('');

  // Payee modal
  const [payeeModal, setPayeeModal]       = useState(false);
  const [editPayee, setEditPayee]         = useState<Payee | null>(null);
  const [savingPayee, setSavingPayee]     = useState(false);
  const [payeeForm]                       = Form.useForm();

  // Bank accounts (shown inside payee modal, Accounts tab)
  const [bankAccounts, setBankAccounts]   = useState<PayeeBankAccount[]>([]);
  const [loadingBanks, setLoadingBanks]   = useState(false);

  // API info modal
  const [apiModal, setApiModal]           = useState(false);

  // Bank account modal
  const [bankModal, setBankModal]         = useState(false);
  const [editBank, setEditBank]           = useState<PayeeBankAccount | null>(null);
  const [savingBank, setSavingBank]       = useState(false);
  const [bankForm]                        = Form.useForm();

  // ── Fetch payees ──────────────────────────────────────────────

  const fetchPayees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${APEX_BASE}/cash/payees`, { headers: { Accept: 'application/json' } });
      const data = await parseApex(res);
      const items: Payee[] = (data.items || []).map((r: any) => ({
        payeeId:               r.payee_id,
        payeeName:             r.payee_name,
        taxRegistrationNumber: r.tax_registration_number ?? null,
        description:           r.description ?? null,
        active:                r.active ?? 'Y',
      }));
      setPayees(items);
    } catch {
      message.error('Failed to load payees');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPayees(); }, [fetchPayees]);

  // ── Fetch bank accounts for selected payee ────────────────────

  const fetchBankAccounts = useCallback(async (payeeId: number) => {
    setLoadingBanks(true);
    try {
      const res = await fetch(`${APEX_BASE}/cash/payees/${payeeId}/bankaccounts`, { headers: { Accept: 'application/json' } });
      const data = await parseApex(res);
      const items: PayeeBankAccount[] = (data.items || []).map((r: any) => ({
        payeeBankAccountId: r.payee_bank_account_id,
        payeeId:            r.payee_id,
        country:            r.country ?? null,
        accountNumber:      r.account_number ?? null,
        currencyCode:       r.currency_code ?? null,
        iban:               r.iban ?? null,
        accountHolderName:  r.account_holder_name ?? null,
        bankName:           r.bank_name ?? null,
        bankBranch:         r.bank_branch ?? null,
        bicCode:            r.bic_code ?? null,
        active:             r.active ?? 'Y',
      }));
      setBankAccounts(items);
    } catch {
      message.error('Failed to load bank accounts');
    } finally {
      setLoadingBanks(false);
    }
  }, []);

  // ── Open/close payee modal ────────────────────────────────────

  const openCreatePayee = () => {
    setEditPayee(null);
    setBankAccounts([]);
    payeeForm.resetFields();
    setPayeeModal(true);
  };

  const openEditPayee = (p: Payee) => {
    setEditPayee(p);
    payeeForm.setFieldsValue({
      payeeName:             p.payeeName,
      taxRegistrationNumber: p.taxRegistrationNumber ?? '',
      description:           p.description ?? '',
      active:                p.active === 'Y',
    });
    fetchBankAccounts(p.payeeId);
    setPayeeModal(true);
  };

  const closePayeeModal = () => {
    setPayeeModal(false);
    setEditPayee(null);
    setBankAccounts([]);
    payeeForm.resetFields();
  };

  // ── Save payee ────────────────────────────────────────────────

  const handleSavePayee = async () => {
    let values: any;
    try { values = await payeeForm.validateFields(); } catch { return; }
    setSavingPayee(true);
    try {
      const body = {
        payeeName:             values.payeeName,
        taxRegistrationNumber: values.taxRegistrationNumber || null,
        description:           values.description || null,
        active:                values.active ? 'Y' : 'N',
      };
      let res: Response;
      if (editPayee) {
        res = await fetch(`${APEX_BASE}/cash/payees/${editPayee.payeeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${APEX_BASE}/cash/payees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      message.success(editPayee ? 'Payee updated' : 'Payee created');
      closePayeeModal();
      fetchPayees();
    } catch (e: any) {
      message.error(e.message || 'Save failed');
    } finally {
      setSavingPayee(false);
    }
  };

  // ── Delete payee ──────────────────────────────────────────────

  const handleDeletePayee = async (payeeId: number) => {
    try {
      const res = await fetch(`${APEX_BASE}/cash/payees/${payeeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      message.success('Payee deleted');
      fetchPayees();
    } catch (e: any) {
      message.error(e.message || 'Delete failed');
    }
  };

  // ── Open/close bank account modal ─────────────────────────────

  const openAddBank = () => {
    setEditBank(null);
    bankForm.resetFields();
    bankForm.setFieldsValue({ active: true });
    setBankModal(true);
  };

  const openEditBank = (b: PayeeBankAccount) => {
    setEditBank(b);
    bankForm.setFieldsValue({
      country:           b.country ?? '',
      accountNumber:     b.accountNumber ?? '',
      currencyCode:      b.currencyCode ?? '',
      iban:              b.iban ?? '',
      accountHolderName: b.accountHolderName ?? '',
      bankName:          b.bankName ?? '',
      bankBranch:        b.bankBranch ?? '',
      bicCode:           b.bicCode ?? '',
      active:            b.active === 'Y',
    });
    setBankModal(true);
  };

  const closeBankModal = () => {
    setBankModal(false);
    setEditBank(null);
    bankForm.resetFields();
  };

  // ── Save bank account ─────────────────────────────────────────

  const handleSaveBank = async () => {
    if (!editPayee) { message.error('Save the payee first'); return; }
    let values: any;
    try { values = await bankForm.validateFields(); } catch { return; }
    setSavingBank(true);
    try {
      const body = {
        country:           values.country || null,
        accountNumber:     values.accountNumber || null,
        currencyCode:      values.currencyCode || null,
        iban:              values.iban || null,
        accountHolderName: values.accountHolderName || null,
        bankName:          values.bankName || null,
        bankBranch:        values.bankBranch || null,
        bicCode:           values.bicCode || null,
        active:            values.active ? 'Y' : 'N',
      };
      let res: Response;
      if (editBank) {
        res = await fetch(`${APEX_BASE}/cash/payees/${editPayee.payeeId}/bankaccounts/${editBank.payeeBankAccountId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${APEX_BASE}/cash/payees/${editPayee.payeeId}/bankaccounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      message.success(editBank ? 'Bank account updated' : 'Bank account added');
      closeBankModal();
      fetchBankAccounts(editPayee.payeeId);
    } catch (e: any) {
      message.error(e.message || 'Save failed');
    } finally {
      setSavingBank(false);
    }
  };

  // ── Delete bank account ───────────────────────────────────────

  const handleDeleteBank = async (b: PayeeBankAccount) => {
    if (!editPayee) return;
    try {
      const res = await fetch(`${APEX_BASE}/cash/payees/${editPayee.payeeId}/bankaccounts/${b.payeeBankAccountId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      message.success('Bank account removed');
      fetchBankAccounts(editPayee.payeeId);
    } catch (e: any) {
      message.error(e.message || 'Delete failed');
    }
  };

  // ── Filtered payees ───────────────────────────────────────────

  const filtered = payees.filter(p =>
    !filterName ||
    p.payeeName.toLowerCase().includes(filterName.toLowerCase()) ||
    (p.taxRegistrationNumber || '').toLowerCase().includes(filterName.toLowerCase())
  );

  // ── Payees table columns ──────────────────────────────────────

  const payeeColumns: ColumnsType<Payee> = [
    {
      title: 'Payee Name',
      dataIndex: 'payeeName',
      key: 'payeeName',
      sorter: (a, b) => a.payeeName.localeCompare(b.payeeName),
      render: (v: string) => <Text strong style={{ color: REDWOOD.info }}>{v}</Text>,
    },
    {
      title: 'Tax Registration Number',
      dataIndex: 'taxRegistrationNumber',
      key: 'taxRegistrationNumber',
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Active',
      dataIndex: 'active',
      key: 'active',
      width: 80,
      align: 'center',
      render: (v: string) => (
        <Tag color={v === 'Y' ? 'success' : 'default'}>{v === 'Y' ? 'Yes' : 'No'}</Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      align: 'center',
      render: (_: any, record: Payee) => (
        <Space size={4}>
          <Button
            size="small" type="text" icon={<EditOutlined />}
            onClick={() => openEditPayee(record)}
          />
          <Popconfirm
            title={`Delete "${record.payeeName}"?`}
            description="This will also delete all associated bank accounts."
            onConfirm={() => handleDeletePayee(record.payeeId)}
            okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true }}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Bank accounts table columns ───────────────────────────────

  const bankColumns: ColumnsType<PayeeBankAccount> = [
    { title: 'Account Number', dataIndex: 'accountNumber', key: 'accountNumber', render: (v) => v || '—' },
    { title: 'IBAN',           dataIndex: 'iban',           key: 'iban',          render: (v) => v ? <code style={{ fontSize: 11 }}>{v}</code> : '—' },
    { title: 'Currency',       dataIndex: 'currencyCode',   key: 'currencyCode',  width: 80 },
    { title: 'Bank',           dataIndex: 'bankName',       key: 'bankName',      render: (v) => v || '—' },
    { title: 'Branch',         dataIndex: 'bankBranch',     key: 'bankBranch',    render: (v) => v || '—' },
    { title: 'BIC / SWIFT',    dataIndex: 'bicCode',        key: 'bicCode',       render: (v) => v ? <code style={{ fontSize: 11 }}>{v}</code> : '—' },
    { title: 'Account Holder', dataIndex: 'accountHolderName', key: 'accountHolderName', render: (v) => v || '—' },
    { title: 'Country',        dataIndex: 'country',        key: 'country',       render: (v) => v || '—' },
    {
      title: 'Active', dataIndex: 'active', key: 'active', width: 70, align: 'center',
      render: (v: string) => <Tag color={v === 'Y' ? 'success' : 'default'}>{v === 'Y' ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: 'Actions', key: 'actions', width: 100, align: 'center',
      render: (_: any, record: PayeeBankAccount) => (
        <Space size={4}>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditBank(record)} />
          <Popconfirm
            title="Remove this bank account?"
            onConfirm={() => handleDeleteBank(record)}
            okText="Remove" cancelText="Cancel" okButtonProps={{ danger: true }}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────────

  const labelStyle = { fontWeight: 600, fontSize: 13 };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/cash">Cash Management</Link> },
            { title: 'Manage Payees' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 46, height: 46, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.info} 0%, #0450A0 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.info}40`,
              }}>
                <TeamOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>Manage Payees</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Create and manage ad-hoc payees and their bank accounts</Text>
              </div>
            </div>
            <Space>
              <Button
                icon={<ApiOutlined />}
                onClick={() => setApiModal(true)}
              >
                API
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreatePayee}
                style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
              >
                Create New Payee
              </Button>
            </Space>
          </div>

          {/* Search + table */}
          <Card styles={{ body: { padding: '16px 20px' } }} style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}` }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <Input
                placeholder="Search by name or tax registration number..."
                prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
                value={filterName}
                onChange={e => setFilterName(e.target.value)}
                allowClear
                style={{ maxWidth: 400 }}
              />
              <Button icon={<ReloadOutlined />} onClick={() => { setFilterName(''); fetchPayees(); }}>Refresh</Button>
            </div>

            <Table<Payee>
              dataSource={filtered}
              columns={payeeColumns}
              rowKey="payeeId"
              loading={loading}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} payees` }}
              style={{ fontSize: 13 }}
            />
          </Card>
        </div>
      </Content>

      {/* ── Payee Create / Edit Modal ────────────────────────── */}
      <Modal
        title={
          <Space>
            <UserOutlined style={{ color: REDWOOD.info }} />
            {editPayee ? `Edit Payee — ${editPayee.payeeName}` : 'Create New Payee'}
          </Space>
        }
        open={payeeModal}
        onCancel={closePayeeModal}
        width={860}
        footer={null}
        destroyOnClose
      >
        <Tabs
          defaultActiveKey="info"
          items={[
            {
              key: 'info',
              label: <span><UserOutlined /> Payee Details</span>,
              children: (
                <Form form={payeeForm} layout="vertical" style={{ marginTop: 8 }}>
                  <Row gutter={16}>
                    <Col xs={24} md={16}>
                      <Form.Item
                        label={<span style={labelStyle}>Payee Name</span>}
                        name="payeeName"
                        rules={[{ required: true, message: 'Payee name is required' }]}
                      >
                        <Input placeholder="Full legal name of payee" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        label={<span style={labelStyle}>Tax Registration Number</span>}
                        name="taxRegistrationNumber"
                      >
                        <Input placeholder="TRN / VAT number" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item
                    label={<span style={labelStyle}>Description</span>}
                    name="description"
                  >
                    <Input.TextArea rows={2} placeholder="Optional description or notes" />
                  </Form.Item>
                  <Form.Item name="active" valuePropName="checked" initialValue={true}>
                    <Checkbox><span style={labelStyle}>Active</span></Checkbox>
                  </Form.Item>

                  <Divider />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button onClick={closePayeeModal}>Cancel</Button>
                    <Button
                      type="primary"
                      loading={savingPayee}
                      onClick={handleSavePayee}
                      style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                    >
                      {editPayee ? 'Save Changes' : 'Create Payee'}
                    </Button>
                  </div>
                </Form>
              ),
            },
            {
              key: 'accounts',
              label: (
                <span>
                  <BankOutlined /> Bank Accounts
                  {bankAccounts.length > 0 && (
                    <span style={{
                      marginLeft: 6, background: REDWOOD.info, color: '#fff',
                      borderRadius: 10, padding: '0 6px', fontSize: 11,
                    }}>
                      {bankAccounts.length}
                    </span>
                  )}
                </span>
              ),
              disabled: !editPayee,
              children: (
                <div style={{ marginTop: 8 }}>
                  {!editPayee && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Save the payee first before adding bank accounts.
                    </Text>
                  )}
                  {editPayee && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                        <Button
                          type="primary" size="small" icon={<PlusOutlined />}
                          onClick={openAddBank}
                          style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                        >
                          Add Bank Account
                        </Button>
                      </div>
                      <Table<PayeeBankAccount>
                        dataSource={bankAccounts}
                        columns={bankColumns}
                        rowKey="payeeBankAccountId"
                        loading={loadingBanks}
                        size="small"
                        pagination={false}
                        scroll={{ x: 900 }}
                        style={{ fontSize: 12 }}
                      />
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Modal>

      {/* ── API Info Modal ──────────────────────────────────── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Payees API Endpoints</span></Space>}
        open={apiModal}
        onCancel={() => setApiModal(false)}
        footer={<Button onClick={() => setApiModal(false)}>Close</Button>}
        width={720}
        destroyOnClose
      >
        {(() => {
          const base = APEX_BASE;
          const endpoints = [
            { method: 'GET',    color: 'blue',   url: `${base}/cash/payees`,                                            note: 'List all payees' },
            { method: 'POST',   color: 'green',  url: `${base}/cash/payees`,                                            note: 'Create a new payee' },
            { method: 'PUT',    color: 'orange', url: `${base}/cash/payees/:payee_id`,                                  note: 'Update a payee' },
            { method: 'DELETE', color: 'red',    url: `${base}/cash/payees/:payee_id`,                                  note: 'Delete payee (cascades to bank accounts)' },
            { method: 'GET',    color: 'blue',   url: `${base}/cash/payees/:payee_id/bankaccounts`,                     note: 'List bank accounts for a payee' },
            { method: 'POST',   color: 'green',  url: `${base}/cash/payees/:payee_id/bankaccounts`,                     note: 'Add a bank account to a payee' },
            { method: 'PUT',    color: 'orange', url: `${base}/cash/payees/:payee_id/bankaccounts/:account_id`,         note: 'Update a bank account' },
            { method: 'DELETE', color: 'red',    url: `${base}/cash/payees/:payee_id/bankaccounts/:account_id`,         note: 'Remove a bank account' },
          ];
          return (
            <div style={{ fontSize: 13 }}>
              {endpoints.map((ep, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <Tag color={ep.color} style={{ minWidth: 60, textAlign: 'center', fontWeight: 600, marginTop: 1 }}>{ep.method}</Tag>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text code copyable style={{ fontSize: 11, wordBreak: 'break-all' }}>{ep.url}</Text>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>{ep.note}</Text>
                  </div>
                </div>
              ))}

              <Divider style={{ margin: '16px 0 12px' }} />
              <Text strong style={{ fontSize: 12 }}>POST / PUT body — Payee</Text>
              <pre style={{ background: REDWOOD.neutral100, borderRadius: 6, padding: '10px 14px', fontSize: 11, marginTop: 6, marginBottom: 16, overflowX: 'auto' }}>
                {JSON.stringify({ payeeName: 'string', taxRegistrationNumber: 'string | null', description: 'string | null', active: '"Y" | "N"' }, null, 2)}
              </pre>

              <Text strong style={{ fontSize: 12 }}>POST / PUT body — Bank Account</Text>
              <pre style={{ background: REDWOOD.neutral100, borderRadius: 6, padding: '10px 14px', fontSize: 11, marginTop: 6, overflowX: 'auto' }}>
                {JSON.stringify({ country: 'string | null', accountNumber: 'string | null', currencyCode: 'string | null', iban: 'string | null', accountHolderName: 'string | null', bankName: 'string | null', bankBranch: 'string | null', bicCode: 'string | null', active: '"Y" | "N"' }, null, 2)}
              </pre>
            </div>
          );
        })()}
      </Modal>

      {/* ── Bank Account Modal ───────────────────────────────── */}
      <Modal
        title={
          <Space>
            <BankOutlined style={{ color: REDWOOD.info }} />
            {editBank
              ? `Edit Bank Account — ${editBank.accountNumber || editBank.iban || 'Account'}`
              : 'Add Bank Account'}
          </Space>
        }
        open={bankModal}
        onCancel={closeBankModal}
        onOk={handleSaveBank}
        okText={editBank ? 'Save Changes' : 'Add Account'}
        confirmLoading={savingBank}
        okButtonProps={{ style: { background: REDWOOD.info, borderColor: REDWOOD.info } }}
        width={620}
        destroyOnClose
      >
        <Form form={bankForm} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label={<span style={labelStyle}>Country</span>} name="country">
                <Input placeholder="e.g. United Arab Emirates" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label={<span style={labelStyle}>Currency</span>} name="currencyCode">
                <Input placeholder="e.g. AED" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label={<span style={labelStyle}>Account Number</span>} name="accountNumber">
                <Input placeholder="Bank account number" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label={<span style={labelStyle}>IBAN</span>} name="iban">
                <Input placeholder="e.g. AE070331234567890123456" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={<span style={labelStyle}>Account Holder Name</span>} name="accountHolderName">
            <Input placeholder="Name on the account" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label={<span style={labelStyle}>Bank Name</span>} name="bankName">
                <Input placeholder="e.g. Bank of Baroda" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label={<span style={labelStyle}>Bank Branch</span>} name="bankBranch">
                <Input placeholder="e.g. Deira, Dubai" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label={<span style={labelStyle}>BIC / SWIFT Code</span>} name="bicCode">
                <Input placeholder="e.g. BARBAEADDEI" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="active" valuePropName="checked" label=" ">
                <Checkbox><span style={labelStyle}>Active</span></Checkbox>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Layout>
  );
};

export default ManagePayees;
