import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout, Card, Button, Typography, Table, Tag, Space, Input,
  Breadcrumb, Tooltip, Progress, Badge, Divider, Alert, Row, Col,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, SyncOutlined, CheckCircleOutlined,
  LoadingOutlined, WarningOutlined, ApiOutlined, CloseOutlined,
  FileTextOutlined, PlayCircleOutlined, StopOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import FloatingMenu from '../../components/FloatingMenu';
import {
  fetchCustomersFromApex,
  syncCustomerCMApplications,
  syncAllCustomersCMApplications,
  type CustomerRecord,
  type ARCMApplicationsSyncProgress,
} from '../../services/ar-cm-applications-sync.service';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  surface:    '#FFFFFF',
  border:     '#E5E5E5',
  error:      '#cf1322',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerRowState {
  status:    'idle' | 'running' | 'done' | 'error';
  inserted:  number;
  updated:   number;
  errors:    number;
  total:     number;
  lastSync:  string | null;
}

interface LogEntry {
  id:      number;
  type:    'info' | 'success' | 'error' | 'warning' | 'step';
  message: string;
  ts:      string;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SyncCMApplications: React.FC = () => {
  const [customers, setCustomers]     = useState<CustomerRecord[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [filter, setFilter]           = useState('');
  const [rowState, setRowState]       = useState<Record<string, CustomerRowState>>({});
  const [logs, setLogs]               = useState<LogEntry[]>([]);
  const [logIdSeq, setLogIdSeq]       = useState(0);
  const [syncingAll, setSyncingAll]   = useState(false);
  const [syncingOne, setSyncingOne]   = useState<string | null>(null);
  const logEndRef                     = useRef<HTMLDivElement>(null);
  const abortRef                      = useRef<AbortController | null>(null);

  // ── Load customers ────────────────────────────────────────────────────────
  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const raw = await fetchCustomersFromApex();
      const items: CustomerRecord[] = raw.map(c => ({
        cust_account_id: String(c.cust_account_id ?? ''),
        account_number:  String(c.account_number  ?? ''),
        account_name:    String(c.account_name    ?? ''),
      }));
      setCustomers(items);
    } catch (e: any) {
      addLog('error', `Failed to load customers: ${e.message}`);
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Log helper ────────────────────────────────────────────────────────────
  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogIdSeq(prev => {
      const id = prev + 1;
      setLogs(l => [...l.slice(-300), { id, type, message, ts }]);
      return id;
    });
  }, []);

  const clearLogs = () => setLogs([]);

  // ── Update a single customer's row state ──────────────────────────────────
  const updateRow = (custId: string, patch: Partial<CustomerRowState>) => {
    setRowState(prev => ({
      ...prev,
      [custId]: { ...{ status: 'idle', inserted: 0, updated: 0, errors: 0, total: 0, lastSync: null }, ...prev[custId], ...patch },
    }));
  };

  // ── Sync a single customer ────────────────────────────────────────────────
  const handleSyncOne = async (customer: CustomerRecord) => {
    const id = customer.cust_account_id;
    if (syncingAll || syncingOne) return;

    abortRef.current = new AbortController();
    setSyncingOne(id);
    updateRow(id, { status: 'running', inserted: 0, updated: 0, errors: 0, total: 0 });

    addLog('step', `═══ Syncing ${customer.account_name} (${customer.cust_account_id}) ═══`);

    const r = await syncCustomerCMApplications(
      customer,
      addLog,
      (p: Partial<ARCMApplicationsSyncProgress>) => {
        updateRow(id, {
          inserted: p.insertedApplications ?? rowState[id]?.inserted ?? 0,
          updated:  p.updatedApplications  ?? rowState[id]?.updated  ?? 0,
          errors:   p.errors               ?? rowState[id]?.errors   ?? 0,
          total:    p.totalApplications    ?? rowState[id]?.total    ?? 0,
        });
      },
      abortRef.current.signal
    );

    updateRow(id, {
      status:   r.status === 'completed' ? 'done' : r.status === 'error' ? 'error' : 'idle',
      inserted: r.insertedApplications,
      updated:  r.updatedApplications,
      errors:   r.errors,
      total:    r.totalApplications,
      lastSync: new Date().toLocaleTimeString(),
    });

    addLog(r.errors > 0 ? 'warning' : 'success',
      `Done — ${r.totalApplications} apps | +${r.insertedApplications} inserted | ↻${r.updatedApplications} updated | ${r.errors} errors`
    );
    setSyncingOne(null);
  };

