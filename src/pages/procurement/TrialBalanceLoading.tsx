import React, { useState, useRef, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Input, Select,
  Space, Tag, Statistic, Row, Col, Empty, Tooltip, Alert, Modal,
  Divider, Progress, Spin, message,
} from 'antd';
import {
  HomeOutlined, UploadOutlined, ClearOutlined, DownloadOutlined,
  FilterOutlined, FileExcelOutlined, TableOutlined, SafetyCertificateOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PlusOutlined, DeleteOutlined,
  SyncOutlined, InfoCircleOutlined, SaveOutlined, FolderOpenOutlined, LinkOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { FUSION_POD_AUTH } from '../../config/fusionInstance';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A',
};

const COA_BASE = `${getFusionBase()}/valueSets`;
const HDRS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: FUSION_POD_AUTH,
};

const COA_SEGMENTS = [
  { key: 'coa-company',          label: 'Company',          valueSet: 'Company_VS'          },
  { key: 'coa-main-account',     label: 'Main Account',     valueSet: 'Main Account VS'     },
  { key: 'coa-sub-account',      label: 'Sub Account',      valueSet: 'Sub Account VS'      },
  { key: 'coa-division',         label: 'Division',         valueSet: 'Division VS'         },
  { key: 'coa-department',       label: 'Department',       valueSet: 'Department VS'       },
  { key: 'coa-lob',              label: 'LOB',              valueSet: 'LOB'                 },
  { key: 'coa-activity-type',    label: 'Activity Type',    valueSet: 'Activity Type VS'    },
  { key: 'coa-analysis-details', label: 'Analysis Details', valueSet: 'Analysis Details VS' },
  { key: 'coa-analysis-type',    label: 'Analysis Type',    valueSet: 'Analysis Type VS'    },
  { key: 'coa-ic',               label: 'IC',               valueSet: 'IC VS'               },
  { key: 'coa-emp',              label: 'Emp',              valueSet: 'Emp VS'              },
  { key: 'coa-future-1',         label: 'Future 1',         valueSet: 'Future 1'            },
  { key: 'coa-future-2',         label: 'Future 2',         valueSet: 'Future 2'            },
  { key: 'coa-future-3',         label: 'Future 3',         valueSet: 'Future 3'            },
];

const coaValuesUrl = (valueSet: string) =>
  `${COA_BASE}/${encodeURIComponent(valueSet)}/child/values?limit=500&offset=0`;

const MAPPING_FILE = 'TB_SegmentMappings.csv';

type TBRow = Record<string, string | number | null>;

interface SegmentMapping {
  id: string;
  excelColumn: string;
  coaSegmentKey: string;
}

interface ValidationResult {
  coaSegmentKey: string;
  excelColumn: string;
  coaLabel: string;
  apiUrl: string;
  totalValues: number;
  validCount: number;
  invalidValues: { value: string; count: number }[];
  error: string;
}

