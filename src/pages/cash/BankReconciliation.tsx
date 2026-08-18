import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useCallback, useEffect } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Layout, Breadcrumb, Typography, Card, Table, Button, Form, Input, Select,
  DatePicker, InputNumber, Row, Col, Space, Tag, Tooltip, Tabs, Collapse,
  message, Empty, Divider, Badge, Segmented, Modal, Checkbox, Steps, Popover,
  Descriptions, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TableRowSelection } from 'antd/es/table/interface';
import {
  HomeOutlined, BankOutlined, SearchOutlined, ReloadOutlined,
  CheckOutlined, CloseOutlined, ReconciliationOutlined, FileTextOutlined,
  ApiOutlined, CopyOutlined, PlusOutlined, ThunderboltOutlined, DownloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, InfoCircleOutlined, LinkOutlined,
  UndoOutlined, ReadOutlined, RobotOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AccountSelector, { validateAccountCode } from '../../components/AccountSelector';
import { ReconciliationViewer } from '../../components/ReconciliationViewer';
import { reconcileWithClaude, type ReconciliationResult } from '../../services/claudeReconciliation.service';
import ReconAgent from './ReconAgent';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { buildPcBankTxnSlaPayload, fetchLedgerByBusinessUnit, derivePeriodName, createAccounting } from '../../services/sla.service';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

// ── Theme ──────────────────────────────────────────────────────────────────────
const REDWOOD = {
  primary:      '#C74634',
  primaryLight: '#E85D4A',
  success:      '#1D7B4D',
  warning:      '#D4A800',
  info:         '#0572CE',
  error:        '#D93025',
  neutral100:   '#F7F7F7',
  neutral200:   '#E5E5E5',
  neutral300:   '#C7C7C7',
  neutral600:   '#6B6B6B',
  neutral900:   '#1A1A1A',
  surface:      '#FFFFFF',
};

const APEX_BASE =
  buildApexUrl('');

// Format signed amount (no Math.abs) - shows actual sign for DR (-) and CR (+)
const formatSignedAmount = (amount: number, decimals = 2): string => {
  return amount.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface StmtLine {
  lineId: number;
  statementId: number;
  statementNumber: string;
  transactionDate: string;
  valueDate?: string;
  amount: number;
  transactionCode: string; // CR | DR
  description?: string;
  reference?: string;
  bankTxnReference?: string;
  counterpartyName?: string;
  reconStatus: string;
  reconAmount?: number;
  reconTxnType?: string;
  reconTxnNumber?: string;
  reconNotes?: string;
  reconDate?: string;
  bankAccountName: string;
  currencyCode?: string;
  externalTxnId?: number;
  externalTxnRef?: string;
}

interface SysTxn {
  txnId: number;
  txnNumber: string;
  reference?: string;
  txnDate: string;
  amount: number;
  currencyCode?: string;
  businessUnit?: string;
  bankAccountName?: string;
  reconciledFlag?: string;
  txnStatus?: string;
  source: 'AP_PAYMENT' | 'AR_RECEIPT' | 'GL_JOURNAL' | 'GL_BANK_TRANSFER' | string;
  // AP Payment
  payee?: string;
  supplierNumber?: string;
  paymentMethod?: string;
  paymentType?: string;
  clearingDate?: string;
  // AR Receipt
  customerName?: string;
  customerNumber?: string;
  receiptMethod?: string;
  // GL Journal / GL Bank Transfer
  accountCode?: string;
  accountDescription?: string;
  journalCategory?: string;
  lineDescription?: string;
  jeHeaderId?: number;
  jeLineNumber?: number;
  glBatchId?: number;
  // External Transaction (CM)
  assetAccountCombination?: string;
  offsetAccountCombination?: string;
  createdBy?: string;
  creationDate?: string;
}

interface BankAcctOption {
  label: string;
  value: string;
  bankAccountNumber?: string;
  currencyCode?: string;
  legalEntityName?: string;
  cashAccount?: string;
}

interface BUOption {
  label: string;
  value: string;
  legalEntityName?: string;
}

interface BankStatement {
  statementId: number;
  statementNumber: string;
  statementDate: string;
  bankAccountName: string;
  businessUnitName?: string;
  openingBalance?: number;
  closingBalance?: number;
  status?: string;
  lineCount?: number;
  totalLines?: number;
  reconLines?: number;
  unreconLines?: number;
  currencyCode?: string;
}

interface SearchParams {
  bankAccount?: string;
  businessUnit?: string;
  dateFrom?: Dayjs | null;
  dateTo?: Dayjs | null;
  amountMin?: number;
  amountMax?: number;
  statementId?: string;
  reference?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const parseApexJson = async (res: Response): Promise<{ status: string; items?: unknown[]; message?: string; httpStatus?: number }> => {
  const text = await res.text();
  if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
    return {
      status:     res.ok ? 'success' : 'error',
      message:    `HTTP ${res.status} ${res.statusText} — server returned non-JSON response. Check that the ORDS handler exists.\n\n${text.slice(0, 300)}`,
      httpStatus: res.status,
    };
  }
  try {
    const fixed = text
      .replace(/:(-?)\.(\d)/g, ':$10.$2')
      .replace(/(\d)\.([,}\]])/g, '$1$2');
    return JSON.parse(fixed);
  } catch {
    return {
      status:     'error',
      message:    `JSON parse error. Response was:\n${text.slice(0, 300)}`,
      httpStatus: res.status,
    };
  }
};

const fmtAmount = (v?: number | null, ccy?: string): string => {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
  return ccy ? `${s} ${ccy}` : s;
};

const fmtDate = (d?: string): string => {
  if (!d) return '—';
  try {
    return dayjs(d).format('D-MMM-YYYY');
  } catch {
    return d;
  }
};

const stripCurrencySuffix = (name: string): string =>
  name.replace(/\s*\([A-Z]{3}\)\s*$/i, '').trim();

const sysTxnRowKey = (r: SysTxn): string =>
  `${r.source}-${r.txnId}-${r.jeHeaderId ?? ''}-${r.jeLineNumber ?? ''}`;

const sumSelected = (items: StmtLine[] | SysTxn[], keys: React.Key[]): number => {
  const keySet = new Set(keys.map(String));
  return (items as Array<{ amount: number } & (StmtLine | SysTxn)>)
    .filter((r) => {
      const k = 'lineId' in r ? String(r.lineId) : sysTxnRowKey(r as SysTxn);
      return keySet.has(k);
    })
    .reduce((acc, r) => acc + (r.amount ?? 0), 0);
};