  // ── Sync all customers ────────────────────────────────────────────────────
  const handleSyncAll = async () => {
    if (syncingAll || syncingOne) return;
    abortRef.current = new AbortController();
    setSyncingAll(true);

    // Reset all rows
    setRowState({});
    addLog('step', `═══════ SYNC ALL CUSTOMERS — ${customers.length} total ═══════`);

    for (let i = 0; i < customers.length; i++) {
      if (abortRef.current.signal.aborted) break;
      const cust = customers[i];
      const id   = cust.cust_account_id;

      updateRow(id, { status: 'running', inserted: 0, updated: 0, errors: 0, total: 0 });
      addLog('step', `[${i + 1}/${customers.length}] ${cust.account_name}`);

      const r = await syncCustomerCMApplications(
        cust, addLog,
        (p: Partial<ARCMApplicationsSyncProgress>) => {
          updateRow(id, {
            inserted: p.insertedApplications ?? 0,
            updated:  p.updatedApplications  ?? 0,
            errors:   p.errors               ?? 0,
            total:    p.totalApplications    ?? 0,
          });
        },
        abortRef.current.signal
      );

      updateRow(id, {
        status:   r.status === 'completed' ? 'done' : r.status === 'error' ? 'error' : 'idle',
        inserted: r.insertedApplications,
        updated:  r.updatedApplications,
        errors:   r.errors,
        total:    r.totalApplications,
        lastSync: new Date().toLocaleTimeString(),
      });
    }

    addLog('success', '══════════ SYNC ALL COMPLETE ══════════');
    setSyncingAll(false);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setSyncingAll(false);
    setSyncingOne(null);
    addLog('warning', 'Sync stopped by user');
  };

  // ── Filtered customers ────────────────────────────────────────────────────
  const q = filter.trim().toUpperCase();
  const filtered = q
    ? customers.filter(c =>
        (c.account_name   || '').toUpperCase().includes(q) ||
        (c.account_number || '').toUpperCase().includes(q) ||
        (c.cust_account_id || '').includes(filter.trim())
      )
    : customers;

  // ── Summary counts ────────────────────────────────────────────────────────
  const doneCount    = Object.values(rowState).filter(r => r.status === 'done').length;
  const totalInserted = Object.values(rowState).reduce((s, r) => s + (r.inserted ?? 0), 0);
  const totalUpdated  = Object.values(rowState).reduce((s, r) => s + (r.updated  ?? 0), 0);
  const totalErrors   = Object.values(rowState).reduce((s, r) => s + (r.errors   ?? 0), 0);

