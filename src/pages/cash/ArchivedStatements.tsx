// Cash Management — Archived Statements: search the archived bank reconciliations and open each one in its
// own tab (header, summary, account analysis snapshot, manual reconciled data, attachments).
// Database: database/cash/170_cm_archive_bank_statements.sql
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert, Breadcrumb, Button, Card, Col, DatePicker, Empty, Input, Layout, Row, Segmented, Select, Space, Table, Tabs, Tag, Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BankOutlined, CheckCircleOutlined, ContainerOutlined, FileExcelOutlined, HomeOutlined, PaperClipOutlined, ReloadOutlined,
  SearchOutlined, WarningOutlined,
} from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { useAuth } from '../../context/AuthContext';
import ArchiveDetail from './archive/ArchiveDetail';
import ArchiveApiButton from './archive/ArchiveApiButton';
import { ArchiveHeader, INSTALL_SCRIPT, archiveNotInstalled, cmQuery, loadArchives } from '../../services/cmArchive.service';

const { Content } = Layout;
const { Title, Text } = Typography;
const RED = '#C74634';
const GREEN = '#1D7B4D';
const BLUE = '#0572CE';

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v?: string | null) => (v ? dayjs(String(v).slice(0, 10)).format('DD-MMM-YYYY') : '—');
const balanced = (a: ArchiveHeader) => a.DIFFERENCE !== null && Math.abs(a.DIFFERENCE) < 0.005;

interface OpenTab { key: string; id: number; label: string }

