import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Typography, Card, Breadcrumb, Space, Tabs, Form,
  Select, Button, Table, Tag, Spin, Tooltip, message, Row, Col,
  Statistic, Divider, Alert, Badge,
} from 'antd';
import {
  HomeOutlined, CheckCircleOutlined, WarningOutlined,
  CloseCircleOutlined, SearchOutlined, ReloadOutlined,
  FileSearchOutlined, ExclamationCircleOutlined,
  DatabaseOutlined, NumberOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  amber: '#d46b08',
};

const APEX_BASE = APEX_DB_CONFIG.baseUrl;

// ─── Types ────────────────────────────────────────────────────────────────────

interface MigrationSummary {
  totalInvoices: number;
  invoicesWithLines: number;
  invoicesMissingLines: number;
  amountMismatches: number;
  possiblyTruncated: number;
  totalHeaderAmount: number;
  totalLineAmount: number;
  amountVariance: number;
  invoicesWithInstallments: number;
  invoicesMissingInstallments: number;
}

interface MigrationDetail {
  invoiceId: number;
  invoiceNumber: string;
  supplier: string;
  supplierNumber: string;
  businessUnit: string;
  invoiceCurrency: string;
  invoiceDate: string;
  invoiceType: string;
  validationStatus: string;
  headerAmount: number;
  totalLineAmount: number;
  difference: number;
  lineCount: number;
  installmentCount: number;
  status: 'OK' | 'MISSING_LINES' | 'AMOUNT_MISMATCH' | 'POSSIBLY_TRUNCATED';
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  OK:                  { label: 'OK',                color: REDWOOD.success,  icon: <CheckCircleOutlined /> },
  MISSING_LINES:       { label: 'Missing Lines',     color: REDWOOD.primary,  icon: <CloseCircleOutlined /> },
  AMOUNT_MISMATCH:     { label: 'Amount Mismatch',   color: REDWOOD.amber,    icon: <ExclamationCircleOutlined /> },
  POSSIBLY_TRUNCATED:  { label: 'Possibly Truncated (25)', color: REDWOOD.warning, icon: <WarningOutlined /> },
};

const FILTER_OPTIONS = [
  { value: 'ISSUES',         label: 'All Issues' },
  { value: 'MISSING_LINES',  label: 'Missing Lines Only' },
  { value: 'AMOUNT_MISMATCH',label: 'Amount Mismatches Only' },
  { value: 'TRUNCATED',      label: 'Possibly Truncated (=25 lines)' },
  { value: 'ALL',            label: 'All Invoices' },
];

// ─── Number formatter ────────────────────────────────────────────────────────
const fmt = (n: number, ccy = '') =>
  (ccy ? `${ccy} ` : '') +
  new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

// ─── Summary stat card ────────────────────────────────────────────────────────
interface StatCardProps {
  title: string;
  value: number | string;
  color: string;
  icon: React.ReactNode;
  tooltip?: string;
  isAmount?: boolean;
  isOk?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, color, icon, tooltip, isAmount, isOk }) => (
  <Tooltip title={tooltip}>
    <Card
      size="small"
      style={{
        borderTop: `3px solid ${color}`,
        borderRadius: 6,
        height: '100%',
        cursor: tooltip ? 'help' : 'default',
      }}
      bodyStyle={{ padding: '12px 16px' }}
    >
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space>
          <span style={{ color, fontSize: 16 }}>{icon}</span>
          <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{title}</Text>
        </Space>
        <Text
          strong
          style={{
            fontSize: isAmount ? 14 : 22,
            color: isOk ? REDWOOD.success : color,
            fontFamily: 'monospace',
            display: 'block',
          }}
        >
          {isAmount ? fmt(value as number) : value}
        </Text>
      </Space>
    </Card>
  </Tooltip>
);