  // ── Columns ───────────────────────────────────────────────────────────────
  const columns: ColumnsType<CustomerRecord> = [
    { title: '#', key: 'seq', width: 50,
      render: (_,__,i) => <Text type="secondary" style={{ fontSize: 12 }}>{i + 1}</Text> },
    { title: 'Account #', dataIndex: 'account_number', width: 110,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>{v}</Text> },
    { title: 'Customer Name', dataIndex: 'account_name',
      render: v => <Text style={{ fontSize: 13 }}>{v}</Text> },
    { title: 'Cust Account ID', dataIndex: 'cust_account_id', width: 140,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{v}</Text> },
    {
      title: 'Status', key: 'status', width: 110,
      render: (_, r) => {
        const s = rowState[r.cust_account_id];
        if (!s || s.status === 'idle') return <Tag style={{ fontSize: 11 }}>Idle</Tag>;
        if (s.status === 'running')    return <Tag color="blue" icon={<LoadingOutlined spin />} style={{ fontSize: 11 }}>Running</Tag>;
        if (s.status === 'error')      return <Tag color="red"  icon={<WarningOutlined />}      style={{ fontSize: 11 }}>Error</Tag>;
        return <Tag color="green" icon={<CheckCircleOutlined />} style={{ fontSize: 11 }}>Done</Tag>;
      },
    },
    {
      title: 'Synced', key: 'synced', width: 160, align: 'right',
      render: (_, r) => {
        const s = rowState[r.cust_account_id];
        if (!s || s.status === 'idle') return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        return (
          <Space size={4}>
            <Text style={{ fontSize: 12, color: REDWOOD.success, fontWeight: 600 }}>+{s.inserted}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>/</Text>
            <Text style={{ fontSize: 12, color: REDWOOD.info }}>↻{s.updated}</Text>
            {s.errors > 0 && (
              <>
                <Text type="secondary" style={{ fontSize: 11 }}>/</Text>
                <Text style={{ fontSize: 12, color: REDWOOD.error }}>✕{s.errors}</Text>
              </>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Total Apps', key: 'total', width: 100, align: 'right',
      render: (_, r) => {
        const s = rowState[r.cust_account_id];
        if (!s || !s.total) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        return <Text style={{ fontSize: 12, fontWeight: 600 }}>{s.total}</Text>;
      },
    },
    {
      title: 'Last Sync', key: 'lastSync', width: 90,
      render: (_, r) => {
        const s = rowState[r.cust_account_id];
        return s?.lastSync
          ? <Text type="secondary" style={{ fontSize: 11 }}>{s.lastSync}</Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
      },
    },
    {
      title: '', key: 'action', width: 90, fixed: 'right',
      render: (_, r) => {
        const isRunning = syncingOne === r.cust_account_id || syncingAll;
        return (
          <Tooltip title={isRunning ? 'Running…' : 'Sync this customer'}>
            <Button
              size="small"
              type="primary"
              icon={syncingOne === r.cust_account_id ? <LoadingOutlined /> : <SyncOutlined />}
              disabled={isRunning}
              loading={syncingOne === r.cust_account_id}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info, fontSize: 12 }}
              onClick={() => handleSyncOne(r)}
            >
              Sync
            </Button>
          </Tooltip>
        );
      },
    },
  ];

  // ── Log color map ─────────────────────────────────────────────────────────
  const logColor: Record<LogEntry['type'], string> = {
    info:    '#cdd9e5',
    success: '#56d364',
    error:   '#ff7b72',
    warning: '#d29922',
    step:    '#79c0ff',
  };

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /> Home</Link> },
            { title: <Link to="/ar">Accounts Receivable</Link> },
            { title: 'Sync CM Applications' },
          ]} />
        </div>

        <div style={{ padding: 16 }}>
          {/* Page header */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${REDWOOD.info} 0%, #0e8ce4 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${REDWOOD.info}40`,
            }}>
              <SyncOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>Sync Credit Memo Applications</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Fetches Oracle Fusion <code>creditMemoApplications</code> per customer → posts to APEX
              </Text>
            </div>
          </div>

          {/* Summary KPI row */}
          {(doneCount > 0 || syncingAll) && (
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Customers Done</Text>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{doneCount} / {customers.length}</div>
                  <Progress
                    percent={customers.length > 0 ? Math.round((doneCount / customers.length) * 100) : 0}
                    showInfo={false} strokeColor={REDWOOD.info} size="small"
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Inserted</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: REDWOOD.success }}>+{totalInserted}</div>
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Updated</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: REDWOOD.info }}>↻{totalUpdated}</div>
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small" style={{ borderRadius: 8, textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Errors</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: totalErrors > 0 ? REDWOOD.error : REDWOOD.neutral600 }}>
                    {totalErrors}
                  </div>
                </Card>
              </Col>
            </Row>
          )}

          {/* Customer table card */}
          <Card
            size="small"
            style={{ borderRadius: 8, marginBottom: 12 }}
            title={
              <Space align="center">
                <ApiOutlined style={{ color: REDWOOD.info }} />
                <Text strong>Customers</Text>
                {customers.length > 0 && (
                  <Badge count={customers.length}
                    style={{ background: REDWOOD.info }} />
                )}
              </Space>
            }
            extra={
              <Space size={8}>
                {/* Filter */}
                <Input
                  size="small"
                  prefix={<SearchOutlined style={{ color: REDWOOD.neutral600, fontSize: 12 }} />}
                  placeholder="Filter customers…"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  allowClear
                  style={{ width: 200 }}
                />
                {/* Refresh customers */}
                <Tooltip title="Reload customer list">
                  <Button size="small" icon={<ReloadOutlined />}
                    loading={loadingCustomers} onClick={loadCustomers}>
                    Reload
                  </Button>
                </Tooltip>
                {/* Sync All / Stop */}
                {syncingAll ? (
                  <Button size="small" danger icon={<StopOutlined />} onClick={handleStop}>
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="small" type="primary"
                    icon={<PlayCircleOutlined />}
                    disabled={!!syncingOne || loadingCustomers || customers.length === 0}
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                    onClick={handleSyncAll}
                  >
                    Sync All ({customers.length})
                  </Button>
                )}
              </Space>
            }
          >
            {!loadingCustomers && customers.length === 0 && (
              <Alert
                type="warning"
                showIcon
                message="No customers found"
                description="Make sure the APEX /ar/customers endpoint returns data and your credentials are configured."
                style={{ marginBottom: 8 }}
              />
            )}

            <Table<CustomerRecord>
              dataSource={filtered}
              columns={columns}
              rowKey="cust_account_id"
              size="small"
              loading={loadingCustomers}
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} customers` }}
              scroll={{ x: 900 }}
              style={{ borderRadius: 6, overflow: 'hidden' }}
              rowClassName={(r) => {
                const s = rowState[r.cust_account_id];
                if (s?.status === 'running') return 'cm-sync-running-row';
                if (s?.status === 'done')    return 'cm-sync-done-row';
                return '';
              }}
            />
            <style>{`
              .cm-sync-running-row td { background: #e6f4ff !important; }
              .cm-sync-done-row    td { background: #f6ffed !important; }
            `}</style>
          </Card>

          {/* Log console */}
          <Card
            size="small"
            style={{ borderRadius: 8 }}
            title={
              <Space>
                <FileTextOutlined style={{ color: REDWOOD.neutral600 }} />
                <Text strong style={{ fontSize: 12 }}>Sync Log</Text>
                {logs.length > 0 && (
                  <Badge count={logs.length} style={{ background: REDWOOD.neutral600 }} />
                )}
              </Space>
            }
            extra={
              <Button size="small" icon={<CloseOutlined />} onClick={clearLogs}>
                Clear
              </Button>
            }
            bodyStyle={{ padding: 0 }}
          >
            <div style={{
              background: '#0d1117',
              borderRadius: '0 0 8px 8px',
              padding: '10px 14px',
              minHeight: 140,
              maxHeight: 340,
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: 11,
            }}>
              {logs.length === 0 ? (
                <span style={{ color: '#666' }}>No log output yet — click Sync to start</span>
              ) : (
                logs.map(l => (
                  <div key={l.id} style={{ lineHeight: '1.7', color: logColor[l.type] }}>
                    <span style={{ color: '#444', marginRight: 8 }}>{l.ts}</span>
                    {l.message}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </Card>
        </div>
      </Content>
      <FloatingMenu />
    </Layout>
  );
};

export default SyncCMApplications;
