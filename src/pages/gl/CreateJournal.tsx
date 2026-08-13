import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';
import {
  Layout,
  Card,
  Form,
  Input,
  Select,
  Button,
  Space,
  Typography,
  Table,
  Tag,
  Row,
  Col,
  Tooltip,
  Dropdown,
  Tabs,
  DatePicker,
  InputNumber,
  message,
  Popover,
  Modal,
  Upload,
  Spin,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SaveOutlined,
  CloseOutlined,
  DownOutlined,
  PlusOutlined,
  DeleteOutlined,
  FileTextOutlined,
  PaperClipOutlined,
  LeftOutlined,
  RightOutlined,
  QuestionCircleOutlined,
  TableOutlined,
  ColumnWidthOutlined,
  SplitCellsOutlined,
  SearchOutlined,
  InfoCircleOutlined,
  FilePdfOutlined,
  ApiOutlined,
  ReloadOutlined,
  CheckSquareOutlined,
  CopyOutlined,
  CheckOutlined,
  EyeOutlined,
  DownloadOutlined,
  CloudUploadOutlined,
  EditOutlined,
  LockOutlined,
  BarChartOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);
import type { Dayjs } from 'dayjs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import AccountSelector, { validateAccountCode } from '../../components/AccountSelector';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { searchCombinations } from '../../services/distCombinations.service';
import type { DistCombination } from '../../services/distCombinations.service';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral400: '#bfbfbf',
  neutral500: '#8c8c8c',
  neutral600: '#6B6B6B',
  neutral700: '#595959',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

// Currency interface from API
interface Currency {
  code: string;
  name: string;
}

// Ledger interface from API
interface Ledger {
  ledger_id: number;
  ledger_name: string;
  description: string;
  ledger_category_code: string;
  currency_code: string;
  chart_of_accounts_id: string;
}

// Period interface from API
interface Period {
  period_name_id: string;
  ledger_name: string;
  app: string;
  application_name: string;
  status: string;
  start_date: string;
  end_date: string;
  period_year: number;
  period_number: number;
  adj_flag: string;
}

// Segment detail for account
interface SegmentDetail {
  value: string;
  description: string;
  name: string; // User-friendly name like "Company", "Cost Center"
}

// Journal Line interface
interface JournalLine {
  key: string;
  lineNum: number;
  distributionId?: number | null;
  account: string;
  accountDescription: string;
  segmentDetails: Record<string, SegmentDetail>;
  currency: string;
  enteredDr: number | null;
  enteredCr: number | null;
  conversionDate: string;
  accountedDr: number | null;
  accountedCr: number | null;
  description: string;
}

// Batch data interface
interface BatchData {
  batchName: string;
  description: string;
  balanceType: string;
  accountingPeriod: string;
}

// Journal data interface
interface JournalData {
  journalName: string;
  description: string;
  ledger: string;
  legalEntity: string;
  accountingDate: string;
  category: string;
  currency: string;
  conversionDate: string;
  conversionRateType: string;
  conversionRate: number;
  inverseRate: number;
  reference: string;
  referenceDate: string;
  company: string;
  regionalInfo: string;
  // Control Total
  controlTotal: number | null;
  // Sequencing
  accountingSeqName: string;
  accountingSeqNumber: string;
  reportingSeqName: string;
  reportingSeqNumber: string;
  // Reversal
  reversalPeriod: string;
  reversalMethod: string;
}

// Journal Entry - combines journal data with its lines
interface JournalEntry {
  id: string;
  data: JournalData;
  lines: JournalLine[];
}

// Format number
const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2 });
};

// Generate batch name with timestamp
const generateBatchName = (): string => {
  const now = dayjs();
  return `JB-${now.format('YYYYMMDD-HHmmss')}`;
};

const GL_ORDS_BASE = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/gl';

// Period to last date mapping
const periodEndDates: Record<string, string> = {
  'Jan-26': '31-Jan-2026',
  'Feb-26': '28-Feb-2026',
  'Mar-26': '31-Mar-2026',
  'Apr-26': '30-Apr-2026',
  'May-26': '31-May-2026',
  'Jun-26': '30-Jun-2026',
  'Jul-26': '31-Jul-2026',
  'Aug-26': '31-Aug-2026',
  'Sep-26': '30-Sep-2026',
  'Oct-26': '31-Oct-2026',
  'Nov-26': '30-Nov-2026',
  'Dec-26': '31-Dec-2026',
};

// Get last date of period
const getPeriodEndDate = (period: string): string => {
  return periodEndDates[period] || dayjs().endOf('month').format('D-MMM-YYYY');
};

// Safely parse a date string in multiple formats — returns null if invalid
const parseDateSafe = (str: string | null | undefined): Dayjs | null => {
  if (!str) return null;
  for (const fmt of ['YYYY-MM-DD', 'D-MMM-YYYY', 'DD-MMM-YYYY', 'DD-MMM-YY', 'YYYY-MM-DDTHH:mm:ss']) {
    const d = dayjs(str, fmt, true);
    if (d.isValid()) return d;
  }
  // Last resort — let dayjs try on its own
  const d = dayjs(str);
  return d.isValid() ? d : null;
};

// Parse Oracle API end_date which may be ISO or Oracle DD-MON-YY format
const parseOracleDate = (str: string | null | undefined): Dayjs | null => parseDateSafe(str);

// Create default journal data
const createDefaultJournalData = (): JournalData => ({
  journalName: '',
  description: '',
  ledger: 'BUIMERC LEDGER',
  legalEntity: '',
  accountingDate: dayjs().format('D-MMM-YYYY'),
  category: '',
  currency: 'AED',
  conversionDate: dayjs().format('D-MMM-YYYY'),
  conversionRateType: 'User',
  conversionRate: 1,
  inverseRate: 1,
  reference: '',
  referenceDate: '',
  company: '',
  regionalInfo: '',
  controlTotal: null,
  accountingSeqName: '',
  accountingSeqNumber: '',
  reportingSeqName: '',
  reportingSeqNumber: '',
  reversalPeriod: '',
  reversalMethod: 'Switch DR or CR',
});

// Create default journal lines
const createDefaultLines = (currency: string = 'AED'): JournalLine[] => [
  {
    key: '1',
    lineNum: 1,
    account: '',
    accountDescription: '',
    segmentDetails: {},
    currency: currency,
    enteredDr: null,
    enteredCr: null,
    conversionDate: dayjs().format('D-MMM-YYYY'),
    accountedDr: null,
    accountedCr: null,
    description: '',
  },
  {
    key: '2',
    lineNum: 2,
    account: '',
    accountDescription: '',
    segmentDetails: {},
    currency: currency,
    enteredDr: null,
    enteredCr: null,
    conversionDate: dayjs().format('D-MMM-YYYY'),
    accountedDr: null,
    accountedCr: null,
    description: '',
  },
];

// Create a new journal entry
const createNewJournal = (id: string): JournalEntry => ({
  id,
  data: createDefaultJournalData(),
  lines: createDefaultLines(),
});

interface CreateJournalProps {
  embeddedMode?: boolean;   // true = rendered inside ManageJournals tab
  onSaved?: () => void;     // called after save/post/cancel so parent can close the tab
}

// Resizable column header
const ResizableTitle = (props: any) => {
  const { onResize, width, ...restProps } = props;
  if (!width) return <th {...restProps} />;
  return (
    <Resizable
      width={width}
      height={0}
      handle={<span className="react-resizable-handle" onClick={e => e.stopPropagation()} />}
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  );
};

