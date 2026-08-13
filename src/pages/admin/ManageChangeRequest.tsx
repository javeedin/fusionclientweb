import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Typography, Breadcrumb, Button, Table, Tag, Space, Modal, Steps,
  Form, Select, Input, Row, Col, Card, Spin, message, Tooltip, Popconfirm,
  Divider, Badge, Empty, Alert, Descriptions, DatePicker,
} from 'antd';
import {
  HomeOutlined, PlusOutlined, SearchOutlined, EyeOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PlayCircleOutlined,
  FileTextOutlined, ReloadOutlined, EditOutlined, HistoryOutlined,
  ExclamationCircleOutlined, DatabaseOutlined, SelectOutlined, ApiOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#C74634',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
};

const API = `${APEX_DB_CONFIG.baseUrl}/admin/change-requests`;
const SEARCH_API = `${APEX_DB_CONFIG.baseUrl}/admin/change-requests/search`;
const RECORD_API = `${APEX_DB_CONFIG.baseUrl}/admin/record`;

// Sanitize Oracle JSON: fix leading-decimal numbers, strip control chars inside strings
const safeParseJson = (raw: string): any => {
  // Try plain parse first — works when Oracle sends clean JSON
  try { return JSON.parse(raw); } catch { /* fall through */ }
  // Strip bare control chars (newlines/tabs embedded in string values by Oracle)
  try { return JSON.parse(raw.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, ' ')); } catch { /* fall through */ }
  // Last resort: strip all non-printable including \n \r
  return JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ' '));
};

// ─── Transaction type config ──────────────────────────────────────────────────
type FieldType = 'text' | 'select' | 'date';

interface SearchField {
  param: string;       // key sent in params object
  label: string;
  type: FieldType;
  options?: string[];  // for select type
  placeholder?: string;
}

interface ResultColumn {
  title: string;
  key: 'col1' | 'col2' | 'col3' | 'col4' | 'col5';
}

interface ColDef {
  columnName: string;
  columnLabel: string;
  dataType: 'VARCHAR2' | 'NUMBER' | 'DATE' | 'TIMESTAMP';
  editable?: boolean;
}

interface TxnTypeConfig {
  label: string;
  tableName: string;
  pkColumn: string;
  searchFields: SearchField[];
  resultColumns: ResultColumn[];   // col1..col5 mapping for search results
  columns: ColDef[];               // editable columns in step 2
}

