import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  DatePicker, Row, Col, Space, Tag, Tooltip, Badge, Divider,
  message, Empty, Statistic, Collapse,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, BugOutlined, SearchOutlined, ReloadOutlined,
  CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuth } from '../../context/AuthContext';
import TicketDetailModal, {
  type Ticket,
  PRIORITY_COLOR, STATUS_COLOR, STATUS_ICON, fmtDate,
} from '../../components/TicketDetailModal';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const APEX_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp';

const REDWOOD = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D',
  warning: '#D4A800', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

interface DashboardData {
  summary: { open: number; inProgress: number; resolved: number; closed: number };
  byModule: { module: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  recentOpen: Ticket[];
}

// ── Main page ─────────────────────────────────────────────────
const ManageTickets: React.FC = () => {
  const { user } = useAuth();
  const [tickets, setTickets]         = useState<Ticket[]>([]);
  const [loading, setLoading]         = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [dashboard, setDashboard]     = useState<DashboardData | null>(null);
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [searchOpen, setSearchOpen]   = useState(true);
  const [gridSearch, setGridSearch]   = useState('');
  const [searchForm] = Form.useForm();

  const loadDashboard = useCallback(async () => {
    try {
      const res  = await fetch(`${APEX_BASE}/support/dashboard`);
      const data = await res.json();
      if (data.status === 'success') setDashboard(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const handleSearch = useCallback(async () => {
    const v = searchForm.getFieldsValue();
    const p = new URLSearchParams();
    if (v.status)     p.set('status',     v.status);
    if (v.module)     p.set('module',     v.module);
    if (v.priority)   p.set('priority',   v.priority);
    if (v.createdBy)  p.set('created_by', v.createdBy);
    if (v.assignedTo) p.set('assigned_to', v.assignedTo);
    if (v.search)     p.set('search',     v.search);
    if (v.dateFrom)   p.set('date_from',  dayjs(v.dateFrom).format('YYYY-MM-DD'));
    if (v.dateTo)     p.set('date_to',    dayjs(v.dateTo).format('YYYY-MM-DD'));
    p.set('row_limit', '500');

    setLoading(true); setHasSearched(true);
    try {
      const res  = await fetch(`${APEX_BASE}/support/tickets?${p.toString()}`);
      const data = await res.json();
      if (data.status === 'success') {
        setTickets(data.items ?? []);
        if (!(data.items ?? []).length) message.info('No tickets found.');
      } else { message.error(data.message || 'Search failed.'); }
    } catch (e: any) { message.error('Network error: ' + e.message); }
    finally { setLoading(false); }
  }, [searchForm]);

  const handleReset = () => {
    searchForm.resetFields(); setTickets([]); setHasSearched(false); setGridSearch('');
  };

  const columns: ColumnsType<Ticket> = [
    {
      title: 'Ticket #', dataIndex: 'ticketNumber', width: 140,
      render: (v, r) => (
        <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }}
          onClick={() => setSelectedId(r.ticketId)}>{v}</Button>
      ),
    },
    {
      title: 'Title', dataIndex: 'title', ellipsis: true,
      render: (v, r) => (
        <Tooltip title={v}>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12, textAlign: 'left' }}
            onClick={() => setSelectedId(r.ticketId)}>{v}</Button>
        </Tooltip>
      ),
    },
    { title: 'Module', dataIndex: 'module', width: 140, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Priority', dataIndex: 'priority', width: 90,
      render: v => <Tag color={PRIORITY_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag> },
    {
      title: 'Status', dataIndex: 'status', width: 120,
      render: v => <Tag color={STATUS_COLOR[v] ?? 'default'} icon={STATUS_ICON[v]} style={{ fontSize: 11 }}>
        {v.replace('_', ' ')}
      </Tag>,
    },
    { title: 'Created By', dataIndex: 'createdBy', width: 130,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Assigned To', dataIndex: 'assignedTo', width: 120,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Issues', dataIndex: 'lineCount', width: 65, align: 'center',
      render: v => v > 0 ? <Badge count={v} color="#1890ff" /> : '—' },
    { title: 'Files', dataIndex: 'attachCount', width: 55, align: 'center',
      render: v => v > 0 ? <Badge count={v} color="#52c41a" /> : '—' },
    { title: 'Date', dataIndex: 'creationDate', width: 130,
      render: v => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text> },
    {
      title: '', key: 'actions', width: 60, align: 'center',
      render: (_, r) => (
        <Button type="text" size="small" icon={<BugOutlined />}
          onClick={() => setSelectedId(r.ticketId)} />
      ),
    },
  ];

  const summary = dashboard?.summary;

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/support">Support</Link> },
            { title: 'Manage Tickets' },
          ]} />
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          {/* ── Stats row ── */}
          {summary && (
            <Row gutter={[16, 16]} style={{ padding: '16px 0 4px' }}>
              {[
                { label: 'Open',        val: summary.open,       color: '#1890ff', icon: <ExclamationCircleOutlined />, status: 'OPEN' },
                { label: 'In Progress', val: summary.inProgress, color: '#fa8c16', icon: <ClockCircleOutlined />,       status: 'IN_PROGRESS' },
                { label: 'Resolved',    val: summary.resolved,   color: '#52c41a', icon: <CheckCircleOutlined />,       status: 'RESOLVED' },
                { label: 'Closed',      val: summary.closed,     color: '#8c8c8c', icon: <CloseCircleOutlined />,       status: 'CLOSED' },
              ].map(s => (
                <Col key={s.label} xs={12} sm={6}>
                  <Card
                    size="small"
                    style={{ borderRadius: 8, borderLeft: `4px solid ${s.color}`, cursor: 'pointer' }}
                    styles={{ body: { padding: '12px 16px' } }}
                    onClick={() => {
                      searchForm.setFieldsValue({ status: s.status });
                      handleSearch();
                    }}
                  >
                    <Statistic
                      title={<Text style={{ fontSize: 12, color: '#666' }}>{s.label}</Text>}
                      value={s.val}
                      valueStyle={{ fontSize: 24, fontWeight: 700, color: s.color }}
                      prefix={React.cloneElement(s.icon as React.ReactElement<any>, { style: { color: s.color, fontSize: 18 } })}
                    />
                  </Card>
                </Col>
              ))}
            </Row>
          )}

