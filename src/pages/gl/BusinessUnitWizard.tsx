import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, Steps, Form, Input, Select, Switch, InputNumber, Button, Space, Tag,
  Typography, Radio, Alert, Descriptions, Collapse, Tooltip, message,
} from 'antd';
import {
  BankOutlined, ApartmentOutlined, CalendarOutlined, ApiOutlined,
  CheckCircleTwoTone, DatabaseOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';

const { Text } = Typography;
const APEX = APEX_DB_CONFIG.baseUrl;

// ── helpers ─────────────────────────────────────────────────────────────────
type Raw = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const n = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

const getItems = async (url: string): Promise<Raw[]> => {
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.items || [];
};

const postJson = async (url: string, body: unknown): Promise<{ ok: boolean; message: string; id?: number; raw: string }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: { status?: string; success?: boolean; message?: string; legalEntityId?: number; ledgerId?: number; businessUnitId?: number } = {};
  try { data = JSON.parse(raw); } catch { /* non-JSON */ }
  const ok = res.ok && data.status !== 'error' && data.success !== false;
  return {
    ok,
    message: data.message || (ok ? 'Saved' : `HTTP ${res.status}: ${raw.slice(0, 200)}`),
    id: data.legalEntityId ?? data.ledgerId ?? data.businessUnitId,
    raw,
  };
};

