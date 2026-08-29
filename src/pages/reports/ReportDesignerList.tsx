// ─────────────────────────────────────────────────────────────────────────────
// Report Designer — report catalog
// Lists reports stored in RR_REPORTS (APEX DB): search, filter by module,
// create, edit, run, duplicate and delete. The layout itself is edited in
// ReportDesignerStudio (/reports/designer/:id).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Input, Select,
  Space, Tag, message, Modal, Tooltip, Form, DatePicker, InputNumber, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, FileTextOutlined, SearchOutlined, ReloadOutlined, PlusOutlined,
  EditOutlined, DeleteOutlined, CopyOutlined, PlayCircleOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  listReports, getReport, deleteReport, saveReport, runReport,
  usingDemoRenderServer, REPORT_MODULES,
} from '../../services/reportDesigner.service';
import type { ReportSummary, ReportRecord, ReportUserParam } from '../../services/reportDesigner.service';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D', warning: '#B07700',
  neutral200: '#E5E5E5', neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const MODULE_COLORS: Record<string, string> = {
  GL: 'volcano', AP: 'orange', AR: 'green', FA: 'purple', CASH: 'blue',
  SCM: 'gold', INV: 'cyan', OM: 'magenta', GENERAL: 'default',
};

// Prompt-and-run dialog: asks for the report's user parameters, fetches the
// data, renders through the ReportBro service and opens the result.
const RunReportModal: React.FC<{
  report: ReportRecord | null;
  onClose: () => void;
}> = ({ report, onClose }) => {
  const [form] = Form.useForm();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const userParams: ReportUserParam[] = report?.data_source?.userParams ?? [];

  useEffect(() => {
    if (report) {
      setError('');
      const initial: Record<string, string> = {};
      for (const p of userParams) initial[p.name] = p.testValue ?? '';
      form.setFieldsValue(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  const run = async (format: 'pdf' | 'xlsx') => {
    if (!report) return;
    setRunning(true); setError('');
    try {
      const values = await form.validateFields();
      const paramValues: Record<string, string> = {};
      for (const p of userParams) {
        const v = values[p.name];
        paramValues[p.name] = v?.format ? v.format('YYYY-MM-DD') : String(v ?? '');
      }
      const blob = await runReport(report, paramValues, format);
      const url = URL.createObjectURL(blob);
      if (format === 'pdf') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${report.name.replace(/[^\w.-]+/g, '_')}.xlsx`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      message.success(`${report.name} rendered`);
      onClose();
    } catch (e: any) {
      if (e?.errorFields) { setRunning(false); return; } // form validation error
      setError(e?.message || 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={!!report}
      onCancel={onClose}
      title={<><PlayCircleOutlined style={{ color: REDWOOD.success, marginRight: 8 }} />Run — {report?.name}</>}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="xlsx" loading={running} onClick={() => run('xlsx')}>Run as Excel</Button>,
        <Button key="pdf" type="primary" loading={running} onClick={() => run('pdf')}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
          Run as PDF
        </Button>,
      ]}
    >
      {usingDemoRenderServer() && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="Rendering via the public ReportBro demo server"
          description="Set REACT_APP_REPORTBRO_SERVER_URL to your own render service before running reports over sensitive data." />
      )}
      {userParams.length === 0
        ? <Text type="secondary">This report has no parameters — it runs on the full data source query.</Text>
        : (
          <Form form={form} layout="vertical">
            {userParams.map(p => (
              <Form.Item key={p.name} name={p.name} label={p.label || p.name}
                rules={[{ required: true, message: `${p.label || p.name} is required` }]}>
                {p.type === 'number' ? <InputNumber style={{ width: '100%' }} />
                  : p.type === 'date' ? <DatePicker style={{ width: '100%' }} />
                  : <Input />}
              </Form.Item>
            ))}
          </Form>
        )}
      {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}
    </Modal>
  );
};

const ReportDesignerList: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string | undefined>();
  const [runTarget, setRunTarget] = useState<ReportRecord | null>(null);

  const load = useCallback(async (searchText?: string, mod?: string) => {
    setLoading(true);
    try {
      setRows(await listReports(searchText, mod));
    } catch (e: any) {
      message.error(e?.message || 'Failed to load reports — has database/reports/rr_report_designer.sql been installed?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRun = async (row: ReportSummary) => {
    try {
      const full = await getReport(row.id);
      if (!full.template) { message.warning('This report has no saved layout yet — open it in the designer first.'); return; }
      setRunTarget(full);
    } catch (e: any) {
      message.error(e?.message || 'Failed to load report');
    }
  };

  const onDuplicate = async (row: ReportSummary) => {
    try {
      const full = await getReport(row.id);
      const newId = await saveReport({
        name: `${full.name} (copy)`,
        description: full.description,
        module: full.module,
        output_format: full.output_format,
        status: full.status,
        data_source: full.data_source ?? undefined,
        template: full.template ?? undefined,
        user: user?.username,
      });
      message.success(`Duplicated as report #${newId}`);
      load(search, moduleFilter);
    } catch (e: any) {
      message.error(e?.message || 'Duplicate failed');
    }
  };

  const onDelete = (row: ReportSummary) => {
    Modal.confirm({
      title: `Delete report "${row.name}"?`,
      icon: <ExclamationCircleOutlined style={{ color: REDWOOD.primary }} />,
      content: 'The saved layout and data source definition will be permanently removed from the APEX database.',
      okText: 'Delete', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteReport(row.id);
          message.success('Report deleted');
          load(search, moduleFilter);
        } catch (e: any) {
          message.error(e?.message || 'Delete failed');
        }
      },
    });
  };

  const columns: ColumnsType<ReportSummary> = [
    { title: 'ID', dataIndex: 'id', width: 70, sorter: (a, b) => a.id - b.id },
    {
      title: 'Report Name', dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (v: string, row) => (
        <a onClick={() => navigate(`/reports/designer/${row.id}`)} style={{ fontWeight: 600 }}>
          <FileTextOutlined style={{ marginRight: 6, color: REDWOOD.info }} />{v}
        </a>
      ),
    },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    {
      title: 'Module', dataIndex: 'module', width: 100,
      render: (v: string) => <Tag color={MODULE_COLORS[v] || 'default'}>{v}</Tag>,
      filters: REPORT_MODULES.map(m => ({ text: m, value: m })),
      onFilter: (val, row) => row.module === val,
    },
    { title: 'Format', dataIndex: 'output_format', width: 85, render: (v: string) => <Tag>{(v || 'pdf').toUpperCase()}</Tag> },
    {
      title: 'Status', dataIndex: 'status', width: 95,
      render: (v: string) => <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v}</Tag>,
    },
    { title: 'Updated By', dataIndex: 'updated_by', width: 130 },
    {
      title: 'Updated', dataIndex: 'updated_on', width: 160,
      sorter: (a, b) => (a.updated_on || '').localeCompare(b.updated_on || ''),
      render: (v?: string) => v ? v.replace('T', ' ') : '',
    },
    {
      title: 'Actions', key: 'actions', width: 170, fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Tooltip title="Run report"><Button size="small" type="text" icon={<PlayCircleOutlined style={{ color: REDWOOD.success }} />} onClick={() => onRun(row)} /></Tooltip>
          <Tooltip title="Open in designer"><Button size="small" type="text" icon={<EditOutlined style={{ color: REDWOOD.info }} />} onClick={() => navigate(`/reports/designer/${row.id}`)} /></Tooltip>
          <Tooltip title="Duplicate"><Button size="small" type="text" icon={<CopyOutlined />} onClick={() => onDuplicate(row)} /></Tooltip>
          <Tooltip title="Delete"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(row)} /></Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Content style={{ padding: 24, background: '#F7F7F7', minHeight: '100%' }}>
      <Breadcrumb style={{ marginBottom: 12 }} items={[
        { title: <Link to="/home"><HomeOutlined /> Home</Link> },
        { title: 'Reports' },
        { title: 'Report Designer' },
      ]} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0, color: REDWOOD.neutral900 }}>
            <FileTextOutlined style={{ color: REDWOOD.primary, marginRight: 10 }} />Report Designer
          </Title>
          <Text type="secondary">Design, save and run pixel-perfect reports over Fusion REST and APEX data — stored in the APEX database (RR_REPORTS).</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} size="large"
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
          onClick={() => navigate('/reports/designer/new')}>
          New Report
        </Button>
      </div>

      <Card style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: 16 } }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input
            placeholder="Search name or description"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 280 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onPressEnter={() => load(search, moduleFilter)}
          />
          <Select
            placeholder="Module"
            allowClear
            style={{ width: 140 }}
            value={moduleFilter}
            onChange={v => { setModuleFilter(v); load(search, v); }}
            options={REPORT_MODULES.map(m => ({ value: m, label: m }))}
          />
          <Button icon={<SearchOutlined />} onClick={() => load(search, moduleFilter)}>Search</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { setSearch(''); setModuleFilter(undefined); load(); }}>Reset</Button>
        </Space>
        <Table<ReportSummary>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} reports` }}
        />
      </Card>

      <RunReportModal report={runTarget} onClose={() => setRunTarget(null)} />
    </Content>
  );
};

export default ReportDesignerList;
