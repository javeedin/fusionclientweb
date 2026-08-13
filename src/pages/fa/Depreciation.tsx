import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Card, Form, Input, Select, Button, Space, Typography, Table,
  Row, Col, Breadcrumb, Statistic, Spin, message, Badge,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, LineChartOutlined,
  DatabaseOutlined, DollarOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  getDeprnWorkbench, getBookControls, getDeprnPeriods,
  formatCurrency,
} from '../../services/fa.service';
import type { DeprnWorkbenchRecord, BookControlRecord } from '../../services/fa.service';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
};
const FA_COLOR = '#CA7700';

const Depreciation: React.FC = () => {
  const [form] = Form.useForm();

  const [rows,       setRows]       = useState<DeprnWorkbenchRecord[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page,       setPage]       = useState(1);
  const [pageSize,   setPageSize]   = useState(50);
  const [searched,   setSearched]   = useState(false);

  const [summary, setSummary] = useState({
    totalCost: 0, totalDeprnReserve: 0, totalNbv: 0, totalDeprnAmount: 0,
  });

  const [bookControls, setBookControls] = useState<BookControlRecord[]>([]);
  const [periods,      setPeriods]      = useState<any[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  useEffect(() => {
    getBookControls().then(setBookControls);
  }, []);

  const loadPeriods = async (bookTypeCode: string) => {
    setPeriodsLoading(true);
    try {
      const p = await getDeprnPeriods(bookTypeCode);
      setPeriods(p);
    } finally {
      setPeriodsLoading(false);
    }
  };

  const runSearch = useCallback(async (pg = 1, ps = pageSize) => {
    const vals = form.getFieldsValue();
    setLoading(true);
    try {
      const res = await getDeprnWorkbench({
        bookTypeCode:  vals.bookTypeCode  || undefined,
        periodCounter: vals.periodCounter || undefined,
        assetNumber:   vals.assetNumber   || undefined,
        offset:        (pg - 1) * ps,
        limit:         ps,
      });
      if (res.success) {
        setRows(res.items);
        setTotalCount(res.totalCount);
        setSummary(res.summary);
        setPage(pg);
      } else {
        message.error(res.error || 'Search failed');
      }
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [form, pageSize]);

  // Load latest period on mount
  useEffect(() => { runSearch(1, pageSize); }, []);

  const handleReset = () => {
    form.resetFields();
    setRows([]);
    setTotalCount(0);
    setSummary({ totalCost: 0, totalDeprnReserve: 0, totalNbv: 0, totalDeprnAmount: 0 });
    setSearched(false);
  };

  // ── Table columns ───────────────────────────────────────────────────────────
  const columns: ColumnsType<DeprnWorkbenchRecord> = [
    { title: 'Asset Number', dataIndex: 'assetNumber', key: 'assetNumber', width: 130,
      render: (v) => <Text strong style={{ color: FA_COLOR }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'Book',        dataIndex: 'bookTypeCode', key: 'bookTypeCode', width: 160, ellipsis: true },
    { title: 'Period',      dataIndex: 'periodName',   key: 'periodName',   width: 110 },
    { title: 'FY',          dataIndex: 'fiscalYear',   key: 'fiscalYear',   width: 60  },
    { title: 'Cost',        dataIndex: 'adjustedCost', key: 'adjustedCost', width: 120, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'Deprn Amt',   dataIndex: 'deprnAmount',  key: 'deprnAmount',  width: 120, align: 'right' as const,
      render: (v) => <Text style={{ color: REDWOOD.warning }}>{formatCurrency(v)}</Text> },
    { title: 'YTD Deprn',   dataIndex: 'ytdDeprn',     key: 'ytdDeprn',     width: 120, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'Reserve',     dataIndex: 'deprnReserve', key: 'deprnReserve', width: 120, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'NBV',         dataIndex: 'nbv',          key: 'nbv',          width: 120, align: 'right' as const,
      render: (v) => <Text strong style={{ color: REDWOOD.info }}>{formatCurrency(v)}</Text> },
    { title: 'Salvage',     dataIndex: 'salvageValue', key: 'salvageValue', width: 110, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'Run Date',    dataIndex: 'deprnRunDate', key: 'deprnRunDate', width: 120 },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Depreciation Workbench' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <LineChartOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0 }}>Depreciation Workbench</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>Review depreciation by asset and period</Text>
            </div>
          </div>

          {/* Filter card */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 }}
            bodyStyle={{ padding: '16px 20px' }}>
            <Form form={form} layout="vertical" onFinish={() => runSearch(1, pageSize)}>
              <Row gutter={[16, 0]}>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item name="bookTypeCode" label="Book" style={{ marginBottom: 8 }}>
                    <Select
                      allowClear showSearch optionFilterProp="children"
                      placeholder="All books"
                      onChange={(v) => { form.setFieldValue('periodCounter', undefined); setPeriods([]); if (v) loadPeriods(v); }}
                    >
                      {bookControls.map(b => (
                        <Option key={b.bookTypeCode} value={b.bookTypeCode}>{b.bookTypeCode}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item name="periodCounter" label="Period" style={{ marginBottom: 8 }}>
                    <Select allowClear placeholder="Latest" loading={periodsLoading}>
                      {periods.map((p: any) => (
                        <Option key={p.periodCounter} value={String(p.periodCounter)}>
                          {p.periodName} — {p.fiscalYear}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Form.Item name="assetNumber" label="Asset Number" style={{ marginBottom: 8 }}>
                    <Input placeholder="Filter by asset" allowClear prefix={<SearchOutlined />} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={6} style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Form.Item style={{ marginBottom: 8, width: '100%' }}>
                    <Space>
                      <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                        style={{ background: FA_COLOR, borderColor: FA_COLOR }}>
                        Search
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>

          {/* Summary KPIs */}
          {searched && (
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              {[
                { label: 'Total Cost',        value: summary.totalCost,        color: FA_COLOR,         icon: <DatabaseOutlined /> },
                { label: 'Deprn This Period', value: summary.totalDeprnAmount, color: REDWOOD.warning,  icon: <LineChartOutlined /> },
                { label: 'Total Reserve',     value: summary.totalDeprnReserve,color: REDWOOD.primary,  icon: <DollarOutlined /> },
                { label: 'Total NBV',         value: summary.totalNbv,         color: REDWOOD.info,     icon: <DollarOutlined /> },
              ].map(({ label, value, color, icon }) => (
                <Col xs={12} sm={6} key={label}>
                  <Card style={{ borderRadius: 10, border: 'none', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}
                    bodyStyle={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: `${color}15`, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        color, fontSize: 18, flexShrink: 0,
                      }}>{icon}</div>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{label}</Text>
                        <Text strong style={{ color, fontSize: 14 }}>{formatCurrency(value, 0)}</Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )}

          {/* Results table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            bodyStyle={{ padding: 0 }}
            title={
              searched
                ? <Text strong>Depreciation Records <Badge count={totalCount} style={{ backgroundColor: FA_COLOR }} /></Text>
                : <Text strong>Depreciation Records</Text>
            }
          >
            <Table<DeprnWorkbenchRecord>
              dataSource={rows}
              columns={columns}
              rowKey={(r) => `${r.assetId}-${r.bookTypeCode}-${r.periodCounter}`}
              loading={loading}
              size="small"
              scroll={{ x: 1300 }}
              locale={{ emptyText: searched ? 'No records found' : 'Select a book and search' }}
              pagination={{
                current: page,
                pageSize,
                total: totalCount,
                showSizeChanger: true,
                showTotal: (t) => `${t} records`,
                pageSizeOptions: ['25', '50', '100'],
                onChange: (p, ps) => { setPageSize(ps); runSearch(p, ps); },
              }}
            />
          </Card>
        </div>
      </Content>

      
    </Layout>
  );
};

export default Depreciation;
