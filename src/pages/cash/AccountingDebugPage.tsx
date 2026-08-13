import { buildApexUrl } from '../config/api.helper';
/**
 * AccountingDebugPage
 * Full-page API tester for the bank-transfer accounting flow.
 * No modal — everything fully expanded, scrollable.
 * Route: /cash/bank-transfers/debug
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Layout, Breadcrumb, Typography, Select, Button, Tag, Space, Input, Spin, Row, Col, Divider, Alert,
} from 'antd';
import { HomeOutlined, ApiOutlined, BankOutlined, ReloadOutlined, LinkOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { derivePeriodName } from '../../services/sla.service';
import { useAuth } from '../../context/AuthContext';

const { Content } = Layout;
const { Title, Text } = Typography;

const APEX_BASE = buildApexUrl('');

// ── Palette ──────────────────────────────────────────────────────────────────
const RED = '#C74634';
const INFO = '#0572CE';

const METHOD_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  GET:    { bg: '#e8f5e9', text: '#2e7d32', border: '#81c784' },
  POST:   { bg: '#fff3e0', text: '#e65100', border: '#ffb74d' },
  PUT:    { bg: '#ede7f6', text: '#4527a0', border: '#9575cd' },
  DELETE: { bg: '#fce4ec', text: '#b71c1c', border: '#ef9a9a' },
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface TransferRecord {
  bankAccountTransferId: number;
  bankAccountTransferNumber: number;
  transactionDate: string;
  fromBankAccountName: string;
  toBankAccountName: string;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  paymentCurrencyCode: string;
  paymentAmount: number;
  fromAmount: number;
  conversionRate: number;
  funcConversionRate?: number;
  businessUnit: string;
  cashClearingAccount?: string;
}

interface ApiStep {
  key: string;
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  payload?: string;
  description?: string;
}

interface StepResult {
  loading: boolean;
  status?: number;
  body?: string;
  error?: string;
}

// ── Main page ─────────────────────────────────────────────────────────────────
const AccountingDebugPage: React.FC = () => {
  const { user } = useAuth();
  const currentUser = user?.email ?? user?.username ?? 'SYSTEM';
  const navigate = useNavigate();

  // LOVs
  const [bankAccountAssetMap, setBankAccountAssetMap] = useState<Record<string, string>>({});
  const [bankCurrencyMap,     setBankCurrencyMap]     = useState<Record<string, string>>({});
  const [lovsLoading, setLovsLoading]   = useState(true);

  // Transfer search
  const [searchDays,    setSearchDays]    = useState(90);
  const [transfers,     setTransfers]     = useState<TransferRecord[]>([]);
  const [txnLoading,    setTxnLoading]    = useState(false);

  // Selected transfer
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ledger, setLedger]         = useState<{ ledgerId: number; ledgerName: string; currency: string } | null>(null);
  const [batchIds,  setBatchIds]    = useState<{ disburse: number | null; receipt: number | null }>({ disburse: null, receipt: null });
  const [slaIds,    setSlaIds]      = useState<{ disburse: number | null; receipt: number | null }>({ disburse: null, receipt: null });
  const [headerIds, setHeaderIds]   = useState<{ disburse: number | null; receipt: number | null }>({ disburse: null, receipt: null });

  // Per-step state
  const [payloads, setPayloads] = useState<Record<string, string>>({});
  const [results,  setResults]  = useState<Record<string, StepResult>>({});

  const txn = useMemo(() => transfers.find(t => t.bankAccountTransferId === selectedId) ?? null, [transfers, selectedId]);

  // ── Load LOVs ──────────────────────────────────────────────────────────────
  const loadLovs = useCallback(async () => {
    setLovsLoading(true);
    const assetMap: Record<string, string> = {};
    const ccyMap:   Record<string, string> = {};
    try {
      const res  = await fetch(`${APEX_BASE}/banks/bankaccounts`);
      const data = await res.json();
      (data.items ?? []).forEach((i: any) => {
        const acct = i.bank_account_name ?? i.bankAccountName;
        const ccy  = i.currency_code ?? i.currencyCode;
        const cash = i.cash_account_combination ?? i.cashAccountCombination;
        if (acct) {
          if (ccy)  ccyMap[acct]   = ccy;
          if (cash) assetMap[acct] = cash;
        }
      });
    } catch {}
    setBankAccountAssetMap(assetMap);
    setBankCurrencyMap(ccyMap);
    setLovsLoading(false);
  }, []);

  useEffect(() => { loadLovs(); }, [loadLovs]);

  // ── Load transfers ─────────────────────────────────────────────────────────
  const loadTransfers = useCallback(async () => {
    setTxnLoading(true);
    try {
      const dateTo   = dayjs().format('YYYY-MM-DD');
      const dateFrom = dayjs().subtract(searchDays, 'day').format('YYYY-MM-DD');
      const url = `${APEX_BASE}/cash/banktransfers?date_from=${dateFrom}&date_to=${dateTo}&row_limit=500`;
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const items = (data.items ?? []).map((r: any) => ({
        bankAccountTransferId:     r.bankAccountTransferId     ?? r.bank_account_transfer_id,
        bankAccountTransferNumber: r.bankAccountTransferNumber ?? r.bank_account_transfer_number,
        transactionDate:           r.transactionDate           ?? r.transaction_date,
        fromBankAccountName:       r.fromBankAccountName       ?? r.from_bank_account_name ?? '',
        toBankAccountName:         r.toBankAccountName         ?? r.to_bank_account_name   ?? '',
        fromCurrencyCode:          r.fromCurrencyCode          ?? r.from_currency_code      ?? '',
        toCurrencyCode:            r.toCurrencyCode            ?? r.to_currency_code        ?? '',
        paymentCurrencyCode:       r.paymentCurrencyCode       ?? r.payment_currency_code   ?? '',
        paymentAmount:             Number(r.paymentAmount      ?? r.payment_amount          ?? 0),
        fromAmount:                Number(r.fromAmount         ?? r.from_amount             ?? 0),
        conversionRate:            Number(r.conversionRate     ?? r.conversion_rate         ?? 1),
        funcConversionRate:        Number(r.funcConversionRate ?? r.func_conversion_rate    ?? 1),
        businessUnit:              r.businessUnit              ?? r.business_unit           ?? '',
        cashClearingAccount:       r.cashClearingAccount       ?? r.cash_clearing_account   ?? '',
      }));
      setTransfers(items);
    } catch (e) {
      console.error('loadTransfers failed:', e);
    }
    setTxnLoading(false);
  }, [searchDays]);

  useEffect(() => { loadTransfers(); }, [loadTransfers]);

  // ── Derived amounts ────────────────────────────────────────────────────────
  const d = useMemo(() => {
    if (!txn) return null;
    const pmtAmt       = Math.abs(txn.paymentAmount ?? 0);
    const rate         = txn.conversionRate || 1;
    const funcConvRate = txn.funcConversionRate || rate;
    const j1currency   = txn.fromCurrencyCode || bankCurrencyMap[txn.fromBankAccountName] || 'AED';
    const j2currency   = txn.toCurrencyCode   || bankCurrencyMap[txn.toBankAccountName]   || 'AED';
    const isCross      = j1currency !== j2currency;
    const fromAmt      = isCross ? (txn.fromAmount ? Math.abs(txn.fromAmount) : Math.round(pmtAmt * rate * 100) / 100) : pmtAmt;
    const aedValue     = j1currency === 'AED' ? fromAmt : j2currency === 'AED' ? pmtAmt : Math.round(pmtAmt * funcConvRate * 100) / 100;
    const j1Rate       = j1currency === 'AED' ? 1 : fromAmt > 0 ? Math.round(aedValue / fromAmt * 1e6) / 1e6 : 1;
    const j2Rate       = j2currency === 'AED' ? 1 : pmtAmt  > 0 ? Math.round(aedValue / pmtAmt  * 1e6) / 1e6 : 1;
    const clearingAcct = txn.cashClearingAccount || '';
    const fromAsset    = bankAccountAssetMap[txn.fromBankAccountName] || '';
    const toAsset      = bankAccountAssetMap[txn.toBankAccountName]   || '';
    const txnDate      = txn.transactionDate ? txn.transactionDate.split('T')[0] : new Date().toISOString().split('T')[0];
    const periodName   = derivePeriodName(new Date(txn.transactionDate || Date.now()));
    return { pmtAmt, j1currency, j2currency, fromAmt, aedValue, j1Rate, j2Rate, clearingAcct, fromAsset, toAsset, txnDate, periodName };
  }, [txn, bankAccountAssetMap, bankCurrencyMap]);

  // ── Build steps ────────────────────────────────────────────────────────────
  const steps: ApiStep[] = useMemo(() => {
    if (!txn || !d) return [];
    const { pmtAmt, j1currency, j2currency, fromAmt, aedValue, j1Rate, j2Rate, clearingAcct, fromAsset, toAsset, txnDate, periodName } = d;
    const ledgerId   = ledger?.ledgerId   ?? 0;
    const ledgerName = ledger?.ledgerName ?? '(run Step 3 to get ledger)';
    const ledgerCcy  = ledger?.currency   ?? 'AED';
    const id  = txn.bankAccountTransferId;
    const num = txn.bankAccountTransferNumber;
    const bu  = txn.businessUnit || '';

    const commonHdr = { moduleName: 'CM', sourceTable: 'BANK_ACCOUNT_TRANSFERS', sourceId: id, sourceNumber: String(num), sourceType: 'Bank Transfer', ledgerId, ledgerName, ledgerCurrency: ledgerCcy, exchangeRateType: 'Corporate', businessUnit: bu, createdBy: currentUser };

    const slaDisbPayload = {
      header: { ...commonHdr, eventTypeCode: 'BANK_TRANSFER_DISBURSE', eventDate: txnDate, accountingDate: txnDate, periodName, currencyCode: j1currency, exchangeRate: j1Rate, description: `Bank Transfer ${num} — Disbursement` },
      lines: [
        { lineNumber: 1, lineType: 'DR', accountingClass: 'CASH_CLEARING', accountCombination: clearingAcct, enteredDr: fromAmt, enteredCr: 0, accountedDr: aedValue, accountedCr: 0, currencyCode: j1currency, exchangeRate: j1Rate, description: `Cash Clearing DR – ${txn.fromBankAccountName}` },
        { lineNumber: 2, lineType: 'CR', accountingClass: 'BANK_ASSET',    accountCombination: fromAsset,    enteredDr: 0, enteredCr: fromAmt, accountedDr: 0, accountedCr: aedValue, currencyCode: j1currency, exchangeRate: j1Rate, description: `From Bank CR – ${txn.fromBankAccountName}` },
      ],
    };
    const slaRcptPayload = {
      header: { ...commonHdr, eventTypeCode: 'BANK_TRANSFER_RECEIPT', eventDate: txnDate, accountingDate: txnDate, periodName, currencyCode: j2currency, exchangeRate: j2Rate, description: `Bank Transfer ${num} — Receipt` },
      lines: [
        { lineNumber: 1, lineType: 'DR', accountingClass: 'BANK_ASSET',    accountCombination: toAsset,      enteredDr: pmtAmt, enteredCr: 0, accountedDr: aedValue, accountedCr: 0, currencyCode: j2currency, exchangeRate: j2Rate, description: `To Bank DR – ${txn.toBankAccountName}` },
        { lineNumber: 2, lineType: 'CR', accountingClass: 'CASH_CLEARING', accountCombination: clearingAcct, enteredDr: 0, enteredCr: pmtAmt, accountedDr: 0, accountedCr: aedValue, currencyCode: j2currency, exchangeRate: j2Rate, description: `Cash Clearing CR – ${txn.toBankAccountName}` },
      ],
    };
    const lb = (ref5: string, ccy: string, rate: number) => ({ statAmount: null, currencyConversionDate: txnDate, currencyConversionRate: rate, userCurrencyConversionType: 'Corporate', chartOfAccountsName: 'Chart of Accounts', reference1: String(id), reference2: String(num), reference4: bu, reference5: ref5, createdBy: currentUser, currencyCode: ccy });
    const cb = { ledgerName, ledgerId, status: 'NEW', accountingPeriod: periodName, batchSource: 'Cash Management', createdBy: currentUser };
    const ch = { ledgerId, ledgerName, jeCategory: 'Cash Management', jeSource: 'Cash Management', periodName, status: 'NEW', currencyConversionType: 'Corporate', currencyConversionDate: txnDate, defaultEffectiveDate: txnDate, createdBy: currentUser };

    const glDisbPayload = {
      batch:  { ...cb, batchName: `BANKTFR-${num}-DISBURSE`, batchDescription: `Bank Transfer ${num} — Disbursement`, controlTotal: aedValue, runningTotalDr: aedValue, runningTotalCr: aedValue },
      header: { ...ch, journalName: `BANKTFR-${num}-DISBURSE`, description: `Bank Transfer ${num} — Disbursement`, currencyCode: j1currency, currencyConversionRate: j1Rate, runningTotalDr: aedValue, runningTotalCr: aedValue },
      lines: [
        { ...lb('BANKTFR-DISBURSE', j1currency, j1Rate), accountCombination: clearingAcct, enteredDr: fromAmt, enteredCr: null, accountedDr: aedValue, accountedCr: null, description: `Cash Clearing DR – ${txn.fromBankAccountName}`, accountingClass: 'CASH_CLEARING', reference3: 'CASH_CLEARING' },
        { ...lb('BANKTFR-DISBURSE', j1currency, j1Rate), accountCombination: fromAsset,    enteredDr: null, enteredCr: fromAmt, accountedDr: null, accountedCr: aedValue, description: `From Bank CR – ${txn.fromBankAccountName}`,    accountingClass: 'BANK_ASSET', reference3: 'BANK_ASSET', reference7: txn.fromBankAccountName },
      ],
    };
    const glRcptPayload = {
      batch:  { ...cb, batchName: `BANKTFR-${num}-RECEIPT`, batchDescription: `Bank Transfer ${num} — Receipt`, controlTotal: aedValue, runningTotalDr: aedValue, runningTotalCr: aedValue },
      header: { ...ch, journalName: `BANKTFR-${num}-RECEIPT`, description: `Bank Transfer ${num} — Receipt`, currencyCode: j2currency, currencyConversionRate: j2Rate, runningTotalDr: aedValue, runningTotalCr: aedValue },
      lines: [
        { ...lb('BANKTFR-RECEIPT', j2currency, j2Rate), accountCombination: toAsset,      enteredDr: pmtAmt, enteredCr: null, accountedDr: aedValue, accountedCr: null, description: `To Bank DR – ${txn.toBankAccountName}`,         accountingClass: 'BANK_ASSET', reference3: 'BANK_ASSET', reference7: txn.toBankAccountName },
        { ...lb('BANKTFR-RECEIPT', j2currency, j2Rate), accountCombination: clearingAcct, enteredDr: null, enteredCr: pmtAmt, accountedDr: null, accountedCr: aedValue, description: `Cash Clearing CR – ${txn.toBankAccountName}`, accountingClass: 'CASH_CLEARING', reference3: 'CASH_CLEARING' },
      ],
    };

    const dBatch = batchIds.disburse;
    const rBatch = batchIds.receipt;
    const dSla   = slaIds.disburse;
    const rSla   = slaIds.receipt;
    const dHdr   = headerIds.disburse;
    const rHdr   = headerIds.receipt;

    return [
      { key: 'sla_exists_d', label: 'Check SLA Exists — DISBURSE',                          method: 'GET',  url: `${APEX_BASE}/sla/accounting/exists?sourceTable=BANK_ACCOUNT_TRANSFERS&sourceId=${id}&eventType=BANK_TRANSFER_DISBURSE`,  description: 'Check if SLA accounting already exists for the disbursement event.' },
      { key: 'sla_exists_r', label: 'Check SLA Exists — RECEIPT',                           method: 'GET',  url: `${APEX_BASE}/sla/accounting/exists?sourceTable=BANK_ACCOUNT_TRANSFERS&sourceId=${id}&eventType=BANK_TRANSFER_RECEIPT`,   description: 'Check if SLA accounting already exists for the receipt event.' },
      { key: 'ledger',       label: 'Fetch Ledger — Business Unit',                          method: 'GET',  url: `${APEX_BASE}/gl/getledgername?P_BUSINESS_UNIT_NAME=${encodeURIComponent(bu)}`,                                           description: 'Resolve the GL ledger for this business unit. Ledger ID is required for all journal entries.' },
      { key: 'gl_check_d',   label: 'Check GL Journal — DISBURSE',                           method: 'GET',  url: `${APEX_BASE}/gl/journals/check?reference1=${id}&reference2=${num}&reference5=BANKTFR-DISBURSE`,                          description: 'Check if a GL journal batch already exists (idempotency guard).' },
      { key: 'gl_check_r',   label: 'Check GL Journal — RECEIPT',                            method: 'GET',  url: `${APEX_BASE}/gl/journals/check?reference1=${id}&reference2=${num}&reference5=BANKTFR-RECEIPT`,                           description: 'Check if a GL journal batch already exists (idempotency guard).' },
      { key: 'sla_create_d', label: 'Create SLA Accounting — DISBURSE',                     method: 'POST', url: `${APEX_BASE}/sla/accounting/create`,  payload: JSON.stringify(slaDisbPayload, null, 2), description: 'Create SLA subledger accounting header + lines for the disbursement. Returns headerId.' },
      { key: 'sla_create_r', label: 'Create SLA Accounting — RECEIPT',                      method: 'POST', url: `${APEX_BASE}/sla/accounting/create`,  payload: JSON.stringify(slaRcptPayload, null, 2), description: 'Create SLA subledger accounting header + lines for the receipt. Returns headerId.' },
      { key: 'gl_create_d',  label: 'Create GL Journal — DISBURSE',                          method: 'POST', url: `${APEX_BASE}/journals/create`,         payload: JSON.stringify(glDisbPayload,  null, 2), description: 'Create GL journal batch + header + lines for disbursement. Returns jeBatchId + jeHeaderId.' },
      { key: 'gl_create_r',  label: 'Create GL Journal — RECEIPT',                           method: 'POST', url: `${APEX_BASE}/journals/create`,         payload: JSON.stringify(glRcptPayload,  null, 2), description: 'Create GL journal batch + header + lines for receipt. Returns jeBatchId + jeHeaderId.' },
      { key: 'gl_post_d',    label: `Post GL Batch — DISBURSE${dBatch ? ` (ID: ${dBatch})` : ' ⚠ run Step 8 first'}`, method: 'PUT',  url: `${APEX_BASE}/gl/journals/${dBatch ?? 'BATCH_ID'}/post`, payload: '{}', description: 'Post the GL batch from NEW → POSTED status.' },
      { key: 'gl_post_r',    label: `Post GL Batch — RECEIPT${rBatch  ? ` (ID: ${rBatch})`  : ' ⚠ run Step 9 first'}`, method: 'PUT',  url: `${APEX_BASE}/gl/journals/${rBatch  ?? 'BATCH_ID'}/post`, payload: '{}', description: 'Post the GL batch from NEW → POSTED status.' },
      { key: 'sla_post_d',   label: `Stamp SLA Posted — DISBURSE${dSla ? ` (headerId: ${dSla})` : ' ⚠ run Step 6 first'}`, method: 'POST', url: `${APEX_BASE}/sla/accounting/post`, payload: JSON.stringify({ headerId: dSla ?? 0, glBatchId: dBatch ?? 0, glBatchName: `BANKTFR-${num}-DISBURSE`, glHeaderId: dHdr ?? 0, postedBy: currentUser }, null, 2), description: 'Stamp the SLA header with GL references and mark as POSTED.' },
      { key: 'sla_post_r',   label: `Stamp SLA Posted — RECEIPT${rSla  ? ` (headerId: ${rSla})`  : ' ⚠ run Step 7 first'}`, method: 'POST', url: `${APEX_BASE}/sla/accounting/post`, payload: JSON.stringify({ headerId: rSla  ?? 0, glBatchId: rBatch  ?? 0, glBatchName: `BANKTFR-${num}-RECEIPT`,  glHeaderId: rHdr  ?? 0, postedBy: currentUser }, null, 2), description: 'Stamp the SLA header with GL references and mark as POSTED.' },
      { key: 'acct_flag',    label: 'Update Accounting Flag (Y)',                             method: 'PUT',  url: `${APEX_BASE}/cash/banktransfers/${id}/acctflag?updated_by=${encodeURIComponent(currentUser)}`, payload: '{}', description: 'Mark the transfer as fully accounted (accountingFlag = Y).' },
    ] as ApiStep[];
  }, [txn, d, ledger, batchIds, slaIds, headerIds, currentUser]);

  // Seed payloads when steps build
  const seededRef = React.useRef<string | null>(null);
  useEffect(() => {
    const key = `${selectedId}`;
    if (seededRef.current === key) return;
    seededRef.current = key;
    const init: Record<string, string> = {};
    steps.forEach(s => { if (s.payload !== undefined) init[s.key] = s.payload; });
    setPayloads(init);
  }, [steps, selectedId]);

  // Re-seed dynamic payloads when batchIds / slaIds / ledger resolve
  useEffect(() => {
    setPayloads(prev => {
      const next = { ...prev };
      steps.forEach(s => {
        if (s.payload && ['gl_post_d', 'gl_post_r', 'sla_post_d', 'sla_post_r'].includes(s.key)) {
          next[s.key] = s.payload;
        }
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchIds, slaIds, headerIds, ledger]);

  const resetForTransfer = (id: number | null) => {
    setSelectedId(id);
    setResults({});
    setLedger(null);
    setBatchIds({ disburse: null, receipt: null });
    setSlaIds({ disburse: null, receipt: null });
    setHeaderIds({ disburse: null, receipt: null });
    seededRef.current = null;
  };

  // ── Fire a step ────────────────────────────────────────────────────────────
  const testStep = async (step: ApiStep) => {
    setResults(prev => ({ ...prev, [step.key]: { loading: true } }));
    try {
      const body = payloads[step.key] ?? '{}';
      const opts: RequestInit = step.method === 'GET'
        ? { headers: { Accept: 'application/json' } }
        : { method: step.method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body };
      const res  = await fetch(step.url, opts);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      setResults(prev => ({ ...prev, [step.key]: { loading: false, status: res.status, body: pretty } }));

      if (!res.ok) return;
      try {
        const data = JSON.parse(text);
        if (step.key === 'ledger') {
          const item = data?.items?.[0];
          if (item) setLedger({ ledgerId: item.ledger_id, ledgerName: item.ledger_name, currency: item.currency_code || 'AED' });
        }
        if (step.key === 'sla_exists_d' && data.headerId) setSlaIds(p => ({ ...p, disburse: data.headerId }));
        if (step.key === 'sla_exists_r' && data.headerId) setSlaIds(p => ({ ...p, receipt:  data.headerId }));
        if (step.key === 'sla_create_d' && data.headerId) setSlaIds(p => ({ ...p, disburse: data.headerId }));
        if (step.key === 'sla_create_r' && data.headerId) setSlaIds(p => ({ ...p, receipt:  data.headerId }));
        if (step.key === 'gl_create_d') {
          const bid = data.jeBatchId ?? data.je_batch_id ?? data.batchId ?? null;
          const hid = data.jeHeaderId ?? data.je_header_id ?? data.headerId ?? null;
          if (bid) setBatchIds(p => ({ ...p, disburse: bid }));
          if (hid) setHeaderIds(p => ({ ...p, disburse: hid }));
        }
        if (step.key === 'gl_create_r') {
          const bid = data.jeBatchId ?? data.je_batch_id ?? data.batchId ?? null;
          const hid = data.jeHeaderId ?? data.je_header_id ?? data.headerId ?? null;
          if (bid) setBatchIds(p => ({ ...p, receipt: bid }));
          if (hid) setHeaderIds(p => ({ ...p, receipt: hid }));
        }
      } catch {}
    } catch (e: any) {
      setResults(prev => ({ ...prev, [step.key]: { loading: false, error: e.message } }));
    }
  };

  const testAll = async () => {
    for (const step of steps) {
      await testStep(step);
      await new Promise(r => setTimeout(r, 300));
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '12px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /></Link> },
            { title: <Link to="/cash/bank-transfers"><BankOutlined /> Bank Transfers</Link> },
            { title: <><ApiOutlined /> Accounting Debug</> },
          ]} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Page title */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <Title level={4} style={{ margin: 0, color: '#1e293b' }}>
                <ApiOutlined style={{ color: INFO, marginRight: 8 }} />
                Accounting API Tester
                <Tag color="purple" style={{ marginLeft: 10, fontSize: 11, fontWeight: 700 }}>DEBUG</Tag>
              </Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Test each REST call in the bank-transfer accounting flow individually.
              </Text>
            </div>
            <Button icon={<LinkOutlined />} onClick={() => navigate('/cash/bank-transfers')}>
              Back to Bank Transfers
            </Button>
          </div>

          {/* Transfer selector card */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '18px 24px', marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <Row gutter={[16, 12]} align="middle">
              <Col xs={24} md={3}>
                <Text strong style={{ color: '#374151', fontSize: 13 }}>Transfer:</Text>
              </Col>
              <Col xs={24} md={10}>
                {txnLoading
                  ? <Spin size="small" />
                  : <Select
                      style={{ width: '100%' }}
                      placeholder={`${transfers.length} transfers loaded — pick one to debug…`}
                      value={selectedId}
                      onChange={resetForTransfer}
                      showSearch
                      allowClear
                      optionFilterProp="label"
                      options={transfers.map(t => ({
                        value: t.bankAccountTransferId,
                        label: `#${t.bankAccountTransferNumber} — ${t.fromBankAccountName} → ${t.toBankAccountName} (${t.transactionDate?.split('T')[0] ?? '?'}) [${t.businessUnit}]`,
                      }))}
                    />
                }
              </Col>
              <Col xs={24} md={4}>
                <Space>
                  <Select
                    value={searchDays}
                    onChange={v => setSearchDays(v)}
                    style={{ width: 120 }}
                    options={[
                      { value: 7,   label: 'Last 7 days' },
                      { value: 30,  label: 'Last 30 days' },
                      { value: 90,  label: 'Last 90 days' },
                      { value: 365, label: 'Last year' },
                    ]}
                  />
                  <Button icon={<ReloadOutlined />} onClick={loadTransfers} loading={txnLoading} />
                </Space>
              </Col>
              {txn && (
                <Col xs={24} md={7}>
                  <Space size={6} wrap>
                    <Tag color="blue" style={{ fontWeight: 600 }}>{d?.j1currency} → {d?.j2currency}</Tag>
                    <Tag color="geekblue">{d?.periodName}</Tag>
                    {txn.cashClearingAccount
                      ? <Tag color="green" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>✓ Clearing: {txn.cashClearingAccount}</Tag>
                      : <Tag color="error">⚠ No clearing account</Tag>}
                    {bankAccountAssetMap[txn.fromBankAccountName]
                      ? <Tag color="green">✓ From asset</Tag>
                      : <Tag color="warning">⚠ No from asset</Tag>}
                    {bankAccountAssetMap[txn.toBankAccountName]
                      ? <Tag color="green">✓ To asset</Tag>
                      : <Tag color="warning">⚠ No to asset</Tag>}
                    {ledger
                      ? <Tag color="cyan">Ledger: {ledger.ledgerName} ({ledger.ledgerId})</Tag>
                      : <Tag>Run Step 3 → ledger</Tag>}
                  </Space>
                </Col>
              )}
            </Row>

            {txn && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button type="primary" icon={<ApiOutlined />} onClick={testAll} style={{ background: RED, borderColor: RED }}>
                  Run All Steps
                </Button>
                <Button onClick={() => setResults({})}>Clear All Results</Button>
                {batchIds.disburse && <Tag color="purple">DISBURSE batchId: {batchIds.disburse}</Tag>}
                {batchIds.receipt  && <Tag color="purple">RECEIPT batchId: {batchIds.receipt}</Tag>}
                {slaIds.disburse   && <Tag color="volcano">DISBURSE SLA headerId: {slaIds.disburse}</Tag>}
                {slaIds.receipt    && <Tag color="volcano">RECEIPT SLA headerId: {slaIds.receipt}</Tag>}
              </div>
            )}
          </div>

          {/* Steps */}
          {!txn && (
            <Alert
              type="info"
              showIcon
              message="Select a transfer above"
              description="All 14 API steps will appear here, fully expanded with their URLs, payloads, and live responses."
              style={{ borderRadius: 8 }}
            />
          )}

          {lovsLoading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin /> <Text style={{ marginLeft: 8 }}>Loading account maps…</Text>
            </div>
          )}

          {txn && steps.map((step, idx) => {
            const r      = results[step.key];
            const ok     = r != null && !r.loading && r.status != null && r.status >= 200 && r.status < 300;
            const fail   = r != null && !r.loading && r.status != null && (r.status < 200 || r.status >= 300);
            const mc     = METHOD_COLOR[step.method] ?? { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
            const accent = ok ? '#16a34a' : fail ? '#dc2626' : mc.border;

            return (
              <div
                key={step.key}
                style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: `5px solid ${accent}`, borderRadius: 10, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}
              >
                {/* ── Step header ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: ok ? '#f0fdf4' : fail ? '#fff5f5' : '#fafafa', borderBottom: '1px solid #e2e8f0' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                    {idx + 1}
                  </div>
                  <span style={{ background: mc.bg, color: mc.text, border: `1px solid ${mc.border}`, borderRadius: 5, padding: '3px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 0.8, flexShrink: 0 }}>
                    {step.method}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{step.label}</div>
                    {step.description && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{step.description}</div>}
                  </div>
                  {r?.loading && <Tag color="processing">Running…</Tag>}
                  {!r?.loading && r?.status != null && (
                    <Tag color={ok ? 'success' : 'error'} style={{ fontSize: 13, fontWeight: 700, padding: '2px 10px' }}>
                      HTTP {r.status}
                    </Tag>
                  )}
                  <Button
                    type="primary"
                    loading={r?.loading}
                    onClick={() => testStep(step)}
                    style={{ background: INFO, borderColor: INFO, fontWeight: 600, minWidth: 80 }}
                  >
                    Test
                  </Button>
                </div>

                {/* ── URL ── */}
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                  <Text style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>Endpoint URL</Text>
                  <Text copyable={{ text: step.url }} style={{ fontSize: 13, color: INFO, fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', lineHeight: 1.8 }}>
                    {step.url}
                  </Text>
                </div>

                {/* ── Payload ── */}
                {step.payload !== undefined && (
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 }}>Request Body (editable)</Text>
                    <Input.TextArea
                      value={payloads[step.key] ?? ''}
                      onChange={e => setPayloads(prev => ({ ...prev, [step.key]: e.target.value }))}
                      autoSize={{ minRows: 6, maxRows: 40 }}
                      style={{ fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.7, background: '#f8fafc', color: '#1e293b', borderColor: '#e2e8f0', borderRadius: 6 }}
                    />
                  </div>
                )}

                {/* ── Response ── */}
                <div style={{ padding: '14px 20px', background: ok ? '#f0fdf4' : fail ? '#fff5f5' : '#fafafe' }}>
                  <Text style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 }}>
                    Response{r?.status != null ? ` — HTTP ${r.status}` : ''}
                  </Text>
                  {!r && (
                    <Text style={{ color: '#94a3b8', fontSize: 13 }}>— Click <strong>Test</strong> to see the live response here —</Text>
                  )}
                  {r?.loading && <Spin size="small" />}
                  {r && !r.loading && r.error && (
                    <Alert type="error" message={`Network error: ${r.error}`} style={{ borderRadius: 6 }} />
                  )}
                  {r && !r.loading && !r.error && r.body && (
                    <pre style={{
                      margin: 0, fontSize: 13, fontFamily: 'monospace', lineHeight: 1.7,
                      color: ok ? '#14532d' : '#7f1d1d',
                      background: ok ? '#dcfce7' : '#fee2e2',
                      border: `1px solid ${ok ? '#86efac' : '#fca5a5'}`,
                      borderRadius: 8, padding: '14px 16px',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      overflowX: 'auto',
                    }}>
                      {r.body}
                    </pre>
                  )}
                </div>

                {idx < steps.length - 1 && <Divider style={{ margin: 0, borderColor: '#f1f5f9' }} />}
              </div>
            );
          })}
        </div>
      </Content>
    </Layout>
  );
};

export default AccountingDebugPage;
