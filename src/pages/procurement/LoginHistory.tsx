import React, { useMemo, useState } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Input, Button, Space, Tag, Alert,
  DatePicker, Select, Tooltip, Row, Col,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, HistoryOutlined, ApiOutlined, ReloadOutlined, CloudOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { FUSION_POD_AUTH } from '../../config/fusionInstance';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE', warning: '#D4A800', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral500: '#8C8C8C', neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// Default IDCS identity-domain base (the tenant that fronts this Fusion pod).
// Override in the field if your tenant differs.
const DEFAULT_IDCS_BASE = 'https://idcs-08ec9f6c9fe6485ca2a776ed49559d01.identity.oraclecloud.com';
const BASE_KEY  = 'idcs_audit_base';

// Same Basic-auth credentials the rest of the Fusion Client uses.
const AUTH_HEADER = FUSION_POD_AUTH;

// Common IDCS audit event ids for sign-in activity.
const EVENT_OPTIONS = [
  { label: 'Successful sign-ins', value: 'sso.session.create.success' },
  { label: 'Failed sign-ins',     value: 'sso.session.create.failure' },
  { label: 'App access',          value: 'sso.app.access.success' },
  { label: 'Sign-outs',           value: 'sso.session.delete.success' },
  { label: 'All events',          value: '' },
];

const pick = (r: any, keys: string[]): string => {
  for (const k of keys) {
    const v = r?.[k];
    if (v != null && v !== '') return String(v);
  }
  return '';
};

