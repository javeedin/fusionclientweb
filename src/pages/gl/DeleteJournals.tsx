import { buildApexUrl } from '../../config/api.helper';
import React, { useMemo, useState } from 'react';
import {
  Layout, Card, Row, Col, Input, Button, Space, Tabs, message, Modal, Divider,
  Form, InputNumber, Statistic, Typography, Alert, Empty, Table, Tag, Popconfirm, Spin,
} from 'antd';
import {
  DeleteOutlined, ClearOutlined, ExclamationCircleOutlined, CheckCircleOutlined,
  ClockCircleOutlined, BugOutlined, EyeOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const APEX_BASE = buildApexUrl('');

const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

interface DeletionResult {
  id: number | string;
  type: 'sla' | 'journal';
  status: 'pending' | 'success' | 'error';
  message?: string;
  startTime?: number;
  endTime?: number;
}

// Preview runs direct SQL through the guarded gateway (POST ai/executequery),
// the same execution path the AI assistant and Check Accounting use.
interface QR { columns: string[]; rows: (string | number | null)[][] }
interface QSection { res?: QR; err?: string }

const runSql = async (sql: string): Promise<QR> => {
  const res = await fetch(`${APEX_BASE}/ai/executequery`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sql, maxRows: 1000, appUser: 'DELETE_JOURNALS' }),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return { columns: data.columns || [], rows: data.rows || [] };
};

// row -> { COLUMN: value } record
type Rec = Record<string, string | number | null>;
const recOf = (r: QR, rowIdx: number): Rec => {
  const rec: Rec = {};
  r.columns.forEach((c, i) => { rec[c.toUpperCase()] = r.rows[rowIdx][i]; });
  return rec;
};
// first non-empty of several candidate columns (schema naming varies)
const pick = (rec: Rec | null, keys: string[]): string => {
  if (!rec) return '';
  for (const k of keys) {
    const v = rec[k];
    if (v !== null && v !== undefined && String(v) !== '') return String(v);
  }
  return '';
};
const num = (v: string | number | null | undefined): number =>
  typeof v === 'number' ? v : Number(v) || 0;
const fmtAmt = (n: number) =>
  n === 0 ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isPostedStatus = (s: string) => s === 'P' || /post/i.test(s);

