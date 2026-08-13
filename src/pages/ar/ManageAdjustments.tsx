import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout, Card, Form, Select, Input, Button, Space, Typography, Table, Tag,
  Row, Col, Breadcrumb, Tooltip, DatePicker, message, Tabs, Divider,
} from 'antd';
import {
  HomeOutlined, SearchOutlined, CloseOutlined,
  FileTextOutlined, FilterOutlined, ReloadOutlined,
  DownloadOutlined, LockOutlined, EyeOutlined, AuditOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import FloatingMenu from '../../components/FloatingMenu';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

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
};

const APEX_ADJ = `${APEX_DB_CONFIG.baseUrl}/ar/adjustments`;

// ── Types ────────────────────────────────────────────────────────────────────

interface AdjRow {
  key:                  string;
  adjustmentId:         number;
  adjustmentNumber:     string;
  adjustmentType:       string;
  adjustmentAmount:     number;
  adjustmentDate:       string;
  accountingDate:       string;
  status:               string;
  receivablesActivity:  string;
  businessUnit:         string;
  customerTransactionId: number;
  transactionNumber:    string;
  transactionClass:     string;
  accountedAmount:      number;
  currency:             string;
  installmentNumber:    number;
  installmentBalance:   number;
  adjustmentReason:     string;
  approvedBy:           string;
  billToSiteUseId:      number;
  comments:             string;
  accountCombination:   string;
  fusionCreatedBy:      string;
  fusionCreationDate:   string;
  fusionLastUpdatedBy:  string;
  fusionLastUpdateDate: string;
  syncStatus:           string;
  syncDate:             string;
}

