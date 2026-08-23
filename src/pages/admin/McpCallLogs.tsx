import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Select, Space, Tag,
  Tooltip, message, Statistic, Row, Col, Switch,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, ReloadOutlined, HistoryOutlined, CheckCircleOutlined,
  CloseCircleOutlined, RobotOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', warning: '#D4A800', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B', surface: '#FFFFFF',
};

const APEX_BASE = buildApexUrl('');

interface McpLogRow {
  id: number;
  logTime: string;
  server: string;
  tool: string;
  args: string | null;
  ok: string;
  durationMs: number | null;
  resultPreview: string | null;
  errorMsg: string | null;
  host: string | null;
  osUser: string | null;
  ipAddr: string | null;
  platform: string | null;
}

const SERVER_COLORS: Record<string, string> = {
  'gl-server': '#CA7700',
  'ar-server': '#0572CE',
  'ar-customer-balance': '#722ed1',
  'archive-server': '#1D7B4D',
  'agent-run': '#C74634',
};

const SERVERS = ['gl-server', 'ar-server', 'ar-customer-balance', 'archive-server', 'agent-run'];

const McpCallLogs: React.FC = () => {
  const [rows, setRows] = useState<McpLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [server, setServer] = useState<string | undefined>();
  const [okFilter, setOkFilter] = useState<string | undefined>();
  const [hours, setHours] = useState<number>(168);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (server) p.set('server', server);
      if (okFilter) p.set('ok', okFilter);
      p.set('hours', String(hours));
      p.set('limit', '500');
      const res = await fetch(`${APEX_BASE}/admin/mcplogs?${p.toString()}`);
      const data = await res.json();
      setRows(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      message.error(`Failed to load logs: ${e.message}. Run 06_mcp_call_log.sql in APEX if not deployed.`);
    } finally {
      setLoading(false);
    }
  }, [server, okFilter, hours]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const failCount = rows.filter((r) => r.ok === 'N').length;
  const agentRuns = rows.filter((r) => r.server === 'agent-run').length;

  const columns: ColumnsType<McpLogRow> = [
    { title: 'Time', dataIndex: 'logTime', key: 'logTime', width: 155,
      render: (v) => <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text> },
    { title: 'Server', dataIndex: 'server', key: 'server', width: 160,
      render: (v) => <Tag style={{ margin: 0, color: SERVER_COLORS[v] || REDWOOD.neutral600, borderColor: `${SERVER_COLORS[v] || REDWOOD.neutral600}60`, background: `${SERVER_COLORS[v] || REDWOOD.neutral600}10` }}>{v}</Tag> },
    { title: 'Tool / Task', dataIndex: 'tool', key: 'tool', width: 200,
      render: (v) => <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text> },
    { title: 'Status', dataIndex: 'ok', key: 'ok', width: 90, align: 'center',
      render: (v) => v === 'Y'
        ? <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: 0 }}>OK</Tag>
        : <Tag icon={<CloseCircleOutlined />} color="error" style={{ margin: 0 }}>Failed</Tag> },
    { title: 'ms', dataIndex: 'durationMs', key: 'ms', width: 80, align: 'right',
      render: (v) => v != null ? <Text style={{ fontSize: 11 }}>{Number(v).toLocaleString()}</Text> : '—' },
    { title: 'Machine', key: 'machine', width: 180, ellipsis: true,
      render: (_, r) => <Tooltip title={`${r.ipAddr || ''} · ${r.platform || ''}`}>
        <Text style={{ fontSize: 11 }}>{r.osUser}@{r.host}</Text>
      </Tooltip> },
    { title: 'Output / Error', key: 'out', ellipsis: true,
      render: (_, r) => <Text type={r.ok === 'N' ? 'danger' : 'secondary'} style={{ fontSize: 11 }}>
        {r.ok === 'N' ? (r.errorMsg || '') : (r.resultPreview || '').substring(0, 120)}
      </Text> },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/admin">Administration</Link> },
            { title: 'MCP Activity Log' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primary}99 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <HistoryOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>MCP Activity Log</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Every Claude tool call and agent run, recorded by the MCP servers into RR_MCP_CALL_LOG
                </Text>
              </div>
            </Space>
            <Space>
              <Text style={{ fontSize: 12 }}>Auto-refresh</Text>
              <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" />
              <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
            </Space>
          </div>

          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Statistic title="Calls (period)" value={rows.length} prefix={<HistoryOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Statistic title="Failures" value={failCount}
                  valueStyle={{ color: failCount ? REDWOOD.primary : REDWOOD.success }}
                  prefix={failCount ? <CloseCircleOutlined /> : <CheckCircleOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Statistic title="Agent Runs" value={agentRuns} prefix={<RobotOutlined />}
                  valueStyle={{ color: REDWOOD.info }} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" style={{ borderRadius: 10 }} bodyStyle={{ paddingTop: 10 }}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space style={{ width: '100%' }}>
                    <Select allowClear placeholder="All servers" size="small" style={{ width: 160 }}
                      value={server} onChange={setServer}
                      options={SERVERS.map((s) => ({ value: s, label: s }))} />
                    <Select allowClear placeholder="Status" size="small" style={{ width: 90 }}
                      value={okFilter} onChange={setOkFilter}
                      options={[{ value: 'Y', label: 'OK' }, { value: 'N', label: 'Failed' }]} />
                  </Space>
                  <Select size="small" style={{ width: 258 }} value={hours} onChange={setHours}
                    options={[
                      { value: 24, label: 'Last 24 hours' },
                      { value: 72, label: 'Last 3 days' },
                      { value: 168, label: 'Last 7 days' },
                      { value: 720, label: 'Last 30 days' },
                    ]} />
                </Space>
              </Card>
            </Col>
          </Row>

          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            bodyStyle={{ padding: 0 }}>
            <Table
              rowKey="id"
              size="small"
              loading={loading}
              columns={columns}
              dataSource={rows}
              pagination={{ pageSize: 25, showTotal: (t) => `${t} calls` }}
              expandable={{
                expandedRowRender: (r) => (
                  <div style={{ display: 'flex', gap: 16, padding: '4px 8px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 10, color: '#888' }}>ARGUMENTS</Text>
                      <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 8, margin: '4px 0 0', maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {(() => { try { return JSON.stringify(JSON.parse(r.args || '{}'), null, 2); } catch { return r.args || '—'; } })()}
                      </pre>
                    </div>
                    <div style={{ flex: 2, minWidth: 0 }}>
                      <Text style={{ fontSize: 10, color: '#888' }}>{r.ok === 'N' ? 'ERROR' : 'RESULT PREVIEW'}</Text>
                      <pre style={{ fontSize: 11, background: '#0d0d0d', color: r.ok === 'N' ? '#ff7b72' : '#79c0ff', borderRadius: 4, padding: 8, margin: '4px 0 0', maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {r.ok === 'N' ? (r.errorMsg || '—') : (r.resultPreview || '—')}
                      </pre>
                    </div>
                  </div>
                ),
              }}
            />
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default McpCallLogs;