// ─── Main component ───────────────────────────────────────────────────────────
const CheckMigration: React.FC = () => {
  const [businessUnits, setBusinessUnits]   = useState<string[]>([]);
  const [selectedBU, setSelectedBU]         = useState<string>('');
  const [filter, setFilter]                 = useState<string>('ISSUES');

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary]               = useState<MigrationSummary | null>(null);

  const [detailLoading, setDetailLoading]   = useState(false);
  const [details, setDetails]               = useState<MigrationDetail[]>([]);
  const [totalCount, setTotalCount]         = useState(0);
  const [currentPage, setCurrentPage]       = useState(1);
  const PAGE_SIZE = 100;

  // ── Fetch business units ────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${APEX_BASE}/gl/businessunits`)
      .then(r => r.json())
      .then(d => {
        const names = (d.items || []).map((x: any) => x.business_unit_name).filter(Boolean);
        setBusinessUnits(names);
      })
      .catch(() => {});
  }, []);

  // ── Fetch summary ───────────────────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBU) params.set('businessUnit', selectedBU);
      const res = await fetch(`${APEX_BASE}/ap/migration-check/summary?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.message);
      setSummary(data);
    } catch (e: any) {
      message.error(`Summary fetch failed: ${e.message}`);
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedBU]);

  // ── Fetch details ───────────────────────────────────────────────────────────
  const fetchDetails = useCallback(async (page = 1) => {
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({
        filter,
        limit:  PAGE_SIZE.toString(),
        offset: ((page - 1) * PAGE_SIZE).toString(),
      });
      if (selectedBU) params.set('businessUnit', selectedBU);
      const res = await fetch(`${APEX_BASE}/ap/migration-check/details?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.message);
      setDetails(data.items || []);
      setTotalCount(data.totalCount || 0);
      setCurrentPage(page);
    } catch (e: any) {
      message.error(`Details fetch failed: ${e.message}`);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedBU, filter]);

  const handleRun = () => {
    fetchSummary();
    fetchDetails(1);
  };

  // ── Table columns ───────────────────────────────────────────────────────────
  const columns = [
    {
      title: 'Invoice #',
      dataIndex: 'invoiceNumber',
      key: 'invoiceNumber',
      width: 140,
      render: (v: string) => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
    },
    {
      title: 'Supplier',
      dataIndex: 'supplier',
      key: 'supplier',
      width: 180,
      ellipsis: true,
      render: (v: string, r: MigrationDetail) => (
        <Tooltip title={`${r.supplierNumber} — ${r.businessUnit}`}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Business Unit',
      dataIndex: 'businessUnit',
      key: 'businessUnit',
      width: 180,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{v}</Text>,
    },
    {
      title: 'Date',
      dataIndex: 'invoiceDate',
      key: 'invoiceDate',
      width: 100,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v ? v.substring(0, 10) : '—'}</Text>,
    },
    {
      title: 'Ccy',
      dataIndex: 'invoiceCurrency',
      key: 'invoiceCurrency',
      width: 55,
      align: 'center' as const,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Header Amount',
      dataIndex: 'headerAmount',
      key: 'headerAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{fmt(v)}</Text>
      ),
    },
    {
      title: 'Lines Total',
      dataIndex: 'totalLineAmount',
      key: 'totalLineAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number, r: MigrationDetail) => (
        <Text
          style={{
            fontSize: 12,
            fontFamily: 'monospace',
            color: r.status === 'MISSING_LINES' ? REDWOOD.neutral600 : undefined,
          }}
        >
          {r.status === 'MISSING_LINES' ? '—' : fmt(v)}
        </Text>
      ),
    },
    {
      title: 'Difference',
      dataIndex: 'difference',
      key: 'difference',
      width: 120,
      align: 'right' as const,
      render: (v: number, r: MigrationDetail) => {
        if (r.status === 'MISSING_LINES') return <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>—</Text>;
        const abs = Math.abs(v);
        const color = abs < 0.01 ? REDWOOD.success : REDWOOD.amber;
        return (
          <Text style={{ fontSize: 12, fontFamily: 'monospace', color }}>
            {abs < 0.01 ? '0.00' : fmt(v)}
          </Text>
        );
      },
    },
    {
      title: 'Lines',
      dataIndex: 'lineCount',
      key: 'lineCount',
      width: 65,
      align: 'center' as const,
      render: (v: number, r: MigrationDetail) => (
        <Tooltip title={v === 25 ? 'Exactly 25 lines — may be truncated' : undefined}>
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'monospace',
              color: v === 0 ? REDWOOD.primary : v === 25 ? REDWOOD.warning : undefined,
              fontWeight: v === 25 ? 600 : undefined,
            }}
          >
            {v}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 160,
      render: (v: string) => {
        const m = STATUS_META[v] || STATUS_META.OK;
        return (
          <Tag
            icon={m.icon}
            style={{
              color: m.color,
              borderColor: m.color,
              background: `${m.color}18`,
              fontSize: 11,
            }}
          >
            {m.label}
          </Tag>
        );
      },
    },
  ];

  // ── Summary alert text ──────────────────────────────────────────────────────
  const issueCount = summary
    ? summary.invoicesMissingLines + summary.amountMismatches + summary.possiblyTruncated
    : 0;

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '20px 24px' }}>
        {/* Breadcrumb */}
        <Breadcrumb style={{ marginBottom: 12 }}>
          <Breadcrumb.Item><Link to="/"><HomeOutlined /></Link></Breadcrumb.Item>
          <Breadcrumb.Item><Link to="/ap">Payables</Link></Breadcrumb.Item>
          <Breadcrumb.Item>Check Migration</Breadcrumb.Item>
        </Breadcrumb>

        {/* Page header */}
        <Space align="center" style={{ marginBottom: 20 }}>
          <DatabaseOutlined style={{ fontSize: 28, color: REDWOOD.info }} />
          <div>
            <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>
              Check Migration
            </Title>
            <Text style={{ color: REDWOOD.neutral600, fontSize: 13 }}>
              Verify AP invoice headers, lines and installments data integrity
            </Text>
          </div>
        </Space>

        <Tabs
          defaultActiveKey="payables"
          type="card"
          size="small"
          items={[
            {
              key: 'payables',
              label: (
                <Space>
                  <FileSearchOutlined />
                  Payables Migration
                  {summary && issueCount > 0 && (
                    <Badge count={issueCount} size="small" color={REDWOOD.amber} />
                  )}
                </Space>
              ),
              children: (
                <div style={{ background: REDWOOD.surface, borderRadius: '0 6px 6px 6px', padding: 20 }}>

                  {/* ── Filter bar ─────────────────────────────────────────── */}
                  <Card
                    size="small"
                    style={{ marginBottom: 16, background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}` }}
                    bodyStyle={{ padding: '12px 16px' }}
                  >
                    <Space wrap>
                      <Form layout="inline" size="small">
                        <Form.Item label={<Text style={{ fontSize: 12 }}>Business Unit</Text>} style={{ marginBottom: 0 }}>
                          <Select
                            value={selectedBU || undefined}
                            onChange={v => setSelectedBU(v || '')}
                            placeholder="All business units"
                            allowClear
                            style={{ width: 280 }}
                            size="small"
                          >
                            {businessUnits.map(bu => (
                              <Option key={bu} value={bu}>{bu}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item label={<Text style={{ fontSize: 12 }}>Show</Text>} style={{ marginBottom: 0 }}>
                          <Select
                            value={filter}
                            onChange={setFilter}
                            style={{ width: 240 }}
                            size="small"
                          >
                            {FILTER_OPTIONS.map(o => (
                              <Option key={o.value} value={o.value}>{o.label}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Form>
                      <Button
                        type="primary"
                        icon={<SearchOutlined />}
                        onClick={handleRun}
                        loading={summaryLoading || detailLoading}
                        size="small"
                        style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                      >
                        Run Check
                      </Button>
                      {summary && (
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={handleRun}
                          size="small"
                        >
                          Refresh
                        </Button>
                      )}
                    </Space>
                  </Card>

                  {/* ── Summary cards ──────────────────────────────────────── */}
                  {summaryLoading ? (
                    <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
                  ) : summary && (
                    <>
                      {/* Status alert */}
                      {issueCount === 0 ? (
                        <Alert
                          type="success"
                          showIcon
                          message="All invoices have matching lines — migration looks clean"
                          style={{ marginBottom: 16, fontSize: 13 }}
                        />
                      ) : (
                        <Alert
                          type="warning"
                          showIcon
                          message={`${issueCount} invoice${issueCount > 1 ? 's' : ''} have data issues — review the details below`}
                          style={{ marginBottom: 16, fontSize: 13 }}
                        />
                      )}

                      {/* Row 1: counts */}
                      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                        <Col xs={12} sm={8} md={4}>
                          <StatCard
                            title="Total Invoices"
                            value={summary.totalInvoices.toLocaleString()}
                            color={REDWOOD.info}
                            icon={<NumberOutlined />}
                          />
                        </Col>
                        <Col xs={12} sm={8} md={4}>
                          <StatCard
                            title="With Lines"
                            value={summary.invoicesWithLines.toLocaleString()}
                            color={REDWOOD.success}
                            icon={<CheckCircleOutlined />}
                            isOk
                          />
                        </Col>
                        <Col xs={12} sm={8} md={4}>
                          <StatCard
                            title="Missing Lines"
                            value={summary.invoicesMissingLines.toLocaleString()}
                            color={summary.invoicesMissingLines > 0 ? REDWOOD.primary : REDWOOD.success}
                            icon={<CloseCircleOutlined />}
                            tooltip="Invoices in the header table with zero lines synced"
                            isOk={summary.invoicesMissingLines === 0}
                          />
                        </Col>
                        <Col xs={12} sm={8} md={4}>
                          <StatCard
                            title="Amount Mismatches"
                            value={summary.amountMismatches.toLocaleString()}
                            color={summary.amountMismatches > 0 ? REDWOOD.amber : REDWOOD.success}
                            icon={<ExclamationCircleOutlined />}
                            tooltip="Header invoice_amount ≠ SUM(line_amount) — difference > 0.01"
                            isOk={summary.amountMismatches === 0}
                          />
                        </Col>
                        <Col xs={12} sm={8} md={4}>
                          <StatCard
                            title="Possibly Truncated"
                            value={summary.possiblyTruncated.toLocaleString()}
                            color={summary.possiblyTruncated > 0 ? REDWOOD.warning : REDWOOD.success}
                            icon={<WarningOutlined />}
                            tooltip="Invoices with exactly 25 lines — may have been cut off at the old fetch limit"
                            isOk={summary.possiblyTruncated === 0}
                          />
                        </Col>
                        <Col xs={12} sm={8} md={4}>
                          <StatCard
                            title="Missing Installments"
                            value={summary.invoicesMissingInstallments.toLocaleString()}
                            color={summary.invoicesMissingInstallments > 0 ? REDWOOD.neutral600 : REDWOOD.success}
                            icon={<WarningOutlined />}
                            tooltip="Invoices with no payment installments synced"
                            isOk={summary.invoicesMissingInstallments === 0}
                          />
                        </Col>
                      </Row>

                      {/* Row 2: amounts */}
                      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
                        <Col xs={24} sm={8}>
                          <StatCard
                            title="Total Header Amount"
                            value={summary.totalHeaderAmount}
                            color={REDWOOD.info}
                            icon={<DatabaseOutlined />}
                            isAmount
                          />
                        </Col>
                        <Col xs={24} sm={8}>
                          <StatCard
                            title="Total Lines Amount"
                            value={summary.totalLineAmount}
                            color={REDWOOD.info}
                            icon={<DatabaseOutlined />}
                            isAmount
                          />
                        </Col>
                        <Col xs={24} sm={8}>
                          <StatCard
                            title="Amount Variance (Header − Lines)"
                            value={summary.amountVariance}
                            color={Math.abs(summary.amountVariance) < 0.01 ? REDWOOD.success : REDWOOD.amber}
                            icon={<ExclamationCircleOutlined />}
                            isAmount
                            isOk={Math.abs(summary.amountVariance) < 0.01}
                            tooltip="Difference between sum of all header amounts and sum of all line amounts"
                          />
                        </Col>
                      </Row>

                      <Divider style={{ margin: '8px 0 16px' }} />
                    </>
                  )}

                  {/* ── Detail table ───────────────────────────────────────── */}
                  {summary && (
                    <>
                      <Space style={{ marginBottom: 8 }}>
                        <Text strong style={{ fontSize: 13 }}>Invoice Detail</Text>
                        <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                          — {filter === 'ALL' ? 'all invoices' : FILTER_OPTIONS.find(o => o.value === filter)?.label.toLowerCase()}
                          {selectedBU ? ` · ${selectedBU}` : ''}
                          {` · ${totalCount.toLocaleString()} record${totalCount !== 1 ? 's' : ''}`}
                        </Text>
                      </Space>

                      <Table<MigrationDetail>
                        dataSource={details}
                        columns={columns}
                        rowKey="invoiceId"
                        loading={detailLoading}
                        size="small"
                        scroll={{ x: 1200 }}
                        pagination={{
                          current: currentPage,
                          pageSize: PAGE_SIZE,
                          total: totalCount,
                          showSizeChanger: false,
                          showTotal: (tot, range) => (
                            <Text style={{ fontSize: 12 }}>
                              {range[0]}–{range[1]} of {tot.toLocaleString()}
                            </Text>
                          ),
                          onChange: page => fetchDetails(page),
                        }}
                        rowClassName={(r) =>
                          r.status === 'MISSING_LINES'
                            ? 'row-error'
                            : r.status === 'AMOUNT_MISMATCH'
                            ? 'row-warning'
                            : r.status === 'POSSIBLY_TRUNCATED'
                            ? 'row-truncated'
                            : ''
                        }
                        style={{ fontSize: 12 }}
                        locale={{
                          emptyText: summary
                            ? <Space direction="vertical" style={{ padding: 32 }}>
                                <CheckCircleOutlined style={{ fontSize: 32, color: REDWOOD.success }} />
                                <Text style={{ color: REDWOOD.neutral600 }}>No issues found for the selected filter</Text>
                              </Space>
                            : <Text style={{ color: REDWOOD.neutral600 }}>Click "Run Check" to load data</Text>,
                        }}
                      />
                    </>
                  )}

                  {!summary && !summaryLoading && (
                    <div style={{ textAlign: 'center', padding: '48px 0', color: REDWOOD.neutral600 }}>
                      <DatabaseOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
                      <Text>Select filters and click <strong>Run Check</strong> to analyse migration data</Text>
                    </div>
                  )}

                </div>
              ),
            },
          ]}
        />
      </Content>

      {/* Row highlight styles */}
      <style>{`
        .row-error   td { background: #fff1f0 !important; }
        .row-warning td { background: #fffbe6 !important; }
        .row-truncated td { background: #fffef0 !important; }
        .row-error:hover   td { background: #ffd6d0 !important; }
        .row-warning:hover td { background: #fff3cc !important; }
        .row-truncated:hover td { background: #fffad0 !important; }
      `}</style>
    </Layout>
  );
};

export default CheckMigration;
