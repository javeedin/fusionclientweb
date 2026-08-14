import { getFusionAuthHeaders } from '../../config/api.helper';
import React, { useState } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Tabs, Tag, Button, Input, Space,
  Tooltip, Alert, Modal, message, Steps, Select,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, DollarOutlined, ApiOutlined, PlayCircleOutlined, ReloadOutlined,
  ThunderboltOutlined, SearchOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};

// Get Fusion host (without API path) from current company configuration
const getFusionHost = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl || '';
};

const { Title, Text } = Typography;

// Direct in Electron (no CORS); Vite proxy in the browser. preload exposes electronAPI.
const FUSION_BASE = `${getFusionBase()}`;
const getHeaders = () => getFusionAuthHeaders();
const HDRS = { ...getHeaders(), Accept: 'application/json' };
const ERP_URL = `${FUSION_BASE}/erpintegrations`;

// Scheduler REST lives under /ess/rest (NOT /fscmRestApi). Direct host in Electron.
const SCHEDULER_URL = `${getFusionHost()}/ess/rest/scheduler/v1/requests`;

const REDWOOD = {
  primary: '#C74634', info: '#0572CE', success: '#1D7B4D', warning: '#D4A800', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral500: '#8C8C8C', neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

interface CostStep {
  key: string;
  seq: number;
  name: string;
  subledger: string;
  description: string;
  jobPackage: string;   // ESS job package path — fill in per your pod
  jobDef: string;       // ESS job definition name
  params: string;       // comma-separated ESS parameters
}

// Default costing flow after a PO receipt. Job package/def are left blank —
// fill them from Scheduled Processes → Process Details for your instance.
// Params are positional ESSParameters (comma-separated), taken from Scheduled
// Processes → Process Details → "All Parameter Values" for each job. Empty
// positions = null. Job Package / Definition are filled per pod.
const DEFAULT_STEPS: CostStep[] = [
  { key: '1', seq: 1, name: 'Transfer Transactions from Receiving to Costing', subledger: 'Receipt Accounting',
    description: 'Pulls receiving transactions into costing.', jobPackage: '', jobDef: '', params: '' },
  { key: '2', seq: 2, name: 'Transfer Transactions from Inventory to Costing', subledger: 'Cost Accounting',
    description: 'Pulls the inventory delivery transactions into costing. Params: Cost Organization, Commit Limit.', jobPackage: '', jobDef: '', params: ',500000' },
  { key: '3', seq: 3, name: 'Create Receipt Accounting Distributions', subledger: 'Receipt Accounting',
    description: 'Costs & creates distributions for the receipt / accrual side. Commit 100000, 10 workers.', jobPackage: '', jobDef: '', params: ',,100000,10,0,,,,,' },
  { key: '4', seq: 4, name: 'Create Cost Accounting Distributions', subledger: 'Cost Accounting',
    description: 'The cost processor — values transactions and creates cost distributions. Run Control AMS_RUN_CTRL.', jobPackage: '', jobDef: '', params: 'AMS_RUN_CTRL' },
  { key: '5', seq: 5, name: 'Create Accounting (Cost & Receipt Accounting)', subledger: 'Subledger Accounting',
    description: 'Creates subledger journal entries and (optionally) posts to GL.', jobPackage: '', jobDef: '', params: '' },
];

const STEPS_KEY = 'cost_mgmt_steps';
// Merge saved steps over the defaults by name: keep the user's Job Package/Definition
// and any params they set, but pick up new default params where they left it blank.
const loadSteps = (): CostStep[] => {
  let saved: CostStep[] = [];
  try { const s = JSON.parse(localStorage.getItem(STEPS_KEY) || 'null'); if (Array.isArray(s)) saved = s; } catch { /* ignore */ }
  return DEFAULT_STEPS.map(def => {
    const prev = saved.find(s => s.name === def.name);
    if (!prev) return def;
    return {
      ...def,
      jobPackage: prev.jobPackage || def.jobPackage,
      jobDef:     prev.jobDef || def.jobDef,
      params:     (prev.params && prev.params.trim()) ? prev.params : def.params,
    };
  });
};

interface EssJob {
  key: string;
  step: string;
  requestId: string;
  status: string;      // SUCCEEDED / RUNNING / ERROR / WARNING / …
  submittedAt: string;
  response: string;
}

const statusColor = (s: string): string => {
  const u = (s || '').toUpperCase();
  if (u.includes('SUCCEED') || u === 'COMPLETED') return 'success';
  if (u.includes('ERROR') || u.includes('FAIL')) return 'error';
  if (u.includes('WARN')) return 'warning';
  if (u.includes('RUN') || u.includes('READY') || u.includes('WAIT') || u.includes('SCHEDUL')) return 'processing';
  return 'default';
};

const CostManagement: React.FC = () => {
  const [steps, setSteps] = useState<CostStep[]>(loadSteps());
  const [jobs, setJobs]   = useState<EssJob[]>([]);
  const [checkId, setCheckId] = useState('');
  // Per-step last run: request id + latest status, shown inline on the Cost Flow tab.
  const [stepRuns, setStepRuns] = useState<Record<string, { reqId: string; status: string; at: string; busy?: boolean }>>({});

  // ── ESS Monitor (Scheduler REST — list all requests) ────────────────────────
  const [monRows, setMonRows]       = useState<any[]>([]);
  const [monLoading, setMonLoading] = useState(false);
  const [monError, setMonError]     = useState('');
  const [monState, setMonState]     = useState<string>('');   // '' = all
  const [monSearch, setMonSearch]   = useState('');
  const [monDetails, setMonDetails] = useState<Record<string, string>>({});

  const monUrl = SCHEDULER_URL + `?limit=200${monState ? `&state=${monState}` : ''}`;

  const loadMonitor = async () => {
    setMonLoading(true); setMonError('');
    try {
      const res = await fetch(monUrl, { headers: HDRS });
      const text = await res.text();
      let data: any = {}; try { data = JSON.parse(text); } catch { /* non-json */ }
      if (!res.ok) throw new Error(data?.detail ?? data?.message ?? `HTTP ${res.status}`);
      const items: any[] = data.items ?? data.requests ?? (Array.isArray(data) ? data : []);
      setMonRows(items);
      if (items.length === 0) setMonError('No requests returned.');
    } catch (e: any) {
      setMonError(e?.message || 'Failed to load ESS requests');
      setMonRows([]);
    } finally { setMonLoading(false); }
  };

  // Per-request detail (list summary has many nulls; detail fills job name etc.)
  const loadDetail = async (requestId: string | number) => {
    try {
      const res = await fetch(`${SCHEDULER_URL}/${requestId}`, { headers: HDRS });
      const text = await res.text();
      let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep */ }
      setMonDetails(prev => ({ ...prev, [String(requestId)]: pretty }));
    } catch (e: any) {
      setMonDetails(prev => ({ ...prev, [String(requestId)]: e?.message ?? 'Failed to load detail' }));
    }
  };

  const filteredMon = monRows.filter(r => {
    const q = monSearch.trim().toLowerCase();
    if (!q) return true;
    return [r.requestId, r.state, r.stateDescription, r.jobDescription, r.deployedApplicationName, r.executionType]
      .some(v => v != null && String(v).toLowerCase().includes(q));
  });

  const persist = (next: CostStep[]) => { setSteps(next); localStorage.setItem(STEPS_KEY, JSON.stringify(next)); };
  const updateStep = (key: string, field: keyof CostStep, value: string) =>
    persist(steps.map(s => s.key === key ? { ...s, [field]: value } : s));
  const updateStepFields = (key: string, patch: Partial<CostStep>) =>
    persist(steps.map(s => s.key === key ? { ...s, ...patch } : s));

  // Learn the JobPackageName / JobDefName for a step from one of its completed
  // ESS requests (the Process ID from Scheduled Processes). The scheduler detail
  // carries the job definition + package, so we don't have to hardcode them.
  const [probeIds, setProbeIds] = useState<Record<string, string>>({
    '1': '1697657', '2': '1697653', '3': '1697660', '4': '1697667', '5': '',
  });
  const [detecting, setDetecting] = useState<Record<string, boolean>>({});
  const [detectRaw, setDetectRaw] = useState<{ id: string; step: string; raw: string } | null>(null);

  // Recursively find the first string value whose key matches a pattern.
  const deepFind = (obj: any, re: RegExp): string => {
    const stack = [obj];
    while (stack.length) {
      const cur = stack.pop();
      if (cur && typeof cur === 'object') {
        for (const [k, v] of Object.entries(cur)) {
          if (typeof v === 'string' && v.trim() && re.test(k)) return v.trim();
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }
    return '';
  };

  const detectFromRequest = async (stepKey: string): Promise<boolean> => {
    const reqId = (probeIds[stepKey] || '').trim();
    if (!reqId) { message.warning('Enter a Process ID (from Scheduled Processes) first.'); return false; }
    setDetecting(prev => ({ ...prev, [stepKey]: true }));
    try {
      const res = await fetch(`${SCHEDULER_URL}/${reqId}`, { headers: HDRS });
      const text = await res.text();
      let d: any = {}; try { d = JSON.parse(text); } catch { /* non-json */ }
      const stepName = steps.find(s => s.key === stepKey)?.name ?? stepKey;
      const pretty = (() => { try { return JSON.stringify(d, null, 2); } catch { return text; } })();
      setDetectRaw({ id: reqId, step: stepName, raw: res.ok ? pretty : `HTTP ${res.status}\n\n${text}` });
      if (!res.ok) { message.error(`Request ${reqId}: HTTP ${res.status}`); return false; }
      // Deep-scan for package + definition under any key name the pod uses.
      let pkg = deepFind(d, /package/i);
      let def = deepFind(d, /(jobdef(inition)?name|definitionname|jobdefname|^jobdefinition$|^jobname$|^jobdef$)/i);
      if (!pkg && def && def.includes('/')) { const p = def.split('/'); def = p.pop() || ''; pkg = p.join('/'); }
      // A combined package path sometimes carries the def as its last segment.
      if (pkg && !def && pkg.includes('/')) { const p = pkg.split('/'); def = p.pop() || ''; pkg = p.join('/'); }
      if (!def) { message.warning(`Couldn't auto-read the job for ${reqId} — see the response below and copy Job Package / Definition manually.`); return false; }
      updateStepFields(stepKey, { jobPackage: pkg || '', jobDef: def });
      message.success(`Detected: ${def}`);
      return true;
    } catch (e: any) {
      Modal.error({ title: 'Detect — network error', content: e?.message });
      return false;
    } finally {
      setDetecting(prev => ({ ...prev, [stepKey]: false }));
    }
  };

  // ── Submit an ESS job via erpintegrations / submitESSJobRequest ─────────────
  const submitBody = (s: CostStep) => ({
    OperationName: 'submitESSJobRequest',
    JobPackageName: s.jobPackage.trim(),
    JobDefName:     s.jobDef.trim(),
    ESSParameters:  s.params.trim(),
  });

  const confirmRun = (s: CostStep) => {
    if (!s.jobPackage.trim() || !s.jobDef.trim()) {
      message.error('Set the Job Package and Job Definition for this step first (Cost Flow tab).');
      return;
    }
    const body = submitBody(s);
    Modal.confirm({
      title: `Run: ${s.name}?`,
      width: 640,
      icon: null,
      okText: 'Submit ESS job',
      content: (
        <div style={{ fontSize: 12 }}>
          <p style={{ margin: '0 0 8px' }}>Submits the scheduled process to Oracle Fusion.</p>
          <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`POST ${ERP_URL}
Content-Type: application/json

${JSON.stringify(body, null, 2)}`}
          </pre>
        </div>
      ),
      onOk: () => runJob(s),
    });
  };

  const runJob = async (s: CostStep) => {
    try {
      const res = await fetch(ERP_URL, {
        method: 'POST', headers: { ...HDRS, 'Content-Type': 'application/json' }, body: JSON.stringify(submitBody(s)),
      });
      const text = await res.text();
      let data: any = null; try { data = JSON.parse(text); } catch { /* non-json */ }
      const reqId = data?.ReqstId ?? data?.reqstId ?? data?.RequestId ?? data?.DocumentId ?? '';
      if (!res.ok || !reqId) {
        Modal.error({ title: 'Submit failed', width: 620, content: <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>{text}</pre> });
        return;
      }
      const job: EssJob = {
        key: `${reqId}-${jobs.length}`, step: s.name, requestId: String(reqId),
        status: 'RUNNING', submittedAt: new Date().toLocaleString(), response: text,
      };
      setJobs(prev => [job, ...prev]);
      setStepRuns(prev => ({ ...prev, [s.key]: { reqId: String(reqId), status: 'RUNNING', at: new Date().toLocaleTimeString() } }));
      message.success(`Submitted — request ${reqId}`);
      refreshJob(job.requestId);
      refreshStep(s.key, String(reqId));
    } catch (e: any) {
      Modal.error({ title: 'Submit — network error', content: e?.message });
    }
  };

  // Refresh the status of a step's last submitted request (Cost Flow tab).
  const refreshStep = async (stepKey: string, reqIdOverride?: string) => {
    const reqId = reqIdOverride ?? stepRuns[stepKey]?.reqId;
    if (!reqId) return;
    setStepRuns(prev => ({ ...prev, [stepKey]: { ...prev[stepKey], busy: true } }));
    try {
      const { status, raw } = await fetchStatus(reqId);
      setStepRuns(prev => ({ ...prev, [stepKey]: { reqId, status, at: new Date().toLocaleTimeString() } }));
      setJobs(prev => prev.map(j => j.requestId === reqId ? { ...j, status, response: raw } : j));
    } catch {
      setStepRuns(prev => ({ ...prev, [stepKey]: { ...prev[stepKey], busy: false } }));
    }
  };

  // ── Monitor: getESSJobStatus ────────────────────────────────────────────────
  const fetchStatus = async (requestId: string): Promise<{ status: string; raw: string }> => {
    const res = await fetch(ERP_URL, {
      method: 'POST', headers: { ...HDRS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ OperationName: 'getESSJobStatus', requestId }),
    });
    const text = await res.text();
    let data: any = null; try { data = JSON.parse(text); } catch { /* non-json */ }
    const status = data?.RequestStatus ?? data?.requestStatus ?? data?.Status ?? (res.ok ? 'UNKNOWN' : `HTTP ${res.status}`);
    return { status: String(status), raw: text };
  };

  const refreshJob = async (requestId: string) => {
    try {
      const { status, raw } = await fetchStatus(requestId);
      setJobs(prev => prev.map(j => j.requestId === requestId ? { ...j, status, response: raw } : j));
    } catch { /* ignore */ }
  };

  const refreshAll = () => jobs.forEach(j => refreshJob(j.requestId));

  const checkById = async () => {
    const id = checkId.trim();
    if (!id) return;
    const { status, raw } = await fetchStatus(id);
    setJobs(prev => {
      if (prev.some(j => j.requestId === id)) return prev.map(j => j.requestId === id ? { ...j, status, response: raw } : j);
      return [{ key: `${id}-manual`, step: '(manual lookup)', requestId: id, status, submittedAt: new Date().toLocaleString(), response: raw }, ...prev];
    });
  };

  // ── Cost Flow tab ───────────────────────────────────────────────────────────
  const flowColumns: ColumnsType<CostStep> = [
    { title: '#', dataIndex: 'seq', width: 44, align: 'center', render: (v) => <Tag color="blue">{v}</Tag> },
    { title: 'Process (ESS job)', dataIndex: 'name', width: 300, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Subledger', dataIndex: 'subledger', width: 150, render: (v) => <Tag>{v}</Tag> },
    { title: 'What it does', dataIndex: 'description', ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Job Package', dataIndex: 'jobPackage', width: 220,
      render: (v, r) => <Input size="small" value={v} placeholder="/oracle/apps/ess/scm/…" onChange={e => updateStep(r.key, 'jobPackage', e.target.value)} style={{ fontFamily: 'monospace', fontSize: 11 }} /> },
    { title: 'Job Definition', dataIndex: 'jobDef', width: 200,
      render: (v, r) => <Input size="small" value={v} placeholder="JobDefName" onChange={e => updateStep(r.key, 'jobDef', e.target.value)} style={{ fontFamily: 'monospace', fontSize: 11 }} /> },
    { title: 'Params', dataIndex: 'params', width: 150,
      render: (v, r) => <Input size="small" value={v} placeholder="p1,p2,…" onChange={e => updateStep(r.key, 'params', e.target.value)} style={{ fontSize: 11 }} /> },
    { title: <Tooltip title="Fill Job Package + Definition automatically from a completed run of this process (its Process ID from Scheduled Processes)">Detect from run</Tooltip>, key: 'detect', width: 190,
      render: (_, r) => (
        <Space.Compact size="small" style={{ width: '100%' }}>
          <Input size="small" value={probeIds[r.key] ?? ''} placeholder="Process ID" style={{ fontSize: 11 }}
            onChange={e => setProbeIds(prev => ({ ...prev, [r.key]: e.target.value }))} />
          <Button size="small" loading={detecting[r.key]} onClick={() => detectFromRequest(r.key)}>Detect</Button>
        </Space.Compact>
      ) },
    { title: 'Run', key: 'run', width: 90, fixed: 'right',
      render: (_, r) => <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => confirmRun(r)}
        style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Run</Button> },
    { title: 'Status', key: 'status', width: 210, fixed: 'right', render: (_, r) => {
        const run = stepRuns[r.key];
        if (!run) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        return (
          <Space size={4} wrap>
            <Tooltip title={`Request ${run.reqId} · ${run.at}`}><Text code style={{ fontSize: 10 }}>{run.reqId}</Text></Tooltip>
            <Tag color={statusColor(run.status) as any} style={{ fontSize: 10, margin: 0 }}>{run.status}</Tag>
            <Button size="small" type="text" icon={<ReloadOutlined spin={run.busy} />} onClick={() => refreshStep(r.key)} />
          </Space>
        );
      } },
  ];

  // ── ESS tab: per-step run + jobs monitor ────────────────────────────────────
  const jobColumns: ColumnsType<EssJob> = [
    { title: 'Request', dataIndex: 'requestId', width: 130, render: (v) => <Text code>{v}</Text> },
    { title: 'Step', dataIndex: 'step', ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v) => <Tag color={statusColor(v) as any}>{v}</Tag> },
    { title: 'Submitted', dataIndex: 'submittedAt', width: 170, render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text> },
    { title: '', key: 'act', width: 90, render: (_, r) => <Button size="small" icon={<ReloadOutlined />} onClick={() => refreshJob(r.requestId)}>Status</Button> },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Cost Management' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <div style={{ width: 48, height: 48, borderRadius: 10, background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, #A33B2C 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarOutlined style={{ fontSize: 24, color: '#fff' }} />
            </div>
            <div>
              <Title level={3} style={{ margin: 0 }}>Cost Management</Title>
              <Text type="secondary">Cost the received items — Receipt & Cost Accounting ESS jobs</Text>
            </div>
          </div>

          <Card size="small" style={{ borderRadius: 8 }}>
            <Tabs
              items={[
                {
                  key: 'flow',
                  label: <Space size={4}><DollarOutlined />Cost Flow</Space>,
                  children: (
                    <>
                      <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
                        message="Costing flow after a PO receipt"
                        description={<>First click <b>Detect all</b> to learn each job's package/definition from a completed run (Process IDs are pre-filled from your recent runs), then hit <b>Run</b> on each step in order. Params are pre-filled from Process Details. Poll status with the ↻ button or Refresh all.</>} />
                      <Steps
                        direction="horizontal" size="small" responsive
                        current={-1}
                        style={{ marginBottom: 16 }}
                        items={steps.map(s => ({ title: `${s.seq}`, description: s.name.length > 28 ? s.name.slice(0, 28) + '…' : s.name }))}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <Button size="small" type="primary" icon={<ApiOutlined />} onClick={() => steps.forEach(s => { if ((probeIds[s.key] || '').trim()) detectFromRequest(s.key); })}
                          style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>Detect all job coordinates</Button>
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => Object.keys(stepRuns).forEach(k => refreshStep(k))}
                          disabled={Object.keys(stepRuns).length === 0}>Refresh all statuses</Button>
                        <Text type="secondary" style={{ fontSize: 11 }}>Submits via <Text code style={{ fontSize: 10 }}>submitESSJobRequest</Text>, polls via <Text code style={{ fontSize: 10 }}>getESSJobStatus</Text>.</Text>
                      </div>
                      <Table rowKey="key" size="small" bordered dataSource={steps} columns={flowColumns} pagination={false} scroll={{ x: 1700 }} />
                      {detectRaw && (
                        <div style={{ marginTop: 12 }}>
                          <Space style={{ marginBottom: 4 }}>
                            <Text strong style={{ fontSize: 12 }}>Scheduler response — request {detectRaw.id} ({detectRaw.step})</Text>
                            <Button size="small" type="text" onClick={() => setDetectRaw(null)}>hide</Button>
                          </Space>
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                            If the Job Package / Definition didn't fill, copy them from here (look for the job definition path) into the fields above.
                          </Text>
                          <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: 0, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{detectRaw.raw}</pre>
                        </div>
                      )}
                    </>
                  ),
                },
                {
                  key: 'ess',
                  label: <Space size={4}><ThunderboltOutlined />ESS Jobs & Monitor</Space>,
                  children: (
                    <>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Run a step</Text>
                      <Space wrap style={{ marginBottom: 16 }}>
                        {steps.map(s => (
                          <Button key={s.key} icon={<PlayCircleOutlined />} onClick={() => confirmRun(s)}
                            style={{ borderColor: REDWOOD.primary, color: REDWOOD.primary }}>
                            {s.seq}. {s.name.length > 34 ? s.name.slice(0, 34) + '…' : s.name}
                          </Button>
                        ))}
                      </Space>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <Text strong style={{ fontSize: 12 }}>Submitted jobs</Text>
                        <Button size="small" icon={<ReloadOutlined />} onClick={refreshAll} disabled={jobs.length === 0}>Refresh all</Button>
                        <span style={{ marginLeft: 'auto' }} />
                        <Input size="small" style={{ width: 180 }} placeholder="Check by Request ID" value={checkId}
                          onChange={e => setCheckId(e.target.value)} onPressEnter={checkById} />
                        <Button size="small" icon={<SearchOutlined />} onClick={checkById}>Check</Button>
                        <Tooltip title="Uses erpintegrations getESSJobStatus"><ApiOutlined style={{ color: REDWOOD.info }} /></Tooltip>
                      </div>
                      <Table rowKey="key" size="small" bordered dataSource={jobs} columns={jobColumns}
                        pagination={{ pageSize: 15 }}
                        expandable={{ expandedRowRender: (r) => (
                          <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: 0, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{r.response || '(no response)'}</pre>
                        ) }}
                        locale={{ emptyText: 'No jobs submitted yet — run a step above' }} />

                      <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 10 }}>
                        Submit: <Text code style={{ fontSize: 11 }}>POST {ERP_URL}</Text> · OperationName <Text code>submitESSJobRequest</Text>.
                        Monitor: same endpoint · OperationName <Text code>getESSJobStatus</Text>.
                      </div>
                    </>
                  ),
                },
                {
                  key: 'monitor',
                  label: <Space size={4}><SearchOutlined />ESS Monitor</Space>,
                  children: (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <Text strong style={{ fontSize: 12 }}>State</Text>
                        <Select size="small" style={{ width: 150 }} value={monState || 'ALL'}
                          onChange={v => setMonState(v === 'ALL' ? '' : v)}
                          options={['ALL', 'RUNNING', 'WAIT', 'READY', 'BLOCKED', 'COMPLETED', 'SUCCEEDED', 'ERROR', 'WARNING', 'CANCELLED', 'HOLD'].map(s => ({ label: s, value: s }))} />
                        <Input size="small" style={{ width: 200 }} allowClear placeholder="Filter (id, job, state)…"
                          value={monSearch} onChange={e => setMonSearch(e.target.value)} prefix={<SearchOutlined />} />
                        <Button size="small" type="primary" icon={<ReloadOutlined />} loading={monLoading}
                          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }} onClick={loadMonitor}>
                          Load requests
                        </Button>
                        <span style={{ marginLeft: 'auto' }} />
                        <Text type="secondary" style={{ fontSize: 11 }}>{filteredMon.length} shown</Text>
                      </div>
                      <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 8 }}>
                        <Tag color="blue" style={{ fontSize: 10 }}>GET</Tag>
                        <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{monUrl}</Text>
                      </div>
                      {monError && <Alert type="warning" showIcon closable onClose={() => setMonError('')} message={monError} style={{ marginBottom: 10, fontSize: 12 }} />}
                      <Table
                        rowKey={(r: any) => String(r.requestId)}
                        size="small" bordered loading={monLoading}
                        dataSource={filteredMon}
                        pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} requests` }}
                        scroll={{ x: 800 }}
                        onRow={(r: any) => ({ onClick: () => { if (!monDetails[String(r.requestId)]) loadDetail(r.requestId); } })}
                        expandable={{
                          onExpand: (expanded, r: any) => { if (expanded && !monDetails[String(r.requestId)]) loadDetail(r.requestId); },
                          expandedRowRender: (r: any) => (
                            <pre style={{ fontSize: 10.5, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {monDetails[String(r.requestId)] ?? 'Loading detail…'}
                            </pre>
                          ),
                        }}
                        columns={[
                          { title: 'Request', dataIndex: 'requestId', width: 120, render: (v: any) => <Text code>{v}</Text> },
                          { title: 'State', dataIndex: 'state', width: 150, render: (v: string, r: any) => <Tag color={statusColor(v) as any}>{r.stateDescription || v || '—'}</Tag> },
                          { title: 'Job / Description', key: 'job', ellipsis: true, render: (_: any, r: any) => <Text style={{ fontSize: 12 }}>{r.jobDescription ?? r.description ?? r.deployedApplicationName ?? '—'}</Text> },
                          { title: 'Type', dataIndex: 'executionType', width: 110, render: (v: string) => v ? <Tag style={{ fontSize: 10 }}>{v}</Tag> : '—' },
                          { title: 'Error', dataIndex: 'errorTypeDescription', width: 120, render: (v: string) => v ? <Text style={{ fontSize: 11, color: REDWOOD.error }}>{v}</Text> : '—' },
                          { title: '', key: 'act', width: 80, render: (_: any, r: any) => <Button size="small" icon={<ReloadOutlined />} onClick={(e) => { e.stopPropagation(); loadDetail(r.requestId); }}>Detail</Button> },
                        ]}
                        locale={{ emptyText: 'Click “Load requests” to list ESS jobs' }}
                      />
                      <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 8 }}>
                        List: <Text code style={{ fontSize: 11 }}>GET /ess/rest/scheduler/v1/requests</Text> · per-request detail:
                        <Text code style={{ fontSize: 11 }}> GET …/requests/{'{requestId}'}</Text> (fills job name/params the summary leaves null).
                      </div>
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default CostManagement;