// ── Search Panel ──────────────────────────────────────────────────────────────
interface SearchPanelProps {
  bankAccounts: BankAcctOption[];
  businessUnits: BUOption[];
  loadingAccounts: boolean;
  hasData: boolean;
  onSearch: (params: SearchParams) => void;
  onReset: () => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({
  bankAccounts,
  businessUnits,
  loadingAccounts,
  hasData,
  onSearch,
  onReset,
}) => {
  const [form] = Form.useForm<SearchParams>();
  const [selectedBu, setSelectedBu] = useState<string | undefined>();

  const filteredAccounts = selectedBu
    ? (() => {
        const le = businessUnits.find(b => b.value === selectedBu)?.legalEntityName ?? '';
        return le ? bankAccounts.filter(a => a.legalEntityName === le) : bankAccounts;
      })()
    : bankAccounts;

  const handleSearch = () => {
    const vals = form.getFieldsValue();
    onSearch(vals);
  };

  const handleReset = () => {
    form.resetFields();
    onReset();
  };

  return (
    <Collapse
      defaultActiveKey={['search']}
      style={{ marginBottom: 16 }}
      items={[
        {
          key: 'search',
          label: (
            <Space>
              <SearchOutlined />
              <span>Search Filters</span>
            </Space>
          ),
          children: (
            <Form form={form} layout="vertical" size="small">
              <Row gutter={[8, 0]} align="bottom" wrap={false}>
                <Col flex="300px">
                  <Form.Item name="businessUnit" label="Business Unit" style={{ marginBottom: 0 }}>
                    <Select
                      showSearch allowClear
                      placeholder="Select BU"
                      options={businessUnits}
                      filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      onChange={(v: string | undefined) => {
                        const apply = () => {
                          setSelectedBu(v ?? undefined);
                          form.setFieldValue('bankAccount', undefined);
                          onReset();
                          const vals = form.getFieldsValue();
                          onSearch({ ...vals, businessUnit: v ?? undefined, bankAccount: undefined });
                        };
                        if (hasData) {
                          Modal.confirm({
                            title: 'Change Business Unit?',
                            content: 'Data is already loaded. Changing the business unit will clear the current results. Do you want to continue?',
                            okText: 'Yes, change it',
                            cancelText: 'Cancel',
                            onOk: apply,
                            onCancel: () => {
                              // revert the select back to current value
                              form.setFieldValue('businessUnit', selectedBu);
                            },
                          });
                        } else {
                          apply();
                        }
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col flex="380px">
                  <Form.Item
                    name="bankAccount"
                    label={<Text style={{ fontWeight: 600 }}>Bank Account</Text>}
                    rules={[]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      showSearch
                      allowClear
                      loading={loadingAccounts}
                      placeholder={selectedBu ? 'Select bank account' : 'Select account'}
                      filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      options={filteredAccounts}
                    />
                  </Form.Item>
                </Col>
                <Col flex="140px">
                  <Form.Item name="dateFrom" label="Date From" style={{ marginBottom: 0 }}>
                    <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                  </Form.Item>
                </Col>
                <Col flex="140px">
                  <Form.Item name="dateTo" label="Date To" style={{ marginBottom: 0 }}>
                    <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
                  </Form.Item>
                </Col>
                <Col flex="none">
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Space>
                      <Button
                        type="primary"
                        icon={<SearchOutlined />}
                        onClick={handleSearch}
                        style={{ backgroundColor: REDWOOD.primary, borderColor: REDWOOD.primary }}
                      >
                        Search
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          ),
        },
      ]}
    />
  );
};

// ── Statement Selector ────────────────────────────────────────────────────────
interface StatementSelectorProps {
  statements: BankStatement[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (stmt: BankStatement) => void;
  bankAccounts: BankAcctOption[];
}

const StatementSelector: React.FC<StatementSelectorProps> = ({
  statements, loading, selectedId, onSelect, bankAccounts,
}) => {
  const [jlOpen,    setJlOpen]    = useState(false);
  const [jlLoading, setJlLoading] = useState(false);
  const [jlStmt,    setJlStmt]    = useState<BankStatement | null>(null);
  const [jlLines,   setJlLines]   = useState<any[]>([]);
  const [jlFrom,    setJlFrom]    = useState<Dayjs | null>(null);
  const [jlTo,      setJlTo]      = useState<Dayjs | null>(null);
  const [jlAcct,    setJlAcct]    = useState('');
  const [jlLastUrl, setJlLastUrl] = useState('');
  const [jlFilter,  setJlFilter]  = useState('');
  const [jlAcctDesc, setJlAcctDesc] = useState('');

  const fetchJournalLines = async (dateFrom: string, dateTo: string, cashAcct: string) => {
    setJlLoading(true);
    try {
      const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, limit: '2000' });
      if (cashAcct) qs.set('account', cashAcct);
      const url = `${APEX_BASE}/gl/journals/lines?${qs}`;
      setJlLastUrl(url);
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({ items: [] }));
      setJlLines(data.items ?? []);
    } catch {
      message.error('Failed to load journal lines');
    } finally {
      setJlLoading(false);
    }
  };

  const openJournalLines = (e: React.MouseEvent, r: BankStatement) => {
    e.stopPropagation();
    const matched = bankAccounts.find(b => {
      const cleanName = r.bankAccountName?.split('(')[0]?.trim().toLowerCase() ?? '';
      const bl = b.label.replace(/\s*\(.*?\)\s*$/, '').toLowerCase();
      return bl === cleanName || bl.includes(cleanName) || cleanName.includes(bl);
    });
    const cashAcct = matched?.cashAccount ?? '';
    const d        = dayjs(r.statementDate);
    const from     = d.startOf('month');
    const to       = d.endOf('month');
    setJlStmt(r);
    setJlLines([]);
    setJlFrom(from);
    setJlTo(to);
    setJlAcct(cashAcct);
    setJlFilter('');
    setJlAcctDesc('');
    setJlOpen(true);
    fetchJournalLines(from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD'), cashAcct);
    // Fetch account segment description: segment 4 (index 3) = account code
    if (cashAcct) {
      const seg4 = cashAcct.split('-')[3]?.trim();
      if (seg4) {
        fetch(`${APEX_BASE}/valuesets/getvalues/BUIMERC_FIN_GLB_COA_ACCOUNT`, { headers: { Accept: 'application/json' } })
          .then(r => r.json())
          .then(d => {
            const match = (d.items ?? []).find((i: any) => i.value === seg4);
            if (match?.description) setJlAcctDesc(match.description);
          })
          .catch(() => {});
      }
    }
  };

  const handleJlSearch = () => {
    if (!jlFrom || !jlTo) { message.warning('Please select both dates'); return; }
    fetchJournalLines(jlFrom.format('YYYY-MM-DD'), jlTo.format('YYYY-MM-DD'), jlAcct);
  };

  const columns: ColumnsType<BankStatement> = [
    {
      title: 'Statement #',
      dataIndex: 'statementNumber',
      key: 'statementNumber',
      width: 160,
      ellipsis: true,
    },
    {
      title: 'Business Unit',
      dataIndex: 'businessUnitName',
      key: 'businessUnitName',
      width: 220,
      render: (v: string) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text>,
    },
    {
      title: 'Bank Account',
      dataIndex: 'bankAccountName',
      key: 'bankAccountName',
      width: 300,
      render: (v: string) => {
        const cleanName = stripCurrencySuffix(v || '').toLowerCase();
        const matched = bankAccounts.find(b => {
          const bl = stripCurrencySuffix(b.label).toLowerCase();
          return bl === cleanName || bl.includes(cleanName) || cleanName.includes(bl);
        });
        const popContent = (
          <div style={{ minWidth: 260 }}>
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Bank Account</Text><br />
              <Text style={{ fontSize: 12 }}>{v || '—'}</Text>
            </div>
            {matched?.bankAccountNumber && (
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Account Number</Text><br />
                <Text style={{ fontSize: 12 }}>{matched.bankAccountNumber}</Text>
              </div>
            )}
            {matched?.currencyCode && (
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Currency</Text><br />
                <Text style={{ fontSize: 12 }}>{matched.currencyCode}</Text>
              </div>
            )}
            {matched?.legalEntityName && (
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Legal Entity</Text><br />
                <Text style={{ fontSize: 12 }}>{matched.legalEntityName}</Text>
              </div>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>Cash Account</Text><br />
              <Text style={{ fontSize: 12, fontFamily: 'monospace', color: matched?.cashAccount ? '#1677ff' : undefined }}>
                {matched?.cashAccount || '—'}
              </Text>
            </div>
          </div>
        );
        return (
          <Space size={4}>
            <Text style={{ fontSize: 11 }}>{v || '—'}</Text>
            <Popover content={popContent} title="Bank Account Details" trigger="click" placement="right">
              <InfoCircleOutlined style={{ fontSize: 12, color: REDWOOD.info, cursor: 'pointer' }} />
            </Popover>
          </Space>
        );
      },
    },
    {
      title: 'Date',
      dataIndex: 'statementDate',
      key: 'statementDate',
      width: 100,
      render: (v: string) => fmtDate(v),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (v: string) => {
        const color = v === 'RECONCILED' ? 'green' : v === 'PARTIALLY_RECONCILED' ? 'orange' : 'blue';
        return v ? <Tag color={color} style={{ margin: 0 }}>{v.replace(/_/g, ' ')}</Tag> : '—';
      },
    },
    {
      title: 'Opening Bal',
      dataIndex: 'openingBalance',
      key: 'openingBalance',
      width: 110,
      align: 'right',
      render: (v: number) => fmtAmount(v),
    },
    {
      title: 'Closing Bal',
      dataIndex: 'closingBalance',
      key: 'closingBalance',
      width: 110,
      align: 'right',
      render: (v: number) => fmtAmount(v),
    },
    {
      title: 'Lines',
      key: 'lineCount',
      width: 120,
      align: 'center' as const,
      render: (_: unknown, r: BankStatement) => {
        const total   = r.totalLines   ?? r.lineCount ?? 0;
        const recon   = r.reconLines   ?? 0;
        const unrecon = r.unreconLines ?? total;
        if (!total) return <Text style={{ color: '#bbb', fontSize: 11 }}>—</Text>;
        return (
          <Space size={3}>
            <Tag color="default"  style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{total}</Tag>
            <Tag color="success"  style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{recon}</Tag>
            <Tag color="warning"  style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{unrecon}</Tag>
          </Space>
        );
      },
    },
    {
      title: '',
      key: 'jlAction',
      width: 40,
      align: 'center' as const,
      render: (_: unknown, r: BankStatement) => (
        <Tooltip title="View Journal Entries">
          <Button type="text" size="small" icon={<ReadOutlined style={{ color: REDWOOD.info }} />}
            onClick={e => openJournalLines(e, r)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <>
    <Modal
      open={jlOpen}
      onCancel={() => setJlOpen(false)}
      maskClosable={false}
      footer={
        <div style={{ textAlign: 'right' }}>
          <Button onClick={() => setJlOpen(false)}>Close</Button>
        </div>
      }
      width={1200}
      title={
        <Space size={8} wrap>
          <ReadOutlined style={{ color: REDWOOD.info }} />
          <span style={{ fontWeight: 600 }}>Journal Entries</span>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>{jlStmt?.bankAccountName ?? ''}</Text>
          {jlAcct && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Tag color="geekblue" style={{ fontSize: 11, margin: 0 }}>{jlAcct}</Tag>
              {jlAcctDesc && <Text style={{ fontSize: 10, color: REDWOOD.neutral600, paddingLeft: 2 }}>{jlAcctDesc}</Text>}
            </div>
          )}
        </Space>
      }
      styles={{ body: { padding: '0' } }}
    >
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid #f0f0f0`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 12 }}>Date From:</Text>
        <DatePicker value={jlFrom} onChange={v => setJlFrom(v)} format="DD-MMM-YYYY" size="small" style={{ width: 130 }} allowClear={false} />
        <Text style={{ fontSize: 12 }}>To:</Text>
        <DatePicker value={jlTo} onChange={v => setJlTo(v)} format="DD-MMM-YYYY" size="small" style={{ width: 130 }} allowClear={false} />
        <Button type="primary" size="small" icon={<SearchOutlined />} loading={jlLoading} onClick={handleJlSearch}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>Search</Button>
        {jlLastUrl && (
          <Tooltip title="Show API URL">
            <Button size="small" icon={<ApiOutlined />} onClick={() =>
              Modal.info({ title: 'API Request URL', width: 800, content: (
                <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{jlLastUrl}</Text>
              )}) } />
          </Tooltip>
        )}
        <div style={{ flex: 1 }} />
        <Input.Search
          placeholder="Filter any column…"
          size="small"
          allowClear
          style={{ width: 200 }}
          value={jlFilter}
          onChange={e => setJlFilter(e.target.value)}
        />
        {jlLines.length > 0 && (
          <Tooltip title="Export to Excel">
            <Button size="small" icon={<DownloadOutlined />} onClick={() => {
              const rows = jlLines.map(l => ({
                Date:        l.accounting_date ? String(l.accounting_date).slice(0, 10) : '',
                Period:      l.period_name ?? '',
                'Batch ID':  l.je_batch_id ?? '',
                'Header ID': l.je_header_id ?? '',
                Journal:     l.journal_name ?? '',
                Account:     l.account ?? '',
                Description: l.description ?? '',
                'Ent. Dr':   l.entered_dr ?? '',
                'Ent. Cr':   l.entered_cr ?? '',
                CCY:         l.currency_code ?? '',
                Category:    l.je_category ?? '',
                Source:      l.je_source ?? '',
                Ref1:        l.reference1 ?? '',
                Ref2:        l.reference2 ?? '',
                Ref3:        l.reference3 ?? '',
                Ref4:        l.reference4 ?? '',
                Ref5:        l.reference5 ?? '',
                Status:      l.posting_status || l.journal_status || '',
              }));
              const wb  = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Journal Lines');
              const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
              saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                `JournalLines_${jlAcct}_${jlFrom?.format('YYYYMMDD') ?? ''}_${jlTo?.format('YYYYMMDD') ?? ''}.xlsx`);
            }} />
          </Tooltip>
        )}
      </div>

      {jlLoading ? (
        <div style={{ textAlign: 'center', padding: 40, color: REDWOOD.neutral600 }}>Loading journal lines…</div>
      ) : jlLines.length === 0 ? (
        <Empty description="No journal lines found for this cash account and period" style={{ padding: 40 }} />
      ) : (() => {
        const q = jlFilter.toLowerCase();
        const filtered = q
          ? jlLines.filter(l =>
              Object.values(l).some(v => v != null && String(v).toLowerCase().includes(q))
            )
          : jlLines;
        const totalDr = filtered.reduce((s, l) => s + (Number(l.entered_dr) || 0), 0);
        const totalCr = filtered.reduce((s, l) => s + (Number(l.entered_cr) || 0), 0);
        return (
          <>
            <div style={{ padding: '6px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                {filtered.length}{q ? ` of ${jlLines.length}` : ''} lines
              </Text>
              <Space size={16}>
                <Text style={{ fontSize: 12 }}>Dr: <Text strong style={{ color: REDWOOD.success }}>{totalDr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Text>
                <Text style={{ fontSize: 12 }}>Cr: <Text strong style={{ color: REDWOOD.error }}>{totalCr.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Text>
              </Space>
            </div>
            <Table
              dataSource={filtered.map((l, i) => ({ ...l, _key: i }))}
              rowKey="_key"
              size="small"
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                pageSizeOptions: ['25', '50', '100', '200'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} lines`,
                total: filtered.length
              }}
              scroll={{ x: 1100, y: 420 }}
              summary={() => (
                <Table.Summary fixed="bottom">
                  <Table.Summary.Row style={{ fontWeight: 600, background: REDWOOD.neutral100 }}>
                    <Table.Summary.Cell index={0} colSpan={6}>
                      <Text strong>TOTAL</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} />
                    <Table.Summary.Cell index={7} />
                    <Table.Summary.Cell index={8} align="right">
                      <Text strong style={{ color: REDWOOD.success }}>
                        {totalDr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9} align="right">
                      <Text strong style={{ color: REDWOOD.error }}>
                        {totalCr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
              columns={[
                { title: 'Status', key: 'status', width: 80,
                  render: (_: any, r: any) => {
                    const raw = r.posting_status || r.journal_status || '';
                    const val = raw.toString().toUpperCase();
                    const isPosted = val === 'P' || val === 'POSTED';
                    return <Tag color={isPosted ? 'green' : val ? 'orange' : 'default'} style={{ fontSize: 10 }}>
                      {isPosted ? 'POSTED' : (raw || '—')}
                    </Tag>;
                  } },
                { title: 'Date', dataIndex: 'accounting_date', width: 100, defaultSortOrder: 'ascend' as const,
                  sorter: (a: any, b: any) => (a.accounting_date ?? '').localeCompare(b.accounting_date ?? ''),
                  render: (v: any) => <Text style={{ fontSize: 11 }}>{v ? String(v).slice(0, 10) : '—'}</Text> },
                { title: 'Period', dataIndex: 'period_name', width: 85,
                  render: (v: any) => <Text style={{ fontSize: 11 }}>{v || '—'}</Text> },
                { title: 'Batch ID', dataIndex: 'je_batch_id', width: 90,
                  render: (v: any) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v ?? '—'}</Text> },
                { title: 'Header ID', dataIndex: 'je_header_id', width: 90,
                  render: (v: any) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v ?? '—'}</Text> },
                { title: 'Journal', dataIndex: 'journal_name', width: 160, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 11 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Account', dataIndex: 'account', width: 210, ellipsis: true,
                  render: (v: any) => <Text code style={{ fontSize: 10 }}>{v || '—'}</Text> },
                { title: 'Description', dataIndex: 'description', width: 220,
                  render: (v: any) => (
                    <Tooltip title={v} placement="topLeft">
                      <div style={{ fontSize: 11, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.4em', maxHeight: '4.2em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {v || '—'}
                      </div>
                    </Tooltip>
                  ) },
                { title: 'Ent. Dr', dataIndex: 'entered_dr', width: 115, align: 'right' as const,
                  sorter: (a: any, b: any) => (Number(a.entered_dr) || 0) - (Number(b.entered_dr) || 0),
                  render: (v: any) => Number(v) ? <Text style={{ fontSize: 11, color: REDWOOD.success }}>{Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : <Text style={{ color: '#bbb' }}>—</Text> },
                { title: 'Ent. Cr', dataIndex: 'entered_cr', width: 115, align: 'right' as const,
                  sorter: (a: any, b: any) => (Number(a.entered_cr) || 0) - (Number(b.entered_cr) || 0),
                  render: (v: any) => Number(v) ? <Text style={{ fontSize: 11, color: REDWOOD.error }}>{Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text> : <Text style={{ color: '#bbb' }}>—</Text> },
                { title: 'CCY', dataIndex: 'currency_code', width: 55,
                  render: (v: any) => <Tag style={{ fontSize: 10 }}>{v || '—'}</Tag> },
                { title: 'Category', dataIndex: 'je_category', width: 130, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 10 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Source', dataIndex: 'je_source', width: 100, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 10 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Ref1', dataIndex: 'reference1', width: 120, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 10 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Ref2', dataIndex: 'reference2', width: 120, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 10 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Ref3', dataIndex: 'reference3', width: 120, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 10 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Ref4', dataIndex: 'reference4', width: 120, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 10 }}>{v || '—'}</Text></Tooltip> },
                { title: 'Ref5', dataIndex: 'reference5', width: 120, ellipsis: true,
                  render: (v: any) => <Tooltip title={v}><Text style={{ fontSize: 10 }}>{v || '—'}</Text></Tooltip> },
              ]}
            />
          </>
        );
      })()}
    </Modal>
    <Card
      size="small"
      title={
        <Space>
          <FileTextOutlined style={{ color: REDWOOD.info }} />
          <span style={{ fontWeight: 600 }}>Select a Bank Statement</span>
          <Badge count={statements.length} style={{ backgroundColor: REDWOOD.info }} showZero />
        </Space>
      }
      style={{ marginBottom: 16, border: `1px solid ${REDWOOD.neutral200}` }}
      styles={{ body: { padding: 0 } }}
    >
      <Table<BankStatement>
        rowKey="statementId"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={statements}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: selectedId != null ? [selectedId] : [],
          onChange: (_, rows) => rows[0] && onSelect(rows[0]),
        }}
        onRow={(record) => ({
          onClick:  () => onSelect(record),
          style:    {
            cursor:          'pointer',
            backgroundColor: record.statementId === selectedId ? REDWOOD.info + '12' : undefined,
          },
        })}
        pagination={false}
        scroll={{ x: 700, y: 200 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No statements found — select a bank account and search"
            />
          ),
        }}
      />
    </Card>
    </>
  );
};

// ── Unreconciled Tab ──────────────────────────────────────────────────────────
interface UnreconciledTabProps {
  bankAccounts: BankAcctOption[];
  businessUnits: BUOption[];
  loadingAccounts: boolean;
}

const EXT_TXN_URL       = `${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions`;
const BANK_ACCOUNTS_URL = `${APEX_DB_CONFIG.baseUrl}/banks/bankaccounts`;

const UnreconciledTab: React.FC<UnreconciledTabProps> = ({ bankAccounts, businessUnits, loadingAccounts }) => {
  const { user } = useAuth();
  const currentUser = user?.username || user?.email || 'BANK_RECON';
  const [statements, setStatements]             = useState<BankStatement[]>([]);
  const [loadingStmts, setLoadingStmts]         = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<BankStatement | null>(null);
  const [stmtLines, setStmtLines]             = useState<StmtLine[]>([]);
  const [sysTxns, setSysTxns]                 = useState<SysTxn[]>([]);
  const [loadingStmt, setLoadingStmt]         = useState(false);
  const [loadingSys, setLoadingSys]           = useState(false);
  const [reconciling, setReconciling]         = useState(false);
  const [txnSourceFilter, setTxnSourceFilter] = useState<string>('ALL');
  const [stmtReconFilter, setStmtReconFilter] = useState<'ALL' | 'UNRECONCILED' | 'RECONCILED'>('UNRECONCILED');
  const [cmReconFilter,  setCmReconFilter]   = useState<'ALL' | 'UNRECONCILED' | 'RECONCILED'>('UNRECONCILED');
  // unified recon filter applied to all sys-txn modules (AP/AR/GL/CM)
  const [sysReconFilter, setSysReconFilter]  = useState<'ALL' | 'UNRECONCILED' | 'RECONCILED'>('UNRECONCILED');
  const [sysDateFrom, setSysDateFrom] = useState<Dayjs | null>(null);
  const [sysDateTo,   setSysDateTo]   = useState<Dayjs | null>(null);
  const [stmtSearch, setStmtSearch]           = useState('');
  const [sysSearch,  setSysSearch]            = useState('');
  const [selectedStmtKeys, setSelectedStmtKeys] = useState<React.Key[]>([]);
  const [selectedSysKeys, setSelectedSysKeys]   = useState<React.Key[]>([]);
  const [pendingAutoSelectTxnId, setPendingAutoSelectTxnId] = useState<number[]>([]);
  const [lastParams, setLastParams]           = useState<SearchParams | null>(null);
  const [leftPct, setLeftPct]                 = useState(50);
  const isDragging                            = React.useRef(false);
  const splitContainerRef                     = React.useRef<HTMLDivElement>(null);
  const [msgApi, contextHolder]               = message.useMessage();
  const [lastStatementsUrl, setLastStatementsUrl] = useState<string | null>(null);
  const [lastStmtLinesUrl, setLastStmtLinesUrl] = useState<string | null>(null);
  const [apiModalUrl, setApiModalUrl] = useState<string | null>(null);
  const [apiModalTitle, setApiModalTitle] = useState('');
  const [apiModalVisible, setApiModalVisible] = useState(false);
  const [apiExecResult, setApiExecResult] = useState<{ loading: boolean; response: string | null }>({ loading: false, response: null });
  const [showApiLog, setShowApiLog]           = useState(false);
  const [reconLogOpen, setReconLogOpen]       = useState(false);

  // ── Unreconcile confirmation ──────────────────────────────────────────────
  const [unreconModal, setUnreconModal] = useState<{
    type: 'SYS' | 'STMT';
    sysTxn?: SysTxn;
    stmtLine?: StmtLine;
  } | null>(null);
  const [unreconLoading, setUnreconLoading] = useState(false);

  // ── Auto Recon ────────────────────────────────────────────────────────────
  interface AutoReconMatch {
    stmtLine: StmtLine;
    sysTxn:   SysTxn;
    matchedBy: string[];
    confirmed: boolean;
    status: 'pending' | 'success' | 'error';
    errorMsg?: string;
  }
  const [autoReconOpen,     setAutoReconOpen]     = useState(false);
  const [autoReconCriteria, setAutoReconCriteria] = useState<string[]>(['amount']);
  const [autoReconMatches,  setAutoReconMatches]  = useState<AutoReconMatch[]>([]);
  const [autoReconStep,     setAutoReconStep]     = useState<'criteria' | 'results'>('criteria');
  const [autoReconRunning,  setAutoReconRunning]  = useState(false);
  const [autoReconTxnType,  setAutoReconTxnType]  = useState<string>('ALL');
  const [autoReconApiOpen,  setAutoReconApiOpen]  = useState(false);
  const [matchingViewOpen, setMatchingViewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Cash account combination for the selected bank — used to fetch GL journal lines
  const [cashAccountCombination, setCashAccountCombination] = useState<string>('');

  interface ReconCall {
    lineId: number; statementId: number; txnId: number; txnType: string; txnNumber: string; reconAmount: number;
    // Statement line reconcile (POST)
    status: 'pending' | 'running' | 'success' | 'error'; response?: string;
    // Transaction-side update (PUT/PATCH)
    txnUrl: string; txnBody: object; txnLabel: string;
    txnStatus: 'pending' | 'running' | 'success' | 'error' | 'skipped'; txnResponse?: string;
  }
  const [reconCalls, setReconCalls]           = useState<ReconCall[]>([]);
  interface ProgressStep { label: string; status: 'pending' | 'running' | 'success' | 'error'; }
  const [progressOpen,  setProgressOpen]  = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [progressDone,  setProgressDone]  = useState(false);

  // Resize drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct  = Math.min(Math.max(((e.clientX - rect.left) / rect.width) * 100, 25), 75);
      setLeftPct(pct);
    };
    const onUp = () => { isDragging.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Selection difference — kept in state so useCallback hooks can depend on it ──
  const [difference, setDifference] = useState(0);

  // ── Create External Transaction modal ──────────────────────────────────────
  const [extTxnOpen, setExtTxnOpen]               = useState(false);
  const [extTxnForm]                              = Form.useForm();
  const [extTxnDirection,  setExtTxnDirection]    = useState<'DR' | 'CR'>('DR');
  const [extTxnAssetAcct,  setExtTxnAssetAcct]    = useState('');
  const [extTxnOffsetAcct, setExtTxnOffsetAcct]   = useState('');
  const [extTxnSaving, setExtTxnSaving]         = useState(false);
  const [extTxnPayload, setExtTxnPayload]       = useState<any>(null);
  const [extTxnResponse, setExtTxnResponse]     = useState<any>(null);
  const [extTxnRawError, setExtTxnRawError]     = useState('');
  const [extTxnCreatedId, setExtTxnCreatedId]   = useState<number | null>(null);
  const [extAcctRunning, setExtAcctRunning]     = useState(false);
  const [extAcctResult, setExtAcctResult]       = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Add Statement Line modal ──────────────────────────────────────────────
  const [addLineOpen, setAddLineOpen]         = useState(false);
  const [addLineForm]                         = Form.useForm();
  const [addLineSaving, setAddLineSaving]     = useState(false);
  const [extBankAccounts, setExtBankAccounts] = useState<{ name: string; cashAccount: string; currency: string }[]>([]);
  const [extAssetDesc, setExtAssetDesc]     = useState('');
  const [extOffsetDesc, setExtOffsetDesc]   = useState('');
  const [extCoaOpen, setExtCoaOpen]         = useState(false);
  const [extCoaTarget, setExtCoaTarget]     = useState<'asset' | 'offset' | 'line-offset'>('asset');
  const [extCoaInitial, setExtCoaInitial]   = useState('');
  const [extTxnMode, setExtTxnMode]         = useState<'single' | 'multiple'>('single');
  const [extTxnLines, setExtTxnLines]       = useState<Array<{key: number; amount?: number; description: string; offsetAccount: string; offsetDesc: string}>>([]);
  const [extLineCoaIdx, setExtLineCoaIdx]   = useState(0);

  // Claude AI Reconciliation
  const [claudeReconOpen, setClaudeReconOpen] = useState(false);
  const [claudeApiKey, setClaudeApiKey] = useState<string>('');
  const [claudeResult, setClaudeResult] = useState<ReconciliationResult | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeError, setClaudeError] = useState('');

  // Load bank accounts for the ext txn modal (filter by legal entity)
  const loadExtBankAccounts = useCallback((legalEntity: string) => {
    setExtBankAccounts([]);
    fetch(BANK_ACCOUNTS_URL, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const all = (data.items || []) as any[];
        const seen = new Set<string>();
        setExtBankAccounts(
          all
            .filter(i => !legalEntity || (i.legal_entity_name || '').toLowerCase() === legalEntity.toLowerCase())
            .map((i: any) => ({
              name:        i.bank_account_name  || i.bankAccountName  || '',
              cashAccount: i.cash_account_combination || '',
              currency:    i.currency_code || '',
            }))
            .filter(a => a.name && !seen.has(a.name) && seen.add(a.name))
        );
      })
      .catch(() => {});
  }, []);

  const updateExtLine = (idx: number, field: string, value: any) => {
    setExtTxnLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const handleBuChange = useCallback((buValue: string) => {
    const bu = businessUnits.find(b => b.value === buValue);
    loadExtBankAccounts(bu?.legalEntityName || '');
    extTxnForm.setFieldsValue({ bankAccountName: undefined, currencyCode: 'AED' });
    setExtAssetDesc('');
  }, [businessUnits, loadExtBankAccounts, extTxnForm]);

  const handleBankAccountChange = useCallback(async (bankName: string) => {
    const match = extBankAccounts.find(b => b.name === bankName);
    if (!match) return;
    extTxnForm.setFieldValue('currencyCode', match.currency || 'AED');
    if (match.cashAccount) {
      extTxnForm.setFieldValue('assetAccountCombination', match.cashAccount);
      setExtTxnAssetAcct(match.cashAccount);
      try {
        const r    = await validateAccountCode(match.cashAccount);
        const seg4 = Object.values(r.segmentDetails)[3];
        setExtAssetDesc((seg4 as any)?.description || '');
      } catch { /* ignore */ }
    }
  }, [extBankAccounts, extTxnForm]);

  // Open the ext txn modal, pre-filling from selected lines + statement
  const openExtTxnModal = useCallback(async () => {
    const selectedLines = stmtLines.filter(l => selectedStmtKeys.includes(l.lineId));
    const firstLine     = selectedLines[0];

    extTxnForm.resetFields();
    setExtTxnPayload(null);
    setExtTxnResponse(null);
    setExtTxnRawError('');
    setExtAssetDesc('');
    setExtOffsetDesc('');
    setExtTxnCreatedId(null);
    setExtAcctRunning(false);
    setExtAcctResult(null);
    const autoDir = (firstLine?.transactionCode === 'CR' ? 'CR' : 'DR') as 'DR' | 'CR';
    // CR = Money In = positive, DR = Money Out = negative
    const applySign = (abs: number) => autoDir === 'CR' ? Math.abs(abs) : -Math.abs(abs);
    const totalAmount = applySign(selectedLines.reduce((s, l) => s + Math.abs(l.amount ?? 0), 0));
    setExtTxnDirection(autoDir);
    setExtTxnAssetAcct('');
    setExtTxnOffsetAcct('');

    // Build statement-based reference
    const stmtNum = selectedStatement?.statementNumber || `S${selectedStatement?.statementId || ''}`;
    const autoRef = selectedLines.length === 1
      ? `${stmtNum}-L${selectedLines[0].lineId}`
      : selectedLines.length > 1
        ? `${stmtNum}-L${selectedLines.map(l => l.lineId).join(',')}`
        : stmtNum;
    setExtBankAccounts([]);
    setExtTxnMode(selectedLines.length > 1 ? 'multiple' : 'single');
    setExtTxnLines(
      selectedLines.length > 0
        ? selectedLines.map((l, i) => ({
            key: i,
            amount: applySign(l.amount ?? 0),
            description: l.description || '',
            offsetAccount: '',
            offsetDesc: '',
          }))
        : [{ key: 0, amount: undefined, description: '', offsetAccount: '', offsetDesc: '' }]
    );

    // Step 1: find the matching BankAcctOption to get its legal entity
    const matchedAcct = bankAccounts.find(a =>
      a.label === selectedStatement?.bankAccountName ||
      a.bankAccountNumber === selectedStatement?.bankAccountName ||
      a.value  === selectedStatement?.bankAccountName
    );
    const legalEntity = matchedAcct?.legalEntityName || '';

    // Step 2: find matching BU from businessUnits by legal entity
    const matchedBU = businessUnits.find(b =>
      b.legalEntityName && legalEntity &&
      b.legalEntityName.toLowerCase() === legalEntity.toLowerCase()
    );

    // Step 3: fetch bank accounts filtered by legal entity to get cash_account_combination
    let cashAccountCombination = '';
    let matchedBankName = selectedStatement?.bankAccountName || '';
    try {
      const res  = await fetch(BANK_ACCOUNTS_URL, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const all  = (data.items || []) as any[];
      const filtered = all.filter(i =>
        !legalEntity || (i.legal_entity_name || '').toLowerCase() === legalEntity.toLowerCase()
      );
      const seen = new Set<string>();
      const opts = filtered
        .map((i: any) => ({
          name:        i.bank_account_name  || i.bankAccountName  || '',
          cashAccount: i.cash_account_combination || '',
          currency:    i.currency_code || '',
        }))
        .filter(a => a.name && !seen.has(a.name) && seen.add(a.name));
      setExtBankAccounts(opts);

      // Find the account matching the statement's bank account name
      const match = opts.find(o =>
        o.name === selectedStatement?.bankAccountName ||
        selectedStatement?.bankAccountName?.includes(o.name) ||
        o.name?.includes(selectedStatement?.bankAccountName || '')
      );
      if (match) {
        matchedBankName        = match.name;
        cashAccountCombination = match.cashAccount;
        if (cashAccountCombination) {
          try {
            const r    = await validateAccountCode(cashAccountCombination);
            const seg4 = Object.values(r.segmentDetails)[3];
            setExtAssetDesc((seg4 as any)?.description || '');
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    extTxnForm.setFieldsValue({
      bankAccountName:          matchedBankName,
      businessUnitName:         matchedBU?.value || matchedBU?.label || '',
      amount:                   selectedLines.length > 0 ? totalAmount : undefined,
      transactionDate:          firstLine?.transactionDate ? dayjs(firstLine.transactionDate) : dayjs(),
      currencyCode:             selectedStatement?.currencyCode || 'AED',
      referenceText:            autoRef,
      description:              firstLine?.description || '',
      transactionType:          'MISC',
      assetAccountCombination:  cashAccountCombination,
      transactionDirection:     autoDir,
    });
    if (cashAccountCombination) setExtTxnAssetAcct(cashAccountCombination);

    setExtTxnOpen(true);
  }, [stmtLines, selectedStmtKeys, selectedStatement, bankAccounts, businessUnits, extTxnForm]);

  // Create external transaction for the reconciliation difference
  // Opens the same modal pre-filled with the gap amount and correct direction:
  //   difference > 0  (stmt > sys) → Money In  (DR) → positive amount
  //   difference < 0  (stmt < sys) → Money Out (CR) → negative amount
  const openDiffExtTxnModal = useCallback(async () => {
    const selectedLines = stmtLines.filter(l => selectedStmtKeys.includes(l.lineId));
    const firstLine     = selectedLines[0];

    extTxnForm.resetFields();
    setExtTxnPayload(null);
    setExtTxnResponse(null);
    setExtTxnRawError('');
    setExtAssetDesc('');
    setExtOffsetDesc('');
    setExtTxnCreatedId(null);
    setExtAcctRunning(false);
    setExtAcctResult(null);

    const dir: 'DR' | 'CR' = difference >= 0 ? 'DR' : 'CR';
    setExtTxnDirection(dir);
    setExtTxnAssetAcct('');
    setExtTxnOffsetAcct('');
    setExtTxnMode('single');
    setExtTxnLines([{
      key:           0,
      amount:        difference,
      description:   'Reconciliation difference',
      offsetAccount: '',
      offsetDesc:    '',
    }]);

    const stmtNum = selectedStatement?.statementNumber || `S${selectedStatement?.statementId || ''}`;
    const lineTag = selectedLines.length === 1
      ? `L${selectedLines[0].lineId}`
      : `L${selectedLines.map(l => l.lineId).join(',')}`;
    const autoRef = `Diff:${stmtNum}-${lineTag}`;
    setExtBankAccounts([]);

    // Resolve BU and cash account (same logic as openExtTxnModal)
    const matchedAcct = bankAccounts.find(a =>
      a.label === selectedStatement?.bankAccountName ||
      a.bankAccountNumber === selectedStatement?.bankAccountName ||
      a.value  === selectedStatement?.bankAccountName
    );
    const legalEntity = matchedAcct?.legalEntityName || '';
    const matchedBU   = businessUnits.find(b =>
      b.legalEntityName && legalEntity &&
      b.legalEntityName.toLowerCase() === legalEntity.toLowerCase()
    );

    let cashAccountCombination = '';
    let matchedBankName = selectedStatement?.bankAccountName || '';
    try {
      const res  = await fetch(BANK_ACCOUNTS_URL, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const all  = (data.items || []) as any[];
      const filtered = all.filter(i =>
        !legalEntity || (i.legal_entity_name || '').toLowerCase() === legalEntity.toLowerCase()
      );
      const seen = new Set<string>();
      const opts = filtered
        .map((i: any) => ({
          name:        i.bank_account_name  || i.bankAccountName  || '',
          cashAccount: i.cash_account_combination || '',
          currency:    i.currency_code || '',
        }))
        .filter(a => a.name && !seen.has(a.name) && seen.add(a.name));
      setExtBankAccounts(opts);

      const match = opts.find(o =>
        o.name === selectedStatement?.bankAccountName ||
        selectedStatement?.bankAccountName?.includes(o.name) ||
        o.name?.includes(selectedStatement?.bankAccountName || '')
      );
      if (match) {
        matchedBankName        = match.name;
        cashAccountCombination = match.cashAccount;
        if (cashAccountCombination) {
          try {
            const r    = await validateAccountCode(cashAccountCombination);
            const seg4 = Object.values(r.segmentDetails)[3];
            setExtAssetDesc((seg4 as any)?.description || '');
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    extTxnForm.setFieldsValue({
      bankAccountName:         matchedBankName,
      businessUnitName:        matchedBU?.value || matchedBU?.label || '',
      amount:                  difference,
      transactionDate:         firstLine?.transactionDate ? dayjs(firstLine.transactionDate) : dayjs(),
      currencyCode:            selectedStatement?.currencyCode || 'AED',
      referenceText:           autoRef,
      description:             `Reconciliation difference`,
      transactionType:         'MISC',
      assetAccountCombination: cashAccountCombination,
      transactionDirection:    dir,
    });
    if (cashAccountCombination) setExtTxnAssetAcct(cashAccountCombination);

    setExtTxnOpen(true);
  }, [stmtLines, selectedStmtKeys, selectedStatement, bankAccounts, businessUnits, extTxnForm, difference]);

  // Submit external transaction
  const handleExtTxnSubmit = async (values: any) => {
    if (!values.referenceText?.trim()) { msgApi.error('Reference is required'); return; }
    if (!values.assetAccountCombination?.trim()) { msgApi.error('Cash / Asset account is required'); return; }
    if (extTxnMode === 'single' && !values.offsetAccountCombination?.trim()) { msgApi.error('Offset account is required'); return; }
    if (extTxnMode === 'multiple') {
      const invalid = extTxnLines.filter(l => !l.amount);
      if (invalid.length > 0) { msgApi.error('All lines must have an amount'); return; }
      setExtTxnSaving(true);
      const baseRef = values.referenceText?.trim() || `STMT-${selectedStatement?.statementId}-${Date.now()}`;
      const commonHeader = {
        BankAccountName:         values.bankAccountName,
        BusinessUnitName:        values.businessUnitName,
        TransactionDate:         values.transactionDate?.format('YYYY-MM-DD'),
        CurrencyCode:            values.currencyCode ?? 'AED',
        TransactionType:         values.transactionType ?? 'MISC',
        AssetAccountCombination: values.assetAccountCombination ?? '',
        StatementId:             selectedStatement?.statementId ?? null,
        StatementLineIds:        null,
        Source: 'ORA_MAN', Status: 'UNR', AccountingFlag: false,
        CreatedBy: 'SYSTEM', CreationDate: new Date().toISOString(),
        LastUpdatedBy: 'SYSTEM', LastUpdateDate: new Date().toISOString(), LastUpdateLogin: '',
      };
      const payloads = extTxnLines.map((line, i) => ({
        items: [{
          ...commonHeader,
          Amount:                   line.amount,
          ReferenceText:            extTxnLines.length > 1 ? `${baseRef}-${i + 1}` : baseRef,
          Description:              line.description ?? '',
          OffsetAccountCombination: line.offsetAccount ?? '',
        }],
      }));
      setExtTxnPayload(payloads);
      setExtTxnResponse(null);
      setExtTxnRawError('');
      try {
        const results: any[] = [];
        for (const p of payloads) {
          const res  = await fetch(EXT_TXN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(p) });
          const text = await res.text();
          let d: any = {};
          try { d = JSON.parse(text); } catch { d = { status: 'error', message: text }; }
          results.push(d);
          if (d.status !== 'success') {
            setExtTxnResponse(results);
            setExtTxnRawError(`HTTP ${res.status} — ${text}`);
            msgApi.error(d.message || 'Failed to create transaction');
            setExtTxnSaving(false);
            return;
          }
        }
        setExtTxnResponse(results);
        const selectedLines = stmtLines.filter(l => selectedStmtKeys.includes(l.lineId));
        // Link each statement line[i] to its corresponding created transaction results[i]
        await Promise.allSettled(
          results.map((r, i) => {
            const txnId = r?.externalTransactionId ?? r?.items?.[0]?.ExternalTransactionId ?? null;
            const line  = selectedLines[i];
            const ref   = extTxnLines.length > 1 ? `${baseRef}-${i + 1}` : baseRef;
            if (!txnId || !line) return Promise.resolve();
            return fetch(`${APEX_BASE}/cash/reconciliation/stmtlines/${line.lineId}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ExternalTxnId: txnId, ExternalTxnRef: ref }),
            });
          })
        );
        setStmtLines(prev => prev.map(l => {
          const idx   = selectedLines.findIndex(s => s.lineId === l.lineId);
          if (idx < 0) return l;
          const txnId = results[idx]?.externalTransactionId ?? results[idx]?.items?.[0]?.ExternalTransactionId ?? null;
          const ref   = extTxnLines.length > 1 ? `${baseRef}-${idx + 1}` : baseRef;
          return { ...l, externalTxnId: txnId, externalTxnRef: ref };
        }));
        msgApi.success(`${results.length} external transaction(s) created successfully`);
        setExtTxnCreatedId(results[0]?.externalTransactionId ?? results[0]?.items?.[0]?.ExternalTransactionId ?? null);
        setSelectedStmtKeys([]);
      } catch (e: any) {
        setExtTxnRawError(`Error: ${e.message}`);
        msgApi.error('Network error creating external transactions');
      } finally {
        setExtTxnSaving(false);
      }
      return;
    }

    const selectedLines = stmtLines.filter(l => selectedStmtKeys.includes(l.lineId));
    const lineIds = selectedLines.map(l => l.lineId).join(',');
    const uniqueRef = values.referenceText?.trim() || `STMT-${selectedStatement?.statementId}-${Date.now()}`;
    const payload = {
      items: [{
        BankAccountName:          values.bankAccountName,
        BusinessUnitName:         values.businessUnitName,
        Amount:                   values.amount,
        TransactionDate:          values.transactionDate?.format('YYYY-MM-DD'),
        CurrencyCode:             values.currencyCode ?? 'AED',
        ReferenceText:            uniqueRef,
        TransactionType:          values.transactionType ?? 'MISC',
        Description:              values.description ?? '',
        Source:                   'ORA_MAN',
        Status:                   'UNR',
        AccountingFlag:           false,
        CreatedBy:                'SYSTEM',
        CreationDate:             new Date().toISOString(),
        LastUpdatedBy:            'SYSTEM',
        LastUpdateDate:           new Date().toISOString(),
        LastUpdateLogin:          '',
        AssetAccountCombination:  values.assetAccountCombination ?? '',
        OffsetAccountCombination: values.offsetAccountCombination ?? '',
        StatementId:              selectedStatement?.statementId ?? null,
        StatementLineIds:         lineIds || null,
      }],
    };
    setExtTxnPayload(payload);
    setExtTxnResponse(null);
    setExtTxnRawError('');
    setExtTxnSaving(true);
    try {
      const res  = await fetch(EXT_TXN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(payload),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { status: 'error', message: text }; }
      setExtTxnResponse(data);
      setExtTxnRawError(res.ok ? '' : `HTTP ${res.status} — ${text}`);
      if (data.status === 'success') {
        const extTxnId: number | null = data.externalTransactionId ?? data.items?.[0]?.ExternalTransactionId ?? null;
        // Update each selected statement line with the ext txn id
        if (extTxnId && selectedStatement) {
          const lineIds = stmtLines.filter(l => selectedStmtKeys.includes(l.lineId)).map(l => l.lineId);
          await Promise.allSettled(lineIds.map(lineId =>
            fetch(`${APEX_BASE}/cash/reconciliation/stmtlines/${lineId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ExternalTxnId: extTxnId, ExternalTxnRef: values.referenceText }),
            })
          ));
          // Update local state so lines show the ext txn ref and button is disabled
          setStmtLines(prev => prev.map(l =>
            selectedStmtKeys.includes(l.lineId)
              ? { ...l, externalTxnId: extTxnId, externalTxnRef: values.referenceText }
              : l
          ));
        }
        msgApi.success(`External transaction ${extTxnId ? `#${extTxnId} ` : ''}created successfully`);
        setExtTxnCreatedId(extTxnId);
        setSelectedStmtKeys([]);
      } else {
        msgApi.error(data.message || 'Failed to create external transaction');
      }
    } catch (e: any) {
      setExtTxnRawError(`Error: ${e.message}`);
      msgApi.error('Network error creating external transaction');
    } finally {
      setExtTxnSaving(false);
    }
  };

  const fetchStatements = useCallback(async (params: SearchParams) => {
    const q = new URLSearchParams();
    if (params.bankAccount)  q.set('bank_account',  params.bankAccount);
    if (params.businessUnit) q.set('business_unit', params.businessUnit);
    if (params.dateFrom)     q.set('date_from',     params.dateFrom.format('YYYY-MM-DD'));
    if (params.dateTo)       q.set('date_to',       params.dateTo.format('YYYY-MM-DD'));
    q.set('row_limit', '200');

    const statementsUrl = `${APEX_BASE}/cash/bankstatements?${q.toString()}`;
    setLastStatementsUrl(statementsUrl);
    setLoadingStmts(true);
    try {
      const res  = await fetch(statementsUrl);
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        setStatements((data.items ?? []) as BankStatement[]);
      } else {
        msgApi.error(data.message ?? 'Failed to load statements');
      }
    } catch (err) {
      msgApi.error('Network error loading statements');
      console.error(err);
    } finally {
      setLoadingStmts(false);
    }
  }, [msgApi]);

  const fetchStmtLines = useCallback(async (params: SearchParams, reconFilter = 'UNRECONCILED') => {
    const q = new URLSearchParams();
    // bank_account is not needed when statement_id is provided — the statement already identifies the account
    if (!params.statementId && params.bankAccount) q.set('bank_account', params.bankAccount);
    if (reconFilter !== 'ALL') q.set('recon_status', reconFilter);
    if (params.dateFrom)   q.set('date_from',    params.dateFrom.format('YYYY-MM-DD'));
    if (params.dateTo)     q.set('date_to',      params.dateTo.format('YYYY-MM-DD'));
    if (params.amountMin != null) q.set('amount_min', String(params.amountMin));
    if (params.amountMax != null) q.set('amount_max', String(params.amountMax));
    if (params.statementId)  q.set('statement_id', params.statementId);
    if (params.reference)    q.set('reference',    params.reference);
    q.set('row_limit', '500');

    const stmtLinesUrl = `${APEX_BASE}/cash/reconciliation/stmtlines?${q.toString()}`;
    setLastStmtLinesUrl(stmtLinesUrl);
    setLoadingStmt(true);
    try {
      const res  = await fetch(stmtLinesUrl);
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        setStmtLines((data.items ?? []).map((i: any) => {
          const code = i.transactionCode ?? i.TRANSACTION_CODE ?? 'DR';
          const rawAmount = Number(i.amount ?? i.AMOUNT ?? 0);
          // Apply sign based on DR/CR: CR (+ve), DR (-ve)
          const signedAmount = code === 'CR' ? Math.abs(rawAmount) : -Math.abs(rawAmount);
          return {
            ...i,
            amount: signedAmount,
            transactionCode: code,
            // Oracle may return snake_case or UPPERCASE — normalise to camelCase
            externalTxnId:  i.externalTxnId  ?? i.external_txn_id  ?? i.EXTERNAL_TXN_ID  ?? undefined,
            externalTxnRef: i.externalTxnRef ?? i.external_txn_ref ?? i.EXTERNAL_TXN_REF ?? undefined,
          };
        }) as StmtLine[]);
      } else {
        msgApi.error(data.message ?? 'Failed to load statement lines');
      }
    } catch (err) {
      msgApi.error('Network error loading statement lines');
      console.error(err);
    } finally {
      setLoadingStmt(false);
    }
  }, [msgApi]);

  const fetchSysTxns = useCallback(async (
    params: SearchParams,
    txnType?: string,
    cmFilter?: string,
    overrideBankAccount?: string,
    overrideCashAccount?: string,
  ) => {
    // bank_account must come from the selected bank statement, not the search form.
    // overrideBankAccount lets handleSelectStatement pass the resolved name directly,
    // avoiding the stale-closure problem (setSelectedStatement is async).
    let bankAccountFilter = overrideBankAccount;

    if (!bankAccountFilter) {
      if (!selectedStatement) {
        msgApi.warning('Please select a bank statement first');
        setSysTxns([]);
        setLoadingSys(false);
        return;
      }
      bankAccountFilter = selectedStatement.bankAccountName;
    }

    const cashAcct = overrideCashAccount ?? cashAccountCombination;
    const effectiveDateFrom = params.dateFrom ?? sysDateFrom;
    const effectiveDateTo   = params.dateTo   ?? sysDateTo;
    const rf = cmFilter ?? 'UNRECONCILED';

    // Single unified endpoint — RR_V_BANK_RECON_SYSTXNS covers AP + External + Bank Transfers + GL Journals
    const onlyGlJournal = txnType === 'GL_JOURNAL';
    const q = new URLSearchParams();
    // For GL_JOURNAL-only filter: pass cash_account directly (exact combination),
    // skip bank_account entirely so the URL is clean and debuggable.
    // For ALL / other sources: always include bank_account for non-GL filtering.
    if (!onlyGlJournal) q.set('bank_account', bankAccountFilter);
    // Pass cash_account directly so GL journal lines are filtered by account combination,
    // not by a server-side name lookup that can break on currency suffixes.
    if (cashAcct) q.set('cash_account', cashAcct);
    if (params.businessUnit)      q.set('business_unit', params.businessUnit);
    if (effectiveDateFrom)        q.set('date_from',     effectiveDateFrom.format('YYYY-MM-DD'));
    if (effectiveDateTo)          q.set('date_to',       effectiveDateTo.format('YYYY-MM-DD'));
    if (params.amountMin != null) q.set('amount_min',    String(params.amountMin));
    if (params.amountMax != null) q.set('amount_max',    String(params.amountMax));
    if (params.reference)         q.set('reference',     params.reference);
    // Map old txnType to new source param
    if (txnType === 'CM') q.set('source', 'EXTERNAL_TXN');
    else if (txnType && txnType !== 'ALL') q.set('source', txnType);
    q.set('recon_status', rf === 'ALL' ? 'ALL' : rf);
    q.set('row_limit', '500');

    try {
      const res  = await fetch(`${APEX_BASE}/cash/reconciliation/systxns?${q.toString()}`);
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        setSysTxns((data.items ?? []).map((i: any): SysTxn => ({
          txnId:           Number(i.txnId)    || 0,
          txnNumber:       i.txnNumber        || String(i.txnId ?? '') || '',
          txnDate:         i.txnDate          ?? '',
          amount:          i.amount           ?? 0,
          currencyCode:    i.currencyCode     ?? '',
          businessUnit:    i.businessUnit     ?? '',
          bankAccountName: i.bankAccountName  ?? '',
          source:          i.source           ?? '',
          txnStatus:       i.status           ?? '',
          reference:       i.reference        ?? '',
          reconciledFlag:  i.reconciledFlag   ?? 'N',
          // AP Payment fields
          payee:           i.counterpartyName ?? '',
          supplierNumber:  i.counterpartyNumber ?? '',
          paymentMethod:   i.paymentMethod    ?? '',
          clearingDate:    i.clearingDate     ?? '',
          // Bank Transfer / GL Journal fields
          lineDescription: i.description      ?? '',
          jeHeaderId:      i.jeHeaderId       != null ? Number(i.jeHeaderId) : undefined,
          jeLineNumber:    i.jeLineNumber      != null ? Number(i.jeLineNumber) : undefined,
          glBatchId:       i.glBatchId        != null ? Number(i.glBatchId) : undefined,
          accountCode:     i.accountCombination ?? '',
          journalCategory: i.accountingClass  ?? '',   // GL_JOURNAL puts category here
          // External transaction fields
          assetAccountCombination:  i.accountCombination ?? '',
          createdBy:       i.createdBy        ?? '',
          creationDate:    i.creationDate     ?? '',
        })));
      } else {
        msgApi.error(data.message ?? 'Failed to load system transactions');
      }
    } catch (err) {
      msgApi.error('Network error loading system transactions');
      console.error(err);
    } finally {
      setLoadingSys(false);
    }
  }, [msgApi, sysDateFrom, sysDateTo, selectedStatement, cashAccountCombination]);

  // ── API Inspector ─────────────────────────────────────────────────────────
  const [apiModal, setApiModal]   = useState(false);
  const [apiCopied, setApiCopied] = useState(false);

  const buildSysTxnsUrl = useCallback((source?: string) => {
    const effectiveDateFrom = lastParams?.dateFrom ?? sysDateFrom;
    const effectiveDateTo   = lastParams?.dateTo   ?? sysDateTo;
    const onlyGl = source === 'GL_JOURNAL';
    const q = new URLSearchParams();
    if (selectedStatement && !onlyGl) {
      q.set('bank_account', selectedStatement.bankAccountName);
    }
    if (cashAccountCombination)          q.set('cash_account',  cashAccountCombination);
    if (lastParams?.businessUnit)        q.set('business_unit', lastParams.businessUnit);
    if (effectiveDateFrom)               q.set('date_from',     effectiveDateFrom.format('YYYY-MM-DD'));
    if (effectiveDateTo)                 q.set('date_to',       effectiveDateTo.format('YYYY-MM-DD'));
    if (lastParams?.amountMin != null)   q.set('amount_min',    String(lastParams.amountMin));
    if (lastParams?.amountMax != null)   q.set('amount_max',    String(lastParams.amountMax));
    if (lastParams?.reference)           q.set('reference',     lastParams.reference);
    if (source && source !== 'ALL')      q.set('source',        source);
    q.set('recon_status', sysReconFilter === 'ALL' ? 'ALL' : sysReconFilter);
    q.set('row_limit', '500');
    return `${APEX_BASE}/cash/reconciliation/systxns?${q.toString()}`;
  }, [lastParams, sysDateFrom, sysDateTo, sysReconFilter, selectedStatement, cashAccountCombination]);

  // When CM records finish loading, auto-select all pending linked transactions
  useEffect(() => {
    if (pendingAutoSelectTxnId.length === 0 || sysTxns.length === 0) return;
    const matched = sysTxns
      .filter(t => pendingAutoSelectTxnId.includes(t.txnId))
      .map(t => t.txnId);
    if (matched.length > 0) {
      setSelectedSysKeys(matched);
      setPendingAutoSelectTxnId([]);
    }
  }, [sysTxns, pendingAutoSelectTxnId]);

  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setApiCopied(true);
      setTimeout(() => setApiCopied(false), 2000);
    });
  }, []);

  const handleSearch = useCallback((params: SearchParams) => {
    setLastParams(params);
    setSelectedStatement(null);
    setSelectedStmtKeys([]);
    setSelectedSysKeys([]);
    setStmtLines([]);
    setSysTxns([]);
    fetchStatements(params);
  }, [fetchStatements]);

  const handleSelectStatement = useCallback(async (stmt: BankStatement) => {
    setSelectedStatement(stmt);
    setSelectedStmtKeys([]);
    setSelectedSysKeys([]);
    const lineParams: SearchParams = {
      ...(lastParams ?? {}),
      statementId: String(stmt.statementId),
    };
    const bankAccountFilter = stmt.bankAccountName;

    // Auto-populate sys txn date range: from = 1st of statement month, to = last day of statement month
    const stmtDay    = dayjs(stmt.statementDate);
    const autoFrom   = stmtDay.startOf('month');
    const autoTo     = stmtDay.endOf('month');
    setSysDateFrom(autoFrom);
    setSysDateTo(autoTo);

    const txnParams: SearchParams = {
      ...(lastParams ?? {}),
      bankAccount: bankAccountFilter,
      dateFrom: autoFrom,
      dateTo:   autoTo,
    };
    setLastParams(txnParams);
    fetchStmtLines(lineParams, stmtReconFilter);

    // Fetch cash_account_combination directly from the bank accounts API.
    // We can't rely on the pre-loaded bankAccounts state because cash_account_combination
    // may not be populated there. This mirrors what the auto-recon flow does.
    let cashAcct = '';
    try {
      const res  = await fetch(BANK_ACCOUNTS_URL, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const stmtNameClean = stripCurrencySuffix(stmt.bankAccountName).toLowerCase();
      const match = (data.items || []).find((i: any) => {
        const apiName = stripCurrencySuffix(i.bank_account_name || i.bankAccountName || '').toLowerCase();
        return apiName === stmtNameClean || apiName.includes(stmtNameClean) || stmtNameClean.includes(apiName);
      });
      cashAcct = match?.cash_account_combination || match?.cashAccountCombination || '';
    } catch { /* ignore — systxns will still fetch non-GL sources */ }

    setCashAccountCombination(cashAcct);
    // Pass cashAcct explicitly to avoid stale-closure on setCashAccountCombination
    fetchSysTxns(txnParams, txnSourceFilter, sysReconFilter, bankAccountFilter, cashAcct);
  }, [lastParams, fetchStmtLines, fetchSysTxns, txnSourceFilter, stmtReconFilter, sysReconFilter]);

  const handleReset = useCallback(() => {
    setStatements([]);
    setSelectedStatement(null);
    setStmtLines([]);
    setSysTxns([]);
    setSelectedStmtKeys([]);
    setSelectedSysKeys([]);
    setLastParams(null);
  }, []);

  const openAddLineModal = useCallback(() => {
    addLineForm.resetFields();
    addLineForm.setFieldsValue({ transactionCode: 'DR' });
    setAddLineOpen(true);
  }, [addLineForm]);

  const handleAddLineSubmit = async (values: any) => {
    if (!selectedStatement) return;
    setAddLineSaving(true);
    const payload = {
      header: {
        statementId:     selectedStatement.statementId,
        statementNumber: selectedStatement.statementNumber,
        bankAccountName: selectedStatement.bankAccountName,
        statementDate:   selectedStatement.statementDate,
        currencyCode:    selectedStatement.currencyCode ?? 'AED',
        openingBalance:  selectedStatement.openingBalance ?? 0,
        closingBalance:  selectedStatement.closingBalance ?? 0,
        businessUnitName: selectedStatement.businessUnitName ?? '',
        status:          selectedStatement.status ?? 'DRAFT',
        createdBy:       currentUser,
        lastUpdatedBy:   currentUser,
      },
      lines: [{
        transactionDate:     values.transactionDate?.format('YYYY-MM-DD'),
        valueDate:           values.valueDate?.format('YYYY-MM-DD') ?? null,
        amount:              values.amount,
        transactionCode:     values.transactionCode,
        description:         values.description ?? '',
        reference:           values.reference ?? '',
        bankTxnReference:    values.bankTxnReference ?? '',
        counterpartyName:    values.counterpartyName ?? '',
        counterpartyAccount: '',
        categoryCode:        '',
        createdBy:           currentUser,
        lastUpdatedBy:       currentUser,
      }],
    };
    try {
      const res  = await fetch(`${APEX_BASE}/cash/bankstatements`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(payload),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { status: 'error', message: text }; }
      if (data.status === 'success') {
        // Update closing balance on the header: CR increases closing, DR decreases it
        const lineAmount  = Number(values.amount) || 0;
        const delta       = values.transactionCode === 'CR' ? lineAmount : -lineAmount;
        const newClosing  = (selectedStatement.closingBalance ?? 0) + delta;
        try {
          await fetch(`${APEX_BASE}/cash/bankstatements/${selectedStatement.statementId}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              statementId:     selectedStatement.statementId,
              statementNumber: selectedStatement.statementNumber,
              bankAccountName: selectedStatement.bankAccountName,
              statementDate:   selectedStatement.statementDate,
              currencyCode:    selectedStatement.currencyCode ?? 'AED',
              openingBalance:  selectedStatement.openingBalance ?? 0,
              closingBalance:  newClosing,
              businessUnitName: selectedStatement.businessUnitName ?? '',
              status:          selectedStatement.status ?? 'DRAFT',
              lastUpdatedBy:   currentUser,
            }),
          });
        } catch {
          // Non-fatal — line was created; balance update failed silently
          console.warn('Could not update statement header closing balance');
        }
        msgApi.success('Statement line added successfully');
        setAddLineOpen(false);
        // Refresh statement lines
        const lineParams: SearchParams = { statementId: String(selectedStatement.statementId) };
        fetchStmtLines(lineParams, stmtReconFilter);
      } else {
        msgApi.error(data.message || 'Failed to add statement line');
      }
    } catch (e: any) {
      msgApi.error('Network error: ' + e.message);
    } finally {
      setAddLineSaving(false);
    }
  };

  const handleReconcile = useCallback(async () => {
    if (selectedStmtKeys.length === 0 || selectedSysKeys.length === 0) return;

    const selectedLines0 = stmtLines.filter((l) => selectedStmtKeys.includes(l.lineId));
    const selectedTxns0  = sysTxns.filter((t) => selectedSysKeys.includes(sysTxnRowKey(t)));
    const alreadyReconStmt = selectedLines0.some(l => l.reconStatus === 'RECONCILED');
    const alreadyReconSys  = selectedTxns0.some(t => t.reconciledFlag === 'Y');
    if (alreadyReconStmt || alreadyReconSys) {
      msgApi.error('One or more selected transactions are already reconciled.');
      return;
    }

    const visibleSysTxns = txnSourceFilter === 'ALL' ? sysTxns : sysTxns.filter((t) => t.source === txnSourceFilter);

    const selectedLines = stmtLines.filter((l) => selectedStmtKeys.includes(l.lineId));
    const selectedTxns  = visibleSysTxns.filter((t) => selectedSysKeys.includes(sysTxnRowKey(t)));

    // Build flat step list: for each line pair → step 1 (stmt reconcile) + step 2 (txn update)
    const initialSteps: ProgressStep[] = [];
    for (let i = 0; i < selectedLines.length; i++) {
      const line   = selectedLines[i];
      const sysTxn = selectedTxns[i] ?? selectedTxns[0];
      const txnSide = buildTxnSideCall(sysTxn, line);
      initialSteps.push({ label: `Bank Statement Line ${line.lineId} — Reconcile`, status: 'pending' });
      initialSteps.push({ label: `${txnSide.label} ${sysTxn.txnNumber} — Update`, status: 'pending' });
    }

    setProgressSteps(initialSteps);
    setProgressDone(false);
    setProgressOpen(true);
    setReconciling(true);

    let stepIdx = 0;
    const update = (idx: number, status: ProgressStep['status']) =>
      setProgressSteps(prev => prev.map((s, i) => i === idx ? { ...s, status } : s));

    let successCount = 0;
    let errorCount   = 0;

    for (let i = 0; i < selectedLines.length; i++) {
      const line   = selectedLines[i];
      const sysTxn = selectedTxns[i] ?? selectedTxns[0];
      const txnSide = buildTxnSideCall(sysTxn, line);
      const s1 = stepIdx++;
      const s2 = stepIdx++;

      // Step 1: POST bankstatements reconcile
      update(s1, 'running');
      let stmtOk = false;
      try {
        const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${line.statementId}/reconcile`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineId: line.lineId, txnType: sysTxn.source, txnId: sysTxn.txnId, txnNumber: sysTxn.txnNumber, reconAmount: line.amount, notes: '' }),
        });
        const data = await parseApexJson(res);
        stmtOk = data.status === 'success';
        update(s1, stmtOk ? 'success' : 'error');
        if (stmtOk) successCount++; else errorCount++;
      } catch {
        update(s1, 'error');
        errorCount++;
      }

      // Step 2: PUT transaction-side update (only if step 1 succeeded)
      if (stmtOk) {
        update(s2, 'running');
        try {
          const r2   = await fetch(txnSide.url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txnSide.body) });
          const d2   = await parseApexJson(r2);
          update(s2, d2.status === 'success' || r2.ok ? 'success' : 'error');
        } catch {
          update(s2, 'error');
        }
      } else {
        update(s2, 'error');
      }
    }

    setReconciling(false);
    setProgressDone(true);

    setSelectedStmtKeys([]);
    setSelectedSysKeys([]);
    if (selectedStatement) {
      handleSelectStatement(selectedStatement);
    } else if (lastParams) {
      fetchStmtLines(lastParams, stmtReconFilter);
      fetchSysTxns(lastParams, txnSourceFilter, sysReconFilter);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStmtKeys, selectedSysKeys, stmtLines, sysTxns, txnSourceFilter, lastParams, selectedStatement, handleSelectStatement, fetchStmtLines, fetchSysTxns, msgApi]);

  // ── AI Agent: reconcile explicit pairs ───────────────────────────────────
  const handleAgentReconcile = useCallback(async (pairs: { stmtLineId: number; txnId: number }[]) => {
    const steps: ProgressStep[] = [];
    const findSysTxn = (txnId: number) =>
      sysTxns.find(t => t.txnId === txnId) ?? sysTxns.find(t => Number(t.txnNumber) === txnId);

    for (const { stmtLineId, txnId } of pairs) {
      const line   = stmtLines.find(l => l.lineId === stmtLineId);
      const sysTxn = findSysTxn(txnId);
      if (!line || !sysTxn) continue;
      const txnSide = buildTxnSideCall(sysTxn, line);
      steps.push({ label: `Stmt Line ${line.lineId} — Reconcile`, status: 'pending' });
      steps.push({ label: `${txnSide.label} ${sysTxn.txnNumber} — Update`, status: 'pending' });
    }
    setProgressSteps(steps);
    setProgressDone(false);
    setProgressOpen(true);
    let stepIdx = 0;
    const upd = (idx: number, s: ProgressStep['status']) =>
      setProgressSteps(prev => prev.map((p, i) => i === idx ? { ...p, status: s } : p));
    for (const { stmtLineId, txnId } of pairs) {
      const line   = stmtLines.find(l => l.lineId === stmtLineId);
      const sysTxn = findSysTxn(txnId);
      if (!line || !sysTxn) { stepIdx += 2; continue; }
      const txnSide = buildTxnSideCall(sysTxn, line);
      const s1 = stepIdx++;
      const s2 = stepIdx++;
      upd(s1, 'running');
      let ok = false;
      try {
        const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${line.statementId}/reconcile`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineId: line.lineId, txnType: sysTxn.source, txnId: sysTxn.txnId, txnNumber: sysTxn.txnNumber, reconAmount: line.amount, notes: 'AI Agent' }),
        });
        const data = await parseApexJson(res);
        ok = data.status === 'success';
        upd(s1, ok ? 'success' : 'error');
      } catch { upd(s1, 'error'); }
      if (ok) {
        upd(s2, 'running');
        try {
          const r2 = await fetch(txnSide.url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txnSide.body) });
          const d2 = await parseApexJson(r2);
          upd(s2, d2.status === 'success' || r2.ok ? 'success' : 'error');
        } catch { upd(s2, 'error'); }
      } else { upd(s2, 'error'); }
    }
    setProgressDone(true);
    if (selectedStatement) handleSelectStatement(selectedStatement);
    else if (lastParams) { fetchStmtLines(lastParams, stmtReconFilter); fetchSysTxns(lastParams, txnSourceFilter, sysReconFilter); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stmtLines, sysTxns, lastParams, selectedStatement, handleSelectStatement, fetchStmtLines, fetchSysTxns, stmtReconFilter]);