const DeleteJournals: React.FC = () => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('sla');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DeletionResult[]>([]);
  const [deletionStats, setDeletionStats] = useState({
    total: 0,
    success: 0,
    failed: 0,
    duration: 0,
  });

  // ── Preview a GL batch (batch + headers + lines via direct SQL) ─────────
  const [preview, setPreview] = useState<{ batchId: number } | null>(null);
  const [prevBatch, setPrevBatch] = useState<QSection>({});
  const [prevHeaders, setPrevHeaders] = useState<QSection>({});
  const [prevLines, setPrevLines] = useState<QSection>({});
  const [prevLoading, setPrevLoading] = useState(false);
  const [prevSqls, setPrevSqls] = useState<string[]>([]);
  const [prevSqlOpen, setPrevSqlOpen] = useState(false);

  const openPreview = async (batchId: number) => {
    if (!batchId || batchId <= 0) {
      message.error('Please enter a valid GL Batch ID');
      return;
    }
    setPreview({ batchId });
    setPrevBatch({}); setPrevHeaders({}); setPrevLines({});
    setPrevSqlOpen(false);
    setPrevLoading(true);
    // batches keyed by JE_BATCH_ID; headers/lines reference it as BATCH_ID
    const sqls = [
      `SELECT * FROM rr_gl_journal_batches WHERE je_batch_id = ${batchId}`,
      `SELECT * FROM rr_gl_je_headers WHERE batch_id = ${batchId} ORDER BY je_header_id`,
      `SELECT * FROM rr_gl_je_lines_all WHERE je_header_id IN (SELECT je_header_id FROM rr_gl_je_headers WHERE batch_id = ${batchId}) ORDER BY je_header_id`,
    ];
    setPrevSqls(sqls);
    const settled = await Promise.allSettled(sqls.map(s => runSql(s)));
    const toSection = (r: PromiseSettledResult<QR>): QSection =>
      r.status === 'fulfilled' ? { res: r.value } : { err: r.reason instanceof Error ? r.reason.message : String(r.reason) };
    setPrevBatch(toSection(settled[0]));
    setPrevHeaders(toSection(settled[1]));
    setPrevLines(toSection(settled[2]));
    setPrevLoading(false);
  };

  // shaped records for the journal-document layout
  const batchRec = useMemo(
    () => (prevBatch.res?.rows.length ? recOf(prevBatch.res, 0) : null), [prevBatch]);
  const headerRecs = useMemo(
    () => (prevHeaders.res ? prevHeaders.res.rows.map((_, i) => recOf(prevHeaders.res!, i)) : []), [prevHeaders]);
  const lineRecs = useMemo(
    () => (prevLines.res ? prevLines.res.rows.map((_, i) => recOf(prevLines.res!, i)) : []), [prevLines]);
  const linesByHeader = useMemo(() => {
    const m = new Map<string, Rec[]>();
    lineRecs.forEach(l => {
      const k = String(l.JE_HEADER_ID ?? '');
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    });
    return m;
  }, [lineRecs]);
  const overallTotals = useMemo(
    () => lineRecs.reduce<{ dr: number; cr: number }>(
      (a, l) => ({ dr: a.dr + num(l.ACCOUNTED_DR), cr: a.cr + num(l.ACCOUNTED_CR) }),
      { dr: 0, cr: 0 }),
    [lineRecs]);

  const journalLineCols = [
    { title: '#', key: 'n', width: 44, align: 'center' as const,
      render: (_: unknown, l: Rec) => <Text type="secondary" style={{ fontSize: 11 }}>{pick(l, ['JE_LINE_NUMBER', 'LINE_NUM', 'LINE_ID'])}</Text> },
    { title: 'Account Combination', key: 'acct', width: 230,
      render: (_: unknown, l: Rec) => <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: REDWOOD.info }}>{pick(l, ['ACCOUNT_COMBINATION']) || '—'}</span> },
    { title: 'Description', key: 'desc', ellipsis: true,
      render: (_: unknown, l: Rec) => <span style={{ fontSize: 11.5 }}>{pick(l, ['DESCRIPTION']) || '—'}</span> },
    { title: 'Ccy', key: 'ccy', width: 52, align: 'center' as const,
      render: (_: unknown, l: Rec) => <Tag style={{ fontSize: 10, margin: 0 }}>{pick(l, ['CURRENCY_CODE']) || '—'}</Tag> },
    { title: 'Entered Dr', key: 'edr', width: 110, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(num(l.ENTERED_DR))}</span> },
    { title: 'Entered Cr', key: 'ecr', width: 110, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(num(l.ENTERED_CR))}</span> },
    { title: 'Accounted Dr', key: 'adr', width: 120, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, fontWeight: 600, color: REDWOOD.success }}>{fmtAmt(num(l.ACCOUNTED_DR))}</span> },
    { title: 'Accounted Cr', key: 'acr', width: 120, align: 'right' as const,
      render: (_: unknown, l: Rec) => <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, fontWeight: 600, color: REDWOOD.primary }}>{fmtAmt(num(l.ACCOUNTED_CR))}</span> },
    { title: 'References', key: 'refs', width: 170,
      render: (_: unknown, l: Rec) => {
        const r1 = pick(l, ['REFERENCE1']); const r2 = pick(l, ['REFERENCE2']); const r5 = pick(l, ['REFERENCE5']);
        if (!r1 && !r2 && !r5) return <span style={{ fontSize: 10.5, color: '#bbb' }}>—</span>;
        return (
          <div style={{ fontSize: 10, color: REDWOOD.neutral600, lineHeight: 1.5 }}>
            {r5 && <Tag color="purple" style={{ fontSize: 9, lineHeight: '14px', padding: '0 4px', margin: 0 }}>{r5}</Tag>}
            {(r1 || r2) && <div style={{ fontFamily: 'monospace' }}>{[r1, r2].filter(Boolean).join(' · ')}</div>}
          </div>
        );
      } },
  ];

  // ── Delete SLA Entry ────────────────────────────────────────────────────
  const handleDeleteSla = async (headerId: number) => {
    if (!headerId || headerId <= 0) {
      message.error('Please enter a valid SLA Header ID');
      return;
    }

    Modal.confirm({
      title: 'Delete SLA Entry',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Alert
            type="warning"
            message="This action will delete the SLA entry permanently"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <p>
            <strong>SLA Header ID:</strong> {headerId}
          </p>
          <p style={{ color: REDWOOD.primary, fontWeight: 500 }}>
            This cannot be undone. Are you sure?
          </p>
        </div>
      ),
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        setLoading(true);
        const startTime = Date.now();
        const result: DeletionResult = {
          id: headerId,
          type: 'sla',
          status: 'pending',
          startTime,
        };

        try {
          const deleteUrl = `${APEX_BASE}/sla/accounting/delete`;
          const response = await fetch(deleteUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ headerId }),
          });

          const data = await response.json().catch(() => ({}));

          if (response.ok && (data.success !== false)) {
            result.status = 'success';
            result.message = `SLA Header ${headerId} deleted successfully`;
            message.success(result.message);
          } else {
            result.status = 'error';
            result.message = data?.message || data?.error || `HTTP ${response.status}`;
            message.error(`Failed to delete SLA: ${result.message}`);
          }
        } catch (error: any) {
          result.status = 'error';
          result.message = error.message || 'Network error';
          message.error(`Error deleting SLA: ${result.message}`);
        } finally {
          result.endTime = Date.now();
          setResults(prev => [...prev, result]);
          setLoading(false);
          form.resetFields();
        }
      },
    });
  };

  // ── Delete GL Journal ────────────────────────────────────────────────────
  const handleDeleteJournal = async (batchId: number) => {
    if (!batchId || batchId <= 0) {
      message.error('Please enter a valid GL Batch ID');
      return;
    }

    Modal.confirm({
      title: 'Delete GL Journal',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Alert
            type="warning"
            message="This action will delete the GL journal and all associated lines permanently"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <p>
            <strong>GL Batch ID:</strong> {batchId}
          </p>
          <p style={{ color: REDWOOD.primary, fontWeight: 500 }}>
            This cannot be undone. Are you sure?
          </p>
        </div>
      ),
      okText: 'Delete',
      okType: 'danger',
      onOk: () => performDeleteJournal(batchId),
    });
  };

  // shared by the confirm above and the preview dialog's Delete button
  const performDeleteJournal = async (batchId: number): Promise<boolean> => {
    setLoading(true);
    const startTime = Date.now();
    const result: DeletionResult = {
      id: batchId,
      type: 'journal',
      status: 'pending',
      startTime,
    };
    let ok = false;

    try {
      const deleteUrl = `${APEX_BASE}/gl/journals/batches/${batchId}`;
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && (data.success !== false)) {
        ok = true;
        result.status = 'success';
        result.message = `GL Batch ${batchId} deleted successfully`;
        message.success(result.message);
      } else {
        result.status = 'error';
        result.message = data?.message || data?.error || `HTTP ${response.status}`;
        message.error(`Failed to delete GL journal: ${result.message}`);
      }
    } catch (error: any) {
      result.status = 'error';
      result.message = error.message || 'Network error';
      message.error(`Error deleting GL journal: ${result.message}`);
    } finally {
      result.endTime = Date.now();
      setResults(prev => [...prev, result]);
      setLoading(false);
      form.resetFields();
    }
    return ok;
  };

  // ── Batch Delete ────────────────────────────────────────────────────────
  const handleBatchDelete = async (type: 'sla' | 'journal', ids: string) => {
    const idList = ids
      .split(/[,\s]+/)
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !isNaN(id) && id > 0);

    if (idList.length === 0) {
      message.error('Please enter valid IDs');
      return;
    }

    Modal.confirm({
      title: `Batch Delete ${type === 'sla' ? 'SLA Entries' : 'GL Journals'}`,
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Alert
            type="error"
            message={`This will delete ${idList.length} ${type === 'sla' ? 'SLA entries' : 'GL journals'}`}
            showIcon
            style={{ marginBottom: 12 }}
          />
          <p>
            <strong>IDs to delete:</strong> {idList.join(', ')}
          </p>
          <p style={{ color: REDWOOD.primary, fontWeight: 500 }}>
            This action cannot be undone. Are you sure?
          </p>
        </div>
      ),
      okText: 'Delete All',
      okType: 'danger',
      onOk: async () => {
        setLoading(true);
        const overallStartTime = Date.now();
        let successCount = 0;
        let failCount = 0;
        const newResults: DeletionResult[] = [];

        for (const id of idList) {
          const startTime = Date.now();
          const result: DeletionResult = {
            id,
            type,
            status: 'pending',
            startTime,
          };

          try {
            if (type === 'sla') {
              const response = await fetch(`${APEX_BASE}/sla/accounting/delete`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: JSON.stringify({ headerId: id }),
              });
              const data = await response.json().catch(() => ({}));
              if (response.ok && data.success !== false) {
                result.status = 'success';
                successCount++;
              } else {
                result.status = 'error';
                result.message = data?.message || `HTTP ${response.status}`;
                failCount++;
              }
            } else {
              const response = await fetch(`${APEX_BASE}/gl/journals/batches/${id}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json' },
              });
              const data = await response.json().catch(() => ({}));
              if (response.ok && data.success !== false) {
                result.status = 'success';
                successCount++;
              } else {
                result.status = 'error';
                result.message = data?.message || `HTTP ${response.status}`;
                failCount++;
              }
            }
          } catch (error: any) {
            result.status = 'error';
            result.message = error.message;
            failCount++;
          }

          result.endTime = Date.now();
          newResults.push(result);
        }

        const duration = Date.now() - overallStartTime;
        setResults(prev => [...prev, ...newResults]);
        setDeletionStats({
          total: idList.length,
          success: successCount,
          failed: failCount,
          duration,
        });

        setLoading(false);
        form.resetFields();

        if (failCount === 0) {
          message.success(`All ${successCount} ${type === 'sla' ? 'SLA entries' : 'GL journals'} deleted successfully`);
        } else {
          message.warning(`Deleted ${successCount} of ${idList.length} items. ${failCount} failed.`);
        }
      },
    });
  };

  // ── Results Table ────────────────────────────────────────────────────────
  const resultColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (id: number) => <Text code>{id}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (type: string) => (
        <Tag color={type === 'sla' ? 'blue' : 'cyan'}>
          {type.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const colors = {
          pending: 'processing',
          success: 'success',
          error: 'error',
        };
        const icons = {
          pending: <ClockCircleOutlined />,
          success: <CheckCircleOutlined />,
          error: <BugOutlined />,
        };
        return (
          <Tag icon={icons[status as keyof typeof icons]} color={colors[status as keyof typeof colors]}>
            {status.toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      flex: 1,
      render: (msg: string) => msg ? <Text>{msg}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Duration (ms)',
      key: 'duration',
      width: 120,
      render: (_: any, record: DeletionResult) => {
        if (!record.startTime || !record.endTime) return '—';
        return <Text code>{record.endTime - record.startTime}</Text>;
      },
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: 24 }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <Space align="center" size="large">
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
              }}
            >
              <DeleteOutlined style={{ fontSize: 28, color: '#fff' }} />
            </div>
            <div>
              <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                Delete Journals
              </Title>
              <Text type="secondary">Delete SLA entries and GL journals (Test Cleanup)</Text>
            </div>
          </Space>
        </div>

        <Spin spinning={loading}>
          {/* Tabs for SLA and Journal deletion */}
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'sla',
                label: 'Delete SLA Entry',
                children: (
                  <Card
                    style={{
                      borderRadius: 12,
                      border: 'none',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}
                    bodyStyle={{ padding: 24 }}
                  >
                    <Form form={form} layout="vertical">
                      <Alert
                        type="warning"
                        icon={<ExclamationCircleOutlined />}
                        message="Warning: Deleting SLA entries is irreversible"
                        description="This will permanently delete the SLA accounting header and any related data."
                        showIcon
                        style={{ marginBottom: 24 }}
                      />

                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            label="SLA Header ID"
                            required
                            tooltip="The unique identifier of the SLA accounting header to delete"
                          >
                            <Input
                              placeholder="e.g., 845"
                              type="number"
                              onChange={(e) => {
                                const val = e.target.value;
                                form.setFieldValue('slaId', val ? parseInt(val, 10) : undefined);
                              }}
                            />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider />

                      <Space>
                        <Button
                          danger
                          type="primary"
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            const id = form.getFieldValue('slaId');
                            if (id) handleDeleteSla(id);
                          }}
                        >
                          Delete SLA Entry
                        </Button>
                        <Button onClick={() => form.resetFields()}>
                          Clear
                        </Button>
                      </Space>

                      <Divider />

                      <div style={{ marginTop: 24 }}>
                        <Title level={4}>Batch Delete SLA Entries</Title>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                          Delete multiple SLA entries at once. Enter IDs separated by commas or spaces.
                        </Text>
                        <Form.Item label="SLA Header IDs (comma-separated)" style={{ marginBottom: 16 }}>
                          <Input.TextArea
                            placeholder="e.g., 845, 846, 847 or 845 846 847"
                            rows={3}
                            onChange={(e) => form.setFieldValue('slaBatch', e.target.value)}
                          />
                        </Form.Item>
                        <Button
                          danger
                          onClick={() => {
                            const ids = form.getFieldValue('slaBatch');
                            if (ids) handleBatchDelete('sla', ids);
                          }}
                        >
                          Delete Multiple SLA Entries
                        </Button>
                      </div>
                    </Form>
                  </Card>
                ),
              },
              {
                key: 'journal',
                label: 'Delete GL Journal',
                children: (
                  <Card
                    style={{
                      borderRadius: 12,
                      border: 'none',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}
                    bodyStyle={{ padding: 24 }}
                  >
                    <Form form={form} layout="vertical">
                      <Alert
                        type="warning"
                        icon={<ExclamationCircleOutlined />}
                        message="Warning: Deleting GL journals is irreversible"
                        description="This will permanently delete the GL journal batch, header, and all associated lines."
                        showIcon
                        style={{ marginBottom: 24 }}
                      />

                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            label="GL Batch ID"
                            required
                            tooltip="The unique identifier of the GL journal batch to delete"
                          >
                            <Input
                              placeholder="e.g., 12345"
                              type="number"
                              onChange={(e) => {
                                const val = e.target.value;
                                form.setFieldValue('journalId', val ? parseInt(val, 10) : undefined);
                              }}
                            />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider />

                      <Space>
                        <Button
                          type="primary"
                          icon={<EyeOutlined />}
                          style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                          onClick={() => openPreview(form.getFieldValue('journalId'))}
                        >
                          Preview
                        </Button>
                        <Button
                          danger
                          type="primary"
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            const id = form.getFieldValue('journalId');
                            if (id) handleDeleteJournal(id);
                          }}
                        >
                          Delete GL Journal
                        </Button>
                        <Button onClick={() => form.resetFields()}>
                          Clear
                        </Button>
                      </Space>

                      <Divider />

                      <div style={{ marginTop: 24 }}>
                        <Title level={4}>Batch Delete GL Journals</Title>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                          Delete multiple GL journals at once. Enter IDs separated by commas or spaces.
                        </Text>
                        <Form.Item label="GL Batch IDs (comma-separated)" style={{ marginBottom: 16 }}>
                          <Input.TextArea
                            placeholder="e.g., 12345, 12346, 12347 or 12345 12346 12347"
                            rows={3}
                            onChange={(e) => form.setFieldValue('journalBatch', e.target.value)}
                          />
                        </Form.Item>
                        <Button
                          danger
                          onClick={() => {
                            const ids = form.getFieldValue('journalBatch');
                            if (ids) handleBatchDelete('journal', ids);
                          }}
                        >
                          Delete Multiple GL Journals
                        </Button>
                      </div>
                    </Form>
                  </Card>
                ),
              },
            ]}
          />

          {/* Statistics */}
          {deletionStats.total > 0 && (
            <Card
              style={{
                marginTop: 24,
                borderRadius: 12,
                border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
              bodyStyle={{ padding: 24 }}
            >
              <Title level={4}>Batch Deletion Statistics</Title>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={6}>
                  <Statistic title="Total" value={deletionStats.total} />
                </Col>
                <Col xs={24} sm={6}>
                  <Statistic
                    title="Successful"
                    value={deletionStats.success}
                    valueStyle={{ color: REDWOOD.success }}
                  />
                </Col>
                <Col xs={24} sm={6}>
                  <Statistic
                    title="Failed"
                    value={deletionStats.failed}
                    valueStyle={{ color: REDWOOD.primary }}
                  />
                </Col>
                <Col xs={24} sm={6}>
                  <Statistic title="Duration (ms)" value={deletionStats.duration} />
                </Col>
              </Row>
            </Card>
          )}

          {/* Results Table */}
          {results.length > 0 && (
            <Card
              style={{
                marginTop: 24,
                borderRadius: 12,
                border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
              bodyStyle={{ padding: 24 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Title level={4} style={{ margin: 0 }}>Deletion Results</Title>
                <Button
                  size="small"
                  onClick={() => {
                    setResults([]);
                    setDeletionStats({ total: 0, success: 0, failed: 0, duration: 0 });
                  }}
                >
                  Clear Results
                </Button>
              </div>
              <Table
                dataSource={results}
                columns={resultColumns}
                rowKey={(record, index) => `${record.type}-${record.id}-${index}`}
                pagination={{ pageSize: 10 }}
                size="small"
              />
            </Card>
          )}

          {/* API Documentation */}
          <Card
            style={{
              marginTop: 32,
              borderRadius: 12,
              border: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              background: REDWOOD.neutral100,
            }}
            bodyStyle={{ padding: 24 }}
          >
            <Title level={4}>API Endpoints</Title>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Card size="small" style={{ background: REDWOOD.surface }}>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>Delete SLA Entry</Text>
                  <Text code style={{ display: 'block', marginBottom: 8 }}>POST /sla/accounting/delete</Text>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    Body: {'{headerId: number}'}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    URL: {APEX_BASE}/sla/accounting/delete
                  </Text>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" style={{ background: REDWOOD.surface }}>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>Delete GL Journal</Text>
                  <Text code style={{ display: 'block', marginBottom: 8 }}>DELETE /gl/journals/batches/{'{batchId}'}</Text>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    No body required
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    URL: {APEX_BASE}/gl/journals/batches/{'{batchId}'}
                  </Text>
                </Card>
              </Col>
            </Row>
          </Card>
        </Spin>

        {/* ── Preview dialog: batch + headers + lines, delete from here ── */}
        <Modal
          open={!!preview}
          onCancel={() => setPreview(null)}
          width={1100}
          title={<span><EyeOutlined style={{ color: REDWOOD.info, marginRight: 8 }} />Preview GL Batch {preview?.batchId}</span>}
          footer={[
            <Button key="sql" icon={<BugOutlined />} onClick={() => setPrevSqlOpen(s => !s)}>
              {prevSqlOpen ? 'Hide SQL' : 'Show SQL'}
            </Button>,
            <Popconfirm
              key="del"
              title={`Permanently delete batch ${preview?.batchId} with ${prevHeaders.res?.rows.length ?? 0} header(s) and ${prevLines.res?.rows.length ?? 0} line(s)?`}
              okText="Delete"
              okType="danger"
              onConfirm={async () => {
                if (!preview) return;
                const ok = await performDeleteJournal(preview.batchId);
                if (ok) setPreview(null);
              }}
            >
              <Button
                danger
                type="primary"
                icon={<DeleteOutlined />}
                loading={loading}
                disabled={prevLoading || (!prevBatch.res?.rows.length && !prevHeaders.res?.rows.length && !prevLines.res?.rows.length)}
              >
                Delete this Batch
              </Button>
            </Popconfirm>,
            <Button key="close" onClick={() => setPreview(null)}>Close</Button>,
          ]}
        >
          {prevLoading && <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>}
          {!prevLoading && (
            <div style={{ maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
              {prevSqlOpen && prevSqls.map((s, i) => (
                <pre key={i} style={{ margin: '4px 0', padding: 8, background: '#F7F5F3', border: '1px solid #EFEBE9', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s}</pre>
              ))}

              {(prevBatch.err || prevHeaders.err || prevLines.err) && (
                <Alert type="error" showIcon style={{ marginBottom: 10 }}
                  message="Some data could not be loaded"
                  description={[prevBatch.err, prevHeaders.err, prevLines.err].filter(Boolean).join(' · ')} />
              )}

              {/* ── Batch banner ── */}
              <div style={{
                background: `linear-gradient(135deg, ${REDWOOD.primary}, ${REDWOOD.primaryDark})`,
                borderRadius: 10, padding: '14px 18px', color: '#fff', marginBottom: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>
                    {pick(batchRec, ['NAME', 'BATCH_NAME']) || `Batch ${preview?.batchId ?? ''}`}
                  </span>
                  <Tag style={{ background: 'rgba(255,255,255,.18)', color: '#fff', border: 'none', fontFamily: 'monospace' }}>
                    ID {preview?.batchId}
                  </Tag>
                  {pick(batchRec, ['STATUS']) && (
                    <Tag color={isPostedStatus(pick(batchRec, ['STATUS'])) ? 'green' : 'gold'} style={{ fontWeight: 600 }}>
                      {pick(batchRec, ['STATUS'])}
                    </Tag>
                  )}
                  {pick(batchRec, ['PERIOD_NAME', 'DEFAULT_PERIOD_NAME']) && (
                    <Tag color="geekblue">{pick(batchRec, ['PERIOD_NAME', 'DEFAULT_PERIOD_NAME'])}</Tag>
                  )}
                  {pick(batchRec, ['ACTUAL_FLAG']) === 'A' && <Tag color="cyan">Actual</Tag>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, opacity: .85 }}>
                    {pick(batchRec, ['CREATED_BY']) && <>by {pick(batchRec, ['CREATED_BY'])}</>}
                    {pick(batchRec, ['CREATION_DATE']) && <> · {pick(batchRec, ['CREATION_DATE'])}</>}
                  </span>
                </div>
                {pick(batchRec, ['DESCRIPTION']) && (
                  <div style={{ fontSize: 12, opacity: .9, marginTop: 6 }}>{pick(batchRec, ['DESCRIPTION'])}</div>
                )}
                <div style={{ display: 'flex', gap: 24, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12 }}>Journals <b style={{ fontSize: 15 }}>{headerRecs.length}</b></span>
                  <span style={{ fontSize: 12 }}>Lines <b style={{ fontSize: 15 }}>{lineRecs.length}</b></span>
                  <span style={{ fontSize: 12 }}>Total Dr <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{overallTotals.dr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b></span>
                  <span style={{ fontSize: 12 }}>Total Cr <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{overallTotals.cr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</b></span>
                  {Math.abs(overallTotals.dr - overallTotals.cr) < 0.01
                    ? <Tag color="green" style={{ fontWeight: 700 }}><CheckCircleOutlined /> Balanced</Tag>
                    : <Tag color="red" style={{ fontWeight: 700 }}>Out of balance Δ {(overallTotals.dr - overallTotals.cr).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Tag>}
                </div>
              </div>

              {!batchRec && prevBatch.res && (
                <Alert type="warning" showIcon style={{ marginBottom: 10 }}
                  message="No batch row found for this id in RR_GL_JE_BATCHES (headers/lines shown below if any)" />
              )}

              {/* ── One card per journal header, with its lines ── */}
              {headerRecs.length === 0 && prevHeaders.res && (
                <Alert type="warning" showIcon message="No journal headers for this batch" />
              )}
              {headerRecs.map((h, hi) => {
                const hid = String(h.JE_HEADER_ID ?? '');
                const hLines = linesByHeader.get(hid) ?? [];
                const dr = hLines.reduce((s, l) => s + num(l.ACCOUNTED_DR), 0);
                const cr = hLines.reduce((s, l) => s + num(l.ACCOUNTED_CR), 0);
                const status = pick(h, ['POSTING_STATUS', 'STATUS']);
                return (
                  <Card
                    key={hid || hi}
                    size="small"
                    style={{ marginBottom: 12, borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}` }}
                    title={
                      <Space wrap size={6}>
                        <Text strong style={{ fontSize: 13 }}>
                          {pick(h, ['JOURNAL_NAME', 'NAME']) || `Journal ${hid}`}
                        </Text>
                        <Tag style={{ fontFamily: 'monospace', fontSize: 10 }}>HDR {hid}</Tag>
                        {status && (
                          <Tag color={isPostedStatus(status) ? 'green' : 'gold'} style={{ fontSize: 10 }}>
                            {isPostedStatus(status) ? 'Posted' : status}
                          </Tag>
                        )}
                        {pick(h, ['PERIOD_NAME']) && <Tag color="geekblue" style={{ fontSize: 10 }}>{pick(h, ['PERIOD_NAME'])}</Tag>}
                        {pick(h, ['LEDGER_NAME']) && <Tag color="purple" style={{ fontSize: 10 }}>{pick(h, ['LEDGER_NAME'])}</Tag>}
                        {pick(h, ['CURRENCY_CODE', 'LEDGER_CURRENCY_CODE']) && (
                          <Tag style={{ fontSize: 10 }}>{pick(h, ['CURRENCY_CODE', 'LEDGER_CURRENCY_CODE'])}</Tag>
                        )}
                        {pick(h, ['USER_JE_CATEGORY_NAME']) && (
                          <Tag color="cyan" style={{ fontSize: 10 }}>{pick(h, ['USER_JE_CATEGORY_NAME'])}</Tag>
                        )}
                      </Space>
                    }
                    extra={
                      Math.abs(dr - cr) < 0.01
                        ? <Tag color="green" style={{ fontWeight: 600 }}>Dr = Cr</Tag>
                        : <Tag color="red" style={{ fontWeight: 600 }}>Δ {(dr - cr).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Tag>
                    }
                  >
                    {pick(h, ['JOURNAL_DESCRIPTION', 'DESCRIPTION']) && (
                      <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6 }}>
                        {pick(h, ['JOURNAL_DESCRIPTION', 'DESCRIPTION'])}
                      </Text>
                    )}
                    <Table
                      size="small"
                      dataSource={hLines}
                      columns={journalLineCols}
                      rowKey={(_, i) => `${hid}-${i}`}
                      pagination={hLines.length > 12 ? { pageSize: 12, size: 'small' } : false}
                      scroll={{ x: 1050 }}
                      summary={() => (
                        <Table.Summary fixed>
                          <Table.Summary.Row style={{ background: '#FBF4F2', fontWeight: 700 }}>
                            <Table.Summary.Cell index={0} colSpan={4} align="right">
                              <Text strong style={{ fontSize: 11.5 }}>TOTAL ({hLines.length} lines)</Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right">
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(hLines.reduce((s, l) => s + num(l.ENTERED_DR), 0))}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={5} align="right">
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5 }}>{fmtAmt(hLines.reduce((s, l) => s + num(l.ENTERED_CR), 0))}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={6} align="right">
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: REDWOOD.success }}>{fmtAmt(dr)}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right">
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: REDWOOD.primary }}>{fmtAmt(cr)}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={8} />
                          </Table.Summary.Row>
                        </Table.Summary>
                      )}
                    />
                  </Card>
                );
              })}

              {/* lines whose header row is missing (orphans) still show */}
              {(() => {
                const known = new Set(headerRecs.map(h => String(h.JE_HEADER_ID ?? '')));
                const orphans = lineRecs.filter(l => !known.has(String(l.JE_HEADER_ID ?? '')));
                if (!orphans.length) return null;
                return (
                  <Card size="small" title={<Text strong style={{ fontSize: 12.5, color: REDWOOD.warning }}>Lines without a header row ({orphans.length})</Text>}
                    style={{ marginBottom: 12, borderRadius: 10, borderColor: REDWOOD.warning }}>
                    <Table size="small" dataSource={orphans} columns={journalLineCols}
                      rowKey={(_, i) => `o${i}`} pagination={{ pageSize: 10, size: 'small' }} scroll={{ x: 1050 }} />
                  </Card>
                );
              })()}
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  );
};

export default DeleteJournals;
