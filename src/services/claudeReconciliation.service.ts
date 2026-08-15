/**
 * Claude-based Bank Reconciliation Service
 * Uses Claude API to match bank statements with system transactions based on amounts
 */

export interface ReconciliationMatch {
  stmtLineId: number;
  stmtAmount: number;
  stmtDate: string;
  stmtReference: string;
  stmtDescription: string;
  txnId: number;
  txnNumber: string;
  txnAmount: number;
  txnDate: string;
  txnReference: string;
  txnSource: string;
  confidence: number;
  reason: string;
  matched: boolean;
}

export interface ReconciliationResult {
  totalMatches: number;
  totalAmount: number;
  matches: ReconciliationMatch[];
  unmatchedStmtLines: any[];
  unmatchedSysTxns: any[];
  discrepancies: any[];
  generatedAt: string;
}

export const reconcileWithClaude = async (
  stmtLines: any[],
  sysTxns: any[],
  claudeApiKey: string
): Promise<ReconciliationResult> => {
  if (!claudeApiKey) {
    throw new Error('Claude API key not configured');
  }

  // Format data for Claude
  const stmtSummary = stmtLines.map(line => ({
    lineId: line.lineId || line.id,
    amount: line.amount,
    date: line.transactionDate || line.txn_date,
    reference: line.reference || line.reference_number || '',
    description: line.description || '',
  }));

  const txnSummary = sysTxns.map(txn => ({
    txnId: txn.txnId || txn.id,
    txnNumber: txn.txnNumber || txn.txn_number,
    amount: txn.amount,
    date: txn.txnDate || txn.txn_date,
    reference: txn.reference || txn.reference_text || '',
    source: txn.source,
    payee: txn.payee || '',
  }));

  const prompt = `You are a bank reconciliation expert. Match bank statement lines with system transactions based primarily on AMOUNT matching, with secondary consideration for dates and references.

BANK STATEMENTS:
${JSON.stringify(stmtSummary, null, 2)}

SYSTEM TRANSACTIONS:
${JSON.stringify(txnSummary, null, 2)}

For each statement line, find matching system transaction(s) by:
1. EXACT amount match (highest confidence)
2. Amount match within rounding tolerance (small differences acceptable)
3. If no exact match, provide "unmatched" indication

Return a JSON array with this structure:
[
  {
    "stmtLineId": number,
    "txnId": number or null,
    "confidence": 0.0 to 1.0,
    "matched": boolean,
    "reason": "exact match" | "amount mismatch" | "no system transaction" | "no statement line"
  }
]

Focus on AMOUNT as primary matching criteria. Return ONLY valid JSON, no other text.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const claudeText = data.content[0]?.text || '';

    // Extract JSON from Claude response
    const jsonMatch = claudeText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON array');
    }

    const matches = JSON.parse(jsonMatch[0]);

    // Build reconciliation result
    const result: ReconciliationResult = {
      totalMatches: 0,
      totalAmount: 0,
      matches: [],
      unmatchedStmtLines: [],
      unmatchedSysTxns: [],
      discrepancies: [],
      generatedAt: new Date().toISOString(),
    };

    // Create lookup maps
    const txnMap = new Map();
    sysTxns.forEach(txn => {
      txnMap.set(txn.txnId || txn.id, txn);
    });

    const stmtMap = new Map();
    stmtLines.forEach(line => {
      stmtMap.set(line.lineId || line.id, line);
    });

    const matchedStmtIds = new Set<number>();
    const matchedTxnIds = new Set<number>();

    // Process Claude's matches
    matches.forEach((match: any) => {
      const stmtLine = stmtMap.get(match.stmtLineId);
      const txn = match.txnId ? txnMap.get(match.txnId) : null;

      if (match.matched && stmtLine && txn) {
        result.matches.push({
          stmtLineId: match.stmtLineId,
          stmtAmount: stmtLine.amount,
          stmtDate: stmtLine.transactionDate || stmtLine.txn_date,
          stmtReference: stmtLine.reference || '',
          stmtDescription: stmtLine.description || '',
          txnId: match.txnId,
          txnNumber: txn.txnNumber || txn.txn_number,
          txnAmount: txn.amount,
          txnDate: txn.txnDate || txn.txn_date,
          txnReference: txn.reference || '',
          txnSource: txn.source,
          confidence: match.confidence || 1.0,
          reason: match.reason,
          matched: true,
        });

        result.totalMatches++;
        result.totalAmount += stmtLine.amount;
        matchedStmtIds.add(match.stmtLineId);
        matchedTxnIds.add(match.txnId);
      } else if (!match.matched && stmtLine) {
        result.unmatchedStmtLines.push(stmtLine);
      }
    });

    // Find unmatched system transactions
    sysTxns.forEach(txn => {
      const txnId = txn.txnId || txn.id;
      if (!matchedTxnIds.has(txnId)) {
        result.unmatchedSysTxns.push(txn);
      }
    });

    return result;
  } catch (error) {
    throw new Error(`Claude reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const exportReconciliationToExcel = (
  result: ReconciliationResult,
  fileName: string = 'bank_reconciliation.xlsx'
) => {
  const XLSX = require('xlsx');
  const { saveAs } = require('file-saver');

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ['Bank Reconciliation Report'],
    ['Generated', result.generatedAt],
    [],
    ['Total Matches', result.totalMatches],
    ['Total Matched Amount', result.totalAmount],
    ['Unmatched Statements', result.unmatchedStmtLines.length],
    ['Unmatched Transactions', result.unmatchedSysTxns.length],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Matches sheet
  if (result.matches.length > 0) {
    const matchesData = [
      ['Statement Amount', 'Statement Date', 'Statement Ref', 'Transaction #', 'Transaction Amount', 'Transaction Date', 'Source', 'Confidence', 'Reason'],
      ...result.matches.map(m => [
        m.stmtAmount,
        m.stmtDate,
        m.stmtReference,
        m.txnNumber,
        m.txnAmount,
        m.txnDate,
        m.txnSource,
        (m.confidence * 100).toFixed(0) + '%',
        m.reason,
      ]),
    ];
    const matchesWs = XLSX.utils.aoa_to_sheet(matchesData);
    XLSX.utils.book_append_sheet(wb, matchesWs, 'Matched');
  }

  // Unmatched Statements sheet
  if (result.unmatchedStmtLines.length > 0) {
    const unmatchedStmtData = [
      ['Amount', 'Date', 'Reference', 'Description'],
      ...result.unmatchedStmtLines.map(line => [
        line.amount,
        line.transactionDate || line.txn_date,
        line.reference || '',
        line.description || '',
      ]),
    ];
    const unmatchedStmtWs = XLSX.utils.aoa_to_sheet(unmatchedStmtData);
    XLSX.utils.book_append_sheet(wb, unmatchedStmtWs, 'Unmatched Statements');
  }

  // Unmatched Transactions sheet
  if (result.unmatchedSysTxns.length > 0) {
    const unmatchedTxnData = [
      ['Transaction #', 'Amount', 'Date', 'Reference', 'Source', 'Payee'],
      ...result.unmatchedSysTxns.map(txn => [
        txn.txnNumber || txn.txn_number,
        txn.amount,
        txn.txnDate || txn.txn_date,
        txn.reference || '',
        txn.source,
        txn.payee || '',
      ]),
    ];
    const unmatchedTxnWs = XLSX.utils.aoa_to_sheet(unmatchedTxnData);
    XLSX.utils.book_append_sheet(wb, unmatchedTxnWs, 'Unmatched Transactions');
  }

  // Write file
  XLSX.writeFile(wb, fileName);
};
