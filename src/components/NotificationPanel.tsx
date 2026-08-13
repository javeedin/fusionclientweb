import React, { useState } from 'react';
import {
  Drawer, Button, Badge, Tag, Typography, Space, Tooltip, Empty, Spin,
  Table, Select, Modal, Descriptions, Divider, Input, message,
} from 'antd';
import {
  BellOutlined, CheckOutlined, DeleteOutlined, ReloadOutlined,
  WarningOutlined, InfoCircleOutlined, CloseCircleOutlined, ApiOutlined,
  CheckCircleOutlined, StopOutlined, EyeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useNotifications, type AppNotification, type NotificationModule } from '../context/NotificationContext';
import { APEX_DB_CONFIG } from '../config/api.config';

const { Text } = Typography;

const MODULES: { label: string; value: 'All' | NotificationModule }[] = [
  { label: 'All',       value: 'All'       },
  { label: 'Approvals', value: 'Approvals' },
  { label: 'General',   value: 'General'   },
  { label: 'GL',        value: 'GL'        },
  { label: 'AP',        value: 'AP'        },
  { label: 'AR',        value: 'AR'        },
  { label: 'CM',        value: 'CM'        },
  { label: 'RM',        value: 'RM'        },
  { label: 'FA',        value: 'FA'        },
  { label: 'PMS',       value: 'PMS'       },
];

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error:   <CloseCircleOutlined style={{ color: '#C74634' }} />,
  warning: <WarningOutlined     style={{ color: '#D4A800' }} />,
  info:    <InfoCircleOutlined  style={{ color: '#0572CE' }} />,
};

const STATUS_COLOR: Record<string, string> = {
  Unread:   'red',
  Read:     'default',
  Actioned: 'green',
};

const MODULE_COLOR: Record<string, string> = {
  AP: 'purple', GL: 'blue', AR: 'cyan', CM: 'geekblue',
  RM: 'volcano', FA: 'orange', PMS: 'magenta', General: 'default',
  Approvals: 'gold',
};