// ── API inspector (shows the exact GET/POST calls each step uses) ────────────
interface ApiCall { label: string; method: 'GET' | 'POST'; url: string; body?: unknown; }
const ApiInspector: React.FC<{ calls: ApiCall[] }> = ({ calls }) => (
  <Collapse
    ghost
    size="small"
    style={{ marginTop: 10 }}
    items={[{
      key: 'api',
      label: <span style={{ fontSize: 12 }}><ApiOutlined style={{ color: '#722ed1' }} /> API — URLs &amp; JSON payloads</span>,
      children: (
        <div style={{ maxHeight: 240, overflow: 'auto' }}>
          {calls.map((c, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>
                <Tag color={c.method === 'GET' ? 'blue' : 'green'} style={{ fontSize: 10 }}>{c.method}</Tag>{c.label}
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: '#0572CE' }}>{c.url}</div>
              {c.body !== undefined && (
                <pre style={{ fontSize: 11, background: '#f6f6f6', padding: 8, borderRadius: 4, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(c.body, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      ),
    }]}
  />
);

interface LedgerOpt { ledgerId: number; ledgerName: string; currencyCode?: string; chartOfAccountsName?: string; }
interface LeOpt { legalEntityId: number; name: string; identifier?: string; }
interface CoaOpt { id: string; name: string; description?: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;         // refresh the parent lists
  currentUser: string;
}

const BusinessUnitWizard: React.FC<Props> = ({ open, onClose, onDone, currentUser }) => {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // reference data
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [les, setLes] = useState<LeOpt[]>([]);
  const [coa, setCoa] = useState<CoaOpt[]>([]);
  const [linkedLedgerIds, setLinkedLedgerIds] = useState<Set<number>>(new Set());
  const [linkedLeIds, setLinkedLeIds] = useState<Set<number>>(new Set());
  const [buNames, setBuNames] = useState<string[]>([]);

  // committed results
  const [ledger, setLedger] = useState<{ id: number; name: string; currency?: string } | null>(null);
  const [le, setLe] = useState<{ id: number; name: string } | null>(null);
  const [bu, setBu] = useState<{ id: number; name: string } | null>(null);
  const [calendarDone, setCalendarDone] = useState(false);

  const [ledgerForm] = Form.useForm();
  const [leForm] = Form.useForm();
  const [buForm] = Form.useForm();
  const [calForm] = Form.useForm();

  const ledgerMode = Form.useWatch('mode', ledgerForm) as 'create' | 'existing' | undefined;
  const leMode = Form.useWatch('mode', leForm) as 'create' | 'existing' | undefined;
  const calType = Form.useWatch('calendarType', calForm) as string | undefined;
  const calStartYear = Form.useWatch('startYear', calForm) as number | undefined;
  // live values so the API-payload preview reflects what will actually be sent
  const wLedgerName = Form.useWatch('ledgerName', ledgerForm) as string | undefined;
  const wLedgerDesc = Form.useWatch('description', ledgerForm) as string | undefined;
  const wLedgerCcy = Form.useWatch('currencyCode', ledgerForm) as string | undefined;
  const wLedgerCoa = Form.useWatch('chartOfAccountsId', ledgerForm) as string | undefined;
  const wLeName = Form.useWatch('name', leForm) as string | undefined;
  const wLeIdent = Form.useWatch('identifier', leForm) as string | undefined;
  const wBuName = Form.useWatch('businessUnitName', buForm) as string | undefined;
  const wBuCompany = Form.useWatch('company', buForm) as string | undefined;
  const wBuActive = Form.useWatch('activeFlag', buForm) as string | undefined;
  const wBuPcf = Form.useWatch('profitCenterFlag', buForm) as boolean | undefined;

  const loadRefs = useCallback(async () => {
    try {
      const [ledgerList, leList, buList, coaList] = await Promise.all([
        getItems(`${APEX}/gl/setup/ledgers`).catch(() => []),
        getItems(`${APEX}/gl/legalentities/all`).catch(() => getItems(`${APEX}/gl/legalentities`).catch(() => [])),
        getItems(`${APEX}/gl/businessunits`).catch(() => []),
        getItems(`${APEX}/chartofaccounts/getall`).catch(() => []),
      ]);
      setLedgers(ledgerList.map(i => ({
        ledgerId: n(i.ledgerId ?? i.ledger_id) ?? 0,
        ledgerName: s(i.ledgerName ?? i.ledger_name) ?? '',
        currencyCode: s(i.currencyCode ?? i.currency_code),
        chartOfAccountsName: s(i.chartOfAccountsName ?? i.chart_of_accounts_name),
      })));
      setLes(leList.map(i => ({
        legalEntityId: n(i.legalEntityId ?? i.legal_entity_id ?? i.LegalEntityId) ?? 0,
        name: s(i.name ?? i.Name ?? i.legal_entity_name) ?? '',
        identifier: s(i.legalEntityIdentifier ?? i.legal_entity_identifier),
      })));
      setCoa(coaList.map(i => ({
        id: s(i.structureinstanceid ?? i.structureInstanceId) ?? '',
        name: s(i.name ?? i.Name) ?? '',
        description: s(i.description),
      })).filter(c => c.id));
      const lLedger = new Set<number>();
      const lLe = new Set<number>();
      const names: string[] = [];
      buList.forEach(b => {
        const lid = n(b.primary_ledger_id ?? b.primaryLedgerId);
        const eid = n(b.legal_entity_id ?? b.legalEntityId);
        const bname = s(b.business_unit_name ?? b.businessUnitName);
        if (lid) lLedger.add(lid);
        if (eid) lLe.add(eid);
        if (bname) names.push(bname.toUpperCase());
      });
      setLinkedLedgerIds(lLedger);
      setLinkedLeIds(lLe);
      setBuNames(names);
    } catch { /* surfaced per step */ }
  }, []);

  // reset + load whenever opened
  useEffect(() => {
    if (!open) return;
    setStep(0); setBusy(false);
    setLedger(null); setLe(null); setBu(null); setCalendarDone(false);
    ledgerForm.resetFields(); leForm.resetFields(); buForm.resetFields(); calForm.resetFields();
    ledgerForm.setFieldsValue({ mode: 'create', currencyCode: 'AED' });
    leForm.setFieldsValue({ mode: 'create' });
    calForm.setFieldsValue({ calendarType: 'FISCAL', startYear: new Date().getFullYear(), numberOfYears: 10, includeAdjustment: true });
    loadRefs();
  }, [open, loadRefs, ledgerForm, leForm, buForm, calForm]);

  const availableLedgers = useMemo(() => ledgers.filter(l => !linkedLedgerIds.has(l.ledgerId)), [ledgers, linkedLedgerIds]);
  const availableLes = useMemo(() => les.filter(l => !linkedLeIds.has(l.legalEntityId)), [les, linkedLeIds]);

  // ── step commits ───────────────────────────────────────────────────────────
  const commitLedger = async () => {
    const v = await ledgerForm.validateFields();
    if (v.mode === 'existing') {
      const found = ledgers.find(l => l.ledgerId === v.existingLedgerId);
      if (!found) { message.error('Pick a ledger'); return; }
      setLedger({ id: found.ledgerId, name: found.ledgerName, currency: found.currencyCode });
      setStep(1); return;
    }
    setBusy(true);
    const nm = String(v.ledgerName).trim();
    const coaSel = coa.find(c => c.id === v.chartOfAccountsId);
    const r = await postJson(`${APEX}/gl/ledgers/create`, {
      ledgerName: nm, description: v.description, currencyCode: v.currencyCode || 'AED',
      chartOfAccountsId: v.chartOfAccountsId, chartOfAccountsName: coaSel?.name,
      createdBy: currentUser,
    });
    if (!r.ok || !r.id) {
      // name already exists → continue with the existing (unlinked) ledger
      if (/already exists/i.test(r.message || '')) {
        const list = await getItems(`${APEX}/gl/setup/ledgers`).catch(() => []);
        const m = list.map(i => ({ id: n(i.ledgerId ?? i.ledger_id) ?? 0, name: s(i.ledgerName ?? i.ledger_name) ?? '', currency: s(i.currencyCode ?? i.currency_code) }))
          .find(x => x.name.toUpperCase() === nm.toUpperCase());
        setBusy(false);
        if (m) {
          if (linkedLedgerIds.has(m.id)) { message.error(`Ledger "${m.name}" already exists and is linked to a business unit — use a different name.`); return; }
          message.info(`Ledger "${m.name}" already exists — using it.`);
          setLedger({ id: m.id, name: m.name, currency: m.currency }); setStep(1); return;
        }
        message.error(`Ledger "${nm}" already exists. Pick it under "Use existing", or use a different name.`); return;
      }
      setBusy(false); message.error(r.message); return;
    }
    setBusy(false);
    message.success(`Ledger created (id ${r.id})`);
    setLedger({ id: r.id, name: nm, currency: v.currencyCode });
    setStep(1);
  };

  const commitLe = async () => {
    const v = await leForm.validateFields();
    if (v.mode === 'existing') {
      const found = les.find(l => l.legalEntityId === v.existingLeId);
      if (!found) { message.error('Pick a legal entity'); return; }
      setLe({ id: found.legalEntityId, name: found.name || `LE ${found.legalEntityId}` });
      setStep(2); return;
    }
    setBusy(true);
    const nm = String(v.name).trim();
    const r = await postJson(`${APEX}/gl/legalentities/create`, {
      name: nm, identifier: v.identifier || null, createdBy: currentUser,
    });
    if (!r.ok || !r.id) {
      // name already exists → continue with the existing (unlinked) legal entity
      if (/already exists/i.test(r.message || '')) {
        const list = await getItems(`${APEX}/gl/legalentities/all`).catch(() => []);
        const m = list.map(i => ({ id: n(i.legalEntityId ?? i.legal_entity_id ?? i.LegalEntityId) ?? 0, name: s(i.name ?? i.Name ?? i.legal_entity_name) ?? '' }))
          .find(x => x.name.toUpperCase() === nm.toUpperCase());
        setBusy(false);
        if (m) {
          if (linkedLeIds.has(m.id)) { message.error(`"${nm}" already exists and is linked to a business unit — use a different name.`); return; }
          message.info(`Legal entity "${m.name}" already exists — using it.`);
          setLe({ id: m.id, name: m.name || `LE ${m.id}` }); setStep(2); return;
        }
        message.error(`"${nm}" already exists. Pick it under "Use existing", or use a different name.`); return;
      }
      setBusy(false); message.error(r.message); return;
    }
    setBusy(false);
    message.success(`Legal entity created (id ${r.id})`);
    setLe({ id: r.id, name: nm });
    setStep(2);
  };

  const commitBu = async () => {
    const v = await buForm.validateFields();
    if (!ledger || !le) { message.error('Complete the previous steps first'); return; }
    if (buNames.includes(String(v.businessUnitName).trim().toUpperCase())) {
      message.error(`Business unit "${v.businessUnitName}" already exists`); return;
    }
    setBusy(true);
    // resolve the names robustly so we never send the string "undefined"
    const leName = (le.name && le.name !== 'undefined')
      ? le.name : (les.find(l => l.legalEntityId === le.id)?.name || '');
    const ledgerName = (ledger.name && ledger.name !== 'undefined')
      ? ledger.name : (ledgers.find(l => l.ledgerId === ledger.id)?.ledgerName || '');
    const r = await postJson(`${APEX}/gl/businessunits/create`, {
      businessUnitName: String(v.businessUnitName).trim(),
      company: v.company,
      activeFlag: v.activeFlag ?? 'Y',
      profitCenterFlag: v.profitCenterFlag ? 'Y' : 'N',
      primaryLedgerId: ledger.id,
      legalEntityId: le.id,
      legalEntityName: leName,
      ledger: ledgerName,
      createdBy: currentUser,
    });
    setBusy(false);
    if (!r.ok || !r.id) { message.error(r.message); return; }
    message.success(`Business unit created (id ${r.id})`);
    setBu({ id: r.id, name: String(v.businessUnitName).trim() });
    setStep(3);
  };

  const commitCalendar = async () => {
    const v = await calForm.validateFields();
    if (!ledger) return;
    setBusy(true);
    const r = await postJson(`${APEX}/accountingcalendar`, {
      ledgerId: ledger.id,
      calendarType: v.calendarType,
      startYear: Number(v.startYear),
      numberOfYears: Number(v.numberOfYears),
      includeAdjustment: v.includeAdjustment ? 'Y' : 'N',
      createdBy: currentUser,
    });
    setBusy(false);
    if (!r.ok) { message.error(r.message); return; }
    message.success('Accounting calendar generated');
    setCalendarDone(true);
    setStep(4);
    onDone();
  };

  // preview for calendar
  const calPreview = useMemo(() => {
    const y = Number(calStartYear); if (!y) return '';
    const yy = (yr: number) => String(yr).slice(-2).padStart(2, '0');
    return calType === 'CALENDAR' ? `Jan-${yy(y)} … Dec-${yy(y)}` : `Apr-${yy(y - 1)} … Mar-${yy(y)}`;
  }, [calType, calStartYear]);

  // ── step bodies ──────────────────────────────────────────────────────────────
  const ledgerBody = (
    <>
      <Form form={ledgerForm} layout="vertical">
        <Form.Item name="mode" label="Ledger">
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio value="create">Create new</Radio>
            <Radio value="existing">Use existing (unlinked)</Radio>
          </Radio.Group>
        </Form.Item>
        {ledgerMode === 'existing' ? (
          <Form.Item name="existingLedgerId" label="Unlinked Ledger" rules={[{ required: true, message: 'Pick a ledger' }]}>
            <Select
              showSearch optionFilterProp="label"
              placeholder={availableLedgers.length ? 'Select a ledger not yet linked to a BU' : 'No unlinked ledgers — create a new one'}
              options={availableLedgers.map(l => ({ value: l.ledgerId, label: `${l.ledgerName}${l.currencyCode ? ` (${l.currencyCode})` : ''}` }))}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item name="ledgerName" label="Ledger Name" rules={[{ required: true, message: 'Enter the ledger name' }]}>
              <Input maxLength={100} placeholder="e.g. BUIMERC LEDGER" />
            </Form.Item>
            <Space size="large" align="start" style={{ display: 'flex' }}>
              <Form.Item name="currencyCode" label="Currency" rules={[{ required: true }]}>
                <Select style={{ width: 130 }} showSearch
                  options={['AED', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD'].map(c => ({ value: c, label: c }))} />
              </Form.Item>
              <Form.Item name="description" label="Description" style={{ flex: 1, minWidth: 220 }}>
                <Input maxLength={100} />
              </Form.Item>
            </Space>
            <Form.Item name="chartOfAccountsId" label="Chart of Accounts" tooltip="Accounting structure mapped to this ledger">
              <Select
                showSearch optionFilterProp="label" allowClear
                placeholder={coa.length ? 'Map a chart of accounts structure' : 'No chart of accounts found'}
                options={coa.map(c => ({ value: c.id, label: `${c.name}${c.description ? ` — ${c.description}` : ''}` }))}
              />
            </Form.Item>
          </>
        )}
      </Form>
      <ApiInspector calls={[
        { label: ' ledgers list', method: 'GET', url: `${APEX}/gl/setup/ledgers` },
        { label: ' chart of accounts', method: 'GET', url: `${APEX}/chartofaccounts/getall` },
        {
          label: ' create ledger', method: 'POST', url: `${APEX}/gl/ledgers/create`,
          body: {
            ledgerName: wLedgerName || '<enter ledger name>',
            description: wLedgerDesc || null,
            currencyCode: wLedgerCcy || 'AED',
            chartOfAccountsId: wLedgerCoa || null,
            chartOfAccountsName: coa.find(c => c.id === wLedgerCoa)?.name || null,
            createdBy: currentUser,
          },
        },
      ]} />
    </>
  );

  const leBody = (
    <>
      <Form form={leForm} layout="vertical">
        <Form.Item name="mode" label="Legal Entity">
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio value="create">Create new</Radio>
            <Radio value="existing">Use existing (unlinked)</Radio>
          </Radio.Group>
        </Form.Item>
        {leMode === 'existing' ? (
          <Form.Item name="existingLeId" label="Unlinked Legal Entity" rules={[{ required: true, message: 'Pick a legal entity' }]}>
            <Select
              showSearch optionFilterProp="label"
              placeholder={availableLes.length ? 'Select a legal entity not yet linked to a BU' : 'No unlinked legal entities — create a new one'}
              options={availableLes.map(l => ({ value: l.legalEntityId, label: `${l.name}${l.identifier ? ` (${l.identifier})` : ''}` }))}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item name="name" label="Legal Entity Name" rules={[{ required: true, message: 'Enter the legal entity name' }]}>
              <Input maxLength={360} placeholder="e.g. BUIMERC CORPORATION LIMITED" />
            </Form.Item>
            <Form.Item name="identifier" label="Identifier (optional)">
              <Input maxLength={60} placeholder="Registration / identifier" />
            </Form.Item>
          </>
        )}
      </Form>
      <ApiInspector calls={[
        { label: ' legal entities list', method: 'GET', url: `${APEX}/gl/legalentities/all` },
        {
          label: ' create legal entity', method: 'POST', url: `${APEX}/gl/legalentities/create`,
          body: { name: wLeName || '<enter legal entity name>', identifier: wLeIdent || null, createdBy: currentUser },
        },
      ]} />
    </>
  );

  const buBody = (
    <>
      <Alert
        type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
        message={<span>Linking <b>Ledger:</b> {ledger?.name} (id {ledger?.id}) &nbsp;·&nbsp; <b>Legal Entity:</b> {le?.name} (id {le?.id})</span>}
      />
      <Form form={buForm} layout="vertical" initialValues={{ activeFlag: 'Y', profitCenterFlag: false }}>
        <Form.Item name="businessUnitName" label="Business Unit Name" rules={[{ required: true, message: 'Enter the business unit name' }]}>
          <Input maxLength={360} placeholder="e.g. BUIMERC CORP_DIFC_TRADING" />
        </Form.Item>
        <Space size="large" align="start">
          <Form.Item name="company" label="Company Code"
            rules={[{ required: true, message: 'Enter the company code' }, { max: 5, message: 'Max 5 chars' }]}
            normalize={(v: string) => (v || '').toUpperCase()}>
            <Input maxLength={5} style={{ width: 130 }} placeholder="e.g. 01" />
          </Form.Item>
          <Form.Item name="activeFlag" label="Active Flag" rules={[{ required: true }]}>
            <Select style={{ width: 150 }} options={[{ value: 'Y', label: 'Active (Y)' }, { value: 'N', label: 'Inactive (N)' }]} />
          </Form.Item>
          <Form.Item name="profitCenterFlag" label="Profit Center" valuePropName="checked">
            <Switch checkedChildren="Yes" unCheckedChildren="No" />
          </Form.Item>
        </Space>
      </Form>
      <ApiInspector calls={[{
        label: ' create business unit (sequence id)', method: 'POST', url: `${APEX}/gl/businessunits/create`,
        body: {
          businessUnitName: wBuName || '<enter business unit name>',
          company: wBuCompany || '<company>',
          activeFlag: wBuActive || 'Y',
          profitCenterFlag: wBuPcf ? 'Y' : 'N',
          primaryLedgerId: ledger?.id,
          legalEntityId: le?.id,
          legalEntityName: le?.name,
          ledger: ledger?.name,
          createdBy: currentUser,
        },
      }]} />
    </>
  );

  const calBody = (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
        message={<span>Calendar for <b>{ledger?.name}</b> (ledger {ledger?.id}) — BU <b>{bu?.name}</b> created.</span>} />
      <Form form={calForm} layout="vertical">
        <Form.Item name="calendarType" label="Calendar Type" rules={[{ required: true }]}>
          <Select options={[{ value: 'FISCAL', label: 'Fiscal (Apr – Mar)' }, { value: 'CALENDAR', label: 'Calendar (Jan – Dec)' }]} />
        </Form.Item>
        <Space size="large" align="start">
          <Form.Item name="startYear" label="Start Year" rules={[{ required: true }]}>
            <InputNumber min={2000} max={2100} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="numberOfYears" label="Number of Years" rules={[{ required: true }]}>
            <InputNumber min={1} max={50} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="includeAdjustment" label="Quarter adjustments" valuePropName="checked">
            <Switch checkedChildren="Yes" unCheckedChildren="No" />
          </Form.Item>
        </Space>
        {calPreview && <Text type="secondary" style={{ fontSize: 12 }}>First year: <b>{calPreview}</b> (16 periods/year incl. quarter adjustments).</Text>}
      </Form>
      <ApiInspector calls={[{
        label: ' generate calendar', method: 'POST', url: `${APEX}/accountingcalendar`,
        body: {
          ledgerId: ledger?.id,
          calendarType: calForm.getFieldValue('calendarType') || 'FISCAL',
          startYear: Number(calForm.getFieldValue('startYear')) || undefined,
          numberOfYears: Number(calForm.getFieldValue('numberOfYears')) || undefined,
          includeAdjustment: calForm.getFieldValue('includeAdjustment') !== false ? 'Y' : 'N',
          createdBy: currentUser,
        },
      }]} />
    </>
  );

  const doneBody = (
    <div style={{ textAlign: 'center', padding: '24px 8px' }}>
      <CheckCircleTwoTone twoToneColor="#1D7B4D" style={{ fontSize: 48 }} />
      <Descriptions column={1} size="small" style={{ marginTop: 20, textAlign: 'left', maxWidth: 460, margin: '20px auto 0' }} bordered>
        <Descriptions.Item label="Ledger">{ledger?.name} <Text type="secondary">(id {ledger?.id})</Text></Descriptions.Item>
        <Descriptions.Item label="Legal Entity">{le?.name} <Text type="secondary">(id {le?.id})</Text></Descriptions.Item>
        <Descriptions.Item label="Business Unit">{bu?.name} <Text type="secondary">(id {bu?.id})</Text></Descriptions.Item>
        <Descriptions.Item label="Calendar">{calendarDone ? <Tag color="green">Generated</Tag> : <Tag>Skipped</Tag>}</Descriptions.Item>
      </Descriptions>
    </div>
  );

  const steps = [
    { title: 'Ledger', icon: <BankOutlined />, body: ledgerBody, onNext: commitLedger, nextText: ledgerMode === 'existing' ? 'Use Ledger' : 'Create Ledger' },
    { title: 'Legal Entity', icon: <DatabaseOutlined />, body: leBody, onNext: commitLe, nextText: leMode === 'existing' ? 'Use Legal Entity' : 'Create Legal Entity' },
    { title: 'Business Unit', icon: <ApartmentOutlined />, body: buBody, onNext: commitBu, nextText: 'Create Business Unit' },
    { title: 'Calendar', icon: <CalendarOutlined />, body: calBody, onNext: commitCalendar, nextText: 'Generate Calendar' },
    { title: 'Done', icon: <CheckCircleTwoTone twoToneColor="#1D7B4D" />, body: doneBody, onNext: onClose, nextText: 'Close' },
  ];

  const cur = steps[step];
  // once a step's record is created, its previous step is locked — no going back
  const backLocked =
    (step === 1 && !!ledger) ||
    (step === 2 && !!le) ||
    (step === 3 && !!bu);

  return (
    <Modal
      title={<span><ApartmentOutlined /> New Business Unit Setup</span>}
      open={open}
      onCancel={onClose}
      width={680}
      destroyOnClose
      maskClosable={false}
      footer={
        <Space>
          {step > 0 && step < 4 && (
            <Tooltip title={backLocked ? 'This step is already created — you can’t go back' : ''}>
              <Button disabled={busy || backLocked} onClick={() => setStep(step - 1)}>Back</Button>
            </Tooltip>
          )}
          {step < 4 && <Button onClick={onClose} disabled={busy}>Cancel</Button>}
          <Button type="primary" loading={busy} onClick={cur.onNext}>{cur.nextText}</Button>
        </Space>
      }
    >
      <Steps current={step} size="small" style={{ marginBottom: 18 }}
        items={steps.map(st => ({ title: st.title, icon: st.icon }))} />
      {cur.body}
    </Modal>
  );
};

export default BusinessUnitWizard;