          {/* Module breakdown */}
          {dashboard?.byModule && dashboard.byModule.length > 0 && (
            <div style={{ padding: '8px 0 4px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {dashboard.byModule.map(m => (
                <Tag
                  key={m.module} color="geekblue" style={{ cursor: 'pointer' }}
                  onClick={() => { searchForm.setFieldsValue({ module: m.module }); handleSearch(); }}
                >
                  {m.module}: {m.count}
                </Tag>
              ))}
            </div>
          )}

          {/* Search panel */}
          <Collapse
            activeKey={searchOpen ? ['s'] : []}
            onChange={(k: string[]) => setSearchOpen(k.includes('s'))}
            style={{ marginTop: 12, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.surface }}
            items={[{
              key: 's',
              label: <Text strong style={{ fontSize: 13 }}>Search</Text>,
              extra: (
                <Space size={8} onClick={e => e.stopPropagation()}>
                  <Button size="small" icon={<ReloadOutlined />}
                    onClick={e => { e.stopPropagation(); handleReset(); }}>Reset</Button>
                  <Button size="small" type="primary" icon={<SearchOutlined />} loading={loading}
                    onClick={e => { e.stopPropagation(); handleSearch(); }}
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                    Search
                  </Button>
                </Space>
              ),
              children: (
                <Form form={searchForm} layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }}>
                  <Row gutter={[24, 4]}>
                    <Col xs={24} md={8}>
                      <Form.Item label="Status" name="status" style={{ marginBottom: 10 }}>
                        <Select placeholder="Any" allowClear>
                          <Option value="OPEN">Open</Option>
                          <Option value="IN_PROGRESS">In Progress</Option>
                          <Option value="RESOLVED">Resolved</Option>
                          <Option value="CLOSED">Closed</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Priority" name="priority" style={{ marginBottom: 10 }}>
                        <Select placeholder="Any" allowClear>
                          <Option value="LOW">Low</Option>
                          <Option value="MEDIUM">Medium</Option>
                          <Option value="HIGH">High</Option>
                          <Option value="CRITICAL">Critical</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Module" name="module" style={{ marginBottom: 10 }}>
                        <Select placeholder="Any" allowClear showSearch>
                          {['General Ledger', 'Accounts Payable', 'Cash Management', 'Data Sync', 'Administration', 'General'].map(m => (
                            <Option key={m} value={m}>{m}</Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Created By" name="createdBy" style={{ marginBottom: 10 }}>
                        <Input placeholder="Name or username…" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Assigned To" name="assignedTo" style={{ marginBottom: 10 }}>
                        <Input placeholder="Name or username…" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Date From" name="dateFrom" style={{ marginBottom: 10 }}>
                        <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Date To" name="dateTo" style={{ marginBottom: 10 }}>
                        <DatePicker style={{ width: '100%' }} format="D-MMM-YYYY" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="Search" name="search" style={{ marginBottom: 10 }}>
                        <Input placeholder="Ticket # or title…" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>
              ),
            }]}
          />

          {/* Results */}
          {hasSearched && (
            <Card
              style={{ marginTop: 12, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
              styles={{ body: { padding: 0 } }}
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Text strong>Results {tickets.length > 0 && <Tag color="blue">{tickets.length}</Tag>}</Text>
                  <Input
                    prefix={<SearchOutlined style={{ color: '#999' }} />}
                    placeholder="Filter results…"
                    size="small"
                    value={gridSearch}
                    onChange={e => setGridSearch(e.target.value)}
                    allowClear
                    style={{ width: 220 }}
                  />
                </div>
              }
            >
              {(() => {
                const q = gridSearch.trim().toLowerCase();
                const filtered = q
                  ? tickets.filter(r =>
                      [r.ticketNumber, r.title, r.module, r.pageName, r.feature,
                       r.status, r.priority, r.createdBy, r.assignedTo]
                      .some(v => String(v ?? '').toLowerCase().includes(q))
                    )
                  : tickets;
                return (
                  <Table
                    dataSource={filtered} columns={columns} rowKey="ticketId"
                    loading={loading} size="small"
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} tickets` }}
                    locale={{ emptyText: <Empty description="No tickets found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    scroll={{ x: 1100 }}
                  />
                );
              })()}
            </Card>
          )}

          {/* Recent open tickets (shown when not searched yet) */}
          {!hasSearched && dashboard?.recentOpen && dashboard.recentOpen.length > 0 && (
            <Card
              style={{ marginTop: 12, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
              styles={{ body: { padding: 0 } }}
              title={<Text strong>Recent Open Tickets</Text>}
            >
              <Table
                dataSource={dashboard.recentOpen} rowKey="ticketId" size="small"
                pagination={false}
                columns={[
                  { title: 'Ticket #', dataIndex: 'ticketNumber', width: 130,
                    render: (v, r) => <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }}
                      onClick={() => setSelectedId(r.ticketId)}>{v}</Button> },
                  { title: 'Title', dataIndex: 'title', ellipsis: true,
                    render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
                  { title: 'Module', dataIndex: 'module', width: 140,
                    render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                  { title: 'Priority', dataIndex: 'priority', width: 90,
                    render: v => <Tag color={PRIORITY_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag> },
                  { title: 'Status', dataIndex: 'status', width: 120,
                    render: v => <Tag color={STATUS_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{v.replace('_', ' ')}</Tag> },
                  { title: 'Created By', dataIndex: 'createdBy', width: 130,
                    render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                  { title: 'Assigned To', dataIndex: 'assignedTo', width: 120,
                    render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
                  { title: 'Date', dataIndex: 'creationDate', width: 130,
                    render: v => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text> },
                ]}
                scroll={{ x: 800 }}
              />
            </Card>
          )}
        </div>
      </Content>

      <TicketDetailModal
        ticketId={selectedId}
        currentUser={user?.username}
        onClose={() => setSelectedId(null)}
        onRefresh={() => { loadDashboard(); if (hasSearched) handleSearch(); }}
      />
    </Layout>
  );
};

export default ManageTickets;