  // ── Reconcile API Log ────────────────────────────────────────────────────
  const buildTxnSideCall = (sysTxn: SysTxn, line: StmtLine): { url: string; body: object; label: string } => {
    const today = new Date().toISOString().slice(0, 10);
    const isBankTransfer = sysTxn.source === 'BANK_TRANSFER' || sysTxn.source === 'GL_BANK_TRANSFER';
    const isExternal     = ['ORA_MAN', 'ORA_BAT', 'ORA_STA', 'EXTERNAL_TXN'].includes(sysTxn.source);
    const isGlJournal    = sysTxn.source === 'GL_JOURNAL';

    // Path param: bank_transfer_id for BANK_TRANSFER; jeHeaderId for GL_JOURNAL; txnId for all others
    const pathId = isBankTransfer ? sysTxn.txnNumber
                 : isGlJournal    ? sysTxn.jeHeaderId
                 : sysTxn.txnId;

    return {
      url:  `${APEX_BASE}/cash/reconciliation/systxns/${pathId}`,
      body: {
        source:         sysTxn.source,
        reconciledDate: today,
        reconciledBy:   currentUser,
        statementId:    line.statementId,
        stmtLineId:     line.lineId,
        ...(isBankTransfer ? {
          transferId:   sysTxn.txnNumber,
          jeHeaderId:   sysTxn.jeHeaderId,
          jeLineNumber: sysTxn.jeLineNumber,
        } : {}),
        ...(isGlJournal ? {
          jeHeaderId:   sysTxn.jeHeaderId,
          jeLineNumber: sysTxn.jeLineNumber,
        } : {}),
        ...(sysTxn.source === 'AP_PAYMENT' ? { paymentStatus: 'CLEARED' } : {}),
      },
      label: isBankTransfer ? 'Bank Transfer' :
             isGlJournal    ? 'GL Journal' :
             sysTxn.source === 'AP_PAYMENT'  ? 'AP Payment' :
             isExternal                       ? 'External Transaction' :
             sysTxn.source === 'AR_RECEIPT'  ? 'AR Receipt' :
             sysTxn.source || 'System Txn',
    };
  };

