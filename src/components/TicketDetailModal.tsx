import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, Form, Input, Select, Button, Space, Tag, Divider,
  Alert, Empty, Typography, message,
} from 'antd';
import {
  BugOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, PaperClipOutlined, MessageOutlined,
  CloseCircleOutlined, ReloadOutlined, UserOutlined, SwapOutlined,
  ZoomInOutlined, CloseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const APEX_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp';

const REDWOOD_SUCCESS = '#1D7B4D';

// ── Exported types ─────────────────────────────────────────────
export interface Ticket {
  ticketId:       number;
  ticketNumber:   string;
  title:          string;
  module:         string;
  pageName:       string;
  pageUrl:        string;
  feature:        string;
  priority:       string;
  status:         string;
  assignedTo:     string;
  createdBy:      string;
  creationDate:   string;
  lastUpdateDate: string;
  resolvedBy:     string;
  resolutionDate: string;
  lineCount:      number;
  attachCount:    number;
  unreadReplies?: number;
}

export interface TicketLine {
  lineId:       number;
  lineNumber:   number;
  lineType:     string;
  description:  string;
  createdBy:    string;
  creationDate: string;
}

export interface TicketAttachment {
  attachmentId: number;
  fileName:     string;
  fileType:     string;
  fileSize:     number;
  createdBy:    string;
  creationDate: string;
  data:         string;
}

export interface TicketDetail {
  ticket:      Ticket & { description: string; resolutionNotes: string };
  lines:       TicketLine[];
  attachments: TicketAttachment[];
}

// ── Exported helpers ───────────────────────────────────────────
export const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'default', MEDIUM: 'blue', HIGH: 'orange', CRITICAL: 'red',
};

export const STATUS_COLOR: Record<string, string> = {
  OPEN: 'processing', IN_PROGRESS: 'warning', RESOLVED: 'success', CLOSED: 'default',
};

export const STATUS_ICON: Record<string, React.ReactNode> = {
  OPEN:        <ExclamationCircleOutlined />,
  IN_PROGRESS: <ClockCircleOutlined />,
  RESOLVED:    <CheckCircleOutlined />,
  CLOSED:      <CloseCircleOutlined />,
};

export const fmtDate = (d?: string) =>
  d ? dayjs(d).format('D-MMM-YYYY HH:mm') : '—';

export const fmtSize = (b: number) =>
  b < 1024 ? `${b} B`
  : b < 1048576 ? `${(b / 1024).toFixed(1)} KB`
  : `${(b / 1048576).toFixed(1)} MB`;

