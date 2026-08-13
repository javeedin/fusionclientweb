import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Tabs, Table, Tag, Badge, Button, Space, Typography, Tooltip,
  Collapse, Select, DatePicker, Empty, Alert, Modal,
} from 'antd';
import {
  WarningOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ReloadOutlined, ClearOutlined, InfoCircleOutlined, ApiOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../config/api.config';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useGlValidation } from '../context/GlValidationContext';
import {
  getValidationLogs,
  type GlValidationLogEntry,
  type GlValidationError,
  type ValidationCategory,
} from '../services/glValidation.service';

const { Text, Paragraph } = Typography;
const { Panel }           = Collapse;
const { RangePicker }     = DatePicker;

const CATEGORY_COLOR: Record<ValidationCategory, string> = {
  STRUCTURE:   'purple',
  BALANCE:     'red',
  ACCOUNT:     'orange',
  INTEGRITY:   'volcano',
  DUPLICATE:   'magenta',
  STATUS:      'gold',
  METADATA:    'geekblue',
  DESCRIPTION: 'cyan',
};

const MODULE_COLORS: Record<string, string> = {
  PC: 'blue', GL: 'green', AP: 'orange', FA: 'purple',
  AR: 'cyan', RM: 'geekblue', CASH: 'gold',
};

// ── Sub-components ────────────────────────────────────────────────────────────

const ErrorDetailPanel: React.FC<{ errors: GlValidationError[] | null }> = ({ errors }) => {
  if (!errors || errors.length === 0) return <Text type="secondary">No error details</Text>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {errors.map((e, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8, alignItems: 'flex-start',
          padding: '6px 10px',
          background: e.severity === 'ERROR' ? '#fff1f0' : '#fffbe6',
          borderLeft: `3px solid ${e.severity === 'ERROR' ? '#ff4d4f' : '#faad14'}`,
          borderRadius: 4,
        }}>
          <div style={{ flexShrink: 0, marginTop: 1 }}>
            {e.severity === 'ERROR'
              ? <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 13 }} />
              : <WarningOutlined     style={{ color: '#faad14', fontSize: 13 }} />}
          </div>
          <div>
            <Tag color={CATEGORY_COLOR[e.category]} style={{ fontSize: 10, padding: '0 4px', marginBottom: 2 }}>
              {e.category}
            </Tag>
            <Text style={{ fontSize: 12 }}>{e.message}</Text>
          </div>
        </div>
      ))}
    </div>
  );
};