interface AdjTab {
  key: string;
  row: AdjRow;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return (n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusColor(s: string) {
  const m: Record<string, string> = {
    Approved: 'green',
    'More Research Required': 'orange',
    Rejected: 'red',
  };
  return m[s] || 'default';
}

function syncStatusColor(s: string) {
  const m: Record<string, string> = { NEW: 'green', UPDATED: 'blue', ERROR: 'red' };
  return m[(s || '').toUpperCase()] || 'default';
}

function labelVal(label: string, value: React.ReactNode) {
  return (
    <Row align="top" style={{ marginBottom: 8 }}>
      <Col span={9} style={{ textAlign: 'right', paddingRight: 10 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      </Col>
      <Col span={15}>
        <Text style={{ fontSize: 13 }}>{value ?? '—'}</Text>
      </Col>
    </Row>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const ManageAdjustments: React.FC = () => {
  const [searchForm] = Form.useForm();

  const [businessUnits, setBusinessUnits] = useState<string[]>([]);
  const [searchRows, setSearchRows]       = useState<AdjRow[]>([]);
  const [searching, setSearching]         = useState(false);
  const [tabs, setTabs]                   = useState<AdjTab[]>([]);
  const [activeKey, setActiveKey]         = useState<string>('search');
  const [gridFilter, setGridFilter]       = useState('');

  // Load business units
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        setBusinessUnits(
          ((data.items || []) as any[])
            .map((i: any) => i.business_unit_name || '')
            .filter(Boolean).sort()
        );
      })
      .catch(() => {});
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    const v = searchForm.getFieldsValue();
    setSearching(true);
    try {
      const p = new URLSearchParams();
      if (v.businessUnit)     p.set('business_unit',     v.businessUnit);
      if (v.adjustmentNumber) p.set('adjustment_number', v.adjustmentNumber.trim());
      if (v.transactionNumber)p.set('transaction_number',v.transactionNumber.trim());
      if (v.status)           p.set('status',            v.status);
      if (v.adjustmentType)   p.set('adjustment_type',   v.adjustmentType.trim());
      if (v.approvedBy)       p.set('approved_by',       v.approvedBy.trim());
      if (v.dateRange?.[0])   p.set('date_from', v.dateRange[0].format('YYYY-MM-DD'));
      if (v.dateRange?.[1])   p.set('date_to',   v.dateRange[1].format('YYYY-MM-DD'));
      p.set('limit', '500');

      const res  = await fetch(`${APEX_ADJ}?${p}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();

      const rows: AdjRow[] = ((data.items || []) as any[]).map((r: any, i: number) => ({
        key:                   String(r.adjustment_id ?? i),
        adjustmentId:          r.adjustment_id          ?? 0,
        adjustmentNumber:      r.adjustment_number      ?? '',
        adjustmentType:        r.adjustment_type        ?? '',
        adjustmentAmount:      r.adjustment_amount      ?? 0,
        adjustmentDate:        (r.adjustment_date  || '').slice(0, 10),
        accountingDate:        (r.accounting_date  || '').slice(0, 10),
        status:                r.status                 ?? '',
        receivablesActivity:   r.receivables_activity   ?? '',
        businessUnit:          r.business_unit          ?? '',
        customerTransactionId: r.customer_transaction_id ?? 0,
        transactionNumber:     r.transaction_number     ?? '',
        transactionClass:      r.transaction_class      ?? '',
        accountedAmount:       r.accounted_amount       ?? 0,
        currency:              r.currency               ?? '',
        installmentNumber:     r.installment_number     ?? 0,
        installmentBalance:    r.installment_balance    ?? 0,
        adjustmentReason:      r.adjustment_reason      ?? '',
        approvedBy:            r.approved_by            ?? '',
        billToSiteUseId:       r.bill_to_site_use_id    ?? 0,
        comments:              r.comments               ?? '',
        accountCombination:    r.account_combination    ?? '',
        fusionCreatedBy:       r.fusion_created_by      ?? '',
        fusionCreationDate:    (r.fusion_creation_date  || '').slice(0, 19).replace('T', ' '),
        fusionLastUpdatedBy:   r.fusion_last_updated_by ?? '',
        fusionLastUpdateDate:  (r.fusion_last_update_date || '').slice(0, 19).replace('T', ' '),
        syncStatus:            r.sync_status            ?? '',
        syncDate:              (r.sync_date             || '').slice(0, 10),
      }));

      setSearchRows(rows);
      if (rows.length === 0) message.info('No adjustments found');
    } catch (e: any) { message.error(`Search failed: ${e.message}`); }
    finally { setSearching(false); }
  };

  // ── Open tab ──────────────────────────────────────────────────────────────
  const openTab = useCallback((row: AdjRow) => {
    const key = `adj-${row.adjustmentId}`;
    if (tabs.find(t => t.key === key)) { setActiveKey(key); return; }
    setTabs(prev => [...prev, { key, row }]);
    setActiveKey(key);
  }, [tabs]);

  // ── Close tab ─────────────────────────────────────────────────────────────
  const closeTab = (key: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.key !== key);
      if (activeKey === key) setActiveKey(next.length > 0 ? next[next.length - 1].key : 'search');
      return next;
    });
  };

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportToExcel = (rows: AdjRow[]) => {
    const headers = [
      'Adj #', 'Adj Type', 'Adj Date', 'Accounting Date', 'Status',
      'Transaction #', 'Transaction Class', 'Business Unit', 'Currency',
      'Adj Amount', 'Accounted Amount', 'Installment Balance',
      'Receivables Activity', 'Adjustment Reason', 'Approved By',
      'Account Combination', 'Sync Status', 'Sync Date',
    ];
    const data = rows.map(r => [
      r.adjustmentNumber, r.adjustmentType, r.adjustmentDate, r.accountingDate, r.status,
      r.transactionNumber, r.transactionClass, r.businessUnit, r.currency,
      r.adjustmentAmount, r.accountedAmount, r.installmentBalance,
      r.receivablesActivity, r.adjustmentReason, r.approvedBy,
      r.accountCombination, r.syncStatus, r.syncDate,
    ]);
    const totalAdj      = rows.reduce((s, r) => s + (r.adjustmentAmount ?? 0), 0);
    const totalAccounted = rows.reduce((s, r) => s + (r.accountedAmount  ?? 0), 0);
    const totals = [
      `Total (${rows.length})`, '', '', '', '',
      '', '', '', '',
      totalAdj, totalAccounted, '',
      '', '', '', '', '', '',
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data, totals]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 28 },
      { wch: 14 }, { wch: 16 }, { wch: 32 }, { wch: 8 },
      { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 28 }, { wch: 20 }, { wch: 20 },
      { wch: 36 }, { wch: 10 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AR Adjustments');
    XLSX.writeFile(wb, `AR_Adjustments_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
  };

  // ── Filter rows ───────────────────────────────────────────────────────────
  const filteredRows = gridFilter.trim()
    ? searchRows.filter(r => {
        const q = gridFilter.trim().toUpperCase();
        return (
          r.adjustmentNumber.toUpperCase().includes(q) ||
          r.transactionNumber.toUpperCase().includes(q) ||
          r.adjustmentType.toUpperCase().includes(q) ||
          r.status.toUpperCase().includes(q) ||
          r.businessUnit.toUpperCase().includes(q) ||
          r.approvedBy.toUpperCase().includes(q)
        );
      })
    : searchRows;

  // ── Summary totals ────────────────────────────────────────────────────────
  const totalAdjAmount  = filteredRows.reduce((s, r) => s + (r.adjustmentAmount  ?? 0), 0);
  const totalAccounted  = filteredRows.reduce((s, r) => s + (r.accountedAmount   ?? 0), 0);
  const totalInstBal    = filteredRows.reduce((s, r) => s + (r.installmentBalance ?? 0), 0);

  // ── Search columns ────────────────────────────────────────────────────────
  const searchColumns: ColumnsType<AdjRow> = [
    { title: '#', key: 'seq', width: 42, fixed: 'left',
      render: (_,__,i) => <Text type="secondary" style={{ fontSize: 12 }}>{i + 1}</Text> },
    { title: 'Adj #', dataIndex: 'adjustmentNumber', width: 110, fixed: 'left',
      render: (v, r) => (
        <Button type="link" style={{ padding: 0, fontSize: 12, fontWeight: 600 }}
          onClick={() => openTab(r)}>{v || '—'}</Button>
      ) },
    { title: 'Adj Type', dataIndex: 'adjustmentType', width: 160, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Adj Date', dataIndex: 'adjustmentDate', width: 100,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Status', dataIndex: 'status', width: 170,
      render: v => <Tag color={statusColor(v)} style={{ fontSize: 11 }}>{v || '—'}</Tag> },
    { title: 'Txn #', dataIndex: 'transactionNumber', width: 100,
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v || '—'}</Text> },
    { title: 'CCY', dataIndex: 'currency', width: 60,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Adj Amount', dataIndex: 'adjustmentAmount', width: 130, align: 'right',
      render: v => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
          color: v < 0 ? REDWOOD.primary : 'inherit' }}>{fmt(v)}</Text>
      ) },
    { title: 'Inst Balance', dataIndex: 'installmentBalance', width: 120, align: 'right',
      render: v => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{fmt(v)}</Text> },
    { title: 'Activity', dataIndex: 'receivablesActivity', width: 180, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Approved By', dataIndex: 'approvedBy', width: 140, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Business Unit', dataIndex: 'businessUnit', width: 200, ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Sync', dataIndex: 'syncStatus', width: 70,
      render: v => v ? <Tag color={syncStatusColor(v)} style={{ fontSize: 11 }}>{v}</Tag>
                     : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
    { title: '', key: 'open', width: 46, fixed: 'right',
      render: (_, r) => (
        <Tooltip title="Open adjustment">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openTab(r)} />
        </Tooltip>
      ) },
  ];

  // ── Adjustment detail panel ───────────────────────────────────────────────
  const renderAdjPanel = (tab: AdjTab) => {
    const { row } = tab;
    return (
      <div style={{ padding: '0 8px' }}>
        {/* Header toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          marginBottom: 16,
          padding: '10px 16px',
          background: REDWOOD.neutral100,
          borderRadius: 8,
          border: `1px solid ${REDWOOD.border}`,
        }}>
          <AuditOutlined style={{ fontSize: 18, color: REDWOOD.primary }} />
          <Text style={{ fontSize: 18, fontWeight: 700, color: REDWOOD.primary }}>
            {row.adjustmentNumber || `Adj ${row.adjustmentId}`}
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            ID: {row.adjustmentId}
          </Text>
          <Tag icon={<LockOutlined />} color="default" style={{ fontSize: 12 }}>
            Read Only
          </Tag>
          {row.status && (
            <Tag color={statusColor(row.status)} style={{ fontSize: 12 }}>
              {row.status}
            </Tag>
          )}
          {row.syncStatus && (
            <Tag color={syncStatusColor(row.syncStatus)} style={{ fontSize: 12 }}>
              Sync: {row.syncStatus}
            </Tag>
          )}
        </div>

        {/* Detail sections */}
        <Row gutter={[16, 16]}>
          {/* Left column */}
          <Col xs={24} lg={12}>
            <Card size="small" title="Adjustment Details"
              style={{ borderRadius: 8, marginBottom: 16 }}>
              {labelVal('Adjustment Number', <Text strong>{row.adjustmentNumber}</Text>)}
              {labelVal('Adjustment Type',   row.adjustmentType)}
              {labelVal('Adjustment Date',   row.adjustmentDate)}
              {labelVal('Accounting Date',   row.accountingDate)}
              {labelVal('Status',
                <Tag color={statusColor(row.status)}>{row.status || '—'}</Tag>
              )}
              {labelVal('Receivables Activity', row.receivablesActivity)}
              {labelVal('Adjustment Reason',    row.adjustmentReason)}
              {labelVal('Approved By',          row.approvedBy)}
              {labelVal('Comments',             row.comments || '—')}
            </Card>

            <Card size="small" title="Financial"
              style={{ borderRadius: 8, marginBottom: 16 }}>
              {labelVal('Currency',           row.currency)}
              {labelVal('Adjustment Amount',
                <Text style={{ fontFamily: 'monospace', fontWeight: 700,
                  color: row.adjustmentAmount < 0 ? REDWOOD.primary : REDWOOD.success }}>
                  {fmt(row.adjustmentAmount)}
                </Text>
              )}
              {labelVal('Accounted Amount',
                <Text style={{ fontFamily: 'monospace' }}>{fmt(row.accountedAmount)}</Text>
              )}
              {labelVal('Installment #',       String(row.installmentNumber || '—'))}
              {labelVal('Installment Balance',
                <Text style={{ fontFamily: 'monospace' }}>{fmt(row.installmentBalance)}</Text>
              )}
              {labelVal('Account Combination',
                <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{row.accountCombination || '—'}</Text>
              )}
            </Card>
          </Col>

          {/* Right column */}
          <Col xs={24} lg={12}>
            <Card size="small" title="Transaction Reference"
              style={{ borderRadius: 8, marginBottom: 16 }}>
              {labelVal('Transaction Number', <Text strong>{row.transactionNumber || '—'}</Text>)}
              {labelVal('Transaction Class',  row.transactionClass)}
              {labelVal('Customer Txn ID',    String(row.customerTransactionId || '—'))}
              {labelVal('Bill-To Site Use ID',String(row.billToSiteUseId || '—'))}
              {labelVal('Business Unit',      row.businessUnit)}
            </Card>

            <Card size="small" title="Audit & Sync"
              style={{ borderRadius: 8 }}>
              {labelVal('Created By',       row.fusionCreatedBy)}
              {labelVal('Creation Date',    row.fusionCreationDate)}
              {labelVal('Last Updated By',  row.fusionLastUpdatedBy)}
              {labelVal('Last Update Date', row.fusionLastUpdateDate)}
              <Divider style={{ margin: '8px 0' }} />
              {labelVal('Sync Status',
                row.syncStatus
                  ? <Tag color={syncStatusColor(row.syncStatus)}>{row.syncStatus}</Tag>
                  : <Text type="secondary">—</Text>
              )}
              {labelVal('Sync Date', row.syncDate || '—')}
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const tabItems = [
    {
      key: 'search',
      label: (
        <span><FileTextOutlined style={{ marginRight: 4 }} />Search</span>
      ),
      children: (
        <div>
          {/* Search form */}
          <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
            <Form form={searchForm} layout="vertical" onFinish={handleSearch}>
              <Row gutter={[12, 0]}>
                {/* Business Unit — first and prominent */}
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Business Unit" name="businessUnit">
                    <Select allowClear showSearch placeholder="All Business Units"
                      optionFilterProp="children" style={{ width: '100%' }}>
                      {businessUnits.map(bu => <Option key={bu} value={bu}>{bu}</Option>)}
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Status" name="status">
                    <Select allowClear placeholder="All Statuses">
                      <Option value="Approved">Approved</Option>
                      <Option value="More Research Required">More Research Required</Option>
                      <Option value="Rejected">Rejected</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Adjustment Number" name="adjustmentNumber">
                    <Input allowClear placeholder="e.g. 46002" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Transaction Number" name="transactionNumber">
                    <Input allowClear placeholder="e.g. 16038" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Adjustment Type" name="adjustmentType">
                    <Input allowClear placeholder="e.g. Invoice Adjustments" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Approved By" name="approvedBy">
                    <Input allowClear placeholder="Approver name" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="Adjustment Date Range" name="dateRange">
                    <RangePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={24} md={8} lg={6}
                  style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                  <Space>
                    <Button type="primary" icon={<SearchOutlined />}
                      htmlType="submit" loading={searching}
                      style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                      Search
                    </Button>
                    <Button icon={<FilterOutlined />} onClick={() => {
                      searchForm.resetFields();
                      setSearchRows([]);
                      setGridFilter('');
                    }}>
                      Clear
                    </Button>
                  </Space>
                </Col>
              </Row>
            </Form>
          </Card>

          {/* Results toolbar */}
          {searchRows.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              marginBottom: 8,
            }}>
              <Input
                prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                placeholder="Filter results..."
                value={gridFilter}
                onChange={e => setGridFilter(e.target.value)}
                allowClear
                style={{ width: 240 }}
                size="small"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {filteredRows.length} of {searchRows.length} adjustments
              </Text>
              <div style={{ flex: 1 }} />
              {/* Summary */}
              <Space size={16}>
                <Text style={{ fontSize: 12 }}>
                  Adj Total: <Text strong style={{ fontFamily: 'monospace', color: REDWOOD.primary }}>
                    {fmt(totalAdjAmount)}
                  </Text>
                </Text>
                <Text style={{ fontSize: 12 }}>
                  Accounted: <Text strong style={{ fontFamily: 'monospace' }}>
                    {fmt(totalAccounted)}
                  </Text>
                </Text>
                <Text style={{ fontSize: 12 }}>
                  Inst Balance: <Text strong style={{ fontFamily: 'monospace' }}>
                    {fmt(totalInstBal)}
                  </Text>
                </Text>
              </Space>
              <Button size="small" icon={<DownloadOutlined />}
                onClick={() => exportToExcel(filteredRows)}>
                Export
              </Button>
              <Button size="small" icon={<ReloadOutlined />}
                loading={searching} onClick={handleSearch}>
                Refresh
              </Button>
            </div>
          )}

          {/* Results table */}
          <Table
            dataSource={filteredRows}
            columns={searchColumns}
            size="small"
            scroll={{ x: 1600 }}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} records` }}
            loading={searching}
            rowKey="key"
            style={{ borderRadius: 8, overflow: 'hidden' }}
          />
        </div>
      ),
    },
    ...tabs.map(tab => ({
      key: tab.key,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <AuditOutlined style={{ fontSize: 12, color: REDWOOD.primary }} />
          <span style={{ fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tab.row.adjustmentNumber || `Adj ${tab.row.adjustmentId}`}
          </span>
          <CloseOutlined
            style={{ fontSize: 10, color: REDWOOD.neutral600, marginLeft: 2 }}
            onClick={e => { e.stopPropagation(); closeTab(tab.key); }}
          />
        </span>
      ),
      children: renderAdjPanel(tab),
    })),
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{
          padding: '12px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb items={[
            { title: <Link to="/"><HomeOutlined /> Home</Link> },
            { title: <Link to="/ar">Accounts Receivable</Link> },
            { title: 'Manage Adjustments' },
          ]} />
        </div>

        <div style={{ padding: 16 }}>
          {/* Page header */}
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, #E85D4A 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
            }}>
              <AuditOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0, color: REDWOOD.primary }}>Manage Adjustments</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Search and view AR adjustments synced from Oracle Fusion
              </Text>
            </div>
          </div>

          {/* Main tabs */}
          <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: '0 12px 12px' }}>
            <Tabs
              activeKey={activeKey}
              onChange={setActiveKey}
              items={tabItems}
              type="card"
              style={{ marginTop: 8 }}
            />
          </Card>
        </div>
      </Content>
      <FloatingMenu />
    </Layout>
  );
};

export default ManageAdjustments;