const ArchivedStatements: React.FC = () => {
  const { user } = useAuth();
  const currentUser = user?.username || user?.email || 'CASH';
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<ArchiveHeader[]>([]);
  const [loading, setLoading] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lov, setLov] = useState<{ bus: string[]; banks: { name: string; number: string | null; bu: string | null }[] }>({ bus: [], banks: [] });
  const [bu, setBu] = useState<string | undefined>();
  const [bank, setBank] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [status, setStatus] = useState<'ARCHIVED' | 'CANCELLED' | 'ALL'>('ARCHIVED');
  const [text, setText] = useState('');
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [active, setActive] = useState('search');

  const search = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await loadArchives({
        businessUnit: bu, bankAccount: bank, status,
        statementFrom: range?.[0]?.format('YYYY-MM-DD'), statementTo: range?.[1]?.format('YYYY-MM-DD'),
      }));
      setInstalled(true);
    } catch (e: any) {
      if (archiveNotInstalled(e)) setInstalled(false); else setError(e.message);
    } finally { setLoading(false); }
  }, [bu, bank, range, status]);

  // filter lists from what has been archived
  useEffect(() => {
    cmQuery(`SELECT DISTINCT BUSINESS_UNIT_NAME, BANK_ACCOUNT_NAME, BANK_ACCOUNT_NUMBER FROM RR_CM_V_ARCHIVES ORDER BY BUSINESS_UNIT_NAME, BANK_ACCOUNT_NAME`)
      .then(r => setLov({
        bus: Array.from(new Set(r.map(x => String(x.BUSINESS_UNIT_NAME || '')).filter(Boolean))),
        banks: r.filter(x => x.BANK_ACCOUNT_NAME).map(x => ({ name: String(x.BANK_ACCOUNT_NAME), number: x.BANK_ACCOUNT_NUMBER ?? null, bu: x.BUSINESS_UNIT_NAME ?? null })),
      }))
      .catch(e => { if (archiveNotInstalled(e)) setInstalled(false); });
  }, []);
  useEffect(() => { search(); }, [status]);   // eslint-disable-line react-hooks/exhaustive-deps

  const openTab = useCallback((id: number, label: string) => {
    const key = `arc-${id}`;
    setTabs(t => (t.some(x => x.key === key) ? t : [...t, { key, id, label }]));
    setActive(key);
  }, []);
  const closeTab = (key: string) => {
    setTabs(t => {
      const next = t.filter(x => x.key !== key);
      if (active === key) setActive(next.length ? next[next.length - 1].key : 'search');
      return next;
    });
  };
  // deep link: /cash/archived-statements?id=123
  useEffect(() => {
    const id = Number(params.get('id'));
    if (id) { openTab(id, `Archive ${id}`); params.delete('id'); setParams(params, { replace: true }); }
  }, [params, setParams, openTab]);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return q ? rows.filter(r => [r.ARCHIVE_NUMBER, r.STATEMENT_NUMBER, r.BANK_ACCOUNT_NAME, r.BANK_ACCOUNT_NUMBER, r.COMMENTS, r.CREATED_BY]
      .some(v => String(v || '').toLowerCase().includes(q))) : rows;
  }, [rows, text]);

  const stats = [
    { label: 'Archives', value: shown.length, icon: <ContainerOutlined />, color: BLUE },
    { label: 'Bank accounts', value: new Set(shown.map(r => r.BANK_ACCOUNT_NAME)).size, icon: <BankOutlined />, color: BLUE },
    { label: 'Bank agrees with GL', value: shown.filter(balanced).length, icon: <CheckCircleOutlined />, color: GREEN },
    { label: 'With a difference', value: shown.filter(r => r.DIFFERENCE !== null && !balanced(r)).length, icon: <WarningOutlined />, color: RED },
  ];

  const exportList = () => {
    const ws = XLSX.utils.json_to_sheet(shown.map(r => ({
      Archive: r.ARCHIVE_NUMBER, Status: r.STATUS, Statement: r.STATEMENT_NUMBER, 'Statement date': String(r.STATEMENT_DATE || '').slice(0, 10),
      'Business unit': r.BUSINESS_UNIT_NAME, 'Bank account': r.BANK_ACCOUNT_NAME, 'Account number': r.BANK_ACCOUNT_NUMBER, Currency: r.CURRENCY_CODE,
      'Date from': String(r.DATE_FROM || '').slice(0, 10), 'Date to': String(r.DATE_TO || '').slice(0, 10),
      'Reconciled date': String(r.RECONCILED_DATE || '').slice(0, 10), 'Bank closing': r.STMT_CLOSING_BALANCE, 'GL closing': r.GL_CLOSING_BALANCE,
      Difference: r.DIFFERENCE, 'GL lines': r.GL_LINE_COUNT, 'Manual rows': r.MANUAL_LINES, Attachments: r.ATTACHMENTS, Comments: r.COMMENTS,
      'Archived by': r.CREATED_BY, 'Archived on': String(r.CREATION_DATE || '').replace('T', ' ').slice(0, 16),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Archived Statements');
    saveAs(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Archived_Statements_${dayjs().format('YYYYMMDD')}.xlsx`);
  };

  const columns: ColumnsType<ArchiveHeader> = [
    { title: 'Archive', dataIndex: 'ARCHIVE_NUMBER', width: 120, fixed: 'left',
      render: (v, r) => <a onClick={e => { e.stopPropagation(); openTab(r.ARCHIVE_ID, v); }}>{v}</a> },
    { title: 'Statement', dataIndex: 'STATEMENT_NUMBER', width: 190, ellipsis: true },
    { title: 'Business unit', dataIndex: 'BUSINESS_UNIT_NAME', width: 200, ellipsis: true, render: v => <span style={{ fontSize: 12 }}>{v}</span> },
    { title: 'Bank account', dataIndex: 'BANK_ACCOUNT_NAME', width: 260, ellipsis: true,
      render: (v, r) => <Tooltip title={`${v}${r.BANK_ACCOUNT_NUMBER ? ` · ${r.BANK_ACCOUNT_NUMBER}` : ''}`}><span style={{ fontSize: 12 }}>{v}</span></Tooltip> },
    { title: 'Period', width: 190, render: (_, r) => <span style={{ fontSize: 12 }}>{fmtDate(r.DATE_FROM)} – {fmtDate(r.DATE_TO)}</span> },
    { title: 'Statement date', dataIndex: 'STATEMENT_DATE', width: 115, render: fmtDate,
      sorter: (a, b) => String(a.STATEMENT_DATE).localeCompare(String(b.STATEMENT_DATE)) },
    { title: 'Reconciled', dataIndex: 'RECONCILED_DATE', width: 110, render: fmtDate },
    { title: 'Bank closing', dataIndex: 'STMT_CLOSING_BALANCE', width: 130, align: 'right', render: fmt },
    { title: 'GL closing', dataIndex: 'GL_CLOSING_BALANCE', width: 130, align: 'right', render: fmt },
    { title: 'Difference', dataIndex: 'DIFFERENCE', width: 130, align: 'right',
      sorter: (a, b) => Math.abs(a.DIFFERENCE ?? 0) - Math.abs(b.DIFFERENCE ?? 0),
      render: (v, r) => v === null ? <Text type="secondary">—</Text>
        : balanced(r) ? <Tag color="green" style={{ margin: 0 }}>0.00</Tag> : <Tag color="red" style={{ margin: 0 }}>{fmt(v)}</Tag> },
    { title: 'GL lines', dataIndex: 'GL_LINE_COUNT', width: 80, align: 'right' },
    { title: 'Manual', dataIndex: 'MANUAL_LINES', width: 75, align: 'right', render: v => v || <Text type="secondary">—</Text> },
    { title: <PaperClipOutlined />, dataIndex: 'ATTACHMENTS', width: 50, align: 'center', render: v => v || <Text type="secondary">—</Text> },
    { title: 'Status', dataIndex: 'STATUS', width: 100, render: v => <Tag color={v === 'ARCHIVED' ? 'green' : 'red'}>{v}</Tag> },
    { title: 'Archived', width: 170, render: (_, r) => <span style={{ fontSize: 12 }}>{fmtDate(r.CREATION_DATE)}<br /><Text type="secondary" style={{ fontSize: 11 }}>{r.CREATED_BY}</Text></span> },
  ];

  const searchTab = (
    <div>
      {!installed && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Bank reconciliation archive is not installed in the database"
        description={<span>Run <code>database/cash/169_cm_execute.sql</code> (the <code>cash/execute</code> web service) and then <code>{INSTALL_SCRIPT}</code>.
          Use the <b>API</b> button to check each web service. Then archive a statement from Bank Reconciliation with the <ContainerOutlined /> Archive button.</span>} />}
      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 10 }} title={<Space><SearchOutlined />Search</Space>}>
        <Row gutter={[12, 12]} align="bottom">
          <Col xs={24} md={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>Business unit</Text>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="All" value={bu} onChange={v => { setBu(v); setBank(undefined); }}
              options={lov.bus.map(b => ({ value: b, label: b }))} />
          </Col>
          <Col xs={24} md={7}>
            <Text type="secondary" style={{ fontSize: 12 }}>Bank account</Text>
            <Select allowClear showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="All" value={bank} onChange={setBank}
              options={lov.banks.filter(b => !bu || b.bu === bu).map(b => ({ value: b.name, label: `${b.name}${b.number ? ` · ${b.number}` : ''}` }))} />
          </Col>
          <Col xs={24} md={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>Statement date</Text>
            <DatePicker.RangePicker style={{ width: '100%' }} format="DD-MMM-YYYY" value={range} onChange={v => setRange(v as typeof range)} />
          </Col>
          <Col xs={24} md={5}>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={search} style={{ background: RED, borderColor: RED }}>Search</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setBu(undefined); setBank(undefined); setRange(null); setText(''); setStatus('ARCHIVED'); setTimeout(search, 0); }}>Reset</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {stats.map(s => (
          <Col key={s.label} xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 10 }}>
              <Space>
                <div style={{ fontSize: 20, color: s.color }}>{s.icon}</div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{s.label}</Text>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color, lineHeight: 1.2 }}>{s.value}</div>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" style={{ borderRadius: 10 }}
        title={<Space wrap>
          <Text strong>Archived statements</Text>
          <Segmented size="small" value={status} onChange={v => setStatus(v as typeof status)}
            options={[{ value: 'ARCHIVED', label: 'Archived' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} />
          <Input allowClear prefix={<SearchOutlined />} placeholder="Archive #, statement #, comments…" style={{ width: 260 }} value={text} onChange={e => setText(e.target.value)} />
        </Space>}
        extra={<Button size="small" icon={<FileExcelOutlined />} disabled={!shown.length} onClick={exportList}>Export</Button>}>
        <Table<ArchiveHeader> size="small" rowKey="ARCHIVE_ID" loading={loading} dataSource={shown} columns={columns}
          scroll={{ x: 2050 }} pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} archive(s)` }}
          onRow={r => ({ onDoubleClick: () => openTab(r.ARCHIVE_ID, r.ARCHIVE_NUMBER), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={installed ? 'No archived statements match' : 'Not installed'} /> }} />
        <Text type="secondary" style={{ fontSize: 12 }}>Click an archive number or double-click a row to open it in its own tab.</Text>
      </Card>
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh', backgroundColor: '#F7F7F7' }}>
      <Content style={{ padding: '16px 24px' }}>
        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <Link to="/"><HomeOutlined /> Home</Link> },
          { title: <Link to="/cash"><BankOutlined /> Cash Management</Link> },
          { title: 'Archived Statements' },
        ]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <Space align="center">
          <div style={{ width: 44, height: 44, borderRadius: 10, background: RED, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            <ContainerOutlined />
          </div>
          <div>
            <Title level={4} style={{ margin: 0 }}>Archived Statements</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>Archived bank reconciliations — account analysis, manual reconciled data and attachments</Text>
          </div>
        </Space>
        <ArchiveApiButton />
        </div>
        <Card style={{ borderRadius: 10 }} styles={{ body: { padding: '4px 16px 16px' } }}>
          <Tabs type="editable-card" hideAdd activeKey={active} onChange={setActive}
            onEdit={(key, action) => { if (action === 'remove') closeTab(String(key)); }}
            items={[
              { key: 'search', label: <span><SearchOutlined /> Search</span>, closable: false, children: searchTab },
              ...tabs.map(t => ({
                key: t.key, label: <span><ContainerOutlined /> {t.label}</span>,
                children: <ArchiveDetail archiveId={t.id} user={currentUser}
                  onLoaded={h => setTabs(x => x.map(y => (y.id === h.ARCHIVE_ID && y.label !== h.ARCHIVE_NUMBER ? { ...y, label: h.ARCHIVE_NUMBER } : y)))}
                  onSaved={(id, number) => { if (number) setTabs(x => x.map(y => (y.id === id ? { ...y, label: number } : y))); search(); }}
                  onClose={() => closeTab(t.key)} />,
              })),
            ]} />
        </Card>
      </Content>
    </Layout>
  );
};

export default ArchivedStatements;
