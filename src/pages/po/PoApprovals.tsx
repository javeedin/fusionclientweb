// Purchasing-RR — procurement approvals (existing approval engine, MODULE = PROCUREMENT).
// Decisions also made from the central Approvals page flow back through the
// RR_PO_APPROVAL_DECISION_TRG trigger.
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Table, Button, Space, Segmented, Typography, Tag, message, Input, Modal } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined, AuditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { poQuery, poExec, PROC, lit, money, day, Row } from '../../services/po.service';
import { PoBar, StatusTag, usePoUser } from './poShared';

const { Text } = Typography;
const TYPE_LABEL: Record<string, string> = { REQUISITION: 'Requisition', PURCHASE_ORDER: 'Purchase order', PO_CHANGE_ORDER: 'Change order' };

const PoApprovals: React.FC = () => {
  const user = usePoUser();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('PENDING');
  const [type, setType] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const where = ['1 = 1'];
      if (status !== 'ALL') where.push(`a.STATUS = ${lit(status)}`);
      if (type !== 'ALL') where.push(`a.TRANSACTION_TYPE = ${lit(type)}`);
      setRows(await poQuery(`SELECT a.*, co.PO_HEADER_ID AS CO_PO_HEADER_ID, co.CHANGE_SUMMARY
                             FROM RR_PO_V_APPROVALS a
                             LEFT JOIN RR_PO_V_CHANGE_ORDERS co ON a.TRANSACTION_TYPE = 'PO_CHANGE_ORDER' AND co.CHANGE_ORDER_ID = a.TRANSACTION_ID
                             WHERE ${where.join(' AND ')} ORDER BY a.REQUEST_ID DESC`, 500));
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }, [status, type]);
  useEffect(() => { load(); }, [load]);

  const open = (r: Row) => {
    if (r.TRANSACTION_TYPE === 'REQUISITION') navigate(`/po/requisitions?id=${r.TRANSACTION_ID}`);
    else navigate(`/po/orders?id=${r.TRANSACTION_TYPE === 'PO_CHANGE_ORDER' ? r.CO_PO_HEADER_ID : r.TRANSACTION_ID}`);
  };

  const decide = (r: Row, decision: 'APPROVED' | 'REJECTED') => {
    let comments = '';
    Modal.confirm({
      title: `${decision === 'APPROVED' ? 'Approve' : 'Reject'} ${r.TRANSACTION_REF}?`,
      okText: decision === 'APPROVED' ? 'Approve' : 'Reject', okButtonProps: { danger: decision === 'REJECTED' },
      content: <Input.TextArea rows={3} placeholder={decision === 'REJECTED' ? 'Reason (required)' : 'Comments'} onChange={e => { comments = e.target.value; }} />,
      onOk: async () => {
        if (decision === 'REJECTED' && !comments.trim()) { message.warning('Enter the reason'); throw new Error('reason'); }
        try {
          const res = await poExec(PROC.decide, { p_request_id: r.REQUEST_ID, p_decision: decision, p_comments: comments || null }, user);
          message.success(res.message);
          load();
        } catch (e: any) { message.error(e.message, 8); throw e; }
      },
    });
  };

  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Purchasing Approvals" subtitle="Requisitions, purchase orders and change orders awaiting a decision" icon={<AuditOutlined />} />
      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented value={status} onChange={v => setStatus(String(v))} options={[
            { value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'ALL', label: 'All' }]} />
          <Segmented value={type} onChange={v => setType(String(v))} options={[
            { value: 'ALL', label: 'All types' }, { value: 'REQUISITION', label: 'Requisitions' },
            { value: 'PURCHASE_ORDER', label: 'Purchase orders' }, { value: 'PO_CHANGE_ORDER', label: 'Change orders' }]} />
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        </Space>
        <Table size="small" rowKey="REQUEST_ID" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }}
          columns={[
            { title: 'Document', dataIndex: 'TRANSACTION_REF', width: 180, render: (v, r) => <a onClick={() => open(r)}>{v}</a> },
            { title: 'Type', dataIndex: 'TRANSACTION_TYPE', width: 140, render: v => <Tag>{TYPE_LABEL[v] || v}</Tag> },
            { title: 'Description', ellipsis: true, render: (_, r) => r.CHANGE_SUMMARY || r.DESCRIPTION },
            { title: 'Amount', width: 150, align: 'right', render: (_, r) => `${money(r.AMOUNT)} ${r.CURRENCY || ''}` },
            { title: 'Requested by', dataIndex: 'REQUESTED_BY_NAME', width: 130 },
            { title: 'Requested', dataIndex: 'REQUESTED_DATE', width: 100, render: day },
            { title: 'Approver', dataIndex: 'CURRENT_APPROVER', width: 150, render: (v, r) => v || <Text type="secondary">{r.RULE_NAME}</Text> },
            { title: 'Status', dataIndex: 'STATUS', width: 110, render: v => <StatusTag s={v} /> },
            { title: '', width: 190, render: (_, r) => r.STATUS === 'PENDING' ? (
              <Space size={4}>
                <Button size="small" type="primary" icon={<CheckOutlined />} disabled={String(r.REQUESTED_BY_NAME).toUpperCase() === user.toUpperCase()}
                  onClick={() => decide(r, 'APPROVED')}>Approve</Button>
                <Button size="small" danger icon={<CloseOutlined />} onClick={() => decide(r, 'REJECTED')}>Reject</Button>
              </Space>) : null },
          ]} />
      </Card>
    </div>
  );
};

export default PoApprovals;