const CreateJournal: React.FC<CreateJournalProps> = ({ embeddedMode = false, onSaved }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUser = user?.name || user?.username || user?.email || 'ERP User';
  const [saving, setSaving] = useState(false);

  // Ledger and Period state
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [selectedLedger, setSelectedLedger] = useState<Ledger | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loadingLedgers, setLoadingLedgers] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);

  // Currency list
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [allBusinessUnits, setAllBusinessUnits] = useState<{ label: string; value: string; legalEntityName: string; company: string; ledger: string }[]>([]);
  const [businessUnits, setBusinessUnits] = useState<{ label: string; value: string; legalEntityName: string; company: string; ledger: string }[]>([]);
  const [buCompanyMap, setBuCompanyMap] = useState<Record<string, string>>({});
  const [selectedBu, setSelectedBu] = useState('');
  const [derivedCompany, setDerivedCompany] = useState('');
  const [bmsRate, setBmsRate] = useState<{ rate: number; inverseRate: number; rateType: string; rateDate: string } | null>(null);
  const [bmsRateLoading, setBmsRateLoading] = useState(false);
  const [bmsRateApiModal, setBmsRateApiModal] = useState(false);
  const [lastBmsRateUrl, setLastBmsRateUrl] = useState('');
  const [distCombinations, setDistCombinations] = useState<DistCombination[]>([]);
  const [loadingDist, setLoadingDist] = useState(false);
  // Category list (from RR_GL_CATEGORIES via API)
  const [glCategories, setGLCategories] = useState<{ jeCategoryName: string; userJeCategoryName: string }[]>([]);
  const [deleteBatchModalVisible, setDeleteBatchModalVisible] = useState(false);
  const [savedBatchId, setSavedBatchId] = useState<number | null>(null); // JE_BATCH_ID after successful save
  const [deletingBatch, setDeletingBatch] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<Array<{
    id?: number;
    uid: string;
    name: string;
    fileType: string;
    fileSize: number;
    content?: string;
    rawFile?: File;
    status: 'done' | 'uploading' | 'error';
  }>>([]);
  const [attSaving, setAttSaving] = useState(false);
  const [attPreview, setAttPreview] = useState<{ url: string; name: string; type: string } | null>(null);
  const [attPreviewLoading, setAttPreviewLoading] = useState(false);

  // Collapsible states
  const [batchExpanded, setBatchExpanded] = useState(true);
  const [journalExpanded, setJournalExpanded] = useState(true);

  // Active tabs
  const [activeBatchTab, setActiveBatchTab] = useState('batch');
  const [activeJournalTab, setActiveJournalTab] = useState('journal');

  // Selected line keys
  const [selectedLineKeys, setSelectedLineKeys] = useState<React.Key[]>([]);

  // Account selector state
  const [accountSelectorVisible, setAccountSelectorVisible] = useState(false);
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
  const [accountSelectorInitialValue, setAccountSelectorInitialValue] = useState<string | undefined>(undefined);
  const [validatingAccount, setValidatingAccount] = useState<string | null>(null); // Line key being validated

  // Detached mode for journal lines (full page)
  const [isDetached, setIsDetached] = useState(false);

  // PDF Preview state
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  const [pdfDataUrl, setPdfDataUrl] = useState<string>('');
  const [pdfFileName, setPdfFileName] = useState<string>('');

  // Search filter for journal lines
  const [lineSearchText, setLineSearchText] = useState('');

  // Account balance inquiry modal
  const [acctBalModal, setAcctBalModal] = useState<{
    visible: boolean; loading: boolean;
    account: string; accountDesc: string; periodName: string;
    apiUrl: string; rawItems: any[];
    showApi: boolean;
    data: { opening: number; debit: number; credit: number; closing: number; currency: string } | null;
  }>({ visible: false, loading: false, account: '', accountDesc: '', periodName: '', apiUrl: '', rawItems: [], showApi: false, data: null });

  // JSON Preview modal state
  const [jsonPreviewVisible, setJsonPreviewVisible] = useState(false);
  const [jsonPayload, setJsonPayload] = useState<any>(null);
  const [showJsonPayload, setShowJsonPayload] = useState(false);
  const [postingJournal, setPostingJournal] = useState(false);
  const [saveResponse, setSaveResponse] = useState<any>(null);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [isPosted, setIsPosted] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false); // true after save; false = edit mode
  const [closeAfterSave, setCloseAfterSave] = useState(false);
  const [descEditKey, setDescEditKey] = useState<string | null>(null);
  const [descEditValue, setDescEditValue] = useState('');
  const [validationModalVisible, setValidationModalVisible] = useState(false);
  const [postConfirmVisible, setPostConfirmVisible] = useState(false);

  const SAVE_ENDPOINT = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/journals/create';

  const copyEndpoint = () => {
    navigator.clipboard.writeText(SAVE_ENDPOINT);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  // Initialize batch name with timestamp
  const [batchData, setBatchData] = useState<BatchData>(() => {
    const batchName = generateBatchName();
    return {
      batchName,
      description: '',
      balanceType: 'Actual',
      accountingPeriod: 'Mar-26',
    };
  });

  // Multiple journals state
  const [journals, setJournals] = useState<JournalEntry[]>([createNewJournal('1')]);
  const [currentJournalIndex, setCurrentJournalIndex] = useState(0);

  // Current journal data (derived from journals array)
  const currentJournal = journals[currentJournalIndex];
  const journalData = currentJournal.data;
  const lines = currentJournal.lines;

  // Update journal data for current journal
  const setJournalData = (newData: JournalData | ((prev: JournalData) => JournalData)) => {
    setJournals(prevJournals => {
      const updated = [...prevJournals];
      const data = typeof newData === 'function' ? newData(updated[currentJournalIndex].data) : newData;
      updated[currentJournalIndex] = { ...updated[currentJournalIndex], data };
      return updated;
    });
  };

  // Update lines for current journal
  const setLines = (newLines: JournalLine[] | ((prev: JournalLine[]) => JournalLine[])) => {
    setJournals(prevJournals => {
      const updated = [...prevJournals];
      const lines = typeof newLines === 'function' ? newLines(updated[currentJournalIndex].lines) : newLines;
      updated[currentJournalIndex] = { ...updated[currentJournalIndex], lines };
      return updated;
    });
  };

  // Sync batch description → journal description (always mirrors)

  // Fetch ledgers on component mount
  useEffect(() => {
    const fetchLedgers = async () => {
      setLoadingLedgers(true);
      try {
        const response = await fetch('https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/ledgers');
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          setLedgers(data.items);
          // Auto-select first ledger and store it
          const firstLedger = data.items[0];
          setSelectedLedger(firstLedger);
          // Update journal data with selected ledger
          setJournalData(prev => ({ ...prev, ledger: firstLedger.ledger_name }));
        }
      } catch (error) {
        console.error('Error fetching ledgers:', error);
        message.error('Failed to fetch ledgers');
      } finally {
        setLoadingLedgers(false);
      }
    };
    fetchLedgers();
  }, []);

  // Fetch currencies on mount
  useEffect(() => {
    const fetchCurrencies = async () => {
      try {
        const response = await fetch(`${APEX_DB_CONFIG.baseUrl}/currencies`);
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          setCurrencies(data.items);
        }
      } catch (error) {
        console.error('Error fetching currencies:', error);
      }
    };
    fetchCurrencies();
  }, []);

  // Fetch all Business Units once on mount
  useEffect(() => {
    fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const companyMap: Record<string, string> = {};
        const opts = ((data.items || []) as any[])
          .map((i: any) => {
            const buName  = i.business_unit_name || i.businessUnitName || '';
            const company = i.company || '';
            const le      = i.legal_entity_name  || i.legalEntityName  || '';
            const ledger  = i.ledger || '';
            if (buName) companyMap[buName] = company;
            return { label: buName, value: buName, legalEntityName: le, company, ledger };
          })
          .filter(o => o.value)
          .sort((a, b) => a.label.localeCompare(b.label));
        setBuCompanyMap(companyMap);
        setAllBusinessUnits(opts);
        setBusinessUnits(opts);
      })
      .catch(() => {});
  }, []);

  // Filter BUs whenever selected ledger or full BU list changes
  useEffect(() => {
    if (!selectedLedger) return;
    const filtered = allBusinessUnits.filter(
      bu => !bu.ledger || bu.ledger === selectedLedger.ledger_name
    );
    setBusinessUnits(filtered);
  }, [selectedLedger, allBusinessUnits]);

  // Load distribution combinations on mount (all active, no BU filter)
  useEffect(() => {
    setLoadingDist(true);
    searchCombinations({ status: 'ACTIVE' })
      .then(items => setDistCombinations(items))
      .catch(() => {})
      .finally(() => setLoadingDist(false));
  }, []);

  // Load attachments when savedBatchId is available
  useEffect(() => {
    if (!savedBatchId) return;
    fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${savedBatchId}/attachments`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const items = (data.items || []) as any[];
        setAttachments(items.map((a: any) => ({
          id: a.id,
          uid: String(a.id),
          name: a.fileName || a.file_name || 'attachment',
          fileType: a.fileType || a.file_type || 'application/octet-stream',
          fileSize: a.fileSize || a.file_size || 0,
          status: 'done' as const,
        })));
      })
      .catch(() => {});
  }, [savedBatchId]);

  const loadAttachments = () => {
    if (!savedBatchId) return;
    fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${savedBatchId}/attachments`, { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const items = (data.items || []) as any[];
        setAttachments(items.map((a: any) => ({
          id: a.id,
          uid: String(a.id),
          name: a.fileName || a.file_name || 'attachment',
          fileType: a.fileType || a.file_type || 'application/octet-stream',
          fileSize: a.fileSize || a.file_size || 0,
          status: 'done' as const,
        })));
      })
      .catch(() => {});
  };

  const handleAttachmentUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(',')[1];
      setAttachments(prev => [...prev, {
        uid: `new-${Date.now()}`,
        name: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        content: base64,
        rawFile: file,
        status: 'done',
      }]);
    };
    reader.readAsDataURL(file);
    return false; // prevent default upload
  };

  const handleSaveAttachments = async () => {
    if (!savedBatchId) return;
    const pending = attachments.filter(a => !a.id);
    if (!pending.length) { message.info('No new attachments to save.'); return; }
    setAttSaving(true);
    let saved = 0;
    const url = `${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${savedBatchId}/attachments`;
    for (const att of pending) {
      try {
        let content = att.content;
        if (!content && att.rawFile) {
          content = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
            r.onerror = reject;
            r.readAsDataURL(att.rawFile!);
          });
        }
        const payload = { fileName: att.name, fileType: att.fileType, fileSize: att.fileSize, content: (content || '').substring(0, 40) + '…[base64]', createdBy: currentUser };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ...payload, content }),
        });
        const respText = await res.text();
        if (res.ok) {
          saved++;
        } else {
          Modal.error({
            title: `Upload Failed — ${att.name}`,
            width: 640,
            content: (
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>POST URL:</strong>
                  <pre style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, margin: '4px 0', wordBreak: 'break-all', fontSize: 11 }}>{url}</pre>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <strong>Payload (content truncated):</strong>
                  <pre style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, margin: '4px 0', fontSize: 11, maxHeight: 120, overflow: 'auto' }}>{JSON.stringify(payload, null, 2)}</pre>
                </div>
                <div>
                  <strong>Server Response (HTTP {res.status}):</strong>
                  <pre style={{ background: '#fff2f0', padding: '4px 8px', borderRadius: 4, margin: '4px 0', fontSize: 11, maxHeight: 150, overflow: 'auto' }}>{respText}</pre>
                </div>
              </div>
            ),
          });
        }
      } catch (err: any) {
        Modal.error({
          title: `Network Error — ${att.name}`,
          width: 520,
          content: (
            <div style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 8 }}><strong>POST URL:</strong>
                <pre style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, margin: '4px 0', wordBreak: 'break-all', fontSize: 11 }}>{url}</pre>
              </div>
              <div><strong>Error:</strong> {err?.message || String(err)}</div>
            </div>
          ),
        });
      }
    }
    setAttSaving(false);
    if (saved > 0) { message.success(`${saved} attachment(s) saved.`); loadAttachments(); }
  };

  const handlePreviewAttachment = async (att: { id?: number; uid: string; name: string; fileType: string; content?: string }) => {
    if (att.content) {
      const blob = new Blob([Uint8Array.from(atob(att.content), c => c.charCodeAt(0))], { type: att.fileType });
      setAttPreview({ url: URL.createObjectURL(blob), name: att.name, type: att.fileType });
      return;
    }
    if (!att.id || !savedBatchId) return;
    setAttPreviewLoading(true);
    try {
      const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${savedBatchId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const content = data.content || data.CONTENT || '';
      const fileType = data.fileType || data.FILE_TYPE || att.fileType;
      const blob = new Blob([Uint8Array.from(atob(content), c => c.charCodeAt(0))], { type: fileType });
      setAttPreview({ url: URL.createObjectURL(blob), name: att.name, type: fileType });
    } catch { message.error('Failed to load preview.'); }
    finally { setAttPreviewLoading(false); }
  };

  const handleDownloadAttachment = async (att: { id?: number; uid: string; name: string; fileType: string; content?: string }) => {
    let content = att.content;
    let fileType = att.fileType;
    if (!content && att.id && savedBatchId) {
      try {
        const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${savedBatchId}/attachments/${att.id}`, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        content = data.content || data.CONTENT || '';
        fileType = data.fileType || data.FILE_TYPE || fileType;
      } catch { message.error('Failed to download.'); return; }
    }
    if (!content) return;
    const blob = new Blob([Uint8Array.from(atob(content), c => c.charCodeAt(0))], { type: fileType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = att.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleDeleteAttachment = (att: { id?: number; uid: string; name: string }) => {
    Modal.confirm({
      title: 'Delete Attachment',
      content: `Delete "${att.name}"?`,
      okText: 'Delete', okType: 'danger',
      onOk: async () => {
        if (att.id && savedBatchId) {
          try {
            await fetch(`${APEX_DB_CONFIG.baseUrl}/cash/externaltransactions/${savedBatchId}/attachments/${att.id}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
          } catch { message.error('Failed to delete attachment.'); return; }
        }
        setAttachments(prev => prev.filter(a => a.uid !== att.uid));
      },
    });
  };

  // Fetch GL Categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/categories`);
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          setGLCategories(data.items.map((c: any) => ({
            jeCategoryName:     c.jeCategoryName,
            userJeCategoryName: c.userJeCategoryName || c.jeCategoryName,
          })));
        }
      } catch (error) {
        console.error('Error fetching GL categories:', error);
      }
    };
    fetchCategories();
  }, []);

  // Fetch periods when ledger changes
  useEffect(() => {
    if (!selectedLedger) return;

    const fetchPeriods = async () => {
      setLoadingPeriods(true);
      try {
        const params = new URLSearchParams();
        params.append('P_APPLICATION_NAME', 'General Ledger');
        params.append('P_LEDGER_NAME', selectedLedger.ledger_name);
        const response = await fetch(
          `${APEX_DB_CONFIG.baseUrl}/periodsstatus/create?${params.toString()}`
        );
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          // Sort periods by year desc, then period_number desc to show most recent first
          const sortedPeriods = data.items.sort((a: Period, b: Period) => {
            if (b.period_year !== a.period_year) return b.period_year - a.period_year;
            return b.period_number - a.period_number;
          });
          setPeriods(sortedPeriods);
          // Auto-select current open period or first available
          // Only allow Open or Future Entry periods; auto-select the current Open one
          const currentPeriod = sortedPeriods.find((p: Period) => p.status === 'Open') || sortedPeriods.find((p: Period) => p.status === 'Future Entry') || sortedPeriods[0];
          if (currentPeriod) {
            setBatchData(prev => ({ ...prev, accountingPeriod: currentPeriod.period_name_id }));
          }
        }
      } catch (error) {
        console.error('Error fetching periods:', error);
        message.error('Failed to fetch periods');
      } finally {
        setLoadingPeriods(false);
      }
    };
    fetchPeriods();
  }, [selectedLedger]);

  // Handle ledger selection — filter BUs to those belonging to this ledger, reset BU
  const handleLedgerChange = (ledgerId: number) => {
    const ledger = ledgers.find(l => l.ledger_id === ledgerId);
    if (ledger) {
      setSelectedLedger(ledger);
      setJournalData(prev => ({ ...prev, ledger: ledger.ledger_name }));
      // Filter BUs by ledger name
      const filtered = allBusinessUnits.filter(
        bu => !bu.ledger || bu.ledger === ledger.ledger_name
      );
      setBusinessUnits(filtered);
      // Reset BU selection since ledger changed
      setSelectedBu('');
      setDerivedCompany('');
      setJournalData(prev => ({ ...prev, ledger: ledger.ledger_name, legalEntity: '', company: '' }));
    }
  };

  // Update accounting date when period changes
  useEffect(() => {
    // Try to get end date from fetched periods, fallback to hardcoded values
    const selectedPeriod = periods.find(p => p.period_name_id === batchData.accountingPeriod);
    let periodEndDate: string;
    if (selectedPeriod?.end_date) {
      const parsed = parseOracleDate(selectedPeriod.end_date);
      periodEndDate = parsed ? parsed.format('D-MMM-YYYY') : getPeriodEndDate(batchData.accountingPeriod);
    } else {
      periodEndDate = getPeriodEndDate(batchData.accountingPeriod);
    }
    setJournalData(prev => ({
      ...prev,
      accountingDate: dayjs().format('D-MMM-YYYY'),
      conversionDate: dayjs().format('D-MMM-YYYY'),
    }));
  }, [batchData.accountingPeriod, periods]);

  // Auto-fetch BMS rate when currency changes to a non-AED currency
  useEffect(() => {
    if (journalData.currency && journalData.currency !== 'AED') {
      fetchBmsRate(journalData.currency, journalData.conversionDate, true);
    } else if (journalData.currency === 'AED') {
      setBmsRate(null);
      setJournalData(prev => ({ ...prev, conversionRate: 1, inverseRate: 1, conversionRateType: 'Corporate' }));
    }
  }, [journalData.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculateAccountedAmounts = (enteredAmount: number | null): number | null => {
    if (enteredAmount === null) return null;
    return Math.round(enteredAmount * (journalData.conversionRate || 1) * 100) / 100;
  };

  // Filter lines based on search
  const filteredLines = lineSearchText
    ? lines.filter(line =>
        line.account.toLowerCase().includes(lineSearchText.toLowerCase()) ||
        line.accountDescription.toLowerCase().includes(lineSearchText.toLowerCase()) ||
        line.description.toLowerCase().includes(lineSearchText.toLowerCase())
      )
    : lines;

  // Add new journal
  const handleAddJournal = () => {
    const newId = String(journals.length + 1);
    const newJournal = createNewJournal(newId);
    setJournals([...journals, newJournal]);
    setCurrentJournalIndex(journals.length); // Navigate to the new journal
    message.success(`Journal ${journals.length + 1} created`);
  };

  // Delete current journal
  const handleDeleteJournal = () => {
    if (journals.length === 1) {
      message.warning('Cannot delete the only journal in the batch');
      return;
    }
    const newJournals = journals.filter((_, idx) => idx !== currentJournalIndex);
    setJournals(newJournals);
    // Adjust current index if needed
    if (currentJournalIndex >= newJournals.length) {
      setCurrentJournalIndex(newJournals.length - 1);
    }
    message.success('Journal deleted');
  };

  // Navigate to previous journal
  const handlePrevJournal = () => {
    if (currentJournalIndex > 0) {
      setCurrentJournalIndex(currentJournalIndex - 1);
      setSelectedLineKeys([]); // Reset selected lines
    }
  };

  // Navigate to next journal
  const handleNextJournal = () => {
    if (currentJournalIndex < journals.length - 1) {
      setCurrentJournalIndex(currentJournalIndex + 1);
      setSelectedLineKeys([]); // Reset selected lines
    }
  };

  // Reset to a fresh blank journal (after save/post) — stays on same page
  const handleResetForNewJournal = () => {
    const freshJournal = createNewJournal('1');
    setJournals([freshJournal]);
    setCurrentJournalIndex(0);
    setSavedBatchId(null);
    setBatchData({
      batchName: generateBatchName(),
      description: '',
      balanceType: 'Actual',
      accountingPeriod: batchData.accountingPeriod,
    });
  };

  // Delete entire batch — calls API if already saved, otherwise just resets the form
  const handleDeleteBatch = async () => {
    if (savedBatchId) {
      const deleteUrl = `${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${savedBatchId}`;
      setDeletingBatch(true);
      try {
        const res = await fetch(deleteUrl, { method: 'DELETE' });
        const text = await res.text();
        let data: any;
        try { data = JSON.parse(text); } catch { data = { status: 'ERROR', message: text.substring(0, 200) }; }
        if (res.ok && data?.status === 'SUCCESS') {
          message.success(`Batch ${batchData.batchName} deleted successfully`);
          setDeleteBatchModalVisible(false);
          handleResetForNewJournal();
        } else {
          message.error(`Delete failed: ${data?.message || data?.error || `HTTP ${res.status}`}`);
        }
      } catch (e: any) {
        message.error(`Delete failed: ${e.message}`);
      } finally {
        setDeletingBatch(false);
      }
    } else {
      // Batch not yet saved — just reset the form
      handleResetForNewJournal();
      setDeleteBatchModalVisible(false);
      message.success('Journal cleared');
    }
  };

  // Open account selector for a line
  const openAccountSelector = (lineKey: string, initialValue?: string) => {
    setEditingLineKey(lineKey);
    setAccountSelectorInitialValue(initialValue);
    setAccountSelectorVisible(true);
  };

  // Open account balance inquiry popup
  const openAccountBalance = useCallback(async (
    combination: string,
    accountDesc: string,
    segmentDetails: Record<string, SegmentDetail>,
  ) => {
    const ledgerName = journalData.ledger;
    const periodName = batchData.accountingPeriod;
    if (!ledgerName || !periodName) {
      message.warning('Ledger and period must be set before viewing balances');
      return;
    }

    // Extract just the natural account segment (name "Account", not "Sub-Account")
    const acctSeg = Object.values(segmentDetails).find(
      sd => /\baccount\b/i.test(sd.name) && !/sub/i.test(sd.name)
    );
    const accountParam = acctSeg?.value || combination.split('-')[3] || combination;

    // Optionally pass company to narrow results
    const compSeg = Object.values(segmentDetails).find(sd => /\bcompany\b/i.test(sd.name));
    const companyParam = compSeg?.value || '';

    const p = new URLSearchParams({ ledger_name: ledgerName, period_name: periodName, account: accountParam });
    if (companyParam) p.set('company', companyParam);

    const apiUrl = `${GL_ORDS_BASE}/rr-trialbalance/standard?${p}`;
    setAcctBalModal({ visible: true, loading: true, account: combination, accountDesc, periodName, apiUrl, rawItems: [], showApi: false, data: null });
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items: any[] = json.items || [];
      const opening = items.reduce((s: number, i: any) => s + (i.opening || 0), 0);
      const closing = items.reduce((s: number, i: any) => s + (i.closing || 0), 0);
      const debit   = items.reduce((s: number, i: any) => s + (i.debit   || 0), 0);
      const credit  = items.reduce((s: number, i: any) => s + (i.credit  || 0), 0);
      const currency = items[0]?.currency_code || 'AED';
      setAcctBalModal(prev => ({ ...prev, loading: false, rawItems: items, data: { opening, debit, credit, closing, currency } }));
    } catch (err: any) {
      message.error(`Failed to fetch account balances: ${err.message}`);
      setAcctBalModal(prev => ({ ...prev, loading: false }));
    }
  }, [journalData.ledger, batchData.accountingPeriod]);

  const fetchBmsRate = useCallback((currency: string, convDate: string, apply: boolean) => {
    if (!currency || currency === 'AED') {
      setBmsRate(null);
      return;
    }
    setBmsRateLoading(true);
    setBmsRate(null);
    const dateParam = convDate ? `&rate_date=${encodeURIComponent(dayjs(convDate, 'D-MMM-YYYY').format('YYYY-MM-DD'))}` : '';
    const bmsUrl = `${APEX_DB_CONFIG.baseUrl}/currencies/bmsrate?source_cur=${currency}&target_cur=AED${dateParam}`;
    setLastBmsRateUrl(bmsUrl);
    fetch(bmsUrl)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'ok') {
          setBmsRate({ rate: data.rate, inverseRate: data.inverseRate, rateType: data.rateType || 'Corporate', rateDate: data.rateDate });
          if (apply) {
            // When the rate type is 'User', the rate is manual — never override it.
            setJournalData(prev => prev.conversionRateType === 'User'
              ? prev
              : { ...prev, conversionRate: data.rate, inverseRate: data.inverseRate, conversionRateType: data.rateType || 'Corporate' });
          }
        }
      })
      .catch(() => {})
      .finally(() => setBmsRateLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate account code on blur
  const handleAccountBlur = async (lineKey: string, accountCode: string) => {
    // Skip validation if empty or already validating
    if (!accountCode || accountCode.trim() === '' || validatingAccount) {
      return;
    }

    // Skip if no dashes (not a combination code)
    if (!accountCode.includes('-')) {
      return;
    }

    setValidatingAccount(lineKey);
    console.log('Validating account code:', accountCode);

    try {
      const result = await validateAccountCode(accountCode);
      console.log('Validation result:', result);

      if (!result.segmentsLoaded) {
        message.info('Could not load segment data for validation. Please verify the account code.');
        return;
      }

      if (!result.isValid) {
        // Show message about invalid segments
        message.warning(`Invalid segment value(s): ${result.invalidSegments.join(', ')}. Please correct using the account selector.`);

        // Update line with validated code (valid parts kept, invalid parts blanked)
        setLines(prevLines => prevLines.map(line =>
          line.key === lineKey
            ? { ...line, account: result.validatedCode, accountDescription: '', segmentDetails: {} }
            : line
        ));

        // Open account selector with the validated code as initial value
        openAccountSelector(lineKey, result.validatedCode);
      } else {
        // All segments are valid - populate the line with segment details
        // Find the Account segment (contains "ACCOUNT" in the key or name)
        const accountSegment = Object.entries(result.segmentDetails).find(([key, detail]) =>
          key.toUpperCase().includes('ACCOUNT') ||
          (detail.name && detail.name.toUpperCase().includes('ACCOUNT'))
        );

        // Build description: "Account Desc - Sub-Account Desc" (or just account if no sub-account)
        const subAccountSegment = Object.entries(result.segmentDetails).find(([key, detail]) =>
          /sub.?account/i.test(key) || /sub.?account/i.test(detail.name || '')
        );
        const acctPart = accountSegment ? accountSegment[1].description : '';
        const subPart  = subAccountSegment ? subAccountSegment[1].description : '';
        const accountDescription = [acctPart, subPart].filter(Boolean).join(' - ');

        // Update the line with segment details and description
        setLines(prevLines => prevLines.map(line =>
          line.key === lineKey
            ? { ...line, accountDescription, segmentDetails: result.segmentDetails }
            : line
        ));

        message.success('Account code validated successfully');
      }
    } catch (error) {
      console.error('Error validating account code:', error);
      message.error('Failed to validate account code');
    } finally {
      setValidatingAccount(null);
    }
  };

  // Handle account selection
  const handleAccountSelect = (accountCode: string, segments: Record<string, { value: string; description: string; name?: string }>) => {
    if (editingLineKey) {
      // Find the Account segment (contains "ACCOUNT" in the key or name)
      const accountSegment = Object.entries(segments).find(([key, detail]) =>
        key.toUpperCase().includes('ACCOUNT') ||
        (detail.name && detail.name.toUpperCase().includes('ACCOUNT'))
      );

      // Build description: "Account Desc - Sub-Account Desc" (or just account if no sub-account)
      const subAccountSegment = Object.entries(segments).find(([key, detail]) =>
        /sub.?account/i.test(key) || /sub.?account/i.test(detail.name || '')
      );
      const acctPart = accountSegment ? accountSegment[1].description : '';
      const subPart  = subAccountSegment ? subAccountSegment[1].description : '';
      const accountDescription = [acctPart, subPart].filter(Boolean).join(' - ');

      // Update the line with account code, description, and segment details
      setLines(prevLines => prevLines.map(line =>
        line.key === editingLineKey
          ? { ...line, account: accountCode, accountDescription, segmentDetails: segments as Record<string, SegmentDetail> }
          : line
      ));
    }
    setAccountSelectorVisible(false);
    setEditingLineKey(null);
  };

  // Calculate totals
  const lineTotals = lines.reduce(
    (acc, line) => ({
      enteredDr: acc.enteredDr + (line.enteredDr || 0),
      enteredCr: acc.enteredCr + (line.enteredCr || 0),
      accountedDr: acc.accountedDr + (line.accountedDr || 0),
      accountedCr: acc.accountedCr + (line.accountedCr || 0),
    }),
    { enteredDr: 0, enteredCr: 0, accountedDr: 0, accountedCr: 0 }
  );

  // Add new line
  const handleAddLine = () => {
    const newLineNum = lines.length + 1;
    setLines([
      ...lines,
      {
        key: String(newLineNum),
        lineNum: newLineNum,
        account: '',
        accountDescription: '',
        segmentDetails: {},
        currency: journalData.currency,
        enteredDr: null,
        enteredCr: null,
        conversionDate: journalData.conversionDate,
        accountedDr: null,
        accountedCr: null,
        description: '',
      },
    ]);
  };

  // Delete selected lines
  const handleDeleteLines = () => {
    const newLines = lines.filter(line => !selectedLineKeys.includes(line.key));
    // Renumber lines
    const renumberedLines = newLines.map((line, idx) => ({
      ...line,
      lineNum: idx + 1,
      key: String(idx + 1),
    }));
    setLines(renumberedLines);
    setSelectedLineKeys([]);
  };

  // Update line with auto-calculation of accounted amounts
  const updateLine = (key: string, field: keyof JournalLine, value: any) => {
    setLines(prevLines => prevLines.map(line => {
      if (line.key !== key) return line;

      const updatedLine = { ...line, [field]: value };

      // Auto-calculate accounted amounts when entered amounts change
      if (field === 'enteredDr' || field === 'enteredCr') {
        const rate = journalData.conversionRate || 1;
        if (field === 'enteredDr') {
          updatedLine.accountedDr = value !== null ? Math.round(value * rate * 100) / 100 : null;
        } else {
          updatedLine.accountedCr = value !== null ? Math.round(value * rate * 100) / 100 : null;
        }
      }

      return updatedLine;
    }));
  };

  // Recalculate all accounted amounts when conversion rate changes; sync line currency
  useEffect(() => {
    const rate = journalData.conversionRate || 1;
    setLines(prevLines => prevLines.map(line => ({
      ...line,
      currency: journalData.currency,
      accountedDr: line.enteredDr !== null ? Math.round(line.enteredDr * rate * 100) / 100 : null,
      accountedCr: line.enteredCr !== null ? Math.round(line.enteredCr * rate * 100) / 100 : null,
      conversionDate: journalData.conversionDate,
    })));
  }, [journalData.conversionRate, journalData.conversionDate, journalData.currency]);

  // Save handler
  // Check if debit and credit are balanced
  const isBalanced = lineTotals.enteredDr === lineTotals.enteredCr;

  // Generate PDF Report
  const handlePrintPDF = () => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const W = doc.internal.pageSize.getWidth();   // 297
    const H = doc.internal.pageSize.getHeight();  // 210

    // ── Palette ──────────────────────────────────────────────────────────────
    const RED:   [number,number,number] = [199, 70, 52];
    const DARK:  [number,number,number] = [26, 26, 26];
    const GREY:  [number,number,number] = [107, 107, 107];
    const LGREY: [number,number,number] = [247, 247, 247];
    const WHITE: [number,number,number] = [255, 255, 255];
    const NAVY:  [number,number,number] = [30, 50, 100];

    const M = 14; // margin
    const col2 = M + 60;  // second-column start for header fields
    const mid  = W / 2;
    const rightMid = mid + 10;

    // ── PAGE HEADER BAR ──────────────────────────────────────────────────────
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 22, 'F');

    // Document title centred
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...WHITE);
    doc.text('JOURNAL VOUCHER', mid, 10, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 220);
    doc.text(`Batch: ${batchData.batchName}`, mid, 16, { align: 'center' });
    doc.text(`Generated: ${dayjs().format('DD-MMM-YYYY HH:mm')}`, mid, 20, { align: 'center' });

    // Status badge
    const statusLabel = savedBatchId ? 'POSTED' : 'DRAFT';
    const statusColor: [number,number,number] = savedBatchId ? [29, 123, 77] : [212, 168, 0];
    doc.setFillColor(...statusColor);
    doc.roundedRect(W - M - 28, 5, 28, 12, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...WHITE);
    doc.text(statusLabel, W - M - 14, 12.5, { align: 'center' });

    let y = 28;

    // ── BATCH + JOURNAL INFO — two-column grid ────────────────────────────────
    // Left panel
    doc.setFillColor(...LGREY);
    doc.rect(M, y, (W - 2 * M) / 2 - 3, 38, 'F');
    doc.setDrawColor(...RED);
    doc.setLineWidth(0.6);
    doc.line(M, y, M, y + 38);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...RED);
    doc.text('BATCH INFORMATION', M + 3, y + 5);
    doc.setTextColor(...DARK);

    const leftFields: [string, string][] = [
      ['Batch Name',       batchData.batchName || '-'],
      ['Accounting Period', batchData.accountingPeriod || '-'],
      ['Balance Type',     batchData.balanceType || '-'],
      ['Batch Description', batchData.description || '-'],
    ];
    leftFields.forEach(([lbl, val], i) => {
      const fy = y + 11 + i * 7;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...GREY);
      doc.text(lbl.toUpperCase(), M + 3, fy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text(val, M + 3, fy + 4);
    });

    // Right panel
    const rX = mid + 3;
    doc.setFillColor(...LGREY);
    doc.rect(rX, y, (W - 2 * M) / 2 - 3, 38, 'F');
    doc.setDrawColor(...RED);
    doc.line(rX, y, rX, y + 38);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...RED);
    doc.text('JOURNAL INFORMATION', rX + 3, y + 5);
    doc.setTextColor(...DARK);

    const rightFields: [string, string][] = [
      ['Journal Name',    journalData.journalName || '-'],
      ['Ledger',          journalData.ledger || '-'],
      ['Legal Entity',    journalData.legalEntity || '-'],
      ['Category',        journalData.category || '-'],
    ];
    rightFields.forEach(([lbl, val], i) => {
      const fy = y + 11 + i * 7;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...GREY);
      doc.text(lbl.toUpperCase(), rX + 3, fy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text(val, rX + 3, fy + 4);
    });

    y += 41;

    // Second info row — currency / dates / company / rates (4 columns on row 2)
    // Row 1: 3 columns
    const infoRow1: [string, string][] = [
      ['Currency',        journalData.currency],
      ['Accounting Date', journalData.accountingDate],
      ['Company Code',    derivedCompany || '-'],
    ];
    const colW3 = (W - 2 * M) / 3;
    infoRow1.forEach(([lbl, val], ci) => {
      const cx = M + ci * colW3;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY);
      doc.text(lbl.toUpperCase(), cx, y + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...DARK);
      doc.text(val, cx, y + 8);
    });
    y += 13;

    // Row 2: 4 columns (rate type, conv rate, inv rate, conv date)
    const infoRow2: [string, string][] = [
      ['Conv. Rate Type', journalData.conversionRateType || '-'],
      ['Conv. Rate',      String(journalData.conversionRate)],
      ['Inv. Rate',       String(journalData.inverseRate)],
      ['Conv. Date',      journalData.conversionDate || '-'],
    ];
    const colW4 = (W - 2 * M) / 4;
    infoRow2.forEach(([lbl, val], ci) => {
      const cx = M + ci * colW4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY);
      doc.text(lbl.toUpperCase(), cx, y + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...DARK);
      doc.text(val, cx, y + 8);
    });
    y += 13;

    // Divider
    doc.setDrawColor(...RED);
    doc.setLineWidth(0.4);
    doc.line(M, y, W - M, y);
    y += 4;

    // ── JOURNAL LINES TABLE ──────────────────────────────────────────────────
    const tableData = lines.map(line => [
      String(line.lineNum),
      line.account || '-',
      line.accountDescription || '-',
      line.currency,
      line.enteredDr !== null ? formatNumber(line.enteredDr) : '',
      line.enteredCr !== null ? formatNumber(line.enteredCr) : '',
      line.accountedDr !== null ? formatNumber(line.accountedDr) : '',
      line.accountedCr !== null ? formatNumber(line.accountedCr) : '',
      line.description || '',
    ]);

    tableData.push([
      '', 'TOTAL', '', '',
      formatNumber(lineTotals.enteredDr),
      formatNumber(lineTotals.enteredCr),
      formatNumber(lineTotals.accountedDr),
      formatNumber(lineTotals.accountedCr),
      isBalanced ? '✓ Balanced' : '✗ UNBALANCED',
    ]);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Account Code', 'Account Description', 'Cur',
               `Entered Dr (${journalData.currency})`, `Entered Cr (${journalData.currency})`,
               `Acctd Dr (${selectedLedger?.currency_code || 'AED'})`,
               `Acctd Cr (${selectedLedger?.currency_code || 'AED'})`,
               'Description']],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: NAVY,
        textColor: WHITE,
        fontSize: 7.5,
        fontStyle: 'bold',
        halign: 'center',
        cellPadding: 2.5,
      },
      bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2 },
      alternateRowStyles: { fillColor: [240, 243, 250] },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 42, font: 'courier' },
        2: { cellWidth: 42 },
        3: { cellWidth: 11, halign: 'center' },
        4: { cellWidth: 26, halign: 'right' },
        5: { cellWidth: 26, halign: 'right' },
        6: { cellWidth: 26, halign: 'right' },
        7: { cellWidth: 26, halign: 'right' },
        8: { cellWidth: 'auto' },
      },
      didParseCell: (data) => {
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize = 8.5;
          data.cell.styles.fillColor = [230, 235, 245];
          if (data.column.index === 8) {
            data.cell.styles.textColor = isBalanced ? [29, 123, 77] : RED;
          }
        }
      },
      didDrawPage: (_data) => {
        // Repeat header bar on each page
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, W, 6, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...WHITE);
        doc.text(`Journal Voucher — ${batchData.batchName}`, mid, 4.5, { align: 'center' });
        // Page number at bottom
        const pg = (doc as any).internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(7);
        doc.setTextColor(...GREY);
        doc.text(`Page ${pg}`, W - M, H - 4, { align: 'right' });
      },
      margin: { left: M, right: M, top: 8 },
    });

    const tableEndY = (doc as any).lastAutoTable.finalY;

    // ── APPROVAL FOOTER ───────────────────────────────────────────────────────
    // Need at least 40mm for the footer — add new page if too close to bottom
    let fy = tableEndY + 8;
    if (fy + 40 > H - 8) {
      doc.addPage();
      fy = 20;
    }

    // Horizontal rule above footer
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.4);
    doc.line(M, fy, W - M, fy);
    fy += 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...NAVY);
    doc.text('APPROVAL & AUTHORISATION', M, fy);
    fy += 8;

    const sigBoxW = (W - 2 * M - 9) / 4;
    const sigLabels = ['Prepared By', 'Checked By', 'Approved By', 'Posted By'];
    const sigValues = [currentUser, '', '', ''];

    sigLabels.forEach((lbl, i) => {
      const sx = M + i * (sigBoxW + 3);

      // Box
      doc.setDrawColor(...GREY);
      doc.setLineWidth(0.3);
      doc.setFillColor(252, 252, 255);
      doc.roundedRect(sx, fy, sigBoxW, 28, 1.5, 1.5, 'FD');

      // Label band
      doc.setFillColor(...NAVY);
      doc.roundedRect(sx, fy, sigBoxW, 7, 1.5, 1.5, 'F');
      doc.rect(sx, fy + 4, sigBoxW, 3, 'F'); // square bottom corners
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...WHITE);
      doc.text(lbl.toUpperCase(), sx + sigBoxW / 2, fy + 5, { align: 'center' });

      // Signature area
      doc.setFontSize(8.5);
      doc.setTextColor(...DARK);
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      doc.text(sigValues[i] || '', sx + sigBoxW / 2, fy + 15, { align: 'center' });

      // Signature line
      doc.setDrawColor(...GREY);
      doc.setLineWidth(0.2);
      doc.line(sx + 4, fy + 22, sx + sigBoxW - 4, fy + 22);

      // Date label
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...GREY);
      doc.text('Date: _______________', sx + sigBoxW / 2, fy + 26.5, { align: 'center' });
    });

    fy += 32;

    // Document metadata line
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(
      `Batch ID: ${savedBatchId || 'Not saved'}   |   Ledger: ${journalData.ledger}   |   Period: ${batchData.accountingPeriod}   |   Lines: ${lines.length}   |   Printed: ${dayjs().format('DD-MMM-YYYY HH:mm')}`,
      mid, fy, { align: 'center' }
    );

    // ── OUTPUT ────────────────────────────────────────────────────────────────
    const fileName = `JournalVoucher_${batchData.batchName}_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`;
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    setPdfDataUrl(blobUrl);
    setPdfFileName(fileName);
    setPdfPreviewVisible(true);
  };

  // Download PDF from preview
  const handleDownloadPDF = () => {
    if (pdfDataUrl) {
      const link = document.createElement('a');
      link.href = pdfDataUrl;
      link.download = pdfFileName;
      link.click();
      message.success(`PDF downloaded: ${pdfFileName}`);
    }
  };

  // Close PDF preview and cleanup
  const handleClosePdfPreview = () => {
    if (pdfDataUrl) {
      URL.revokeObjectURL(pdfDataUrl); // Clean up blob URL
    }
    setPdfPreviewVisible(false);
    setPdfDataUrl('');
    setPdfFileName('');
  };

  // Validate mandatory fields
  const validateMandatoryFields = (): { valid: boolean; message: string } => {
    if (!batchData.batchName) {
      return { valid: false, message: 'Please enter a Journal Batch name' };
    }
    if (!journalData.ledger) {
      return { valid: false, message: 'Please select a Ledger' };
    }
    if (!journalData.legalEntity) {
      return { valid: false, message: 'Please select a Legal Entity' };
    }
    if (!journalData.accountingDate) {
      return { valid: false, message: 'Please enter an Accounting Date' };
    }
    if (!journalData.category) {
      return { valid: false, message: 'Please select a Category' };
    }
    if (lines.length === 0) {
      return { valid: false, message: 'Journal must have at least one line. Please add journal lines before saving.' };
    }
    const linesWithNoAccount = lines.filter(l => !l.account || l.account.trim() === '');
    if (linesWithNoAccount.length > 0) {
      return { valid: false, message: `${linesWithNoAccount.length} line(s) have no account combination. Select an account for every line before saving.` };
    }
    const linesWithNoAmount = lines.filter(l => !(l.enteredDr) && !(l.enteredCr));
    if (linesWithNoAmount.length > 0) {
      return { valid: false, message: `${linesWithNoAmount.length} line(s) have no debit or credit amount. Enter amounts on all lines before saving.` };
    }
    const linesWithNoDesc = lines.filter(l => !l.description || l.description.trim() === '');
    if (linesWithNoDesc.length > 0) {
      return { valid: false, message: `${linesWithNoDesc.length} line(s) have no description. Description is required on all lines.` };
    }
    const diff = Math.abs(lineTotals.enteredDr - lineTotals.enteredCr);
    if (diff > 0.001) {
      return { valid: false, message: `Journal is not balanced: Debit ${formatNumber(lineTotals.enteredDr)} ≠ Credit ${formatNumber(lineTotals.enteredCr)} (difference: ${formatNumber(diff)}).` };
    }
    return { valid: true, message: '' };
  };

  // Build JSON payload for API
  const buildJsonPayload = () => {
    // Format date from D-MMM-YYYY to YYYY-MM-DD
    const formatDateForApi = (dateStr: string): string => {
      if (!dateStr) return '';
      const parsed = dayjs(dateStr, 'D-MMM-YYYY');
      return parsed.isValid() ? parsed.format('YYYY-MM-DD') : dateStr;
    };

    const payload: any = {
      batch: {
        ...(savedBatchId ? { batchId: savedBatchId } : {}),
        batchName: batchData.batchName,
        batchDescription: batchData.description || '',
        ledgerName: selectedLedger?.ledger_name || journalData.ledger,
        ledgerId: selectedLedger?.ledger_id || 0,
        status: 'Unposted',
        accountingPeriod: batchData.accountingPeriod,
        controlTotal: journalData.controlTotal || lineTotals.enteredDr,
        runningTotalDr: lineTotals.enteredDr,
        runningTotalCr: lineTotals.enteredCr,
        batchSource: 'Manual',
        createdBy: currentUser,
        syncStatus: null,
        syncDate: null,
      },
      header: {
        ledgerId: selectedLedger?.ledger_id || 0,
        ledgerName: selectedLedger?.ledger_name || journalData.ledger,
        legalEntityName: journalData.legalEntity || '',
        jeCategory: journalData.category || 'Adjustment',
        jeSource: 'Manual',
        periodName: batchData.accountingPeriod,
        journalName: journalData.journalName,
        description: journalData.description || '',
        currencyCode: journalData.currency,
        currencyConversionType: journalData.conversionRateType,
        currencyConversionDate: formatDateForApi(journalData.conversionDate),
        currencyConversionRate: journalData.conversionRate,
        defaultEffectiveDate: formatDateForApi(journalData.accountingDate),
        status: 'NEW',
        runningTotalDr: lineTotals.enteredDr,
        runningTotalCr: lineTotals.enteredCr,
        createdBy: currentUser,
        syncStatus: null,
        syncDate: null,
      },
      lines: lines.map(line => ({
        enteredDr: line.enteredDr,
        enteredCr: line.enteredCr,
        accountedDr: line.accountedDr,
        accountedCr: line.accountedCr,
        statAmount: null,
        description: line.description || '',
        currencyCode: journalData.currency,
        currencyConversionDate: formatDateForApi(line.conversionDate),
        currencyConversionRate: journalData.conversionRate,
        userCurrencyConversionType: journalData.conversionRateType,
        accountCombination: line.account,
        chartOfAccountsName: selectedLedger?.description || 'Chart of Accounts',
        reference1: null,
        reference2: null,
        reference3: null,
        reference4: null,
        reference5: null,
        createdBy: currentUser,
      })),
    };

    return payload;
  };

  // Handle Save - show JSON preview
  const handleSave = async (andClose = false) => {
    setCloseAfterSave(andClose);
    const validation = validateMandatoryFields();
    if (!validation.valid) {
      message.error(validation.message);
      return;
    }
    const payload = buildJsonPayload();
    setJsonPayload(payload);
    setShowJsonPayload(false);
    setJsonPreviewVisible(true);
  };

  // Track whether the last save was successful (used by Close button to trigger view mode)
  const [lastSaveSucceeded, setLastSaveSucceeded] = useState(false);

  // Handle confirm save — always POST; server differentiates create vs update via batchId in payload
  const handleConfirmSave = async () => {
    if (!jsonPayload) return;

    const isUpdate = !!savedBatchId;
    // New: POST to /journals/create; Update: PUT to /journals/update/:batchId
    const method = isUpdate ? 'PUT' : 'POST';
    const url = isUpdate
      ? `${APEX_DB_CONFIG.baseUrl}/journals/update/${savedBatchId}`
      : SAVE_ENDPOINT;

    setPostingJournal(true);
    setLastSaveSucceeded(false);
    setSaveResponse(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonPayload),
      });

      const responseText = await response.text();
      let result: any;
      try { result = JSON.parse(responseText); } catch { result = { raw: responseText }; }

      setSaveResponse({ ...result, _method: method, _url: url, _status: response.status, _ok: response.ok });

      if (!response.ok) {
        message.error(`${isUpdate ? 'Update' : 'Save'} failed: HTTP ${response.status}`);
        return;
      }

      const batchId = result?.batchId || result?.jeBatchId || result?.je_batch_id || result?.id || savedBatchId;
      if (batchId) {
        setSavedBatchId(batchId);
        // Use the canonical name returned by the server; fallback to "Manual - <id>"
        const canonicalName: string = result?.batchName || `Manual - ${batchId}`;
        setBatchData(prev => ({ ...prev, batchName: canonicalName }));
        setJournalData(prev => ({ ...prev, journalName: canonicalName }));
      }
      setLastSaveSucceeded(true);
      message.success(isUpdate ? 'Journal updated successfully!' : 'Journal saved successfully!');

      if (closeAfterSave) {
        setJsonPreviewVisible(false);
        setJsonPayload(null);
        setSaveResponse(null);
        setLastSaveSucceeded(false);
        setCloseAfterSave(false);
        if (embeddedMode && onSaved) onSaved();
        else navigate(-1);
      }
    } catch (error: any) {
      console.error('Error saving journal:', error);
      setSaveResponse({ error: true, message: error.message || 'Failed to save journal', _method: method, _url: url });
      message.error('Failed to save journal. Please try again.');
    } finally {
      setPostingJournal(false);
    }
  };

  // Close JSON modal — if save succeeded, switch to view mode
  const handleCloseJsonModal = () => {
    if (lastSaveSucceeded) {
      setIsViewMode(true);
    }
    setJsonPreviewVisible(false);
    setJsonPayload(null);
    setSaveResponse(null);
    setLastSaveSucceeded(false);
  };

  // Pre-post validation — comprehensive checks before posting
  // Returns an array of validation checks — each with label, passed flag, and detail
  const getPostingChecks = () => {
    const selectedPeriod = periods.find(p => p.period_name_id === batchData.accountingPeriod);
    const periodOpen = selectedPeriod?.status === 'Open' || selectedPeriod?.status === 'Future Entry';
    const missingDesc  = lines.filter(l => !l.description || !l.description.trim());
    const missingAcct  = lines.filter(l => !l.account || !l.account.trim());
    const missingAmt   = lines.filter(l => !(l.enteredDr) && !(l.enteredCr));
    const companyCodes = lines.map(l => (l.account || '').split('-')[0]).filter(Boolean);
    const uniqueCompanies = [...new Set(companyCodes)];

    return [
      {
        label: 'Journal is saved',
        passed: !!savedBatchId,
        detail: savedBatchId ? `Batch #${savedBatchId}` : 'Save the journal before posting',
      },
      {
        label: 'Accounting period selected',
        passed: !!batchData.accountingPeriod,
        detail: batchData.accountingPeriod || 'No period selected',
      },
      {
        label: 'Period is Open',
        passed: !!selectedPeriod && periodOpen,
        detail: selectedPeriod
          ? (periodOpen ? `${batchData.accountingPeriod} — ${selectedPeriod.status}` : `${batchData.accountingPeriod} is ${selectedPeriod.status} — must be Open`)
          : 'Period not found',
      },
      {
        label: 'Accounting date set',
        passed: !!journalData.accountingDate,
        detail: journalData.accountingDate || 'No accounting date entered',
      },
      {
        label: 'Category selected',
        passed: !!journalData.category,
        detail: journalData.category || 'No category selected',
      },
      {
        label: 'Currency selected',
        passed: !!journalData.currency,
        detail: journalData.currency || 'No currency selected',
      },
      {
        label: 'At least one journal line',
        passed: lines.length > 0,
        detail: lines.length > 0 ? `${lines.length} line(s)` : 'Add at least one line',
      },
      {
        label: 'All lines have an account',
        passed: missingAcct.length === 0,
        detail: missingAcct.length === 0 ? 'All lines have accounts' : `${missingAcct.length} line(s) missing account`,
      },
      {
        label: 'All lines have a description',
        passed: missingDesc.length === 0,
        detail: missingDesc.length === 0 ? 'All lines have descriptions' : `${missingDesc.length} line(s) missing description`,
      },
      {
        label: 'All lines have an amount',
        passed: missingAmt.length === 0,
        detail: missingAmt.length === 0 ? 'All lines have amounts' : `${missingAmt.length} line(s) missing debit or credit`,
      },
      {
        label: 'Journal is balanced (Dr = Cr)',
        passed: isBalanced,
        detail: isBalanced
          ? `Dr ${formatNumber(lineTotals.enteredDr)} = Cr ${formatNumber(lineTotals.enteredCr)}`
          : `Dr ${formatNumber(lineTotals.enteredDr)} ≠ Cr ${formatNumber(lineTotals.enteredCr)} (diff: ${formatNumber(Math.abs(lineTotals.enteredDr - lineTotals.enteredCr))})`,
      },
      {
        label: 'All lines share the same company segment',
        passed: lines.length === 0 || uniqueCompanies.length <= 1,
        detail: uniqueCompanies.length <= 1
          ? (uniqueCompanies[0] ? `Company: ${uniqueCompanies[0]}` : 'No accounts yet')
          : `Multiple companies: ${uniqueCompanies.join(', ')}`,
      },
    ];
  };

  // Confirm post — two explicit steps:
  //   Step 1: PUT with status=Unposted  → flush any unsaved form edits to DB
  //   Step 2: PUT with status=Posted    → mark the now-current record as posted
  const executePost = async () => {
    setPostConfirmVisible(false);
    setSaving(true);
    try {
      const url = `${APEX_DB_CONFIG.baseUrl}/journals/update/${savedBatchId}`;
      const basePayload = buildJsonPayload();

      // ── Step 1: save all current form data (Unposted) ───────────────────
      const savePayload = { ...basePayload, batch: { ...basePayload.batch, status: 'Unposted' } };
      const saveRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload),
      });
      if (!saveRes.ok) {
        const t = await saveRes.text();
        throw new Error(`Save step failed — HTTP ${saveRes.status}: ${t.substring(0, 200)}`);
      }

      // ── Step 2: update status to Posted ─────────────────────────────────
      const postPayload = { ...basePayload, batch: { ...basePayload.batch, status: 'Posted' } };
      const postRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postPayload),
      });
      if (!postRes.ok) {
        const t = await postRes.text();
        throw new Error(`Post step failed — HTTP ${postRes.status}: ${t.substring(0, 200)}`);
      }

      setIsPosted(true);
      setIsViewMode(true);
      message.success('Journal saved and posted successfully. The journal is now locked.');
      if (embeddedMode && onSaved) onSaved();
    } catch (error: any) {
      message.error(`Failed to post journal: ${error.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  // Handle Post button click — show validation checklist first
  const handlePost = () => {
    setValidationModalVisible(true);
  };

  // Cancel handler
  const handleCancel = () => {
    if (embeddedMode && onSaved) { onSaved(); } else { navigate(-1); }
  };

  // Batch Actions menu
  const batchActionsMenu: MenuProps['items'] = [
    { key: 'post', label: 'Post' },
    { key: 'reverse', label: 'Reverse' },
    { key: 'delete', label: 'Delete' },
  ];

  // Journal Actions menu
  const journalActionsMenu: MenuProps['items'] = [
    { key: 'copy', label: 'Copy' },
    { key: 'reverse', label: 'Reverse' },
    { key: 'delete', label: 'Delete' },
  ];

  // Save dropdown menu
  const saveMenu: MenuProps['items'] = [
    { key: 'save', label: 'Save' },
    { key: 'saveClose', label: 'Save and Close' },
  ];

  // Complete dropdown menu
  const completeMenu: MenuProps['items'] = [
    { key: 'complete', label: 'Complete' },
    { key: 'completeClose', label: 'Complete and Close' },
  ];

  // Post dropdown menu
  const postMenu: MenuProps['items'] = [
    { key: 'post', label: 'Post' },
    { key: 'postClose', label: 'Post and Close' },
  ];

  // Lines Actions menu
  const linesActionsMenu: MenuProps['items'] = [
    { key: 'add', label: 'Add Row', onClick: handleAddLine },
    { key: 'delete', label: 'Delete Selected', disabled: selectedLineKeys.length === 0 },
    { key: 'duplicate', label: 'Duplicate' },
  ];

  // Lines View menu
  const linesViewMenu: MenuProps['items'] = [
    { key: 'columns', label: 'Columns' },
    { key: 'sort', label: 'Sort' },
    { key: 'filter', label: 'Filter' },
  ];

  // Lines Format menu
  const linesFormatMenu: MenuProps['items'] = [
    { key: 'resize', label: 'Resize Columns' },
    { key: 'wrap', label: 'Wrap Text' },
  ];

  // Resizable column widths
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    lineNum: 60, distribution: 220, account: 340, currency: 80,
    enteredDr: 110, enteredCr: 110,
    conversionDate: 110,
    accountedDr: 110, accountedCr: 110,
    description: 200,
  });
  const handleColResize = useCallback((key: string) => (_: React.SyntheticEvent, { size }: { size: { width: number } }) => {
    setColWidths(prev => ({ ...prev, [key]: size.width }));
  }, []);

  // Line columns
  const lineColumns: ColumnsType<JournalLine> = [
    {
      title: 'Line',
      dataIndex: 'lineNum',
      key: 'lineNum',
      width: colWidths.lineNum,
      fixed: 'left',
      onHeaderCell: () => ({ width: colWidths.lineNum, onResize: handleColResize('lineNum') } as any),
      render: (num) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ cursor: 'pointer', color: REDWOOD.neutral600 }}>&#9654;</span>
          {num}
        </div>
      ),
    },
    {
      title: 'Distribution',
      dataIndex: 'distributionId',
      key: 'distribution',
      width: colWidths.distribution,
      onHeaderCell: () => ({ width: colWidths.distribution, onResize: handleColResize('distribution') } as any),
      render: (_: unknown, record: JournalLine) => (
        <Select
          value={record.distributionId ?? undefined}
          onChange={async (distId: number) => {
            const dist = distCombinations.find(d => d.combinationId === distId);
            if (!dist) return;
            // glAccountDesc holds the actual segment combination code (e.g. "BCL-00-00-5231101-...")
            // combinationName is the human-readable name used as description
            const rawCode = dist.glAccountDesc || dist.combinationName || '';
            const parts = rawCode.split('-');
            if (derivedCompany && parts.length > 0) parts[0] = derivedCompany;
            const combination = parts.join('-');
            const optimisticDesc = dist.description || dist.combinationName || '';
            // Optimistically update line
            setLines(prev => prev.map(l =>
              l.key === record.key
                ? { ...l, distributionId: distId, account: combination,
                    accountDescription: optimisticDesc }
                : l
            ));
            // Validate to get full segment details
            setValidatingAccount(record.key);
            try {
              const result = await validateAccountCode(combination);
              if (result.isValid) {
                const accountSeg = Object.entries(result.segmentDetails).find(([k, d]) =>
                  k.toUpperCase().includes('ACCOUNT') ||
                  (d.name && d.name.toUpperCase().includes('ACCOUNT'))
                );
                const accountDescription = accountSeg
                  ? `${accountSeg[1].value} - ${accountSeg[1].description}`
                  : optimisticDesc;
                setLines(prev => prev.map(l =>
                  l.key === record.key
                    ? { ...l, account: combination, accountDescription, segmentDetails: result.segmentDetails }
                    : l
                ));
              }
            } catch { /* ignore */ } finally {
              setValidatingAccount(null);
            }
          }}
          onClear={() => {
            setLines(prev => prev.map(l =>
              l.key === record.key
                ? { ...l, distributionId: null, account: '', accountDescription: '', segmentDetails: {} }
                : l
            ));
          }}
          disabled={isViewMode || isPosted}
          showSearch
          allowClear
          size="small"
          style={{ width: '100%' }}
          placeholder="Search distribution…"
          loading={loadingDist && !distCombinations.length}
          filterOption={(input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
            String(option?.title ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={distCombinations.map(d => ({
            value: d.combinationId,
            label: d.combinationName,
            title: d.glAccountDesc || '',
          }))}
          optionRender={(option) => (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{option.data.label}</div>
              {option.data.title && (
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: REDWOOD.neutral600 }}>{option.data.title}</div>
              )}
            </div>
          )}
        />
      ),
    },
    {
      title: <span><span style={{ color: REDWOOD.primary }}>*</span> Account</span>,
      dataIndex: 'account',
      key: 'account',
      width: colWidths.account,
      onHeaderCell: () => ({ width: colWidths.account, onResize: handleColResize('account') } as any),
      render: (value, record) => (
        <div>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={value}
              readOnly
              title={value}
              placeholder="Click ⊕ to select account"
              size="small"
              style={{ width: 'calc(100% - 32px)', cursor: isViewMode || isPosted ? 'default' : 'pointer', backgroundColor: '#fafafa' }}
              onClick={() => { if (!isViewMode && !isPosted) openAccountSelector(record.key, value); }}
            />
            <Tooltip title={isViewMode || isPosted ? 'Locked' : 'Select Account Combination'}>
              <Button
                size="small"
                icon={<SearchOutlined />}
                onClick={() => { if (!isViewMode && !isPosted) openAccountSelector(record.key, value); }}
                style={{ borderColor: REDWOOD.neutral300 }}
                loading={validatingAccount === record.key}
                disabled={isViewMode || isPosted}
              />
            </Tooltip>
            {record.account && Object.keys(record.segmentDetails || {}).length > 0 && (
              <Popover
                title="Account Segments"
                trigger="click"
                content={
                  <div style={{ minWidth: 280 }}>
                    {Object.entries(record.segmentDetails || {}).map(([segmentCode, detail]) => (
                      <div key={segmentCode} style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                        <Text strong style={{ minWidth: 100, fontSize: 12 }}>{detail.name || segmentCode}:</Text>
                        <Text style={{ fontSize: 12 }}>{detail.value} - {detail.description}</Text>
                      </div>
                    ))}
                  </div>
                }
              >
                <Button
                  size="small"
                  icon={<InfoCircleOutlined />}
                  style={{ borderColor: REDWOOD.neutral300, color: REDWOOD.info }}
                />
              </Popover>
            )}
            {record.account && (
              <Tooltip title="View Account Balances">
                <Button
                  size="small"
                  icon={<BarChartOutlined />}
                  style={{ borderColor: REDWOOD.neutral300, color: REDWOOD.success }}
                  onClick={() => openAccountBalance(record.account, record.accountDescription, record.segmentDetails || {})}
                />
              </Tooltip>
            )}
          </Space.Compact>
          {record.accountDescription && (
            <div style={{
              fontSize: 11,
              color: REDWOOD.neutral600,
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 320,
            }}>
              {record.accountDescription}
            </div>
          )}
          {!record.account && (
            <div style={{ fontSize: 10, color: REDWOOD.neutral300, marginTop: 2 }}>
              {journalData.company ? `${journalData.company} – … – [Account] – …` : '– select account combination –'}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Currency',
      dataIndex: 'currency',
      key: 'currency',
      width: colWidths.currency,
      onHeaderCell: () => ({ width: colWidths.currency, onResize: handleColResize('currency') } as any),
    },
    {
      title: `Entered (${journalData.currency})`,
      children: [
        {
          title: 'Debit',
          dataIndex: 'enteredDr',
          key: 'enteredDr',
          width: colWidths.enteredDr,
          align: 'right',
          onHeaderCell: () => ({ width: colWidths.enteredDr, onResize: handleColResize('enteredDr') } as any),
          render: (value, record) => (
            <InputNumber
              value={value}
              onChange={(val) => updateLine(record.key, 'enteredDr', val)}
              size="small"
              style={{ width: '100%' }}
              min={0}
              precision={2}
              readOnly={isPosted || isViewMode}
            />
          ),
        },
        {
          title: 'Credit',
          dataIndex: 'enteredCr',
          key: 'enteredCr',
          width: colWidths.enteredCr,
          align: 'right',
          onHeaderCell: () => ({ width: colWidths.enteredCr, onResize: handleColResize('enteredCr') } as any),
          render: (value, record) => (
            <InputNumber
              value={value}
              onChange={(val) => updateLine(record.key, 'enteredCr', val)}
              size="small"
              style={{ width: '100%' }}
              min={0}
              precision={2}
              readOnly={isPosted || isViewMode}
            />
          ),
        },
      ],
    },
    {
      title: 'Conversion',
      children: [
        {
          title: 'Date',
          dataIndex: 'conversionDate',
          key: 'conversionDate',
          width: colWidths.conversionDate,
          onHeaderCell: () => ({ width: colWidths.conversionDate, onResize: handleColResize('conversionDate') } as any),
        },
      ],
    },
    {
      title: `Accounted (${selectedLedger?.currency_code || journalData.currency})`,
      children: [
        {
          title: 'Debit',
          dataIndex: 'accountedDr',
          key: 'accountedDr',
          width: colWidths.accountedDr,
          align: 'right',
          onHeaderCell: () => ({ width: colWidths.accountedDr, onResize: handleColResize('accountedDr') } as any),
          render: (value: number) => (
            <span style={{ fontSize: 12, color: value ? REDWOOD.neutral900 : REDWOOD.neutral300 }}>
              {value ? formatNumber(value) : '—'}
            </span>
          ),
        },
        {
          title: 'Credit',
          dataIndex: 'accountedCr',
          key: 'accountedCr',
          width: colWidths.accountedCr,
          align: 'right',
          onHeaderCell: () => ({ width: colWidths.accountedCr, onResize: handleColResize('accountedCr') } as any),
          render: (value: number) => (
            <span style={{ fontSize: 12, color: value ? REDWOOD.neutral900 : REDWOOD.neutral300 }}>
              {value ? formatNumber(value) : '—'}
            </span>
          ),
        },
      ],
    },
    {
      title: <span><span style={{ color: REDWOOD.primary }}>*</span> Description</span>,
      dataIndex: 'description',
      key: 'description',
      width: colWidths.description,
      onHeaderCell: () => ({ width: colWidths.description, onResize: handleColResize('description') } as any),
      render: (value, record) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          {/* multi-line preview / read-only text */}
          <div
            style={{
              flex: 1,
              fontSize: 12,
              lineHeight: '1.4',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: value ? REDWOOD.neutral900 : REDWOOD.neutral300,
              minHeight: 24,
              padding: '2px 4px',
              background: isPosted || isViewMode ? 'transparent' : '#fafafa',
              border: isPosted || isViewMode ? 'none' : `1px solid ${REDWOOD.neutral200}`,
              borderRadius: 3,
            }}
          >
            {value || (isPosted || isViewMode ? '—' : 'click ✎ to add')}
          </div>
          {/* edit icon — hidden in locked state */}
          {!isPosted && !isViewMode && (
            <Tooltip title="Edit description">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined style={{ fontSize: 12, color: REDWOOD.info }} />}
                style={{ padding: '1px 4px', flexShrink: 0 }}
                onClick={() => { setDescEditKey(record.key); setDescEditValue(value || ''); }}
              />
            </Tooltip>
          )}
        </div>
      ),
    },
  ];

  // Render Batch tabs content
  const renderBatchTabs = () => (
    <Tabs
      activeKey={activeBatchTab}
      onChange={setActiveBatchTab}
      size="small"
      style={{ padding: '0 12px' }}
      items={[
        {
          key: 'batch',
          label: 'Batch',
          children: (
            <div style={{ padding: '12px 0' }}>
              <Row gutter={[32, 12]}>
                <Col span={12}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={8}><Text style={{ fontSize: 13 }}>Journal Batch</Text></Col>
                    <Col span={16}>
                      <Text style={{ fontSize: 13, fontWeight: 600, color: REDWOOD.primary }}>
                        Batch {batchData.batchName}
                      </Text>
                    </Col>

                    <Col span={8}><Text style={{ fontSize: 13 }}>Description</Text></Col>
                    <Col span={16}>
                      <Input.TextArea
                        value={batchData.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBatchData(prev => ({ ...prev, description: v }));
                          setJournalData(prev => ({ ...prev, description: v }));
                        }}
                        size="small"
                        rows={2}
                        style={{ width: 200 }}
                        disabled={isViewMode || isPosted}
                      />
                    </Col>

                    <Col span={8}><Text style={{ fontSize: 13 }}>Balance Type</Text></Col>
                    <Col span={16}><Text style={{ fontSize: 13 }}>{batchData.balanceType}</Text></Col>

                    <Col span={8}>
                      <Text style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Accounting Period</Text>
                    </Col>
                    <Col span={16}>
                      <Select
                        value={batchData.accountingPeriod}
                        onChange={(val) => setBatchData({ ...batchData, accountingPeriod: val })}
                        size="small"
                        style={{ width: 180 }}
                        loading={loadingPeriods}
                        placeholder="Select period"
                        disabled={isViewMode || isPosted}
                      >
                        {periods
                          .filter(p => p.status === 'Open' || p.status === 'Future Entry')
                          .map(period => (
                            <Option key={period.period_name_id} value={period.period_name_id}>
                              {period.period_name_id} ({period.status})
                            </Option>
                          ))}
                      </Select>
                    </Col>

                  </Row>
                </Col>
                <Col span={12}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={10}><Text style={{ fontSize: 13 }}>Source</Text></Col>
                    <Col span={14}><Text style={{ fontSize: 13 }}>Manual</Text></Col>

                    <Col span={10}><Text style={{ fontSize: 13 }}>Approval Status</Text></Col>
                    <Col span={14}><Text style={{ fontSize: 13 }}>Required</Text></Col>

                    <Col span={10}><Text style={{ fontSize: 13 }}>Batch Status</Text></Col>
                    <Col span={14}><Text style={{ fontSize: 13 }}>Unposted</Text></Col>

                    <Col span={10}><Text style={{ fontSize: 13 }}>Completion Status</Text></Col>
                    <Col span={14}><Text style={{ fontSize: 13 }}>Incomplete</Text></Col>
                  </Row>
                </Col>
              </Row>

              {/* ── ATTACHMENTS ─────────────────────────────────── */}
              <div style={{ marginTop: 12, borderTop: `1px solid ${REDWOOD.neutral200}`, paddingTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Space size={6}>
                    <PaperClipOutlined style={{ color: REDWOOD.neutral600, fontSize: 13 }} />
                    <Text strong style={{ fontSize: 12 }}>Attachments</Text>
                    {attachments.length > 0 && <Tag color="blue" style={{ fontSize: 10, padding: '0 5px', lineHeight: '16px' }}>{attachments.length}</Tag>}
                  </Space>
                  <Space size={4}>
                    {attachments.some(a => !a.id) && (
                      <Button size="small" type="primary" icon={<CloudUploadOutlined />}
                        loading={attSaving} onClick={handleSaveAttachments}
                        style={{ fontSize: 11, height: 24 }}>
                        Save
                      </Button>
                    )}
                    <Upload multiple showUploadList={false} beforeUpload={handleAttachmentUpload} disabled={!savedBatchId}>
                      <Button size="small" icon={<PaperClipOutlined />} disabled={!savedBatchId}
                        style={{ borderColor: REDWOOD.info, color: savedBatchId ? REDWOOD.info : undefined, fontSize: 11, height: 24 }}>
                        {savedBatchId ? 'Attach File' : 'Save journal first'}
                      </Button>
                    </Upload>
                  </Space>
                </div>

                {attachments.length === 0 ? (
                  <div style={{ color: REDWOOD.neutral400, fontSize: 11, paddingLeft: 2 }}>
                    {savedBatchId ? 'No attachments.' : 'Save the journal batch to enable attachments.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {attachments.map(att => (
                      <div key={att.uid} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '2px 8px', borderRadius: 3,
                        background: att.id ? REDWOOD.neutral100 : '#fffbe6',
                        border: `1px solid ${att.id ? REDWOOD.neutral200 : '#ffe58f'}`,
                        fontSize: 11, minHeight: 26,
                      }}>
                        <PaperClipOutlined style={{ color: REDWOOD.neutral500, flexShrink: 0, fontSize: 11 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                          {att.name}
                        </span>
                        <span style={{ color: REDWOOD.neutral400, fontSize: 10, flexShrink: 0, marginRight: 2 }}>
                          {att.fileSize ? `${(att.fileSize / 1024).toFixed(1)} KB` : ''}
                        </span>
                        {!att.id && <Tag color="warning" style={{ fontSize: 9, padding: '0 4px', margin: 0, lineHeight: '14px' }}>Pending</Tag>}
                        <Tooltip title="Preview">
                          <Button size="small" type="text" icon={<EyeOutlined />} style={{ padding: '0 4px', height: 22, width: 22 }}
                            loading={attPreviewLoading} onClick={() => handlePreviewAttachment(att)} />
                        </Tooltip>
                        <Tooltip title="Download">
                          <Button size="small" type="text" icon={<DownloadOutlined />} style={{ padding: '0 4px', height: 22, width: 22 }}
                            onClick={() => handleDownloadAttachment(att)} />
                        </Tooltip>
                        <Tooltip title="Delete">
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ padding: '0 4px', height: 22, width: 22 }}
                            onClick={() => handleDeleteAttachment(att)} />
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        {
          key: 'controlTotal',
          label: 'Control Total',
          children: (
            <div style={{ padding: '12px 0' }}>
              <Row gutter={[32, 12]}>
                <Col span={12}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={14}><Text style={{ fontSize: 13 }}>Total Entered Debit</Text></Col>
                    <Col span={10}><Text strong style={{ fontSize: 13 }}>{formatNumber(lineTotals.enteredDr) || '0.00'}</Text></Col>

                    <Col span={14}><Text style={{ fontSize: 13 }}>Total Entered Credit</Text></Col>
                    <Col span={10}><Text strong style={{ fontSize: 13 }}>{formatNumber(lineTotals.enteredCr) || '0.00'}</Text></Col>

                    <Col span={14}><Text style={{ fontSize: 13 }}>Difference</Text></Col>
                    <Col span={10}>
                      <Text strong style={{ fontSize: 13, color: isBalanced ? REDWOOD.success : REDWOOD.primary }}>
                        {formatNumber(Math.abs(lineTotals.enteredDr - lineTotals.enteredCr)) || '0.00'}
                        {!isBalanced && lineTotals.enteredDr !== lineTotals.enteredCr && ' (Unbalanced)'}
                      </Text>
                    </Col>
                  </Row>
                </Col>
                <Col span={12}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={14}><Text style={{ fontSize: 13 }}>Total Accounted Debit</Text></Col>
                    <Col span={10}><Text strong style={{ fontSize: 13 }}>{formatNumber(lineTotals.accountedDr) || '0.00'}</Text></Col>

                    <Col span={14}><Text style={{ fontSize: 13 }}>Total Accounted Credit</Text></Col>
                    <Col span={10}><Text strong style={{ fontSize: 13 }}>{formatNumber(lineTotals.accountedCr) || '0.00'}</Text></Col>

                    <Col span={14}><Text style={{ fontSize: 13 }}>Journal Count</Text></Col>
                    <Col span={10}><Text strong style={{ fontSize: 13 }}>{journals.length}</Text></Col>
                  </Row>
                </Col>
              </Row>
            </div>
          ),
        },
        {
          key: 'actionLog',
          label: 'Action Log',
          children: (
            <div style={{ padding: '12px 0' }}>
              <Text type="secondary" style={{ fontSize: 13 }}>No actions logged yet.</Text>
            </div>
          ),
        },
      ]}
    />
  );

  // Render Journal tabs content
  const renderJournalTabs = () => (
    <Tabs
      activeKey={activeJournalTab}
      onChange={setActiveJournalTab}
      size="small"
      style={{ padding: '0 12px' }}
      items={[
        {
          key: 'journal',
          label: 'Journal',
          children: (
            <div style={{ padding: '12px 0' }}>
              <Row gutter={[32, 12]}>
                <Col span={8}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={10}><Text style={{ fontSize: 13 }}>Journal</Text></Col>
                    <Col span={14}>
                      <Text style={{ fontSize: 13, fontWeight: 600, color: REDWOOD.primary }}>
                        Journal {journalData.journalName}
                      </Text>
                    </Col>

                    <Col span={10}><Text style={{ fontSize: 13 }}>Description</Text></Col>
                    <Col span={14}>
                      <Input.TextArea
                        value={journalData.description}
                        onChange={(e) => setJournalData({ ...journalData, description: e.target.value })}
                        size="small"
                        rows={2}
                        style={{ width: '100%' }}
                        disabled={isViewMode || isPosted}
                      />
                    </Col>

                    <Col span={10}>
                      <Text style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Ledger</Text>
                    </Col>
                    <Col span={14}>
                      <Input
                        value={journalData.ledger}
                        readOnly
                        size="small"
                        style={{ width: '100%', backgroundColor: '#fafafa', color: REDWOOD.neutral700 }}
                        placeholder="Select ledger from the top"
                      />
                    </Col>

                    <Col span={10}>
                      <Text style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Business Unit</Text>
                    </Col>
                    <Col span={14}>
                      <Select
                        value={selectedBu || undefined}
                        onChange={(val: string) => {
                          setSelectedBu(val);
                          const bu = businessUnits.find(b => b.value === val);
                          const company = buCompanyMap[val] || '';
                          setDerivedCompany(company);
                          setJournalData(prev => ({
                            ...prev,
                            legalEntity: val,
                            company,
                          }));
                        }}
                        size="small"
                        style={{ width: '100%' }}
                        placeholder="Select Business Unit"
                        showSearch
                        disabled={isViewMode || isPosted || !!(selectedBu && derivedCompany && journalData.category)}
                        filterOption={(input, option) =>
                          String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        options={businessUnits}
                      />
                      {derivedCompany && (
                        <div style={{ marginTop: 3, fontSize: 11, color: REDWOOD.neutral600 }}>
                          Company: <Tag color="blue" style={{ marginLeft: 2, fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>{derivedCompany}</Tag>
                        </div>
                      )}
                    </Col>

                    <Col span={10}>
                      <Text style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Accounting Date</Text>
                    </Col>
                    <Col span={14}>
                      {(() => {
                        const selPeriod = periods.find(p => p.period_name_id === batchData.accountingPeriod);
                        const pStart = selPeriod?.start_date ? parseOracleDate(selPeriod.start_date) : null;
                        const pEnd   = selPeriod?.end_date   ? parseOracleDate(selPeriod.end_date)   : null;
                        return (
                          <DatePicker
                            value={parseDateSafe(journalData.accountingDate)}
                            onChange={(date) => setJournalData({ ...journalData, accountingDate: date?.format('D-MMM-YYYY') || '' })}
                            size="small"
                            style={{ width: '100%' }}
                            format="D-MMM-YYYY"
                            disabled={isViewMode || isPosted}
                            disabledDate={(current) => {
                              if (!pStart || !pEnd) return false;
                              return current.isBefore(pStart, 'day') || current.isAfter(pEnd, 'day');
                            }}
                          />
                        );
                      })()}
                    </Col>

                    <Col span={10}>
                      <Text style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Category</Text>
                    </Col>
                    <Col span={14}>
                      <Select
                        value={journalData.category}
                        onChange={(val) => setJournalData({ ...journalData, category: val })}
                        size="small"
                        style={{ width: '100%' }}
                        placeholder="Select category"
                        showSearch
                        disabled={isViewMode || isPosted}
                        filterOption={(input, option) =>
                          String(option?.value ?? '').toLowerCase().includes(input.toLowerCase()) ||
                          String(option?.children ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                      >
                        {glCategories.length > 0
                          ? glCategories.map(c => (
                              <Option key={c.jeCategoryName} value={c.jeCategoryName}>
                                {c.userJeCategoryName}
                              </Option>
                            ))
                          : (
                            <>
                              <Option value="Adjustment">Adjustment</Option>
                              <Option value="Accrual">Accrual</Option>
                              <Option value="Other">Other</Option>
                            </>
                          )
                        }
                      </Select>
                    </Col>

                  </Row>
                </Col>
                <Col span={8}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={12}><Text style={{ fontSize: 13 }}>Currency</Text></Col>
                    <Col span={12}>
                      <Select
                        value={journalData.currency}
                        onChange={(val) => {
                          setJournalData(prev => ({ ...prev, currency: val }));
                        }}
                        size="small"
                        style={{ width: '100%' }}
                        showSearch
                        disabled={isViewMode || isPosted}
                        filterOption={(input, option) =>
                          String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                      >
                        {currencies.length > 0
                          ? currencies.map(c => (
                              <Option key={c.code} value={c.code}>
                                {c.code}
                              </Option>
                            ))
                          : (
                            <>
                              <Option value="AED">AED</Option>
                              <Option value="USD">USD</Option>
                              <Option value="INR">INR</Option>
                            </>
                          )
                        }
                      </Select>
                      {journalData.currency && journalData.currency !== 'AED' && (
                        <div style={{ marginTop: 4, fontSize: 11, color: REDWOOD.neutral600 }}>
                          {bmsRateLoading
                            ? <span style={{ color: REDWOOD.info }}>Fetching rate…</span>
                            : bmsRate
                            ? <span>Rate: <strong>{bmsRate.rate}</strong> ({bmsRate.rateType}, {bmsRate.rateDate})</span>
                            : <span style={{ color: REDWOOD.warning }}>No rate found</span>
                          }
                        </div>
                      )}
                    </Col>

                    <Col span={12}>
                      <Text style={{ fontSize: 13 }}><span style={{ color: REDWOOD.primary }}>*</span> Conversion Date</Text>
                    </Col>
                    <Col span={12}>
                      <DatePicker
                        value={parseDateSafe(journalData.conversionDate)}
                        onChange={(date) => setJournalData({ ...journalData, conversionDate: date?.format('D-MMM-YYYY') || '' })}
                        size="small"
                        style={{ width: '100%' }}
                        format="D-MMM-YYYY"
                        disabled={isViewMode || isPosted}
                      />
                    </Col>

                    <Col span={12}><Text style={{ fontSize: 13 }}>Conversion Rate Type</Text></Col>
                    <Col span={12}>
                      <Select
                        value={journalData.conversionRateType}
                        onChange={(val) => {
                          setJournalData(prev => ({ ...prev, conversionRateType: val }));
                          // 'User' rate is entered manually — don't fetch/override it.
                          if (val !== 'User' && journalData.currency && journalData.currency !== 'AED') {
                            fetchBmsRate(journalData.currency, journalData.conversionDate, true);
                          }
                        }}
                        size="small"
                        style={{ width: '100%' }}
                        disabled={isViewMode || isPosted}
                      >
                        <Option value="Corporate">Corporate</Option>
                        <Option value="Spot">Spot</Option>
                        <Option value="User">User</Option>
                      </Select>
                    </Col>

                    <Col span={12}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 13 }}>Conversion Rate</Text>
                        <Tooltip title="Refresh rate from BMS">
                          <Button size="small" icon={<ReloadOutlined />} loading={bmsRateLoading}
                            style={{ padding: '0 4px', height: 20, fontSize: 11, color: REDWOOD.info, borderColor: REDWOOD.info }}
                            onClick={() => fetchBmsRate(journalData.currency, journalData.conversionDate, true)} />
                        </Tooltip>
                        <Tooltip title="API Inspector — view rate lookup request">
                          <Button size="small" icon={<ApiOutlined />}
                            style={{ padding: '0 4px', height: 20, fontSize: 11, color: REDWOOD.neutral600 }}
                            onClick={() => setBmsRateApiModal(true)} />
                        </Tooltip>
                      </div>
                    </Col>
                    <Col span={12}>
                      <InputNumber
                        value={journalData.conversionRate}
                        onChange={(val) => setJournalData(prev => ({ ...prev, conversionRate: val || 1, inverseRate: val ? Math.round((1 / val) * 100000000) / 100000000 : 1 }))}
                        size="small"
                        style={{ width: '100%' }}
                        precision={8}
                        min={0.00000001}
                        disabled={isViewMode || isPosted || journalData.conversionRateType !== 'User'}
                      />
                    </Col>
                  </Row>
                </Col>
                <Col span={8}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={12}><Text style={{ fontSize: 13 }}>Inverse Conversion Rate</Text></Col>
                    <Col span={12}><Text style={{ fontSize: 13 }}>{journalData.inverseRate}</Text></Col>

                    <Col span={12}><Text style={{ fontSize: 13 }}>Reference</Text></Col>
                    <Col span={12}>
                      <Input
                        value={journalData.reference}
                        onChange={(e) => setJournalData({ ...journalData, reference: e.target.value })}
                        size="small"
                        style={{ width: '100%' }}
                      />
                    </Col>

                    <Col span={12}><Text style={{ fontSize: 13 }}>Reference Date</Text></Col>
                    <Col span={12}>
                      <DatePicker
                        value={journalData.referenceDate ? dayjs(journalData.referenceDate, 'D-MMM-YYYY') : null}
                        onChange={(date) => setJournalData({ ...journalData, referenceDate: date?.format('D-MMM-YYYY') || '' })}
                        size="small"
                        style={{ width: '100%' }}
                        format="D-MMM-YYYY"
                        placeholder="D-MMM-YYYY"
                      />
                    </Col>

                    <Col span={12}><Text style={{ fontSize: 13 }}>Regional Information</Text></Col>
                    <Col span={12}>
                      <Select
                        value={journalData.regionalInfo}
                        onChange={(val) => setJournalData({ ...journalData, regionalInfo: val })}
                        size="small"
                        style={{ width: '100%' }}
                        placeholder=""
                        allowClear
                      />
                    </Col>
                  </Row>
                </Col>
              </Row>
            </div>
          ),
        },
        {
          key: 'controlTotal',
          label: 'Control Total',
          children: (
            <div style={{ padding: '12px 0' }}>
              <Row gutter={[32, 12]}>
                <Col span={12}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={12}><Text style={{ fontSize: 13 }}>Control Total</Text></Col>
                    <Col span={12}>
                      <InputNumber
                        value={journalData.controlTotal}
                        onChange={(val) => setJournalData({ ...journalData, controlTotal: val })}
                        size="small"
                        style={{ width: 150 }}
                        precision={2}
                      />
                    </Col>

                    <Col span={12}><Text style={{ fontSize: 13 }}>Total Entered Debit</Text></Col>
                    <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(lineTotals.enteredDr) || '-'}</Text></Col>

                    <Col span={12}><Text style={{ fontSize: 13 }}>Total Entered Credit</Text></Col>
                    <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(lineTotals.enteredCr) || '-'}</Text></Col>
                  </Row>
                </Col>
                <Col span={12}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={12}><a style={{ color: REDWOOD.info, fontSize: 13, textDecoration: 'underline' }}>Total Accounted Debit</a></Col>
                    <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(lineTotals.accountedDr) || '-'}</Text></Col>

                    <Col span={12}><a style={{ color: REDWOOD.info, fontSize: 13, textDecoration: 'underline' }}>Total Accounted Credit</a></Col>
                    <Col span={12}><Text style={{ fontSize: 13 }}>{formatNumber(lineTotals.accountedCr) || '-'}</Text></Col>
                  </Row>
                </Col>
              </Row>
            </div>
          ),
        },
        {
          key: 'sequencing',
          label: 'Sequencing',
          children: (
            <div style={{ padding: '12px 0' }}>
              <Row gutter={[48, 12]}>
                <Col span={12}>
                  <a style={{ color: REDWOOD.info, fontSize: 13, textDecoration: 'underline', display: 'block', marginBottom: 12 }}>Accounting Sequence</a>
                  <Row gutter={[8, 8]} align="middle">
                    <Col span={8}><Text style={{ fontSize: 13 }}>Name</Text></Col>
                    <Col span={16}><Text style={{ fontSize: 13 }}>{journalData.accountingSeqName || '-'}</Text></Col>

                    <Col span={8}><Text style={{ fontSize: 13 }}>Number</Text></Col>
                    <Col span={16}><Text style={{ fontSize: 13 }}>{journalData.accountingSeqNumber || '-'}</Text></Col>
                  </Row>
                </Col>
                <Col span={12}>
                  <a style={{ color: REDWOOD.info, fontSize: 13, textDecoration: 'underline', display: 'block', marginBottom: 12 }}>Reporting Sequence</a>
                  <Row gutter={[8, 8]} align="middle">
                    <Col span={8}><Text style={{ fontSize: 13 }}>Name</Text></Col>
                    <Col span={16}><Text style={{ fontSize: 13 }}>{journalData.reportingSeqName || '-'}</Text></Col>

                    <Col span={8}><Text style={{ fontSize: 13 }}>Number</Text></Col>
                    <Col span={16}><Text style={{ fontSize: 13 }}>{journalData.reportingSeqNumber || '-'}</Text></Col>
                  </Row>
                </Col>
              </Row>
            </div>
          ),
        },
        {
          key: 'reversal',
          label: 'Reversal',
          children: (
            <div style={{ padding: '12px 0' }}>
              <Row gutter={[32, 12]}>
                <Col span={12}>
                  <Row gutter={[8, 12]} align="middle">
                    <Col span={10}><Text style={{ fontSize: 13 }}>Reversal Period</Text></Col>
                    <Col span={14}>
                      <Select
                        value={journalData.reversalPeriod}
                        onChange={(val) => setJournalData({ ...journalData, reversalPeriod: val })}
                        size="small"
                        style={{ width: 180 }}
                        placeholder="Select"
                        allowClear
                        loading={loadingPeriods}
                      >
                        {periods.map(period => (
                          <Option key={period.period_name_id} value={period.period_name_id}>
                            {period.period_year} - {period.period_name_id}
                          </Option>
                        ))}
                      </Select>
                    </Col>

                    <Col span={10}><Text style={{ fontSize: 13 }}>Reversal Method</Text></Col>
                    <Col span={14}>
                      <Select
                        value={journalData.reversalMethod}
                        onChange={(val) => setJournalData({ ...journalData, reversalMethod: val })}
                        size="small"
                        style={{ width: 150 }}
                      >
                        <Option value="Switch DR or CR">Switch DR or CR</Option>
                        <Option value="Change Sign">Change Sign</Option>
                      </Select>
                    </Col>
                  </Row>
                </Col>
              </Row>
            </div>
          ),
        },
      ]}
    />
  );

  return (
    <Layout style={{ minHeight: embeddedMode ? 'auto' : '100vh', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Select Ledger Header */}
        <div style={{ padding: '6px 24px', background: REDWOOD.neutral100, fontSize: 12, color: REDWOOD.neutral600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 12 }}>Select Ledger:</Text>
          <Select
            value={selectedLedger?.ledger_id}
            onChange={handleLedgerChange}
            loading={loadingLedgers}
            size="small"
            style={{ minWidth: 250 }}
            placeholder="Select a ledger"
          >
            {ledgers.map(ledger => (
              <Option key={ledger.ledger_id} value={ledger.ledger_id}>
                {ledger.ledger_name}
              </Option>
            ))}
          </Select>
          {selectedLedger && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
              Currency: {selectedLedger.currency_code}
            </Text>
          )}
        </div>

        {/* Action Header with Title */}
        <div style={{
          padding: '8px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Space>
            <Title level={5} style={{ margin: 0, fontSize: 16 }}>
              Create Journal
            </Title>
            <QuestionCircleOutlined style={{ color: REDWOOD.neutral600, cursor: 'pointer' }} />
          </Space>
          <Space size="small">
            {isPosted ? (
              <>
                <Tag color="success" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <CheckOutlined /> Posted
                </Tag>
                <Tooltip title="Create a reversal of this journal">
                  <Button size="small" icon={<LeftOutlined />} onClick={() => message.info('Reverse Journal: coming soon')}>
                    Reverse
                  </Button>
                </Tooltip>
                <Tooltip title="Copy this journal to a new draft">
                  <Button size="small" icon={<CopyOutlined />} onClick={() => message.info('Copy Journal: coming soon')}>
                    Copy
                  </Button>
                </Tooltip>
              </>
            ) : isViewMode ? (
              /* ── Saved, locked view mode ── */
              <>
                <Tag color="blue" style={{ fontSize: 12, padding: '2px 10px' }}>
                  <LockOutlined /> Saved — Batch {batchData.batchName}
                </Tag>
                <Button
                  type="primary"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setIsViewMode(false)}
                >
                  Edit
                </Button>
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckSquareOutlined />}
                  style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                  onClick={handlePost}
                >
                  Post
                </Button>
              </>
            ) : (
              /* ── Edit mode (new or editing saved) ── */
              <>
                <Button
                  type="primary"
                  size="small"
                  loading={saving}
                  onClick={() => handleSave(false)}
                  icon={<SaveOutlined />}
                  disabled={lines.length === 0}
                >
                  {savedBatchId ? 'Update' : 'Save'}
                </Button>
                <Button
                  size="small"
                  loading={saving}
                  onClick={() => handleSave(true)}
                  icon={<SaveOutlined />}
                  disabled={lines.length === 0}
                >
                  {savedBatchId ? 'Update and Close' : 'Save and Close'}
                </Button>
                {savedBatchId && (
                  <Button size="small" onClick={() => setIsViewMode(true)}>
                    Cancel Edit
                  </Button>
                )}
                {!savedBatchId && (
                  <Tooltip title="Save the journal first before posting">
                    <Button type="primary" size="small" icon={<CheckSquareOutlined />} disabled>
                      Post
                    </Button>
                  </Tooltip>
                )}
              </>
            )}
            <Button size="small" onClick={handleCancel}>
              {isViewMode ? 'Close' : 'Cancel'}
            </Button>
            <Tooltip
              title={savedBatchId
                ? `PUT ${APEX_DB_CONFIG.baseUrl}/journals/update/${savedBatchId}`
                : `POST ${SAVE_ENDPOINT}`}
              placement="bottomRight"
            >
              <Button
                size="small"
                icon={<ApiOutlined />}
                style={{ color: savedBatchId ? REDWOOD.warning : REDWOOD.info, borderColor: savedBatchId ? REDWOOD.warning : REDWOOD.info }}
                onClick={() => {
                  const payload = buildJsonPayload();
                  setJsonPayload(payload);
                  setShowJsonPayload(true);
                  setSaveResponse(null);
                  setLastSaveSucceeded(false);
                  setJsonPreviewVisible(true);
                }}
              >
                {savedBatchId ? `PUT #${savedBatchId}` : 'POST'}
              </Button>
            </Tooltip>
          </Space>
        </div>

        <div style={{ padding: 16 }}>
          {/* Journal Batch Section */}
          <Card
            style={{ marginBottom: 12, borderRadius: 6 }}
            bodyStyle={{ padding: 0 }}
          >
            <div
              onClick={() => setBatchExpanded(v => !v)}
              style={{
                padding: '8px 12px',
                background: REDWOOD.neutral100,
                borderBottom: `1px solid ${REDWOOD.neutral200}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <Space>
                <Text strong style={{ fontSize: 13 }}>
                  <span style={{ marginRight: 4, display: 'inline-block', transition: 'transform 0.2s', transform: batchExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
                  Journal Batch
                </Text>
                <QuestionCircleOutlined style={{ color: REDWOOD.neutral600 }} onClick={e => e.stopPropagation()} />
                <Text style={{ color: REDWOOD.info, fontSize: 12 }}>
                  {batchExpanded ? 'Show Less' : 'Show More'}
                </Text>
              </Space>
              <Tooltip title="Delete this journal batch">
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={e => { e.stopPropagation(); setDeleteBatchModalVisible(true); }}
                >
                  Delete Batch
                </Button>
              </Tooltip>
            </div>

            <div style={{ display: batchExpanded ? 'block' : 'none', pointerEvents: isPosted ? 'none' : undefined, opacity: isPosted ? 0.7 : 1 }}>
              {renderBatchTabs()}
            </div>
          </Card>

          {/* Journal Section */}
          <Card
            style={{ marginBottom: 12, borderRadius: 6 }}
            bodyStyle={{ padding: 0 }}
          >
            <div
              style={{
                padding: '8px 12px',
                background: REDWOOD.neutral100,
                borderBottom: `1px solid ${REDWOOD.neutral200}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Space
                onClick={() => setJournalExpanded(v => !v)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <Text strong style={{ fontSize: 13 }}>
                  <span style={{ marginRight: 4, display: 'inline-block', transition: 'transform 0.2s', transform: journalExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
                  Journal
                </Text>
                <QuestionCircleOutlined style={{ color: REDWOOD.neutral600 }} onClick={e => e.stopPropagation()} />
                <Text style={{ color: REDWOOD.info, fontSize: 12 }}>
                  {journalExpanded ? 'Show Less' : 'Show More'}
                </Text>
              </Space>
              <Space size="small">
                <Tooltip title="Previous Journal">
                  <Button
                    size="small"
                    icon={<LeftOutlined />}
                    disabled={currentJournalIndex === 0}
                    onClick={handlePrevJournal}
                  />
                </Tooltip>
                <Select
                  value={currentJournal.id}
                  style={{ width: 150, fontSize: 11 }}
                  size="small"
                  onChange={(value) => {
                    const idx = journals.findIndex(j => j.id === value);
                    if (idx !== -1) setCurrentJournalIndex(idx);
                  }}
                >
                  {journals.map((journal, idx) => (
                    <Option key={journal.id} value={journal.id}>
                      Journal {idx + 1}{journal.data.journalName ? `: ${journal.data.journalName}` : ''}
                    </Option>
                  ))}
                </Select>
                <Tooltip title="Next Journal">
                  <Button
                    size="small"
                    icon={<RightOutlined />}
                    disabled={currentJournalIndex === journals.length - 1}
                    onClick={handleNextJournal}
                  />
                </Tooltip>
                <Tooltip title="Add Journal">
                  <Button size="small" icon={<PlusOutlined />} onClick={handleAddJournal} />
                </Tooltip>
                <Tooltip title="Delete Journal">
                  <Button size="small" icon={<DeleteOutlined />} onClick={handleDeleteJournal} />
                </Tooltip>
                <Tooltip title="Export Journal to PDF">
                  <Button
                    size="small"
                    icon={<FilePdfOutlined />}
                    onClick={handlePrintPDF}
                    style={{ background: REDWOOD.primary, color: '#fff', borderColor: REDWOOD.primary }}
                  >
                    Print PDF
                  </Button>
                </Tooltip>
              </Space>
            </div>

            <div style={{ display: journalExpanded ? 'block' : 'none', pointerEvents: isPosted ? 'none' : undefined, opacity: isPosted ? 0.7 : 1 }}>
              {renderJournalTabs()}
            </div>
          </Card>

          {/* Journal Lines Section — only shown after BU + company code + category are set */}
          {selectedBu && derivedCompany && journalData.category ? (
          <Card
            style={{ borderRadius: 6 }}
            bodyStyle={{ padding: 0 }}
          >
            <div
              style={{
                padding: '8px 12px',
                background: REDWOOD.neutral100,
                borderBottom: `1px solid ${REDWOOD.neutral200}`,
              }}
            >
              <Space>
                <Text strong style={{ fontSize: 13 }}>
                  <span style={{ marginRight: 4 }}>&#9660;</span> Journal Lines
                </Text>
                <QuestionCircleOutlined style={{ color: REDWOOD.neutral600, cursor: 'pointer' }} />
              </Space>
            </div>

            {/* Search Row */}
            <div style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${REDWOOD.neutral200}`,
              background: '#fafafa',
            }}>
              <Input
                size="small"
                placeholder="Search by account, description..."
                prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                value={lineSearchText}
                onChange={(e) => setLineSearchText(e.target.value)}
                allowClear
                style={{ width: 300 }}
              />
              {lineSearchText && (
                <Text style={{ marginLeft: 12, fontSize: 12, color: REDWOOD.neutral600 }}>
                  Showing {filteredLines.length} of {lines.length} lines
                </Text>
              )}
            </div>

            {/* Lines Table */}
            <Table
              columns={lineColumns}
              dataSource={filteredLines}
              components={{ header: { cell: ResizableTitle } }}
              rowSelection={{
                selectedRowKeys: selectedLineKeys,
                onChange: setSelectedLineKeys,
              }}
              pagination={false}
              scroll={{ x: 1400 }}
              size="small"
              bordered
              className="compact-table"
              rowClassName={(record) => selectedLineKeys.includes(record.key) ? 'selected-row' : ''}
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 'bold' }}>
                    <Table.Summary.Cell index={0} colSpan={2}>
                      <Text strong>Total ({lines.length} lines)</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} />
                    <Table.Summary.Cell index={3} />
                    <Table.Summary.Cell index={4} align="right">
                      <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.enteredDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.enteredCr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} />
                    <Table.Summary.Cell index={7} align="right">
                      <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.accountedDr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="right">
                      <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.accountedCr)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9}>
                      {!isBalanced && <Text type="danger" style={{ fontSize: 11 }}>Unbalanced</Text>}
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />

            {/* Lines Toolbar — below the table */}
            <div style={{
              padding: '6px 12px',
              borderTop: `1px solid ${REDWOOD.neutral200}`,
              display: 'flex',
              alignItems: 'center',
              background: REDWOOD.surface,
            }}>
              <Space size="small">
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={handleAddLine}
                  type="primary"
                  style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                  disabled={isPosted || isViewMode}
                >
                  Add Row
                </Button>
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteLines}
                  disabled={isPosted || isViewMode || selectedLineKeys.length === 0}
                  danger
                >
                  Delete Row{selectedLineKeys.length > 1 ? `s (${selectedLineKeys.length})` : ''}
                </Button>
                <Tooltip title={isDetached ? 'Close Detached View' : 'Detach to Full Page'}>
                  <Button
                    size="small"
                    icon={<SplitCellsOutlined />}
                    onClick={() => setIsDetached(true)}
                    type={isDetached ? 'primary' : 'default'}
                  >
                    Detach
                  </Button>
                </Tooltip>
              </Space>
            </div>
          </Card>
          ) : (
          <Card
            style={{ borderRadius: 6, borderStyle: 'dashed', borderColor: REDWOOD.neutral300 }}
            bodyStyle={{ padding: '24px 0' }}
          >
            <div style={{ textAlign: 'center', color: REDWOOD.neutral600 }}>
              <FileTextOutlined style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }} />
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Journal Lines</div>
              <div style={{ fontSize: 12 }}>
                {!selectedBu
                  ? 'Select a Business Unit to enable journal line entry'
                  : !derivedCompany
                  ? 'The selected Business Unit has no company code — cannot add lines'
                  : 'Select a Category to enable journal line entry'}
              </div>
            </div>
          </Card>
          )}
        </div>

        <style>{`
          .compact-table .ant-table-cell { padding: 4px 8px !important; font-size: 12px; }
          .compact-table .ant-table-thead > tr > th { padding: 6px 8px !important; font-size: 11px; background: ${REDWOOD.neutral100}; }
          .compact-table .ant-input-number { font-size: 12px; }
          .compact-table .ant-input { font-size: 12px; }
          .selected-row { background-color: #e6f7ff !important; }
          .ant-dropdown-button { display: inline-flex; }
          .ant-dropdown-button > .ant-btn:first-child { background: ${REDWOOD.warning}; border-color: ${REDWOOD.warning}; }
          .ant-dropdown-button > .ant-btn:last-child { background: ${REDWOOD.warning}; border-color: ${REDWOOD.warning}; border-left-color: rgba(255,255,255,0.3); }
        `}</style>

        {/* Delete Batch Confirmation Modal */}
        {/* Attachment Preview Modal */}
        <Modal
          open={!!attPreview}
          title={attPreview?.name}
          onCancel={() => { if (attPreview) URL.revokeObjectURL(attPreview.url); setAttPreview(null); }}
          footer={
            <Button onClick={() => attPreview && handleDownloadAttachment({ uid: '', name: attPreview.name, fileType: attPreview.type, content: undefined })}
              icon={<DownloadOutlined />}>Download</Button>
          }
          width={860}
          styles={{ body: { padding: 0, maxHeight: '75vh', overflow: 'auto' } }}
        >
          {attPreview && (
            attPreview.type.startsWith('image/') ? (
              <img src={attPreview.url} alt={attPreview.name} style={{ width: '100%' }} />
            ) : attPreview.type === 'application/pdf' ? (
              <iframe src={attPreview.url} title={attPreview.name} style={{ width: '100%', height: '70vh', border: 'none' }} />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: REDWOOD.neutral500 }}>
                Preview not available for this file type. Use Download to view it.
              </div>
            )
          )}
          {attPreviewLoading && <Spin style={{ display: 'block', margin: '40px auto' }} />}
        </Modal>

        <Modal
          title={<Space><DeleteOutlined style={{ color: REDWOOD.primary }} /><span>Delete Journal Batch</span></Space>}
          open={deleteBatchModalVisible}
          onCancel={() => !deletingBatch && setDeleteBatchModalVisible(false)}
          footer={
            <Space>
              <Button onClick={() => setDeleteBatchModalVisible(false)} disabled={deletingBatch}>Cancel</Button>
              <Button danger type="primary" icon={<DeleteOutlined />} onClick={handleDeleteBatch} loading={deletingBatch}>
                {savedBatchId ? 'Delete from Database' : 'Clear Batch'}
              </Button>
            </Space>
          }
          width={480}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '10px 14px' }}>
              <Text strong style={{ color: '#cf1322' }}>
                {savedBatchId
                  ? `This batch was saved to the database (ID: ${savedBatchId}). It will be permanently deleted including all journal headers and lines.`
                  : 'This batch has not been saved yet. All entries will be cleared from the form.'}
              </Text>
            </div>
            <div>
              <Text>Batch: <Text strong>{batchData.batchName}</Text></Text>
            </div>
            {savedBatchId && (
              <div style={{ background: '#f5f5f5', borderRadius: 4, padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                <Tag color="red" style={{ fontFamily: 'monospace', fontSize: 11 }}>DELETE</Tag>
                {` ${APEX_DB_CONFIG.baseUrl}/gl/journals/batches/${savedBatchId}`}
              </div>
            )}
          </div>
        </Modal>

        {/* Account Selector Modal */}
        <AccountSelector
          visible={accountSelectorVisible}
          onCancel={() => {
            setAccountSelectorVisible(false);
            setEditingLineKey(null);
            setAccountSelectorInitialValue(undefined);
          }}
          onSelect={(accountCode, segments) => {
            handleAccountSelect(accountCode, segments);
            setAccountSelectorInitialValue(undefined);
          }}
          initialValue={accountSelectorInitialValue ?? (editingLineKey ? lines.find(l => l.key === editingLineKey)?.account : undefined)}
          lockedFirstSegment={derivedCompany || undefined}
        />

        {/* Detached Journal Lines Modal */}
        <Modal
          title={
            <Space>
              <span>Journal Lines - {batchData.batchName}</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                ({lines.length} lines | Dr: {formatNumber(lineTotals.enteredDr)} | Cr: {formatNumber(lineTotals.enteredCr)})
              </Text>
            </Space>
          }
          open={isDetached}
          zIndex={1500}
          onCancel={() => setIsDetached(false)}
          width="95vw"
          style={{ top: 20 }}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Button icon={<PlusOutlined />} onClick={handleAddLine} disabled={isViewMode || isPosted}>Add Line</Button>
                <Button
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteLines}
                  disabled={isViewMode || isPosted || selectedLineKeys.length === 0}
                  danger
                >
                  Delete Selected
                </Button>
              </Space>
              <Space>
                <Text style={{ marginRight: 16 }}>
                  Total: Dr <Text strong>{formatNumber(lineTotals.enteredDr)}</Text> | Cr <Text strong>{formatNumber(lineTotals.enteredCr)}</Text>
                  {!isBalanced && <Text type="danger" style={{ marginLeft: 8 }}>(Unbalanced)</Text>}
                </Text>
                <Button onClick={() => setIsDetached(false)}>Close</Button>
              </Space>
            </div>
          }
          styles={{
            body: { padding: 0, maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }
          }}
        >
          {/* Search in detached view */}
          <div style={{
            padding: '8px 16px',
            borderBottom: `1px solid ${REDWOOD.neutral200}`,
            background: '#fafafa',
          }}>
            <Input
              size="small"
              placeholder="Search by account, description..."
              prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
              value={lineSearchText}
              onChange={(e) => setLineSearchText(e.target.value)}
              allowClear
              style={{ width: 300 }}
            />
            {lineSearchText && (
              <Text style={{ marginLeft: 12, fontSize: 12, color: REDWOOD.neutral600 }}>
                Showing {filteredLines.length} of {lines.length} lines
              </Text>
            )}
          </div>

          {/* Table in detached view */}
          <Table
            columns={lineColumns}
            dataSource={filteredLines}
            rowSelection={{
              selectedRowKeys: selectedLineKeys,
              onChange: setSelectedLineKeys,
            }}
            pagination={false}
            scroll={{ x: 1400, y: 'calc(100vh - 350px)' }}
            size="small"
            bordered
            className="compact-table"
            rowClassName={(record) => selectedLineKeys.includes(record.key) ? 'selected-row' : ''}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: REDWOOD.neutral100, fontWeight: 'bold' }}>
                  <Table.Summary.Cell index={0} colSpan={2}>
                    <Text strong>Total ({lines.length} lines)</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} />
                  <Table.Summary.Cell index={3} />
                  <Table.Summary.Cell index={4} align="right">
                    <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.enteredDr)}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.enteredCr)}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} />
                  <Table.Summary.Cell index={7} align="right">
                    <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.accountedDr)}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={8} align="right">
                    <Text strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.accountedCr)}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={9}>
                    {!isBalanced && <Text type="danger" style={{ fontSize: 11 }}>Unbalanced</Text>}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </Modal>

        {/* PDF Preview Modal */}
        <Modal
          title={
            <Space>
              <FilePdfOutlined style={{ color: REDWOOD.primary }} />
              <span>Journal Report Preview</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {pdfFileName}
              </Text>
            </Space>
          }
          open={pdfPreviewVisible}
          onCancel={handleClosePdfPreview}
          width="90vw"
          style={{ top: 20 }}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Preview generated on {dayjs().format('DD-MMM-YYYY HH:mm:ss')}
              </Text>
              <Space>
                <Button onClick={handleClosePdfPreview}>
                  Close
                </Button>
                <Button
                  type="primary"
                  icon={<FilePdfOutlined />}
                  onClick={handleDownloadPDF}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                >
                  Download PDF
                </Button>
              </Space>
            </div>
          }
          styles={{
            body: { padding: 0, height: 'calc(100vh - 200px)', overflow: 'hidden' }
          }}
        >
          {pdfDataUrl && (
            <iframe
              src={pdfDataUrl}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              title="PDF Preview"
            />
          )}
        </Modal>

        {/* JSON Preview Modal - Save Confirmation */}
        <Modal
          title={
            <Space>
              {saveResponse ? (
                saveResponse.error ? (
                  <CloseOutlined style={{ color: REDWOOD.primary }} />
                ) : (
                  <SaveOutlined style={{ color: REDWOOD.success }} />
                )
              ) : (
                <FileTextOutlined style={{ color: REDWOOD.info }} />
              )}
              <span>
                {saveResponse
                  ? saveResponse.error
                    ? 'Save Failed'
                    : savedBatchId ? 'Journal Updated Successfully' : 'Journal Saved Successfully'
                  : savedBatchId
                    ? `Review Update — Batch #${savedBatchId} (PUT)`
                    : 'Review Journal Data Before Saving'}
              </span>
            </Space>
          }
          open={jsonPreviewVisible}
          onCancel={handleCloseJsonModal}
          width="80vw"
          style={{ top: 20 }}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space direction="vertical" size={2} style={{ alignItems: 'flex-start' }}>
                <Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Batch: {jsonPayload?.batch?.batchName} | Lines: {jsonPayload?.lines?.length || 0}
                  </Text>
                  {!isBalanced && !saveResponse && (
                    <Text type="danger" style={{ fontSize: 12 }}>
                      (Unbalanced)
                    </Text>
                  )}
                </Space>
                <Tooltip
                  title={savedBatchId
                    ? `PUT ${APEX_DB_CONFIG.baseUrl}/journals/update/${savedBatchId}`
                    : `POST ${SAVE_ENDPOINT}`}
                  placement="topLeft"
                >
                  <Space size={4} style={{ cursor: 'pointer' }} onClick={copyEndpoint}>
                    <ApiOutlined style={{ fontSize: 11, color: savedBatchId ? REDWOOD.warning : '#0572CE' }} />
                    <Text style={{ fontSize: 11, color: savedBatchId ? REDWOOD.warning : '#0572CE', fontFamily: 'monospace' }}>
                      {savedBatchId
                        ? `PUT …/journals/update/${savedBatchId}`
                        : `POST ${SAVE_ENDPOINT}`}
                    </Text>
                    {copiedEndpoint
                      ? <CheckOutlined style={{ fontSize: 11, color: '#1D7B4D' }} />
                      : <CopyOutlined  style={{ fontSize: 11, color: '#6B6B6B' }} />}
                  </Space>
                </Tooltip>
              </Space>
              <Space>
                {saveResponse ? (
                  <Button type="primary" onClick={handleCloseJsonModal}>
                    Close
                  </Button>
                ) : (
                  <>
                    <Button onClick={handleCloseJsonModal}>
                      Cancel
                    </Button>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={handleConfirmSave}
                      loading={postingJournal}
                      style={{ background: savedBatchId ? REDWOOD.warning : REDWOOD.success, borderColor: savedBatchId ? REDWOOD.warning : REDWOOD.success }}
                    >
                      {savedBatchId ? `Confirm & Update (Batch #${savedBatchId})` : 'Confirm & Save'}
                    </Button>
                  </>
                )}
              </Space>
            </div>
          }
          styles={{
            body: { padding: 16, maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }
          }}
        >
          {jsonPayload && (
            <div>
              {/* API Response Section - Show after save */}
              {saveResponse && (
                <div style={{
                  marginBottom: 16,
                  padding: 16,
                  background: saveResponse._ok === false || saveResponse.error ? '#fff2f0' : '#f6ffed',
                  border: `1px solid ${saveResponse._ok === false || saveResponse.error ? REDWOOD.primary : REDWOOD.success}`,
                  borderRadius: 6
                }}>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space>
                      <Tag color={saveResponse._ok === false || saveResponse.error ? 'error' : 'success'} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        HTTP {saveResponse._status || '—'}
                      </Tag>
                      <Tag color={saveResponse._method === 'PUT' ? 'gold' : 'blue'} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {saveResponse._method || 'POST'}
                      </Tag>
                      <Text copyable style={{ fontFamily: 'monospace', fontSize: 11 }}>{saveResponse._url || SAVE_ENDPOINT}</Text>
                    </Space>
                    <Text strong style={{ fontSize: 13, color: saveResponse._ok === false || saveResponse.error ? REDWOOD.primary : REDWOOD.success }}>
                      {saveResponse._ok === false || saveResponse.error ? 'Error Response:' : 'API Response (Success):'}
                    </Text>
                  </Space>
                  <pre
                    style={{
                      marginTop: 8,
                      background: '#fff',
                      padding: 12,
                      borderRadius: 4,
                      fontSize: 12,
                      lineHeight: 1.5,
                      overflow: 'auto',
                      maxHeight: 300,
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                      color: REDWOOD.neutral900,
                    }}
                  >
                    {JSON.stringify(saveResponse, null, 2)}
                  </pre>
                </div>
              )}

              {/* Summary Section */}
              <div style={{ marginBottom: 16, padding: 12, background: REDWOOD.neutral100, borderRadius: 6 }}>
                <Row gutter={[16, 8]}>
                  <Col span={8}>
                    <Text strong>Batch Name:</Text> {jsonPayload.batch.batchName}
                  </Col>
                  <Col span={8}>
                    <Text strong>Ledger:</Text> {jsonPayload.batch.ledgerName}
                  </Col>
                  <Col span={8}>
                    <Text strong>Period:</Text> {jsonPayload.batch.accountingPeriod}
                  </Col>
                  <Col span={8}>
                    <Text strong>Journal:</Text> {jsonPayload.header.journalName}
                  </Col>
                  <Col span={8}>
                    <Text strong>Category:</Text> {jsonPayload.header.jeCategory}
                  </Col>
                  <Col span={8}>
                    <Text strong>Currency:</Text> {jsonPayload.header.currencyCode}
                  </Col>
                  <Col span={8}>
                    <Text strong>Total Debit:</Text> <Text style={{ color: REDWOOD.success }}>{formatNumber(jsonPayload.header.runningTotalDr)}</Text>
                  </Col>
                  <Col span={8}>
                    <Text strong>Total Credit:</Text> <Text style={{ color: REDWOOD.info }}>{formatNumber(jsonPayload.header.runningTotalCr)}</Text>
                  </Col>
                  <Col span={8}>
                    <Text strong>Status:</Text> {isBalanced ? <Text style={{ color: REDWOOD.success }}>Balanced</Text> : <Text type="danger">Unbalanced</Text>}
                  </Col>
                </Row>
              </div>

              {/* JSON Code Section - collapsed by default */}
              <div style={{ marginTop: 4 }}>
                <Button
                  size="small"
                  type="text"
                  icon={showJsonPayload ? <DownOutlined /> : <RightOutlined />}
                  onClick={() => setShowJsonPayload(v => !v)}
                  style={{ color: REDWOOD.neutral500, fontSize: 12, padding: '0 4px' }}
                >
                  {showJsonPayload ? 'Hide' : 'Show'} JSON Payload
                </Button>
                {showJsonPayload && (
                  <pre
                    style={{
                      marginTop: 8,
                      background: '#1e1e1e',
                      color: '#d4d4d4',
                      padding: 16,
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: 1.5,
                      overflow: 'auto',
                      maxHeight: saveResponse ? 200 : 'calc(100vh - 480px)',
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    }}
                  >
                    {JSON.stringify(jsonPayload, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </Modal>

        {/* Validation Checklist Modal */}
        <Modal
          title={<Space><CheckSquareOutlined style={{ color: REDWOOD.info }} /><span>Pre-Posting Validation</span></Space>}
          open={validationModalVisible}
          onCancel={() => setValidationModalVisible(false)}
          width={560}
          footer={
            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button onClick={() => setValidationModalVisible(false)}>Cancel</Button>
              <Button
                type="primary"
                icon={<CheckSquareOutlined />}
                style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                disabled={getPostingChecks().some(c => !c.passed)}
                onClick={() => { setValidationModalVisible(false); setPostConfirmVisible(true); }}
              >
                All Checks Passed — Proceed to Post
              </Button>
            </Space>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
            {getPostingChecks().map((check, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '7px 12px', borderRadius: 5,
                background: check.passed ? '#f6ffed' : '#fff2f0',
                border: `1px solid ${check.passed ? '#b7eb8f' : '#ffccc7'}`,
              }}>
                <span style={{ fontSize: 16, marginTop: 1, flexShrink: 0, color: check.passed ? REDWOOD.success : REDWOOD.primary }}>
                  {check.passed ? '✓' : '✗'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: check.passed ? REDWOOD.success : REDWOOD.primary }}>
                    {check.label}
                  </div>
                  <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 1 }}>
                    {check.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Modal>

        {/* Post Confirmation Modal */}
        <Modal
          title={<Space><CheckSquareOutlined style={{ color: REDWOOD.success }} /><span>Confirm Post Journal</span></Space>}
          open={postConfirmVisible}
          onCancel={() => setPostConfirmVisible(false)}
          onOk={executePost}
          okText="Yes, Post Journal"
          cancelText="Cancel"
          okButtonProps={{ style: { background: REDWOOD.success, borderColor: REDWOOD.success }, loading: saving }}
          width={420}
        >
          <div style={{ padding: '8px 0' }}>
            <p style={{ fontSize: 14, marginBottom: 12 }}>
              You are about to <strong>post</strong> journal batch <strong>{batchData.batchName}</strong>.
            </p>
            <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 5, padding: '10px 14px', fontSize: 13 }}>
              ⚠️ Once posted, the journal will be <strong>locked for editing</strong>. This action cannot be undone.
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: REDWOOD.neutral600 }}>
              <div>Period: <strong>{batchData.accountingPeriod}</strong></div>
              <div>Total Dr: <strong style={{ color: REDWOOD.success }}>{formatNumber(lineTotals.enteredDr)}</strong>
                {' '}| Total Cr: <strong style={{ color: REDWOOD.info }}>{formatNumber(lineTotals.enteredCr)}</strong></div>
              <div>Lines: <strong>{lines.length}</strong></div>
            </div>
          </div>
        </Modal>

        {/* Line Description Edit Modal */}
        <Modal
          title={<Space><EditOutlined style={{ color: REDWOOD.info }} /><span>Edit Line Description</span></Space>}
          open={descEditKey !== null}
          onOk={() => {
            if (descEditKey) updateLine(descEditKey, 'description', descEditValue);
            setDescEditKey(null);
            setDescEditValue('');
          }}
          onCancel={() => { setDescEditKey(null); setDescEditValue(''); }}
          okText="OK"
          cancelText="Cancel"
          width={520}
          destroyOnClose
        >
          <TextArea
            autoFocus
            rows={5}
            value={descEditValue}
            onChange={(e) => setDescEditValue(e.target.value)}
            placeholder="Enter line description..."
            maxLength={4000}
            showCount
            style={{ fontSize: 13 }}
          />
        </Modal>

        {/* Account Balance Inquiry Modal */}
        <Modal
          title={
            <Space>
              <BarChartOutlined style={{ color: REDWOOD.success }} />
              <span>Account Balances</span>
            </Space>
          }
          open={acctBalModal.visible}
          onCancel={() => setAcctBalModal(prev => ({ ...prev, visible: false }))}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tooltip title="Show API call details">
                <Button
                  size="small"
                  icon={<CodeOutlined />}
                  onClick={() => setAcctBalModal(prev => ({ ...prev, showApi: !prev.showApi }))}
                  type={acctBalModal.showApi ? 'primary' : 'default'}
                >
                  API
                </Button>
              </Tooltip>
              <Button onClick={() => setAcctBalModal(prev => ({ ...prev, visible: false }))}>Close</Button>
            </div>
          }
          width={560}
        >
          {acctBalModal.loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: REDWOOD.neutral600 }}>Loading balances…</div>
            </div>
          ) : (
            <div>
              {/* Account + period info */}
              <div style={{
                background: REDWOOD.neutral100,
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 20,
                borderLeft: `4px solid ${REDWOOD.success}`,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: REDWOOD.neutral900 }}>
                  {acctBalModal.account}
                </div>
                {acctBalModal.accountDesc && (
                  <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 2 }}>
                    {acctBalModal.accountDesc}
                  </div>
                )}
                <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginTop: 6 }}>
                  Ledger: <strong>{journalData.ledger}</strong> &nbsp;·&nbsp; Period: <strong>{acctBalModal.periodName}</strong>
                </div>
              </div>

              {/* API inspector panel */}
              {acctBalModal.showApi && (
                <div style={{
                  background: '#1e1e1e', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 11,
                  fontFamily: 'monospace', color: '#d4d4d4', overflowX: 'auto',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#9cdcfe', fontWeight: 600 }}>GET Request</span>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      style={{ fontSize: 11 }}
                      onClick={() => { navigator.clipboard.writeText(acctBalModal.apiUrl); message.success('URL copied'); }}
                    >
                      Copy
                    </Button>
                  </div>
                  <div style={{ wordBreak: 'break-all', lineHeight: 1.6 }}>
                    <span style={{ color: '#4ec9b0' }}>GET </span>
                    <span style={{ color: '#ce9178' }}>{acctBalModal.apiUrl}</span>
                  </div>
                  {acctBalModal.rawItems.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: '#9cdcfe', marginBottom: 4 }}>
                        Response: {acctBalModal.rawItems.length} item(s)
                      </div>
                      <pre style={{
                        margin: 0, fontSize: 10, color: '#d4d4d4',
                        maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap',
                      }}>
                        {JSON.stringify(acctBalModal.rawItems[0], null, 2)}
                      </pre>
                    </div>
                  )}
                  {!acctBalModal.rawItems.length && !acctBalModal.loading && (
                    <div style={{ marginTop: 8, color: '#f48771' }}>⚠ Response returned 0 items</div>
                  )}
                </div>
              )}

              {/* Balance rows */}
              {(() => {
                const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const data = acctBalModal.data;
                const netActivity = data ? data.debit - data.credit : 0;
                const rows = data ? [
                  { label: 'Opening Balance',     value: data.opening,  color: REDWOOD.neutral900, bold: false },
                  { label: 'Period Debit',         value: data.debit,    color: REDWOOD.success,    bold: false },
                  { label: 'Period Credit',        value: data.credit,   color: REDWOOD.primary,    bold: false },
                  { label: 'Net Period Activity',  value: netActivity,   color: netActivity >= 0 ? REDWOOD.success : REDWOOD.primary, bold: true },
                  { label: 'Closing Balance',      value: data.closing,  color: REDWOOD.info,       bold: true },
                ] : [];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {rows.map((row, idx) => (
                      <React.Fragment key={row.label}>
                        {idx === 3 && <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}`, margin: '6px 0' }} />}
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 12px', borderRadius: 6,
                          background: idx === 4 ? `${REDWOOD.info}10` : idx === 3 ? `${REDWOOD.neutral200}60` : 'transparent',
                        }}>
                          <Text style={{ fontSize: 13, color: REDWOOD.neutral700, fontWeight: row.bold ? 600 : 400 }}>
                            {row.label}
                          </Text>
                          <Text style={{ fontSize: 14, color: row.color, fontWeight: row.bold ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(row.value)}
                            <span style={{ fontSize: 11, marginLeft: 4, color: REDWOOD.neutral600 }}>
                              {acctBalModal.data?.currency || 'AED'}
                            </span>
                          </Text>
                        </div>
                      </React.Fragment>
                    ))}
                    {!data && (
                      <div style={{ textAlign: 'center', padding: '24px 0', color: REDWOOD.neutral600 }}>
                        No balance data found for this account and period.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </Modal>

        {/* ── BMS Rate API Inspector Modal ── */}
        <Modal
          open={bmsRateApiModal}
          onCancel={() => setBmsRateApiModal(false)}
          footer={<Button onClick={() => setBmsRateApiModal(false)}>Close</Button>}
          width={700}
          title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><Text strong>Conversion Rate — API Inspector</Text></Space>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: '12px 14px', background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Tag color="blue" style={{ fontWeight: 700 }}>GET</Tag>
                <Text strong style={{ fontSize: 13 }}>Fetch Daily Exchange Rate (BMS Rate)</Text>
                <Button size="small" type="text" icon={<CopyOutlined />} style={{ marginLeft: 'auto', color: REDWOOD.info }}
                  onClick={() => { navigator.clipboard.writeText(lastBmsRateUrl || ''); message.success('URL copied'); }} />
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: REDWOOD.info, wordBreak: 'break-all',
                padding: '6px 10px', background: '#f0f5ff', borderRadius: 5, marginBottom: 8 }}>
                {lastBmsRateUrl || `${APEX_DB_CONFIG.baseUrl}/currencies/bmsrate?source_cur=${journalData.currency}&target_cur=AED&rate_date=YYYY-MM-DD`}
              </div>
              <div style={{ fontSize: 11, color: REDWOOD.neutral600, marginBottom: 6 }}>
                <Text strong>Parameters:</Text>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  <li><code>source_cur</code> — source currency (e.g. {journalData.currency || 'USD'})</li>
                  <li><code>target_cur</code> — always AED (functional currency)</li>
                  <li><code>rate_date</code> — conversion date in YYYY-MM-DD format</li>
                </ul>
              </div>
              <div style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
                <Text strong>Current values:</Text>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  <li>Currency: <strong>{journalData.currency || '—'}</strong></li>
                  <li>Conversion Date: <strong>{journalData.conversionDate || '—'}</strong></li>
                  <li>Rate Type: <strong>{journalData.conversionRateType || '—'}</strong></li>
                  <li>Rate fetched: <strong>{bmsRate ? `${bmsRate.rate} (${bmsRate.rateType}, ${bmsRate.rateDate})` : bmsRateLoading ? 'Loading…' : 'Not found'}</strong></li>
                </ul>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Button icon={<ReloadOutlined />} loading={bmsRateLoading}
                type="primary" size="small"
                onClick={() => { fetchBmsRate(journalData.currency, journalData.conversionDate, true); setBmsRateApiModal(false); }}>
                Refresh Rate Now
              </Button>
            </div>
          </div>
        </Modal>
      </Content>
    </Layout>
  );
};

export default CreateJournal;
