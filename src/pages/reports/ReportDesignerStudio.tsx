// ─────────────────────────────────────────────────────────────────────────────
// Report Designer — studio
// Embeds the ReportBro drag-and-drop designer for one report. The header
// toolbar manages report metadata (name, module, format, status), the Data
// Source drawer wires the report to a Fusion REST / APEX ORDS query and
// builds the report's data parameters from a sample fetch, Save persists the
// definition to RR_REPORTS through ORDS, and Run renders live output.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout, Typography, Button, Input, Select, Space, message, Drawer, Form,
  InputNumber, Alert, Table, Modal, Spin, Tooltip, Tag, DatePicker,
} from 'antd';
import {
  ArrowLeftOutlined, SaveOutlined, DatabaseOutlined, PlayCircleOutlined,
  ThunderboltOutlined, DeleteOutlined, PlusOutlined, FileTextOutlined,
  CopyOutlined, ApiOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import 'reportbro-designer/dist/reportbro.css';
import * as ReportBroModule from 'reportbro-designer';
import {
  getReport, saveReport, fetchDataSourceRows, mergeDataParameters, renderReport,
  extractPlaceholders, usingDemoRenderServer, REPORTBRO_SERVER_URL,
  REPORT_MODULES, DEFAULT_DATA_SOURCE, listWebServices, refreshWebServices,
  buildDataSourceUrl,
} from '../../services/reportDesigner.service';
import type { ReportDataSource, ReportUserParam, WebServiceDef } from '../../services/reportDesigner.service';
import { FUSION_SERVICES } from '../../data/fusionServices';
import { jsonrepair } from 'jsonrepair';

const { Content } = Layout;
const { Text } = Typography;

const REDWOOD = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D', warning: '#B07700',
  neutral200: '#E5E5E5', neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

// The dist bundle exports { ReportBro } under CJS and window.ReportBro as a
// script tag — resolve whichever interop Vite hands us.
const ReportBroCtor: any =
  (ReportBroModule as any).ReportBro ||
  (ReportBroModule as any).default?.ReportBro ||
  (ReportBroModule as any).default ||
  (window as any).ReportBro;

const ReportDesignerStudio: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const containerRef = useRef<HTMLDivElement>(null);
  const rbRef = useRef<any>(null);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [reportId, setReportId] = useState<number | null>(isNew ? null : Number(id));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [module, setModule] = useState('GENERAL');
  const [outputFormat, setOutputFormat] = useState('pdf');
  const [status, setStatus] = useState('ACTIVE');
  const [dataSource, setDataSource] = useState<ReportDataSource>({ ...DEFAULT_DATA_SOURCE });
  const [initialTemplate, setInitialTemplate] = useState<Record<string, unknown> | null>(null);

  const [dsOpen, setDsOpen] = useState(false);
  const [dsTesting, setDsTesting] = useState(false);
  const [dsSample, setDsSample] = useState<unknown[]>([]);
  const [ordsServices, setOrdsServices] = useState<WebServiceDef[]>([]);
  const [ordsServicesLoading, setOrdsServicesLoading] = useState(false);
  const [staticText, setStaticText] = useState('');
  const [staticError, setStaticError] = useState<{ message: string; line?: number; col?: number; snippet?: string } | null>(null);
  const [endpointTesting, setEndpointTesting] = useState(false);
  const [endpointResult, setEndpointResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [runForm] = Form.useForm();

  // ── Load existing report ───────────────────────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const r = await getReport(Number(id));
        setReportId(r.id);
        setName(r.name);
        setDescription(r.description || '');
        setModule(r.module || 'GENERAL');
        setOutputFormat(r.output_format || 'pdf');
        setStatus(r.status || 'ACTIVE');
        setDataSource(r.data_source ? { ...DEFAULT_DATA_SOURCE, ...r.data_source } : { ...DEFAULT_DATA_SOURCE });
        setInitialTemplate(r.template || null);
      } catch (e: any) {
        message.error(e?.message || 'Failed to load report');
        navigate('/reports/designer');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew, navigate]);

  // ── Mount the ReportBro designer ───────────────────────────────────────────
  useEffect(() => {
    if (loading || !containerRef.current) return;
    if (!ReportBroCtor) {
      message.error('ReportBro designer library failed to load');
      return;
    }
    // ReportBro.destroy() removes the element it was mounted on from the DOM,
    // so never hand it the React-managed container: under StrictMode's
    // mount → cleanup → remount cycle the second mount would otherwise run in
    // a detached node and every internal getElementById comes back null.
    // Give it a throwaway child div instead.
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    // ReportBro's panels are position:absolute — they must anchor to this host,
    // not the viewport (otherwise the canvas overlays the page toolbar).
    host.style.position = 'relative';
    host.style.overflow = 'hidden';
    containerRef.current.replaceChildren(host);

    let rb: any = null;
    try {
      rb = new ReportBroCtor(host, {
        menuSidebar: false,
        menuShowButtonLabels: true,
        showPlusFeaturesInfo: false,
        reportServerUrl: REPORTBRO_SERVER_URL,
        saveCallback: () => { void handleSaveRef.current(); },
      });
    } catch (e) {
      console.error('Failed to initialize ReportBro designer', e);
      message.error('Failed to initialize the report designer');
      host.remove();
      return;
    }
    rbRef.current = rb;
    if (initialTemplate) {
      try { rb.load(initialTemplate); } catch (e) { console.error('Failed to load report definition', e); }
    }
    return () => {
      try { rb.destroy(); } catch { /* already gone */ }
      host.remove();
      rbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (): Promise<number | null> => {
    if (!name.trim()) { message.warning('Enter a report name before saving'); return null; }
    const rb = rbRef.current;
    if (!rb) return null;
    setSaving(true);
    try {
      const template = rb.getReport();
      const newId = await saveReport({
        id: reportId,
        name: name.trim(),
        description,
        module,
        output_format: outputFormat,
        status,
        data_source: dataSource,
        template,
        user: user?.username,
      });
      rb.setModified(false);
      if (!reportId) {
        setReportId(newId);
        navigate(`/reports/designer/${newId}`, { replace: true });
      }
      message.success(`Report saved (#${newId})`);
      return newId;
    } catch (e: any) {
      message.error(e?.message || 'Save failed — has database/reports/rr_report_designer.sql been installed?');
      return null;
    } finally {
      setSaving(false);
    }
  }, [name, description, module, outputFormat, status, dataSource, reportId, user, navigate]);

  // designer's own save button calls the latest handler
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  // ── Data source: test fetch + parameter build ──────────────────────────────
  const dsTestValues = (): Record<string, string> => {
    const vals: Record<string, string> = {};
    for (const p of dataSource.userParams ?? []) vals[p.name] = p.testValue ?? '';
    return vals;
  };

  // Full URL the report will call, resolved with the parameter test values
  const resolvedUrl = ((): string => {
    if (dataSource.sourceType === 'static' || !dataSource.path) return '';
    try { return buildDataSourceUrl(dataSource, dsTestValues()); } catch { return ''; }
  })();

  // Plain connectivity test: call the endpoint once and report status/rows
  const testEndpoint = async () => {
    setEndpointTesting(true);
    setEndpointResult(null);
    const started = Date.now();
    try {
      const rows = await fetchDataSourceRows(dataSource, dsTestValues());
      setEndpointResult({ ok: true, text: `OK — ${rows.length} rows in ${Date.now() - started} ms` });
    } catch (e: any) {
      setEndpointResult({ ok: false, text: e?.message || 'Request failed' });
    } finally {
      setEndpointTesting(false);
    }
  };

  const testFetch = async () => {
    setDsTesting(true);
    try {
      const rows = await fetchDataSourceRows(dataSource, dsTestValues());
      setDsSample(rows);
      if (rows.length === 0) {
        message.warning('Query returned 0 rows — fields cannot be derived from an empty result');
        return;
      }
      const rb = rbRef.current;
      if (rb) {
        const merged = mergeDataParameters(rb.getReport(), rows, dataSource);
        rb.load(merged);
        rb.setModified(true);
      }
      message.success(`Fetched ${rows.length} rows — data fields added to the designer (parameter "${dataSource.dataParameter || 'items'}")`);
    } catch (e: any) {
      message.error(e?.message || 'Fetch failed');
    } finally {
      setDsTesting(false);
    }
  };

  // keep the static JSON editor text in sync once the report has loaded
  useEffect(() => {
    if (!loading) {
      setStaticText(dataSource.staticData ? JSON.stringify(dataSource.staticData, null, 2) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Static JSON editing: validate / auto-fix / format ──────────────────────
  const unwrapRows = (parsed: unknown): unknown[] => {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      if (Array.isArray(rec.items)) return rec.items;
      const arr = Object.values(rec).find(v => Array.isArray(v));
      if (arr) return arr as unknown[];
    }
    throw new Error('JSON is valid but contains no array of rows — expected [ {...} ] or { "items": [ {...} ] }');
  };

  const locateJsonError = (text: string, err: Error) => {
    const m = /position (\d+)/.exec(err.message);
    if (!m) return { message: err.message };
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    const snippet = text.slice(Math.max(0, pos - 40), pos + 40).replace(/\n/g, '⏎');
    return { message: err.message, line, col, snippet };
  };

  const applyStaticJson = (text: string): boolean => {
    if (!text.trim()) { setStaticError(null); return false; }
    try {
      const rows = unwrapRows(JSON.parse(text));
      setDataSource(ds => ({ ...ds, staticData: rows }));
      setStaticError(null);
      message.success(`${rows.length} static rows applied — now click "Test Fetch & Build Data Fields"`);
      return true;
    } catch (e: any) {
      setStaticError(locateJsonError(text, e));
      return false;
    }
  };

  const fixStaticJson = () => {
    try {
      const repaired = jsonrepair(staticText);
      const formatted = JSON.stringify(JSON.parse(repaired), null, 2);
      setStaticText(formatted);
      if (applyStaticJson(formatted)) message.success('JSON repaired');
    } catch (e: any) {
      message.error(`Could not auto-repair this JSON: ${e?.message || e}`);
    }
  };

  const formatStaticJson = () => {
    try {
      setStaticText(JSON.stringify(JSON.parse(staticText), null, 2));
      setStaticError(null);
    } catch (e: any) {
      setStaticError(locateJsonError(staticText, e));
      message.warning('JSON has errors — use Fix JSON first');
    }
  };

  // ── Web service catalog pickers ────────────────────────────────────────────
  const loadOrdsServices = useCallback(async (force = false) => {
    if (ordsServices.length > 0 && !force) return;
    setOrdsServicesLoading(true);
    try {
      setOrdsServices(await listWebServices());
    } catch (e: any) {
      message.warning(`Could not load the APEX web service catalog — ${e?.message || 'is rr_webservices_catalog.sql installed?'}`);
    } finally {
      setOrdsServicesLoading(false);
    }
  }, [ordsServices.length]);

  useEffect(() => {
    if (dsOpen && dataSource.sourceType === 'ords') void loadOrdsServices();
  }, [dsOpen, dataSource.sourceType, loadOrdsServices]);

  const rescanOrdsServices = async () => {
    setOrdsServicesLoading(true);
    try {
      const r = await refreshWebServices();
      message.success(`Catalog refreshed: ${r.services} endpoints, ${r.params} parameters`);
      await loadOrdsServices(true);
    } catch (e: any) {
      message.error(e?.message || 'Refresh failed');
      setOrdsServicesLoading(false);
    }
  };

  // Selecting an ORDS service fills path, query and parameters from the catalog
  const applyOrdsService = (wsId: number) => {
    const ws = ordsServices.find(s => s.id === wsId);
    if (!ws) return;
    // :id path params become {id} placeholders; IN query params become
    // name={name} pairs plus prompt parameters
    const path = ws.pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
    const pathParams = new Set(extractPlaceholders(path));
    const queryParams = (ws.params ?? []).filter(p =>
      !pathParams.has(p.name) && (p.access_method ?? 'IN') !== 'OUT' && (p.source_type ?? 'URI') === 'URI');
    const query = queryParams.map(p => `${p.name}={${p.name}}`).join('&');
    const userParams: ReportUserParam[] = [
      ...Array.from(pathParams).map(n => ({ name: n, label: n, type: 'string' as const, testValue: '' })),
      ...queryParams.map(p => ({
        name: p.name,
        label: p.comments || p.name,
        type: (p.param_type === 'INT' || p.param_type === 'DOUBLE' ? 'number' : 'string') as ReportUserParam['type'],
        testValue: '',
      })),
    ];
    setDataSource(ds => ({ ...ds, sourceType: 'ords', path, query, userParams }));
  };

  // Selecting a Fusion resource from the app's catalog fills the path
  const applyFusionService = (resource: string) => {
    const svc = FUSION_SERVICES.find(s => s.resource === resource);
    setDataSource(ds => ({ ...ds, sourceType: 'fusion', path: resource, query: ds.query, extraQuery: ds.extraQuery }));
    if (svc) message.info(`${svc.label} — ${svc.description}`);
  };

  const syncParamsFromQuery = () => {
    const names = extractPlaceholders(`${dataSource.query || ''} ${dataSource.extraQuery || ''}`);
    const existing = new Map((dataSource.userParams ?? []).map(p => [p.name, p]));
    const params: ReportUserParam[] = names.map(n =>
      existing.get(n) ?? { name: n, label: n, type: 'string', testValue: '' });
    setDataSource(ds => ({ ...ds, userParams: params }));
    message.info(names.length ? `${names.length} parameter(s) detected from {placeholders}` : 'No {placeholders} found in the query');
  };

  const updateUserParam = (idx: number, patch: Partial<ReportUserParam>) => {
    setDataSource(ds => {
      const params = [...(ds.userParams ?? [])];
      params[idx] = { ...params[idx], ...patch };
      return { ...ds, userParams: params };
    });
  };

  // ── Run with live data ─────────────────────────────────────────────────────
  const openRun = () => {
    setRunError('');
    const initial: Record<string, string> = {};
    for (const p of dataSource.userParams ?? []) initial[p.name] = p.testValue ?? '';
    runForm.setFieldsValue(initial);
    setRunOpen(true);
  };

  const doRun = async (format: 'pdf' | 'xlsx') => {
    const rb = rbRef.current;
    if (!rb) return;
    setRunning(true); setRunError('');
    try {
      const values = await runForm.validateFields();
      const paramValues: Record<string, string> = {};
      for (const p of dataSource.userParams ?? []) {
        const v = values[p.name];
        paramValues[p.name] = v?.format ? v.format('YYYY-MM-DD') : String(v ?? '');
      }
      const rows = await fetchDataSourceRows(dataSource, paramValues);
      const data: Record<string, unknown> = { [dataSource.dataParameter || 'items']: rows, ...paramValues };
      const blob = await renderReport(rb.getReport(), data, format);
      const url = URL.createObjectURL(blob);
      if (format === 'pdf') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(name || 'report').replace(/[^\w.-]+/g, '_')}.xlsx`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setRunOpen(false);
    } catch (e: any) {
      if (e?.errorFields) { setRunning(false); return; }
      setRunError(e?.message || 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  const sampleColumns = dsSample.length > 0
    ? Object.keys(dsSample[0] as Record<string, unknown>).slice(0, 8).map(k => ({
        title: k, dataIndex: k, key: k, ellipsis: true,
        render: (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')),
      }))
    : [];

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}><Spin size="large" /></div>;
  }

  return (
    <Content style={{ background: '#F7F7F7', height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '10px 16px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}`,
      }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reports/designer')}>Reports</Button>
        <FileTextOutlined style={{ color: REDWOOD.primary, fontSize: 18 }} />
        <Input
          placeholder="Report name *"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ width: 240, fontWeight: 600 }}
        />
        <Input
          placeholder="Description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          style={{ width: 260 }}
        />
        <Select value={module} onChange={setModule} style={{ width: 110 }}
          options={REPORT_MODULES.map(m => ({ value: m, label: m }))} />
        <Select value={outputFormat} onChange={setOutputFormat} style={{ width: 90 }}
          options={[{ value: 'pdf', label: 'PDF' }, { value: 'xlsx', label: 'Excel' }]} />
        <Select value={status} onChange={setStatus} style={{ width: 110 }}
          options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        <Tooltip title="Configure where this report's data comes from (Fusion REST / APEX ORDS)">
          <Button icon={<DatabaseOutlined />} onClick={() => setDsOpen(true)}>
            Data Source
            {dataSource.path ? <Tag color="blue" style={{ marginLeft: 6 }}>{dataSource.sourceType}:{dataSource.path}</Tag> : null}
          </Button>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Button icon={<PlayCircleOutlined />} onClick={openRun} style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}>
          Run
        </Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => handleSave()}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
          Save{reportId ? ` (#${reportId})` : ''}
        </Button>
      </div>

      {usingDemoRenderServer() && (
        <Alert
          banner type="warning" showIcon
          message="Preview/Run uses the public ReportBro demo server — set REACT_APP_REPORTBRO_SERVER_URL to a self-hosted render service before using production data."
        />
      )}

      {/* ── Designer ── */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />

      {/* ── Data Source drawer ── */}
      <Drawer
        title={<><DatabaseOutlined style={{ marginRight: 8, color: REDWOOD.info }} />Report Data Source</>}
        width={620}
        open={dsOpen}
        onClose={() => setDsOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="Source Type">
            <Select
              value={dataSource.sourceType}
              onChange={v => setDataSource(ds => ({ ...ds, sourceType: v }))}
              options={[
                { value: 'fusion', label: 'Oracle Fusion REST (logged-in instance)' },
                { value: 'ords', label: 'APEX / ORDS endpoint' },
                { value: 'static', label: 'Static JSON (design-time sample only)' },
              ]}
            />
          </Form.Item>

          {dataSource.sourceType === 'fusion' && (
            <Form.Item label="Browse Fusion REST services">
              <Select
                showSearch
                allowClear
                placeholder="Pick a Fusion resource from the catalog…"
                value={FUSION_SERVICES.some(s => s.resource === dataSource.path) ? dataSource.path : undefined}
                onChange={v => { if (v) applyFusionService(v); }}
                optionFilterProp="label"
                options={FUSION_SERVICES.map(s => ({
                  value: s.resource,
                  label: `${s.label} — ${s.resource} (${s.area})`,
                }))}
              />
            </Form.Item>
          )}

          {dataSource.sourceType === 'ords' && (
            <Form.Item label={
              <Space>
                Browse APEX REERP web services
                <Button size="small" loading={ordsServicesLoading} onClick={rescanOrdsServices}>Rescan catalog</Button>
              </Space>
            }>
              <Select
                showSearch
                allowClear
                loading={ordsServicesLoading}
                placeholder={ordsServices.length ? 'Pick an ORDS endpoint — fills path, query and parameters' : 'Catalog empty — run rr_webservices_catalog.sql, then Rescan'}
                onChange={v => { if (v != null) applyOrdsService(v); }}
                optionFilterProp="label"
                options={ordsServices.map(s => ({
                  value: s.id,
                  label: `${s.pattern}${s.params.length ? `  ·  ${s.params.map(p => p.name).join(', ')}` : ''}${s.comments ? `  —  ${s.comments}` : ''}`,
                }))}
              />
            </Form.Item>
          )}

          {dataSource.sourceType !== 'static' && (
            <>
              <Form.Item
                label={dataSource.sourceType === 'fusion' ? 'Fusion resource (under /fscmRestApi/resources/11.13.18.05/)' : 'ORDS endpoint path (relative to the company APEX base URL)'}
              >
                <Input
                  placeholder={dataSource.sourceType === 'fusion' ? 'e.g. shipmentLines' : 'e.g. gl/fiscalperiods'}
                  value={dataSource.path}
                  onChange={e => setDataSource(ds => ({ ...ds, path: e.target.value.trim() }))}
                />
              </Form.Item>
              <Form.Item label={dataSource.sourceType === 'fusion' ? "Query (q=) — use {param} placeholders, e.g. OrganizationCode='{org}'" : 'Query string — use {param} placeholders, e.g. ledger_name={ledger}'}>
                <Input.TextArea
                  rows={2}
                  value={dataSource.query}
                  onChange={e => setDataSource(ds => ({ ...ds, query: e.target.value }))}
                />
              </Form.Item>
              <Form.Item label="Extra query string (optional — fields=, orderBy=, …)">
                <Input
                  placeholder="e.g. fields=Order,Item,ShippedQuantity&orderBy=Order:asc"
                  value={dataSource.extraQuery}
                  onChange={e => setDataSource(ds => ({ ...ds, extraQuery: e.target.value }))}
                />
              </Form.Item>
              <Space size="large">
                <Form.Item label="Row limit">
                  <InputNumber min={1} max={10000} value={dataSource.limit}
                    onChange={v => setDataSource(ds => ({ ...ds, limit: v ?? 500 }))} />
                </Form.Item>
                <Form.Item label="Data parameter name (list in designer)">
                  <Input style={{ width: 180 }} value={dataSource.dataParameter}
                    onChange={e => setDataSource(ds => ({ ...ds, dataParameter: e.target.value.trim() || 'items' }))} />
                </Form.Item>
              </Space>

              <Form.Item label="Full request URL (resolved with the parameter test values)">
                <div style={{
                  padding: '8px 10px', background: '#F7F7F7', borderRadius: 6,
                  border: `1px solid ${REDWOOD.neutral200}`,
                }}>
                  <code style={{ fontSize: 11, wordBreak: 'break-all', display: 'block' }}>
                    {resolvedUrl || '— enter an endpoint path to see the URL —'}
                  </code>
                  <Space style={{ marginTop: 8 }}>
                    <Button size="small" icon={<CopyOutlined />} disabled={!resolvedUrl}
                      onClick={() => { navigator.clipboard.writeText(resolvedUrl); message.success('URL copied'); }}>
                      Copy URL
                    </Button>
                    <Button size="small" type="primary" ghost icon={<ApiOutlined />} disabled={!resolvedUrl}
                      loading={endpointTesting} onClick={testEndpoint}>
                      Test Endpoint
                    </Button>
                    {endpointResult && (
                      <Tag color={endpointResult.ok ? 'green' : 'red'} style={{ maxWidth: 320, whiteSpace: 'normal' }}>
                        {endpointResult.text}
                      </Tag>
                    )}
                  </Space>
                </div>
              </Form.Item>
            </>
          )}

          {dataSource.sourceType === 'static' && (
            <Form.Item label='Static JSON rows — an array of objects, or an object wrapping one (e.g. { "items": [...] })'>
              <Input.TextArea
                rows={10}
                placeholder='[ { "Item": "AS54888", "Qty": 10 } ]'
                value={staticText}
                onChange={e => { setStaticText(e.target.value); setStaticError(null); }}
                onBlur={() => applyStaticJson(staticText)}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                status={staticError ? 'error' : undefined}
              />
              <Space style={{ marginTop: 8 }}>
                <Button size="small" type="primary" ghost onClick={() => applyStaticJson(staticText)}>Validate &amp; Apply</Button>
                <Button size="small" onClick={fixStaticJson}>Fix JSON</Button>
                <Button size="small" onClick={formatStaticJson}>Format</Button>
                {(dataSource.staticData?.length ?? 0) > 0 && !staticError && (
                  <Tag color="green">{dataSource.staticData!.length} rows applied</Tag>
                )}
              </Space>
              {staticError && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 8 }}
                  message={staticError.line
                    ? `Invalid JSON at line ${staticError.line}, column ${staticError.col}`
                    : 'Invalid JSON'}
                  description={
                    <>
                      <div style={{ marginBottom: 4 }}>{staticError.message}</div>
                      {staticError.snippet && (
                        <code style={{ fontSize: 11, wordBreak: 'break-all' }}>…{staticError.snippet}…</code>
                      )}
                      <div style={{ marginTop: 6 }}>
                        <Button size="small" type="primary" onClick={fixStaticJson}>Fix JSON automatically</Button>
                      </div>
                    </>
                  }
                />
              )}
            </Form.Item>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
            <Text strong>Report Parameters</Text>
            <Space>
              <Button size="small" onClick={syncParamsFromQuery}>Detect from {'{placeholders}'}</Button>
              <Button size="small" icon={<PlusOutlined />} onClick={() =>
                setDataSource(ds => ({ ...ds, userParams: [...(ds.userParams ?? []), { name: `param${(ds.userParams?.length ?? 0) + 1}`, label: '', type: 'string', testValue: '' }] }))}>
                Add
              </Button>
            </Space>
          </div>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            pagination={false}
            dataSource={dataSource.userParams ?? []}
            locale={{ emptyText: 'No parameters — the report runs on the full query' }}
            columns={[
              { title: 'Name', dataIndex: 'name', render: (v, _r, i) => <Input size="small" value={v} onChange={e => updateUserParam(i, { name: e.target.value.trim() })} /> },
              { title: 'Prompt Label', dataIndex: 'label', render: (v, _r, i) => <Input size="small" value={v} onChange={e => updateUserParam(i, { label: e.target.value })} /> },
              { title: 'Type', dataIndex: 'type', width: 100, render: (v, _r, i) => <Select size="small" value={v} style={{ width: 90 }} onChange={val => updateUserParam(i, { type: val })} options={[{ value: 'string', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }]} /> },
              { title: 'Test Value', dataIndex: 'testValue', render: (v, _r, i) => <Input size="small" value={v} onChange={e => updateUserParam(i, { testValue: e.target.value })} /> },
              { title: '', key: 'del', width: 40, render: (_v, _r, i) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setDataSource(ds => ({ ...ds, userParams: (ds.userParams ?? []).filter((_p, idx) => idx !== i) }))} /> },
            ]}
          />

          <Button
            type="primary" block icon={<ThunderboltOutlined />} loading={dsTesting}
            style={{ marginTop: 16, background: REDWOOD.info, borderColor: REDWOOD.info }}
            onClick={testFetch}
          >
            Test Fetch &amp; Build Data Fields
          </Button>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
            Runs the query with the test values, then creates/updates the "{dataSource.dataParameter || 'items'}" list parameter
            in the designer with one field per column — drag its fields into a table band to lay out the report.
          </Text>

          {dsSample.length > 0 && (
            <>
              <Text strong style={{ display: 'block', margin: '16px 0 8px' }}>Sample ({dsSample.length} rows)</Text>
              <Table size="small" rowKey={(_, i) => String(i)} pagination={{ pageSize: 5 }}
                dataSource={dsSample as object[]} columns={sampleColumns} scroll={{ x: true }} />
            </>
          )}
        </Form>
      </Drawer>

      {/* ── Run modal ── */}
      <Modal
        open={runOpen}
        onCancel={() => setRunOpen(false)}
        title={<><PlayCircleOutlined style={{ color: REDWOOD.success, marginRight: 8 }} />Run — {name || 'Untitled report'}</>}
        footer={[
          <Button key="cancel" onClick={() => setRunOpen(false)}>Cancel</Button>,
          <Button key="xlsx" loading={running} onClick={() => doRun('xlsx')}>Run as Excel</Button>,
          <Button key="pdf" type="primary" loading={running} onClick={() => doRun('pdf')}
            style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Run as PDF</Button>,
        ]}
      >
        {(dataSource.userParams ?? []).length === 0
          ? <Text type="secondary">No parameters — the report runs on the full data source query.</Text>
          : (
            <Form form={runForm} layout="vertical">
              {(dataSource.userParams ?? []).map(p => (
                <Form.Item key={p.name} name={p.name} label={p.label || p.name}
                  rules={[{ required: true, message: `${p.label || p.name} is required` }]}>
                  {p.type === 'number' ? <InputNumber style={{ width: '100%' }} />
                    : p.type === 'date' ? <DatePicker style={{ width: '100%' }} />
                    : <Input />}
                </Form.Item>
              ))}
            </Form>
          )}
        {runError && <Alert type="error" showIcon message={runError} style={{ marginTop: 12 }} />}
      </Modal>
    </Content>
  );
};

export default ReportDesignerStudio;