const LogTable: React.FC<{ rows: GlValidationLogEntry[]; loading?: boolean }> = ({ rows, loading }) => {
  const columns: ColumnsType<GlValidationLogEntry> = [
    {
      title: 'Time',
      dataIndex: 'creationDate',
      width: 130,
      render: (v: string) => (
        <Text style={{ fontSize: 11, color: '#666' }}>
          {dayjs(v).format('MM-DD HH:mm:ss')}
        </Text>
      ),
    },
    {
      title: 'Module',
      dataIndex: 'module',
      width: 70,
      render: (v: string) => (
        <Tag color={MODULE_COLORS[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag>
      ),
    },
    {
      title: 'Reference',
      dataIndex: 'referenceNo',
      width: 140,
      render: (v: string | null) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v ?? '—'}</Text>
      ),
    },
    {
      title: 'Result',
      dataIndex: 'result',
      width: 80,
      render: (v: string) => v === 'FAILED'
        ? <Badge status="error"   text={<Text style={{ fontSize: 12, color: '#ff4d4f' }}>FAILED</Text>} />
        : <Badge status="success" text={<Text style={{ fontSize: 12, color: '#52c41a' }}>PASSED</Text>} />,
    },
    {
      title: 'Errors',
      width: 70,
      render: (_, r) => (
        <Space size={4}>
          {r.errorCount   > 0 && <Tag color="red"    style={{ fontSize: 11 }}>{r.errorCount}E</Tag>}
          {r.warningCount > 0 && <Tag color="orange" style={{ fontSize: 11 }}>{r.warningCount}W</Tag>}
          {r.errorCount === 0 && r.warningCount === 0 && <Text style={{ fontSize: 11, color: '#999' }}>—</Text>}
        </Space>
      ),
    },
    {
      title: 'Categories',
      dataIndex: 'errorCategories',
      render: (v: string | null) => v
        ? v.split(',').map(c => (
            <Tag key={c} color={CATEGORY_COLOR[c as ValidationCategory] ?? 'default'}
              style={{ fontSize: 10, padding: '0 4px', marginBottom: 2 }}>
              {c}
            </Tag>
          ))
        : <Text style={{ fontSize: 11, color: '#999' }}>—</Text>,
    },
    {
      title: 'By',
      dataIndex: 'createdBy',
      width: 110,
      render: (v: string | null) => <Text style={{ fontSize: 11 }}>{v ?? '—'}</Text>,
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={rows}
      rowKey="logId"
      loading={loading}
      size="small"
      pagination={{ pageSize: 20, size: 'small', showTotal: t => `${t} entries` }}
      expandable={{
        expandedRowRender: (r) => (
          <div style={{ padding: '8px 16px' }}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Batch: </Text>
              <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.batchName ?? '—'}</Text>
            </div>
            {r.errorSummary && (
              <Paragraph
                style={{ fontSize: 11, color: '#ff4d4f', background: '#fff1f0',
                  padding: '6px 10px', borderRadius: 4, marginBottom: 8, fontFamily: 'monospace' }}>
                {r.errorSummary}
              </Paragraph>
            )}
            <ErrorDetailPanel errors={r.errorDetail} />
          </div>
        ),
        rowExpandable: (r) => (r.errorCount > 0 || r.warningCount > 0),
      }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No entries" /> }}
    />
  );
};

// ── Main Drawer ───────────────────────────────────────────────────────────────

const GL_BASE = `${APEX_DB_CONFIG.baseUrl}/gl`;

const GlValidationErrorsDrawer: React.FC = () => {
  const { sessionErrors, clearSession, drawerOpen, closeDrawer } = useGlValidation();

  const [dbRows,     setDbRows]     = useState<GlValidationLogEntry[]>([]);
  const [dbLoading,  setDbLoading]  = useState(false);
  const [dbError,    setDbError]    = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<string>('session');
  const [filterMod,  setFilterMod]  = useState<string | undefined>();
  const [filterRes,  setFilterRes]  = useState<'FAILED' | 'PASSED' | undefined>();
  const [dateRange,  setDateRange]  = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [apiModalOpen, setApiModalOpen] = useState(false);

  const loadDbLogs = useCallback(async () => {
    setDbLoading(true);
    setDbError(null);
    try {
      const rows = await getValidationLogs({
        module:   filterMod,
        result:   filterRes,
        dateFrom: dateRange?.[0].format('YYYY-MM-DD'),
        dateTo:   dateRange?.[1].format('YYYY-MM-DD'),
        limit:    500,
      });
      setDbRows(rows);
    } catch (e: any) {
      setDbError(e?.message ?? 'Failed to load validation log');
    }
    setDbLoading(false);
  }, [filterMod, filterRes, dateRange]);

  useEffect(() => {
    if (drawerOpen && activeTab === 'db') loadDbLogs();
  }, [drawerOpen, activeTab, loadDbLogs]);

  const sessionFailed  = sessionErrors.filter(e => e.result === 'FAILED');
  const sessionPassed  = sessionErrors.filter(e => e.result === 'PASSED');

  const tabItems = [
    {
      key:   'session',
      label: (
        <span>
          Session
          {sessionFailed.length > 0
            ? <Badge count={sessionFailed.length} size="small" style={{ marginLeft: 6 }} />
            : sessionErrors.length > 0
            ? <Badge count={sessionErrors.length} color="#52c41a" size="small" style={{ marginLeft: 6 }} />
            : null}
        </span>
      ),
      children: (
        <div>
          {sessionErrors.length > 0 && (
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {sessionFailed.length} failed · {sessionPassed.length} passed this session
                </Text>
              </Space>
              <Button size="small" icon={<ClearOutlined />} onClick={clearSession}>Clear</Button>
            </div>
          )}
          <LogTable rows={sessionErrors} />
        </div>
      ),
    },
    {
      key:   'db',
      label: 'Database History',
      children: (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Select
              allowClear
              placeholder="Module"
              style={{ width: 110 }}
              size="small"
              value={filterMod}
              onChange={v => setFilterMod(v)}
              options={['PC','GL','AP','FA','AR','RM','CASH'].map(m => ({ value: m, label: m }))}
            />
            <Select
              allowClear
              placeholder="Result"
              style={{ width: 100 }}
              size="small"
              value={filterRes}
              onChange={v => setFilterRes(v)}
              options={[{ value: 'FAILED', label: 'FAILED' }, { value: 'PASSED', label: 'PASSED' }]}
            />
            <RangePicker
              size="small"
              style={{ width: 220 }}
              value={dateRange}
              onChange={v => setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            />
            <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={loadDbLogs} loading={dbLoading}>
              Refresh
            </Button>
          </div>
          {dbError && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message="Could not load history from database"
              description={dbError}
            />
          )}
          <LogTable rows={dbRows} loading={dbLoading} />
        </div>
      ),
    },
  ];

  return (
    <>
    <Modal
      open={apiModalOpen}
      onCancel={() => setApiModalOpen(false)}
      title={<Space><ApiOutlined style={{ color: '#1677ff' }} /><span>GL Validation Log — API Endpoints</span></Space>}
      footer={<Button onClick={() => setApiModalOpen(false)}>Close</Button>}
      width={620}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { method: 'GET',  label: 'Fetch log entries (Database History tab)', url: `${GL_BASE}/validation-log?module=&result=&date_from=&date_to=&limit=500` },
          { method: 'POST', label: 'Persist a new validation result',          url: `${GL_BASE}/validation-log` },
        ].map(ep => (
          <div key={ep.method} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: '10px 14px' }}>
            <Space style={{ marginBottom: 4 }}>
              <Tag color={ep.method === 'GET' ? 'blue' : 'green'} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ep.method}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{ep.label}</Text>
            </Space>
            <Text code copyable style={{ fontSize: 11, wordBreak: 'break-all', display: 'block' }}>{ep.url}</Text>
          </div>
        ))}
      </div>
    </Modal>
    <Drawer
      title={
        <Space>
          <WarningOutlined style={{ color: sessionFailed.length > 0 ? '#ff4d4f' : '#faad14' }} />
          <span>GL Journal Validation Log</span>
          <Tooltip title="Records every GL journal validation attempt across all modules. Errors here mean no journal was posted.">
            <InfoCircleOutlined style={{ color: '#999', fontSize: 13 }} />
          </Tooltip>
          <Tooltip title="Show API endpoints">
            <Button size="small" type="text" icon={<ApiOutlined style={{ color: '#1677ff' }} />} onClick={() => setApiModalOpen(true)} />
          </Tooltip>
        </Space>
      }
      open={drawerOpen}
      onClose={closeDrawer}
      width={900}
      styles={{ body: { padding: '12px 16px' } }}
      extra={
        <Button
          size="small"
          icon={sessionFailed.length === 0 ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          type={sessionFailed.length === 0 ? 'default' : 'primary'}
          danger={sessionFailed.length > 0}
          disabled
        >
          {sessionFailed.length === 0
            ? 'No failures this session'
            : `${sessionFailed.length} failure(s) this session`}
        </Button>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        items={tabItems}
      />
    </Drawer>
    </>
  );
};

export default GlValidationErrorsDrawer;
