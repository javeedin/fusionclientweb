import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Card, Form, Input, Select, Button, Space, Typography, Table,
  Row, Col, Breadcrumb, Tag, Modal, InputNumber, DatePicker, Descriptions,
  Divider, message, Badge, Tooltip, Spin,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, AuditOutlined,
  DollarOutlined, InfoCircleOutlined, StopOutlined, ApiOutlined,
  SyncOutlined, CheckCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  getRetirements, getBookControls, retireAsset, formatCurrency,
  getRetirementAccountingPreview, createSlaAccounting, markFaDeprnAccounted,
  updateRetirementStatus,
} from '../../services/fa.service';
import type { RetirementRecord, BookControlRecord } from '../../services/fa.service';
import { buildApexUrl } from '../../config/api.helper';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { validateAccountCode } from '../../components/AccountSelector';
import { postSlaToGL } from '../../services/glPosting.service';
import type { GlPostingOptions } from '../../services/glPosting.service';

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

const statusColor: Record<string, string> = {
  PROCESSED:  REDWOOD.success,
  PENDING:    REDWOOD.warning,
  REINSTATE:  REDWOOD.info,
};

const Retirements: React.FC = () => {
  const [form]      = Form.useForm();
  const [retireForm] = Form.useForm();

  const [rows,         setRows]         = useState<RetirementRecord[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [searched,     setSearched]     = useState(false);
  const [bookControls, setBookControls] = useState<BookControlRecord[]>([]);

  // Retire modal
  const [retireOpen,   setRetireOpen]   = useState(false);
  const [retireTarget, setRetireTarget] = useState<RetirementRecord | null>(null);
  const [retireSaving, setRetireSaving] = useState(false);

  // Detail modal
  const [detailOpen,   setDetailOpen]   = useState(false);
  const [detailRecord, setDetailRecord] = useState<RetirementRecord | null>(null);

  // Edit modal
  const [editOpen,   setEditOpen]   = useState(false);
  const [editRecord, setEditRecord] = useState<RetirementRecord | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [accountsWithDesc, setAccountsWithDesc] = useState<Record<string, { combo: string; segments: string }>>({});

  // Accounting modal
  interface AcctLine { label: string; account: string; desc: string; dr: number; cr: number }
  interface AcctStepUI { label: string; method: string; url: string; payload?: any; status: 'pending' | 'posting' | 'done' | 'error'; detail?: string; response?: any; expanded?: boolean }
  interface AcctModalState { assetNumber: string; retirementId: string; assetDescription?: string; assetId?: string; bookTypeCode?: string; dateRetired?: string; loading: boolean; error?: string; acctLines?: AcctLine[]; posting: boolean; posted: boolean; steps: AcctStepUI[] }

  const [acctModal, setAcctModal] = useState<AcctModalState | null>(null);

  // API test modal
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);
  const [apiTestLoading, setApiTestLoading] = useState(false);

  // Retire API details modal
  const [retireApiOpen, setRetireApiOpen] = useState(false);

  useEffect(() => {
    getBookControls().then(setBookControls);
    loadRetirements();
  }, []);

  const loadRetirements = async (bookTypeCode?: string) => {
    setLoading(true);
    try {
      const data = await getRetirements(bookTypeCode);
      setRows(data);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = useCallback(async () => {
    const { bookTypeCode } = form.getFieldsValue();
    setLoading(true);
    try {
      // Build the API endpoint with query params
      const params = new URLSearchParams();
      if (bookTypeCode) params.append('bookTypeCode', bookTypeCode);
      const apiUrl = buildApexUrl(`fa/retirements${params.toString() ? '?' + params.toString() : ''}`);

      // Call the GET endpoint
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      // Update table with results
      const records = data.items || data || [];
      setRows(records);
      setSearched(true);

      // Show API response modal
      Modal.info({
        title: 'GET Retirements API Response',
        width: 900,
        content: (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: '#52c41a', marginBottom: 12, fontWeight: 600 }}>
              ✓ Success! Retrieved {records.length} retirement records
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600 }}>ENDPOINT (GET)</div>
            <Text copyable style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
              {apiUrl}
            </Text>
            <div style={{ fontSize: 11, color: '#888', margin: '16px 0 8px', fontWeight: 600 }}>RESPONSE ({records.length} records)</div>
            <div style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: 12, maxHeight: 500, overflow: 'auto' }}>
              <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' }}>
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          </div>
        ),
      });
    } catch (error) {
      message.error(`API Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [form]);

  const handleReset = () => {
    form.resetFields();
    loadRetirements();
  };

  const fetchAccountSegmentDescriptions = async (accountCombos: Record<string, string | null>) => {
    const results: Record<string, { combo: string; segments: string }> = {};
    const combosToFetch = Object.entries(accountCombos).filter(([_, v]) => v);

    for (const [key, combo] of combosToFetch) {
      if (!combo) continue;
      try {
        const validation = await validateAccountCode(combo);
        if (validation.segmentsLoaded && Object.keys(validation.segmentDetails).length > 0) {
          // Format segment descriptions: "Company: 01 | LOB: 00 | Dept: 00 | Account: 1111103 | ..."
          const descriptions = Object.entries(validation.segmentDetails)
            .map(([_, detail]) => `${detail.description || detail.value}`)
            .filter(d => d && d !== '')
            .join(' | ');
          results[key] = { combo, segments: descriptions || combo };
        } else {
          results[key] = { combo, segments: combo };
        }
      } catch (error) {
        console.error(`Error fetching segment details for ${combo}:`, error);
        results[key] = { combo, segments: combo };
      }
    }
    return results;
  };

  const openEdit = async (record: RetirementRecord) => {
    setEditRecord(record);
    setEditOpen(true);
    setEditLoading(true);

    try {
      const accounts = {
        assetCost: record.assetCostAccount || '',
        deprnReserve: record.deprnReserveAccount || '',
        proceeds: record.proceedsAccount || '',
        costOfRemoval: record.costOfRemovalAccount || '',
        gain: record.gainAccount || '',
        loss: record.lossAccount || '',
      };

      const descs = await fetchAccountSegmentDescriptions(accounts);
      setAccountsWithDesc(descs);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      message.error('Failed to load account details');
    } finally {
      setEditLoading(false);
    }
  };

  const describeCombo = async (combo: string): Promise<string> => {
    try {
      const result = await validateAccountCode(combo);
      if (result.segmentDetails) {
        // Get only segment4 (the last/most specific segment)
        const segments = Object.values(result.segmentDetails);
        const segment4 = segments[3]; // 0-indexed, so segment 4 is at index 3
        if (segment4) {
          return segment4.description || segment4.value || '';
        }
      }
    } catch (error) {
      console.error('Error describing combo:', error);
    }
    return combo;
  };

  const openAccounting = async (record: RetirementRecord | null) => {
    if (!record) return;
    setAcctModal({
      assetNumber: record.assetNumber,
      retirementId: record.retirementId,
      assetDescription: record.description,
      assetId: record.assetId,
      bookTypeCode: record.bookTypeCode,
      dateRetired: record.dateRetired,
      loading: true,
      acctLines: [],
      posting: false,
      posted: false,
      steps: [],
    });

    try {
      const preview = await getRetirementAccountingPreview(record.retirementId);
      if (!preview?.lines || preview.lines.length === 0) {
        setAcctModal(m => m && { ...m, error: preview.error || 'No accounting entries generated for this retirement', loading: false });
        return;
      }

      const lines: AcctLine[] = await Promise.all((preview.lines as any[]).map(async (l) => ({
        label: l.lineType || `Line ${l.lineNumber}`,
        account: l.accountCombination,
        desc: await describeCombo(l.accountCombination),
        dr: Number(l.enteredDr || 0),
        cr: Number(l.enteredCr || 0),
      })));

      // Update with asset description from preview if available
      setAcctModal(m => m && {
        ...m,
        acctLines: lines,
        loading: false,
        assetDescription: preview.assetDescription || m.assetDescription,
      });
    } catch (error) {
      console.error('Error loading accounting preview:', error);
      setAcctModal(m => m && { ...m, error: 'Failed to load accounting preview', loading: false });
    }
  };

  const setAcctStep = (i: number, patch: Partial<AcctStepUI>) =>
    setAcctModal(m => m && ({ ...m, steps: m.steps.map((x, idx) => idx === i ? { ...x, ...patch } : x) }));

  const postAccounting = async () => {
    if (!acctModal?.acctLines?.length) return;
    const { acctLines, retirementId, assetNumber, assetDescription, assetId, bookTypeCode, dateRetired } = acctModal;
    const userEmail = sessionStorage.getItem('userEmail') || 'reacterp';

    // SLA body with asset description included
    const slaBody = {
      header: {
        sourceTable: 'RR_FA_RETIREMENTS',
        sourceId: retirementId,
        sourceNumber: assetNumber,
        reference1: assetId,           // Asset ID
        reference2: retirementId,       // Retirement ID
        reference3: bookTypeCode,       // Book Type Code
        reference4: dateRetired,        // Date Retired
        reference5: 'ASSET_RETIREMENT', // Event Type
        description: assetDescription || `Asset Retirement ${assetNumber}`,
      },
      lines: acctLines.map((l, i) => ({
        lineNumber: i + 1,
        accountCombination: l.account,
        lineType: l.label,
        enteredDr: l.dr,
        enteredCr: l.cr,
        description: l.desc || l.label,
      })),
    };

    // GL posting options with all required metadata
    const glOptions: GlPostingOptions = {
      slaHeaderId: 0, // Will be set after SLA creation
      sourceNumber: assetNumber,
      sourceId: retirementId,
      eventTypeCode: 'ASSET_RETIREMENT',
      periodName: '', // Will be determined from accounting date
      ledgerName: bookTypeCode,
      ledgerId: 1, // Default ledger ID
      currency: 'USD', // Default currency
      accountingDate: dateRetired || new Date().toISOString().split('T')[0],
      legalEntity: '', // Optional
      businessUnit: bookTypeCode,
      journalDescription: assetDescription || `Asset Retirement ${assetNumber}`,
      lines: acctLines.map((l, i) => ({
        lineType: l.dr > 0 ? 'DR' : 'CR',
        enteredDr: l.dr > 0 ? l.dr : null,
        enteredCr: l.cr > 0 ? l.cr : null,
        accountedDr: l.dr > 0 ? l.dr : null,
        accountedCr: l.cr > 0 ? l.cr : null,
        description: `${l.label} - ${assetDescription || assetNumber}`,
        currencyCode: 'USD',
        accountingDate: dateRetired || new Date().toISOString().split('T')[0],
        accountCombination: l.account,
        accountingClass: null,
        legalEntity: null,
      })),
      createdBy: userEmail,
    };

    const steps: AcctStepUI[] = [
      { label: '1 · Create SLA Accounting', method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/sla/accounting/create`, payload: slaBody, status: 'pending', expanded: true },
      { label: '2 · Post SLA to GL Journal', method: 'POST', url: `${APEX_DB_CONFIG.baseUrl}/gl/journals/create`, payload: { note: 'built by postSlaToGL from SLA header' }, status: 'pending', expanded: false },
      { label: '3 · Update Retirement Status', method: 'PUT', url: `${APEX_DB_CONFIG.baseUrl}/fa/retirements/${retirementId}/status`, payload: { status: 'ACCOUNTED' }, status: 'pending', expanded: false },
    ];
    setAcctModal(m => m && ({ ...m, posting: true, steps }));

    try {
      // Step 1 — SLA
      setAcctStep(0, { status: 'posting' });
      const slaRes = await createSlaAccounting(slaBody as any);
      if (!slaRes.headerId) {
        setAcctStep(0, { status: 'error', detail: slaRes.error || slaRes.message || 'SLA failed', response: slaRes });
        setAcctModal(m => m && ({ ...m, posting: false }));
        message.error(slaRes.error || slaRes.message || 'SLA accounting failed');
        return;
      }
      setAcctStep(0, { status: 'done', detail: `SLA Header #${slaRes.headerId}`, response: slaRes });

      // Step 2 — GL
      setAcctStep(1, { status: 'posting' });
      const glRes = await postSlaToGL({
        ...glOptions,
        slaHeaderId: slaRes.headerId,
      });
      if (!glRes.success) {
        setAcctStep(1, { status: 'error', detail: glRes.error || 'GL post failed', response: glRes });
        setAcctModal(m => m && ({ ...m, posting: false }));
        message.error(glRes.error || 'GL journal post failed');
        return;
      }
      setAcctStep(1, { status: 'done', detail: `GL Batch ${glRes.batchId} · Header ${glRes.headerId}`, response: glRes });

      // Step 3 — Update status
      setAcctStep(2, { status: 'posting' });
      const statusRes = await updateRetirementStatus(retirementId, 'ACCOUNTED');
      if (!statusRes.success) {
        setAcctStep(2, { status: 'error', detail: statusRes.error || 'Status update failed', response: statusRes });
        setAcctModal(m => m && ({ ...m, posting: false }));
        message.error(statusRes.error || 'Failed to update retirement status');
        return;
      }
      setAcctStep(2, { status: 'done', detail: 'Status updated to ACCOUNTED', response: statusRes });

      setAcctModal(m => m && ({ ...m, posting: false, posted: true }));
      message.success(`Retirement ${assetNumber} accounted and posted to GL`);
      setEditOpen(false);
      setAcctModal(null);
      runSearch();
    } catch (e: any) {
      setAcctModal(m => m && ({ ...m, posting: false }));
      message.error(e?.message || 'Accounting failed');
    }
  };

  const handleRetireSubmit = async () => {
    if (!retireTarget) return;
    try {
      await retireForm.validateFields();
      const vals = retireForm.getFieldsValue();
      if (vals.dateRetired && dayjs.isDayjs(vals.dateRetired)) {
        vals.dateRetired = vals.dateRetired.format('YYYY-MM-DD');
      }
      setRetireSaving(true);
      const res = await retireAsset(retireTarget.assetId, {
        bookTypeCode:        retireTarget.bookTypeCode,
        assetId:             retireTarget.assetId,
        dateRetired:         vals.dateRetired,
        retirementTypeCode:  vals.retirementTypeCode || 'ORDINARY',
        proceedsOfSale:      vals.proceedsOfSale    || 0,
        costOfRemoval:       vals.costOfRemoval     || 0,
        soldTo:              vals.soldTo            || '',
        createdBy:           sessionStorage.getItem('userEmail') || 'reacterp',
        lines:               [],
      });
      if (res.success) {
        message.success(`Asset ${retireTarget.assetNumber} retired. Gain/Loss: ${formatCurrency(res.gainLoss || '0')}`);
        setRetireOpen(false);
        retireForm.resetFields();
        setRetireTarget(null);
        runSearch();
      } else {
        message.error(res.error || 'Retirement failed');
      }
    } finally {
      setRetireSaving(false);
    }
  };

  // ── Table columns ───────────────────────────────────────────────────────────
  const columns: ColumnsType<RetirementRecord> = [
    { title: 'Asset Number', dataIndex: 'assetNumber', key: 'assetNumber', width: 130,
      render: (v) => <Text strong style={{ color: FA_COLOR }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'Book',        dataIndex: 'bookTypeCode', key: 'bookTypeCode', width: 160, ellipsis: true },
    { title: 'Date Retired',dataIndex: 'dateRetired',  key: 'dateRetired',  width: 120 },
    { title: 'Type',        dataIndex: 'retirementTypeCode', key: 'type',   width: 100,
      render: (v) => v ? <Tag style={{ borderRadius: 4 }}>{v}</Tag> : '—' },
    { title: 'Cost Retired',dataIndex: 'costRetired',  key: 'costRetired',  width: 130, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'NBV Retired', dataIndex: 'nbvRetired',   key: 'nbvRetired',   width: 120, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'Proceeds',    dataIndex: 'proceedsOfSale',key: 'proceeds',    width: 120, align: 'right' as const,
      render: (v: any) => formatCurrency(v) },
    { title: 'Gain / Loss', dataIndex: 'gainLossAmount',key: 'gainLoss',    width: 120, align: 'right' as const,
      render: (v) => {
        const n = parseFloat(v || '0');
        return <Text style={{ color: n >= 0 ? REDWOOD.success : REDWOOD.primary, fontWeight: 600 }}>
          {formatCurrency(v)}
        </Text>;
      }},
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      render: (v) => <Tag color={statusColor[v] ? undefined : undefined}
        style={{ borderRadius: 4, background: `${statusColor[v] || REDWOOD.neutral600}20`,
                 color: statusColor[v] || REDWOOD.neutral600, border: `1px solid ${statusColor[v] || REDWOOD.neutral600}40` }}>
        {v || '—'}
      </Tag> },
    { title: '', key: 'actions', width: 100, align: 'center' as const,
      render: (_: any, record: RetirementRecord) => (
        <Space size="small">
          <Tooltip title="Edit accounting">
            <Button size="small" type="text" style={{ color: FA_COLOR }}
              onClick={() => openEdit(record)}>Edit</Button>
          </Tooltip>
          <Tooltip title="View details">
            <Button size="small" type="text" icon={<InfoCircleOutlined />}
              onClick={() => { setDetailRecord(record); setDetailOpen(true); }} />
          </Tooltip>
        </Space>
      ),
    },
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
            { title: 'Asset Retirements' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primary}99 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AuditOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Asset Retirements</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>View and process asset retirements</Text>
              </div>
            </Space>
          </div>

          {/* Filter card */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 }}
            bodyStyle={{ padding: '16px 20px' }}>
            <Form form={form} layout="vertical" onFinish={runSearch}>
              <Row gutter={[16, 0]}>
                <Col xs={24} sm={8} md={6}>
                  <Form.Item name="bookTypeCode" label="Book" style={{ marginBottom: 8 }}>
                    <Select allowClear showSearch optionFilterProp="children" placeholder="All books">
                      {bookControls.map(b => (
                        <Option key={b.bookTypeCode} value={b.bookTypeCode}>{b.bookTypeCode}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={16} md={18} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <Form.Item style={{ marginBottom: 8 }}>
                    <Space>
                      <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                        style={{ background: FA_COLOR, borderColor: FA_COLOR }}>
                        Search
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                    </Space>
                  </Form.Item>
                  <Tooltip title="View API endpoint and test">
                    <Button
                      size="small"
                      icon={<ApiOutlined />}
                      style={{ color: FA_COLOR, borderColor: FA_COLOR, fontSize: 11 }}
                      onClick={() => {
                        const { bookTypeCode } = form.getFieldsValue();
                        const params = new URLSearchParams();
                        if (bookTypeCode) params.append('bookTypeCode', bookTypeCode);
                        const apiUrl = buildApexUrl(`fa/retirements${params.toString() ? '?' + params.toString() : ''}`);

                        Modal.info({
                          title: 'Retirements API — GET Request',
                          width: 760,
                          content: (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>ENDPOINT (GET)</div>
                              <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                                {apiUrl}
                              </Text>
                              {bookTypeCode && (
                                <div style={{ marginTop: 12, fontSize: 11, color: '#666' }}>
                                  <div><strong>Query Parameters:</strong></div>
                                  <div style={{ marginLeft: 8, marginTop: 4 }}>
                                    <code>bookTypeCode = {bookTypeCode}</code>
                                  </div>
                                </div>
                              )}
                              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                                <Button
                                  size="small"
                                  type="primary"
                                  loading={apiTestLoading}
                                  onClick={() => {
                                    setApiTestResult(null);
                                    setApiTestLoading(true);
                                    fetch(apiUrl)
                                      .then(r => {
                                        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                                        return r.json();
                                      })
                                      .then(data => {
                                        setApiTestResult({
                                          success: true,
                                          message: `Success! Retrieved ${(data.items || data).length || 0} records`,
                                          data,
                                        });
                                      })
                                      .catch(err => {
                                        setApiTestResult({
                                          success: false,
                                          message: `Error: ${err.message}`,
                                        });
                                      })
                                      .finally(() => setApiTestLoading(false));
                                  }}
                                >
                                  Test API
                                </Button>
                              </div>
                              {apiTestResult && (
                                <div style={{
                                  marginTop: 12,
                                  padding: 12,
                                  borderRadius: 4,
                                  background: apiTestResult.success ? '#f6ffed' : '#fff2f0',
                                  border: `1px solid ${apiTestResult.success ? '#b7eb8f' : '#ffa39e'}`,
                                }}>
                                  <Text style={{ color: apiTestResult.success ? '#52c41a' : '#f5222d', fontSize: 12 }}>
                                    {apiTestResult.success ? '✓' : '✗'} {apiTestResult.message}
                                  </Text>
                                  {apiTestResult.data && (
                                    <div style={{ marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
                                      <pre style={{
                                        background: '#f5f5f5',
                                        padding: 8,
                                        borderRadius: 2,
                                        fontSize: 10,
                                        fontFamily: 'monospace',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                      }}>
                                        {JSON.stringify(apiTestResult.data, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ),
                        });
                      }}
                    >
                      API
                    </Button>
                  </Tooltip>
                </Col>
              </Row>
            </Form>
          </Card>

          {/* Results table */}
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            bodyStyle={{ padding: 0 }}
            title={
              searched
                ? <Text strong>Retirements <Badge count={rows.length} style={{ backgroundColor: REDWOOD.primary }} /></Text>
                : <Text strong>Retirements</Text>
            }
          >
            <Table<RetirementRecord>
              dataSource={rows}
              columns={columns}
              rowKey="retirementId"
              loading={loading}
              size="small"
              scroll={{ x: 1200 }}
              locale={{ emptyText: 'No retirement records found' }}
              pagination={{ pageSize: 50, showTotal: (t) => `${t} records`, showSizeChanger: true }}
            />
          </Card>
        </div>

        {/* Retire Asset Modal */}
        <Modal
          open={retireOpen}
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <StopOutlined style={{ color: REDWOOD.primary }} />
                <span>Retire Asset — {retireTarget?.assetNumber}</span>
              </Space>
              <Tooltip title="View API endpoint and test">
                <Button
                  type="text"
                  size="small"
                  icon={<ApiOutlined />}
                  style={{ color: FA_COLOR, fontSize: 12 }}
                  onClick={() => setRetireApiOpen(true)}
                />
              </Tooltip>
            </div>
          }
          onCancel={() => { setRetireOpen(false); retireForm.resetFields(); }}
          onOk={handleRetireSubmit}
          okText="Process Retirement"
          confirmLoading={retireSaving}
          okButtonProps={{ danger: true }}
          width={560}
        >
          {retireTarget && (
            <>
              <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="Asset">{retireTarget.assetNumber}</Descriptions.Item>
                <Descriptions.Item label="Book">{retireTarget.bookTypeCode}</Descriptions.Item>
                <Descriptions.Item label="Description" span={2}>{retireTarget.description}</Descriptions.Item>
              </Descriptions>
              <Divider />
              <Form form={retireForm} layout="vertical">
                <Row gutter={[16, 0]}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="dateRetired" label="Date Retired" rules={[{ required: true, message: 'Required' }]}>
                      <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="retirementTypeCode" label="Retirement Type">
                      <Select allowClear placeholder="Select">
                        <Option value="ORDINARY">Ordinary</Option>
                        <Option value="SALE">Sale</Option>
                        <Option value="THEFT">Theft</Option>
                        <Option value="ABANDONMENT">Abandonment</Option>
                        <Option value="LIKE-KIND">Like-Kind Exchange</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="proceedsOfSale" label="Proceeds of Sale" initialValue={0}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.01} prefix={<DollarOutlined />} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="costOfRemoval" label="Cost of Removal" initialValue={0}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.01} prefix={<DollarOutlined />} />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item name="soldTo" label="Sold To">
                      <Input placeholder="Buyer name or reference" />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </>
          )}
        </Modal>

        {/* Detail Modal */}
        <Modal
          open={detailOpen}
          title={
            <Space>
              <AuditOutlined style={{ color: FA_COLOR }} />
              <span>Retirement Detail — {detailRecord?.assetNumber}</span>
            </Space>
          }
          onCancel={() => setDetailOpen(false)}
          footer={[
            <Button key="close" onClick={() => setDetailOpen(false)}>Close</Button>,
          ]}
          width={620}
        >
          {detailRecord && (
            <Descriptions column={2} size="small" bordered labelStyle={{ fontWeight: 500, width: 150 }}>
              <Descriptions.Item label="Retirement ID">{detailRecord.retirementId}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag style={{ borderRadius: 4, background: `${statusColor[detailRecord.status] || REDWOOD.neutral600}20`,
                  color: statusColor[detailRecord.status] || REDWOOD.neutral600 }}>
                  {detailRecord.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Asset Number">{detailRecord.assetNumber}</Descriptions.Item>
              <Descriptions.Item label="Book">{detailRecord.bookTypeCode}</Descriptions.Item>
              <Descriptions.Item label="Description" span={2}>{detailRecord.description}</Descriptions.Item>
              <Descriptions.Item label="Date Retired">{detailRecord.dateRetired}</Descriptions.Item>
              <Descriptions.Item label="Retirement Type">{detailRecord.retirementTypeCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="Cost Retired">{formatCurrency(detailRecord.costRetired)}</Descriptions.Item>
              <Descriptions.Item label="NBV Retired">{formatCurrency(detailRecord.nbvRetired)}</Descriptions.Item>
              <Descriptions.Item label="Proceeds">{formatCurrency(detailRecord.proceedsOfSale)}</Descriptions.Item>
              <Descriptions.Item label="Cost of Removal">{formatCurrency(detailRecord.costOfRemoval)}</Descriptions.Item>
              <Descriptions.Item label="Gain / Loss">
                <Text style={{ fontWeight: 600, color: parseFloat(detailRecord.gainLossAmount || '0') >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                  {formatCurrency(detailRecord.gainLossAmount)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Sold To">{detailRecord.soldTo || '—'}</Descriptions.Item>
            </Descriptions>
          )}
        </Modal>

        {/* Edit Retirement Modal */}
        <Modal
          open={editOpen}
          title={
            <Space>
              <StopOutlined style={{ color: REDWOOD.primary }} />
              <span>Edit Retirement — {editRecord?.retirementId}</span>
            </Space>
          }
          onCancel={() => setEditOpen(false)}
          footer={[
            <Button key="acct" type="primary" onClick={() => openAccounting(editRecord)} disabled={!editRecord || editRecord.status === 'PROCESSED'}>Create Accounting</Button>,
            <Button key="close" onClick={() => setEditOpen(false)}>Close</Button>,
          ]}
          width={1000}
          loading={editLoading}
        >
          {editRecord && (
            <>
              {/* Header Info */}
              <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                <Col xs={24} sm={6}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>RETIREMENT ID</div>
                  <Text strong style={{ fontSize: 14 }}>{editRecord.retirementId}</Text>
                </Col>
                <Col xs={24} sm={6}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>ASSET</div>
                  <Text strong style={{ fontSize: 14 }}>{editRecord.assetNumber}</Text>
                </Col>
                <Col xs={24} sm={6}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>DATE RETIRED</div>
                  <Text style={{ fontSize: 14 }}>{editRecord.dateRetired}</Text>
                </Col>
                <Col xs={24} sm={6}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>STATUS</div>
                  <Tag style={{ borderRadius: 4, background: `${statusColor[editRecord.status] || REDWOOD.neutral600}20`,
                    color: statusColor[editRecord.status] || REDWOOD.neutral600 }}>
                    {editRecord.status}
                  </Tag>
                </Col>
              </Row>

              {/* Financial Summary */}
              <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                <Col xs={24} sm={6}>
                  <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Cost Retired</Text>
                    <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900 }}>{formatCurrency(editRecord.costRetired)}</Text>
                  </Card>
                </Col>
                <Col xs={24} sm={6}>
                  <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>NBV Retired</Text>
                    <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900 }}>{formatCurrency(editRecord.nbvRetired)}</Text>
                  </Card>
                </Col>
                <Col xs={24} sm={6}>
                  <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Proceeds</Text>
                    <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900 }}>{formatCurrency(editRecord.proceedsOfSale)}</Text>
                  </Card>
                </Col>
                <Col xs={24} sm={6}>
                  <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Gain / Loss</Text>
                    <Text strong style={{ fontSize: 13, color: parseFloat(editRecord.gainLossAmount || '0') >= 0 ? REDWOOD.success : REDWOOD.primary }}>
                      {formatCurrency(editRecord.gainLossAmount)}
                    </Text>
                  </Card>
                </Col>
              </Row>

              <Divider style={{ margin: '16px 0' }} />

              {/* Accounting Accounts - 2 Rows x 3 Columns */}
              {!editLoading && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: REDWOOD.neutral900 }}>ACCOUNTING ACCOUNTS</div>
                  <Row gutter={[16, 16]}>
                    {[
                      { label: 'Asset Cost Account', key: 'assetCost', value: editRecord.assetCostAccount },
                      { label: 'Depreciation Reserve Account', key: 'deprnReserve', value: editRecord.deprnReserveAccount },
                      { label: 'Proceeds of Sale Account', key: 'proceeds', value: editRecord.proceedsAccount },
                      { label: 'Cost of Removal Account', key: 'costOfRemoval', value: editRecord.costOfRemovalAccount },
                      { label: 'Gain Account', key: 'gain', value: editRecord.gainAccount },
                      { label: 'Loss Account', key: 'loss', value: editRecord.lossAccount },
                    ].map(({ label, key, value }) => (
                      <Col xs={24} sm={8} key={key}>
                        <Card size="small" style={{ background: REDWOOD.neutral100, height: '100%' }}>
                          <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 8, color: REDWOOD.neutral900 }}>
                            {label}
                          </Text>
                          {value ? (
                            <>
                              <Text copyable style={{ fontFamily: 'monospace', fontSize: 10, color: '#0572CE', display: 'block', marginBottom: 6, wordBreak: 'break-all' }}>
                                {value}
                              </Text>
                              {accountsWithDesc[key] && (
                                <Text type="secondary" style={{ fontSize: 10, display: 'block', lineHeight: '1.4' }}>
                                  {accountsWithDesc[key].segments}
                                </Text>
                              )}
                            </>
                          ) : (
                            <Text type="secondary" style={{ fontSize: 10 }}>—</Text>
                          )}
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </>
              )}
            </>
          )}
        </Modal>

        {/* Retire Asset API Details Modal */}
        <Modal
          open={retireApiOpen}
          title="Retire Asset API Details"
          onCancel={() => setRetireApiOpen(false)}
          footer={[
            <Button key="close" onClick={() => setRetireApiOpen(false)}>Close</Button>,
            <Button
              key="test"
              type="primary"
              loading={apiTestLoading}
              style={{ background: FA_COLOR, borderColor: FA_COLOR }}
              onClick={() => {
                if (!retireTarget) return;
                setApiTestLoading(true);
                const vals = retireForm.getFieldsValue();
                let dateRetired = vals.dateRetired;
                if (dayjs.isDayjs(dateRetired)) {
                  dateRetired = dateRetired.format('YYYY-MM-DD');
                }
                const payload = {
                  bookTypeCode:        retireTarget.bookTypeCode,
                  assetId:             retireTarget.assetId,
                  dateRetired:         dateRetired,
                  retirementTypeCode:  vals.retirementTypeCode || 'ORDINARY',
                  proceedsOfSale:      vals.proceedsOfSale    || 0,
                  costOfRemoval:       vals.costOfRemoval     || 0,
                  soldTo:              vals.soldTo            || '',
                  createdBy:           sessionStorage.getItem('userEmail') || 'reacterp',
                  lines:               [],
                };
                const apiUrl = buildApexUrl('fa/retirements');
                fetch(apiUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                })
                  .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
                    return r.json();
                  })
                  .then(data => {
                    setApiTestResult({ success: true, message: 'Success', data });
                    message.success('API test successful');
                  })
                  .catch(e => {
                    setApiTestResult({ success: false, message: e.message });
                    message.error(`API test failed: ${e.message}`);
                  })
                  .finally(() => setApiTestLoading(false));
              }}
            >
              Test API
            </Button>,
          ]}
          width={900}
        >
          {retireTarget && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>ENDPOINT (POST)</div>
              <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                {buildApexUrl('fa/retirements')}
              </Text>

              <div style={{ fontSize: 11, color: '#888', margin: '16px 0 8px', fontWeight: 600 }}>REQUEST BODY</div>
              <div style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: 12, maxHeight: 400, overflow: 'auto' }}>
                <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' }}>
                  {JSON.stringify({
                    bookTypeCode:        retireTarget.bookTypeCode,
                    assetId:             retireTarget.assetId,
                    dateRetired:         retireForm.getFieldValue('dateRetired') ? (dayjs.isDayjs(retireForm.getFieldValue('dateRetired')) ? retireForm.getFieldValue('dateRetired').format('YYYY-MM-DD') : retireForm.getFieldValue('dateRetired')) : new Date().toISOString().split('T')[0],
                    retirementTypeCode:  retireForm.getFieldValue('retirementTypeCode') || 'ORDINARY',
                    proceedsOfSale:      retireForm.getFieldValue('proceedsOfSale') || 0,
                    costOfRemoval:       retireForm.getFieldValue('costOfRemoval') || 0,
                    soldTo:              retireForm.getFieldValue('soldTo') || '',
                    createdBy:           sessionStorage.getItem('userEmail') || 'reacterp',
                    lines:               [],
                  }, null, 2)}
                </pre>
              </div>

              {apiTestResult && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600 }}>RESPONSE</div>
                  <div style={{ background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, padding: 12, maxHeight: 300, overflow: 'auto' }}>
                    <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' }}>
                      {JSON.stringify(apiTestResult.data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>

        {/* Accounting Preview & Posting Modal */}
        {acctModal && (
          <Modal
            title={<Space><AuditOutlined style={{ color: '#722ed1' }} /><span>Create Accounting — Asset {acctModal.assetNumber} · Retirement {acctModal.retirementId}</span></Space>}
            open
            onCancel={() => { if (!acctModal.posting) setAcctModal(null); }}
            maskClosable={!acctModal.posting}
            width={1000}
            footer={[
              <Button key="cancel" disabled={acctModal.posting} onClick={() => setAcctModal(null)}>Close</Button>,
              <Button key="run" type="primary" icon={<AuditOutlined />} loading={acctModal.posting}
                disabled={acctModal.loading || !!acctModal.error || acctModal.posted || !acctModal.acctLines?.length}
                style={{ background: acctModal.posted ? undefined : FA_COLOR, borderColor: acctModal.posted ? undefined : FA_COLOR }}
                onClick={postAccounting}>
                {acctModal.posted ? 'Accounted' : 'Run Accounting'}
              </Button>,
            ]}
          >
            {acctModal.loading ? (
              <Spin tip="Loading preview..." />
            ) : acctModal.error ? (
              <Alert type="warning" showIcon message="Cannot create accounting" description={acctModal.error} />
            ) : acctModal.posted ? (
              <div style={{ textAlign: 'center', padding: '40px', color: REDWOOD.success }}>
                <Text strong style={{ fontSize: 16 }}>✓ Accounting posted successfully</Text>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Asset: {acctModal.assetNumber}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>Retirement ID: {acctModal.retirementId}</Text>
                </div>

                {acctModal.acctLines && acctModal.acctLines.length > 0 && (
                  <>
                    <Divider style={{ margin: '12px 0' }} />
                    <Text style={{ fontSize: 12, fontWeight: 600 }}>Journal Entries Preview</Text>
                    <Table
                      size="small"
                      style={{ marginTop: 8 }}
                      columns={[
                        { title: 'Line', dataIndex: 'label', key: 'label', width: 150 },
                        { title: 'Account', dataIndex: 'account', key: 'account', width: 180,
                          render: (v) => <Text copyable style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text> },
                        { title: 'Description', dataIndex: 'desc', key: 'desc', ellipsis: true },
                        { title: 'Debit', dataIndex: 'dr', key: 'dr', width: 100, align: 'right' as const,
                          render: (v) => v > 0 ? formatCurrency(v) : '—' },
                        { title: 'Credit', dataIndex: 'cr', key: 'cr', width: 100, align: 'right' as const,
                          render: (v) => v > 0 ? formatCurrency(v) : '—' },
                      ]}
                      dataSource={acctModal.acctLines.map((l, i) => ({ ...l, key: i }))}
                      pagination={false}
                    />
                    <div style={{ marginTop: 12, textAlign: 'right', paddingRight: 20 }}>
                      <Text strong style={{ marginRight: 40 }}>Dr: {formatCurrency(acctModal.acctLines.reduce((sum, l) => sum + l.dr, 0))}</Text>
                      <Text strong>Cr: {formatCurrency(acctModal.acctLines.reduce((sum, l) => sum + l.cr, 0))}</Text>
                    </div>
                  </>
                )}

                {acctModal.steps.length > 0 && (
                  <div style={{ border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 6, marginTop: 16 }}>
                    {acctModal.steps.map((s, i) => {
                      const color = s.status === 'done' ? REDWOOD.success : s.status === 'error' ? REDWOOD.primary : s.status === 'posting' ? '#1677ff' : REDWOOD.neutral500;
                      return (
                        <div key={i} style={{ borderTop: i === 0 ? 'none' : `1px solid ${REDWOOD.neutral200}` }}>
                          <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: s.expanded ? '#fafafa' : '#fff' }}
                            onClick={() => setAcctModal(m => m && ({ ...m, steps: m.steps.map((x, idx) => idx === i ? { ...x, expanded: !x.expanded } : x) }))}>
                            {s.status === 'posting' ? <SyncOutlined spin style={{ color: '#1677ff' }} />
                              : s.status === 'done' ? <CheckCircleOutlined style={{ color: REDWOOD.success }} />
                              : s.status === 'error' ? <Tag color="error" style={{ margin: 0 }}>ERR</Tag>
                              : <ClockCircleOutlined style={{ color: REDWOOD.neutral500 }} />}
                            <Text strong style={{ fontSize: 12 }}>{s.label}</Text>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral500, flex: 1 }} ellipsis>{s.method} {s.url}</Text>
                            <Text style={{ fontSize: 11, color, fontWeight: 600 }}>{s.detail}</Text>
                            <Text style={{ fontSize: 10, color: '#999' }}>{s.expanded ? '▲' : '▼'}</Text>
                          </div>
                          {s.expanded && (
                            <div style={{ padding: '0 12px 10px 32px', display: 'flex', gap: 12 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ fontSize: 10, color: '#888' }}>Request Payload</Text>
                                <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 8, margin: '4px 0 0', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(s.payload, null, 2)}</pre>
                              </div>
                              {s.response !== undefined && (
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={{ fontSize: 10, color: '#888' }}>Response</Text>
                                  <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#79c0ff', borderRadius: 4, padding: 8, margin: '4px 0 0', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(s.response, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Modal>
        )}
      </Content>


    </Layout>
  );
};

export default Retirements;
