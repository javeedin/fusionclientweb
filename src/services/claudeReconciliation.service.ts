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
  console.log('=== CLAUDE RECONCILIATION STARTED ===');
  console.log('Statements count:', stmtLines.length);
  console.log('Transactions count:', sysTxns.length);
  console.log('API Key exists:', !!claudeApiKey);

  if (!claudeApiKey) {
    console.error('ERROR: Claude API key not configured');
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

  console.log('Formatted statements sample:', stmtSummary.slice(0, 2));
  console.log('Formatted transactions sample:', txnSummary.slice(0, 2));

  const prompt = `You are a bank reconciliation expert. Your ONLY task is to match bank statement lines with system transactions.

BANK STATEMENTS (array):
${JSON.stringify(stmtSummary, null, 2)}

SYSTEM TRANSACTIONS (array):
${JSON.stringify(txnSummary, null, 2)}

MATCHING RULES:
1. Primary: Match by EXACT AMOUNT
2. Secondary: Consider date proximity (within 2 days)
3. Confidence: 1.0 for exact match, 0.95 for small rounding differences, 0.8+ for date match

INSTRUCTIONS:
- For EACH statement line, find ONE matching transaction or mark as unmatched
- Return a JSON array exactly as shown below
- DO NOT include markdown code blocks, DO NOT include explanations
- Return ONLY the JSON array, nothing else

RESPONSE FORMAT (JSON array - REQUIRED):
[
  {
    "stmtLineId": <stmt lineId>,
    "txnId": <txn txnId or null if unmatched>,
    "confidence": <0.0 to 1.0>,
    "matched": <true or false>,
    "reason": <"exact amount match" or "amount within tolerance" or "date match" or "no match">
  }
]`;

  try {
    console.log('Sending request to Claude API...');
    console.log('Model: claude-opus-5');
    console.log('Prompt length:', prompt.length);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    if (!response.ok) {
      const error = await response.text();
      console.error('Claude API error:', response.status, error);
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log('=== FULL RESPONSE OBJECT ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('=== END RESPONSE OBJECT ===');

    console.log('Response keys:', Object.keys(data));

    if (data.content) {
      console.log('Content array length:', data.content.length);
      console.log('First content item:', JSON.stringify(data.content[0], null, 2));
      console.log('First content item keys:', Object.keys(data.content[0]));

      if (data.content[0]) {
        console.log('Content[0] type:', data.content[0].type);
        console.log('Content[0] text:', data.content[0].text);
        console.log('Content[0] all properties:', JSON.stringify(data.content[0], null, 2));
      }
    } else {
      console.error('No content field in response!');
      console.error('Full response:', JSON.stringify(data, null, 2));
    }

    // Handle extended thinking - look for text block in content array
    console.log('=== SEARCHING FOR TEXT BLOCK ===');
    let claudeText = '';

    if (data.content && Array.isArray(data.content)) {
      console.log('Total content blocks:', data.content.length);

      for (let i = 0; i < data.content.length; i++) {
        console.log(`Block ${i}: type="${data.content[i].type}"`);
        if (data.content[i].type === 'text' && data.content[i].text) {
          claudeText = data.content[i].text;
          console.log(`✓ Found text in block ${i}`);
          break;
        }
      }
    }

    console.log('=== EXTRACTED TEXT ===');
    console.log('Text:', claudeText);
    console.log('Text type:', typeof claudeText);
    console.log('Text length:', claudeText.length);
    console.log('=== END EXTRACTED TEXT ===');

    // Extract JSON from Claude response - handle markdown code blocks
    let jsonText = claudeText;

    console.log('Step 1: Looking for markdown code blocks...');
    // Remove markdown code blocks if present
    const codeBlockMatch = claudeText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
      console.log('✓ Found markdown code block, extracted');
      console.log('Extracted text length:', jsonText.length);
    } else {
      console.log('✗ No markdown code block found');
    }

    console.log('Step 2: Looking for JSON array pattern...');
    // Extract JSON array
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('✗ FAILED: Could not find JSON array pattern');
      console.error('Full response:', claudeText);
      console.error('After code block extraction:', jsonText);
      throw new Error(`Claude did not return valid JSON array. Response: ${claudeText.substring(0, 300)}`);
    }

    console.log('✓ Found JSON array pattern');
    console.log('JSON array length:', jsonMatch[0].length);
    console.log('First 200 chars:', jsonMatch[0].substring(0, 200));

    let matches;
    try {
      console.log('Step 3: Parsing JSON...');
      matches = JSON.parse(jsonMatch[0]);
      console.log('✓ Successfully parsed JSON!');
      console.log('Parsed items count:', matches.length);
      console.log('First item:', matches[0]);
    } catch (parseError) {
      console.error('✗ JSON parse error:', parseError);
      console.error('Attempted to parse:', jsonMatch[0].substring(0, 500));
      throw new Error(`Failed to parse Claude JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }

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