// ── Component ──────────────────────────────────────────────────
const TicketDetailModal: React.FC<{
  ticketId:    number | null;
  currentUser?: string;
  onClose:     () => void;
  onRefresh:   () => void;
}> = ({ ticketId, currentUser = 'ERP_USER', onClose, onRefresh }) => {
  const [detail, setDetail]         = useState<TicketDetail | null>(null);
  const [loading, setLoading]       = useState(false);
  const [action, setAction]         = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [actionForm]                = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!ticketId) { setDetail(null); return; }
    setLoading(true);
    fetch(`${APEX_BASE}/support/tickets/${ticketId}`)
      .then(r => r.json())
      .then(d => setDetail(d.status === 'success' ? d : null))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [ticketId]);

  const cancelAction = () => { setAction(null); actionForm.resetFields(); };

  const doAction = async (act: string) => {
    let vals: Record<string, string> = {};
    if (['comment', 'resolve', 'assign', 'status'].includes(act)) {
      try { vals = await actionForm.validateFields(); } catch { return; }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${APEX_BASE}/support/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId:        ticketId,
          action:          act,
          updatedBy:       currentUser,
          comment:         vals.comment,
          resolutionNotes: vals.resolutionNotes,
          assignedTo:      vals.assignedTo,
          status:          vals.status,
        }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        message.error(`Server error (HTTP ${res.status}) — check the ORDS package status on the DB.`);
        return;
      }
      if (data.status === 'success') {
        const msgs: Record<string, string> = {
          comment: 'Comment added',
          resolve: 'Ticket resolved',
          close:   'Ticket closed',
          reopen:  'Ticket reopened',
          assign:  'Ticket assigned',
          status:  'Status updated',
        };
        message.success(msgs[act] || 'Updated');
        cancelAction();
        const r2 = await fetch(`${APEX_BASE}/support/tickets/${ticketId}`);
        const d2 = await r2.json();
        if (d2.status === 'success') setDetail(d2);
        onRefresh();
      } else {
        message.error(data.message || 'Update failed');
      }
    } catch (e: any) {
      message.error('Network error: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const t = detail?.ticket;

  return (
    <>
    {/* ── Full-screen image zoom overlay ── */}
    {previewSrc && (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.88)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'zoom-out',
        }}
        onClick={() => setPreviewSrc(null)}
      >
        <img
          src={previewSrc}
          alt="Preview"
          style={{ maxWidth: '95vw', maxHeight: '92vh', borderRadius: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
          onClick={e => e.stopPropagation()}
        />
        <Button
          icon={<CloseOutlined />}
          shape="circle"
          style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 16 }}
          onClick={() => setPreviewSrc(null)}
        />
      </div>
    )}
    <Modal
      open={!!ticketId}
      onCancel={onClose}
      width={860}
      footer={null}
      title={
        t ? (
          <Space>
            <BugOutlined style={{ color: '#cf1322' }} />
            <Text strong>{t.ticketNumber}</Text>
            <Tag color={STATUS_COLOR[t.status]}>{t.status.replace('_', ' ')}</Tag>
            <Tag color={PRIORITY_COLOR[t.priority]}>{t.priority}</Tag>
          </Space>
        ) : 'Ticket Details'
      }
    >
      {loading && <div style={{ textAlign: 'center', padding: 32 }}>Loading…</div>}
      {!loading && t && (
        <div>
          {/* Header info */}
          <Title level={5} style={{ margin: '0 0 4px' }}>{t.title}</Title>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            {([
              ['Module', t.module], ['Page', t.pageName], ['Feature', t.feature],
              ['Assigned To', t.assignedTo], ['Created By', t.createdBy],
              ['Date', fmtDate(t.creationDate)],
            ] as [string, string][]).map(([k, v]) => v ? (
              <Text key={k} style={{ fontSize: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{k}: </Text>{v}
              </Text>
            ) : null)}
          </div>

          {t.description && (
            <Alert
              type="info" showIcon={false}
              message={<Text style={{ fontSize: 13 }}>{t.description}</Text>}
              style={{ marginBottom: 12 }}
            />
          )}
          {t.pageUrl && (
            <Text code style={{ fontSize: 11, display: 'block', marginBottom: 12 }}>{t.pageUrl}</Text>
          )}

          {/* Activity timeline */}
          <Divider style={{ margin: '8px 0 12px' }} />
          <Text strong style={{ fontSize: 13 }}>Issues & Activity</Text>
          <div style={{ margin: '10px 0', maxHeight: 300, overflowY: 'auto' }}>
            {(detail?.lines ?? []).map(l => (
              <div key={l.lineId} style={{
                padding: '8px 12px', marginBottom: 6, borderRadius: 6,
                background: l.lineType === 'RESOLUTION' ? '#f6ffed'
                           : l.lineType === 'COMMENT'   ? '#f0f5ff'
                           : '#fafafa',
                border: `1px solid ${
                  l.lineType === 'RESOLUTION' ? '#b7eb8f'
                  : l.lineType === 'COMMENT'  ? '#adc6ff'
                  : '#f0f0f0'
                }`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Tag
                    color={l.lineType === 'RESOLUTION' ? 'success' : l.lineType === 'COMMENT' ? 'blue' : 'default'}
                    style={{ fontSize: 11 }}
                  >
                    {l.lineType}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {l.createdBy} · {fmtDate(l.creationDate)}
                  </Text>
                </div>
                <Text style={{ fontSize: 13 }}>{l.description}</Text>
              </div>
            ))}
            {!(detail?.lines?.length) && (
              <Empty description="No activity yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>

          {/* Attachments */}
          {(detail?.attachments?.length ?? 0) > 0 && (
            <>
              <Divider style={{ margin: '8px 0 12px' }} />
              <Text strong style={{ fontSize: 13 }}>
                Attachments <Tag color="blue">{detail!.attachments.length}</Tag>
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {detail!.attachments.map(a => (
                  <div key={a.attachmentId} style={{
                    border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden',
                    width: a.fileType?.startsWith('image/') ? 120 : 'auto',
                  }}>
                    {a.fileType?.startsWith('image/') && a.data ? (
                      <div
                        style={{ position: 'relative', cursor: 'zoom-in' }}
                        onClick={() => setPreviewSrc(`data:${a.fileType};base64,${a.data}`)}
                        title="Click to zoom"
                      >
                        <img
                          src={`data:${a.fileType};base64,${a.data}`}
                          alt={a.fileName}
                          style={{ width: 140, height: 90, objectFit: 'cover', display: 'block', borderRadius: 4 }}
                        />
                        <div style={{
                          position: 'absolute', inset: 0, borderRadius: 4,
                          background: 'rgba(0,0,0,0)', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          transition: 'background 0.15s',
                        }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.35)'; const icon = (e.currentTarget as HTMLDivElement).querySelector('span') as HTMLElement; if (icon) icon.style.opacity = '1'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0)'; const icon = (e.currentTarget as HTMLDivElement).querySelector('span') as HTMLElement; if (icon) icon.style.opacity = '0'; }}
                        >
                          <ZoomInOutlined style={{ color: '#fff', fontSize: 22, opacity: 0, transition: 'opacity 0.15s' }} />
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <PaperClipOutlined />
                        <div>
                          <Text style={{ fontSize: 12, display: 'block' }}>{a.fileName}</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>{fmtSize(a.fileSize)}</Text>
                        </div>
                      </div>
                    )}
                    <div style={{ padding: '2px 6px', background: '#fafafa' }}>
                      <Text type="secondary" style={{ fontSize: 10 }}>{a.fileName}</Text>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Resolution notes */}
          {t.resolutionNotes && (
            <>
              <Divider style={{ margin: '8px 0 12px' }} />
              <Alert
                type="success" showIcon icon={<CheckCircleOutlined />}
                message={<Text strong>Resolution</Text>}
                description={t.resolutionNotes}
              />
              {t.resolvedBy && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Resolved by {t.resolvedBy} on {fmtDate(t.resolutionDate)}
                </Text>
              )}
            </>
          )}

          {/* Action forms */}
          <Divider style={{ margin: '12px 0 8px' }} />
          {action && (
            <div style={{ marginBottom: 12, padding: '12px 16px', background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}>
              {action === 'comment' && (
                <Form form={actionForm} layout="vertical" size="small">
                  <Form.Item name="comment" label="Comment" rules={[{ required: true, message: 'Please enter a comment' }]} style={{ marginBottom: 8 }}>
                    <TextArea rows={3} placeholder="Add a comment…" />
                  </Form.Item>
                  <Space>
                    <Button type="primary" size="small" loading={submitting} onClick={() => doAction('comment')}>
                      Add Comment
                    </Button>
                    <Button size="small" onClick={cancelAction}>Cancel</Button>
                  </Space>
                </Form>
              )}
              {action === 'resolve' && (
                <Form form={actionForm} layout="vertical" size="small">
                  <Form.Item name="resolutionNotes" label="Resolution Notes" rules={[{ required: true, message: 'Please enter resolution notes' }]} style={{ marginBottom: 8 }}>
                    <TextArea rows={3} placeholder="Describe how the issue was resolved…" />
                  </Form.Item>
                  <Space>
                    <Button type="primary" size="small" loading={submitting}
                      style={{ background: REDWOOD_SUCCESS, borderColor: REDWOOD_SUCCESS }}
                      onClick={() => doAction('resolve')}>
                      Mark Resolved
                    </Button>
                    <Button size="small" onClick={cancelAction}>Cancel</Button>
                  </Space>
                </Form>
              )}
              {action === 'assign' && (
                <Form form={actionForm} layout="vertical" size="small">
                  <Form.Item name="assignedTo" label="Assign To" rules={[{ required: true, message: 'Please enter assignee username' }]} style={{ marginBottom: 8 }}>
                    <Input placeholder="Enter username to assign…" prefix={<UserOutlined />} />
                  </Form.Item>
                  <Space>
                    <Button type="primary" size="small" loading={submitting} onClick={() => doAction('assign')}>
                      Assign
                    </Button>
                    <Button size="small" onClick={cancelAction}>Cancel</Button>
                  </Space>
                </Form>
              )}
              {action === 'status' && (
                <Form form={actionForm} layout="vertical" size="small">
                  <Form.Item name="status" label="Change Status To" rules={[{ required: true, message: 'Please select a status' }]} style={{ marginBottom: 8 }}>
                    <Select placeholder="Select new status" style={{ width: 200 }}>
                      <Option value="OPEN">Open</Option>
                      <Option value="IN_PROGRESS">In Progress</Option>
                      <Option value="RESOLVED">Resolved</Option>
                      <Option value="CLOSED">Closed</Option>
                    </Select>
                  </Form.Item>
                  <Space>
                    <Button type="primary" size="small" loading={submitting} onClick={() => doAction('status')}>
                      Update Status
                    </Button>
                    <Button size="small" onClick={cancelAction}>Cancel</Button>
                  </Space>
                </Form>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Space wrap size={6}>
              <Button size="small" icon={<MessageOutlined />}
                type={action === 'comment' ? 'primary' : 'default'}
                onClick={() => setAction(action === 'comment' ? null : 'comment')}>
                Comment
              </Button>
              <Button size="small" icon={<UserOutlined />}
                type={action === 'assign' ? 'primary' : 'default'}
                onClick={() => setAction(action === 'assign' ? null : 'assign')}>
                Assign
              </Button>
              <Button size="small" icon={<SwapOutlined />}
                type={action === 'status' ? 'primary' : 'default'}
                onClick={() => setAction(action === 'status' ? null : 'status')}>
                Change Status
              </Button>
              {t.status !== 'RESOLVED' && t.status !== 'CLOSED' && (
                <Button size="small" icon={<CheckCircleOutlined />}
                  type={action === 'resolve' ? 'primary' : 'default'}
                  style={action !== 'resolve' ? { color: REDWOOD_SUCCESS, borderColor: REDWOOD_SUCCESS } : {}}
                  onClick={() => setAction(action === 'resolve' ? null : 'resolve')}>
                  Resolve
                </Button>
              )}
              {t.status === 'RESOLVED' && (
                <Button size="small" icon={<CloseCircleOutlined />} loading={submitting} onClick={() => doAction('close')}>
                  Close
                </Button>
              )}
              {(t.status === 'RESOLVED' || t.status === 'CLOSED') && (
                <Button size="small" icon={<ReloadOutlined />} loading={submitting} onClick={() => doAction('reopen')}>
                  Reopen
                </Button>
              )}
            </Space>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
    </>
  );
};

export default TicketDetailModal;
