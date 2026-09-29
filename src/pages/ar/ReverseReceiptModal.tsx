// Reverse an accounted AR receipt — Oracle Receivables "standard reversal".
// 1. Eligibility   GET  ar/receipts/:id/reverse-eligibility (accounted, no applications, not reversed)
// 2. Original      GET  gl/journals/lines?reference2={id}&reference5=AR_RECEIPTS
// 3. Reversal      the same lines with Dr/Cr swapped, dated the reversal date
// 4. Confirm       SLA (AR_RECEIPT_REVERSAL) → GL journal (REFERENCE5 = AR_RECEIPTS_REVERSAL,
//                  REFERENCE2 = receipt id) → post → SLA stamp → POST ar/receipts/:id/reverse
//                  (STATE/STATUS = Reversed + REVERSAL_*). The original journal is never touched.
// Server side: database/ar/ar_receipt_reverse.sql
import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Modal, Alert, Table, Tag, Space, Typography, DatePicker, Select, Input, Button, Steps, Spin, Row, Col, Result,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, RollbackOutlined, WarningOutlined, LoadingOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';
import {
  createAccounting, postToLedger, fetchLedgerByBusinessUnit, derivePeriodName, checkAccountingExists,
  type SlaCreatePayload,
} from '../../services/sla.service';
import { postJournal } from '../../services/manage-journals.service';

const { Text } = Typography;
const BASE = APEX_DB_CONFIG.baseUrl;
const REF5_ORIGINAL = 'AR_RECEIPTS';
const REF5_REVERSAL = 'AR_RECEIPTS_REVERSAL';

export interface ReverseReceiptInfo {
  standardReceiptId: number;
  receiptNumber: string;
  businessUnit: string;
  customerName?: string;
  currency?: string;
  conversionRateType?: string;
  amount?: number | null;
}

interface Eligibility {
  eligible: boolean;
  state: string | null; status: string | null; accountingStatus: string | null;
  applicationCount: number; glLineCount: number; reversalLineCount: number;
  reasons: { code: string; message: string }[];
}
interface JLine {
  key: string; account: string; description: string;
  enteredDr: number; enteredCr: number; accountedDr: number; accountedCr: number;
  currency: string; rate: number; accountingClass: string;
  journalName?: string; periodName?: string; postingStatus?: string;
}
type StepState = 'wait' | 'process' | 'finish' | 'error';
const STEP_TITLES = ['SLA accounting', 'GL journal', 'Post journal', 'SLA stamp', 'Mark receipt Reversed'];

const CATEGORIES = [
  { value: 'REV', label: 'Reverse Payment' },
  { value: 'NSF', label: 'Non-Sufficient Funds' },
  { value: 'STOP', label: 'Stop Payment' },
];
const REASONS = ['Wrong amount', 'Wrong customer', 'Duplicate receipt', 'Payment returned by bank', 'Entered in error', 'Other'];