const TXN_CONFIGS: Record<string, TxnTypeConfig> = {
  JOURNAL: {
    label: 'GL Journal Batch',
    tableName: 'RR_GL_JOURNAL_BATCHES',
    pkColumn: 'JE_BATCH_ID',
    searchFields: [
      { param: 'batchName',  label: 'Batch Name',  type: 'text', placeholder: 'Search batch name…' },
      { param: 'description',label: 'Description', type: 'text', placeholder: 'Search description…' },
      { param: 'status',     label: 'Status',      type: 'select', options: ['Posted','Unposted','NEW','Error','Pending'] },
      { param: 'periodName', label: 'Period Name', type: 'text', placeholder: 'e.g. Jun-25' },
      { param: 'ledgerName', label: 'Ledger',      type: 'text', placeholder: 'Ledger name…' },
    ],
    resultColumns: [
      { title: 'Batch Name',    key: 'col1' },
      { title: 'Status',        key: 'col2' },
      { title: 'Period',        key: 'col3' },
      { title: 'Ledger',        key: 'col4' },
      { title: 'Description',   key: 'col5' },
    ],
    columns: [
      { columnName: 'BATCH_NAME',          columnLabel: 'Batch Name',        dataType: 'VARCHAR2', editable: true },
      { columnName: 'BATCH_DESCRIPTION',   columnLabel: 'Description',       dataType: 'VARCHAR2', editable: true },
      { columnName: 'STATUS',              columnLabel: 'Status',            dataType: 'VARCHAR2', editable: true },
      { columnName: 'DEFAULT_PERIOD_NAME', columnLabel: 'Period Name',       dataType: 'VARCHAR2', editable: true },
      { columnName: 'CONTROL_TOTAL',       columnLabel: 'Control Total',     dataType: 'NUMBER',   editable: true },
      { columnName: 'ERROR_MESSAGE',       columnLabel: 'Error Message',     dataType: 'VARCHAR2', editable: true },
      { columnName: 'REVERSAL_FLAG',       columnLabel: 'Reversal Flag',     dataType: 'VARCHAR2', editable: true },
      { columnName: 'POSTED_DATE',         columnLabel: 'Posted Date',       dataType: 'DATE',     editable: true },
    ],
  },
  JOURNAL_HEADER: {
    label: 'GL Journal Header',
    tableName: 'RR_GL_JE_HEADERS',
    pkColumn: 'JE_HEADER_ID',
    searchFields: [
      { param: 'journalName',  label: 'Journal Name',    type: 'text', placeholder: 'Search journal name…' },
      { param: 'description',  label: 'Description',     type: 'text', placeholder: 'Search description…' },
      { param: 'postingStatus',label: 'Posting Status',  type: 'select', options: ['Posted','Unposted','Error'] },
      { param: 'periodName',   label: 'Period Name',     type: 'text', placeholder: 'e.g. Jun-25' },
      { param: 'ledgerName',   label: 'Ledger',          type: 'text', placeholder: 'Ledger name…' },
    ],
    resultColumns: [
      { title: 'Journal Name',  key: 'col1' },
      { title: 'Period',        key: 'col2' },
      { title: 'Posting Status',key: 'col3' },
      { title: 'Ledger',        key: 'col4' },
      { title: 'Description',   key: 'col5' },
    ],
    columns: [
      { columnName: 'JOURNAL_NAME',           columnLabel: 'Journal Name',     dataType: 'VARCHAR2', editable: true },
      { columnName: 'JOURNAL_DESCRIPTION',    columnLabel: 'Description',      dataType: 'VARCHAR2', editable: true },
      { columnName: 'PERIOD_NAME',            columnLabel: 'Period Name',      dataType: 'VARCHAR2', editable: true },
      { columnName: 'POSTING_STATUS',         columnLabel: 'Posting Status',   dataType: 'VARCHAR2', editable: true },
      { columnName: 'DEFAULT_EFFECTIVE_DATE', columnLabel: 'Effective Date',   dataType: 'DATE',     editable: true },
      { columnName: 'CONTROL_TOTAL',          columnLabel: 'Control Total',    dataType: 'NUMBER',   editable: true },
      { columnName: 'EXTERNAL_REFERENCE',     columnLabel: 'External Reference', dataType: 'VARCHAR2', editable: true },
    ],
  },
  AP_INVOICE: {
    label: 'AP Invoice',
    tableName: 'RR_RAW_AP_INVOICES_ALL',
    pkColumn: 'INVOICE_ID',
    searchFields: [
      { param: 'invoiceNum',    label: 'Invoice Number', type: 'text', placeholder: 'Search invoice #…' },
      { param: 'vendorName',    label: 'Vendor Name',    type: 'text', placeholder: 'Search vendor…' },
      { param: 'description',   label: 'Description',    type: 'text', placeholder: 'Search description…' },
      { param: 'paymentStatus', label: 'Payment Status', type: 'select', options: ['Y','N','P'] },
      { param: 'dateFrom',      label: 'Invoice Date From', type: 'date' },
      { param: 'dateTo',        label: 'Invoice Date To',   type: 'date' },
    ],
    resultColumns: [
      { title: 'Invoice Number', key: 'col1' },
      { title: 'Vendor',         key: 'col2' },
      { title: 'Invoice Date',   key: 'col3' },
      { title: 'Amount',         key: 'col4' },
      { title: 'Pmt Status',     key: 'col5' },
    ],
    columns: [
      { columnName: 'INVOICE_NUM',         columnLabel: 'Invoice Number',  dataType: 'VARCHAR2', editable: true },
      { columnName: 'INVOICE_DATE',        columnLabel: 'Invoice Date',    dataType: 'DATE',     editable: true },
      { columnName: 'INVOICE_AMOUNT',      columnLabel: 'Invoice Amount',  dataType: 'NUMBER',   editable: true },
      { columnName: 'DESCRIPTION',         columnLabel: 'Description',     dataType: 'VARCHAR2', editable: true },
      { columnName: 'PAYMENT_STATUS_FLAG', columnLabel: 'Payment Status',  dataType: 'VARCHAR2', editable: true },
      { columnName: 'CANCELLED_DATE',      columnLabel: 'Cancelled Date',  dataType: 'DATE',     editable: true },
    ],
  },
  AP_PAYMENT: {
    label: 'AP Payment',
    tableName: 'RR_AP_PAYMENTS_ALL',
    pkColumn: 'CHECK_ID',
    searchFields: [
      { param: 'checkNumber', label: 'Check Number', type: 'text', placeholder: 'Search check #…' },
      { param: 'vendorName',  label: 'Vendor Name',  type: 'text', placeholder: 'Search vendor…' },
      { param: 'status',      label: 'Status',       type: 'select', options: ['NEGOTIABLE','CLEARED','VOIDED','SPOILED'] },
      { param: 'dateFrom',    label: 'Check Date From', type: 'date' },
      { param: 'dateTo',      label: 'Check Date To',   type: 'date' },
    ],
    resultColumns: [
      { title: 'Check Number', key: 'col1' },
      { title: 'Vendor',       key: 'col2' },
      { title: 'Check Date',   key: 'col3' },
      { title: 'Amount',       key: 'col4' },
      { title: 'Status',       key: 'col5' },
    ],
    columns: [
      { columnName: 'CHECK_NUMBER',       columnLabel: 'Check Number', dataType: 'VARCHAR2', editable: true },
      { columnName: 'CHECK_DATE',         columnLabel: 'Check Date',   dataType: 'DATE',     editable: true },
      { columnName: 'AMOUNT',             columnLabel: 'Amount',       dataType: 'NUMBER',   editable: true },
      { columnName: 'STATUS_LOOKUP_CODE', columnLabel: 'Status',       dataType: 'VARCHAR2', editable: true },
      { columnName: 'DESCRIPTION',        columnLabel: 'Description',  dataType: 'VARCHAR2', editable: true },
    ],
  },
  EXTERNAL_TXN: {
    label: 'External Cash Transaction',
    tableName: 'RR_EXTERNAL_CASH_TRANSACTIONS',
    pkColumn: 'TRANSACTION_ID',
    searchFields: [
      { param: 'externalTransactionId', label: 'External Txn ID', type: 'text', placeholder: 'External Transaction ID…' },
      { param: 'transactionId',         label: 'Transaction ID',  type: 'text', placeholder: 'Transaction ID…' },
      { param: 'description',    label: 'Description',    type: 'text', placeholder: 'Search description…' },
      { param: 'referenceNumber',label: 'Reference #',    type: 'text', placeholder: 'Search reference…' },
      { param: 'status',         label: 'Status',         type: 'select', options: ['CLEARED','UNCLEARED','VOIDED'] },
      { param: 'dateFrom',       label: 'Txn Date From',  type: 'date' },
      { param: 'dateTo',         label: 'Txn Date To',    type: 'date' },
    ],
    resultColumns: [
      { title: 'Date',        key: 'col1' },
      { title: 'Amount',      key: 'col2' },
      { title: 'Description', key: 'col3' },
      { title: 'Status',      key: 'col4' },
      { title: 'Reference',   key: 'col5' },
    ],
    columns: [
      { columnName: 'TRANSACTION_DATE',   columnLabel: 'Transaction Date', dataType: 'DATE',     editable: true },
      { columnName: 'AMOUNT',            columnLabel: 'Amount',           dataType: 'NUMBER',   editable: true },
      { columnName: 'DESCRIPTION',       columnLabel: 'Description',      dataType: 'VARCHAR2', editable: true },
      { columnName: 'STATUS',            columnLabel: 'Status',           dataType: 'VARCHAR2', editable: true },
      { columnName: 'REFERENCE_NUMBER',  columnLabel: 'Reference Number', dataType: 'VARCHAR2', editable: true },
    ],
  },
  BANK_TRANSFER: {
    label: 'Bank Account Transfer',
    tableName: 'RR_BANK_ACCOUNT_TRANSFERS',
    pkColumn: 'TRANSFER_ID',
    searchFields: [
      { param: 'description', label: 'Description', type: 'text', placeholder: 'Search description…' },
      { param: 'status',      label: 'Status',      type: 'select', options: ['CLEARED','UNCLEARED','VOIDED'] },
      { param: 'dateFrom',    label: 'Date From',   type: 'date' },
      { param: 'dateTo',      label: 'Date To',     type: 'date' },
    ],
    resultColumns: [
      { title: 'Date',        key: 'col1' },
      { title: 'Amount',      key: 'col2' },
      { title: 'Status',      key: 'col3' },
      { title: 'Description', key: 'col4' },
      { title: '',            key: 'col5' },
    ],
    columns: [
      { columnName: 'TRANSFER_DATE', columnLabel: 'Transfer Date', dataType: 'DATE',     editable: true },
      { columnName: 'AMOUNT',        columnLabel: 'Amount',        dataType: 'NUMBER',   editable: true },
      { columnName: 'STATUS',        columnLabel: 'Status',        dataType: 'VARCHAR2', editable: true },
      { columnName: 'DESCRIPTION',   columnLabel: 'Description',   dataType: 'VARCHAR2', editable: true },
    ],
  },
  BANK_STMT_HDR: {
    label: 'Bank Statement Header',
    tableName: 'RR_BANK_STATEMENT_HEADER',
    pkColumn: 'STATEMENT_ID',
    searchFields: [
      { param: 'statementNumber', label: 'Statement Number', type: 'text', placeholder: 'Search statement #…' },
      { param: 'bankAccount',     label: 'Bank Account',     type: 'text', placeholder: 'Search bank account…' },
      { param: 'status',          label: 'Status',           type: 'select', options: ['DRAFT','SUBMITTED','RECONCILING','RECONCILED','CLOSED'] },
      { param: 'dateFrom',        label: 'Date From',        type: 'date' },
      { param: 'dateTo',          label: 'Date To',          type: 'date' },
    ],
    resultColumns: [
      { title: 'Statement #',     key: 'col1' },
      { title: 'Bank Account',    key: 'col2' },
      { title: 'Date',            key: 'col3' },
      { title: 'Status',          key: 'col4' },
      { title: 'Closing Balance', key: 'col5' },
    ],
    columns: [
      { columnName: 'STATEMENT_DATE',   columnLabel: 'Statement Date',   dataType: 'DATE',     editable: true },
      { columnName: 'STATEMENT_NUMBER', columnLabel: 'Statement Number', dataType: 'VARCHAR2', editable: true },
      { columnName: 'OPENING_BALANCE',  columnLabel: 'Opening Balance',  dataType: 'NUMBER',   editable: true },
      { columnName: 'CLOSING_BALANCE',  columnLabel: 'Closing Balance',  dataType: 'NUMBER',   editable: true },
      { columnName: 'STATUS',           columnLabel: 'Status',           dataType: 'VARCHAR2', editable: true },
      { columnName: 'DESCRIPTION',      columnLabel: 'Description',      dataType: 'VARCHAR2', editable: true },
    ],
  },
  BANK_STMT_LINES: {
    label: 'Bank Statement Lines',
    tableName: 'RR_BANK_STATEMENT_LINES',
    pkColumn: 'LINE_ID',
    searchFields: [
      { param: 'lineId',            label: 'Line ID (required)', type: 'text', placeholder: 'Enter exact Line ID…' },
      { param: 'description',       label: 'Description',       type: 'text', placeholder: 'Search description…' },
      { param: 'reference',         label: 'Reference',         type: 'text', placeholder: 'Search reference…' },
      { param: 'counterpartyName',  label: 'Counterparty',      type: 'text', placeholder: 'Search counterparty…' },
      { param: 'transactionCode',   label: 'Type',              type: 'select', options: ['CR','DR'] },
      { param: 'reconStatus',       label: 'Recon Status',      type: 'select', options: ['UNRECONCILED','RECONCILED','PARTIALLY_RECONCILED','EXCLUDED'] },
      { param: 'dateFrom',          label: 'Date From',         type: 'date' },
      { param: 'dateTo',            label: 'Date To',           type: 'date' },
    ],
    resultColumns: [
      { title: 'Line ID',       key: 'col1' },
      { title: 'Date',          key: 'col2' },
      { title: 'Amount',        key: 'col3' },
      { title: 'Description',   key: 'col4' },
      { title: 'Recon Status',  key: 'col5' },
    ],
    columns: [
      { columnName: 'STATEMENT_ID',        columnLabel: 'Statement ID',       dataType: 'NUMBER',   editable: true },
      { columnName: 'LINE_NUMBER',         columnLabel: 'Line Number',        dataType: 'NUMBER',   editable: true },
      { columnName: 'TRANSACTION_DATE',    columnLabel: 'Transaction Date',   dataType: 'DATE',     editable: true },
      { columnName: 'VALUE_DATE',          columnLabel: 'Value Date',         dataType: 'DATE',     editable: true },
      { columnName: 'AMOUNT',              columnLabel: 'Amount',             dataType: 'NUMBER',   editable: true },
      { columnName: 'TRANSACTION_CODE',    columnLabel: 'Type (CR/DR)',       dataType: 'VARCHAR2', editable: true },
      { columnName: 'DESCRIPTION',         columnLabel: 'Description',        dataType: 'VARCHAR2', editable: true },
      { columnName: 'REFERENCE',           columnLabel: 'Reference',          dataType: 'VARCHAR2', editable: true },
      { columnName: 'BANK_TXN_REFERENCE',  columnLabel: 'Bank Txn Reference', dataType: 'VARCHAR2', editable: true },
      { columnName: 'COUNTERPARTY_NAME',   columnLabel: 'Counterparty Name',  dataType: 'VARCHAR2', editable: true },
      { columnName: 'COUNTERPARTY_ACCOUNT',columnLabel: 'Counterparty Account',dataType: 'VARCHAR2', editable: true },
      { columnName: 'CATEGORY_CODE',       columnLabel: 'Category Code',      dataType: 'VARCHAR2', editable: true },
      { columnName: 'RECON_STATUS',        columnLabel: 'Recon Status',       dataType: 'VARCHAR2', editable: true },
      { columnName: 'RECON_AMOUNT',        columnLabel: 'Recon Amount',       dataType: 'NUMBER',   editable: true },
      { columnName: 'RECON_DATE',          columnLabel: 'Recon Date',         dataType: 'DATE',     editable: true },
      { columnName: 'RECON_BY',            columnLabel: 'Recon By',           dataType: 'VARCHAR2', editable: true },
      { columnName: 'RECON_TXN_TYPE',      columnLabel: 'Recon Txn Type',     dataType: 'VARCHAR2', editable: true },
      { columnName: 'RECON_TXN_ID',        columnLabel: 'Recon Txn ID',       dataType: 'NUMBER',   editable: true },
      { columnName: 'RECON_TXN_NUMBER',    columnLabel: 'Recon Txn Number',   dataType: 'VARCHAR2', editable: true },
      { columnName: 'RECON_REFERENCE',     columnLabel: 'Recon Reference',    dataType: 'VARCHAR2', editable: true },
      { columnName: 'RECON_NOTES',         columnLabel: 'Recon Notes',        dataType: 'VARCHAR2', editable: true },
      { columnName: 'CREATED_BY',          columnLabel: 'Created By',         dataType: 'VARCHAR2', editable: true },
      { columnName: 'LAST_UPDATED_BY',     columnLabel: 'Last Updated By',    dataType: 'VARCHAR2', editable: true },
    ],
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChangeRequest {
  requestId: number;
  requestNumber: string;
  status: string;
  transactionType: string;
  transactionId: number;
  transactionRef: string;
  tableName: string;
  description: string;
  createdBy: string;
  creationDate: string;
  executedBy?: string;
  executedDate?: string;
  detailCount: number;
}

interface SearchResult {
  id: number;
  col1: string; col2: string; col3: string; col4: string; col5: string;
}

interface DetailLine {
  key: string;
  tableName: string;
  columnName: string;
  columnLabel: string;
  dataType: string;
  oldValue: string;
  newValue: string;
  whereColumn: string;
  whereValue: string;
  changed?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const statusColor: Record<string, string> = {
  DRAFT: 'default', PENDING: 'gold', APPROVED: 'blue',
  EXECUTED: 'green', REJECTED: 'red',
};

function buildSQL(d: DetailLine): string {
  if (!d.whereColumn || !d.whereValue) return '-- Missing WHERE clause';
  let val: string;
  if (d.dataType === 'NUMBER') {
    val = d.newValue || 'NULL';
  } else if (d.dataType === 'DATE' || d.dataType === 'TIMESTAMP') {
    val = d.newValue ? `TO_DATE('${d.newValue}','YYYY-MM-DD')` : 'NULL';
  } else {
    val = d.newValue != null ? `'${d.newValue.replace(/'/g, "''")}'` : 'NULL';
  }
  return `UPDATE ${d.tableName}\n  SET ${d.columnName} = ${val}\n  WHERE ${d.whereColumn} = ${d.whereValue};`;
}

// ─── Component ────────────────────────────────────────────────────────────────
const ManageChangeRequest: React.FC = () => {
  const { user } = useAuth();

  // List state
  const [requests, setRequests]         = useState<ChangeRequest[]>([]);
  const [loading, setLoading]           = useState(false);
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [filterType, setFilterType]     = useState<string | undefined>();

  // Wizard state
  const [wizardOpen, setWizardOpen]         = useState(false);
  const [step, setStep]                     = useState(0);
  const [wizardForm]                        = Form.useForm();
  const [searchForm]                        = Form.useForm();
  const [txnType, setTxnType]               = useState<string>('');
  const [searchParams, setSearchParams]     = useState<Record<string, string>>({});
  const [searchResults, setSearchResults]   = useState<SearchResult[]>([]);
  const [searching, setSearching]           = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SearchResult | null>(null);
  const [detailLines, setDetailLines]       = useState<DetailLine[]>([]);
  const [loadingRecord, setLoadingRecord]   = useState(false);
  const [savedRequestId, setSavedRequestId] = useState<number | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [executing, setExecuting]           = useState(false);
  const [execResults, setExecResults]       = useState<any[]>([]);

  // API debug log
  const [apiLog, setApiLog] = useState<{
    url: string; method: string; payload: any;
    httpStatus: number | null; rawResponse: string;
  } | null>(null);
  const [showApiLog, setShowApiLog] = useState(false);
  const [showDbInfo, setShowDbInfo] = useState(false);

  // Per-call API logs (search + record fetch)
  type ApiEntry = { label: string; method: string; url: string; payload?: any; httpStatus: number | null; rawResponse: string; generatedSql?: string };
  const [queryLog, setQueryLog]         = useState<ApiEntry[]>([]);
  const [showQueryLog, setShowQueryLog] = useState(false);

  // API log for the View Detail modal
  const [viewApiLog, setViewApiLog]         = useState<ApiEntry[]>([]);
  const [showViewApiLog, setShowViewApiLog] = useState(false);

  // View state
  const [viewOpen, setViewOpen]         = useState(false);
  const [viewRequest, setViewRequest]   = useState<any>(null);
  const [loadingView, setLoadingView]   = useState(false);
  const [compareData, setCompareData]   = useState<any>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // ── Load list ────────────────────────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType)   params.set('transaction_type', filterType);
      const res = await fetch(`${API}?${params.toString()}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setRequests((data.items || []).map((r: any) => ({
        requestId:       r.request_id,
        requestNumber:   r.request_number,
        status:          r.status,
        transactionType: r.transaction_type,
        transactionId:   r.transaction_id,
        transactionRef:  r.transaction_ref,
        tableName:       r.table_name,
        description:     r.description,
        createdBy:       r.created_by,
        creationDate:    r.creation_date,
        executedBy:      r.executed_by,
        executedDate:    r.executed_date,
        detailCount:     r.detail_count,
      })));
    } catch {
      message.error('Failed to load change requests');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterType]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  // ── View single ──────────────────────────────────────────────────────────
  const viewSingleRequest = async (id: number) => {
    setLoadingView(true);
    setViewOpen(true);
    setViewApiLog([]);
    setShowViewApiLog(false);
    try {
      const detailUrl = `${API}/${id}`;
      const detailSql = `-- DCR header + details + SQL audit log\nSELECT h.*, d.*, s.*\nFROM RR_DATA_CHANGE_REQUEST_HEADER h\nLEFT JOIN RR_DATA_CHANGE_REQUEST_DETAILS d ON d.REQUEST_ID = h.REQUEST_ID\nLEFT JOIN RR_DATA_CHANGE_REQUEST_SQL s ON s.REQUEST_ID = h.REQUEST_ID\nWHERE h.REQUEST_ID = ${id}`;
      const detailEntry: ApiEntry = { label: 'Load DCR Detail', method: 'GET', url: detailUrl, httpStatus: null, rawResponse: 'Pending…', generatedSql: detailSql };
      setViewApiLog([detailEntry]);

      const res = await fetch(detailUrl, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      setViewApiLog(prev => prev.map((e, i) => i === 0 ? { ...e, httpStatus: res.status, rawResponse: raw } : e));
      const data = safeParseJson(raw);
      setViewRequest(data);

      // Fetch live comparison (current row vs _UPD history) once we have table + pk
      if (data?.header?.tableName && data?.header?.transactionId) {
        const cfg = TXN_CONFIGS[data.header.transactionType];
        const pkCol = cfg?.pkColumn || 'ID';
        const tableName = data.header.tableName;
        const pkVal = data.header.transactionId;
        setLoadingCompare(true);
        setCompareData(null);
        try {
          const cUrl = `${APEX_DB_CONFIG.baseUrl}/admin/compare`
            + `?table_name=${tableName}`
            + `&pk_col=${pkCol}`
            + `&pk_val=${pkVal}`;
          const currentSql = `-- Current row (original table)\nSELECT *\nFROM ${tableName}\nWHERE ${pkCol} = ${pkVal}\nAND ROWNUM = 1`;
          const historySql = `-- Change history (_UPD table, newest first)\nSELECT *\nFROM ${tableName}_UPD\nWHERE ${pkCol} = ${pkVal}\nORDER BY CHANGED_DATE DESC\nFETCH FIRST 20 ROWS ONLY`;
          const compareEntry: ApiEntry = {
            label: 'Compare: Current vs _UPD History',
            method: 'GET',
            url: cUrl,
            httpStatus: null,
            rawResponse: 'Pending…',
            generatedSql: currentSql + '\n\n' + historySql,
          };
          setViewApiLog(prev => [...prev, compareEntry]);

          const cRes = await fetch(cUrl, { headers: { Accept: 'application/json' } });
          const cRaw = await cRes.text();
          setViewApiLog(prev => prev.map((e, i) => i === prev.length - 1 ? { ...e, httpStatus: cRes.status, rawResponse: cRaw } : e));
          try { setCompareData(safeParseJson(cRaw)); } catch { setCompareData(null); }
        } catch {
          // non-blocking
        } finally {
          setLoadingCompare(false);
        }
      }
    } catch {
      message.error('Failed to load request details');
    } finally {
      setLoadingView(false);
    }
  };

  // ── Wizard: search transactions ──────────────────────────────────────────
  const runSearch = async () => {
    if (!txnType) { message.warning('Please select a transaction type first'); return; }
    const vals = searchForm.getFieldsValue();
    if (txnType === 'BANK_STMT_LINES' && !vals.lineId?.toString().trim()) {
      message.warning('Line ID is required for Bank Statement Lines — enter the exact LINE_ID to look up');
      return;
    }
    // Convert dayjs dates to YYYY-MM-DD strings
    const params: Record<string, string> = {};
    Object.entries(vals).forEach(([k, v]) => {
      if (v == null || v === '') return;
      if (dayjs.isDayjs(v)) {
        params[k] = (v as any).format('YYYY-MM-DD');
      } else {
        params[k] = String(v);
      }
    });
    // When an ID field is provided, search only on that — drop date range params to avoid column errors
    const ID_PARAMS = ['externalTransactionId', 'transactionId', 'lineId', 'headerId', 'transferId'];
    const hasId = ID_PARAMS.some(k => params[k]);
    if (hasId) {
      ['dateFrom', 'dateTo', 'description', 'referenceNumber', 'status', 'source', 'currencyCode'].forEach(k => delete params[k]);
    }
    setSearchParams(params);
    setSearching(true);
    setSearchResults([]);
    setSelectedRecord(null);
    const searchBody = { transactionType: txnType, params };
    // Build the SQL Oracle will construct server-side for display
    const cfg2 = TXN_CONFIGS[txnType];
    const whereClauses = Object.entries(params)
      .map(([k, v]) => {
        const sf = cfg2?.searchFields.find(f => f.param === k);
        const col = sf ? k.replace(/([A-Z])/g, '_$1').toUpperCase() : k.toUpperCase();
        return `  AND UPPER(${col}) LIKE UPPER('%${v}%')`;
      }).join('\n');
    const generatedSql = cfg2
      ? `SELECT *\nFROM ${cfg2.tableName}\nWHERE 1=1\n${whereClauses || '  -- (no filters applied)'}\nFETCH FIRST 200 ROWS ONLY`
      : '-- unknown type';
    const logEntry: ApiEntry = { label: 'Search', method: 'POST', url: SEARCH_API, payload: searchBody, httpStatus: null, rawResponse: 'Pending…', generatedSql };
    setQueryLog(prev => [logEntry, ...prev.slice(0, 9)]);
    setShowQueryLog(true);
    try {
      const res = await fetch(SEARCH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(searchBody),
      });
      const raw = await res.text();
      setQueryLog(prev => prev.map((e, i) => i === 0 ? { ...e, httpStatus: res.status, rawResponse: raw } : e));
      let data: any;
      try {
        data = safeParseJson(raw);
      } catch (parseErr) {
        const tail = raw.length > 300 ? `…[${raw.length} chars total]…` + raw.slice(-120) : raw;
        throw new Error(`Non-JSON (len=${raw.length}): START→ ${raw.slice(0, 180)} ←END→ ${tail}`);
      }
      if (!data.success) throw new Error(data.error || 'Search failed');
      setSearchResults(data.rows || []);
      if ((data.rows || []).length === 0) message.info('No records found. Try different search criteria.');
    } catch (e: any) {
      message.error(`Search failed: ${e.message}`);
    } finally {
      setSearching(false);
    }
  };

  // ── Wizard: select a row → fetch full record ─────────────────────────────
  const selectRecord = async (row: SearchResult) => {
    setSelectedRecord(row);
    const cfg = TXN_CONFIGS[txnType];
    setLoadingRecord(true);
    try {
      const url = `${RECORD_API}?table_name=${cfg.tableName}&pk_col=${cfg.pkColumn}&pk_val=${row.id}`;
      const recordSql = `SELECT *\nFROM ${cfg.tableName}\nWHERE ${cfg.pkColumn} = ${row.id}\nAND ROWNUM = 1`;
      const recEntry: ApiEntry = { label: 'Fetch Record (current)', method: 'GET', url, httpStatus: null, rawResponse: 'Pending…', generatedSql: recordSql };
      setQueryLog(prev => [recEntry, ...prev.slice(0, 9)]);
      setShowQueryLog(true);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      setQueryLog(prev => prev.map((e, i) => i === 0 ? { ...e, httpStatus: res.status, rawResponse: raw } : e));
      let data: any;
      try { data = safeParseJson(raw); } catch { throw new Error(`Non-JSON: ${raw.slice(0, 200)}`); }
      if (!data.success) throw new Error(data.error || 'Failed to fetch record');
      const rec = data.row || {};

      const lines: DetailLine[] = cfg.columns
        .filter(col => col.editable)
        .map((col, i) => ({
          key:         String(i),
          tableName:   cfg.tableName,
          columnName:  col.columnName,
          columnLabel: col.columnLabel,
          dataType:    col.dataType,
          oldValue:    rec[col.columnName] != null ? String(rec[col.columnName]) : '',
          newValue:    rec[col.columnName] != null ? String(rec[col.columnName]) : '',
          whereColumn: cfg.pkColumn,
          whereValue:  String(row.id),
          changed:     false,
        }));
      setDetailLines(lines);
      setStep(1);
    } catch (e: any) {
      message.error(`Failed to load record: ${e.message}`);
      setSelectedRecord(null);
    } finally {
      setLoadingRecord(false);
    }
  };

  // ── Wizard: save details + advance to SQL preview ────────────────────────
  const saveAndPreview = async () => {
    const changed = detailLines.filter(d => d.changed && d.newValue !== d.oldValue);
    if (changed.length === 0) { message.warning('No columns have been changed'); return; }

    setSaving(true);
    setApiLog(null);
    try {
      const cfg = TXN_CONFIGS[txnType];
      const vals = wizardForm.getFieldsValue();
      const description = vals.description || '';
      const txnRef = `${cfg.tableName} #${selectedRecord?.id} — ${selectedRecord?.col1 || ''}`;

      // Step A: create header
      const hPayload = {
        transactionType: txnType,
        transactionId:   selectedRecord?.id,
        transactionRef:  txnRef,
        tableName:       cfg.tableName,
        description,
        createdBy:       user?.username || user?.name || 'ERP_USER',
      };
      setApiLog({ url: API, method: 'POST', payload: hPayload, httpStatus: null, rawResponse: 'Pending…' });
      setShowApiLog(true);

      const hRes = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(hPayload),
      });
      const hRaw = await hRes.text();
      setApiLog({ url: API, method: 'POST', payload: hPayload, httpStatus: hRes.status, rawResponse: hRaw });

      let hData: any;
      try { hData = safeParseJson(hRaw); } catch { throw new Error(`Non-JSON response: ${hRaw.slice(0, 200)}`); }
      if (!hData.success) throw new Error(hData.error || `Create failed (HTTP ${hRes.status})`);
      const reqId = hData.requestId;
      setSavedRequestId(reqId);

      // Step B: save detail lines
      const detailsUrl = `${API}/${reqId}/details`;
      const dPayload = {
        items: changed.map(d => ({
          tableName:   d.tableName,
          columnName:  d.columnName,
          columnLabel: d.columnLabel,
          dataType:    d.dataType,
          oldValue:    d.oldValue,
          newValue:    d.newValue,
          whereColumn: d.whereColumn,
          whereValue:  d.whereValue,
          createdBy:   user?.username || user?.name || 'ERP_USER',
        })),
      };
      setApiLog({ url: detailsUrl, method: 'POST', payload: dPayload, httpStatus: null, rawResponse: 'Pending…' });

      const dRes = await fetch(detailsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(dPayload),
      });
      const dRaw = await dRes.text();
      setApiLog({ url: detailsUrl, method: 'POST', payload: dPayload, httpStatus: dRes.status, rawResponse: dRaw });

      let dData: any;
      try { dData = safeParseJson(dRaw); } catch { throw new Error(`Non-JSON response: ${dRaw.slice(0, 200)}`); }
      if (!dData.success) throw new Error(dData.error || `Save details failed (HTTP ${dRes.status})`);

      setStep(2);
    } catch (e: any) {
      message.error(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Wizard: execute ───────────────────────────────────────────────────────
  const executeRequest = async () => {
    if (!savedRequestId) return;
    setExecuting(true);
    try {
      const execUrl = `${API}/${savedRequestId}/execute`;
      const execPayload = { executedBy: user?.username || user?.name || 'ERP_USER' };
      setApiLog({ url: execUrl, method: 'POST', payload: execPayload, httpStatus: null, rawResponse: 'Pending…' });
      setShowApiLog(true);

      const res = await fetch(execUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(execPayload),
      });
      const raw = await res.text();
      setApiLog({ url: execUrl, method: 'POST', payload: execPayload, httpStatus: res.status, rawResponse: raw });

      let data: any;
      try { data = safeParseJson(raw); } catch { throw new Error(`Non-JSON: ${raw.slice(0, 200)}`); }
      if (!data.success) throw new Error(data.error || `Execute failed (HTTP ${res.status})`);
      setExecResults(data.results || []);
      const ok = (data.results || []).filter((r: any) => r.status === 'SUCCESS').length;
      message.success(`Executed — ${ok} update(s) applied.`);
      setStep(3);
      loadRequests();
    } catch (e: any) {
      message.error(`Execution failed: ${e.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const resetWizard = () => {
    setStep(0);
    setTxnType('');
    setSearchParams({});
    setSearchResults([]);
    setSelectedRecord(null);
    setDetailLines([]);
    setSavedRequestId(null);
    setExecResults([]);
    setApiLog(null);
    setShowApiLog(false);
    setShowDbInfo(false);
    setQueryLog([]);
    setShowQueryLog(false);
    wizardForm.resetFields();
    searchForm.resetFields();
    setWizardOpen(false);
  };

  const changedLines = detailLines.filter(d => d.changed && d.newValue !== d.oldValue);
  const cfg = txnType ? TXN_CONFIGS[txnType] : null;

  // ── Search result table columns (dynamic per type) ───────────────────────
  const searchResultCols = cfg ? [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 90,
      render: (v: number) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    ...cfg.resultColumns
      .filter(c => c.title)
      .map(c => ({ title: c.title, dataIndex: c.key, ellipsis: true })),
    {
      title: '',
      key: 'select',
      width: 90,
      render: (_: any, row: SearchResult) => (
        <Button
          type="primary" size="small" icon={<SelectOutlined />}
          loading={loadingRecord && selectedRecord?.id === row.id}
          onClick={() => selectRecord(row)}
          style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
        >
          Select
        </Button>
      ),
    },
  ] : [];

  // ── Detail edit columns ──────────────────────────────────────────────────
  const detailEditCols = [
    { title: 'Column', dataIndex: 'columnLabel', width: 200 },
    { title: 'Type', dataIndex: 'dataType', width: 90, render: (v: string) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    {
      title: 'Current Value',
      dataIndex: 'oldValue',
      render: (v: string) => <Text style={{ color: REDWOOD.neutral600 }}>{v || <em style={{ opacity: 0.4 }}>—</em>}</Text>,
    },
    {
      title: 'New Value',
      key: 'newValue',
      render: (_: any, record: DetailLine) => {
        if (record.dataType === 'DATE' || record.dataType === 'TIMESTAMP') {
          const parsed = record.newValue ? dayjs(record.newValue, ['YYYY-MM-DD', 'DD-MMM-YY', 'DD-MMM-YYYY']) : null;
          return (
            <DatePicker
              size="small"
              value={parsed?.isValid() ? parsed : null}
              format="DD-MMM-YYYY"
              style={{ width: '100%', borderColor: record.changed && record.newValue !== record.oldValue ? REDWOOD.warning : undefined }}
              onChange={date => {
                const v = date ? date.format('YYYY-MM-DD') : '';
                setDetailLines(prev => prev.map(d =>
                  d.key === record.key ? { ...d, newValue: v, changed: v !== d.oldValue } : d
                ));
              }}
            />
          );
        }
        return (
          <Input
            size="small"
            defaultValue={record.newValue}
            style={{ borderColor: record.changed && record.newValue !== record.oldValue ? REDWOOD.warning : undefined }}
            onChange={e => {
              const v = e.target.value;
              setDetailLines(prev => prev.map(d =>
                d.key === record.key ? { ...d, newValue: v, changed: v !== d.oldValue } : d
              ));
            }}
          />
        );
      },
    },
    {
      title: '',
      key: 'changed',
      width: 80,
      render: (_: any, r: DetailLine) =>
        r.changed && r.newValue !== r.oldValue ? <Tag color="orange">Modified</Tag> : null,
    },
  ];

  // ── List columns ─────────────────────────────────────────────────────────
  const listColumns = [
    {
      title: 'Request #', dataIndex: 'requestNumber', width: 110,
      render: (v: string, r: ChangeRequest) => (
        <Button type="link" size="small" onClick={() => viewSingleRequest(r.requestId)} style={{ padding: 0 }}>{v}</Button>
      ),
    },
    { title: 'Status', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={statusColor[v] || 'default'}>{v}</Tag> },
    { title: 'Type', dataIndex: 'transactionType', width: 180, render: (v: string) => TXN_CONFIGS[v]?.label || v },
    { title: 'Transaction Ref', dataIndex: 'transactionRef', ellipsis: true },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    { title: 'Lines', dataIndex: 'detailCount', width: 60, render: (v: number) => <Badge count={v} color="#0572CE" /> },
    { title: 'Created By', dataIndex: 'createdBy', width: 130 },
    { title: 'Created', dataIndex: 'creationDate', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '' },
    {
      title: '', key: 'actions', width: 60,
      render: (_: any, r: ChangeRequest) => (
        <Tooltip title="View Details">
          <Button icon={<EyeOutlined />} size="small" onClick={() => viewSingleRequest(r.requestId)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/admin">Administration</Link> },
            { title: 'Data Change Requests' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 10,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <DatabaseOutlined style={{ fontSize: 24, color: '#fff' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Data Change Requests</Title>
                <Text type="secondary">Controlled, audited updates to transactional data</Text>
              </div>
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadRequests}>Refresh</Button>
              <Button type="primary" icon={<PlusOutlined />}
                onClick={() => { resetWizard(); setWizardOpen(true); }}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                New Request
              </Button>
            </Space>
          </div>

          {/* Filters */}
          <Card style={{ marginBottom: 16, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
            <Row gutter={16} align="middle">
              <Col>
                <Text strong style={{ marginRight: 8 }}>Status:</Text>
                <Select value={filterStatus} onChange={setFilterStatus} allowClear placeholder="All" style={{ width: 140 }}>
                  {['DRAFT','PENDING','APPROVED','EXECUTED','REJECTED'].map(s =>
                    <Select.Option key={s} value={s}><Tag color={statusColor[s]}>{s}</Tag></Select.Option>
                  )}
                </Select>
              </Col>
              <Col>
                <Text strong style={{ marginRight: 8 }}>Type:</Text>
                <Select value={filterType} onChange={setFilterType} allowClear placeholder="All" style={{ width: 220 }}>
                  {Object.entries(TXN_CONFIGS).map(([k, v]) =>
                    <Select.Option key={k} value={k}>{v.label}</Select.Option>
                  )}
                </Select>
              </Col>
              <Col><Button icon={<SearchOutlined />} onClick={loadRequests}>Search</Button></Col>
            </Row>
          </Card>

          <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
            <Table
              dataSource={requests} columns={listColumns} rowKey="requestId"
              loading={loading} size="small"
              pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} requests` }}
              locale={{ emptyText: <Empty description="No change requests found" /> }}
            />
          </Card>
        </div>
      </Content>

      {/* ── New Request Wizard ─────────────────────────────────────────────── */}
      <Modal
        open={wizardOpen}
        onCancel={resetWizard}
        width={960}
        footer={null}
        title={
          <Space>
            <EditOutlined style={{ color: REDWOOD.primary }} />
            <span>New Data Change Request</span>
          </Space>
        }
        destroyOnClose
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto' } }}
      >
        <Steps current={step} size="small" style={{ marginBottom: 12 }}
          items={[
            { title: 'Search & Select' },
            { title: 'Edit Values' },
            { title: 'Preview SQL' },
            { title: 'Done' },
          ]}
        />

        {/* ── DB Info Panel ───────────────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <Button
            size="small" type="link" icon={<DatabaseOutlined />}
            onClick={() => setShowDbInfo(v => !v)}
            style={{ padding: 0, fontSize: 12, color: REDWOOD.info }}
          >
            {showDbInfo ? 'Hide' : 'Show'} Database Tables & SQL Scripts
          </Button>
          {showDbInfo && (
            <Card size="small" style={{ marginTop: 8, borderRadius: 8, background: '#f0f5ff', border: '1px solid #adc6ff' }}>
              <Row gutter={[16, 12]}>
                <Col xs={24}>
                  <Text strong style={{ fontSize: 13, color: '#003eb3' }}>
                    <DatabaseOutlined style={{ marginRight: 6 }} />
                    Audit Tables (created by this feature)
                  </Text>
                </Col>
                {[
                  {
                    table: 'RR_DATA_CHANGE_REQUEST_HEADER',
                    desc: 'One row per change request',
                    cols: 'REQUEST_ID, REQUEST_NUMBER (DCR-00001), STATUS, TRANSACTION_TYPE, TRANSACTION_ID, TABLE_NAME, DESCRIPTION, CREATED_BY, CREATION_DATE, EXECUTED_BY, EXECUTED_DATE',
                  },
                  {
                    table: 'RR_DATA_CHANGE_REQUEST_DETAILS',
                    desc: 'One row per column changed',
                    cols: 'DETAIL_ID, REQUEST_ID, TABLE_NAME, COLUMN_NAME, OLD_VALUE, NEW_VALUE, WHERE_COLUMN, WHERE_VALUE, CREATED_BY',
                  },
                  {
                    table: 'RR_DATA_CHANGE_REQUEST_SQL',
                    desc: 'Generated SQL + execution result',
                    cols: 'SQL_ID, REQUEST_ID, SQL_TEXT (full UPDATE statement), EXECUTION_STATUS (PENDING/SUCCESS/ERROR), ROWS_AFFECTED, ERROR_MESSAGE, EXECUTED_BY, EXECUTED_DATE',
                  },
                ].map(row => (
                  <Col xs={24} key={row.table}>
                    <div style={{ background: '#fff', border: '1px solid #d6e4ff', borderRadius: 6, padding: '8px 12px' }}>
                      <Text strong style={{ fontFamily: 'monospace', fontSize: 12, color: '#003eb3' }}>{row.table}</Text>
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>— {row.desc}</Text>
                      <div style={{ marginTop: 4 }}>
                        <Text style={{ fontSize: 11, color: '#595959', fontFamily: 'monospace' }}>{row.cols}</Text>
                      </div>
                    </div>
                  </Col>
                ))}

                {cfg && (
                  <>
                    <Col xs={24}>
                      <Divider style={{ margin: '4px 0' }} />
                      <Text strong style={{ fontSize: 13, color: '#003eb3' }}>
                        Target Table for Selected Type: <Text code style={{ fontSize: 13 }}>{cfg.tableName}</Text>
                      </Text>
                    </Col>
                    <Col xs={24} sm={12}>
                      <div style={{ background: '#fff', border: '1px solid #d6e4ff', borderRadius: 6, padding: '8px 12px' }}>
                        <Text strong style={{ fontSize: 12 }}>UPDATE statement generated:</Text>
                        <pre style={{ margin: '6px 0 0', fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
{`UPDATE ${cfg.tableName}
  SET <column> = <new_value>
  WHERE ${cfg.pkColumn} = <pk_value>;`}
                        </pre>
                      </div>
                    </Col>
                    <Col xs={24} sm={12}>
                      <div style={{ background: '#fff', border: '1px solid #d6e4ff', borderRadius: 6, padding: '8px 12px' }}>
                        <Text strong style={{ fontSize: 12 }}>Trigger fires automatically on UPDATE:</Text>
                        <pre style={{ margin: '6px 0 0', fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
{`-- BEFORE UPDATE trigger on ${cfg.tableName}
INSERT INTO ${cfg.tableName}_UPD
  SELECT src.*, SYSDATE, USER, SYS_CONTEXT(...)
  FROM ${cfg.tableName} src
  WHERE <pk> = :OLD.<pk>;

-- Blocks direct SQL (non-ORDS) updates`}
                        </pre>
                      </div>
                    </Col>
                    <Col xs={24}>
                      <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '8px 12px' }}>
                        <Text strong style={{ fontSize: 12, color: '#874d00' }}>History table (auto-populated by trigger):</Text>
                        <Text style={{ fontSize: 11, marginLeft: 8, fontFamily: 'monospace' }}>{cfg.tableName}_UPD</Text>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                          Contains the full row snapshot BEFORE each update — same columns as {cfg.tableName} plus CHANGED_DATE, CHANGED_BY, CHANGED_FROM_MODULE
                        </Text>
                      </div>
                    </Col>
                  </>
                )}

                <Col xs={24}>
                  <Divider style={{ margin: '4px 0' }} />
                  <Text strong style={{ fontSize: 13, color: '#003eb3' }}>ORDS Endpoints used by this page</Text>
                  {[
                    { method: 'POST', path: '/admin/change-requests/search', desc: 'Dynamic search — builds SQL from type config, returns col1..col5' },
                    { method: 'GET',  path: '/admin/record?table_name=&pk_col=&pk_val=', desc: 'Fetch full row via DBMS_SQL (dynamic columns)' },
                    { method: 'POST', path: '/admin/change-requests', desc: 'Create header row in RR_DATA_CHANGE_REQUEST_HEADER' },
                    { method: 'POST', path: '/admin/change-requests/:id/details', desc: 'Insert detail rows (old/new values per column)' },
                    { method: 'POST', path: '/admin/change-requests/:id/execute', desc: 'Run each UPDATE statement, log result to RR_DATA_CHANGE_REQUEST_SQL' },
                    { method: 'GET',  path: '/admin/compare?table_name=&pk_col=&pk_val=', desc: 'Fetch current row + _UPD history via DBMS_SQL for comparison view' },
                  ].map(ep => (
                    <div key={ep.path} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
                      <Tag color={ep.method === 'POST' ? 'orange' : 'blue'} style={{ fontFamily: 'monospace', minWidth: 46, textAlign: 'center', margin: 0 }}>{ep.method}</Tag>
                      <Text style={{ fontFamily: 'monospace', fontSize: 11, color: '#003eb3' }}>{ep.path}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>— {ep.desc}</Text>
                    </div>
                  ))}
                </Col>
              </Row>
            </Card>
          )}
        </div>

        {/* ── Step 0: Search ─────────────────────────────────────── */}
        {step === 0 && (
          <>
            {/* Type selector */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={10}>
                <Text strong>Transaction Type</Text>
                <Select
                  value={txnType || undefined}
                  onChange={v => {
                    setTxnType(v);
                    setSearchResults([]);
                    setSelectedRecord(null);
                    searchForm.resetFields();
                  }}
                  placeholder="Select transaction type"
                  style={{ width: '100%', marginTop: 4 }}
                  size="large"
                >
                  {Object.entries(TXN_CONFIGS).map(([k, v]) =>
                    <Select.Option key={k} value={k}>{v.label}</Select.Option>
                  )}
                </Select>
              </Col>
            </Row>

            {/* Dynamic search fields */}
            {cfg && (
              <Card
                size="small"
                style={{ marginBottom: 16, background: REDWOOD.neutral100, borderRadius: 8 }}
                title={<Text strong>Search {cfg.label}</Text>}
              >
                <Form form={searchForm} layout="vertical" onFinish={runSearch}>
                  <Row gutter={12}>
                    {cfg.searchFields.map(sf => (
                      <Col key={sf.param} xs={24} sm={12} md={8}>
                        <Form.Item label={sf.label} name={sf.param} style={{ marginBottom: 10 }}>
                          {sf.type === 'select' ? (
                            <Select allowClear placeholder={`Select ${sf.label.toLowerCase()}`}>
                              {(sf.options || []).map(o => <Select.Option key={o} value={o}>{o}</Select.Option>)}
                            </Select>
                          ) : sf.type === 'date' ? (
                            <DatePicker style={{ width: '100%' }} />
                          ) : (
                            <Input placeholder={sf.placeholder} />
                          )}
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                  <Button htmlType="submit" type="primary" icon={<SearchOutlined />}
                    loading={searching}
                    style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                    Search
                  </Button>
                </Form>
              </Card>
            )}

            {/* Search results */}
            {searchResults.length > 0 && cfg && (
              <Card size="small" style={{ borderRadius: 8 }}
                title={
                  <Space>
                    <Text strong>Results</Text>
                    <Badge count={searchResults.length} color="#0572CE" />
                    <Text type="secondary" style={{ fontSize: 12 }}>Click <strong>Select</strong> to choose a record</Text>
                  </Space>
                }
              >
                <Table
                  dataSource={searchResults}
                  columns={searchResultCols}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  scroll={{ x: 600 }}
                />
              </Card>
            )}

            {/* Reason */}
            <Form form={wizardForm} layout="vertical" style={{ marginTop: 16 }}>
              <Form.Item label="Reason / Notes" name="description">
                <TextArea rows={2} placeholder="Describe why this change is needed…" />
              </Form.Item>
            </Form>
          </>
        )}

        {/* ── Step 1: Edit values ────────────────────────────────── */}
        {step === 1 && cfg && selectedRecord && (
          <>
            <Alert
              type="warning" showIcon icon={<ExclamationCircleOutlined />}
              message={
                <span>
                  Editing <strong>{cfg.tableName}</strong> — {cfg.pkColumn} = <strong>{selectedRecord.id}</strong>
                  {selectedRecord.col1 ? ` (${selectedRecord.col1})` : ''}
                </span>
              }
              description="Modify the 'New Value' field for each column you want to change. Only modified rows will be included."
              style={{ marginBottom: 16 }}
            />
            <Table
              dataSource={detailLines}
              columns={detailEditCols}
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ y: 340 }}
            />
            {changedLines.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <Tag color="orange">{changedLines.length} column(s) modified</Tag>
              </div>
            )}
          </>
        )}

        {/* ── Step 2: SQL preview ────────────────────────────────── */}
        {step === 2 && (
          <>
            <Alert type="warning" showIcon
              message="Review the SQL before executing. This cannot be automatically undone."
              style={{ marginBottom: 12 }}
            />

            {/* Tables & execution summary */}
            {cfg && selectedRecord && (
              <Card size="small" style={{ marginBottom: 14, borderRadius: 8, background: '#f0f5ff', border: '1px solid #adc6ff' }}>
                <Row gutter={[12, 8]}>
                  <Col xs={24} sm={8}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Target Table</Text>
                    <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{cfg.tableName}</Text>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>WHERE Clause</Text>
                    <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{cfg.pkColumn} = {selectedRecord.id}</Text>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Statements to Execute</Text>
                    <Text strong style={{ fontSize: 12 }}>{changedLines.length} UPDATE(s)</Text>
                  </Col>
                  <Col xs={24}>
                    <Divider style={{ margin: '4px 0' }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Each statement will trigger: <Text code style={{ fontSize: 11 }}>{cfg.tableName}_UPD</Text> (row snapshot archived by BEFORE UPDATE trigger)
                      {' · '}audit rows saved to <Text code style={{ fontSize: 11 }}>RR_DATA_CHANGE_REQUEST_SQL</Text>
                    </Text>
                  </Col>
                </Row>
              </Card>
            )}

            {changedLines.map(d => (
              <Card key={d.key} size="small" style={{ marginBottom: 10, borderRadius: 6, background: '#f6ffed', border: '1px solid #b7eb8f' }}
                title={
                  <Space>
                    <FileTextOutlined />
                    <Text strong>{d.columnLabel}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <del style={{ opacity: 0.5 }}>{d.oldValue || '—'}</del>
                      {' → '}
                      <Text strong style={{ color: REDWOOD.primary }}>{d.newValue}</Text>
                    </Text>
                  </Space>
                }
              >
                <pre style={{ margin: 0, fontSize: 12, fontFamily: 'monospace', background: '#f0f0f0', padding: 10, borderRadius: 4 }}>
                  {buildSQL(d)}
                </pre>
              </Card>
            ))}
            <Text type="secondary" style={{ fontSize: 12 }}>
              Saved as Change Request #{savedRequestId}. Click Execute to apply.
            </Text>
          </>
        )}

        {/* ── Step 3: Done ───────────────────────────────────────── */}
        {step === 3 && (
          <>
            <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
              <CheckCircleOutlined style={{ fontSize: 48, color: REDWOOD.success }} />
              <Title level={4} style={{ marginTop: 10 }}>Change Request Executed</Title>
            </div>
            {execResults.map((r, i) => (
              <Card key={i} size="small" style={{ marginBottom: 8, borderRadius: 6 }}>
                <Row gutter={12} align="middle">
                  <Col>
                    {r.status === 'SUCCESS'
                      ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 18 }} />
                      : <CloseCircleOutlined style={{ color: REDWOOD.error, fontSize: 18 }} />}
                  </Col>
                  <Col flex={1}>
                    <Text strong>{r.status}</Text>
                    {r.rowsAffected != null && <Text type="secondary"> — {r.rowsAffected} row(s) affected</Text>}
                    {r.error && <Text type="danger"> — {r.error}</Text>}
                  </Col>
                </Row>
                {r.sql && (
                  <pre style={{ marginTop: 8, fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4, overflow: 'auto' }}>
                    {r.sql}
                  </pre>
                )}
              </Card>
            ))}
          </>
        )}

        {/* ── Query Log Panel (search + record fetch SQL) ─────────── */}
        {queryLog.length > 0 && showQueryLog && (
          <div style={{ marginTop: 12, border: '1px solid #91caff', borderRadius: 6, overflow: 'hidden', fontSize: 12 }}>
            <div style={{ background: '#e6f4ff', borderBottom: '1px solid #91caff', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <DatabaseOutlined style={{ color: '#0958d9' }} />
              <Text strong style={{ fontSize: 12, flex: 1, color: '#0958d9' }}>Dynamic SQL Log — queries sent to Oracle</Text>
              <Button size="small" type="text" onClick={() => setShowQueryLog(false)}>✕</Button>
            </div>
            {queryLog.map((entry, idx) => (
              <div key={idx} style={{ borderBottom: idx < queryLog.length - 1 ? '1px solid #e0e0e0' : 'none', padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Tag color={entry.method === 'POST' ? 'orange' : 'blue'} style={{ fontFamily: 'monospace', margin: 0 }}>{entry.method}</Tag>
                  <Text strong style={{ fontSize: 11, color: '#595959' }}>{entry.label}</Text>
                  <Text style={{ fontFamily: 'monospace', fontSize: 11, flex: 1, color: '#0958d9', wordBreak: 'break-all' }}>{entry.url}</Text>
                  <Tag color={entry.httpStatus && entry.httpStatus < 300 ? 'green' : entry.httpStatus ? 'red' : 'default'} style={{ margin: 0 }}>
                    HTTP {entry.httpStatus ?? '…'}
                  </Tag>
                </div>
                <Row gutter={8}>
                  {entry.payload && (
                    <Col xs={24} md={10}>
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>POST JSON Body</Text>
                      <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', background: '#fff7e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591', maxHeight: 110, overflowY: 'auto' }}>
                        {JSON.stringify(entry.payload, null, 2)}
                      </pre>
                    </Col>
                  )}
                  {entry.generatedSql && (
                    <Col xs={24} md={entry.payload ? 14 : 24}>
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>SQL executed on Oracle (via DBMS_SQL)</Text>
                      <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', background: '#f0f5ff', padding: 6, borderRadius: 4, border: '1px solid #adc6ff', maxHeight: 110, overflowY: 'auto' }}>
                        {entry.generatedSql}
                      </pre>
                    </Col>
                  )}
                </Row>
              </div>
            ))}
          </div>
        )}

        {/* ── API Debug Panel (save / execute calls) ──────────────── */}
        {apiLog && showApiLog && (
          <div style={{ marginTop: 8, border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden', fontSize: 12 }}>
            <div style={{
              background: apiLog.httpStatus && apiLog.httpStatus < 300 ? '#f6ffed' : '#fff1f0',
              borderBottom: '1px solid #d9d9d9', padding: '5px 12px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Tag color="blue" style={{ fontFamily: 'monospace', margin: 0 }}>{apiLog.method}</Tag>
              <Text style={{ fontFamily: 'monospace', fontSize: 11, flex: 1, wordBreak: 'break-all' }}>{apiLog.url}</Text>
              <Tag color={apiLog.httpStatus && apiLog.httpStatus < 300 ? 'green' : apiLog.httpStatus ? 'red' : 'default'}>
                HTTP {apiLog.httpStatus ?? '—'}
              </Tag>
              <Button size="small" type="text" onClick={() => setShowApiLog(false)}>✕</Button>
            </div>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Request Body</Text>
              <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', background: '#fafafa', padding: 8, borderRadius: 4, maxHeight: 120, overflowY: 'auto', border: '1px solid #f0f0f0' }}>
                {JSON.stringify(apiLog.payload, null, 2)}
              </pre>
            </div>
            <div style={{ padding: '8px 12px' }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Response</Text>
              <pre style={{
                margin: 0, fontSize: 11, fontFamily: 'monospace', background: '#fafafa', padding: 8,
                borderRadius: 4, maxHeight: 150, overflowY: 'auto', border: '1px solid #f0f0f0',
                color: apiLog.httpStatus && apiLog.httpStatus >= 400 ? '#cf1322' : 'inherit',
              }}>
                {(() => { try { return JSON.stringify(JSON.parse(apiLog.rawResponse), null, 2); } catch { return apiLog.rawResponse || '(empty)'; } })()}
              </pre>
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────── */}
        <Divider style={{ margin: '14px 0 10px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* API log toggle on left */}
          <Space size={6}>
            <Tooltip title="Show SQL queries (search + record fetch) sent to Oracle">
              <Button
                size="small"
                icon={<DatabaseOutlined />}
                onClick={() => setShowQueryLog(v => !v)}
                type={queryLog.length > 0 ? 'default' : 'text'}
                style={{ opacity: queryLog.length > 0 ? 1 : 0.35, borderColor: queryLog.length > 0 ? '#91caff' : undefined, color: queryLog.length > 0 ? '#0958d9' : undefined }}
              >
                SQL Log {queryLog.length > 0 ? `(${queryLog.length})` : ''}
              </Button>
            </Tooltip>
            <Tooltip title={showApiLog ? 'Hide save/execute API log' : 'Show save/execute API log'}>
              <Button
                size="small"
                icon={<ApiOutlined />}
                onClick={() => setShowApiLog(v => !v)}
                type={apiLog ? (apiLog.httpStatus && apiLog.httpStatus >= 400 ? 'primary' : 'default') : 'text'}
                danger={!!(apiLog && apiLog.httpStatus && apiLog.httpStatus >= 400)}
                style={{ opacity: apiLog ? 1 : 0.35 }}
              >
                {apiLog ? `HTTP ${apiLog.httpStatus ?? '…'}` : 'API Log'}
              </Button>
            </Tooltip>
          </Space>
          <div style={{ display: 'flex', gap: 8 }}>
          {step < 3 && <Button onClick={resetWizard}>Cancel</Button>}
          {step === 0 && (
            <Button type="primary" disabled={!txnType || !selectedRecord}
              onClick={() => step === 0 && selectedRecord && setStep(1)}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
              Continue with selected record →
            </Button>
          )}
          {step === 1 && (
            <>
              <Button onClick={() => setStep(0)}>← Back</Button>
              <Button type="primary" loading={saving} onClick={saveAndPreview}
                disabled={changedLines.length === 0}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
                Save & Preview SQL →
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button onClick={() => setStep(1)}>← Back</Button>
              <Popconfirm
                title="Execute these SQL updates?"
                description={`${changedLines.length} UPDATE statement(s) will run against the database.`}
                onConfirm={executeRequest}
                okText="Execute" okButtonProps={{ danger: true }}
              >
                <Button type="primary" danger loading={executing} icon={<PlayCircleOutlined />}>
                  Execute
                </Button>
              </Popconfirm>
            </>
          )}
          {step === 3 && (
            <Button type="primary" onClick={resetWizard}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}>
              Close
            </Button>
          )}
          </div>{/* end right buttons */}
        </div>{/* end footer row */}
      </Modal>

      {/* ── View Detail Modal ──────────────────────────────────────────────── */}
      <Modal
        open={viewOpen}
        onCancel={() => { setViewOpen(false); setViewRequest(null); setCompareData(null); }}
        width={980}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Tooltip title="Show SQL queries sent to Oracle for this dialog">
              <Button
                size="small"
                icon={<DatabaseOutlined />}
                onClick={() => setShowViewApiLog(v => !v)}
                type={viewApiLog.length > 0 ? 'default' : 'text'}
                style={{ borderColor: viewApiLog.length > 0 ? '#91caff' : undefined, color: viewApiLog.length > 0 ? '#0958d9' : undefined, opacity: viewApiLog.length > 0 ? 1 : 0.4 }}
              >
                SQL Log {viewApiLog.length > 0 ? `(${viewApiLog.length})` : ''}
              </Button>
            </Tooltip>
            <Button onClick={() => { setViewOpen(false); setViewRequest(null); setCompareData(null); setViewApiLog([]); setShowViewApiLog(false); }}>Close</Button>
          </div>
        }
        styles={{ body: { maxHeight: '82vh', overflowY: 'auto' } }}
        title={
          <Space>
            <HistoryOutlined style={{ color: REDWOOD.primary }} />
            Change Request Detail
            {viewRequest?.header && <Tag color={statusColor[viewRequest.header.status]}>{viewRequest.header.status}</Tag>}
          </Space>
        }
      >
        {loadingView ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : viewRequest?.success === false ? (
          <Alert type="error" showIcon
            message="Failed to load change request"
            description={viewRequest.error || 'Unknown error — the GET handler may need to be redeployed (file 03).'}
          />
        ) : viewRequest?.header ? (
          <>
            {/* Header info */}
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 20 }}>
              <Descriptions.Item label="Request #">
                <Text strong>{viewRequest.header.requestNumber}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={statusColor[viewRequest.header.status] || 'default'}>{viewRequest.header.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Type">
                {TXN_CONFIGS[viewRequest.header.transactionType]?.label || viewRequest.header.transactionType}
              </Descriptions.Item>
              <Descriptions.Item label="Ref">{viewRequest.header.transactionRef}</Descriptions.Item>
              <Descriptions.Item label="Table"><Text code>{viewRequest.header.tableName}</Text></Descriptions.Item>
              <Descriptions.Item label="Created By">{viewRequest.header.createdBy}</Descriptions.Item>
              <Descriptions.Item label="Executed By">{viewRequest.header.executedBy || '—'}</Descriptions.Item>
              <Descriptions.Item label="Executed Date">{viewRequest.header.executedDate || '—'}</Descriptions.Item>
              <Descriptions.Item label="Notes" span={2}>{viewRequest.header.description || '—'}</Descriptions.Item>
            </Descriptions>

            {/* Changed columns */}
            {viewRequest.details?.length > 0 ? (
              <>
                <Divider orientation="left" style={{ margin: '0 0 12px' }}>
                  <Space><EditOutlined /><Text strong>Changed Columns ({viewRequest.details.length})</Text></Space>
                </Divider>
                <Table
                  dataSource={viewRequest.details}
                  rowKey="detailId"
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 20 }}
                  columns={[
                    { title: 'Column', dataIndex: 'columnLabel', width: 180 },
                    { title: 'Type', dataIndex: 'dataType', width: 90, render: (v: string) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
                    { title: 'Old Value', dataIndex: 'oldValue', render: (v: string) => <Text type="secondary" delete>{v || '—'}</Text> },
                    { title: 'New Value', dataIndex: 'newValue', render: (v: string) => <Text strong style={{ color: REDWOOD.primary }}>{v || '—'}</Text> },
                    { title: 'WHERE Clause', key: 'where', render: (_: any, r: any) => <Text code style={{ fontSize: 11 }}>{r.whereColumn} = {r.whereValue}</Text> },
                  ]}
                />
              </>
            ) : (
              <Alert type="info" message="No detail lines saved for this request." style={{ marginBottom: 16 }} />
            )}

            {/* SQL audit log */}
            {viewRequest.sqls?.length > 0 && (
              <>
                <Divider orientation="left" style={{ margin: '0 0 12px' }}>
                  <Space><FileTextOutlined /><Text strong>SQL Audit Log ({viewRequest.sqls.length})</Text></Space>
                </Divider>
                {viewRequest.sqls.map((s: any, i: number) => (
                  <Card key={i} size="small" style={{
                    marginBottom: 10, borderRadius: 6,
                    borderColor: s.executionStatus === 'SUCCESS' ? '#b7eb8f' : s.executionStatus === 'ERROR' ? '#ffccc7' : '#d9d9d9',
                    background: s.executionStatus === 'SUCCESS' ? '#f6ffed' : s.executionStatus === 'ERROR' ? '#fff2f0' : '#fafafa',
                  }}>
                    <Row align="middle" gutter={8} style={{ marginBottom: 6 }}>
                      <Col>
                        {s.executionStatus === 'SUCCESS'
                          ? <Tag color="success" icon={<CheckCircleOutlined />}>SUCCESS</Tag>
                          : s.executionStatus === 'ERROR'
                          ? <Tag color="error" icon={<CloseCircleOutlined />}>ERROR</Tag>
                          : <Tag>PENDING</Tag>}
                      </Col>
                      <Col><Text type="secondary" style={{ fontSize: 12 }}>{s.executedDate || '—'}</Text></Col>
                      {s.rowsAffected != null && (
                        <Col><Tag color="blue">{s.rowsAffected} row(s) affected</Tag></Col>
                      )}
                    </Row>
                    <pre style={{
                      margin: 0, fontSize: 12, fontFamily: 'monospace',
                      background: 'rgba(0,0,0,0.04)', padding: '8px 12px',
                      borderRadius: 4, overflow: 'auto', maxHeight: 140,
                      border: '1px solid rgba(0,0,0,0.06)',
                    }}>
                      {s.sqlText}
                    </pre>
                    {s.errorMessage && (
                      <Alert type="error" message={s.errorMessage} style={{ marginTop: 6 }} showIcon />
                    )}
                  </Card>
                ))}
              </>
            )}

            {/* ── Live Comparison: current vs _UPD history ── */}
            <Divider orientation="left" style={{ margin: '4px 0 12px' }}>
              <Space><DatabaseOutlined /><Text strong>Live Comparison — Current vs Change History</Text></Space>
            </Divider>
            {loadingCompare ? (
              <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>
            ) : compareData?.success === false ? (
              <Alert type="warning" showIcon
                message={`Could not load comparison: ${compareData.error}`}
                style={{ marginBottom: 12 }}
              />
            ) : compareData ? (() => {
              const current = compareData.current || {};
              const history: any[] = compareData.history || [];
              // Only show columns that actually changed (from details), plus audit cols
              const changedColNames = (viewRequest?.details || []).map((d: any) => d.columnName);
              const auditCols = ['CHANGED_BY','CHANGED_DATE','CHANGED_FROM_MODULE'];

              // Build comparison rows: one row per changed column
              const compRows = changedColNames.map((col: string, i: number) => {
                const detail = (viewRequest?.details || []).find((d: any) => d.columnName === col);
                return {
                  key: String(i),
                  column:  detail?.columnLabel || col,
                  dbCol:   col,
                  current: current[col] ?? '—',
                  // show most recent _UPD value = what it was BEFORE the change
                  before:  history.length > 0 ? (history[0][col] ?? '—') : '—',
                };
              });

              return (
                <>
                  {/* Column diff table */}
                  {compRows.length > 0 && (
                    <Table
                      dataSource={compRows}
                      rowKey="key"
                      size="small"
                      pagination={false}
                      style={{ marginBottom: 16 }}
                      columns={[
                        { title: 'Column', dataIndex: 'column', width: 200 },
                        {
                          title: 'Before (from _UPD)',
                          dataIndex: 'before',
                          render: (v: string) => (
                            <Text delete type="secondary" style={{ color: '#8c8c8c' }}>{v}</Text>
                          ),
                        },
                        {
                          title: 'After (current in DB)',
                          dataIndex: 'current',
                          render: (v: string, r: any) => {
                            const changed = v !== r.before;
                            return <Text strong style={{ color: changed ? REDWOOD.success : 'inherit' }}>{v}</Text>;
                          },
                        },
                      ]}
                    />
                  )}

                  {/* Full _UPD history timeline */}
                  {history.length > 0 && (
                    <>
                      <Text strong style={{ display: 'block', marginBottom: 8 }}>
                        Change History from {compareData.updTable} ({history.length} snapshot{history.length > 1 ? 's' : ''})
                      </Text>
                      {history.map((row: any, idx: number) => (
                        <Card key={idx} size="small" style={{
                          marginBottom: 8, borderRadius: 6,
                          background: idx === 0 ? '#fffbe6' : '#fafafa',
                          borderColor: idx === 0 ? '#ffe58f' : '#f0f0f0',
                        }}>
                          <Row gutter={16} style={{ marginBottom: 6 }}>
                            <Col>
                              <Tag color={idx === 0 ? 'gold' : 'default'}>
                                {idx === 0 ? 'Most Recent' : `Snapshot ${idx + 1}`}
                              </Tag>
                            </Col>
                            <Col>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {row.CHANGED_DATE || '—'}
                              </Text>
                            </Col>
                            <Col>
                              <Text style={{ fontSize: 12 }}>
                                by <strong>{row.CHANGED_BY || '—'}</strong>
                              </Text>
                            </Col>
                            {row.CHANGED_FROM_MODULE && (
                              <Col>
                                <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                                  {row.CHANGED_FROM_MODULE}
                                </Text>
                              </Col>
                            )}
                          </Row>
                          {/* Show only the changed columns for this snapshot */}
                          <Row gutter={8}>
                            {changedColNames.map((col: string) => {
                              const detail = (viewRequest?.details || []).find((d: any) => d.columnName === col);
                              const val = row[col];
                              return val != null ? (
                                <Col key={col} xs={24} sm={12} md={8} style={{ marginBottom: 4 }}>
                                  <Text type="secondary" style={{ fontSize: 11 }}>{detail?.columnLabel || col}: </Text>
                                  <Text style={{ fontSize: 12 }}>{val || '—'}</Text>
                                </Col>
                              ) : null;
                            })}
                          </Row>
                        </Card>
                      ))}
                    </>
                  )}

                  {history.length === 0 && (
                    <Alert type="info" showIcon
                      message={`No change history found in ${compareData.updTable || ((viewRequest?.header?.tableName || '') + '_UPD')} for this record.`}
                      description="The _UPD table only captures rows when an UPDATE is made through the ReERP UI triggers."
                      style={{ marginBottom: 8 }}
                    />
                  )}
                </>
              );
            })() : null}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Text type="secondary">No data available</Text>
          </div>
        )}

        {/* ── View SQL Log Panel ─────────────────────────────────── */}
        {viewApiLog.length > 0 && showViewApiLog && (
          <div style={{ marginTop: 16, border: '1px solid #91caff', borderRadius: 6, overflow: 'hidden', fontSize: 12 }}>
            <div style={{ background: '#e6f4ff', borderBottom: '1px solid #91caff', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <DatabaseOutlined style={{ color: '#0958d9' }} />
              <Text strong style={{ fontSize: 12, flex: 1, color: '#0958d9' }}>SQL Log — queries sent to Oracle for this dialog</Text>
              <Button size="small" type="text" onClick={() => setShowViewApiLog(false)}>✕</Button>
            </div>
            {viewApiLog.map((entry, idx) => (
              <div key={idx} style={{ borderBottom: idx < viewApiLog.length - 1 ? '1px solid #e0e0e0' : 'none', padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Tag color="blue" style={{ fontFamily: 'monospace', margin: 0 }}>GET</Tag>
                  <Text strong style={{ fontSize: 11, color: '#595959' }}>{entry.label}</Text>
                  <Tag color={entry.httpStatus && entry.httpStatus < 300 ? 'green' : entry.httpStatus ? 'red' : 'default'} style={{ margin: 0 }}>
                    HTTP {entry.httpStatus ?? '…'}
                  </Tag>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>URL</Text>
                  <Text style={{ fontFamily: 'monospace', fontSize: 10, color: '#0958d9', wordBreak: 'break-all' }}>{entry.url}</Text>
                </div>
                <Row gutter={8}>
                  {entry.generatedSql && (
                    <Col xs={24} md={12}>
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>SQL executed on Oracle (via DBMS_SQL)</Text>
                      <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', background: '#f0f5ff', padding: 6, borderRadius: 4, border: '1px solid #adc6ff', maxHeight: 140, overflowY: 'auto' }}>
                        {entry.generatedSql}
                      </pre>
                    </Col>
                  )}
                  <Col xs={24} md={entry.generatedSql ? 12 : 24}>
                    <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>Response</Text>
                    <pre style={{ margin: 0, fontSize: 10, fontFamily: 'monospace', background: entry.httpStatus && entry.httpStatus >= 400 ? '#fff2f0' : '#f6ffed', padding: 6, borderRadius: 4, border: `1px solid ${entry.httpStatus && entry.httpStatus >= 400 ? '#ffccc7' : '#b7eb8f'}`, maxHeight: 140, overflowY: 'auto', color: entry.httpStatus && entry.httpStatus >= 400 ? '#cf1322' : 'inherit' }}>
                      {(() => { try { return JSON.stringify(JSON.parse(entry.rawResponse), null, 2); } catch { return entry.rawResponse || '(empty)'; } })()}
                    </pre>
                  </Col>
                </Row>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default ManageChangeRequest;