// ── Transaction Detail Modal ──────────────────────────────────────────────────
const TransactionDetailModal: React.FC<{
  notif: AppNotification | null;
  open: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: (comments: string) => void;
  acting: boolean;
}> = ({ notif, open, onClose, onApprove, onReject, acting }) => {
  const [invoiceLines, setInvoiceLines] = useState<any[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [apHeader, setApHeader] = useState<any>(null);
  const [apHeaderLoading, setApHeaderLoading] = useState(false);
  const [cashTxn, setCashTxn] = useState<any>(null);
  const [cashTxnLoading, setCashTxnLoading] = useState(false);
  const [rejectComments, setRejectComments] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  React.useEffect(() => {
    if (!open || !notif?.transactionId || notif.approvalModule !== 'AP') {
      setInvoiceLines([]);
      setApHeader(null);
      return;
    }
    // Fetch AP invoice lines
    setLinesLoading(true);
    fetch(`${APEX_DB_CONFIG.baseUrl}/ap/createinvoiceslines?P_INVOICE_ID=${notif.transactionId}`, {
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(d => setInvoiceLines(d.items ?? []))
      .catch(() => {})
      .finally(() => setLinesLoading(false));
    // Fetch AP invoice header
    setApHeaderLoading(true);
    fetch(`${APEX_DB_CONFIG.baseUrl}/ap/createinvoice/${notif.transactionId}`, {
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(d => {
        const arr = d?.items;
        if (Array.isArray(arr) && arr.length > 0) setApHeader(arr[0]);
        else setApHeader(d?.header || d || null);
      })
      .catch(() => {})
      .finally(() => setApHeaderLoading(false));
  }, [open, notif?.transactionId, notif?.approvalModule]);

  React.useEffect(() => {
    if (!open || !notif?.transactionId || notif.approvalModule !== 'CASH') {
      setCashTxn(null);
      return;
    }
    setCashTxnLoading(true);
    fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions?external_transaction_id=${notif.transactionId}`, {
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(d => setCashTxn(d.items?.[0] ?? null))
      .catch(() => {})
      .finally(() => setCashTxnLoading(false));
  }, [open, notif?.transactionId, notif?.approvalModule]);

  React.useEffect(() => {
    if (!open) {
      setShowRejectInput(false);
      setRejectComments('');
      setApHeader(null);
      setCashTxn(null);
    }
  }, [open]);

  if (!notif) return null;

  const amt = notif.approvalAmount != null
    ? `${notif.approvalCurrency || ''} ${Number(notif.approvalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    : '—';

  const lineColumns: ColumnsType<any> = [
    { title: 'Line #',  dataIndex: 'LINE_NUMBER',  key: 'ln',  width: 60 },
    { title: 'Type',    dataIndex: 'LINE_TYPE',     key: 'lt',  width: 80 },
    { title: 'Description', dataIndex: 'DESCRIPTION', key: 'ld', ellipsis: true },
    { title: 'Amount',  dataIndex: 'LINE_AMOUNT',   key: 'la',  width: 110,
      render: (v: number) => <Text style={{ fontFamily: 'monospace' }}>{Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text> },
    { title: 'Distribution', dataIndex: 'DISTRIBUTION_COMBINATION', key: 'dc', width: 160,
      render: (v: string) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v || '—'}</Text> },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <BellOutlined style={{ color: '#D4A800' }} />
          <span>Approval Request — {notif.trxNo}</span>
        </Space>
      }
      width={780}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button onClick={onClose}>Close</Button>
          <Space>
            {showRejectInput ? (
              <>
                <Input.TextArea
                  rows={1}
                  placeholder="Reason for rejection (optional)"
                  value={rejectComments}
                  onChange={e => setRejectComments(e.target.value)}
                  style={{ width: 260, resize: 'none' }}
                  autoFocus
                />
                <Button danger loading={acting} icon={<StopOutlined />}
                  onClick={() => { onReject(rejectComments); setShowRejectInput(false); }}>
                  Confirm Reject
                </Button>
                <Button onClick={() => setShowRejectInput(false)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button danger icon={<StopOutlined />} onClick={() => setShowRejectInput(true)}>
                  Reject
                </Button>
                <Button type="primary" loading={acting} icon={<CheckCircleOutlined />}
                  style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}
                  onClick={onApprove}>
                  Approve
                </Button>
              </>
            )}
          </Space>
        </div>
      }
    >
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Reference">{notif.trxNo}</Descriptions.Item>
        <Descriptions.Item label="Amount"><Text strong style={{ fontFamily: 'monospace' }}>{amt}</Text></Descriptions.Item>
        <Descriptions.Item label="Module"><Tag color={MODULE_COLOR[notif.approvalModule || ''] || 'default'}>{notif.approvalModule}</Tag></Descriptions.Item>
        <Descriptions.Item label="Type">{notif.approvalTransactionType || '—'}</Descriptions.Item>
        <Descriptions.Item label="Submitted by">{notif.requestedByName || '—'}</Descriptions.Item>
        <Descriptions.Item label="Date">{notif.date ? dayjs(notif.date).format('DD-MMM-YYYY') : '—'}</Descriptions.Item>
        {notif.approvalDescription && (
          <Descriptions.Item label="Description" span={2}>{notif.approvalDescription}</Descriptions.Item>
        )}
      </Descriptions>

      {notif.approvalModule === 'AP' && notif.transactionId && (
        <>
          <Divider style={{ margin: '8px 0', fontSize: 12 }}>Invoice Header</Divider>
          {apHeaderLoading
            ? <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
            : apHeader
              ? <Descriptions bordered size="small" column={2} style={{ marginBottom: 8 }}>
                  <Descriptions.Item label="Invoice #">{apHeader.invoice_number || apHeader.INVOICE_NUMBER || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Type">{apHeader.invoice_type || apHeader.INVOICE_TYPE || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Supplier">{apHeader.supplier || apHeader.SUPPLIER || apHeader.supplier_name || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Invoice Date">{(apHeader.invoice_date || apHeader.INVOICE_DATE) ? dayjs(apHeader.invoice_date || apHeader.INVOICE_DATE).format('DD-MMM-YYYY') : '—'}</Descriptions.Item>
                  <Descriptions.Item label="Business Unit">{apHeader.business_unit || apHeader.BUSINESS_UNIT || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Currency">{apHeader.invoice_currency || apHeader.INVOICE_CURRENCY || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Validation">{apHeader.validation_status || apHeader.VALIDATION_STATUS || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Approval">{apHeader.approval_status || apHeader.APPROVAL_STATUS || '—'}</Descriptions.Item>
                </Descriptions>
              : null
          }
          <Divider style={{ margin: '8px 0', fontSize: 12 }}>Invoice Lines</Divider>
          {linesLoading
            ? <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>
            : invoiceLines.length > 0
              ? <Table dataSource={invoiceLines} columns={lineColumns} rowKey="LINE_NUMBER" size="small" pagination={false} />
              : <Text type="secondary" style={{ fontSize: 12 }}>No lines found</Text>
          }
        </>
      )}

      {notif.approvalModule === 'CASH' && notif.transactionId && (
        <>
          <Divider style={{ margin: '8px 0', fontSize: 12 }}>Transaction Details</Divider>
          {cashTxnLoading
            ? <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
            : cashTxn
              ? <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="Bank Account">{cashTxn.bankAccountName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Business Unit">{cashTxn.businessUnitName || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Direction">
                    <Tag color={cashTxn.transactionDirection === 'DR' ? 'blue' : 'green'}>
                      {cashTxn.transactionDirection === 'DR' ? '▲ Money In (DR)' : '▼ Money Out (CR)'}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Type">{cashTxn.transactionType || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Reference">{cashTxn.referenceText || cashTxn.description || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Status"><Tag>{cashTxn.status || '—'}</Tag></Descriptions.Item>
                  {cashTxn.payeeName && <Descriptions.Item label="Payee">{cashTxn.payeeName}</Descriptions.Item>}
                  <Descriptions.Item label="Date">{cashTxn.transactionDate ? dayjs(cashTxn.transactionDate).format('DD-MMM-YYYY') : '—'}</Descriptions.Item>
                  {cashTxn.assetAccountCombination && (
                    <Descriptions.Item label="Asset Account" span={2}>
                      <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{cashTxn.assetAccountCombination}</Text>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              : <Text type="secondary" style={{ fontSize: 12 }}>Transaction details not available — ensure DB patch 99 is deployed</Text>
          }
        </>
      )}
    </Modal>
  );
};

// ── Main Panel ────────────────────────────────────────────────────────────────
const NotificationPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const {
    notifications, unreadCount, pendingApprovalCount,
    markRead, markAllRead, clearAll,
    refreshPdcNotifications, pdcChecking, lastApiUrl, lastApiResult,
    approvalChecking, refreshApprovalNotifications,
    approveNotification, rejectNotification,
    lastApprovalApiCall,
  } = useNotifications();

  const [activeModule, setActiveModule]       = useState<'All' | NotificationModule>('Approvals');
  const [statusFilter, setStatusFilter]       = useState<string>('All');
  const [apiModalOpen, setApiModalOpen]       = useState(false);
  const [approvalApiModalOpen, setApprovalApiModalOpen] = useState(false);
  const [detailNotif, setDetailNotif]         = useState<AppNotification | null>(null);
  const [actingId, setActingId]               = useState<string | null>(null);

  const filtered = notifications.filter(n => {
    if (activeModule !== 'All' && n.module !== activeModule) return false;
    if (statusFilter !== 'All' && n.status !== statusFilter) return false;
    return true;
  });

  const handleApprove = async (notif: AppNotification) => {
    if (!notif.approvalRequestId) return;
    setActingId(notif.id);
    try {
      await approveNotification(notif.approvalRequestId, notif.id);
      message.success(`Approved: ${notif.trxNo}`);
      setDetailNotif(null);
    } catch (e: any) {
      setApprovalApiModalOpen(true);
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (notif: AppNotification, comments?: string) => {
    if (!notif.approvalRequestId) return;
    setActingId(notif.id);
    try {
      await rejectNotification(notif.approvalRequestId, notif.id, comments);
      message.success(`Rejected: ${notif.trxNo}`);
      setDetailNotif(null);
    } catch (e: any) {
      setApprovalApiModalOpen(true);
    } finally {
      setActingId(null);
    }
  };

  // Approval-specific columns
  const approvalColumns: ColumnsType<AppNotification> = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v ? dayjs(v).format('DD-MMM-YY') : '—'}</Text>,
    },
    {
      title: 'Ref',
      dataIndex: 'trxNo',
      key: 'trxNo',
      width: 130,
      render: (v: string, record: AppNotification) => (
        <Text
          style={{ fontSize: 11, color: '#0572CE', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={e => { e.stopPropagation(); markRead(record.id); setDetailNotif(record); }}
        >
          {v || '—'}
        </Text>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'approvalDescription',
      key: 'approvalDescription',
      ellipsis: true,
      render: (v?: string) => v
        ? <Text style={{ fontSize: 11 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Module',
      dataIndex: 'approvalModule',
      key: 'approvalModule',
      width: 68,
      render: (v: string) => <Tag color={MODULE_COLOR[v] || 'default'} style={{ fontSize: 10, margin: 0 }}>{v || '—'}</Tag>,
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      render: (_: any, r: AppNotification) =>
        r.approvalAmount != null
          ? <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>
              {r.approvalCurrency} {Number(r.approvalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: 'Requested By',
      dataIndex: 'requestedByName',
      key: 'requestedBy',
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_: any, record: AppNotification) => {
        if (record.status === 'Actioned') return <Tag color="green" style={{ fontSize: 10 }}>Actioned</Tag>;
        const busy = actingId === record.id;
        return (
          <Space size={4}>
            <Tooltip title="View Details">
              <Button size="small" icon={<EyeOutlined />} onClick={() => { markRead(record.id); setDetailNotif(record); }} />
            </Tooltip>
            <Tooltip title="Approve">
              <Button size="small" type="primary" loading={busy} icon={<CheckCircleOutlined />}
                style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}
                onClick={() => handleApprove(record)} />
            </Tooltip>
            <Tooltip title="Reject">
              <Button size="small" danger loading={busy} icon={<StopOutlined />}
                onClick={() => { markRead(record.id); setDetailNotif(record); }} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  // Generic columns for non-Approval modules
  const generalColumns: ColumnsType<AppNotification> = [
    {
      title: 'Module',
      dataIndex: 'module',
      key: 'module',
      width: 72,
      render: (v: string) => <Tag color={MODULE_COLOR[v] || 'default'} style={{ fontSize: 10, margin: 0 }}>{v}</Tag>,
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{v ? dayjs(v).format('DD-MMM-YY') : '—'}</Text>,
    },
    {
      title: 'Transaction',
      dataIndex: 'transaction',
      key: 'transaction',
      width: 100,
      render: (v: string, record: AppNotification) => (
        <Space size={4}>
          {SEVERITY_ICON[record.severity || 'info']}
          <Text style={{ fontSize: 11 }}>{v}</Text>
        </Space>
      ),
    },
    {
      title: 'Trx No',
      dataIndex: 'trxNo',
      key: 'trxNo',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 11, color: '#0572CE' }}>{v || '—'}</Text>,
    },
    {
      title: 'Notification Details',
      dataIndex: 'details',
      key: 'details',
      render: (v: string, record: AppNotification) => (
        <Text style={{
          fontSize: 11,
          fontWeight: record.status === 'Unread' ? 600 : undefined,
          color: record.severity === 'error' ? '#C74634' : record.severity === 'warning' ? '#8a6000' : '#1A1A1A',
        }}>
          {v}
        </Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 76,
      render: (v: string) => <Tag color={STATUS_COLOR[v] || 'default'} style={{ fontSize: 10, margin: 0 }}>{v}</Tag>,
    },
    {
      title: '',
      key: 'action',
      width: 36,
      render: (_: any, record: AppNotification) =>
        record.status === 'Unread' ? (
          <Tooltip title="Mark as read">
            <Button type="text" size="small" icon={<CheckOutlined style={{ color: '#1D7B4D', fontSize: 12 }} />} onClick={() => markRead(record.id)} />
          </Tooltip>
        ) : null,
    },
  ];

  const isApprovalsView = activeModule === 'Approvals';
  const columns = isApprovalsView ? approvalColumns : generalColumns;
  const isLoading = pdcChecking || approvalChecking;

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <BellOutlined style={{ color: '#722ed1', fontSize: 16 }} />
            <span style={{ fontWeight: 600 }}>Notifications</span>
            {unreadCount > 0 && <Badge count={unreadCount} style={{ background: '#C74634' }} />}
            {pendingApprovalCount > 0 && (
              <Badge count={pendingApprovalCount} style={{ background: '#D4A800' }}
                title={`${pendingApprovalCount} pending approval(s)`} />
            )}
          </Space>
          <Space size={4}>
            <Tooltip title="View PDC API">
              <Button size="small" icon={<ApiOutlined style={{ color: '#722ed1' }} />} onClick={() => setApiModalOpen(true)} />
            </Tooltip>
            <Tooltip title={lastApprovalApiCall ? `Last approval API call — HTTP ${lastApprovalApiCall.status}` : 'Approval API Inspector (no call yet)'}>
              <Button
                size="small"
                icon={<ApiOutlined style={{
                  color: lastApprovalApiCall
                    ? (String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634')
                    : '#aaa',
                }} />}
                onClick={() => setApprovalApiModalOpen(true)}
              />
            </Tooltip>
            <Tooltip title="Refresh approvals">
              <Button size="small" icon={<ReloadOutlined spin={approvalChecking} />} onClick={refreshApprovalNotifications} loading={approvalChecking} />
            </Tooltip>
            <Tooltip title="Refresh PDC maturity notifications">
              <Button size="small" icon={<ReloadOutlined spin={pdcChecking} />} onClick={refreshPdcNotifications} loading={pdcChecking} />
            </Tooltip>
            <Tooltip title="Mark all read">
              <Button size="small" icon={<CheckOutlined />} onClick={markAllRead} disabled={unreadCount === 0} />
            </Tooltip>
            <Tooltip title="Clear all">
              <Button size="small" danger icon={<DeleteOutlined />} onClick={clearAll} disabled={notifications.length === 0} />
            </Tooltip>
          </Space>
        </div>
      }
      open={open}
      onClose={onClose}
      width={isApprovalsView ? 1000 : 900}
      styles={{ body: { padding: '12px 16px', background: '#F7F7F7' } }}
      closable
    >
      {/* Module filter toggles */}
      <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {MODULES.map(m => {
          const cnt = m.value === 'All'
            ? notifications.filter(n => n.status === 'Unread').length
            : notifications.filter(n => n.module === m.value && n.status === 'Unread').length;
          const active = activeModule === m.value;
          return (
            <Badge key={m.value} count={cnt} size="small" offset={[-4, 4]}>
              <Button
                size="small"
                type={active ? 'primary' : 'default'}
                onClick={() => setActiveModule(m.value)}
                style={{
                  borderRadius: 14, fontSize: 12,
                  fontWeight: active ? 600 : undefined,
                  background: active ? (m.value === 'Approvals' ? '#D4A800' : '#722ed1') : undefined,
                  borderColor: active ? (m.value === 'Approvals' ? '#D4A800' : '#722ed1') : undefined,
                }}
              >
                {m.label}
              </Button>
            </Badge>
          );
        })}
        <div style={{ marginLeft: 'auto' }}>
          <Select
            size="small"
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 110 }}
            options={[
              { value: 'All',      label: 'All Status'  },
              { value: 'Unread',   label: 'Unread'      },
              { value: 'Read',     label: 'Read'        },
              { value: 'Actioned', label: 'Actioned'    },
            ]}
          />
        </div>
      </div>

      {/* Approvals summary bar */}
      {isApprovalsView && pendingApprovalCount > 0 && (
        <div style={{
          background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6,
          padding: '8px 14px', marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <WarningOutlined style={{ color: '#D4A800' }} />
          <Text style={{ fontSize: 12, color: '#8a6000' }}>
            <strong>{pendingApprovalCount}</strong> pending approval{pendingApprovalCount !== 1 ? 's' : ''} require your attention
          </Text>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
          {isLoading
            ? <Spin tip="Checking for notifications…" />
            : <Empty
                description={isApprovalsView ? 'No pending approvals' : 'No notifications'}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
          }
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #E5E5E5', overflow: 'hidden' }}>
          <Table
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 15, size: 'small', showTotal: t => `${t} notifications` }}
            rowClassName={(r: AppNotification) => r.status === 'Unread' ? 'notif-unread-row' : ''}
            onRow={(record: AppNotification) => ({
              onClick: () => {
                if (record.status === 'Unread') markRead(record.id);
              },
              style: { cursor: 'pointer' },
            })}
          />
        </div>
      )}

      <style>{`
        .notif-unread-row td { background: #fdf4ff !important; }
        .notif-unread-row:hover td { background: #f5e6ff !important; }
      `}</style>

      {/* Transaction Detail + Approve/Reject Modal */}
      <TransactionDetailModal
        notif={detailNotif}
        open={!!detailNotif}
        onClose={() => setDetailNotif(null)}
        acting={!!actingId}
        onApprove={() => detailNotif && handleApprove(detailNotif)}
        onReject={(comments) => detailNotif && handleReject(detailNotif, comments)}
      />

      {/* PDC API Inspector Modal */}
      <Modal
        open={apiModalOpen}
        onCancel={() => setApiModalOpen(false)}
        footer={null}
        title={<Space><ApiOutlined style={{ color: '#722ed1' }} /><span>PDC Notification API Inspector</span></Space>}
        width={700}
      >
        <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
          <div style={{ marginBottom: 8, fontWeight: 600, color: '#555' }}>PDC Maturity Check — Endpoint:</div>
          <div style={{ background: '#1e1e2e', color: '#cdd6f4', padding: '10px 14px', borderRadius: 6, wordBreak: 'break-all', marginBottom: 16, userSelect: 'all' }}>
            {lastApiUrl || '(not yet called)'}
          </div>
          <div style={{ marginBottom: 8, fontWeight: 600, color: '#555' }}>Last Result:</div>
          <div style={{ background: '#f5f5f5', padding: '10px 14px', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#333', minHeight: 60 }}>
            {lastApiResult || '(no result yet)'}
          </div>
          <div style={{ marginTop: 16, color: '#888', fontSize: 11 }}>
            Click <strong>Refresh</strong> in the toolbar to re-run the checks and update these values.
          </div>
        </div>
      </Modal>

      {/* Approval API Inspector Modal */}
      <Modal
        open={approvalApiModalOpen}
        onCancel={() => setApprovalApiModalOpen(false)}
        footer={<Button onClick={() => setApprovalApiModalOpen(false)}>Close</Button>}
        title={
          <Space>
            <ApiOutlined style={{
              color: lastApprovalApiCall
                ? (String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634')
                : '#aaa',
            }} />
            <span>Approval API Inspector</span>
            {lastApprovalApiCall && (
              <Text
                style={{
                  fontSize: 12, fontWeight: 700,
                  color: String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634',
                }}
              >
                HTTP {lastApprovalApiCall.status}
              </Text>
            )}
          </Space>
        }
        width={740}
      >
        {!lastApprovalApiCall ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>
            No approval API call has been made yet in this session.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* URL */}
            <div style={{ background: '#F0F4FF', border: '1px solid #0572CE33', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0572CE', marginBottom: 4 }}>
                {lastApprovalApiCall.method} · Endpoint URL
              </div>
              <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                {lastApprovalApiCall.url}
              </Text>
            </div>

            {/* Request body */}
            <div style={{ background: '#F8F8F8', borderRadius: 6, padding: '8px 12px', border: '1px solid #ddd' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#555', marginBottom: 4 }}>
                Request Body (JSON)
              </div>
              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflow: 'auto' }}>
                {JSON.stringify(lastApprovalApiCall.body, null, 2)}
              </pre>
            </div>

            {/* Response */}
            <div style={{
              background: String(lastApprovalApiCall.status).startsWith('2') ? '#F0FFF4' : '#FFF2F0',
              border: `1px solid ${String(lastApprovalApiCall.status).startsWith('2') ? '#b7ebc8' : '#FFCCC7'}`,
              borderRadius: 6, padding: '8px 12px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634', marginBottom: 4 }}>
                Response · HTTP {lastApprovalApiCall.status}
              </div>
              <pre style={{
                margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 240, overflow: 'auto',
                color: String(lastApprovalApiCall.status).startsWith('2') ? '#1D7B4D' : '#C74634',
              }}>
                {lastApprovalApiCall.response || '(empty)'}
              </pre>
            </div>

            <div style={{ fontSize: 11, color: '#aaa' }}>
              Called at {new Date(lastApprovalApiCall.ts).toLocaleTimeString()}
            </div>
          </div>
        )}
      </Modal>
    </Drawer>
  );
};

export default NotificationPanel;