const LoginHistory: React.FC = () => {
  const fusionUser = sessionStorage.getItem('fusion_user') || '';
  const [idcsBase, setIdcsBase] = useState(localStorage.getItem(BASE_KEY) || DEFAULT_IDCS_BASE);
  const [actor, setActor]       = useState(fusionUser);
  const [eventId, setEventId]   = useState('sso.session.create.success');
  const [fromDate, setFromDate] = useState<Dayjs | null>(dayjs().subtract(7, 'day'));
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [rows, setRows]         = useState<any[]>([]);
  const [rawOpen, setRawOpen]   = useState(false);
  const [raw, setRaw]           = useState('');

  const requestUrl = useMemo(() => {
    const filters: string[] = [];
    if (eventId) filters.push(`eventId eq "${eventId}"`);
    if (actor.trim()) filters.push(`actorName eq "${actor.trim()}"`);
    if (fromDate) filters.push(`timeIssued gt "${fromDate.startOf('day').toISOString()}"`);
    const qs = new URLSearchParams();
    if (filters.length) qs.set('filter', filters.join(' and '));
    qs.set('sortBy', 'timeIssued');
    qs.set('sortOrder', 'descending');
    qs.set('count', '200');
    return `${idcsBase.replace(/\/$/, '')}/admin/v1/AuditEvents?${qs.toString()}`;
  }, [idcsBase, eventId, actor, fromDate]);

  const run = async () => {
    setError(''); setLoading(true); setRows([]);
    localStorage.setItem(BASE_KEY, idcsBase.trim());
    try {
      const res = await fetch(requestUrl, {
        headers: { Authorization: AUTH_HEADER, Accept: 'application/json' },
      });
      const text = await res.text();
      setRaw(text);
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* keep raw */ }
      if (!res.ok) throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
      const items: any[] = data.Resources ?? data.resources ?? data.items ?? [];
      setRows(items);
      if (items.length === 0) setError('No audit events returned for these filters.');
    } catch (e: any) {
      setError(e?.message || 'Request failed (check token, base URL, CORS, or that IDCS audit is still active).');
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType<any> = [
    { title: 'Time', key: 'time', width: 190, render: (_: any, r) => {
      const t = pick(r, ['timeIssued', 'timestamp', 'meta.created', 'ecId']);
      return <Text style={{ fontSize: 12 }}>{t ? dayjs(t).format('D-MMM-YYYY HH:mm:ss') : '—'}</Text>;
    } },
    { title: 'User', key: 'actor', width: 200, render: (_: any, r) => <Text strong style={{ fontSize: 12 }}>{pick(r, ['actorName', 'actorDisplayName', 'actorId']) || '—'}</Text> },
    { title: 'Event', key: 'event', width: 210, render: (_: any, r) => {
      const e = pick(r, ['eventId']);
      const ok = /success/i.test(e);
      return <Tag color={ok ? 'success' : /fail/i.test(e) ? 'error' : 'default'} style={{ fontSize: 10 }}>{e || '—'}</Tag>;
    } },
    { title: 'IP', key: 'ip', width: 130, render: (_: any, r) => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{pick(r, ['ssoClientIP', 'actorIP', 'clientIp', 'ssoClientIp']) || '—'}</Text> },
    { title: 'Browser / OS', key: 'ua', width: 180, render: (_: any, r) => {
      const b = pick(r, ['ssoBrowser', 'browser']);
      const o = pick(r, ['ssoOSName', 'ssoOSVersion', 'os']);
      return <Text style={{ fontSize: 11 }}>{[b, o].filter(Boolean).join(' · ') || '—'}</Text>;
    } },
    { title: 'Message', key: 'msg', ellipsis: true, render: (_: any, r) => <Text style={{ fontSize: 11 }}>{pick(r, ['message', 'ssoMatchedSignOnPolicy', 'adminResourceName']) || '—'}</Text> },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Client</Link> },
            { title: 'Login History' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{ width: 48, height: 48, borderRadius: 10, background: `linear-gradient(135deg, ${REDWOOD.info} 0%, #0461B2 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HistoryOutlined style={{ fontSize: 24, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0 }}>Login History</Title>
              <Text type="secondary">Oracle Fusion (IDCS) sign-in activity via the Audit Events API</Text>
            </div>
            {fusionUser && <Tag icon={<CloudOutlined />} color="green" style={{ marginLeft: 'auto', fontWeight: 600 }}>{fusionUser}</Tag>}
          </div>

          <Alert type="info" showIcon style={{ marginBottom: 14, fontSize: 12 }}
            message="Uses the standard Fusion credentials (Basic auth)"
            description="This calls the Audit Events endpoint with the same emparun Basic-auth used across the Fusion Client — no separate token needed. Adjust the Service Base URL if your audit endpoint differs. If the endpoint rejects Basic auth or returns nothing, use the API icon to inspect the raw response." />

          <Card size="small" style={{ borderRadius: 8, marginBottom: 16 }}>
            <Row gutter={[12, 12]}>
              <Col xs={24}>
                <Text style={{ fontSize: 12, fontWeight: 600 }}>Service Base URL</Text>
                <Input value={idcsBase} onChange={e => setIdcsBase(e.target.value)} placeholder="https://idcs-xxxx.identity.oraclecloud.com" style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }} />
              </Col>
              <Col xs={24} sm={8} md={7}>
                <Text style={{ fontSize: 12, fontWeight: 600 }}>User (actorName)</Text>
                <Input allowClear value={actor} onChange={e => setActor(e.target.value)} placeholder="Blank = all users" style={{ marginTop: 4 }} />
              </Col>
              <Col xs={24} sm={8} md={7}>
                <Text style={{ fontSize: 12, fontWeight: 600 }}>Event</Text>
                <Select value={eventId} onChange={setEventId} style={{ width: '100%', marginTop: 4 }} options={EVENT_OPTIONS} />
              </Col>
              <Col xs={24} sm={8} md={6}>
                <Text style={{ fontSize: 12, fontWeight: 600 }}>Since</Text>
                <DatePicker value={fromDate} onChange={setFromDate} style={{ width: '100%', marginTop: 4 }} format="YYYY-MM-DD" />
              </Col>
              <Col xs={24} md={4} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, fontWeight: 600, marginTop: 4 }}>
                  Run
                </Button>
                <Tooltip title="Show request URL & raw response">
                  <Button icon={<ApiOutlined />} onClick={() => setRawOpen(o => !o)} style={{ marginTop: 4 }} />
                </Tooltip>
              </Col>
            </Row>
            <div style={{ marginTop: 10 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>GET </Text>
              <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{requestUrl}</Text>
            </div>
          </Card>

          {error && <Alert type="warning" showIcon closable onClose={() => setError('')} message={error} style={{ marginBottom: 12, fontSize: 12 }} />}

          {rawOpen && (
            <Card size="small" style={{ borderRadius: 8, marginBottom: 16 }} title={<Text style={{ fontSize: 12 }}>Raw response</Text>}>
              <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 10, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {raw || '(run a query to see the response)'}
              </pre>
            </Card>
          )}

          <Card size="small" style={{ borderRadius: 8 }}
            title={<Space><HistoryOutlined style={{ color: REDWOOD.info }} /><Text strong style={{ fontSize: 13 }}>Sign-in events</Text>{rows.length > 0 && <Tag>{rows.length}</Tag>}</Space>}>
            <Table
              rowKey={(r, i) => String(r.id ?? r.idcsCreatedBy ?? i)}
              size="small"
              loading={loading}
              dataSource={rows}
              columns={columns}
              scroll={{ x: 1000 }}
              pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} events` }}
              locale={{ emptyText: 'Run a query to load sign-in history' }}
            />
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default LoginHistory;
