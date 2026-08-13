import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Tag, Badge,
  Row, Col, Statistic, Tabs, Input, Empty, Space, Tooltip, Spin,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, BugOutlined, SearchOutlined, ReloadOutlined,
  CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
  CloseCircleOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import TicketDetailModal, {
  type Ticket,
  PRIORITY_COLOR, STATUS_COLOR, STATUS_ICON, fmtDate,
} from '../../components/TicketDetailModal';

const { Content } = Layout;
const { Title, Text } = Typography;

const APEX_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp';

const REDWOOD = {
  primary: '#C74634',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', surface: '#FFFFFF',
};

type ViewMode = 'mine' | 'all';

const STATUS_TABS = [
  { key: 'ALL',         label: 'All' },
  { key: 'OPEN',        label: 'Open',        color: '#1890ff', icon: <ExclamationCircleOutlined /> },
  { key: 'IN_PROGRESS', label: 'In Progress',  color: '#fa8c16', icon: <ClockCircleOutlined /> },
  { key: 'RESOLVED',    label: 'Resolved',     color: '#52c41a', icon: <CheckCircleOutlined /> },
  { key: 'CLOSED',      label: 'Closed',       color: '#8c8c8c', icon: <CloseCircleOutlined /> },
];

const MyTickets: React.FC = () => {
  const { user } = useAuth();
  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [loading, setLoading]       = useState(false);
  const [viewMode, setViewMode]     = useState<ViewMode>('mine');
  const [statusTab, setStatusTab]   = useState('ALL');
  const [gridSearch, setGridSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const loadTickets = useCallback(async (mode: ViewMode) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ row_limit: '500' });
      if (mode === 'mine' && user?.username) {
        p.set('created_by', user.username);
      }
      const res  = await fetch(`${APEX_BASE}/support/tickets?${p.toString()}`);
      const data = await res.json();
      if (data.status === 'success') setTickets(data.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [user?.username]);

  useEffect(() => { loadTickets(viewMode); }, [loadTickets, viewMode]);

  const handleModeToggle = (mode: ViewMode) => {
    setViewMode(mode);
    setStatusTab('ALL');
    setGridSearch('');
  };

  // Counts for summary cards
  const counts = {
    open:       tickets.filter(t => t.status === 'OPEN').length,
    inProgress: tickets.filter(t => t.status === 'IN_PROGRESS').length,
    resolved:   tickets.filter(t => t.status === 'RESOLVED').length,
    closed:     tickets.filter(t => t.status === 'CLOSED').length,
  };

  // Apply status tab + grid search filter
  const filtered = tickets.filter(t => {
    if (statusTab !== 'ALL' && t.status !== statusTab) return false;
    if (gridSearch) {
      const q = gridSearch.toLowerCase();
      return [t.ticketNumber, t.title, t.module, t.pageName, t.status, t.priority, t.assignedTo]
        .some(v => String(v ?? '').toLowerCase().includes(q));
    }
    return true;
  });

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
    {
      title: 'Module', dataIndex: 'module', width: 140, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Priority', dataIndex: 'priority', width: 90,
      render: v => <Tag color={PRIORITY_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 120,
      render: v => (
        <Tag color={STATUS_COLOR[v] ?? 'default'} icon={STATUS_ICON[v]} style={{ fontSize: 11 }}>
          {v.replace('_', ' ')}
        </Tag>
      ),
    },
    {
      title: 'Created By', dataIndex: 'createdBy', width: 130,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Assigned To', dataIndex: 'assignedTo', width: 120,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Issues', dataIndex: 'lineCount', width: 70, align: 'center' as const,
      render: (v: number) => v > 0 ? <Badge count={v} color="#1890ff" /> : '—',
    },
    {
      title: 'Date', dataIndex: 'creationDate', width: 130,
      render: v => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    {
      title: 'Updated', dataIndex: 'lastUpdateDate', width: 130,
      render: v => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
  ];

  const tabItems = STATUS_TABS.map(s => ({
    key: s.key,
    label: (
      <span>
        {s.label}
        {s.key !== 'ALL' && (
          <Badge
            count={
              s.key === 'OPEN'        ? counts.open :
              s.key === 'IN_PROGRESS' ? counts.inProgress :
              s.key === 'RESOLVED'    ? counts.resolved :
              counts.closed
            }
            style={{ marginLeft: 6, backgroundColor: s.color, fontSize: 10 }}
            overflowCount={99}
            showZero
          />
        )}
      </span>
    ),
  }));

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/support">Support</Link> },
            { title: viewMode === 'mine' ? 'My Tickets' : 'All Tickets' },
          ]} />
        </div>

        <div style={{ padding: '20px 24px 24px' }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BugOutlined style={{ fontSize: 20, color: REDWOOD.primary }} />
              <Title level={4} style={{ margin: 0 }}>
                {viewMode === 'mine' ? `My Tickets — ${user?.name || user?.username}` : 'All Tickets'}
              </Title>
            </div>
            <Space>
              <Button
                icon={<UserOutlined />}
                type={viewMode === 'mine' ? 'primary' : 'default'}
                onClick={() => handleModeToggle('mine')}
                style={viewMode === 'mine' ? { background: REDWOOD.primary, borderColor: REDWOOD.primary } : {}}
              >
                My Tickets
              </Button>
              <Button
                icon={<TeamOutlined />}
                type={viewMode === 'all' ? 'primary' : 'default'}
                onClick={() => handleModeToggle('all')}
                style={viewMode === 'all' ? { background: REDWOOD.primary, borderColor: REDWOOD.primary } : {}}
              >
                All Tickets
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => loadTickets(viewMode)}
                loading={loading}
              >
                Refresh
              </Button>
            </Space>
          </div>

          {/* Stats cards */}
          <Spin spinning={loading}>
            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              {[
                { label: 'Open',        val: counts.open,       color: '#1890ff', icon: <ExclamationCircleOutlined />, status: 'OPEN' },
                { label: 'In Progress', val: counts.inProgress, color: '#fa8c16', icon: <ClockCircleOutlined />,       status: 'IN_PROGRESS' },
                { label: 'Resolved',    val: counts.resolved,   color: '#52c41a', icon: <CheckCircleOutlined />,       status: 'RESOLVED' },
                { label: 'Closed',      val: counts.closed,     color: '#8c8c8c', icon: <CloseCircleOutlined />,       status: 'CLOSED' },
              ].map(s => (
                <Col key={s.label} xs={12} sm={6}>
                  <Card
                    size="small"
                    hoverable
                    style={{
                      borderRadius: 8, borderLeft: `4px solid ${s.color}`, cursor: 'pointer',
                      background: statusTab === s.status ? s.color + '10' : REDWOOD.surface,
                    }}
                    styles={{ body: { padding: '12px 16px' } }}
                    onClick={() => setStatusTab(statusTab === s.status ? 'ALL' : s.status)}
                  >
                    <Statistic
                      title={<Text style={{ fontSize: 12, color: '#666' }}>{s.label}</Text>}
                      value={s.val}
                      valueStyle={{ fontSize: 22, fontWeight: 700, color: s.color }}
                      prefix={React.cloneElement(s.icon as React.ReactElement<any>, { style: { color: s.color, fontSize: 16 } })}
                    />
                  </Card>
                </Col>
              ))}
            </Row>

            {/* Tickets table */}
            <Card
              style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
              styles={{ body: { padding: 0 } }}
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <Tabs
                    activeKey={statusTab}
                    onChange={k => setStatusTab(k)}
                    size="small"
                    style={{ marginBottom: -1 }}
                    items={tabItems}
                  />
                  <Input
                    prefix={<SearchOutlined style={{ color: '#999' }} />}
                    placeholder="Search tickets…"
                    size="small"
                    value={gridSearch}
                    onChange={e => setGridSearch(e.target.value)}
                    allowClear
                    style={{ width: 220 }}
                  />
                </div>
              }
            >
              <Table
                dataSource={filtered}
                columns={columns}
                rowKey="ticketId"
                loading={loading}
                size="small"
                pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `${t} ticket${t !== 1 ? 's' : ''}` }}
                locale={{ emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      viewMode === 'mine'
                        ? 'You have no tickets yet. Use the bug icon in the toolbar to raise one!'
                        : 'No tickets found.'
                    }
                  />
                )}}
                scroll={{ x: 1100 }}
                onRow={r => ({ onDoubleClick: () => setSelectedId(r.ticketId), style: { cursor: 'pointer' } })}
              />
            </Card>
          </Spin>
        </div>
      </Content>

      <TicketDetailModal
        ticketId={selectedId}
        currentUser={user?.username}
        onClose={() => setSelectedId(null)}
        onRefresh={() => loadTickets(viewMode)}
      />
    </Layout>
  );
};

export default MyTickets;