  // ── Unreconcile a system transaction (and optionally its stmt line) ─────────
  const doUnrecon = async (sysTxn: SysTxn, alsoStmtLine: boolean, stmtLine?: StmtLine) => {
    setUnreconLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const isBankTransfer = sysTxn.source === 'BANK_TRANSFER' || sysTxn.source === 'GL_BANK_TRANSFER';
      const isGlJournal    = sysTxn.source === 'GL_JOURNAL';
      const pathId = isBankTransfer ? sysTxn.txnNumber
                   : isGlJournal    ? sysTxn.jeHeaderId
                   : sysTxn.txnId;

      const body: Record<string, any> = {
        action:         'UNRECON',
        source:         sysTxn.source,
        reconciledDate: today,
        reconciledBy:   currentUser,
        statementId:    stmtLine?.statementId ?? null,
        stmtLineId:     stmtLine?.lineId ?? null,
        ...(isBankTransfer ? { transferId: sysTxn.txnNumber, jeHeaderId: sysTxn.jeHeaderId, jeLineNumber: sysTxn.jeLineNumber } : {}),
        ...(isGlJournal    ? { jeHeaderId: sysTxn.jeHeaderId, jeLineNumber: sysTxn.jeLineNumber } : {}),
      };

      const res = await fetch(`${APEX_BASE}/cash/reconciliation/systxns/${pathId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }

      // Also unreconcile the statement line if requested
      if (alsoStmtLine && stmtLine) {
        await fetch(`${APEX_BASE}/cash/reconciliation/unreconstmtlines/${stmtLine.lineId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'UNRECON', reconciledBy: currentUser }),
        });
      }

      msgApi.success('Unreconciled successfully');
      setUnreconModal(null);
      if (lastParams) {
        fetchStmtLines(lastParams, stmtReconFilter);
        fetchSysTxns(lastParams);
      }
    } catch (e: any) {
      msgApi.error(e?.message ?? 'Unreconcile failed');
    } finally {
      setUnreconLoading(false);
    }
  };

  // ── Unreconcile a statement line only (no sys txn) ────────────────────────
  const doUnreconStmtOnly = async (line: StmtLine) => {
    setUnreconLoading(true);
    try {
      const res = await fetch(`${APEX_BASE}/cash/reconciliation/unreconstmtlines/${line.lineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UNRECON', reconciledBy: currentUser }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      msgApi.success('Statement line unreconciled');
      setUnreconModal(null);
      if (lastParams) fetchStmtLines(lastParams, stmtReconFilter);
    } catch (e: any) {
      msgApi.error(e?.message ?? 'Unreconcile failed');
    } finally {
      setUnreconLoading(false);
    }
  };

  const runAutoRecon = useCallback(async () => {
    setAutoReconRunning(true);

    const fetchSystxnsLocal = async (): Promise<SysTxn[]> => {
      if (!lastParams) return [];
      const q = new URLSearchParams();
      if (lastParams.bankAccount) q.set('bank_account', lastParams.bankAccount);
      if (lastParams.dateFrom)    q.set('date_from',    lastParams.dateFrom.format('YYYY-MM-DD'));
      if (lastParams.dateTo)      q.set('date_to',      lastParams.dateTo.format('YYYY-MM-DD'));
      q.set('reconciled', 'N');
      if (autoReconTxnType !== 'ALL' && autoReconTxnType !== 'CM') q.set('txn_type', autoReconTxnType);
      q.set('row_limit', '500');
      const res  = await fetch(`${APEX_BASE}/cash/reconciliation/systxns?${q.toString()}`);
      const data = await parseApexJson(res);
      return (data.items || []).map((i: any) => ({
        txnId:           i.txnId          ?? i.TXN_ID       ?? 0,
        txnNumber:       String(i.txnNumber ?? i.TXN_NUMBER ?? ''),
        reference:       i.reference      ?? i.REFERENCE    ?? '',
        txnDate:         i.txnDate        ?? i.TXN_DATE     ?? '',
        amount:          i.amount         ?? i.AMOUNT       ?? 0,
        source:          i.source         ?? i.txnType      ?? i.TXN_TYPE ?? '',
        payee:           i.payee          ?? i.PAYEE        ?? '',
        reconciledFlag:  i.reconciledFlag ?? 'N',
        businessUnit:    i.businessUnit   ?? '',
        bankAccountName: i.bankAccountName ?? '',
        // GL Journal / Bank Transfer — required for PUT /systxns/:id
        jeHeaderId:   i.jeHeaderId   != null ? Number(i.jeHeaderId)  : undefined,
        jeLineNumber: i.jeLineNumber  != null ? Number(i.jeLineNumber) : undefined,
        glBatchId:    i.glBatchId     != null ? Number(i.glBatchId)   : undefined,
        accountCode:  i.accountCombination ?? '',
        journalCategory: i.accountingClass ?? '',
        lineDescription: i.description    ?? '',
      } as SysTxn));
    };

    const fetchCmLocal = async (): Promise<SysTxn[]> => {
      if (!lastParams) return [];
      const q = new URLSearchParams();
      if (lastParams.bankAccount) q.set('bank_account', lastParams.bankAccount);
      if (lastParams.dateFrom)    q.set('date_from',    lastParams.dateFrom.format('YYYY-MM-DD'));
      if (lastParams.dateTo)      q.set('date_to',      lastParams.dateTo.format('YYYY-MM-DD'));
      q.set('recon_status', 'UNRECONCILED');
      q.set('row_limit', '500');
      const res  = await fetch(`${EXT_TXN_URL}?${q.toString()}`);
      const data = await parseApexJson(res);
      const items = Array.isArray(data) ? data : (data.items ?? []);
      return items.map((i: any) => ({
        txnId:        i.externalTransactionId ?? 0,
        txnNumber:    String(i.externalTransactionId ?? ''),
        reference:    i.referenceText ?? i.description ?? '',
        txnDate:      i.transactionDate ?? '',
        amount:       i.amount          ?? 0,
        source:       'ORA_MAN',
        payee:        i.description     ?? '',
        reconciledFlag: i.reconciledFlag ?? i.RECONCILED_FLAG ?? 'N',
        businessUnit:   i.businessUnitName ?? '',
        bankAccountName: i.bankAccountName ?? '',
      } as SysTxn));
    };

    let pool: SysTxn[] = [];
    try {
      if (autoReconTxnType === 'CM') {
        pool = await fetchCmLocal();
      } else if (autoReconTxnType === 'ALL') {
        const [regular, cm] = await Promise.all([fetchSystxnsLocal(), fetchCmLocal()]);
        pool = [...regular, ...cm];
      } else {
        pool = await fetchSystxnsLocal();
      }
    } catch { pool = sysTxns; }

    const unmatchedSys  = pool.filter(t => !t.reconciledFlag || t.reconciledFlag === 'N');
    const unmatchedStmt = stmtLines.filter(l => l.reconStatus !== 'RECONCILED' && !l.externalTxnId);
    const usedSysKeys   = new Set<string>();
    const matches: AutoReconMatch[] = [];

    // New approach: Match by ABSOLUTE amount first, group by amount
    const stmtByAbsAmount = new Map<number, StmtLine[]>();
    const sysByAbsAmount = new Map<number, SysTxn[]>();

    for (const stmt of unmatchedStmt) {
      const absAmt = Math.abs(stmt.amount);
      if (!stmtByAbsAmount.has(absAmt)) stmtByAbsAmount.set(absAmt, []);
      stmtByAbsAmount.get(absAmt)!.push(stmt);
    }

    for (const sys of unmatchedSys) {
      const absAmt = Math.abs(sys.amount);
      if (!sysByAbsAmount.has(absAmt)) sysByAbsAmount.set(absAmt, []);
      sysByAbsAmount.get(absAmt)!.push(sys);
    }

    // Auto-match amounts that exist on both sides
    for (const [absAmount, stmts] of stmtByAbsAmount) {
      const sysTxns = sysByAbsAmount.get(absAmount) || [];
      const minCount = Math.min(stmts.length, sysTxns.length);

      for (let i = 0; i < minCount; i++) {
        const stmt = stmts[i];
        const sys = sysTxns[i];
        if (!usedSysKeys.has(sysTxnRowKey(sys))) {
          matches.push({
            stmtLine: stmt,
            sysTxn: sys,
            matchedBy: ['Amount'],
            confirmed: true,
            status: 'pending'
          });
          usedSysKeys.add(sysTxnRowKey(sys));
        }
      }
    }

    setAutoReconMatches(matches);
    setAutoReconStep('results');
    setAutoReconRunning(false);
  }, [stmtLines, sysTxns, autoReconCriteria, autoReconTxnType, lastParams, fetchSysTxns, txnSourceFilter]);

  const executeAutoRecon = useCallback(async () => {
    const confirmed = autoReconMatches.filter(m => m.confirmed);
    if (confirmed.length === 0) return;
    setAutoReconRunning(true);
    const today = new Date().toISOString().slice(0, 10);
    const updated = [...autoReconMatches];

    for (let i = 0; i < updated.length; i++) {
      const m = updated[i];
      if (!m.confirmed) continue;
      try {
        // Step 1: POST stmt line reconcile
        const stmtBody = {
          lineId:      m.stmtLine.lineId,
          txnType:     m.sysTxn.source,
          txnId:       m.sysTxn.txnId,
          txnNumber:   m.sysTxn.txnNumber,
          reconAmount: m.stmtLine.amount,
          notes:       'Auto Reconciled',
        };
        const res = await fetch(
          `${APEX_BASE}/cash/bankstatements/${m.stmtLine.statementId}/reconcile`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stmtBody) }
        );
        const data = await parseApexJson(res);
        if (data.status !== 'success') throw new Error(data.message || 'Reconcile failed');

        // Step 2: PUT txn side
        const txnSide = buildTxnSideCall(m.sysTxn, m.stmtLine);
        await fetch(txnSide.url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txnSide.body) });

        updated[i] = { ...m, status: 'success' };
      } catch (err: any) {
        updated[i] = { ...m, status: 'error', errorMsg: err.message || 'Failed' };
      }
      setAutoReconMatches([...updated]);
    }

    setAutoReconRunning(false);
    const success = updated.filter(m => m.status === 'success').length;
    const errors  = updated.filter(m => m.status === 'error').length;
    if (success > 0) msgApi.success(`Auto-reconciled ${success} pair(s)`);
    if (errors  > 0) msgApi.error(`${errors} pair(s) failed`);
    if (success > 0) {
      if (selectedStatement) handleSelectStatement(selectedStatement);
      else if (lastParams) { fetchStmtLines(lastParams, stmtReconFilter); fetchSysTxns(lastParams, txnSourceFilter, sysReconFilter); }
    }
  }, [autoReconMatches, buildTxnSideCall, selectedStatement, lastParams, handleSelectStatement, fetchStmtLines, fetchSysTxns, stmtReconFilter, txnSourceFilter, cmReconFilter, msgApi]);

  const openReconLog = useCallback(() => {
    const visibleSysTxns = txnSourceFilter === 'ALL' ? sysTxns : sysTxns.filter((t) => t.source === txnSourceFilter);
    const selectedLines = stmtLines.filter((l) => selectedStmtKeys.includes(l.lineId));
    const selectedTxns  = visibleSysTxns.filter((t) => selectedSysKeys.includes(sysTxnRowKey(t)));
    const calls: ReconCall[] = selectedLines.map((line, i) => {
      const sysTxn = selectedTxns[i] ?? selectedTxns[0];
      const txnSide = buildTxnSideCall(sysTxn, line);
      return {
        lineId:      line.lineId,
        statementId: line.statementId,
        txnId:       sysTxn.txnId,
        txnType:     sysTxn.source,
        txnNumber:   sysTxn.txnNumber,
        reconAmount: line.amount,
        status:      'pending' as const,
        txnUrl:      txnSide.url,
        txnBody:     txnSide.body,
        txnLabel:    txnSide.label,
        txnStatus:   'pending' as const,
      };
    });
    setReconCalls(calls);
    setReconLogOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnSourceFilter, sysTxns, stmtLines, selectedStmtKeys, selectedSysKeys]);

  const executeReconCall = useCallback(async (idx: number) => {
    const call = reconCalls[idx];
    if (!call) return;
    // Step 1: POST bankstatements reconcile
    setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, status: 'running' } : c));
    const body = { lineId: call.lineId, txnType: call.txnType, txnId: call.txnId, txnNumber: call.txnNumber, reconAmount: call.reconAmount, notes: '' };
    try {
      const res  = await fetch(`${APEX_BASE}/cash/bankstatements/${call.statementId}/reconcile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await parseApexJson(res);
      const stmtOk = data.status === 'success';
      setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, status: stmtOk ? 'success' : 'error', response: JSON.stringify(data, null, 2) } : c));
      // Step 2: PUT transaction-side update (only if step 1 succeeded)
      if (stmtOk) {
        setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, txnStatus: 'running' } : c));
        try {
          const r2   = await fetch(call.txnUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call.txnBody) });
          const d2   = await parseApexJson(r2);
          setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, txnStatus: d2.status === 'success' || r2.ok ? 'success' : 'error', txnResponse: JSON.stringify(d2, null, 2) } : c));
        } catch (err2: any) {
          setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, txnStatus: 'error', txnResponse: String(err2) } : c));
        }
      }
    } catch (err: any) {
      setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, status: 'error', response: String(err) } : c));
    }
  }, [reconCalls]);

  const executeTxnCall = useCallback(async (idx: number) => {
    const call = reconCalls[idx];
    if (!call) return;
    setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, txnStatus: 'running' } : c));
    try {
      const r   = await fetch(call.txnUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call.txnBody) });
      const d   = await parseApexJson(r);
      setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, txnStatus: d.status === 'success' || r.ok ? 'success' : 'error', txnResponse: JSON.stringify(d, null, 2) } : c));
    } catch (err: any) {
      setReconCalls(prev => prev.map((c, i) => i === idx ? { ...c, txnStatus: 'error', txnResponse: String(err) } : c));
    }
  }, [reconCalls]);

  const executeAllReconCalls = useCallback(async () => {
    for (let i = 0; i < reconCalls.length; i++) {
      if (reconCalls[i].status === 'pending') await executeReconCall(i);
    }
    const allDone = reconCalls.every(c => c.status === 'success' || c.status === 'error');
    if (allDone) {
      setSelectedStmtKeys([]); setSelectedSysKeys([]);
      if (selectedStatement) handleSelectStatement(selectedStatement);
      else if (lastParams) { fetchStmtLines(lastParams, stmtReconFilter); fetchSysTxns(lastParams, txnSourceFilter, sysReconFilter); }
    }
  }, [reconCalls, executeReconCall, selectedStatement, lastParams, handleSelectStatement, fetchStmtLines, fetchSysTxns, stmtReconFilter]);

  // ── Create Accounting for ext txn from bank recon modal ──────────────────
  const createExtTxnAccounting = useCallback(async () => {
    if (!extTxnCreatedId) return;
    const values = extTxnForm.getFieldsValue();
    setExtAcctRunning(true);
    setExtAcctResult(null);
    try {
      const ledger = await fetchLedgerByBusinessUnit(values.businessUnitName);
      if (!ledger) { setExtAcctResult({ ok: false, msg: 'Could not resolve ledger for BU' }); setExtAcctRunning(false); return; }

      const absAmount  = Math.abs(values.amount ?? 0);
      const direction  = values.transactionDirection ?? extTxnDirection;
      const txnDate    = values.transactionDate?.format('YYYY-MM-DD') ?? new Date().toISOString().slice(0, 10);
      const periodName = derivePeriodName(new Date(txnDate));

      // CR = money in: DR bank asset / CR offset. DR = money out: DR offset / CR bank asset
      const drAcct = direction === 'CR' ? values.assetAccountCombination : values.offsetAccountCombination;
      const crAcct = direction === 'CR' ? values.offsetAccountCombination : values.assetAccountCombination;

      const slaPayload = buildPcBankTxnSlaPayload({
        externalTransactionId:    extTxnCreatedId,
        referenceText:            values.referenceText || String(extTxnCreatedId),
        transactionDate:          txnDate,
        accountingDate:           txnDate,
        periodName,
        currency:                 values.currencyCode || 'AED',
        amount:                   absAmount,
        assetAccountCombination:  crAcct,   // buildPcBankTxnSlaPayload: assetAccount = CR line
        offsetAccountCombination: drAcct,   // offsetAccount = DR line
        businessUnit:             values.businessUnitName,
        ledgerId:                 ledger.ledgerId,
        ledgerName:               ledger.ledgerName,
        createdBy:                'SYSTEM',
      });

      const slaResult = await createAccounting(slaPayload);
      if (!slaResult?.headerId) { setExtAcctResult({ ok: false, msg: 'SLA creation failed' }); setExtAcctRunning(false); return; }

      // 2. Create GL journal
      const batchName = `BANK-${extTxnCreatedId}-${Date.now()}`;
      const glPayload = {
        batch: {
          batchName,
          batchDescription: `Bank External Txn ${extTxnCreatedId}`,
          ledgerName: ledger.ledgerName,
          ledgerId:   ledger.ledgerId,
          status:     'NEW',
          accountingPeriod:  periodName,
          controlTotal:      absAmount,
          runningTotalDr:    absAmount,
          runningTotalCr:    absAmount,
          batchSource:  'Cash Management',
          createdBy:    'SYSTEM',
        },
        header: {
          ledgerId:    ledger.ledgerId,
          ledgerName:  ledger.ledgerName,
          jeCategory:  'Cash Management',
          jeSource:    'Cash Management',
          periodName,
          journalName: `BANK-EXT-${extTxnCreatedId}`,
          description: `Bank Ext Txn – ${values.referenceText || extTxnCreatedId}`,
          currencyCode:             values.currencyCode || 'AED',
          currencyConversionType:   'User',
          currencyConversionDate:   txnDate,
          currencyConversionRate:   1,
          defaultEffectiveDate:     txnDate,
          status:          'NEW',
          runningTotalDr:  absAmount,
          runningTotalCr:  absAmount,
          createdBy:       'SYSTEM',
        },
        lines: slaPayload.lines.map(l => ({
          enteredDr:   l.lineType === 'DR' ? l.enteredDr  : null,
          enteredCr:   l.lineType === 'CR' ? l.enteredCr  : null,
          accountedDr: l.accountedDr || null,
          accountedCr: l.accountedCr || null,
          statAmount:  null,
          description: l.description,
          currencyCode:               values.currencyCode || 'AED',
          currencyConversionDate:     txnDate,
          currencyConversionRate:     1,
          userCurrencyConversionType: 'User',
          accountCombination:         l.accountCombination,
          chartOfAccountsName:        'Chart of Accounts',
          reference1: String(extTxnCreatedId),
          reference2: values.referenceText || '',
          reference3: l.accountingClass || null,
          reference4: values.businessUnitName || null,
          reference5: null,
          createdBy:  'SYSTEM',
        })),
      };

      const glRes = await fetch(`${APEX_BASE}/journals/create`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(glPayload),
      });

      let glMsg = '';
      if (glRes.ok) {
        const glData = await glRes.json();
        // 3. Post SLA — link to GL batch/header
        await fetch(`${APEX_BASE}/sla/accounting/post`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    JSON.stringify({
            headerId:    slaResult.headerId,
            glBatchId:   glData.batchId  || 0,
            glBatchName: batchName,
            glHeaderId:  glData.headerId || 0,
            postedBy:    'SYSTEM',
          }),
        });
        glMsg = `GL: ${batchName}`;
      } else {
        glMsg = 'GL journal failed — SLA is Draft';
      }

      // 4. Mark accounting flag on the external transaction
      const flagUrl = `${EXT_TXN_URL}/${extTxnCreatedId}/acctflag?updated_by=SYSTEM`;
      await fetch(flagUrl, { method: 'PUT', headers: { Accept: 'application/json' } }).catch(() => {});

      setExtAcctResult({ ok: true, msg: `Accounting created — SLA Header ${slaResult.headerId} — ${glMsg}` });
    } catch (err: any) {
      setExtAcctResult({ ok: false, msg: err?.message || 'Accounting failed' });
    } finally {
      setExtAcctRunning(false);
    }
  }, [extTxnCreatedId, extTxnForm]);

  // ── Column definitions ────────────────────────────────────────────────────
  const stmtColumns: ColumnsType<StmtLine> = [
    {
      title: 'Reference',
      dataIndex: 'reference',
      key: 'reference',
      width: 180,
      ellipsis: true,
      render: (v: string, r) => (
        <Tooltip title={r.bankTxnReference || v}>
          <span>{v || r.bankTxnReference || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'transactionDate',
      key: 'transactionDate',
      width: 120,
      sorter: (a: StmtLine, b: StmtLine) => (a.transactionDate || '').localeCompare(b.transactionDate || ''),
      render: (v: string) => fmtDate(v),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 110,
      align: 'right',
      sorter: (a: StmtLine, b: StmtLine) => (a.amount || 0) - (b.amount || 0),
      render: (v: number, r) => (
        <span
          style={{
            color:      r.transactionCode === 'CR' ? REDWOOD.success : REDWOOD.error,
            fontWeight: 500,
          }}
        >
          {fmtAmount(v)}
        </span>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'transactionCode',
      key: 'transactionCode',
      width: 60,
      render: (v: string) => (
        <Tag color={v === 'CR' ? 'green' : 'red'} style={{ margin: 0 }}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'reconStatus',
      key: 'reconStatus',
      width: 90,
      render: (v: string) => {
        if (v === 'RECONCILED')          return <Tag color="green"  style={{ fontSize: 10, margin: 0 }}>Reconciled</Tag>;
        if (v === 'PARTIALLY_RECONCILED') return <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>Partial</Tag>;
        return <Tag color="default" style={{ fontSize: 10, margin: 0 }}>Unrecon</Tag>;
      },
    },
    {
      title: 'Statement #',
      dataIndex: 'statementNumber',
      key: 'statementNumber',
      width: 110,
      ellipsis: true,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span>{v || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Ext Txn',
      key: 'extTxn',
      width: 90,
      render: (_: any, r: StmtLine) => r.externalTxnId
        ? <Tooltip title={`Ref: ${r.externalTxnRef || ''}`}><Tag color="purple" style={{ fontSize: 10, margin: 0 }}>#{r.externalTxnId}</Tag></Tooltip>
        : null,
    },
    {
      title: 'Stmt ID',
      dataIndex: 'statementId',
      key: 'statementId',
      width: 70,
      render: (v: number) => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{v}</Text>,
    },
    {
      title: 'Line ID',
      dataIndex: 'lineId',
      key: 'lineId',
      width: 70,
      render: (v: number) => <Text style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{v}</Text>,
    },
    {
      title: '',
      key: 'unrecon',
      width: 40,
      render: (_: any, r: StmtLine) => r.reconStatus === 'RECONCILED' ? (
        <Tooltip title="Unreconcile this statement line">
          <Button type="text" size="small" danger
            icon={<UndoOutlined />}
            onClick={() => setUnreconModal({ type: 'STMT', stmtLine: r })}
          />
        </Tooltip>
      ) : null,
    },
  ];

  const SOURCE_COLORS: Record<string, string> = {
    AP_PAYMENT:   'geekblue',
    AR_RECEIPT:   'green',
    GL_JOURNAL:   'purple',
    BANK_TRANSFER: 'volcano',
    EXTERNAL_TXN:  'orange',
  };

  const colTxnNumber: ColumnsType<SysTxn>[number] = {
    title: 'Txn #',
    dataIndex: 'txnNumber',
    key: 'txnNumber',
    width: 180,
    ellipsis: true,
  };
  const colDate: ColumnsType<SysTxn>[number] = {
    title: 'Date',
    dataIndex: 'txnDate',
    key: 'txnDate',
    width: 100,
    sorter: (a: SysTxn, b: SysTxn) => (a.txnDate || '').localeCompare(b.txnDate || ''),
    render: (v: string) => fmtDate(v),
  };
  const colAmount: ColumnsType<SysTxn>[number] = {
    title: 'Amount',
    dataIndex: 'amount',
    key: 'amount',
    width: 110,
    align: 'right',
    sorter: (a: SysTxn, b: SysTxn) => (a.amount || 0) - (b.amount || 0),
    render: (v: number) => <span style={{ fontWeight: 500 }}>{fmtAmount(v)}</span>,
  };
  const colCurrency: ColumnsType<SysTxn>[number] = {
    title: 'CCY',
    dataIndex: 'currencyCode',
    key: 'currencyCode',
    width: 55,
    render: (v: string) => v || '—',
  };
  const colBU: ColumnsType<SysTxn>[number] = {
    title: 'Business Unit',
    dataIndex: 'businessUnit',
    key: 'businessUnit',
    width: 120,
    ellipsis: true,
    render: (v: string) => v || '—',
  };
  const colStatus: ColumnsType<SysTxn>[number] = {
    title: 'Status',
    key: 'reconStatus',
    width: 100,
    render: (_: unknown, r: SysTxn) => {
      const isRecon = r.reconciledFlag === 'Y';
      return (
        <Tooltip title={r.txnStatus || undefined}>
          <Tag color={isRecon ? 'green' : 'orange'} style={{ margin: 0, fontSize: 10 }}>
            {isRecon ? 'Reconciled' : 'Unreconciled'}
          </Tag>
        </Tooltip>
      );
    },
  };

  const colUnrecon: ColumnsType<SysTxn>[number] = {
    title: '',
    key: 'unrecon',
    width: 40,
    render: (_: any, r: SysTxn) => r.reconciledFlag === 'Y' ? (
      <Tooltip title="Unreconcile this transaction">
        <Button type="text" size="small" danger
          icon={<UndoOutlined />}
          onClick={() => setUnreconModal({ type: 'SYS', sysTxn: r })}
        />
      </Tooltip>
    ) : null,
  };

  const sysColumnsAP: ColumnsType<SysTxn> = [
    colTxnNumber,
    colDate,
    colAmount,
    colCurrency,
    {
      title: 'Supplier / Payee',
      dataIndex: 'payee',
      key: 'payee',
      ellipsis: true,
      render: (v: string, r) => (
        <Tooltip title={r.supplierNumber ? `${v} (${r.supplierNumber})` : v}>
          <span>{v || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Payment Method',
      dataIndex: 'paymentMethod',
      key: 'paymentMethod',
      width: 130,
      render: (v: string) => v || '—',
    },
    {
      title: 'Clearing Date',
      dataIndex: 'clearingDate',
      key: 'clearingDate',
      width: 110,
      render: (v: string) => fmtDate(v),
    },
    {
      title: 'TRX ID',
      dataIndex: 'txnId',
      key: 'txnId',
      width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: 'Account St',
      key: 'acctStatus',
      width: 90,
      render: (_: unknown, r: SysTxn) => {
        const isAccounted = glJournalStatus[r.txnId];
        const icon = isAccounted === undefined ? '—' : isAccounted ? <CheckCircleOutlined style={{ color: '#52c41a', cursor: 'pointer' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />;
        return (
          <span onClick={() => handleOpenGlCheckModal(r)} style={{ cursor: 'pointer' }}>
            {icon}
          </span>
        );
      },
    },
    colStatus,
    colBU,
    colUnrecon,
  ];

  const sysColumnsAR: ColumnsType<SysTxn> = [
    colTxnNumber,
    colDate,
    colAmount,
    colCurrency,
    {
      title: 'Customer',
      dataIndex: 'customerName',
      key: 'customerName',
      ellipsis: true,
      render: (v: string, r) => (
        <Tooltip title={r.customerNumber ? `${v} (${r.customerNumber})` : v}>
          <span>{v || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Receipt Method',
      dataIndex: 'receiptMethod',
      key: 'receiptMethod',
      width: 130,
      render: (v: string) => v || '—',
    },
    {
      title: 'TRX ID',
      dataIndex: 'txnId',
      key: 'txnId',
      width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: 'Account St',
      key: 'acctStatus',
      width: 90,
      render: (_: unknown, r: SysTxn) => {
        const isAccounted = glJournalStatus[r.txnId];
        const icon = isAccounted === undefined ? '—' : isAccounted ? <CheckCircleOutlined style={{ color: '#52c41a', cursor: 'pointer' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />;
        return (
          <span onClick={() => handleOpenGlCheckModal(r)} style={{ cursor: 'pointer' }}>
            {icon}
          </span>
        );
      },
    },
    colStatus,
    colBU,
    colUnrecon,
  ];

  const sysColumnsGL: ColumnsType<SysTxn> = [
    colTxnNumber,
    colDate,
    colAmount,
    colCurrency,
    {
      title: 'Account',
      dataIndex: 'accountCode',
      key: 'accountCode',
      width: 140,
      ellipsis: true,
      render: (v: string, r) => (
        <Tooltip title={r.accountDescription || v}>
          <span>{v || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'journalCategory',
      key: 'journalCategory',
      width: 110,
      render: (v: string) => v || '—',
    },
    {
      title: 'Description',
      dataIndex: 'lineDescription',
      key: 'lineDescription',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span>{v || '—'}</span>
        </Tooltip>
      ),
    },
    colBU,
    {
      title: 'GL Batch',
      key: 'glBatchId',
      width: 90,
      render: (_: unknown, r: SysTxn) =>
        r.glBatchId ? (
          <Tooltip title={`GL Batch ID: ${r.glBatchId} — click to open journal`}>
            <a
              href={`#/gl/journals?batchId=${r.glBatchId}`}
              onClick={e => { e.preventDefault(); window.location.hash = `/gl/journals?batchId=${r.glBatchId}`; }}
              style={{ fontSize: 11, color: '#722ed1', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              <LinkOutlined style={{ fontSize: 12 }} />
              {r.glBatchId}
            </a>
          </Tooltip>
        ) : <span style={{ color: '#bbb', fontSize: 11 }}>—</span>,
    },
    {
      title: 'TRX ID',
      dataIndex: 'txnId',
      key: 'txnId',
      width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: 'Account St',
      key: 'acctStatus',
      width: 90,
      render: (_: unknown, r: SysTxn) => {
        const isAccounted = glJournalStatus[r.txnId];
        const icon = isAccounted === undefined ? '—' : isAccounted ? <CheckCircleOutlined style={{ color: '#52c41a', cursor: 'pointer' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />;
        return (
          <span onClick={() => handleOpenGlCheckModal(r)} style={{ cursor: 'pointer' }}>
            {icon}
          </span>
        );
      },
    },
    colUnrecon,
  ];

  const sysColumnsBankTransfer: ColumnsType<SysTxn> = [
    colTxnNumber,
    colDate,
    colAmount,
    colCurrency,
    {
      title: 'Bank Account',
      dataIndex: 'bankAccountName',
      key: 'bankAccountName',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span>{v || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Method / Category',
      key: 'method',
      width: 130,
      ellipsis: true,
      render: (_: unknown, r: SysTxn) =>
        r.paymentMethod || r.receiptMethod || r.journalCategory || '—',
    },
    {
      title: 'TRX ID',
      dataIndex: 'txnId',
      key: 'txnId',
      width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: 'Account St',
      key: 'acctStatus',
      width: 90,
      render: (_: unknown, r: SysTxn) => {
        const isAccounted = glJournalStatus[r.txnId];
        const icon = isAccounted === undefined ? '—' : isAccounted ? <CheckCircleOutlined style={{ color: '#52c41a', cursor: 'pointer' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />;
        return (
          <span onClick={() => handleOpenGlCheckModal(r)} style={{ cursor: 'pointer' }}>
            {icon}
          </span>
        );
      },
    },
    colStatus,
    colBU,
    colUnrecon,
  ];

  const sysColumnsAll: ColumnsType<SysTxn> = [
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 105,
      render: (v: string) => (
        <Tag color={SOURCE_COLORS[v] ?? 'default'} style={{ margin: 0, fontSize: 11 }}>
          {v === 'AP_PAYMENT' ? 'AP Payment' : v === 'EXTERNAL_TXN' ? 'External Txn' : v === 'BANK_TRANSFER' ? 'Bank Transfer' : v === 'GL_JOURNAL' ? 'GL Journal' : v}
        </Tag>
      ),
    },
    colTxnNumber,
    colDate,
    colAmount,
    colCurrency,
    {
      title: 'Party / Account',
      key: 'party',
      ellipsis: true,
      render: (_: unknown, r: SysTxn) => {
        const val = r.bankAccountName || r.payee || r.customerName || r.accountCode || '—';
        const sub = r.supplierNumber || r.customerNumber || r.accountDescription || r.lineDescription;
        return (
          <Tooltip title={sub ? `${val} (${sub})` : val}>
            <span>{val}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Method / Category',
      key: 'method',
      width: 130,
      ellipsis: true,
      render: (_: unknown, r: SysTxn) =>
        r.paymentMethod || r.receiptMethod || r.journalCategory || '—',
    },
    {
      title: 'TRX ID',
      dataIndex: 'txnId',
      key: 'txnId',
      width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: 'Account St',
      key: 'acctStatus',
      width: 90,
      render: (_: unknown, r: SysTxn) => {
        const isAccounted = glJournalStatus[r.txnId];
        const icon = isAccounted === undefined ? '—' : isAccounted ? <CheckCircleOutlined style={{ color: '#52c41a', cursor: 'pointer' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />;
        return (
          <span onClick={() => handleOpenGlCheckModal(r)} style={{ cursor: 'pointer' }}>
            {icon}
          </span>
        );
      },
    },
    colStatus,
    colBU,
    colUnrecon,
  ];

  const sysColumnsCM: ColumnsType<SysTxn> = [
    { title: 'Date', dataIndex: 'txnDate', key: 'date', width: 90, sorter: (a: SysTxn, b: SysTxn) => (a.txnDate || '').localeCompare(b.txnDate || ''), render: fmtDate },
    { title: 'Ext Txn ID',  dataIndex: 'txnNumber', key: 'ref',    width: 100, render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v}</Text> },
    { title: 'Amount',      dataIndex: 'amount',    key: 'amt',    width: 100, align: 'right' as const, render: (v: number, r: SysTxn) => <Text style={{ fontSize: 11, color: REDWOOD.info }}>{fmtAmount(v, r.currencyCode)}</Text> },
    { title: 'BU',          dataIndex: 'businessUnit', key: 'bu',  width: 130, render: (v: string) => <Text style={{ fontSize: 10 }}>{v || '—'}</Text> },
    { title: 'Description', dataIndex: 'payee',     key: 'desc',   width: 160, render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 11 }} ellipsis>{v || '—'}</Text></Tooltip> },
    { title: 'Asset Acct',  dataIndex: 'assetAccountCombination',  key: 'asset',  width: 160, render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 10, fontFamily: 'monospace' }} ellipsis>{v || '—'}</Text></Tooltip> },
    { title: 'Offset Acct', dataIndex: 'offsetAccountCombination', key: 'offset', width: 160, render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 10, fontFamily: 'monospace' }} ellipsis>{v || '—'}</Text></Tooltip> },
    {
      title: 'TRX ID',
      dataIndex: 'txnId',
      key: 'txnId',
      width: 120,
      render: (v: string) => <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: 'Account St',
      key: 'acctStatus',
      width: 90,
      render: (_: unknown, r: SysTxn) => {
        const isAccounted = glJournalStatus[r.txnId];
        const icon = isAccounted === undefined ? '—' : isAccounted ? <CheckCircleOutlined style={{ color: '#52c41a', cursor: 'pointer' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />;
        return (
          <span onClick={() => handleOpenGlCheckModal(r)} style={{ cursor: 'pointer' }}>
            {icon}
          </span>
        );
      },
    },
    { title: 'Recon',       dataIndex: 'reconciledFlag', key: 'recon', width: 70,
      render: (v: string) => <Tag color={v === 'Y' ? 'green' : 'default'} style={{ fontSize: 10 }}>{v === 'Y' ? 'Recon' : 'Unrecon'}</Tag> },
    colUnrecon,
  ];

  const sysColumns =
    txnSourceFilter === 'AP_PAYMENT'    ? sysColumnsAP :
    txnSourceFilter === 'EXTERNAL_TXN'  ? sysColumnsCM :
    txnSourceFilter === 'GL_JOURNAL'    ? sysColumnsGL :
    txnSourceFilter === 'BANK_TRANSFER' ? sysColumnsBankTransfer :
    sysColumnsAll;

  const filteredSysTxnsBase = (() => {
    const base = txnSourceFilter === 'ALL' ? sysTxns : sysTxns.filter((t) => t.source === txnSourceFilter);
    return base;
  })();

  const sysQ = sysSearch.toLowerCase();
  const filteredSysTxns = sysQ
    ? filteredSysTxnsBase.filter(t =>
        (t.txnNumber            || '').toLowerCase().includes(sysQ) ||
        (t.reference            || '').toLowerCase().includes(sysQ) ||
        (t.txnDate              || '').toLowerCase().includes(sysQ) ||
        (t.amount != null && String(t.amount).includes(sysQ))       ||
        (t.currencyCode         || '').toLowerCase().includes(sysQ) ||
        (t.txnStatus            || '').toLowerCase().includes(sysQ) ||
        (t.source               || '').toLowerCase().includes(sysQ) ||
        (t.businessUnit         || '').toLowerCase().includes(sysQ) ||
        (t.bankAccountName      || '').toLowerCase().includes(sysQ) ||
        // AP Payment
        (t.payee                || '').toLowerCase().includes(sysQ) ||
        (t.supplierNumber       || '').toLowerCase().includes(sysQ) ||
        (t.paymentMethod        || '').toLowerCase().includes(sysQ) ||
        (t.paymentType          || '').toLowerCase().includes(sysQ) ||
        (t.clearingDate         || '').toLowerCase().includes(sysQ) ||
        // AR Receipt
        (t.customerName         || '').toLowerCase().includes(sysQ) ||
        (t.customerNumber       || '').toLowerCase().includes(sysQ) ||
        (t.receiptMethod        || '').toLowerCase().includes(sysQ) ||
        // GL Journal
        (t.accountCode          || '').toLowerCase().includes(sysQ) ||
        (t.accountDescription   || '').toLowerCase().includes(sysQ) ||
        (t.journalCategory      || '').toLowerCase().includes(sysQ) ||
        (t.lineDescription      || '').toLowerCase().includes(sysQ) ||
        // External / CM
        (t.assetAccountCombination  || '').toLowerCase().includes(sysQ) ||
        (t.offsetAccountCombination || '').toLowerCase().includes(sysQ) ||
        (t.createdBy            || '').toLowerCase().includes(sysQ)
      )
    : filteredSysTxnsBase;

  const stmtQ = stmtSearch.toLowerCase();
  const filteredStmtLines = (() => {
    let base = stmtLines;
    if (stmtReconFilter === 'RECONCILED')   base = base.filter(l => l.reconStatus === 'RECONCILED');
    if (stmtReconFilter === 'UNRECONCILED') base = base.filter(l => l.reconStatus !== 'RECONCILED');
    if (!stmtQ) return base;
    return base.filter(l =>
      (l.transactionDate    || '').toLowerCase().includes(stmtQ) ||
      (l.valueDate          || '').toLowerCase().includes(stmtQ) ||
      (l.amount != null && String(l.amount).includes(stmtQ))     ||
      (l.transactionCode    || '').toLowerCase().includes(stmtQ) ||
      (l.description        || '').toLowerCase().includes(stmtQ) ||
      (l.reference          || '').toLowerCase().includes(stmtQ) ||
      (l.bankTxnReference   || '').toLowerCase().includes(stmtQ) ||
      (l.counterpartyName   || '').toLowerCase().includes(stmtQ) ||
      (l.reconStatus        || '').toLowerCase().includes(stmtQ) ||
      (l.reconTxnType       || '').toLowerCase().includes(stmtQ) ||
      (l.reconTxnNumber     || '').toLowerCase().includes(stmtQ) ||
      (l.reconNotes         || '').toLowerCase().includes(stmtQ) ||
      (l.reconDate          || '').toLowerCase().includes(stmtQ) ||
      (l.bankAccountName    || '').toLowerCase().includes(stmtQ) ||
      (l.currencyCode       || '').toLowerCase().includes(stmtQ) ||
      (l.statementNumber    || '').toLowerCase().includes(stmtQ) ||
      (l.externalTxnRef     || '').toLowerCase().includes(stmtQ)
    );
  })();

  // Keep `difference` state in sync with current selections
  const _stmtSel = sumSelected(stmtLines, selectedStmtKeys);
  const _sysSel  = sumSelected(filteredSysTxns, selectedSysKeys);
  useEffect(() => {
    setDifference(_stmtSel - _sysSel);
  }, [_stmtSel, _sysSel]);

  const stmtSelectedAmount = _stmtSel;
  const sysSelectedAmount  = _sysSel;

  const exportToExcel = useCallback(async () => {
    if (!lastParams) { msgApi.warning('Run a search first before exporting'); return; }
    setExporting(true);
    try {
      const wb   = XLSX.utils.book_new();
      const date = new Date().toISOString().slice(0, 10);

      // ── Sheet 1: ALL Bank Statement Lines (recon + unrecon) ──────────
      const qAll = new URLSearchParams();
      if (lastParams.bankAccount) qAll.set('bank_account', lastParams.bankAccount);
      if (lastParams.dateFrom)    qAll.set('date_from',    lastParams.dateFrom.format('YYYY-MM-DD'));
      if (lastParams.dateTo)      qAll.set('date_to',      lastParams.dateTo.format('YYYY-MM-DD'));
      if (lastParams.statementId) qAll.set('statement_id', lastParams.statementId);
      qAll.set('row_limit', '5000');
      const allStmt: StmtLine[] = await fetch(`${APEX_BASE}/cash/reconciliation/stmtlines?${qAll}`)
        .then(r => r.json()).then(d => d.items ?? []).catch(() => stmtLines);

      const stmtRows = allStmt.map(l => ({
        'Line ID':        l.lineId,
        'Statement No.':  l.statementNumber,
        'Date':           l.transactionDate,
        'Dr/Cr':          l.transactionCode,
        'Amount':         l.amount,
        'Currency':       l.currencyCode,
        'Description':    l.description,
        'Reference':      l.reference,
        'Bank Txn Ref':   l.bankTxnReference,
        'Counterparty':   l.counterpartyName,
        'Recon Status':   l.reconStatus,
        'Recon Txn No.':  l.reconTxnNumber,
        'Recon Date':     l.reconDate,
        'Ext Txn ID':     l.externalTxnId,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stmtRows), 'Bank Statement Lines');

      // ── Sheet 2: System Transactions ─────────────────────────────────
      const sysRows = filteredSysTxns.map(t => ({
        'Txn ID':         t.txnId,
        'Txn Number':     t.txnNumber,
        'Date':           t.txnDate,
        'Source':         t.source,
        'Amount':         t.amount,
        'Currency':       t.currencyCode,
        'Payee':          t.payee,
        'Reference':      t.reference,
        'Business Unit':  t.businessUnit,
        'Status':         t.txnStatus,
        'Recon Flag':     t.reconciledFlag,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sysRows), 'System Transactions');

      // ── Sheet 3: Matched / Reconciled Pairs ──────────────────────────
      const qRec = new URLSearchParams(qAll);
      qRec.set('recon_status', 'RECONCILED');
      qRec.set('row_limit', '5000');
      const reconStmt: StmtLine[] = await fetch(`${APEX_BASE}/cash/reconciliation/stmtlines?${qRec}`)
        .then(r => r.json()).then(d => d.items ?? []).catch(() => []);

      const reconRows = reconStmt.map(l => ({
        // Bank side
        'Bank Line ID':     l.lineId,
        'Bank Stmt No.':    l.statementNumber,
        'Bank Date':        l.transactionDate,
        'Bank Dr/Cr':       l.transactionCode,
        'Bank Amount':      l.amount,
        'Bank Currency':    l.currencyCode,
        'Bank Description': l.description,
        'Bank Reference':   l.reference,
        'Bank Txn Ref':     l.bankTxnReference,
        'Counterparty':     l.counterpartyName,
        // System / CM side
        'Sys Txn Type':     l.reconTxnType,
        'Sys Txn Number':   l.reconTxnNumber,
        'Sys Recon Amount': l.reconAmount,
        'Recon Date':       l.reconDate,
        'CM Ext Txn ID':    l.externalTxnId,
        'CM Ext Txn Ref':   l.externalTxnRef,
      }));
      if (reconRows.length > 0)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reconRows), 'Matched Pairs');

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `BankRecon_${date}.xlsx`);
    } finally {
      setExporting(false);
    }
  }, [stmtLines, filteredSysTxns, lastParams, msgApi]);

  // Store GL journal status for transactions
  const [glJournalStatus, setGlJournalStatus] = React.useState<Record<string, boolean>>({});
  const [checkingGlStatus, setCheckingGlStatus] = React.useState(false);
  const [selectedTxnForGlCheck, setSelectedTxnForGlCheck] = React.useState<SysTxn | null>(null);
  const [glCheckModalVisible, setGlCheckModalVisible] = React.useState(false);
  const [glCheckTestLoading, setGlCheckTestLoading] = React.useState(false);
  const [glCheckTestResult, setGlCheckTestResult] = React.useState<{ status?: number; data?: any; error?: string } | null>(null);

  // Check GL Status for visible system transactions
  const checkGlJournalStatus = async () => {
    setCheckingGlStatus(true);
    try {
      const statusMap: Record<string, boolean> = {};

      // Check each visible transaction
      for (const txn of filteredSysTxns) {
        const refType = txn.source === 'AP_PAYMENT' ? 'AP-PAYMENT'
                      : txn.source === 'EXTERNAL_TXN' ? 'BANK_EXTERNAL_TRANSACTIONS'
                      : txn.source === 'AR_RECEIPT' ? 'AR_RECEIPTS'
                      : 'GL_JOURNAL';

        try {
          const q = new URLSearchParams({
            reference2: String(txn.txnId),
            reference5: refType,
          });
          const res = await fetch(`${APEX_BASE}/gl/journals/check?${q}`);
          const data = await res.json();
          statusMap[txn.txnId] = (data.items?.length || 0) > 0;
        } catch (e) {
          statusMap[txn.txnId] = false;
        }
      }

      setGlJournalStatus(statusMap);
      msgApi.success(`GL Status checked for ${filteredSysTxns.length} transactions`);
    } catch (e) {
      msgApi.error('Failed to check GL status');
    } finally {
      setCheckingGlStatus(false);
    }
  };

  // Test GL Status for a specific transaction
  const testGlJournalStatus = async (txn: SysTxn) => {
    if (!txn) return;
    setGlCheckTestLoading(true);
    try {
      const refType = txn.source === 'AP_PAYMENT' ? 'AP-PAYMENT'
                    : txn.source === 'EXTERNAL_TXN' ? 'BANK_EXTERNAL_TRANSACTIONS'
                    : txn.source === 'AR_RECEIPT' ? 'AR_RECEIPTS'
                    : 'GL_JOURNAL';

      const q = new URLSearchParams({
        reference2: String(txn.txnId),
        reference5: refType,
      });
      const url = `${APEX_BASE}/gl/journals/check?${q}`;
      const res = await fetch(url);
      const data = await res.json();
      setGlCheckTestResult({ status: res.status, data });
      msgApi.success(`Test completed - Found ${data.items?.length || 0} journals`);
    } catch (e) {
      setGlCheckTestResult({ error: String(e) });
      msgApi.error('Test failed: ' + String(e));
    } finally {
      setGlCheckTestLoading(false);
    }
  };

  // Open GL check modal
  const handleOpenGlCheckModal = (txn: SysTxn) => {
    setSelectedTxnForGlCheck(txn);
    setGlCheckTestResult(null);
    setGlCheckModalVisible(true);
  };

  const stmtRowSelection: TableRowSelection<StmtLine> = {
    type: 'checkbox',
    selectedRowKeys: selectedStmtKeys,
    onChange: (keys, rows) => {
      setSelectedStmtKeys(keys);
      // Auto-select matching CM records for all selected lines that have an externalTxnId
      const linkedIds = rows.map(r => r.externalTxnId).filter((id): id is number => !!id);
      if (linkedIds.length > 0) {
        setSelectedSysKeys([]);
        setPendingAutoSelectTxnId(linkedIds);
        setTxnSourceFilter('EXTERNAL_TXN');
        setCmReconFilter('ALL');
        if (lastParams) fetchSysTxns(lastParams, 'EXTERNAL_TXN', 'ALL');
      } else {
        setPendingAutoSelectTxnId([]);
      }
    },
    getCheckboxProps: (r: StmtLine) => ({
      disabled: r.reconStatus === 'RECONCILED',
    }),
  };

  const sysRowSelection: TableRowSelection<SysTxn> = {
    type: 'checkbox',
    selectedRowKeys: selectedSysKeys,
    onChange: (keys) => setSelectedSysKeys(keys),
  };

  const canReconcile = selectedStmtKeys.length > 0 && selectedSysKeys.length > 0;

  return (
    <>
      {contextHolder}
      <SearchPanel
        bankAccounts={bankAccounts}
        businessUnits={businessUnits}
        loadingAccounts={loadingAccounts}
        hasData={statements.length > 0}
        onSearch={handleSearch}
        onReset={handleReset}
      />

      <div style={{ position: 'relative' }}>
        <StatementSelector
          statements={statements}
          loading={loadingStmts}
          selectedId={selectedStatement?.statementId ?? null}
          onSelect={handleSelectStatement}
          bankAccounts={bankAccounts}
        />
        {lastStatementsUrl && (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
            <Tooltip title="View Bank Statements API">
              <Button
                size="small"
                icon={<ApiOutlined />}
                style={{ color: REDWOOD.info, borderColor: REDWOOD.info, fontSize: 11 }}
                onClick={() => { setApiExecResult({ loading: false, response: null }); setApiModalTitle('Bank Statements API'); setApiModalUrl(lastStatementsUrl); setApiModalVisible(true); }}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {selectedStatement && (
        <div
          style={{
            background:   REDWOOD.info + '12',
            border:       `1px solid ${REDWOOD.info}40`,
            borderRadius: 6,
            padding:      '8px 14px',
            marginBottom: 12,
            display:      'flex',
            gap:          20,
            flexWrap:     'wrap',
            alignItems:   'center',
          }}
        >
          <Text style={{ fontSize: 12, color: REDWOOD.info, fontWeight: 600 }}>
            Selected Statement:
          </Text>
          <Text style={{ fontSize: 12 }}>
            <strong>{selectedStatement.statementNumber}</strong>
          </Text>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
            {fmtDate(selectedStatement.statementDate)}
          </Text>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
            {selectedStatement.bankAccountName}
          </Text>
          {selectedStatement.status && (
            <Tag
              color={
                selectedStatement.status === 'RECONCILED'
                  ? 'green'
                  : selectedStatement.status === 'PARTIALLY_RECONCILED'
                  ? 'orange'
                  : 'blue'
              }
              style={{ margin: 0, fontSize: 11 }}
            >
              {selectedStatement.status.replace(/_/g, ' ')}
            </Tag>
          )}
          {selectedStatement.openingBalance != null && (
            <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
              Opening: <strong>{fmtAmount(selectedStatement.openingBalance)}</strong>
            </Text>
          )}
          {selectedStatement.closingBalance != null && (
            <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
              Closing: <strong>{fmtAmount(selectedStatement.closingBalance)}</strong>
            </Text>
          )}
        </div>
      )}

      {/* ── Resizable split layout ── */}
      <div ref={splitContainerRef} style={{ display: 'flex', alignItems: 'stretch', gap: 0, minHeight: 500 }}>
        {/* ── LEFT: Bank Statement Lines ─────────────────────────────── */}
        <div style={{ width: `${leftPct}%`, minWidth: 240, flexShrink: 0, overflow: 'hidden' }}>
          <Card
            size="small"
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Space>
                  <BankOutlined style={{ color: REDWOOD.primary }} />
                  <span style={{ fontWeight: 600 }}>Bank Statement Lines</span>
                  <Badge count={filteredStmtLines.length} style={{ backgroundColor: REDWOOD.info }} showZero />
                </Space>
                <Space size={4}>
                  <Space size={2}>
                    {([
                      { label: 'All',     value: 'ALL',          color: '#1677ff' },
                      { label: 'Unrecon', value: 'UNRECONCILED', color: '#fa8c16' },
                      { label: 'Recon',   value: 'RECONCILED',   color: '#52c41a' },
                    ] as { label: string; value: 'ALL' | 'UNRECONCILED' | 'RECONCILED'; color: string }[]).map(opt => {
                      const active = stmtReconFilter === opt.value;
                      return (
                        <Button key={opt.value} size="small"
                          style={{ fontSize: 11, padding: '0 8px', height: 24, background: active ? opt.color : undefined, borderColor: active ? opt.color : undefined, color: active ? '#fff' : opt.color, fontWeight: active ? 600 : 400 }}
                          onClick={() => {
                            setStmtReconFilter(opt.value);
                            setSelectedStmtKeys([]);
                            if (selectedStatement) {
                              fetchStmtLines({ ...(lastParams ?? {}), statementId: String(selectedStatement.statementId) }, opt.value);
                            } else if (lastParams) {
                              fetchStmtLines(lastParams, opt.value);
                            }
                          }}
                        >{opt.label}</Button>
                      );
                    })}
                  </Space>
                  {(() => {
                    const selectedLines = stmtLines.filter(l => selectedStmtKeys.includes(l.lineId));
                    const alreadyLinked = selectedLines.some(l => l.externalTxnId);
                    const noSelection  = selectedLines.length === 0;
                    const tip = alreadyLinked
                      ? 'One or more selected lines already have an external transaction'
                      : noSelection
                      ? 'Select statement lines to create external transaction'
                      : `Create external transaction for ${selectedLines.length} line(s)`;
                    return (
                      <Tooltip title={tip}>
                        <Button
                          size="small"
                          icon={<PlusOutlined />}
                          disabled={noSelection || alreadyLinked}
                          style={{ fontSize: 11, background: noSelection || alreadyLinked ? undefined : REDWOOD.primary, borderColor: noSelection || alreadyLinked ? undefined : REDWOOD.primary, color: noSelection || alreadyLinked ? undefined : '#fff' }}
                          onClick={openExtTxnModal}
                        >
                          Create Ext Txn
                        </Button>
                      </Tooltip>
                    );
                  })()}
                  <Tooltip title={selectedStatement ? `Add line to ${selectedStatement.statementNumber}` : 'Select a statement first'}>
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      disabled={!selectedStatement}
                      style={{ fontSize: 11, background: selectedStatement ? REDWOOD.success : undefined, borderColor: selectedStatement ? REDWOOD.success : undefined, color: selectedStatement ? '#fff' : undefined }}
                      onClick={openAddLineModal}
                    >
                      Add Line
                    </Button>
                  </Tooltip>
                  <Tooltip title="Refresh statement lines">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={loadingStmt}
                      disabled={!selectedStatement}
                      onClick={() => {
                        if (selectedStatement) {
                          fetchStmtLines({ ...(lastParams ?? {}), statementId: String(selectedStatement.statementId) }, stmtReconFilter);
                        }
                      }}
                    />
                  </Tooltip>
                  {lastStmtLinesUrl && (
                    <Tooltip title="View Statement Lines API">
                      <Button
                        size="small"
                        icon={<ApiOutlined />}
                        style={{ color: REDWOOD.info, borderColor: REDWOOD.info, fontSize: 11 }}
                        onClick={() => { setApiExecResult({ loading: false, response: null }); setApiModalTitle('Statement Lines API'); setApiModalUrl(lastStmtLinesUrl); setApiModalVisible(true); }}
                      />
                    </Tooltip>
                  )}
                </Space>
              </div>
            }
            styles={{ body: { padding: 0 } }}
          >
            <div style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', background: REDWOOD.neutral100, display: 'flex', gap: 12, fontSize: 11 }}>
              <Text style={{ color: REDWOOD.neutral600 }}>
                {stmtReconFilter === 'ALL' ? 'All' : stmtReconFilter === 'RECONCILED' ? 'Reconciled' : 'Unreconciled'}: <strong>{filteredStmtLines.length}</strong> record{filteredStmtLines.length !== 1 ? 's' : ''}
              </Text>
            </div>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
              <Input.Search
                size="small"
                placeholder="Search description, reference, counterparty…"
                allowClear
                value={stmtSearch}
                onChange={e => setStmtSearch(e.target.value)}
                onSearch={v => setStmtSearch(v)}
                style={{ width: '100%' }}
              />
            </div>
            <Table<StmtLine>
              rowKey="lineId"
              size="small"
              loading={loadingStmt}
              columns={stmtColumns}
              dataSource={filteredStmtLines}
              rowSelection={stmtRowSelection}
              pagination={false}
              scroll={{ x: 560, y: 420 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={stmtReconFilter === 'RECONCILED' ? 'No reconciled statement lines' : stmtReconFilter === 'ALL' ? 'No statement lines found' : 'No unreconciled statement lines'}
                  />
                ),
              }}
            />
            <div
              style={{
                padding:         '8px 12px',
                backgroundColor: REDWOOD.neutral100,
                borderTop:       `1px solid ${REDWOOD.neutral200}`,
                display:         'flex',
                gap:             16,
                justifyContent:  'space-between',
                alignItems:      'center',
                flexWrap:        'wrap',
              }}
            >
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Records: <strong style={{ color: REDWOOD.info }}>{filteredStmtLines.length}</strong>
                </Text>
                <Divider type="vertical" />
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Total: <strong style={{ color: REDWOOD.neutral900 }}>{fmtAmount(filteredStmtLines.reduce((sum, l) => sum + (l.amount || 0), 0))}</strong>
                </Text>
                <Divider type="vertical" />
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Selected: <strong>{selectedStmtKeys.length}</strong>
                </Text>
                <Divider type="vertical" />
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Amount:{' '}
                  <strong style={{ color: REDWOOD.neutral900 }}>
                    {fmtAmount(stmtSelectedAmount)}
                  </strong>
                </Text>
              </div>
              <Tooltip title="Export Bank Statement Lines">
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => {
                    const rows = filteredStmtLines.map(l => ({
                      'Line ID':      l.lineId,
                      'Reference':    l.reference || l.bankTxnReference || '',
                      'Date':         fmtDate(l.transactionDate),
                      'Amount':       l.amount,
                      'Type':         l.transactionCode,
                      'Status':       l.reconStatus,
                      'Description':  l.description || '',
                      'Statement #':  l.statementNumber,
                      'Counterparty': l.counterpartyName || '',
                    }));
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Bank Statement Lines');
                    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                      `BankStatementLines_${selectedStatement?.statementNumber || 'export'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
                  }}
                  style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                />
              </Tooltip>
            </div>
          </Card>
        </div>

        {/* ── Drag handle ─────────────────────────────────────────────── */}
        <div
          onMouseDown={() => { isDragging.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }}
          style={{ width: 10, cursor: 'col-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}
        >
          <div style={{ width: 3, height: '100%', background: REDWOOD.neutral200, borderRadius: 2, transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = REDWOOD.info)}
            onMouseLeave={e => (e.currentTarget.style.background = REDWOOD.neutral200)}
          />
        </div>

        {/* ── RIGHT: System Transactions ────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 240, overflow: 'hidden' }}>
          <Card
            size="small"
            title={
              <Space wrap>
                <ReconciliationOutlined style={{ color: REDWOOD.primary }} />
                <span style={{ fontWeight: 600 }}>System Transactions</span>
                <Badge count={filteredSysTxns.length} style={{ backgroundColor: REDWOOD.info }} showZero />
              </Space>
            }
            extra={
              <Space size={8}>
                {/* Recon status toggle */}
                <Space size={2}>
                  {([
                    { label: 'All',     value: 'ALL',          color: '#1677ff' },
                    { label: 'Unrecon', value: 'UNRECONCILED', color: '#fa8c16' },
                    { label: 'Recon',   value: 'RECONCILED',   color: '#52c41a' },
                  ] as { label: string; value: 'ALL' | 'UNRECONCILED' | 'RECONCILED'; color: string }[]).map(opt => {
                    const active = sysReconFilter === opt.value;
                    return (
                      <Button key={opt.value} size="small"
                        style={{ fontSize: 11, padding: '0 8px', height: 24, background: active ? opt.color : undefined, borderColor: active ? opt.color : undefined, color: active ? '#fff' : opt.color, fontWeight: active ? 600 : 400 }}
                        onClick={() => {
                          const rf = opt.value;
                          setSysReconFilter(rf);
                          if (txnSourceFilter === 'EXTERNAL_TXN') setCmReconFilter(rf);
                          setSysTxns([]);
                          setSelectedSysKeys([]);
                          if (lastParams) fetchSysTxns(lastParams, txnSourceFilter, rf);
                        }}
                      >{opt.label}</Button>
                    );
                  })}
                </Space>
                {/* Source filter */}
                <Space size={2}>
                  {([
                    { label: 'All',          value: 'ALL',           color: '#1677ff' },
                    { label: 'AP Payment',   value: 'AP_PAYMENT',    color: '#1d39c4' },
                    { label: 'External Txn', value: 'EXTERNAL_TXN',  color: '#fa8c16' },
                    { label: 'Bank Transfer',value: 'BANK_TRANSFER',  color: '#722ed1' },
                    { label: 'GL Journal',   value: 'GL_JOURNAL',    color: '#531dab' },
                  ] as { label: string; value: string; color: string }[]).map(opt => {
                    const active = txnSourceFilter === opt.value;
                    return (
                      <Button key={opt.value} size="small"
                        style={{ fontSize: 11, padding: '0 8px', height: 24, background: active ? opt.color : undefined, borderColor: active ? opt.color : undefined, color: active ? '#fff' : opt.color, fontWeight: active ? 600 : 400 }}
                        onClick={() => {
                          setTxnSourceFilter(opt.value);
                          setSysTxns([]);
                          setSelectedSysKeys([]);
                          if (lastParams) fetchSysTxns(lastParams, opt.value, sysReconFilter);
                        }}
                      >{opt.label}</Button>
                    );
                  })}
                </Space>
                <Tooltip title="API Inspector — view endpoint & parameters">
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    onClick={() => { setApiCopied(false); setApiModal(true); }}
                    style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                  />
                </Tooltip>
                <Tooltip title="Check GL Journal status for visible transactions">
                  <Button
                    size="small"
                    icon={<CheckCircleOutlined />}
                    loading={checkingGlStatus}
                    onClick={checkGlJournalStatus}
                    style={{ color: '#52c41a', borderColor: '#52c41a' }}
                  >
                    Check GL Status
                  </Button>
                </Tooltip>
              </Space>
            }
            styles={{ body: { padding: 0 } }}
          >
            {/* Date filter row */}
            <div style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Text style={{ fontSize: 11, color: REDWOOD.neutral600, whiteSpace: 'nowrap' }}>Date:</Text>
              <DatePicker
                size="small"
                placeholder="From"
                value={sysDateFrom}
                format="D-MMM-YYYY"
                style={{ flex: 1 }}
                onChange={v => setSysDateFrom(v)}
                allowClear
              />
              <DatePicker
                size="small"
                placeholder="To"
                value={sysDateTo}
                format="D-MMM-YYYY"
                style={{ flex: 1 }}
                onChange={v => setSysDateTo(v)}
                allowClear
              />
              <Button
                size="small"
                type="primary"
                icon={<SearchOutlined />}
                disabled={!lastParams}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, flexShrink: 0 }}
                onClick={() => {
                  if (lastParams) fetchSysTxns({ ...lastParams, dateFrom: sysDateFrom, dateTo: sysDateTo }, txnSourceFilter, sysReconFilter);
                }}
              >
                Search
              </Button>
            </div>
            <div style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0', background: REDWOOD.neutral100, display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap' }}>
              <Text style={{ color: REDWOOD.neutral600 }}>
                {sysReconFilter === 'ALL' ? 'All' : sysReconFilter === 'RECONCILED' ? 'Reconciled' : 'Unreconciled'}: <strong>{filteredSysTxns.length}</strong> record{filteredSysTxns.length !== 1 ? 's' : ''}
              </Text>
              <Text style={{ color: REDWOOD.neutral600 }}>
                | Source: <strong>{txnSourceFilter}</strong>
              </Text>
            </div>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
              <Input.Search
                size="small"
                placeholder="Search transaction number, reference, payee…"
                allowClear
                value={sysSearch}
                onChange={e => setSysSearch(e.target.value)}
                onSearch={v => setSysSearch(v)}
                style={{ width: '100%' }}
              />
            </div>
            <Table<SysTxn>
              rowKey={sysTxnRowKey}
              size="small"
              loading={loadingSys}
              columns={sysColumns}
              dataSource={filteredSysTxns}
              rowSelection={{
                ...sysRowSelection,
                getCheckboxProps: (r: SysTxn) => ({
                  disabled: r.reconciledFlag === 'Y',
                }),
              }}
              pagination={false}
              scroll={{ x: 560, y: 420 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={lastParams?.bankAccount ? 'No system transactions found' : 'Select a bank account to load system transactions'}
                  />
                ),
              }}
            />
            <div
              style={{
                padding:         '8px 12px',
                backgroundColor: REDWOOD.neutral100,
                borderTop:       `1px solid ${REDWOOD.neutral200}`,
                display:         'flex',
                gap:             16,
                flexWrap:        'wrap',
                justifyContent:  'space-between',
                alignItems:      'center',
              }}
            >
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Records: <strong style={{ color: REDWOOD.info }}>{filteredSysTxns.length}</strong>
                </Text>
                <Divider type="vertical" />
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Total: <strong style={{ color: REDWOOD.neutral900 }}>{fmtAmount(filteredSysTxns.reduce((sum, t) => sum + (t.amount || 0), 0))}</strong>
                </Text>
                <Divider type="vertical" />
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Selected: <strong>{selectedSysKeys.length}</strong>
                </Text>
                <Divider type="vertical" />
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Amount:{' '}
                  <strong style={{ color: REDWOOD.neutral900 }}>
                    {fmtAmount(sysSelectedAmount)}
                  </strong>
                </Text>
                <Divider type="vertical" />
                <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                  Difference:{' '}
                  <strong style={{ color: difference === 0 ? REDWOOD.success : REDWOOD.error }}>
                    {fmtAmount(difference)}
                  </strong>
                </Text>
              </div>
              <Tooltip title="Export System Transactions">
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => {
                    const rows = filteredSysTxns.map(t => ({
                      'Txn ID':       t.txnId,
                      'Txn Number':   t.txnNumber,
                      'Date':         fmtDate(t.txnDate),
                      'Amount':       t.amount,
                      'Currency':     t.currencyCode || '',
                      'Source':       t.source,
                      'Status':       t.reconciledFlag === 'Y' ? 'Reconciled' : 'Unreconciled',
                      'Party':        t.payee || t.customerName || t.accountCode || t.bankAccountName || '',
                      'Method':       t.paymentMethod || t.receiptMethod || t.journalCategory || '',
                      'Business Unit': t.businessUnit || '',
                    }));
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'System Transactions');
                    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                      `SystemTransactions_${selectedStatement?.bankAccountName || 'export'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
                  }}
                  style={{ color: REDWOOD.success, borderColor: REDWOOD.success }}
                />
              </Tooltip>
              {selectedStmtKeys.length > 0 && selectedSysKeys.length > 0 && Math.abs(difference) > 0.001 && (
                <>
                  <Divider type="vertical" />
                  <Tooltip title={`Create ${difference > 0 ? 'Money In (DR)' : 'Money Out (CR)'} external transaction for the ${fmtAmount(Math.abs(difference))} difference`}>
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      style={{
                        fontSize: 11,
                        background: REDWOOD.primary,
                        color: '#fff',
                        borderColor: REDWOOD.primary,
                      }}
                      onClick={openDiffExtTxnModal}
                    >
                      Create Diff Txn&nbsp;
                      {difference > 0 ? '▲' : '▼'}&nbsp;
                      {fmtAmount(Math.abs(difference))}
                    </Button>
                  </Tooltip>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Reconcile Button ───────────────────────────────────────── */}
      <Row justify="end" align="middle" gutter={12} style={{ marginTop: 16 }}>
        <Col>
          <Checkbox
            checked={showApiLog}
            onChange={e => setShowApiLog(e.target.checked)}
            style={{ fontSize: 12, color: REDWOOD.neutral600 }}
          >
            Show API log
          </Checkbox>
        </Col>
        <Col>
          <Button
            icon={<DownloadOutlined />}
            size="large"
            loading={exporting}
            onClick={() => exportToExcel()}
            style={{ borderColor: '#389e0d', color: '#389e0d' }}
          >
            Export Excel
          </Button>
        </Col>
        <Col>
          <Button
            icon={<ThunderboltOutlined />}
            size="large"
            onClick={() => { setAutoReconStep('criteria'); setAutoReconMatches([]); setAutoReconOpen(true); }}
            style={{ borderColor: '#722ed1', color: '#722ed1' }}
          >
            Auto Recon
          </Button>
        </Col>
        <Col>
          <Button
            icon={<LinkOutlined />}
            size="large"
            onClick={() => setMatchingViewOpen(true)}
            disabled={stmtLines.length === 0 || sysTxns.length === 0}
            style={{ borderColor: '#1890ff', color: '#1890ff' }}
          >
            View Matching
          </Button>
        </Col>
        <Col>
          <ReconAgent
            stmtLines={stmtLines}
            sysTxns={sysTxns}
            bankAccount={lastParams?.bankAccount}
            disabled={stmtLines.length === 0}
            onApplyMatches={handleAgentReconcile}
          />
        </Col>
        <Col>
          <Button
            icon={<RobotOutlined />}
            size="large"
            loading={claudeLoading}
            onClick={async () => {
              try {
                setClaudeError('');
                setClaudeLoading(true);

                // Fetch API key
                const res = await fetch(`${APEX_BASE}/settings/claudekey`);
                const data = await res.json();
                if (!data.apiKey) {
                  setClaudeError('Claude API key not configured. Go to Admin → Claude AI Key Settings');
                  return;
                }

                // Run reconciliation
                const result = await reconcileWithClaude(stmtLines, sysTxns, data.apiKey);
                setClaudeResult(result);
                setClaudeReconOpen(true);
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : 'Unknown error';
                setClaudeError(errMsg);
                message.error('Reconciliation failed: ' + errMsg);
              } finally {
                setClaudeLoading(false);
              }
            }}
            disabled={stmtLines.length === 0 || sysTxns.length === 0}
            style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
          >
            Reconcile with Claude
          </Button>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={showApiLog ? <ApiOutlined /> : <CheckOutlined />}
            size="large"
            disabled={!canReconcile}
            loading={reconciling}
            onClick={showApiLog ? openReconLog : handleReconcile}
            style={{
              backgroundColor: canReconcile ? REDWOOD.primary : undefined,
              borderColor:     canReconcile ? REDWOOD.primary : undefined,
            }}
          >
            {showApiLog ? 'Preview & Reconcile' : 'Reconcile Selected'}
          </Button>
        </Col>
      </Row>

      {/* ── API Inspector Modal ───────────────────────────────────────── */}
      <Modal
        open={apiModal}
        onCancel={() => setApiModal(false)}
        footer={null}
        width={720}
        title={
          <Space>
            <ApiOutlined style={{ color: REDWOOD.info }} />
            <span>API Inspector — System Transactions Endpoint</span>
          </Space>
        }
      >
        {/* ── Active filter summary ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <Tag color="blue">Source: {txnSourceFilter}</Tag>
          <Tag color={sysReconFilter === 'RECONCILED' ? 'green' : sysReconFilter === 'UNRECONCILED' ? 'orange' : 'default'}>
            Recon: {sysReconFilter}
          </Tag>
          {lastParams?.bankAccount && <Tag color="geekblue">Account: {lastParams.bankAccount}</Tag>}
          {lastParams?.businessUnit && <Tag color="purple">BU: {lastParams.businessUnit}</Tag>}
          {(lastParams?.dateFrom ?? sysDateFrom) && <Tag>From: {(lastParams?.dateFrom ?? sysDateFrom)!.format('DD-MMM-YYYY')}</Tag>}
          {(lastParams?.dateTo   ?? sysDateTo)   && <Tag>To: {(lastParams?.dateTo ?? sysDateTo)!.format('DD-MMM-YYYY')}</Tag>}
        </div>

        {/* ── Unified endpoint — always the same URL regardless of source filter ── */}
        <div>
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 10 }}>
            Single endpoint backed by <code>RR_V_BANK_RECON_SYSTXNS</code> (AP Payments + External Transactions + Bank Transfers).
            Use the <strong>source</strong> parameter to filter by module.
          </Text>

          {/* Parameters table */}
          <div style={{ marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: REDWOOD.neutral200 }}>
                  {['Parameter', 'Current Value', 'Description'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: `1px solid ${REDWOOD.neutral300}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { param: 'bank_account',  val: txnSourceFilter === 'GL_JOURNAL' ? '(omitted for GL_JOURNAL)' : (lastParams?.bankAccount ?? '—'), desc: 'Bank account name — partial match (not used for GL_JOURNAL)' },
                  { param: 'cash_account', val: cashAccountCombination || '—', desc: 'Cash account combination — used for GL journal line filtering', required: txnSourceFilter === 'GL_JOURNAL' },
                  { param: 'business_unit', val: lastParams?.businessUnit ?? '—', desc: 'Business unit — partial match' },
                  { param: 'source',        val: txnSourceFilter === 'ALL' ? '(all)' : txnSourceFilter, desc: 'AP_PAYMENT | EXTERNAL_TXN | BANK_TRANSFER | GL_JOURNAL' },
                  { param: 'recon_status',  val: sysReconFilter, desc: 'ALL | RECONCILED | UNRECONCILED' },
                  { param: 'date_from',     val: (lastParams?.dateFrom ?? sysDateFrom)?.format('YYYY-MM-DD') ?? '—', desc: 'Transaction date from (YYYY-MM-DD)' },
                  { param: 'date_to',       val: (lastParams?.dateTo   ?? sysDateTo)?.format('YYYY-MM-DD')   ?? '—', desc: 'Transaction date to (YYYY-MM-DD)' },
                  { param: 'amount_min',    val: lastParams?.amountMin != null ? String(lastParams.amountMin) : '—', desc: 'Minimum transaction amount' },
                  { param: 'amount_max',    val: lastParams?.amountMax != null ? String(lastParams.amountMax) : '—', desc: 'Maximum transaction amount' },
                  { param: 'reference',     val: lastParams?.reference ?? '—', desc: 'Partial match on txn number or reference' },
                  { param: 'row_limit',     val: '500', desc: 'Maximum rows returned' },
                ].map((row, i) => (
                  <tr key={row.param} style={{ background: i % 2 === 0 ? REDWOOD.surface : REDWOOD.neutral100 }}>
                    <td style={{ padding: '5px 10px', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                      <code style={{ color: REDWOOD.info, fontSize: 11 }}>{row.param}</code>
                      {'required' in row && row.required && <Tag color="red" style={{ marginLeft: 4, fontSize: 10, padding: '0 4px' }}>required</Tag>}
                    </td>
                    <td style={{ padding: '5px 10px', borderBottom: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', color: row.val === '—' || row.val === '(all)' ? REDWOOD.neutral300 : REDWOOD.neutral900 }}>{row.val}</td>
                    <td style={{ padding: '5px 10px', borderBottom: `1px solid ${REDWOOD.neutral200}`, color: REDWOOD.neutral600 }}>{row.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Full URL */}
          <Text style={{ fontSize: 12, color: REDWOOD.neutral600, display: 'block', marginBottom: 4 }}>Full URL (with current filters)</Text>
          <div style={{ background: '#0d1117', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: '#79c0ff', position: 'relative' }}>
            {buildSysTxnsUrl(txnSourceFilter)}
            <Button size="small" icon={<CopyOutlined />}
              onClick={() => handleCopyUrl(buildSysTxnsUrl(txnSourceFilter))}
              style={{ position: 'absolute', top: 6, right: 6, backgroundColor: apiCopied ? REDWOOD.success : '#30363d', borderColor: apiCopied ? REDWOOD.success : '#484f58', color: '#fff', fontSize: 11 }}
            >
              {apiCopied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>

        {/* ── POST: Create External Transaction ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${REDWOOD.neutral200}` }}>
          <Space style={{ marginBottom: 6 }}>
            <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>POST</Tag>
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Create new external transaction</Text>
          </Space>
          <div style={{ background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`, borderRadius: 4, padding: '5px 10px', fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', color: REDWOOD.neutral600 }}>
            {EXT_TXN_URL}
          </div>
        </div>

        {/* ── GET: Check GL Journal Status ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${REDWOOD.neutral200}` }}>
          <Space style={{ marginBottom: 6 }}>
            <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>GET</Tag>
            <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Check if transaction is accounted in GL journals</Text>
          </Space>
          <Text style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block', marginBottom: 8 }}>
            Used to verify if a system transaction has been recorded in the General Ledger (matching by reference_2 and reference_5).
          </Text>
          <div style={{ marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: REDWOOD.neutral200 }}>
                  {['Parameter', 'Purpose', 'Example'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: `1px solid ${REDWOOD.neutral300}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { param: 'reference_2', purpose: 'Transaction ID from system transaction (txnId)', ex: '1000000256-1' },
                  { param: 'reference_5', purpose: 'Source/Reference type identifier', ex: 'AP-PAYMENT | BANK_EXTERNAL_TRANSACTIONS | AR_RECEIPTS | GL_JOURNAL' },
                  { param: 'row_limit', purpose: 'Max results (just need 1 to confirm existence)', ex: '1' },
                ].map((row, i) => (
                  <tr key={row.param} style={{ background: i % 2 === 0 ? REDWOOD.surface : REDWOOD.neutral100 }}>
                    <td style={{ padding: '5px 10px', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                      <code style={{ color: REDWOOD.info, fontSize: 10 }}>{row.param}</code>
                    </td>
                    <td style={{ padding: '5px 10px', borderBottom: `1px solid ${REDWOOD.neutral200}`, color: REDWOOD.neutral600, fontSize: 10 }}>{row.purpose}</td>
                    <td style={{ padding: '5px 10px', borderBottom: `1px solid ${REDWOOD.neutral200}`, fontFamily: 'monospace', color: REDWOOD.neutral900, fontSize: 10 }}>{row.ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Text style={{ fontSize: 11, color: REDWOOD.neutral600, display: 'block', marginBottom: 4 }}>Full URL Pattern</Text>
          <div style={{ background: '#0d1117', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', color: '#79c0ff', position: 'relative' }}>
            {`${APEX_BASE}/gl/journals?reference_2={txnId}&reference_5={refType}&row_limit=1`}
            <Button size="small" icon={<CopyOutlined />}
              onClick={() => handleCopyUrl(`${APEX_BASE}/gl/journals?reference_2={txnId}&reference_5={refType}&row_limit=1`)}
              style={{ position: 'absolute', top: 6, right: 6, backgroundColor: apiCopied ? REDWOOD.success : '#30363d', borderColor: apiCopied ? REDWOOD.success : '#484f58', color: '#fff', fontSize: 10 }}
            >
              {apiCopied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <Text style={{ fontSize: 10, color: REDWOOD.neutral600, display: 'block', marginTop: 8, fontStyle: 'italic' }}>
            Response: If item exists in GL journals, status is "Yes", else "No"
          </Text>
        </div>
      </Modal>

      {/* ── Reconcile Progress Modal ─────────────────────────────── */}
      <Modal
        open={progressOpen}
        onCancel={() => { if (progressDone) setProgressOpen(false); }}
        closable={progressDone}
        maskClosable={false}
        width={460}
        title={<Space><SyncOutlined spin={!progressDone} style={{ color: progressDone ? REDWOOD.success : REDWOOD.info }} /><span>Reconciling…</span></Space>}
        footer={
          progressDone
            ? <Button type="primary" onClick={() => setProgressOpen(false)}>Close</Button>
            : null
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
          {progressSteps.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, background: '#fafafa', border: '1px solid #f0f0f0' }}>
              <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>
                {step.status === 'pending'  && <span style={{ color: '#bbb' }}>○</span>}
                {step.status === 'running'  && <SyncOutlined spin style={{ color: REDWOOD.info }} />}
                {step.status === 'success'  && <CheckCircleOutlined style={{ color: REDWOOD.success }} />}
                {step.status === 'error'    && <CloseCircleOutlined style={{ color: REDWOOD.error }} />}
              </span>
              <span style={{ fontSize: 12, color: step.status === 'error' ? REDWOOD.error : step.status === 'success' ? REDWOOD.success : REDWOOD.neutral600 }}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </Modal>

      {/* ── Reconcile API Log Modal ──────────────────────────────── */}
      <Modal
        open={reconLogOpen}
        onCancel={() => setReconLogOpen(false)}
        width={820}
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Reconcile API Log</span></Space>}
        footer={
          <Row justify="space-between" align="middle">
            <Col>
              <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                {reconCalls.filter(c => c.status === 'success').length}/{reconCalls.length} completed
              </Text>
            </Col>
            <Col>
              <Space>
                <Button onClick={() => setReconLogOpen(false)}>Close</Button>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  disabled={reconCalls.every(c => c.status !== 'pending')}
                  onClick={executeAllReconCalls}
                  style={{ backgroundColor: REDWOOD.primary, borderColor: REDWOOD.primary }}
                >
                  Execute All
                </Button>
              </Space>
            </Col>
          </Row>
        }
      >
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {reconCalls.map((call, idx) => {
            const stmtBody  = { lineId: call.lineId, txnType: call.txnType, txnId: call.txnId, txnNumber: call.txnNumber, reconAmount: call.reconAmount, notes: '' };
            const mkColor   = (s: string) => s === 'success' ? REDWOOD.success : s === 'error' ? REDWOOD.error : s === 'running' ? REDWOOD.info : REDWOOD.neutral300;
            const mkLabel   = (s: string) => s === 'success' ? 'Done' : s === 'error' ? 'Error' : s === 'running' ? 'Running…' : 'Pending';
            const overallOk = call.status === 'success' && call.txnStatus === 'success';
            const overallErr = call.status === 'error' || call.txnStatus === 'error';

            const ApiRow = ({ method, url, body, status, response, onExecute, label }: {
              method: string; url: string; body: object; status: string; response?: string; onExecute: () => void; label: string;
            }) => (
              <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: REDWOOD.neutral100 }}>
                  <Space size={6}>
                    <Tag color={method === 'POST' ? 'orange' : 'blue'} style={{ fontSize: 10, margin: 0 }}>{method}</Tag>
                    <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{label}</Text>
                    <Text style={{ fontFamily: 'monospace', fontSize: 10, color: REDWOOD.neutral600 }} ellipsis>{url.replace(APEX_BASE, '')}</Text>
                    <Tag style={{ fontSize: 10, margin: 0, color: mkColor(status), borderColor: mkColor(status) }}>{mkLabel(status)}</Tag>
                  </Space>
                  <Button size="small" type="primary" disabled={status === 'success' || status === 'running'} loading={status === 'running'} onClick={onExecute}
                    style={{ fontSize: 11, backgroundColor: status === 'success' ? REDWOOD.success : REDWOOD.primary, borderColor: status === 'success' ? REDWOOD.success : REDWOOD.primary }}>
                    {status === 'success' ? 'Done' : 'Execute'}
                  </Button>
                </div>
                <div style={{ display: 'flex' }}>
                  <div style={{ flex: 1, padding: '6px 12px', background: '#0d1117', borderRight: response ? `1px solid #30363d` : 'none' }}>
                    <Text style={{ fontSize: 9, color: '#6e7681', display: 'block', marginBottom: 2 }}>REQUEST BODY</Text>
                    <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 10, color: '#9cdcfe', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(body, null, 2)}</pre>
                  </div>
                  {response && (
                    <div style={{ flex: 1, padding: '6px 12px', background: status === 'error' ? '#1a0a0a' : '#0a1a0a' }}>
                      <Text style={{ fontSize: 9, color: '#6e7681', display: 'block', marginBottom: 2 }}>RESPONSE</Text>
                      <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 10, color: status === 'error' ? '#f97583' : '#85e89d', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{response}</pre>
                    </div>
                  )}
                </div>
              </div>
            );

            return (
              <div key={idx} style={{ marginBottom: 14, border: `1px solid ${overallOk ? REDWOOD.success : overallErr ? REDWOOD.error : REDWOOD.neutral200}`, borderRadius: 6, overflow: 'hidden' }}>
                {/* Card title */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: overallOk ? '#0a1a0a' : overallErr ? '#1a0a0a' : '#161b22' }}>
                  <Space size={6}>
                    <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9' }}>Line #{call.lineId}</Text>
                    <Text style={{ fontSize: 11, color: '#6e7681' }}>→ {call.txnLabel} #{call.txnId}</Text>
                    <Tag color={call.txnType === 'ORA_MAN' ? 'cyan' : call.txnType === 'AP_PAYMENT' ? 'geekblue' : call.txnType === 'AR_RECEIPT' ? 'green' : 'purple'} style={{ fontSize: 10, margin: 0 }}>{call.txnType}</Tag>
                  </Space>
                  <Text style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info }}>{call.reconAmount.toLocaleString()}</Text>
                </div>
                {/* Call 1: Statement reconcile */}
                <ApiRow
                  method="POST"
                  label="Bank Statement Line"
                  url={`${APEX_BASE}/cash/bankstatements/${call.statementId}/reconcile`}
                  body={stmtBody}
                  status={call.status}
                  response={call.response}
                  onExecute={() => executeReconCall(idx)}
                />
                {/* Call 2: Transaction-side update */}
                <ApiRow
                  method="PUT"
                  label={call.txnLabel}
                  url={call.txnUrl}
                  body={call.txnBody}
                  status={call.txnStatus}
                  response={call.txnResponse}
                  onExecute={() => executeTxnCall(idx)}
                />
              </div>
            );
          })}
        </div>
      </Modal>

      {/* ── Create External Transaction Modal ───────────────────── */}
      <Modal
        title={<Space><BankOutlined style={{ color: REDWOOD.info }} /><span>Create External Transaction</span></Space>}
        open={extTxnOpen}
        onCancel={() => setExtTxnOpen(false)}
        footer={null}
        width={700}
        destroyOnClose
      >
        <Form form={extTxnForm} layout="vertical" size="small" onFinish={handleExtTxnSubmit}>
          {/* Row 1: BU + Bank Account */}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Business Unit" name="businessUnitName" rules={[{ required: true, message: 'Required' }]}>
                <Select showSearch optionFilterProp="label"
                  options={businessUnits.map(b => ({ value: b.value, label: b.label }))}
                  placeholder="Select business unit"
                  onChange={handleBuChange}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Bank Account" name="bankAccountName" rules={[{ required: true, message: 'Required' }]}>
                <Select showSearch
                  options={extBankAccounts.map(b => ({ value: b.name, label: b.name }))}
                  placeholder="Select bank account"
                  onChange={handleBankAccountChange}
                />
              </Form.Item>
            </Col>
          </Row>
          {/* Row 2: Date + Currency + Type */}
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Transaction Date" name="transactionDate" rules={[{ required: true, message: 'Required' }]}>
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Currency" name="currencyCode">
                <Select>
                  {['AED','USD','EUR','GBP','SAR','KWD','QAR','OMR','BHD','EGP','INR'].map(c =>
                    <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Transaction Type" name="transactionType">
                <Select placeholder="Select type" allowClear>
                  {['EFT','WIRE','CHECK','MISC'].map(t => <Option key={t} value={t}>{t}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item label="Reference" name="referenceText" style={{ marginBottom: 8 }} rules={[{ required: true, message: 'Reference is required' }]}>
                <Input placeholder="e.g. STMT-REF-001" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Direction (auto)" style={{ marginBottom: 8 }}>
                <Tag color={extTxnDirection === 'CR' ? 'blue' : 'volcano'} style={{ fontSize: 13, padding: '2px 12px' }}>
                  {extTxnDirection === 'CR' ? '▲ Money In (CR)' : '▼ Money Out (DR)'}
                </Tag>
              </Form.Item>
            </Col>
          </Row>

          {/* Accounting entry preview */}
          {(() => {
            const isMoneyIn = extTxnDirection === 'CR';
            const assetCode  = extTxnAssetAcct  || '';
            const offsetCode = extTxnOffsetAcct || '';
            const assetLabel  = extAssetDesc  || assetCode  || 'Cash / Asset Account';
            const offsetLabel = extOffsetDesc || offsetCode || 'Offset Account';
            const drLabel = isMoneyIn ? assetLabel  : offsetLabel;
            const crLabel = isMoneyIn ? offsetLabel : assetLabel;
            const drCode  = isMoneyIn ? assetCode   : offsetCode;
            const crCode  = isMoneyIn ? offsetCode  : assetCode;
            return (
              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#8c8c8c', flexShrink: 0 }}>Journal:</span>
                <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>DR</Tag>
                <span style={{ fontSize: 12 }}>{drLabel}</span>
                {drCode && <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#8c8c8c' }}>({drCode})</span>}
                <span style={{ color: '#d9d9d9' }}>|</span>
                <Tag color="green" style={{ margin: 0, fontWeight: 600 }}>CR</Tag>
                <span style={{ fontSize: 12 }}>{crLabel}</span>
                {crCode && <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#8c8c8c' }}>({crCode})</span>}
              </div>
            );
          })()}

          {/* Cash Account (always in header) */}
          <Form.Item label="Cash / Asset Account" style={{ marginBottom: 8 }}>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="assetAccountCombination" noStyle rules={[{ required: true, message: 'Cash / Asset account is required' }]}>
                <Input readOnly placeholder="Select account" style={{ fontFamily: 'monospace', fontSize: 11 }} />
              </Form.Item>
              <Button icon={<SearchOutlined />} onClick={() => {
                setExtCoaInitial(extTxnForm.getFieldValue('assetAccountCombination') || '');
                setExtCoaTarget('asset');
                setExtCoaOpen(true);
              }} />
            </Space.Compact>
            {extAssetDesc && <div style={{ fontSize: 11, color: REDWOOD.info, marginTop: 2 }}>{extAssetDesc}</div>}
          </Form.Item>

          {selectedStatement && (
            <div style={{ background: REDWOOD.info + '12', border: `1px solid ${REDWOOD.info}40`, borderRadius: 4, padding: '6px 10px', marginBottom: 8, fontSize: 11 }}>
              <Space wrap>
                <Text type="secondary" style={{ fontSize: 11 }}>Statement:</Text>
                <Text strong style={{ fontSize: 11 }}>{selectedStatement.statementNumber}</Text>
                <Tag color="blue" style={{ fontSize: 10 }}>ID: {selectedStatement.statementId}</Tag>
                {selectedStmtKeys.length > 0 && <Tag color="green" style={{ fontSize: 10 }}>{selectedStmtKeys.length} line(s) selected</Tag>}
              </Space>
            </div>
          )}

          {/* Mode toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 12 }}>Transaction Line(s)</Text>
            <Segmented
              size="small"
              value={extTxnMode}
              onChange={(v) => setExtTxnMode(v as 'single' | 'multiple')}
              options={[{ label: 'Single', value: 'single' }, { label: 'Multiple', value: 'multiple' }]}
            />
          </div>

          {extTxnMode === 'single' ? (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Amount" name="amount" rules={[{ required: true, message: 'Required' }]}>
                    <InputNumber style={{ width: '100%', background: '#f5f5f5' }} precision={2} readOnly />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Description" name="description">
                    <Input placeholder="Optional" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Offset Account">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="offsetAccountCombination" noStyle rules={[{ required: true, message: 'Offset account is required' }]}>
                    <Input readOnly placeholder="Select account" style={{ fontFamily: 'monospace', fontSize: 11 }} />
                  </Form.Item>
                  <Button icon={<SearchOutlined />} onClick={() => {
                    setExtCoaInitial(extTxnForm.getFieldValue('offsetAccountCombination') || '');
                    setExtCoaTarget('offset');
                    setExtCoaOpen(true);
                  }} />
                </Space.Compact>
                {extOffsetDesc && <div style={{ fontSize: 11, color: REDWOOD.info, marginTop: 2 }}>{extOffsetDesc}</div>}
              </Form.Item>
            </>
          ) : (
            <>
              <Table
                size="small"
                dataSource={extTxnLines}
                rowKey="key"
                pagination={false}
                scroll={{ y: 180 }}
                style={{ marginBottom: 4 }}
                columns={[
                  {
                    title: '#', width: 32,
                    render: (_: any, _r: any, idx: number) => <Text style={{ fontSize: 11 }}>{idx + 1}</Text>,
                  },
                  {
                    title: 'Amount', width: 110,
                    render: (_: any, record: any) => (
                      <InputNumber size="small" style={{ width: '100%', background: '#f5f5f5' }} precision={2}
                        value={record.amount}
                        readOnly
                      />
                    ),
                  },
                  {
                    title: 'Description',
                    render: (_: any, record: any, idx: number) => (
                      <Input size="small" value={record.description}
                        onChange={(e) => updateExtLine(idx, 'description', e.target.value)}
                      />
                    ),
                  },
                  {
                    title: 'Offset Account', width: 200,
                    render: (_: any, record: any, idx: number) => (
                      <>
                        <Space.Compact style={{ width: '100%' }}>
                          <Input size="small" readOnly value={record.offsetAccount}
                            style={{ fontFamily: 'monospace', fontSize: 10 }} placeholder="Select..." />
                          <Button size="small" icon={<SearchOutlined />} onClick={() => {
                            setExtLineCoaIdx(idx);
                            setExtCoaTarget('line-offset');
                            setExtCoaInitial(record.offsetAccount || '');
                            setExtCoaOpen(true);
                          }} />
                        </Space.Compact>
                        {record.offsetDesc && <div style={{ fontSize: 10, color: REDWOOD.info }}>{record.offsetDesc}</div>}
                      </>
                    ),
                  },
                  {
                    title: '', width: 32,
                    render: (_: any, _r: any, idx: number) => (
                      <Button size="small" type="text" danger icon={<CloseOutlined />}
                        onClick={() => setExtTxnLines(prev => prev.filter((_, i) => i !== idx))}
                      />
                    ),
                  },
                ]}
                footer={() => (
                  <div style={{ textAlign: 'right', paddingRight: 36 }}>
                    <Text style={{ fontSize: 11 }}>Total: </Text>
                    <Text strong style={{ fontSize: 11 }}>
                      {fmtAmount(extTxnLines.reduce((s, l) => s + (l.amount ?? 0), 0), extTxnForm.getFieldValue('currencyCode'))}
                    </Text>
                  </div>
                )}
              />
              <Button size="small" icon={<PlusOutlined />}
                onClick={() => setExtTxnLines(prev => [
                  ...prev,
                  { key: Date.now(), amount: undefined, description: '', offsetAccount: '', offsetDesc: '' },
                ])}
              >
                Add Line
              </Button>
            </>
          )}

          {/* API Inspector */}
          <Collapse size="small" style={{ marginTop: 8, marginBottom: 8 }}>
            <Collapse.Panel
              header={
                <Space size={4}>
                  <ApiOutlined style={{ color: REDWOOD.info }} />
                  <Text style={{ fontSize: 11 }}>API Inspector</Text>
                  <Text style={{ fontSize: 10, color: REDWOOD.neutral600 }}>POST {EXT_TXN_URL}</Text>
                  {extTxnRawError && <Tag color="error" style={{ fontSize: 10 }}>Error</Tag>}
                  {(Array.isArray(extTxnResponse) ? extTxnResponse.every(r => r?.status === 'success') : extTxnResponse?.status === 'success') && <Tag color="success" style={{ fontSize: 10 }}>Success</Tag>}
                </Space>
              }
              key="api"
            >
              <Collapse size="small" ghost defaultActiveKey={['payload']}>
                <Collapse.Panel header={<Text style={{ fontSize: 11 }}>Request Payload</Text>} key="payload">
                  <pre style={{ fontSize: 10, maxHeight: 200, overflow: 'auto', background: '#f0f5ff', padding: 8, borderRadius: 4, margin: 0, border: '1px solid #adc6ff' }}>
                    {extTxnPayload ? JSON.stringify(extTxnPayload, null, 2) : '— submit form to see payload —'}
                  </pre>
                </Collapse.Panel>
                {extTxnResponse && (
                  <Collapse.Panel header={<Text style={{ fontSize: 11 }}>Response</Text>} key="response">
                    <pre style={{ fontSize: 10, maxHeight: 160, overflow: 'auto', background: '#f6ffed', padding: 8, borderRadius: 4, margin: 0, border: '1px solid #b7eb8f' }}>
                      {JSON.stringify(extTxnResponse, null, 2)}
                    </pre>
                  </Collapse.Panel>
                )}
                {extTxnRawError && (
                  <Collapse.Panel header={<Text style={{ fontSize: 11, color: REDWOOD.error }}>Raw Error</Text>} key="err">
                    <pre style={{ fontSize: 10, maxHeight: 120, overflow: 'auto', background: '#fff2f0', padding: 8, borderRadius: 4, margin: 0, border: '1px solid #ffccc7', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {extTxnRawError}
                    </pre>
                  </Collapse.Panel>
                )}
              </Collapse>
            </Collapse.Panel>
          </Collapse>

          {/* Accounting result banner */}
          {extAcctResult && (
            <div style={{ marginBottom: 10, padding: '6px 12px', borderRadius: 6, fontSize: 12,
              background: extAcctResult.ok ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${extAcctResult.ok ? '#b7eb8f' : '#ffccc7'}`,
              color: extAcctResult.ok ? REDWOOD.success : REDWOOD.error }}>
              {extAcctResult.ok ? '✓ ' : '✗ '}{extAcctResult.msg}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              {extTxnCreatedId && (
                <Button
                  icon={<FileTextOutlined />}
                  loading={extAcctRunning}
                  disabled={!!extAcctResult?.ok}
                  onClick={createExtTxnAccounting}
                  style={{ color: REDWOOD.info, borderColor: REDWOOD.info, fontSize: 12 }}
                >
                  {extAcctResult?.ok ? 'Accounted' : 'Create Accounting'}
                </Button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => { setExtTxnOpen(false); setExtTxnCreatedId(null); setExtAcctResult(null); }}>
                {extTxnCreatedId ? 'Close' : 'Cancel'}
              </Button>
              {!extTxnCreatedId && (
                <Button type="primary" htmlType="submit" loading={extTxnSaving}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                  {extTxnMode === 'multiple' ? `Create ${extTxnLines.length} Transaction(s)` : 'Create Transaction'}
                </Button>
              )}
            </div>
          </div>
        </Form>
      </Modal>

      {/* Account Selector for ext txn */}
      <AccountSelector
        visible={extCoaOpen}
        onCancel={() => setExtCoaOpen(false)}
        initialValue={extCoaInitial}
        onSelect={(code, _segments) => {
          if (extCoaTarget === 'line-offset') {
            updateExtLine(extLineCoaIdx, 'offsetAccount', code);
            validateAccountCode(code).then(r => {
              const seg4 = Object.values(r.segmentDetails)[3];
              updateExtLine(extLineCoaIdx, 'offsetDesc', (seg4 as any)?.description || '');
            }).catch(() => {});
          } else {
            extTxnForm.setFieldValue(
              extCoaTarget === 'asset' ? 'assetAccountCombination' : 'offsetAccountCombination',
              code
            );
            if (extCoaTarget === 'asset') setExtTxnAssetAcct(code);
            else setExtTxnOffsetAcct(code);
            validateAccountCode(code).then(r => {
              const seg4 = Object.values(r.segmentDetails)[3];
              const desc = (seg4 as any)?.description || '';
              if (extCoaTarget === 'asset') setExtAssetDesc(desc);
              else setExtOffsetDesc(desc);
            }).catch(() => {});
          }
          setExtCoaOpen(false);
        }}
      />

      {/* ── Auto Recon Modal ─────────────────────────────────────────── */}
      <Modal
        title={<Space><ThunderboltOutlined style={{ color: '#722ed1' }} /><span>Auto Reconciliation</span></Space>}
        open={autoReconOpen}
        onCancel={() => setAutoReconOpen(false)}
        width={autoReconStep === 'results' ? 1400 : 520}
        footer={
          autoReconStep === 'criteria' ? (
            <Space>
              <Tooltip title="API Inspector — view endpoints used by this popup">
                <Button
                  icon={<ApiOutlined />}
                  onClick={() => setAutoReconApiOpen(true)}
                  style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                />
              </Tooltip>
              <Button onClick={() => setAutoReconOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={autoReconRunning}
                disabled={autoReconCriteria.length === 0}
                onClick={runAutoRecon}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
              >
                Find Matches
              </Button>
            </Space>
          ) : (
            <Space>
              <Tooltip title="API Inspector — view endpoints used by this popup">
                <Button
                  icon={<ApiOutlined />}
                  onClick={() => setAutoReconApiOpen(true)}
                  style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                />
              </Tooltip>
              <Button onClick={() => setAutoReconStep('criteria')}>← Back</Button>
              <Button onClick={() => setAutoReconOpen(false)}>Close</Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={autoReconRunning}
                disabled={!autoReconMatches.some(m => m.confirmed && m.status === 'pending')}
                onClick={executeAutoRecon}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              >
                Reconcile {autoReconMatches.filter(m => m.confirmed && m.status === 'pending').length} Pair(s)
              </Button>
            </Space>
          )
        }
        destroyOnClose
      >
        {autoReconStep === 'criteria' ? (
          <div>
            <div style={{ marginBottom: 16, color: '#8c8c8c', fontSize: 12 }}>
              Select the criteria used to find matches between bank statement lines and system transactions.
              All selected criteria must match for a pair to be proposed.
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Transaction Source</div>
              <Segmented
                value={autoReconTxnType}
                onChange={v => setAutoReconTxnType(v as string)}
                options={[
                  { label: 'All',  value: 'ALL' },
                  { label: 'AP',   value: 'AP_PAYMENT' },
                  { label: 'AR',   value: 'AR_RECEIPT' },
                  { label: 'GL',   value: 'GL_JOURNAL' },
                  { label: 'CM',   value: 'CM' },
                ]}
              />
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <div style={{ fontWeight: 600, marginBottom: 10 }}>Matching Criteria</div>
            <Checkbox.Group
              value={autoReconCriteria}
              onChange={v => setAutoReconCriteria(v as string[])}
            >
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Checkbox value="amount">
                  <div>
                    <div style={{ fontWeight: 500 }}>By Amount</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>Statement line amount equals system transaction amount</div>
                  </div>
                </Checkbox>
                <Checkbox value="bankTxnId">
                  <div>
                    <div style={{ fontWeight: 500 }}>By Bank Transaction ID</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>Bank txn reference on statement matches transaction number or reference</div>
                  </div>
                </Checkbox>
                <Checkbox value="reference">
                  <div>
                    <div style={{ fontWeight: 500 }}>By Bank Reference</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>Statement reference matches system transaction reference or number</div>
                  </div>
                </Checkbox>
                <Checkbox value="checkNumber">
                  <div>
                    <div style={{ fontWeight: 500 }}>By AP Check / Payment Number</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>Statement reference or bank txn ref matches AP check/payment number</div>
                  </div>
                </Checkbox>
                <Checkbox value="date">
                  <div>
                    <div style={{ fontWeight: 500 }}>By Date</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>Transaction dates must match exactly</div>
                  </div>
                </Checkbox>
                <Checkbox value="counterparty">
                  <div>
                    <div style={{ fontWeight: 500 }}>By Counterparty / Payee Name</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c' }}>Statement counterparty contains or matches system transaction payee</div>
                  </div>
                </Checkbox>
              </Space>
            </Checkbox.Group>

            <div style={{ marginTop: 16, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, fontSize: 12 }}>
              <strong>{stmtLines.filter(l => l.reconStatus !== 'RECONCILED' && !l.externalTxnId).length}</strong> unreconciled statement lines ·{' '}
              <strong>{(autoReconTxnType === 'ALL' || autoReconTxnType === 'CM' ? sysTxns : sysTxns.filter(t => t.source === autoReconTxnType)).filter(t => !t.reconciledFlag || t.reconciledFlag === 'N').length}</strong> unreconciled system transactions available
            </div>
          </div>
        ) : autoReconMatches.length === 0 ? (
          <Empty
            description={
              <div>
                <div>No matches found</div>
                <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
                  Checked {stmtLines.filter(l => l.reconStatus !== 'RECONCILED' && !l.externalTxnId).length} statement lines against{' '}
                  {(autoReconTxnType === 'ALL' || autoReconTxnType === 'CM' ? sysTxns : sysTxns.filter(t => t.source === autoReconTxnType)).filter(t => !t.reconciledFlag || t.reconciledFlag === 'N').length} system transactions by amount.
                </div>
              </div>
            }
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: 'calc(100vh - 250px)' }}>
            {/* Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <div style={{ background: '#f5f5f5', padding: '8px 12px', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#8c8c8c' }}>Total Matches</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1677ff' }}>{autoReconMatches.filter(m => Math.abs(m.stmtLine.amount) === Math.abs(m.sysTxn.amount)).length}</div>
              </div>
              <div style={{ background: '#f5f5f5', padding: '8px 12px', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#8c8c8c' }}>Stmt Lines</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fa8c16' }}>{stmtLines.filter(l => l.reconStatus !== 'RECONCILED' && !l.externalTxnId).length}</div>
              </div>
              <div style={{ background: '#f5f5f5', padding: '8px 12px', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#8c8c8c' }}>Sys Txns</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#722ed1' }}>{(autoReconTxnType === 'ALL' || autoReconTxnType === 'CM' ? sysTxns : sysTxns.filter(t => t.source === autoReconTxnType)).filter(t => !t.reconciledFlag || t.reconciledFlag === 'N').length}</div>
              </div>
              <div style={{ background: '#f5f5f5', padding: '8px 12px', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#8c8c8c' }}>Confirmed</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#52c41a' }}>{autoReconMatches.filter(m => m.confirmed).length}</div>
              </div>
            </div>

            {/* Two Column Layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, overflow: 'hidden' }}>
              {/* Statement Lines */}
              <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
                <div style={{ padding: '10px 12px', background: '#e6f4ff', borderBottom: '1px solid #d9d9d9', fontWeight: 600, fontSize: 12, color: '#1677ff' }}>
                  Bank Statement Lines ({stmtLines.filter(l => l.reconStatus !== 'RECONCILED' && !l.externalTxnId).length})
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                  {stmtLines.filter(l => l.reconStatus !== 'RECONCILED' && !l.externalTxnId).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).map((stmt) => {
                    const matched = autoReconMatches.find(m => m.stmtLine.lineId === stmt.lineId && m.confirmed);
                    return (
                      <div
                        key={stmt.lineId}
                        style={{
                          background: matched ? '#f6ffed' : '#fff',
                          border: matched ? '1px solid #b7eb8f' : '1px solid #e8e8e8',
                          borderRadius: 4,
                          padding: 8,
                          marginBottom: 6,
                          cursor: 'pointer',
                          fontSize: 11,
                          opacity: matched ? 1 : 0.8,
                        }}
                        onClick={() => {
                          // Would allow manual selection
                        }}
                      >
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>Line #{stmt.lineId}</div>
                        <div style={{ color: '#595959', marginBottom: 2 }}>{stmt.transactionDate?.slice(0, 10)} • {stmt.transactionCode}</div>
                        <div style={{ fontWeight: 600, color: matched ? '#52c41a' : '#000', marginBottom: 2 }}>
                          {formatSignedAmount(Math.abs(stmt.amount))}
                        </div>
                        {stmt.description && <div style={{ color: '#8c8c8c', fontSize: 10 }}>{stmt.description.substring(0, 40)}</div>}
                        {matched && <div style={{ color: '#52c41a', fontSize: 10, marginTop: 4, fontWeight: 500 }}>✓ Matched</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* System Transactions */}
              <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
                <div style={{ padding: '10px 12px', background: '#f9f0ff', borderBottom: '1px solid #d9d9d9', fontWeight: 600, fontSize: 12, color: '#722ed1' }}>
                  System Transactions ({(autoReconTxnType === 'ALL' || autoReconTxnType === 'CM' ? sysTxns : sysTxns.filter(t => t.source === autoReconTxnType)).filter(t => !t.reconciledFlag || t.reconciledFlag === 'N').length})
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                  {(autoReconTxnType === 'ALL' || autoReconTxnType === 'CM' ? sysTxns : sysTxns.filter(t => t.source === autoReconTxnType))
                    .filter(t => !t.reconciledFlag || t.reconciledFlag === 'N')
                    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                    .map((txn) => {
                      const matched = autoReconMatches.find(m => sysTxnRowKey(m.sysTxn) === sysTxnRowKey(txn) && m.confirmed);
                      return (
                        <div
                          key={sysTxnRowKey(txn)}
                          style={{
                            background: matched ? '#f6ffed' : '#fff',
                            border: matched ? '1px solid #b7eb8f' : '1px solid #e8e8e8',
                            borderRadius: 4,
                            padding: 8,
                            marginBottom: 6,
                            cursor: 'pointer',
                            fontSize: 11,
                            opacity: matched ? 1 : 0.8,
                          }}
                          onClick={() => {
                            // Would allow manual selection
                          }}
                        >
                          <div style={{ fontWeight: 500, marginBottom: 2 }}>{txn.txnNumber}</div>
                          <div style={{ color: '#595959', marginBottom: 2 }}>{txn.txnDate?.slice(0, 10)} • {txn.source?.replace('_', ' ')}</div>
                          <div style={{ fontWeight: 600, color: matched ? '#52c41a' : '#000', marginBottom: 2 }}>
                            {formatSignedAmount(Math.abs(txn.amount))}
                          </div>
                          {txn.payee && <div style={{ color: '#8c8c8c', fontSize: 10 }}>{txn.payee.substring(0, 40)}</div>}
                          {matched && <div style={{ color: '#52c41a', fontSize: 10, marginTop: 4, fontWeight: 500 }}>✓ Matched</div>}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Old matching details (collapsed) */}
      {autoReconMatches.length > 0 && (
        <Collapse
          style={{ marginTop: 16 }}
          items={[{
            key: 'details',
            label: 'Matching Details Table',
            children: (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
                    Found <strong>{autoReconMatches.length}</strong> match(es). Uncheck any pairs you don't want to reconcile.
                  </div>
                  <Table<AutoReconMatch>
                    size="small"
                    dataSource={autoReconMatches.map((m, idx) => ({ ...m, _idx: idx }))}
                    rowKey="_idx"
                    pagination={false}
                    scroll={{ x: 800, y: 250 }}
                    columns={[
                      {
                        title: 'Select',
                        key: 'select',
                        width: 50,
                        align: 'center',
                        render: (_: any, record: any) => (
                          <Checkbox
                            checked={record.confirmed}
                            disabled={record.status !== 'pending'}
                            onChange={e => {
                              const copy = [...autoReconMatches];
                              copy[record._idx] = { ...record, confirmed: e.target.checked };
                              setAutoReconMatches(copy);
                            }}
                          />
                        ),
                      },
                      {
                        title: 'Bank Statement Line',
                        dataIndex: 'stmtLine',
                        key: 'stmt',
                        width: 200,
                        render: (line: StmtLine) => (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 500 }}>{line.description || line.reference || `Line #${line.lineId}`}</div>
                            <div style={{ fontSize: 10, color: '#8c8c8c' }}>
                              {line.transactionDate?.slice(0, 10)} • {line.transactionCode} • {formatSignedAmount(line.amount)}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: 'Criteria',
                        dataIndex: 'matchedBy',
                        key: 'criteria',
                        width: 150,
                        render: (criteria: string[]) => (
                          <Space size={4}>
                            {criteria.map(c => <Tag key={c} color="purple" style={{ fontSize: 10, margin: 0 }}>{c}</Tag>)}
                          </Space>
                        ),
                      },
                      {
                        title: 'System Transaction',
                        dataIndex: 'sysTxn',
                        key: 'sys',
                        width: 200,
                        render: (txn: SysTxn) => (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 500 }}>{txn.payee || txn.txnNumber}</div>
                            <div style={{ fontSize: 10, color: '#8c8c8c' }}>
                              {txn.txnDate?.slice(0, 10)} • {txn.source?.replace('_', ' ')} • {formatSignedAmount(txn.amount)}
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        key: 'status',
                        width: 80,
                        align: 'center',
                        render: (status: string, record: any) => {
                          if (status === 'success') return <Tag color="success">Done</Tag>;
                          if (status === 'error') return <Tag color="error">{record.errorMsg || 'Failed'}</Tag>;
                          return <Tag color="processing">Pending</Tag>;
                        },
                      },
                    ]}
                  />
                </div>
                <Divider style={{ margin: '12px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', marginTop: 12 }}>
                  {autoReconMatches.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        border: `1px solid ${m.status === 'success' ? '#b7eb8f' : m.status === 'error' ? '#ffccc7' : '#d9d9d9'}`,
                        borderRadius: 8,
                        padding: '10px 14px',
                        background: m.status === 'success' ? '#f6ffed' : m.status === 'error' ? '#fff2f0' : m.confirmed ? '#fff' : '#fafafa',
                        opacity: m.confirmed ? 1 : 0.5,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <Checkbox
                          checked={m.confirmed}
                          disabled={m.status !== 'pending'}
                          onChange={e => {
                            const copy = [...autoReconMatches];
                            copy[idx] = { ...m, confirmed: e.target.checked };
                            setAutoReconMatches(copy);
                          }}
                        />
                        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center' }}>
                          {/* Statement side */}
                          <div style={{ background: '#e6f4ff', borderRadius: 6, padding: '6px 10px' }}>
                            <div style={{ fontSize: 10, color: '#1677ff', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase' }}>Bank Statement Line</div>
                            <div style={{ fontWeight: 500, fontSize: 12 }}>{m.stmtLine.description || m.stmtLine.reference || `Line #${m.stmtLine.lineId}`}</div>
                            <div style={{ fontSize: 11, color: '#595959', marginTop: 2 }}>
                              <Space size={6}>
                                <span>{m.stmtLine.transactionDate?.slice(0, 10)}</span>
                                <Tag color={m.stmtLine.transactionCode === 'CR' ? 'volcano' : 'blue'} style={{ margin: 0, fontSize: 10 }}>{m.stmtLine.transactionCode}</Tag>
                                <strong>{formatSignedAmount(m.stmtLine.amount)}</strong>
                              </Space>
                            </div>
                            {m.stmtLine.reference && <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>Ref: {m.stmtLine.reference}</div>}
                            {m.matchedBy.includes('Amount') && <div style={{ fontSize: 9, color: '#0050b3', marginTop: 3, padding: '2px 4px', background: '#e6f7ff', borderRadius: 2 }}>
                              Exact Match: {formatSignedAmount(m.stmtLine.amount)}
                            </div>}
                          </div>

                          {/* Match badges */}
                          <div style={{ textAlign: 'center' }}>
                            {m.status === 'success' && <Tag color="success">Reconciled</Tag>}
                            {m.status === 'error'   && <Tag color="error">{m.errorMsg || 'Failed'}</Tag>}
                            {m.status === 'pending' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                                <span style={{ fontSize: 16, color: '#52c41a' }}>⇄</span>
                                {m.matchedBy.map(r => {
                                  // For Amount matches, show the actual values compared
                                  if (r === 'Amount') {
                                    const match = m.stmtLine.amount === m.sysTxn.amount;
                                    return (
                                      <Tooltip key={r} title={`Exact: Stmt ${formatSignedAmount(m.stmtLine.amount)} = Sys ${formatSignedAmount(m.sysTxn.amount)} ${match ? '✓' : '✗'}`}>
                                        <Tag color={match ? 'purple' : 'red'} style={{ margin: 0, fontSize: 10, cursor: 'help' }}>{r}</Tag>
                                      </Tooltip>
                                    );
                                  }
                                  return <Tag key={r} color="purple" style={{ margin: 0, fontSize: 10 }}>{r}</Tag>;
                                })}
                              </div>
                            )}
                          </div>

                          {/* System txn side */}
                          <div style={{ background: '#f9f0ff', borderRadius: 6, padding: '6px 10px' }}>
                            <div style={{ fontSize: 10, color: '#722ed1', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase' }}>System Transaction</div>
                            <div style={{ fontWeight: 500, fontSize: 12 }}>{m.sysTxn.payee || m.sysTxn.txnNumber}</div>
                            <div style={{ fontSize: 11, color: '#595959', marginTop: 2 }}>
                              <Space size={6}>
                                <span>{m.sysTxn.txnDate?.slice(0, 10)}</span>
                                <Tag color="geekblue" style={{ margin: 0, fontSize: 10 }}>{m.sysTxn.source?.replace('_', ' ')}</Tag>
                                <strong>{formatSignedAmount(m.sysTxn.amount)}</strong>
                              </Space>
                            </div>
                            {m.sysTxn.txnNumber && <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>#{m.sysTxn.txnNumber}</div>}
                            {m.matchedBy.includes('Amount') && <div style={{ fontSize: 9, color: '#592d00', marginTop: 3, padding: '2px 4px', background: '#fff1f0', borderRadius: 2 }}>
                              Exact Match: {formatSignedAmount(m.sysTxn.amount)}
                            </div>}
                          </div>
                        </div>
                      </div>

                      {/* API calls preview for this pair */}
                      {(() => {
                        const txnSide = buildTxnSideCall(m.sysTxn, m.stmtLine);
                        const stmtPostUrl  = `${APEX_BASE}/cash/bankstatements/${m.stmtLine.statementId}/reconcile`;
                        const stmtPostBody = { lineId: m.stmtLine.lineId, txnType: m.sysTxn.source, txnId: m.sysTxn.txnId, txnNumber: m.sysTxn.txnNumber, reconAmount: m.stmtLine.amount, notes: 'Auto Reconciled' };
                        return (
                          <Collapse ghost size="small" style={{ marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 4 }}
                            items={[{
                              key: 'api',
                              label: <Space style={{ fontSize: 11 }}><ApiOutlined style={{ color: REDWOOD.info }} /><span style={{ color: REDWOOD.info }}>API calls for this pair</span></Space>,
                              children: (
                                <div style={{ fontSize: 10, fontFamily: 'monospace' }}>
                                  <div style={{ marginBottom: 4 }}>
                                    <Tag color="green" style={{ fontSize: 9 }}>POST</Tag>
                                    <span style={{ color: REDWOOD.info, wordBreak: 'break-all' }}>{stmtPostUrl}</span>
                                  </div>
                                  <pre style={{ background: '#1e1e1e', color: '#9cdcfe', padding: 6, borderRadius: 4, fontSize: 10, margin: '0 0 8px', overflowX: 'auto' }}>
                                    {JSON.stringify(stmtPostBody, null, 2)}
                                  </pre>
                                  <div style={{ marginBottom: 4 }}>
                                    <Tag color="orange" style={{ fontSize: 9 }}>PUT</Tag>
                                    <span style={{ color: REDWOOD.info, wordBreak: 'break-all' }}>{txnSide.url}</span>
                                  </div>
                                  <pre style={{ background: '#1e1e1e', color: '#9cdcfe', padding: 6, borderRadius: 4, fontSize: 10, margin: 0, overflowX: 'auto' }}>
                                    {JSON.stringify(txnSide.body, null, 2)}
                                  </pre>
                                </div>
                              ),
                            }]}
                          />
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}
          ]}}
          />
        )}
      </Modal>

      {/* ── Matching View Modal (Simple table format) ──────────────── */}
      <Modal
        title={<Space><LinkOutlined style={{ color: '#1890ff' }} /><span>Matching Analysis</span></Space>}
        open={matchingViewOpen}
        onCancel={() => setMatchingViewOpen(false)}
        footer={<Button onClick={() => setMatchingViewOpen(false)}>Close</Button>}
        width={1400}
        bodyStyle={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}
      >
        {(() => {
          const [viewMode, setViewMode] = React.useState<'bank-to-sys' | 'sys-to-bank'>('bank-to-sys');

          const handleExportMatching = () => {
            const ws_data: any[] = [];
            if (viewMode === 'bank-to-sys') {
              ws_data.push(['Statement ID', 'Line ID', 'Reference', 'Type', 'Bank Amount', 'System Txn(s)', 'Sys Type', 'Date', 'Sys Amount', 'Difference']);
              matches.forEach(m => {
                ws_data.push([
                  m.bankLine?.statementId || '',
                  m.bankLine?.lineId || '',
                  m.bankLine?.reference || '',
                  m.bankLine?.transactionCode || '',
                  m.totalBankAmount || 0,
                  m.sysTxns?.map(t => t.txnNumber).join(', ') || '—',
                  m.sysTxns?.[0]?.source?.replace('_', ' ') || '—',
                  m.sysTxns?.[0]?.txnDate?.slice(0, 10) || m.bankLine?.transactionDate?.slice(0, 10) || '',
                  m.totalSysAmount || 0,
                  m.difference || 0,
                ]);
              });
              ws_data.push(['', '', '', 'TOTAL', totalBankSum, '', '', '', totalSysSum, totalBankSum - totalSysSum]);
            } else {
              ws_data.push(['Txn ID', 'Payee', 'Type', 'Sys Amount', 'Bank Line(s)', 'Bank Type', 'Date', 'Bank Amount', 'Difference']);
              matches.forEach(m => {
                ws_data.push([
                  m.sysTxn?.txnNumber || '',
                  m.sysTxn?.payee || m.sysTxn?.customerName || '',
                  m.sysTxn?.source?.replace('_', ' ') || '',
                  m.totalSysAmount || 0,
                  m.bankLines?.map(l => `#${l.lineId}`).join(', ') || '—',
                  m.bankLines?.[0]?.transactionCode || '—',
                  m.sysTxn?.txnDate?.slice(0, 10) || '',
                  m.totalBankAmount || 0,
                  m.difference || 0,
                ]);
              });
              ws_data.push(['', '', '', totalSysSum, '', '', '', totalBankSum, totalBankSum - totalSysSum]);
            }
            const ws = XLSX.utils.aoa_to_sheet(ws_data);
            ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `Matching-${viewMode}`);
            const timestamp = dayjs().format('YYYY-MM-DD_HHmmss');
            XLSX.writeFile(wb, `matching-${viewMode}-${timestamp}.xlsx`);
          };

          const buildMatches = () => {
            const matches: Array<{
              bankLine?: typeof filteredStmtLines[0];
              sysTxns?: typeof filteredSysTxns;
              sysTxn?: typeof filteredSysTxns[0];
              bankLines?: typeof filteredStmtLines;
              totalBankAmount: number;
              totalSysAmount: number;
              difference: number;
              matchType: '1:1' | '1:N' | 'N:1' | 'No Match';
            }> = [];

            if (viewMode === 'bank-to-sys') {
              filteredStmtLines.forEach(bankLine => {
                const matchedSysTxns = filteredSysTxns.filter(t => t.amount === bankLine.amount);
                const totalSysAmount = matchedSysTxns.reduce((sum, t) => sum + t.amount, 0);
                const difference = bankLine.amount - totalSysAmount;

                matches.push({
                  bankLine,
                  sysTxns: matchedSysTxns,
                  totalBankAmount: bankLine.amount,
                  totalSysAmount,
                  difference,
                  matchType: matchedSysTxns.length === 0 ? 'No Match' : matchedSysTxns.length === 1 ? '1:1' : '1:N',
                });
              });
            } else {
              filteredSysTxns.forEach(sysTxn => {
                const matchedBankLines = filteredStmtLines.filter(l => l.amount === sysTxn.amount);
                const totalBankAmount = matchedBankLines.reduce((sum, l) => sum + l.amount, 0);
                const difference = totalBankAmount - sysTxn.amount;

                matches.push({
                  sysTxn,
                  bankLines: matchedBankLines,
                  totalBankAmount,
                  totalSysAmount: sysTxn.amount,
                  difference,
                  matchType: matchedBankLines.length === 0 ? 'No Match' : matchedBankLines.length === 1 ? '1:1' : 'N:1',
                });
              });
            }
            return matches;
          };

          const matches = buildMatches();
          const matchedCount = matches.filter(m => m.matchType !== 'No Match').length;
          const totalBankSum = matches.reduce((sum, m) => sum + m.totalBankAmount, 0);
          const totalSysSum = matches.reduce((sum, m) => sum + m.totalSysAmount, 0);

          return (
            <div>
              {/* Toggle & Summary */}
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Text strong>View:</Text>
                  <Button.Group>
                    <Button
                      type={viewMode === 'bank-to-sys' ? 'primary' : 'default'}
                      onClick={() => setViewMode('bank-to-sys')}
                      size="small"
                    >
                      Bank → System
                    </Button>
                    <Button
                      type={viewMode === 'sys-to-bank' ? 'primary' : 'default'}
                      onClick={() => setViewMode('sys-to-bank')}
                      size="small"
                    >
                      System → Bank
                    </Button>
                  </Button.Group>
                </div>
                <Space split={<Divider type="vertical" />} style={{ fontSize: 12 }}>
                  <div><Text strong>Matched:</Text> <Tag color="green">{matchedCount}</Tag></div>
                  <div><Text strong>Unmatched:</Text> <Tag color="red">{matches.filter(m => m.matchType === 'No Match').length}</Tag></div>
                  <div><Text strong>Difference:</Text> <Text style={{ color: Math.abs(totalBankSum - totalSysSum) < 0.01 ? REDWOOD.success : REDWOOD.warning, fontWeight: 600 }}>{fmtAmount(totalBankSum - totalSysSum)}</Text></div>
                  <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={handleExportMatching}>Export</Button>
                </Space>
              </div>

              {/* Simple Matching Table */}
              <Table
                size="small"
                dataSource={matches}
                pagination={false}
                rowKey={(_, idx) => idx}
                scroll={{ x: 1100 }}
                columns={viewMode === 'bank-to-sys' ? [
                  {
                    title: 'Statement ID',
                    width: 90,
                    render: (_, rec) => <Text style={{ fontSize: 11 }}>{rec.bankLine?.statementId}</Text>,
                  },
                  {
                    title: 'Line ID',
                    width: 70,
                    render: (_, rec) => <Text strong>{rec.bankLine?.lineId}</Text>,
                  },
                  {
                    title: 'Reference',
                    width: 100,
                    render: (_, rec) => <Text style={{ fontSize: 11 }}>{rec.bankLine?.reference?.substring(0, 15)}</Text>,
                  },
                  {
                    title: 'Type',
                    width: 60,
                    render: (_, rec) => <Text style={{ fontSize: 11 }}>{rec.bankLine?.transactionCode}</Text>,
                  },
                  {
                    title: 'Bank Amount',
                    width: 95,
                    align: 'right',
                    render: (_, rec) => <Text strong>{fmtAmount(rec.totalBankAmount)}</Text>,
                  },
                  {
                    title: 'System Txn(s)',
                    width: 110,
                    render: (_, rec) => (
                      rec.sysTxns && rec.sysTxns.length > 0
                        ? <Text style={{ fontSize: 11 }}>{rec.sysTxns.map(t => t.txnNumber).join(', ')}</Text>
                        : <Text type="danger">—</Text>
                    ),
                  },
                  {
                    title: 'Sys Type',
                    width: 80,
                    render: (_, rec) => (
                      rec.sysTxns && rec.sysTxns.length > 0
                        ? <Tag color="geekblue" style={{ fontSize: 10, margin: 0 }}>{rec.sysTxns[0]?.source?.replace('_', ' ')}</Tag>
                        : <Text type="danger">—</Text>
                    ),
                  },
                  {
                    title: 'Date',
                    width: 75,
                    render: (_, rec) => <Text style={{ fontSize: 11 }}>{rec.sysTxns?.[0]?.txnDate?.slice(0, 10) || rec.bankLine?.transactionDate?.slice(0, 10)}</Text>,
                  },
                  {
                    title: 'Sys Amount',
                    width: 95,
                    align: 'right',
                    render: (_, rec) => <Text style={{ color: rec.sysTxns && rec.sysTxns.length > 0 ? REDWOOD.success : REDWOOD.error }}>{fmtAmount(rec.totalSysAmount)}</Text>,
                  },
                  {
                    title: 'Difference',
                    width: 85,
                    align: 'right',
                    render: (_, rec) => <Text style={{ color: Math.abs(rec.difference) < 0.01 ? REDWOOD.success : REDWOOD.warning, fontWeight: 500 }}>{fmtAmount(rec.difference)}</Text>,
                  },
                ] : [
                  {
                    title: 'System Txn ID',
                    width: 80,
                    render: (_, rec) => <Text>{rec.sysTxn?.txnNumber}</Text>,
                  },
                  {
                    title: 'Payee',
                    width: 120,
                    render: (_, rec) => <Text style={{ fontSize: 11 }}>{rec.sysTxn?.payee?.substring(0, 20)}</Text>,
                  },
                  {
                    title: 'Type',
                    width: 70,
                    render: (_, rec) => <Tag color="geekblue" style={{ fontSize: 10, margin: 0 }}>{rec.sysTxn?.source?.replace('_', ' ')}</Tag>,
                  },
                  {
                    title: 'Sys Amount',
                    width: 90,
                    align: 'right',
                    render: (_, rec) => <Text strong>{fmtAmount(rec.totalSysAmount)}</Text>,
                  },
                  {
                    title: 'Bank Line(s)',
                    width: 100,
                    render: (_, rec) => (
                      rec.bankLines && rec.bankLines.length > 0
                        ? <Text style={{ fontSize: 11 }}>{rec.bankLines.map(l => `#${l.lineId}`).join(', ')}</Text>
                        : <Text type="danger">—</Text>
                    ),
                  },
                  {
                    title: 'Bank Type',
                    width: 70,
                    render: (_, rec) => (
                      rec.bankLines && rec.bankLines.length > 0
                        ? <Text style={{ fontSize: 11 }}>{rec.bankLines[0]?.transactionCode}</Text>
                        : <Text type="danger">—</Text>
                    ),
                  },
                  {
                    title: 'Date',
                    width: 80,
                    render: (_, rec) => <Text style={{ fontSize: 11 }}>{rec.sysTxn?.txnDate?.slice(0, 10)}</Text>,
                  },
                  {
                    title: 'Bank Amount',
                    width: 90,
                    align: 'right',
                    render: (_, rec) => <Text style={{ color: rec.bankLines && rec.bankLines.length > 0 ? REDWOOD.success : REDWOOD.error }}>{fmtAmount(rec.totalBankAmount)}</Text>,
                  },
                  {
                    title: 'Difference',
                    width: 80,
                    align: 'right',
                    render: (_, rec) => <Text style={{ color: Math.abs(rec.difference) < 0.01 ? REDWOOD.success : REDWOOD.warning, fontWeight: 500 }}>{fmtAmount(rec.difference)}</Text>,
                  },
                ]}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ fontWeight: 600, background: REDWOOD.neutral100 }}>
                      <Table.Summary.Cell colSpan={3} align="right"><Text strong>TOTAL</Text></Table.Summary.Cell>
                      <Table.Summary.Cell align="right"><Text strong>{fmtAmount(totalBankSum)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell colSpan={3} />
                      <Table.Summary.Cell align="right"><Text strong>{fmtAmount(totalSysSum)}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell align="right"><Text strong style={{ color: Math.abs(totalBankSum - totalSysSum) < 0.01 ? REDWOOD.success : REDWOOD.warning }}>{fmtAmount(totalBankSum - totalSysSum)}</Text></Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
            </div>
          );
        })()}
      </Modal>


      {/* Shared API Debug Modal */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>{apiModalTitle}</span></Space>}
        open={apiModalVisible}
        onCancel={() => setApiModalVisible(false)}
        footer={<Button onClick={() => setApiModalVisible(false)}>Close</Button>}
        width={680}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Space style={{ marginBottom: 4 }}>
            <Tag color="blue" style={{ margin: 0 }}>GET</Tag>
            <Text strong style={{ fontSize: 12 }}>URL</Text>
          </Space>
          <div style={{ background: '#1e1e1e', borderRadius: 4, padding: '8px 12px', marginBottom: 4 }}>
            <code style={{ fontSize: 11, color: '#9cdcfe', wordBreak: 'break-all' }}>{apiModalUrl}</code>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              loading={apiExecResult.loading}
              onClick={async () => {
                if (!apiModalUrl) return;
                setApiExecResult({ loading: true, response: null });
                try {
                  const res = await fetch(apiModalUrl, { headers: { Accept: 'application/json' } });
                  const text = await res.text();
                  let formatted = text;
                  try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
                  setApiExecResult({ loading: false, response: `HTTP ${res.status}\n\n${formatted}` });
                } catch (e: any) {
                  setApiExecResult({ loading: false, response: `Error: ${e.message}` });
                }
              }}
            >
              Test
            </Button>
          </div>
          {apiExecResult.response && (
            <div style={{ background: '#1e1e1e', borderRadius: 4, padding: '8px 12px', maxHeight: 320, overflow: 'auto' }}>
              <pre style={{
                margin: 0, fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                color: apiExecResult.response.startsWith('HTTP 2') ? '#4ec9b0' : '#f48771',
              }}>
                {apiExecResult.response}
              </pre>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Auto Reconciliation API Inspector ─────────────────────────────── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>Auto Reconciliation — API Endpoints</span></Space>}
        open={autoReconApiOpen}
        onCancel={() => setAutoReconApiOpen(false)}
        footer={<Button onClick={() => setAutoReconApiOpen(false)}>Close</Button>}
        width={620}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#1677ff' }}>
            <CheckCircleOutlined style={{ marginRight: 6 }} />
            These are the <strong>same endpoints</strong> used by the main Bank Reconciliation screen — no separate APIs.
          </div>

          {/* Find Matches */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tag color="geekblue" style={{ margin: 0 }}>GET</Tag>
              <span>Find Matches — System Transactions</span>
            </div>
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: '#79c0ff', wordBreak: 'break-all' }}>
              {`${APEX_BASE}/cash/reconciliation/systxns?bank_account=...&date_from=...&date_to=...&reconciled=N&row_limit=500`}
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
              Backed by <code>RR_V_BANK_RECON_SYSTXNS</code> — same view as the System Transactions panel.
              Matching is performed client-side against the selected criteria.
            </div>
          </div>

          {/* Reconcile Step 1 */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tag color="green" style={{ margin: 0 }}>POST</Tag>
              <span>Reconcile (Step 1) — Bank Statement Line</span>
            </div>
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: '#79c0ff', wordBreak: 'break-all' }}>
              {`${APEX_BASE}/cash/bankstatements/{statementId}/reconcile`}
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
              Marks the bank statement line as reconciled. Body: <code>lineId, txnType, txnId, txnNumber, reconAmount, notes</code>
            </div>
          </div>

          {/* Reconcile Step 2 */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tag color="orange" style={{ margin: 0 }}>PUT</Tag>
              <span>Reconcile (Step 2) — System Transaction</span>
            </div>
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: '#79c0ff', wordBreak: 'break-all' }}>
              {`${APEX_BASE}/cash/reconciliation/systxns/{txnId}`}
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
              Updates the system transaction (AP Payment / External Txn / Bank Transfer) with reconciliation details.
              Body varies by source: <code>source, reconciledDate, statementId, stmtLineId</code>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Add Statement Line Modal ─────────────────────────────────────────── */}
      <Modal
        title={
          <Space>
            <PlusOutlined style={{ color: REDWOOD.success }} />
            <span>Add Statement Line</span>
            {selectedStatement && (
              <Tag color="blue" style={{ marginLeft: 4 }}>
                {selectedStatement.statementNumber}
              </Tag>
            )}
          </Space>
        }
        open={addLineOpen}
        onCancel={() => setAddLineOpen(false)}
        width={540}
        footer={null}
        destroyOnClose
      >
        <Form
          form={addLineForm}
          layout="vertical"
          size="small"
          onFinish={handleAddLineSubmit}
          style={{ marginTop: 8 }}
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="transactionDate"
                label="Transaction Date"
                rules={[{ required: true, message: 'Required' }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="valueDate" label="Value Date">
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="amount"
                label="Amount"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  precision={2}
                  placeholder="0.00"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="transactionCode"
                label="Dr / Cr"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Select>
                  <Option value="DR">DR — Debit (Money Out)</Option>
                  <Option value="CR">CR — Credit (Money In)</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Transaction description" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="reference" label="Reference">
                <Input placeholder="Internal reference" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bankTxnReference" label="Bank Txn Reference">
                <Input placeholder="Bank reference" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="counterpartyName" label="Counterparty Name">
            <Input placeholder="Payer / payee name" />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Button onClick={() => setAddLineOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={addLineSaving}
              style={{ backgroundColor: REDWOOD.success, borderColor: REDWOOD.success }}
            >
              Add Line
            </Button>
          </div>
        </Form>
      </Modal>

      {/* ── Unreconcile confirmation Modal ───────────────────────────── */}
      <Modal
        open={!!unreconModal}
        title={
          <Space>
            <UndoOutlined style={{ color: REDWOOD.error }} />
            <span>Confirm Unreconcile</span>
          </Space>
        }
        onCancel={() => { if (!unreconLoading) setUnreconModal(null); }}
        footer={null}
        width={560}
        destroyOnHidden
      >
        {unreconModal?.type === 'SYS' && unreconModal.sysTxn && (() => {
          const t = unreconModal.sysTxn;
          const today = new Date().toISOString().split('T')[0];
          const isBankTransfer = t.source === 'BANK_TRANSFER' || t.source === 'GL_BANK_TRANSFER';
          const isGlJournal    = t.source === 'GL_JOURNAL';
          const pathId = isBankTransfer ? t.txnNumber : isGlJournal ? t.jeHeaderId : t.txnId;
          const linkedLine = stmtLines.find(l => l.reconStatus === 'RECONCILED' && (l.reconTxnNumber === t.txnNumber || l.externalTxnId === t.txnId));

          const sysTxnUrl  = `${APEX_BASE}/cash/reconciliation/systxns/${pathId}`;
          const sysTxnBody = {
            action: 'UNRECON', source: t.source, reconciledDate: today, reconciledBy: currentUser,
            statementId: linkedLine?.statementId ?? null, stmtLineId: linkedLine?.lineId ?? null,
            ...(isBankTransfer ? { transferId: t.txnNumber, jeHeaderId: t.jeHeaderId, jeLineNumber: (t as any).jeLineNumber } : {}),
            ...(isGlJournal    ? { jeHeaderId: t.jeHeaderId, jeLineNumber: (t as any).jeLineNumber } : {}),
          };
          const stmtUrl  = linkedLine ? `${APEX_BASE}/cash/reconciliation/unreconstmtlines/${linkedLine.lineId}` : null;
          const stmtBody = { action: 'UNRECON', reconciledBy: currentUser };

          return (
            <div>
              <p>You are about to unreconcile system transaction <strong>{t.txnNumber}</strong> ({t.source}).</p>
              {linkedLine && (
                <p style={{ color: REDWOOD.neutral600, fontSize: 13 }}>
                  Connected statement line found: <strong>Line #{linkedLine.lineId}</strong> ({linkedLine.transactionDate}, {fmtAmount(linkedLine.amount)}).
                  Do you also want to unreconcile it?
                </p>
              )}

              {/* API Preview */}
              <Collapse ghost size="small" style={{ marginTop: 12, background: '#f8f8f8', borderRadius: 6, border: '1px solid #e8e8e8' }}
                items={[{
                  key: '1',
                  label: <Space style={{ fontSize: 12 }}><ApiOutlined style={{ color: REDWOOD.info }} /><span style={{ color: REDWOOD.info }}>API calls that will be made</span></Space>,
                  children: (
                    <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="orange" style={{ fontSize: 10 }}>PUT</Tag>
                        <span style={{ color: REDWOOD.info, wordBreak: 'break-all' }}>{sysTxnUrl}</span>
                      </div>
                      <pre style={{ background: '#1e1e1e', color: '#9cdcfe', padding: 8, borderRadius: 4, fontSize: 11, margin: '0 0 8px', overflowX: 'auto' }}>
                        {JSON.stringify(sysTxnBody, null, 2)}
                      </pre>
                      {stmtUrl && (
                        <>
                          <div style={{ marginBottom: 4, color: REDWOOD.neutral600, fontSize: 11 }}>+ if "unreconcile both":</div>
                          <div style={{ marginBottom: 8 }}>
                            <Tag color="orange" style={{ fontSize: 10 }}>PUT</Tag>
                            <span style={{ color: REDWOOD.info, wordBreak: 'break-all' }}>{stmtUrl}</span>
                          </div>
                          <pre style={{ background: '#1e1e1e', color: '#9cdcfe', padding: 8, borderRadius: 4, fontSize: 11, margin: 0, overflowX: 'auto' }}>
                            {JSON.stringify(stmtBody, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  ),
                }]}
              />

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <Button onClick={() => setUnreconModal(null)} disabled={unreconLoading}>Cancel</Button>
                {linkedLine && (
                  <Button danger loading={unreconLoading} onClick={() => doUnrecon(t, true, linkedLine)}>
                    Yes, unreconcile both
                  </Button>
                )}
                <Button type="primary" danger loading={unreconLoading} onClick={() => doUnrecon(t, false)}>
                  {linkedLine ? 'Only this transaction' : 'Unreconcile'}
                </Button>
              </div>
            </div>
          );
        })()}

        {unreconModal?.type === 'STMT' && unreconModal.stmtLine && (() => {
          const l = unreconModal.stmtLine!;
          const linkedSys = l.reconTxnNumber
            ? sysTxns.find(t => t.txnNumber === l.reconTxnNumber || t.txnId === l.externalTxnId)
            : undefined;

          const stmtUrl  = `${APEX_BASE}/cash/reconciliation/unreconstmtlines/${l.lineId}`;
          const stmtBody = { action: 'UNRECON', reconciledBy: currentUser };

          const sysTxnUrl = linkedSys ? (() => {
            const isBT = linkedSys.source === 'BANK_TRANSFER' || linkedSys.source === 'GL_BANK_TRANSFER';
            const isGL = linkedSys.source === 'GL_JOURNAL';
            const pid  = isBT ? linkedSys.txnNumber : isGL ? linkedSys.jeHeaderId : linkedSys.txnId;
            return `${APEX_BASE}/cash/reconciliation/systxns/${pid}`;
          })() : null;
          const sysTxnBody = linkedSys ? (() => {
            const isBT = linkedSys.source === 'BANK_TRANSFER' || linkedSys.source === 'GL_BANK_TRANSFER';
            const isGL = linkedSys.source === 'GL_JOURNAL';
            return {
              action: 'UNRECON', source: linkedSys.source,
              reconciledDate: new Date().toISOString().split('T')[0],
              reconciledBy: currentUser,
              statementId: l.statementId, stmtLineId: l.lineId,
              ...(isBT ? { transferId: linkedSys.txnNumber, jeHeaderId: linkedSys.jeHeaderId, jeLineNumber: (linkedSys as any).jeLineNumber } : {}),
              ...(isGL ? { jeHeaderId: linkedSys.jeHeaderId, jeLineNumber: (linkedSys as any).jeLineNumber } : {}),
            };
          })() : null;

          return (
            <div>
              <p>You are about to unreconcile bank statement line <strong>#{l.lineId}</strong> ({l.transactionDate}, {fmtAmount(l.amount)}).</p>
              {linkedSys && (
                <p style={{ color: REDWOOD.neutral600, fontSize: 13 }}>
                  Connected system transaction found: <strong>{linkedSys.txnNumber}</strong> ({linkedSys.source}).
                  Do you also want to unreconcile it?
                </p>
              )}

              {/* API Preview */}
              <Collapse ghost size="small" style={{ marginTop: 12, background: '#f8f8f8', borderRadius: 6, border: '1px solid #e8e8e8' }}
                items={[{
                  key: '1',
                  label: <Space style={{ fontSize: 12 }}><ApiOutlined style={{ color: REDWOOD.info }} /><span style={{ color: REDWOOD.info }}>API calls that will be made</span></Space>,
                  children: (
                    <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="orange" style={{ fontSize: 10 }}>PUT</Tag>
                        <span style={{ color: REDWOOD.info, wordBreak: 'break-all' }}>{stmtUrl}</span>
                      </div>
                      <pre style={{ background: '#1e1e1e', color: '#9cdcfe', padding: 8, borderRadius: 4, fontSize: 11, margin: '0 0 8px', overflowX: 'auto' }}>
                        {JSON.stringify(stmtBody, null, 2)}
                      </pre>
                      {sysTxnUrl && sysTxnBody && (
                        <>
                          <div style={{ marginBottom: 4, color: REDWOOD.neutral600, fontSize: 11 }}>+ if "unreconcile both":</div>
                          <div style={{ marginBottom: 8 }}>
                            <Tag color="orange" style={{ fontSize: 10 }}>PUT</Tag>
                            <span style={{ color: REDWOOD.info, wordBreak: 'break-all' }}>{sysTxnUrl}</span>
                          </div>
                          <pre style={{ background: '#1e1e1e', color: '#9cdcfe', padding: 8, borderRadius: 4, fontSize: 11, margin: 0, overflowX: 'auto' }}>
                            {JSON.stringify(sysTxnBody, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  ),
                }]}
              />

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <Button onClick={() => setUnreconModal(null)} disabled={unreconLoading}>Cancel</Button>
                {linkedSys && (
                  <Button danger loading={unreconLoading} onClick={() => doUnrecon(linkedSys, true, l)}>
                    Yes, unreconcile both
                  </Button>
                )}
                <Button type="primary" danger loading={unreconLoading} onClick={() => doUnreconStmtOnly(l)}>
                  {linkedSys ? 'Only this statement line' : 'Unreconcile'}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Claude AI Reconciliation Viewer Modal ───────────────────────────────── */}
      <Modal
        open={claudeReconOpen}
        onCancel={() => {
          setClaudeReconOpen(false);
          setClaudeResult(null);
          setClaudeError('');
        }}
        width={1200}
        footer={null}
        bodyStyle={{ maxHeight: '80vh', overflowY: 'auto' }}
        title={
          <Space>
            <RobotOutlined style={{ color: REDWOOD.info }} />
            Claude AI Bank Reconciliation
          </Space>
        }
      >
        <ReconciliationViewer
          result={claudeResult}
          loading={claudeLoading}
          error={claudeError}
          stmtLines={stmtLines}
          sysTxns={sysTxns}
          bankAccountName={selectedStatement?.bankAccountName || 'Unknown'}
          onClose={() => {
            setClaudeReconOpen(false);
            setClaudeResult(null);
            setClaudeError('');
          }}
        />
      </Modal>

      {/* ── GL Journal Status Check Modal ────────────────────────────────── */}
      <Modal
        open={glCheckModalVisible}
        onCancel={() => {
          setGlCheckModalVisible(false);
          setSelectedTxnForGlCheck(null);
          setGlCheckTestResult(null);
        }}
        title={selectedTxnForGlCheck ? `GL Status Check - Txn ${selectedTxnForGlCheck.txnId}` : 'GL Status Check'}
        width={800}
        footer={[
          <Button key="close" onClick={() => {
            setGlCheckModalVisible(false);
            setSelectedTxnForGlCheck(null);
            setGlCheckTestResult(null);
          }}>
            Close
          </Button>,
          <Button
            key="test"
            type="primary"
            loading={glCheckTestLoading}
            onClick={() => selectedTxnForGlCheck && testGlJournalStatus(selectedTxnForGlCheck)}
            icon={<SearchOutlined />}
          >
            Test GL Lookup
          </Button>,
        ]}
      >
        {selectedTxnForGlCheck && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Transaction ID" span={2}>
                <Typography.Text code>{selectedTxnForGlCheck.txnId}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Source" span={2}>
                {selectedTxnForGlCheck.source}
              </Descriptions.Item>
              <Descriptions.Item label="Reference 2 (API Param)" span={2}>
                <Typography.Text code>{selectedTxnForGlCheck.txnId}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Reference 5 (API Param)" span={2}>
                <Typography.Text code>
                  {selectedTxnForGlCheck.source === 'AP_PAYMENT' ? 'AP-PAYMENT'
                   : selectedTxnForGlCheck.source === 'EXTERNAL_TXN' ? 'BANK_EXTERNAL_TRANSACTIONS'
                   : selectedTxnForGlCheck.source === 'AR_RECEIPT' ? 'AR_RECEIPTS'
                   : 'GL_JOURNAL'}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Current Status" span={2}>
                {glJournalStatus[selectedTxnForGlCheck.txnId] === undefined
                  ? <Tag>Unknown</Tag>
                  : glJournalStatus[selectedTxnForGlCheck.txnId]
                    ? <Tag color="green">Yes - Found in GL</Tag>
                    : <Tag color="red">No - Not in GL</Tag>
                }
              </Descriptions.Item>
            </Descriptions>

            {glCheckTestResult && (
              <Card
                title={
                  <Space>
                    {glCheckTestResult.error ? (
                      <>
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                        <span>Test Failed</span>
                      </>
                    ) : (
                      <>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <span>Test Result</span>
                      </>
                    )}
                  </Space>
                }
                size="small"
              >
                {glCheckTestResult.error ? (
                  <Alert
                    message="Error"
                    description={glCheckTestResult.error}
                    type="error"
                    showIcon
                  />
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Descriptions size="small">
                      <Descriptions.Item label="HTTP Status">{glCheckTestResult.status}</Descriptions.Item>
                      <Descriptions.Item label="Journals Found">
                        {glCheckTestResult.data?.items?.length || 0}
                      </Descriptions.Item>
                    </Descriptions>
                    {glCheckTestResult.data?.items && glCheckTestResult.data.items.length > 0 && (
                      <Alert
                        message="Success"
                        description={`Found ${glCheckTestResult.data.items.length} matching GL journal(s)`}
                        type="success"
                        showIcon
                      />
                    )}
                    {(!glCheckTestResult.data?.items || glCheckTestResult.data.items.length === 0) && (
                      <Alert
                        message="No Matches"
                        description="No GL journals found with these parameters"
                        type="warning"
                        showIcon
                      />
                    )}
                  </Space>
                )}
              </Card>
            )}

            <Alert
              message="API Endpoint"
              description={
                <Typography.Paragraph copyable>
                  {`${APEX_BASE}/gl/journals/check?reference2=${selectedTxnForGlCheck.txnId}&reference5=${
                    selectedTxnForGlCheck.source === 'AP_PAYMENT' ? 'AP-PAYMENT'
                    : selectedTxnForGlCheck.source === 'EXTERNAL_TXN' ? 'BANK_EXTERNAL_TRANSACTIONS'
                    : selectedTxnForGlCheck.source === 'AR_RECEIPT' ? 'AR_RECEIPTS'
                    : 'GL_JOURNAL'
                  }`}
                </Typography.Paragraph>
              }
              type="info"
            />
          </Space>
        )}
      </Modal>
    </>
  );
};

// ── Reconciled Tab ────────────────────────────────────────────────────────────
interface ReconciledTabProps {
  bankAccounts: BankAcctOption[];
  businessUnits: BUOption[];
  loadingAccounts: boolean;
}

const ReconciledTab: React.FC<ReconciledTabProps> = ({ bankAccounts, businessUnits, loadingAccounts }) => {
  const [reconLines, setReconLines]   = useState<StmtLine[]>([]);
  const [loading, setLoading]         = useState(false);
  const [exporting, setExporting]     = useState(false);
  const [msgApi, contextHolder]       = message.useMessage();

  const exportReconExcel = useCallback(() => {
    if (reconLines.length === 0) return;
    setExporting(true);
    try {
      const wb   = XLSX.utils.book_new();
      const date = new Date().toISOString().slice(0, 10);
      const rows = reconLines.map(l => ({
        'Line ID':        l.lineId,
        'Statement No.':  l.statementNumber,
        'Date':           l.transactionDate,
        'Dr/Cr':          l.transactionCode,
        'Amount':         l.amount,
        'Currency':       l.currencyCode,
        'Description':    l.description,
        'Reference':      l.reference,
        'Counterparty':   l.counterpartyName,
        'Recon Txn Type': l.reconTxnType,
        'Recon Txn No.':  l.reconTxnNumber,
        'Recon Date':     l.reconDate,
        'Recon Amount':   l.reconAmount,
        'Ext Txn ID':     l.externalTxnId,
        'Ext Txn Ref':    l.externalTxnRef,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Reconciled Lines');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `ReconciledLines_${date}.xlsx`);
    } finally {
      setExporting(false);
    }
  }, [reconLines]);

  const fetchReconLines = useCallback(async (params: SearchParams) => {
    const q = new URLSearchParams();
    if (params.bankAccount)      q.set('bank_account',  params.bankAccount);
    q.set('recon_status', 'RECONCILED');
    if (params.dateFrom)         q.set('date_from',     params.dateFrom.format('YYYY-MM-DD'));
    if (params.dateTo)           q.set('date_to',       params.dateTo.format('YYYY-MM-DD'));
    if (params.amountMin != null) q.set('amount_min',   String(params.amountMin));
    if (params.amountMax != null) q.set('amount_max',   String(params.amountMax));
    if (params.statementId)      q.set('statement_id',  params.statementId);
    if (params.reference)        q.set('reference',     params.reference);
    q.set('row_limit', '500');

    setLoading(true);
    try {
      const res  = await fetch(`${APEX_BASE}/cash/reconciliation/stmtlines?${q.toString()}`);
      const data = await parseApexJson(res);
      if (data.status === 'success') {
        setReconLines((data.items ?? []) as StmtLine[]);
      } else {
        msgApi.error(data.message ?? 'Failed to load reconciled lines');
      }
    } catch (err) {
      msgApi.error('Network error loading reconciled lines');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [msgApi]);

  const handleSearch = useCallback((params: SearchParams) => {
    fetchReconLines(params);
  }, [fetchReconLines]);

  const handleReset = useCallback(() => {
    setReconLines([]);
  }, []);

  const handleUnreconcile = useCallback(async (line: StmtLine) => {
    try {
      // Step 1: unreconcile the statement line
      const res  = await fetch(
        `${APEX_BASE}/cash/bankstatements/${line.statementId}/unreconcile`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId: line.lineId }) }
      );
      const data = await parseApexJson(res);
      if (data.status !== 'success') {
        msgApi.error(data.message ?? 'Failed to unreconcile statement line');
        return;
      }

      // Step 2: if linked to a CM external transaction, reverse its reconciliation
      if (line.externalTxnId) {
        try {
          await fetch(`${EXT_TXN_URL}/${line.externalTxnId}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              status:          'UNR',
              reconciledFlag:  'N',
              reconciledDate:  null,
              statementId:     null,
              stmtLineId:      null,
            }),
          });
        } catch {
          // Non-fatal — stmt line is already unreconciled; log silently
          console.warn('Could not reverse external transaction reconciliation for ID', line.externalTxnId);
        }
      }

      msgApi.success('Line unreconciled successfully');
      setReconLines((prev) => prev.filter((l) => l.lineId !== line.lineId));
    } catch (err) {
      msgApi.error('Network error during unreconcile');
      console.error(err);
    }
  }, [msgApi]);

  const columns: ColumnsType<StmtLine> = [
    {
      title: 'Statement Line Ref',
      dataIndex: 'reference',
      key: 'reference',
      width: 180,
      ellipsis: true,
      render: (v: string, r) => (
        <Tooltip title={r.bankTxnReference || v}>
          <span>{v || r.bankTxnReference || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'transactionDate',
      key: 'transactionDate',
      width: 120,
      sorter: (a: StmtLine, b: StmtLine) => (a.transactionDate || '').localeCompare(b.transactionDate || ''),
      render: (v: string) => fmtDate(v),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 110,
      align: 'right',
      render: (v: number, r) => (
        <span
          style={{
            color:      r.transactionCode === 'CR' ? REDWOOD.success : REDWOOD.error,
            fontWeight: 500,
          }}
        >
          {fmtAmount(v)}
        </span>
      ),
    },
    {
      title: 'Matched Txn #',
      dataIndex: 'reconTxnNumber',
      key: 'reconTxnNumber',
      width: 130,
      ellipsis: true,
      render: (v: string) => v || '—',
    },
    {
      title: 'Matched Amount',
      dataIndex: 'reconAmount',
      key: 'reconAmount',
      width: 120,
      align: 'right',
      render: (v: number) => fmtAmount(v),
    },
    {
      title: 'Matched Source',
      dataIndex: 'reconTxnType',
      key: 'reconTxnType',
      width: 120,
      render: (v: string) =>
        v ? (
          <Tag color="geekblue" style={{ margin: 0 }}>
            {v}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      title: 'Recon Date',
      dataIndex: 'reconDate',
      key: 'reconDate',
      width: 100,
      render: (v: string) => fmtDate(v),
    },
    {
      title: 'Notes',
      dataIndex: 'reconNotes',
      key: 'reconNotes',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span>{v || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: StmtLine) => (
        <Tooltip title="Un-reconcile this line">
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => handleUnreconcile(record)}
          >
            Undo
          </Button>
        </Tooltip>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <SearchPanel
        bankAccounts={bankAccounts}
        businessUnits={businessUnits}
        loadingAccounts={loadingAccounts}
        hasData={reconLines.length > 0}
        onSearch={handleSearch}
        onReset={handleReset}
      />
      <Card
        size="small"
        title={
          <Space>
            <ReconciliationOutlined style={{ color: REDWOOD.success }} />
            <span style={{ fontWeight: 600 }}>Reconciled Statement Lines</span>
            <Badge count={reconLines.length} style={{ backgroundColor: REDWOOD.success }} showZero />
          </Space>
        }
        extra={
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={exporting}
            disabled={reconLines.length === 0}
            onClick={exportReconExcel}
            style={{ borderColor: '#389e0d', color: '#389e0d' }}
          >
            Export Excel
          </Button>
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table<StmtLine>
          rowKey="lineId"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={reconLines}
          pagination={{ pageSize: 50, showSizeChanger: true, showQuickJumper: true }}
          scroll={{ x: 900 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No reconciled lines found — run a search to display results"
              />
            ),
          }}
        />
      </Card>
    </>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const BankReconciliation: React.FC = () => {
  const [bankAccounts, setBankAccounts]         = useState<BankAcctOption[]>([]);
  const [businessUnits, setBusinessUnits]       = useState<BUOption[]>([]);
  const [loadingAccounts, setLoadingAccounts]   = useState(false);
  const [activeTab, setActiveTab]               = useState<string>('unreconciled');

  // Load bank accounts from banks/bankaccounts and BUs from gl/businessunits
  useEffect(() => {
    const load = async () => {
      setLoadingAccounts(true);
      try {
        const [acctRes, buRes] = await Promise.all([
          fetch(`${APEX_BASE}/banks/bankaccounts`),
          fetch(`${APEX_BASE}/gl/businessunits`),
        ]);
        const acctData = await acctRes.json();
        const buData   = await buRes.json();

        const opts: BankAcctOption[] = (acctData?.items ?? [])
          .filter((i: any) => i.bankAccountName || i.bank_account_name)
          .map((i: any) => {
            const acctNum  = i.bankAccountNumber || i.bank_account_number || '';
            const acctName = i.bankAccountName   || i.bank_account_name   || '';
            return {
              label:             acctName,
              value:             acctNum || acctName,
              bankAccountNumber: acctNum,
              currencyCode:      i.currencyCode    || i.currency_code     || '',
              legalEntityName:   i.legalEntityName || i.legal_entity_name || '',
              cashAccount:       i.cash_account_combination || i.cashAccountCombination || '',
            };
          })
          .sort((a: BankAcctOption, b: BankAcctOption) => a.label.localeCompare(b.label));
        setBankAccounts(opts);

        const buOpts: BUOption[] = (buData?.items ?? [])
          .map((i: any) => ({
            label:           i.business_unit_name || '',
            value:           i.business_unit_name || '',
            legalEntityName: i.legal_entity_name  || '',
          }))
          .filter((o: BUOption) => o.value)
          .sort((a: BUOption, b: BUOption) => a.label.localeCompare(b.label));
        setBusinessUnits(buOpts);
      } catch (err) {
        console.error('Failed to load bank accounts / BUs', err);
      } finally {
        setLoadingAccounts(false);
      }
    };
    load();
  }, []);

  const tabItems = [
    {
      key:      'unreconciled',
      label: (
        <Space>
          <ReloadOutlined />
          Unreconciled
        </Space>
      ),
      children: (
        <UnreconciledTab
          bankAccounts={bankAccounts}
          businessUnits={businessUnits}
          loadingAccounts={loadingAccounts}
        />
      ),
    },
    {
      key:      'reconciled',
      label: (
        <Space>
          <CheckOutlined />
          Reconciled
        </Space>
      ),
      children: (
        <ReconciledTab
          bankAccounts={bankAccounts}
          businessUnits={businessUnits}
          loadingAccounts={loadingAccounts}
        />
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh', backgroundColor: REDWOOD.neutral100 }}>
      <Content style={{ padding: '16px 24px' }}>
        {/* Breadcrumb */}
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={[
            {
              title: (
                <Link to="/">
                  <HomeOutlined /> Home
                </Link>
              ),
            },
            {
              title: (
                <Link to="/cash">
                  <BankOutlined /> Cash Management
                </Link>
              ),
            },
            { title: 'Bank Reconciliation' },
          ]}
        />

        {/* Page Header */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            marginBottom:   16,
          }}
        >
          <Space align="center">
            <div
              style={{
                width:           36,
                height:          36,
                borderRadius:    8,
                backgroundColor: REDWOOD.primary,
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
              }}
            >
              <ReconciliationOutlined style={{ color: '#fff', fontSize: 18 }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                Bank Reconciliation
              </Title>
              <Text style={{ color: REDWOOD.neutral600, fontSize: 12 }}>
                Match bank statement lines against system transactions
              </Text>
            </div>
          </Space>
        </div>

        {/* Main Card with Tabs */}
        <Card
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
          styles={{ body: { padding: '0 16px 16px' } }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            tabBarStyle={{ borderBottom: `2px solid ${REDWOOD.neutral200}` }}
          />
        </Card>
      </Content>
    </Layout>
  );
};

export default BankReconciliation;