const num = (v: unknown) => Number(v) || 0;
const fmt = (n: number) => (n ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function ReverseReceiptModal({ open, receipt, currentUser, onClose, onReversed }: {
  open: boolean;
  receipt: ReverseReceiptInfo | null;
  currentUser: string;
  onClose: () => void;
  onReversed: (receiptId: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elig, setElig] = useState<Eligibility | null>(null);
  const [orig, setOrig] = useState<JLine[]>([]);
  const [revDate, setRevDate] = useState<Dayjs>(dayjs());
  const [category, setCategory] = useState('REV');
  const [reason, setReason] = useState<string | undefined>();
  const [comments, setComments] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<{ status: StepState; detail?: string }[]>(STEP_TITLES.map(() => ({ status: 'wait' })));
  const [done, setDone] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!receipt) return;
    setLoading(true); setLoadError(null); setElig(null); setOrig([]); setDone(false); setRunError(null);
    setSteps(STEP_TITLES.map(() => ({ status: 'wait' })));
    try {
      const id = receipt.standardReceiptId;
      const [eRes, lRes] = await Promise.all([
        fetch(`${BASE}/ar/receipts/${id}/reverse-eligibility`, { headers: { Accept: 'application/json' } }),
        fetch(`${BASE}/gl/journals/lines?reference2=${id}&reference5=${REF5_ORIGINAL}`, { headers: { Accept: 'application/json' } }),
      ]);
      const eBody = await eRes.json().catch(() => ({}));
      if (eRes.status === 404 || eBody?.code === 'NotFound') {
        throw new Error(`The reversal service is not deployed (HTTP 404 on ${BASE}/ar/receipts/${id}/reverse-eligibility) — `
          + 'run database/ar/ar_receipt_reverse.sql in bcldifc; its last query must list receipts/:id/reverse-eligibility.');
      }
      if (eBody?.success === false) throw new Error(eBody.error || 'Eligibility check failed');
      setElig({
        eligible: !!eBody.eligible, state: eBody.state ?? null, status: eBody.status ?? null,
        accountingStatus: eBody.accountingStatus ?? null,
        applicationCount: num(eBody.applicationCount), glLineCount: num(eBody.glLineCount),
        reversalLineCount: num(eBody.reversalLineCount), reasons: Array.isArray(eBody.reasons) ? eBody.reasons : [],
      });
      const lBody = await lRes.json().catch(() => ({}));
      const rows: any[] = Array.isArray(lBody?.items) ? lBody.items : Array.isArray(lBody) ? lBody : [];
      setOrig(rows.map((l, i) => {
        const eDr = num(l.entered_dr ?? l.ENTERED_DR), eCr = num(l.entered_cr ?? l.ENTERED_CR);
        const aDr = num(l.accounted_dr ?? l.ACCOUNTED_DR ?? eDr), aCr = num(l.accounted_cr ?? l.ACCOUNTED_CR ?? eCr);
        const ent = eDr || eCr;
        return {
          key: `o${i}`, account: l.account ?? l.ACCOUNT ?? l.account_combination ?? '',
          description: l.description ?? l.DESCRIPTION ?? '',
          enteredDr: eDr, enteredCr: eCr, accountedDr: aDr, accountedCr: aCr,
          currency: l.currency_code ?? l.CURRENCY_CODE ?? receipt.currency ?? 'AED',
          rate: ent ? (aDr || aCr) / ent : 1,
          accountingClass: l.reference3 ?? l.REFERENCE3 ?? '',
          journalName: l.journal_name ?? l.JOURNAL_NAME, periodName: l.period_name ?? l.PERIOD_NAME,
          postingStatus: l.posting_status ?? l.POSTING_STATUS,
        };
      }));
    } catch (e: any) {
      setLoadError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [receipt]);

  useEffect(() => { if (open) { setRevDate(dayjs()); setCategory('REV'); setReason(undefined); setComments(''); void load(); } }, [open, load]);

  // reversal = original with Dr/Cr swapped
  const rev = useMemo<JLine[]>(() => orig.map((l, i) => ({
    ...l, key: `r${i}`,
    enteredDr: l.enteredCr, enteredCr: l.enteredDr, accountedDr: l.accountedCr, accountedCr: l.accountedDr,
    description: `Reversal: ${l.description}`,
  })), [orig]);
  const tot = (ls: JLine[]) => ls.reduce((t, l) => ({ dr: t.dr + l.accountedDr, cr: t.cr + l.accountedCr }), { dr: 0, cr: 0 });
  const origTot = tot(orig), revTot = tot(rev);
  const balanced = Math.abs(revTot.dr - revTot.cr) < 0.005;
  const period = derivePeriodName(revDate.toDate());
  const alreadyJournal = (elig?.reversalLineCount || 0) > 0;
  const blockingReasons = elig?.reasons || [];
  const canConfirm = !!elig?.eligible && orig.length > 0 && balanced && !!reason && !running && !done;

  const setStep = (i: number, status: StepState, detail?: string) =>
    setSteps(s => s.map((x, j) => (j === i ? { status, detail } : x)));

  const confirm = async () => {
    if (!receipt) return;
    setRunning(true); setRunError(null);
    const id = receipt.standardReceiptId;
    const num_ = receipt.receiptNumber;
    const d = revDate.format('YYYY-MM-DD');
    let cur = 0;
    try {
      if (alreadyJournal) {
        // a reversal journal already exists (earlier run stopped half-way) — only stamp the receipt
        [0, 1, 2, 3].forEach(i => setStep(i, 'finish', 'Reversal journal already in GL'));
      } else {
        const ledger = await fetchLedgerByBusinessUnit(receipt.businessUnit);
        if (!ledger) throw new Error(`No ledger found for business unit ${receipt.businessUnit}`);
        const rate = rev[0]?.rate || 1;
        const ccy = rev[0]?.currency || receipt.currency || 'AED';

        // 1. SLA
        cur = 0; setStep(0, 'process');
        let slaHeaderId = 0;
        const existing = await checkAccountingExists('AR_RECEIPTS', id, 'AR_RECEIPT_REVERSAL').catch(() => null);
        if (existing?.exists && existing.headerId) {
          slaHeaderId = existing.headerId;
          setStep(0, 'finish', `Existing SLA #${slaHeaderId}`);
        } else {
          const sla: SlaCreatePayload = {
            header: {
              moduleName: 'AR', sourceTable: 'AR_RECEIPTS', sourceId: id, sourceNumber: num_, sourceType: 'Receipt',
              eventTypeCode: 'AR_RECEIPT_REVERSAL', eventDate: d, accountingDate: d, periodName: period,
              ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName, currencyCode: ccy, ledgerCurrency: 'AED',
              exchangeRate: rate, exchangeRateType: receipt.conversionRateType || 'Corporate',
              businessUnit: receipt.businessUnit, description: `Reversal of receipt ${num_}`, createdBy: currentUser,
            },
            lines: rev.map((l, i) => ({
              lineNumber: i + 1, lineType: l.accountedDr > 0 || l.enteredDr > 0 ? 'DR' : 'CR',
              accountingClass: l.accountingClass || 'REVERSAL', accountCombination: l.account,
              enteredDr: l.enteredDr, enteredCr: l.enteredCr, accountedDr: l.accountedDr, accountedCr: l.accountedCr,
              currencyCode: l.currency, exchangeRate: l.rate, description: l.description,
            })),
          };
          const s = await createAccounting(sla);
          slaHeaderId = s.headerId;
          setStep(0, 'finish', `SLA #${slaHeaderId}`);
        }

        // 2. GL journal — REFERENCE5 = AR_RECEIPTS_REVERSAL, REFERENCE2 = receipt id
        cur = 1; setStep(1, 'process');
        const total = r2(revTot.dr);
        const batchName = `AR-RECEIPT-REV-${num_}-${d.replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;
        const glPayload = {
          batch: {
            batchName, batchDescription: `Reversal of AR Receipt ${num_}`,
            ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, status: 'NEW', accountingPeriod: period,
            controlTotal: total, runningTotalDr: total, runningTotalCr: total,
            batchSource: 'Accounts Receivable', createdBy: currentUser,
          },
          header: {
            ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
            jeCategory: 'Receipts', jeSource: 'Receivables', periodName: period,
            journalName: `AR-REV-${num_}`,
            description: `Reversal of receipt ${num_} — ${receipt.customerName || ''}`.trim(),
            currencyCode: ccy, currencyConversionType: receipt.conversionRateType || 'Corporate',
            currencyConversionDate: d, currencyConversionRate: rate, defaultEffectiveDate: d,
            status: 'NEW', runningTotalDr: total, runningTotalCr: total, createdBy: currentUser,
          },
          lines: rev.map(l => ({
            enteredDr: l.enteredDr || null, enteredCr: l.enteredCr || null,
            accountedDr: l.accountedDr || null, accountedCr: l.accountedCr || null,
            statAmount: null, description: l.description, currencyCode: l.currency,
            currencyConversionDate: d, currencyConversionRate: l.rate,
            userCurrencyConversionType: receipt.conversionRateType || 'Corporate',
            accountCombination: l.account, chartOfAccountsName: 'Chart of Accounts',
            reference1: num_, reference2: String(id), reference3: l.accountingClass || 'REVERSAL',
            reference4: receipt.businessUnit, reference5: REF5_REVERSAL, createdBy: currentUser,
          })),
        };
        const glRes = await fetch(`${BASE}/journals/create`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(glPayload),
        });
        const glBody = await glRes.json().catch(() => ({}));
        if (!glRes.ok || glBody?.status === 'ERROR') throw new Error(glBody?.message || `GL journal HTTP ${glRes.status}`);
        const batchId = glBody?.jeBatchId ?? glBody?.je_batch_id ?? glBody?.batchId ?? glBody?.batch_id ?? 0;
        const headerId = glBody?.jeHeaderId ?? glBody?.je_header_id ?? glBody?.headerId ?? glBody?.header_id ?? 0;
        setStep(1, 'finish', `Batch #${batchId}`);

        // 3. post
        cur = 2; setStep(2, 'process');
        const p = await postJournal(batchId);
        if (!p.success) throw new Error(`Posting failed: ${p.error || p.message || 'unknown error'}`);
        setStep(2, 'finish', 'Posted');

        // 4. SLA stamp
        cur = 3; setStep(3, 'process');
        await postToLedger(slaHeaderId, batchId, batchName, headerId, currentUser);
        setStep(3, 'finish');
      }

      // 5. receipt → Reversed (server refuses unless the reversal journal exists)
      cur = 4; setStep(4, 'process');
      const res = await fetch(`${BASE}/ar/receipts/${id}/reverse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          reversalDate: d, reversalCategory: category, reversalReason: reason,
          reversalComments: comments, reversedBy: currentUser,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        const why = Array.isArray(body?.reasons) && body.reasons.length ? `: ${body.reasons.map((r: any) => r.message).join('; ')}` : '';
        throw new Error(`${body?.error || `HTTP ${res.status}`}${why}`);
      }
      setStep(4, 'finish', `Reversed on ${d}`);
      setDone(true);
      onReversed(id);
    } catch (e: any) {
      setStep(cur, 'error', e.message || String(e));
      setRunError(e.message || String(e));
      // re-read eligibility: if the reversal journal was created before the failure,
      // a retry must not create a second one (it then only stamps the receipt)
      try {
        const r = await fetch(`${BASE}/ar/receipts/${id}/reverse-eligibility`, { headers: { Accept: 'application/json' } });
        const b = await r.json();
        if (b && b.success !== false) {
          setElig(el => (el ? { ...el, eligible: !!b.eligible, reversalLineCount: num(b.reversalLineCount),
            reasons: Array.isArray(b.reasons) ? b.reasons : el.reasons } : el));
        }
      } catch { /* keep the previous eligibility */ }
    } finally {
      setRunning(false);
    }
  };

  const cols = (strong?: boolean) => [
    { title: 'Account', dataIndex: 'account', width: 290, render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    { title: 'Dr', dataIndex: 'accountedDr', align: 'right' as const, width: 130,
      render: (v: number) => <Text strong={strong} style={{ color: v ? '#1D7B4D' : undefined }}>{fmt(v)}</Text> },
    { title: 'Cr', dataIndex: 'accountedCr', align: 'right' as const, width: 130,
      render: (v: number) => <Text strong={strong} style={{ color: v ? '#C74634' : undefined }}>{fmt(v)}</Text> },
  ];
  const totalRow = (t: { dr: number; cr: number }) => (
    <Table.Summary.Row style={{ fontWeight: 600, background: '#FAFAFA' }}>
      <Table.Summary.Cell index={0} colSpan={2}>Total {Math.abs(t.dr - t.cr) < 0.005
        ? <Tag color="success" icon={<CheckCircleOutlined />}>Balanced</Tag>
        : <Tag color="error" icon={<CloseCircleOutlined />}>Out by {fmt(Math.abs(t.dr - t.cr))}</Tag>}</Table.Summary.Cell>
      <Table.Summary.Cell index={2} align="right">{fmt(t.dr)}</Table.Summary.Cell>
      <Table.Summary.Cell index={3} align="right">{fmt(t.cr)}</Table.Summary.Cell>
    </Table.Summary.Row>
  );
  const origHead = orig[0];

  return (
    <Modal
      open={open}
      width={1100}
      title={<Space><RollbackOutlined style={{ color: '#C74634' }} />Reverse Receipt {receipt?.receiptNumber}</Space>}
      onCancel={() => { if (!running) onClose(); }}
      maskClosable={!running}
      destroyOnClose
      footer={done ? [
        <Button key="close" type="primary" onClick={onClose}>Close</Button>,
      ] : [
        <Button key="cancel" onClick={onClose} disabled={running}>Cancel</Button>,
        <Button key="go" type="primary" danger icon={<RollbackOutlined />} loading={running} disabled={!canConfirm}
          onClick={() => Modal.confirm({
            title: `Reverse receipt ${receipt?.receiptNumber}?`,
            content: `A reversing journal (${fmt(revTot.dr)} ${origHead?.currency || ''}) will be posted in ${period} and the receipt marked Reversed. This cannot be undone.`,
            okText: 'Confirm Reverse', okButtonProps: { danger: true }, zIndex: 2100,
            onOk: confirm,
          })}>
          Confirm Reverse
        </Button>,
      ]}
    >
      {loading && <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="Checking eligibility and loading the accounting…" /></div>}
      {loadError && <Alert type="error" showIcon message="Could not prepare the reversal" description={loadError} />}

      {!loading && !loadError && elig && (
        <>
          {/* 1. eligibility */}
          <Text strong>1. Eligibility</Text>
          <div style={{ margin: '6px 0 14px' }}>
            {elig.eligible ? (
              <Alert type="success" showIcon
                message="Receipt can be reversed"
                description={`Accounted · no invoice applications · not reversed yet${alreadyJournal ? ' · a reversal journal already exists (only the receipt status will be updated)' : ''}`} />
            ) : (
              <Alert type="error" showIcon message="This receipt cannot be reversed"
                description={<ul style={{ margin: 0, paddingLeft: 18 }}>{blockingReasons.map(r => <li key={r.code}>{r.message}</li>)}</ul>} />
            )}
          </div>

          {/* 2. original */}
          <Text strong>2. Original accounting</Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            REFERENCE2 = {receipt?.standardReceiptId}, REFERENCE5 = {REF5_ORIGINAL}
            {origHead ? ` · ${origHead.journalName || ''} · ${origHead.periodName || ''} · ${origHead.postingStatus || ''}` : ''}
          </Text>
          <Table<JLine> size="small" rowKey="key" dataSource={orig} columns={cols()} pagination={false}
            style={{ margin: '6px 0 14px' }}
            locale={{ emptyText: 'No GL journal found for this receipt' }}
            summary={() => (orig.length ? totalRow(origTot) : null)} />

          {/* 3. reversal */}
          <Text strong>3. Reversal entry</Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            Dr/Cr swapped · REFERENCE5 = {REF5_REVERSAL} · period {period}
          </Text>
          <Row gutter={12} style={{ margin: '8px 0' }}>
            <Col span={5}>
              <div style={{ fontSize: 12, color: '#6B6B6B' }}>Reversal / GL date</div>
              <DatePicker value={revDate} onChange={v => v && setRevDate(v)} allowClear={false} format="DD-MMM-YYYY"
                style={{ width: '100%' }} disabled={running || done} getPopupContainer={t => t.parentElement || document.body} />
            </Col>
            <Col span={6}>
              <div style={{ fontSize: 12, color: '#6B6B6B' }}>Category</div>
              <Select value={category} onChange={setCategory} options={CATEGORIES} style={{ width: '100%' }}
                disabled={running || done} getPopupContainer={t => t.parentElement || document.body} />
            </Col>
            <Col span={6}>
              <div style={{ fontSize: 12, color: '#6B6B6B' }}>Reason <span style={{ color: '#C74634' }}>*</span></div>
              <Select value={reason} onChange={setReason} placeholder="Select a reason" style={{ width: '100%' }}
                options={REASONS.map(r => ({ value: r, label: r }))} disabled={running || done}
                getPopupContainer={t => t.parentElement || document.body} />
            </Col>
            <Col span={7}>
              <div style={{ fontSize: 12, color: '#6B6B6B' }}>Comments</div>
              <Input value={comments} onChange={e => setComments(e.target.value)} maxLength={3500} disabled={running || done} />
            </Col>
          </Row>
          <Table<JLine> size="small" rowKey="key" dataSource={rev} columns={cols(true)} pagination={false}
            locale={{ emptyText: 'Nothing to reverse' }}
            summary={() => (rev.length ? totalRow(revTot) : null)} />
          {!!origHead && dayjs(revDate).isBefore(dayjs(), 'day') && (
            <Alert type="warning" showIcon icon={<WarningOutlined />} style={{ marginTop: 8 }}
              message={`Reversal dated in the past — ${period} must be open in GL.`} />
          )}

          {/* 4. progress */}
          {(running || done || runError) && (
            <>
              <Text strong style={{ display: 'block', marginTop: 14 }}>4. Reversal</Text>
              <Steps size="small" direction="vertical" style={{ marginTop: 8 }}
                items={STEP_TITLES.map((t, i) => ({
                  title: t, status: steps[i].status, description: steps[i].detail,
                  icon: steps[i].status === 'process' ? <LoadingOutlined /> : undefined,
                }))} />
            </>
          )}
          {runError && <Alert type="error" showIcon style={{ marginTop: 8 }} message="Reversal stopped" description={`${runError} — nothing after this step ran. Fix it and press Confirm Reverse again${alreadyJournal
                ? ': the reversal journal is already in GL, so only the receipt status will be updated (if that journal is unposted, post it from Manage Journals).'
                : '.'}`} />}
          {done && <Result status="success" style={{ padding: '12px 0 0' }} title={`Receipt ${receipt?.receiptNumber} reversed`}
            subTitle={`Reversal journal posted in ${period}; receipt status is now Reversed.`} />}
        </>
      )}
    </Modal>
  );
}
