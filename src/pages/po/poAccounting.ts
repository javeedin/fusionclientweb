// Purchasing-RR — journal creation through the existing SLA → GL pipeline
// (sla/accounting/create → journals/create → gl/journals/:id/post), then the
// Purchasing records are stamped with RR_PO_ACCT_PKG.MARK_ACCOUNTED.
import { createAccounting, fetchLedgerByBusinessUnit, derivePeriodName, SlaCreatePayload } from '../../services/sla.service';
import { postSlaToGL } from '../../services/glPosting.service';
import { r2 } from '../../services/po.service';

export const PO_JE_SOURCE = 'Purchasing';
export const PO_JE_CATEGORY = { RECEIPT: 'Receipts', ACCRUAL: 'Accrual', WRITE_OFF: 'Accrual Write-Off' } as const;

export interface AcctLine {
  side: 'DR' | 'CR';
  account: string;
  entered: number;      // transaction currency, positive
  accounted: number;    // functional currency, positive
  accountingClass: string;
  description?: string;
}

export interface PostRequest {
  businessUnitName: string;
  sourceTable: string;
  sourceId: number;
  sourceNumber: string;
  eventTypeCode: string;
  accountingDate: string;       // YYYY-MM-DD
  periodName?: string;          // default Mon-YY of the accounting date
  currency: string;
  ledgerCurrency: string;
  rate: number;
  category: string;
  description: string;
  lines: AcctLine[];
  user: string;
  forceCreate?: boolean;
}

export interface PostResult { slaHeaderId: number; glBatchId: number | null; batchName: string }

/** Turns signed amounts into a DR/CR pair (negative amounts swap the sides). */
export const pair = (amountEntered: number, amountFunc: number, drAccount: string, crAccount: string,
  drClass: string, crClass: string, description: string): AcctLine[] => {
  const neg = amountEntered < 0 || (amountEntered === 0 && amountFunc < 0);
  const e = Math.abs(r2(amountEntered)); const a = Math.abs(r2(amountFunc));
  return neg
    ? [{ side: 'DR', account: crAccount, entered: e, accounted: a, accountingClass: crClass, description },
       { side: 'CR', account: drAccount, entered: e, accounted: a, accountingClass: drClass, description }]
    : [{ side: 'DR', account: drAccount, entered: e, accounted: a, accountingClass: drClass, description },
       { side: 'CR', account: crAccount, entered: e, accounted: a, accountingClass: crClass, description }];
};

export async function postJournal(req: PostRequest): Promise<PostResult> {
  const ledger = await fetchLedgerByBusinessUnit(req.businessUnitName);
  if (!ledger) throw new Error(`No ledger found for business unit ${req.businessUnitName} (gl/getledgername)`);
  const lines = req.lines.filter(l => l.entered !== 0 || l.accounted !== 0);
  if (!lines.length) throw new Error('Nothing to account');
  const dr = r2(lines.filter(l => l.side === 'DR').reduce((s, l) => s + l.accounted, 0));
  const cr = r2(lines.filter(l => l.side === 'CR').reduce((s, l) => s + l.accounted, 0));
  if (Math.abs(dr - cr) > 0.005) throw new Error(`Journal does not balance (Dr ${dr} / Cr ${cr})`);
  const missing = lines.find(l => !l.account);
  if (missing) throw new Error(`Missing ${missing.accountingClass.toLowerCase()} account — check Purchasing Options`);

  const periodName = req.periodName || derivePeriodName(new Date(`${req.accountingDate}T00:00:00`));
  const payload: SlaCreatePayload = {
    header: {
      moduleName: 'PO', sourceTable: req.sourceTable, sourceId: req.sourceId, sourceNumber: req.sourceNumber,
      sourceType: 'Purchasing', eventTypeCode: req.eventTypeCode, eventDate: req.accountingDate,
      accountingDate: req.accountingDate, periodName, ledgerId: ledger.ledgerId, ledgerName: ledger.ledgerName,
      currencyCode: req.currency, ledgerCurrency: req.ledgerCurrency, exchangeRate: req.rate, exchangeRateType: 'User',
      businessUnit: req.businessUnitName, description: req.description, createdBy: req.user,
    },
    lines: lines.map((l, i) => ({
      lineNumber: i + 1, lineType: l.side, accountingClass: l.accountingClass, accountCombination: l.account,
      enteredDr: l.side === 'DR' ? l.entered : 0, enteredCr: l.side === 'CR' ? l.entered : 0,
      accountedDr: l.side === 'DR' ? l.accounted : 0, accountedCr: l.side === 'CR' ? l.accounted : 0,
      currencyCode: req.currency, exchangeRate: req.rate, description: l.description || req.description,
      sourceLineId: req.sourceId, sourceLineNumber: i + 1,
    })),
  };
  const sla = await createAccounting(payload);
  if (!sla?.headerId) throw new Error(sla?.message || 'SLA accounting was not created');
  const gl = await postSlaToGL({
    slaHeaderId: sla.headerId, sourceNumber: req.sourceNumber, sourceId: req.sourceId, eventTypeCode: req.eventTypeCode,
    periodName, ledgerName: ledger.ledgerName, ledgerId: ledger.ledgerId, currency: req.currency,
    accountingDate: req.accountingDate, legalEntity: '', businessUnit: req.businessUnitName, conversionRate: req.rate,
    jeCategory: req.category, jeSource: PO_JE_SOURCE, batchSource: PO_JE_SOURCE,
    batchDescription: req.description, journalDescription: req.description, createdBy: req.user,
    forceCreate: req.forceCreate,
    lines: lines.map(l => ({
      lineType: l.side, enteredDr: l.side === 'DR' ? l.entered : null, enteredCr: l.side === 'CR' ? l.entered : null,
      accountedDr: l.side === 'DR' ? l.accounted : null, accountedCr: l.side === 'CR' ? l.accounted : null,
      description: l.description || req.description, currencyCode: req.currency, accountingDate: req.accountingDate,
      accountCombination: l.account, accountingClass: l.accountingClass, legalEntity: null,
    })),
  });
  if (!gl.success) throw new Error(`GL posting failed: ${gl.error || 'unknown error'} (SLA ${sla.headerId} created)`);
  return { slaHeaderId: sla.headerId, glBatchId: gl.batchId, batchName: gl.batchName };
}