const fmt = (v: number) =>
  v.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TrialBalanceLoading: React.FC = () => {
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const mappingFileRef  = useRef<HTMLInputElement>(null);

  const [rows, setRows]         = useState<TBRow[]>([]);
  const [columns, setColumns]   = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const [filters, setFilters]           = useState<Record<string, string>>({});
  const [globalSearch, setGlobalSearch] = useState('');

  const [validateModal, setValidateModal]       = useState(false);
  const [mappings, setMappings]                 = useState<SegmentMapping[]>([]);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [validating, setValidating]             = useState(false);
  const [validated, setValidated]               = useState(false);
  const [validError, setValidError]             = useState('');

  // ── Load Excel ───────────────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    setLoading(true); setError('');
    setValidationResults([]); setValidated(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data  = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb    = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // Add __rowIdx so we can track original row position through filtering
        const json  = (XLSX.utils.sheet_to_json<TBRow>(sheet, { defval: null }))
          .map((r, i) => ({ ...r, __rowIdx: i }));
        if (json.length === 0) { setError('No data found in the spreadsheet.'); setLoading(false); return; }
        const cols = Object.keys(json[0]).filter(c => c !== '__rowIdx');
        setColumns(cols);
        setRows(json);
        setFilters({});
        setGlobalSearch('');
        setFileName(file.name);

        // Auto-map by column name similarity
        const autoMaps: SegmentMapping[] = [];
        cols.forEach(col => {
          const cl = col.toLowerCase().replace(/[_\s-]/g, '');
          const match = COA_SEGMENTS.find(s => {
            const sl = s.label.toLowerCase().replace(/[_\s-]/g, '');
            return cl === sl || cl.includes(sl) || sl.includes(cl);
          });
          if (match && !autoMaps.some(m => m.coaSegmentKey === match.key)) {
            autoMaps.push({ id: `${col}-${match.key}`, excelColumn: col, coaSegmentKey: match.key });
          }
        });
        if (autoMaps.length > 0) setMappings(autoMaps);
      } catch {
        setError('Failed to read the file. Make sure it is a valid Excel (.xlsx / .xls) file.');
      }
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = '';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) handleFile(file);
  };

  // ── Save / Load mappings as CSV ───────────────────────────────────────────────
  const saveMappings = async () => {
    const validMaps = mappings.filter(m => m.excelColumn && m.coaSegmentKey);
    if (validMaps.length === 0) { message.warning('No mappings to save.'); return; }
    const csv = ['excelColumn,coaSegmentKey,coaLabel',
      ...validMaps.map(m => {
        const seg = COA_SEGMENTS.find(s => s.key === m.coaSegmentKey);
        return `"${m.excelColumn}","${m.coaSegmentKey}","${seg?.label ?? ''}"`;
      })
    ].join('\n');

    try {
      // Use File System Access API to save to user-chosen location (suggest c:/fusion)
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: MAPPING_FILE,
        startIn: 'desktop',
        types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
      message.success(`Mappings saved to ${handle.name}`);
    } catch {
      // Fallback: download normally
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = MAPPING_FILE; a.click();
      URL.revokeObjectURL(url);
      message.success(`Mappings downloaded as ${MAPPING_FILE}`);
    }
  };

  const loadMappingsFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const lines = (ev.target!.result as string).split('\n').filter(l => l.trim());
        const loaded: SegmentMapping[] = [];
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
          if (parts.length >= 2 && parts[0] && parts[1]) {
            loaded.push({ id: `load-${i}`, excelColumn: parts[0], coaSegmentKey: parts[1] });
          }
        }
        if (loaded.length === 0) { message.error('No valid mappings found in CSV.'); return; }
        setMappings(loaded);
        message.success(`${loaded.length} mapping(s) loaded from ${file.name}`);
      } catch {
        message.error('Failed to read mapping file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Run validation ────────────────────────────────────────────────────────────
  const runValidation = async () => {
    const validMaps = mappings.filter(m => m.excelColumn && m.coaSegmentKey);
    if (validMaps.length === 0) return;
    setValidating(true); setValidError(''); setValidated(false);
    try {
      const results: ValidationResult[] = await Promise.all(
        validMaps.map(async (m) => {
          const seg = COA_SEGMENTS.find(s => s.key === m.coaSegmentKey)!;
          const apiUrl = coaValuesUrl(seg.valueSet);
          const result: ValidationResult = {
            coaSegmentKey: m.coaSegmentKey, excelColumn: m.excelColumn,
            coaLabel: seg.label, apiUrl,
            totalValues: 0, validCount: 0,
            invalidValues: [], error: '',
          };
          try {
            const validSet = new Set<string>();
            let next: string | null = coaValuesUrl(seg.valueSet);
            while (next) {
              const r = await fetch(next, { headers: HDRS });
              if (!r.ok) throw new Error(`HTTP ${r.status} for ${seg.valueSet}`);
              const d = await r.json();
              (d.items || []).forEach((i: any) => {
                const v = String(i.Value ?? '').trim();
                if (v) validSet.add(v);
              });
              const nl = (d.links || []).find((l: any) => l.rel === 'next');
              next = nl?.href ?? null;
            }
            const valueCounts: Record<string, number> = {};
            rows.forEach(row => {
              const v = String(row[m.excelColumn] ?? '').trim();
              if (v) valueCounts[v] = (valueCounts[v] ?? 0) + 1;
            });
            const uniqueVals = Object.keys(valueCounts);
            result.totalValues = uniqueVals.length;
            result.validCount  = uniqueVals.filter(v => validSet.has(v)).length;
            result.invalidValues = uniqueVals
              .filter(v => !validSet.has(v))
              .map(v => ({ value: v, count: valueCounts[v] }))
              .sort((a, b) => b.count - a.count);
          } catch (e: any) {
            result.error = e.message;
          }
          return result;
        })
      );
      setValidationResults(results);
      setValidated(true);
    } catch (e: any) {
      setValidError(e.message || 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  // ── Filtered rows ─────────────────────────────────────────────────────────────
  const filteredRows = rows.filter(row => {
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      if (!columns.some(c => String(row[c] ?? '').toLowerCase().includes(q))) return false;
    }
    for (const [col, val] of Object.entries(filters)) {
      if (!val) continue;
      if (!String(row[col] ?? '').toLowerCase().includes(val.toLowerCase())) return false;
    }
    return true;
  });

  const numericCols = columns.filter(c => rows.some(r => typeof r[c] === 'number'));
  // Only format columns whose name suggests a monetary amount
  const AMOUNT_KEYWORDS = /amount|debit|credit|balance|value|total|dr|cr/i;
  const amountCols = new Set(numericCols.filter(c => AMOUNT_KEYWORDS.test(c)));
  const totals: Record<string, number> = {};
  numericCols.forEach(c => {
    totals[c] = filteredRows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0);
  });
  const categoricalCols = columns.filter(c =>
    !numericCols.includes(c) && new Set(rows.map(r => String(r[c] ?? ''))).size <= 100
  );

  // Build invalid __rowIdx set
  const invalidRowIdxSet = new Set<number>();
  if (validated) {
    validationResults.forEach(vr => {
      if (vr.invalidValues.length === 0 || vr.error) return;
      const badVals = new Set(vr.invalidValues.map(iv => iv.value));
      rows.forEach(row => {
        if (badVals.has(String(row[vr.excelColumn] ?? '').trim())) {
          invalidRowIdxSet.add(row.__rowIdx as number);
        }
      });
    });
  }

  // ── Table columns ─────────────────────────────────────────────────────────────
  const tableColumns = columns.map(col => {
    const isNum    = numericCols.includes(col);
    const isAmount = amountCols.has(col);
    const vr       = validated ? validationResults.find(r => r.excelColumn === col) : undefined;
    const badSet   = new Set(vr?.invalidValues.map(iv => iv.value) ?? []);

    return {
      title: (
        <Space size={4}>
          <span style={{ fontSize: 11 }}>{col}</span>
          {vr && !vr.error && (vr.invalidValues.length === 0
            ? <Tooltip title="All values valid"><CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 10 }} /></Tooltip>
            : <Tooltip title={`${vr.invalidValues.length} invalid`}><CloseCircleOutlined style={{ color: REDWOOD.primary, fontSize: 10 }} /></Tooltip>
          )}
        </Space>
      ),
      dataIndex: col, key: col,
      width: isAmount ? 140 : 120,
      ellipsis: true,
      align: (isAmount ? 'right' : 'left') as 'right' | 'left',
      render: (v: string | number | null) => {
        if (v === null || v === '') return <Text type="secondary">—</Text>;
        if (isAmount) return (
          <Text style={{ fontFamily: 'monospace', fontSize: 11, color: (v as number) < 0 ? REDWOOD.primary : REDWOOD.neutral900 }}>
            {fmt(v as number)}
          </Text>
        );
        // Non-amount numeric (segment codes etc.) — show as plain text
        if (isNum) return <Text style={{ fontSize: 11 }}>{String(v)}</Text>;
        const strV = String(v).trim();
        if (vr && badSet.has(strV)) return (
          <Tooltip title={`"${strV}" not found in ${vr.coaLabel}`}>
            <Tag color="red" style={{ fontSize: 10, cursor: 'default' }}>{strV}</Tag>
          </Tooltip>
        );
        if (vr && vr.invalidValues.length === 0 && !vr.error)
          return <Text style={{ fontSize: 11, color: REDWOOD.success }}>{strV}</Text>;
        return <Text style={{ fontSize: 11 }}>{strV}</Text>;
      },
    };
  });

  const summaryRow = amountCols.size > 0 ? () => (
    <Table.Summary fixed>
      <Table.Summary.Row style={{ background: '#1e293b' }}>
        {columns.map((col, i) => (
          <Table.Summary.Cell index={i} key={col} align={amountCols.has(col) ? 'right' : 'left'}>
            {i === 0
              ? <Text strong style={{ fontSize: 11, color: '#f1f5f9' }}>Total</Text>
              : amountCols.has(col)
                ? <Text strong style={{ fontSize: 11, fontFamily: 'monospace', color: '#f1f5f9' }}>{fmt(totals[col] ?? 0)}</Text>
                : null}
          </Table.Summary.Cell>
        ))}
      </Table.Summary.Row>
    </Table.Summary>
  ) : undefined;

  const downloadXlsx = (data: TBRow[], sheetName: string, dlFileName: string) => {
    const clean = data.map(r => { const c = { ...r }; delete (c as any).__rowIdx; return c; });
    const ws = XLSX.utils.json_to_sheet(clean);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = dlFileName; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => downloadXlsx(filteredRows, 'Trial Balance', `TB_Filtered_${fileName || 'export'}`);

  const handleExportInvalid = () => {
    const resultsWithInvalid = validationResults.filter(vr => vr.invalidValues.length > 0);
    if (resultsWithInvalid.length === 0) { message.info('No invalid segment values to export.'); return; }
    const wb = XLSX.utils.book_new();
    resultsWithInvalid.forEach(vr => {
      const sheetData = vr.invalidValues.map(iv => ({
        'Invalid Value': iv.value,
        'Occurrences in File': iv.count,
        'Excel Column': vr.excelColumn,
        'COA Segment': vr.coaLabel,
      }));
      const ws = XLSX.utils.json_to_sheet(sheetData);
      // Sheet name max 31 chars, no special chars
      const sheetName = `${vr.excelColumn}-${vr.coaLabel}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `TB_InvalidValues_${fileName || 'export'}`; a.click();
    URL.revokeObjectURL(url);
  };

  const totalInvalid = validationResults.reduce((s, r) => s + r.invalidValues.length, 0);
  const totalValid   = validationResults.reduce((s, r) => s + r.validCount, 0);

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 24px' }}>
        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <Link to="/"><HomeOutlined /></Link> },
          { title: <Link to="/procurement">Fusion Supply Chain</Link> },
          { title: 'Trial Balance Loading' },
        ]} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>
            <TableOutlined style={{ color: REDWOOD.info, marginRight: 8 }} />Trial Balance Loading
          </Title>
          {rows.length > 0 && (
            <Space wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <FileExcelOutlined style={{ color: REDWOOD.success, marginRight: 4 }} />{fileName}
              </Text>
              <Button size="small" icon={<SafetyCertificateOutlined />}
                style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
                onClick={() => setValidateModal(true)}>
                Validate Segments
              </Button>
              <Button size="small" icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>Load Another</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>Export Filtered</Button>
              {validated && invalidRowIdxSet.size > 0 && (
                <Button size="small" icon={<DownloadOutlined />} danger onClick={handleExportInvalid}>
                  Export Invalid ({invalidRowIdxSet.size})
                </Button>
              )}
              <Button size="small" icon={<ClearOutlined />} danger
                onClick={() => { setRows([]); setColumns([]); setFileName(''); setFilters({}); setGlobalSearch(''); setValidationResults([]); setValidated(false); }}>
                Clear
              </Button>
            </Space>
          )}
        </div>

        {error && <Alert type="error" message={error} showIcon closable onClose={() => setError('')} style={{ marginBottom: 12 }} />}

        {validated && (
          <Alert style={{ marginBottom: 12 }} type={totalInvalid === 0 ? 'success' : 'warning'} showIcon
            message={
              <Space>
                <Text strong style={{ fontSize: 12 }}>Segment Validation: {validationResults.length} segment(s) checked</Text>
                <Tag color="green">{totalValid} valid unique values</Tag>
                {totalInvalid > 0 && <Tag color="red">{totalInvalid} invalid unique values — cells highlighted below</Tag>}
              </Space>
            }
          />
        )}

        {rows.length === 0 && (
          <Card style={{ borderRadius: 12, borderStyle: 'dashed', borderWidth: 2, borderColor: REDWOOD.neutral300, cursor: 'pointer' }}
            bodyStyle={{ padding: 48, textAlign: 'center' }}
            onClick={() => fileInputRef.current?.click()} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
            <FileExcelOutlined style={{ fontSize: 48, color: REDWOOD.success, display: 'block', marginBottom: 16 }} />
            <Title level={5} style={{ color: REDWOOD.neutral600 }}>Click or drag &amp; drop an Excel file to load Trial Balance</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>Supports .xlsx and .xls — first sheet will be loaded</Text>
          </Card>
        )}

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onInputChange} />
        <input ref={mappingFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={loadMappingsFromFile} />

        {rows.length > 0 && (
          <>
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col><Card size="small" style={{ borderRadius: 8, minWidth: 120 }}>
                <Statistic title="Total Rows" value={rows.length} valueStyle={{ fontSize: 18, color: REDWOOD.info }} />
              </Card></Col>
              <Col><Card size="small" style={{ borderRadius: 8, minWidth: 120 }}>
                <Statistic title="Filtered" value={filteredRows.length} valueStyle={{ fontSize: 18, color: REDWOOD.success }} />
              </Card></Col>
              <Col><Card size="small" style={{ borderRadius: 8, minWidth: 120 }}>
                <Statistic title="Columns" value={columns.length} valueStyle={{ fontSize: 18, color: REDWOOD.neutral600 }} />
              </Card></Col>
              {validated && (
                <Col><Card size="small" style={{ borderRadius: 8, minWidth: 140 }}>
                  <Statistic title="Invalid Rows" value={invalidRowIdxSet.size}
                    valueStyle={{ fontSize: 18, color: invalidRowIdxSet.size === 0 ? REDWOOD.success : REDWOOD.primary }} />
                </Card></Col>
              )}
              {[...amountCols].slice(0, 3).map(col => (
                <Col key={col}><Card size="small" style={{ borderRadius: 8, minWidth: 140 }}>
                  <Statistic title={col} value={fmt(totals[col] ?? 0)}
                    valueStyle={{ fontSize: 14, fontFamily: 'monospace', color: (totals[col] ?? 0) < 0 ? REDWOOD.primary : REDWOOD.success }} />
                </Card></Col>
              ))}
            </Row>

            {validated && validationResults.length > 0 && (
              <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }}
                title={<Space><SafetyCertificateOutlined style={{ color: REDWOOD.info }} /><Text strong style={{ fontSize: 12 }}>Validation Results by Segment</Text></Space>}
                extra={invalidRowIdxSet.size > 0 && (
                  <Button size="small" danger icon={<DownloadOutlined />} onClick={handleExportInvalid}>
                    Download Invalid Rows ({invalidRowIdxSet.size})
                  </Button>
                )}>
                <Row gutter={[8, 8]}>
                  {validationResults.map(vr => (
                    <Col key={vr.coaSegmentKey} xs={24} sm={12} md={8} lg={6}>
                      <Card size="small" style={{ borderRadius: 6, border: `1px solid ${vr.error ? REDWOOD.warning : vr.invalidValues.length > 0 ? REDWOOD.primary : REDWOOD.success}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <Text strong style={{ fontSize: 11 }}>{vr.excelColumn}</Text>
                          <Space size={4}>
                            <Tag style={{ fontSize: 10, margin: 0 }}>{vr.coaLabel}</Tag>
                            <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{vr.apiUrl}</span>} placement="topRight">
                              <LinkOutlined style={{ fontSize: 11, color: REDWOOD.info, cursor: 'pointer' }} />
                            </Tooltip>
                          </Space>
                        </div>
                        {vr.error
                          ? <Alert type="warning" message={vr.error} style={{ fontSize: 10, padding: '2px 6px' }} />
                          : <>
                            <Progress percent={vr.totalValues === 0 ? 100 : Math.round((vr.validCount / vr.totalValues) * 100)}
                              size="small" status={vr.invalidValues.length > 0 ? 'exception' : 'success'} style={{ marginBottom: 4 }} />
                            <Space size={4}>
                              <Tag color="green" style={{ fontSize: 10, margin: 0 }}>{vr.validCount} valid</Tag>
                              {vr.invalidValues.length > 0 && (
                                <Tooltip placement="bottomLeft" title={
                                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                    {vr.invalidValues.map(iv => (
                                      <div key={iv.value} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                                        <Tag color="red" style={{ fontSize: 10 }}>{iv.value}</Tag> × {iv.count} rows
                                      </div>
                                    ))}
                                  </div>
                                }>
                                  <Tag color="red" style={{ fontSize: 10, margin: 0, cursor: 'pointer' }}>
                                    {vr.invalidValues.length} invalid <InfoCircleOutlined />
                                  </Tag>
                                </Tooltip>
                              )}
                            </Space>
                          </>
                        }
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card>
            )}

            <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }}
              title={<Space><FilterOutlined style={{ color: REDWOOD.info }} /><Text strong style={{ fontSize: 12 }}>Filters</Text></Space>}
              extra={<Button size="small" icon={<ClearOutlined />} onClick={() => { setFilters({}); setGlobalSearch(''); }}>Clear All</Button>}>
              <Row gutter={[8, 8]} align="middle">
                <Col xs={24} sm={8} md={6}>
                  <Input placeholder="Global search…" prefix={<FilterOutlined style={{ color: REDWOOD.neutral600 }} />}
                    size="small" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} allowClear style={{ fontSize: 12 }} />
                </Col>
                {categoricalCols.map(col => {
                  const options = Array.from(new Set(rows.map(r => String(r[col] ?? '')))).sort();
                  return (
                    <Col key={col} xs={12} sm={8} md={4}>
                      <Select placeholder={col} size="small" allowClear showSearch style={{ width: '100%', fontSize: 12 }}
                        value={filters[col] || undefined} onChange={v => setFilters(f => ({ ...f, [col]: v ?? '' }))}
                        options={options.map(o => ({ value: o, label: o || '(blank)' }))} />
                    </Col>
                  );
                })}
                {numericCols.map(col => (
                  <Col key={col} xs={12} sm={8} md={4}>
                    <Input placeholder={col} size="small" allowClear style={{ fontSize: 12 }}
                      value={filters[col] || ''} onChange={e => setFilters(f => ({ ...f, [col]: e.target.value }))} />
                  </Col>
                ))}
              </Row>
            </Card>

            <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
              <div style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                  Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong> rows
                  {validated && invalidRowIdxSet.size > 0 && (
                    <Tag color="red" style={{ marginLeft: 8, fontSize: 10 }}>{invalidRowIdxSet.size} rows with invalid segment values</Tag>
                  )}
                </Text>
                {(Object.values(filters).some(Boolean) || globalSearch) && <Tag color="blue" style={{ fontSize: 10 }}>Filters active</Tag>}
              </div>
              <Table className="compact-table" size="small"
                dataSource={filteredRows}
                rowKey={r => String((r as any).__rowIdx)}
                columns={tableColumns as any}
                rowClassName={r => invalidRowIdxSet.has((r as any).__rowIdx) ? 'tb-invalid-row' : ''}
                pagination={{ pageSize: 100, showSizeChanger: true, pageSizeOptions: ['50', '100', '200', '500'], showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}` }}
                scroll={{ x: columns.length * 150, y: 'calc(100vh - 500px)' }}
                loading={loading}
                summary={summaryRow}
                locale={{ emptyText: <Empty description="No rows match the current filters" /> }}
              />
            </Card>
          </>
        )}

        {/* ── Validate Segments Modal ── */}
        <Modal open={validateModal}
          title={<Space><SafetyCertificateOutlined style={{ color: REDWOOD.info }} /><span>Validate Segments</span></Space>}
          width={680} onCancel={() => setValidateModal(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Space>
                <Button icon={<SaveOutlined />} size="small" onClick={saveMappings}>
                  Save Mappings (CSV)
                </Button>
                <Button icon={<FolderOpenOutlined />} size="small" onClick={() => mappingFileRef.current?.click()}>
                  Load Mappings
                </Button>
              </Space>
              <Space>
                <Button onClick={() => setValidateModal(false)}>Close</Button>
                <Button type="primary" icon={validating ? <SyncOutlined spin /> : <CheckCircleOutlined />}
                  loading={validating}
                  disabled={mappings.filter(m => m.excelColumn && m.coaSegmentKey).length === 0}
                  onClick={async () => {
                    setValidateModal(false);
                    await runValidation();
                  }}
                  style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}>
                  {validating ? 'Validating…' : 'Run Validation'}
                </Button>
              </Space>
            </div>
          }
        >
          {validError && <Alert type="error" message={validError} showIcon style={{ marginBottom: 12 }} />}

          <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }}
            message={
              <span>
                Map Excel columns → COA segments, then click <strong>Run Validation</strong>.
                Save/load mappings as CSV — save suggested to <code>C:\fusion\{MAPPING_FILE}</code>
              </span>
            }
          />

          {mappings.length === 0 && (
            <Empty description="No mappings yet. Add manually or load from a saved CSV." style={{ marginBottom: 12 }} />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
            {mappings.map(m => (
              <Row key={m.id} gutter={8} align="middle">
                <Col flex="1">
                  <Select placeholder="Excel column" size="small" style={{ width: '100%' }}
                    showSearch value={m.excelColumn || undefined}
                    onChange={v => updateMapping(m.id, { excelColumn: v })}
                    options={columns.map(c => ({ value: c, label: c }))} />
                </Col>
                <Col style={{ color: REDWOOD.neutral600, fontSize: 13, padding: '0 4px' }}>→</Col>
                <Col flex="1">
                  <Select placeholder="COA Segment" size="small" style={{ width: '100%' }}
                    showSearch value={m.coaSegmentKey || undefined}
                    onChange={v => updateMapping(m.id, { coaSegmentKey: v })}
                    options={COA_SEGMENTS.map(s => ({ value: s.key, label: `${s.label} (${s.valueSet})` }))} />
                </Col>
                <Col>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeMapping(m.id)} />
                </Col>
              </Row>
            ))}
          </div>

          <Divider style={{ margin: '12px 0' }} />
          <Button size="small" icon={<PlusOutlined />} onClick={addMapping}>Add Mapping</Button>
          {mappings.filter(m => m.excelColumn && m.coaSegmentKey).length > 0 && (
            <Tag color="blue" style={{ marginLeft: 8, fontSize: 10 }}>
              {mappings.filter(m => m.excelColumn && m.coaSegmentKey).length} mapping(s) ready
            </Tag>
          )}
        </Modal>

        <style>{`
          .tb-invalid-row td { background: #fff2f0 !important; }
          .tb-invalid-row:hover td { background: #ffe7e0 !important; }
        `}</style>
      </Content>
    </Layout>
  );

  function updateMapping(id: string, patch: Partial<SegmentMapping>) {
    setMappings(m => m.map(x => x.id === id ? { ...x, ...patch } : x));
  }
  function addMapping() {
    setMappings(m => [...m, { id: `map-${Date.now()}`, excelColumn: '', coaSegmentKey: '' }]);
  }
  function removeMapping(id: string) {
    setMappings(m => m.filter(x => x.id !== id));
  }
};

export default TrialBalanceLoading;
