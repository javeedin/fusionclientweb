import { ORACLE_SOAP_CONFIG, APEX_DB_CONFIG } from '../config/api.config';
import { callSoapBip } from './sync-http';

// Types
export interface GLBalancesSyncProgress {
  status: 'idle' | 'fetching' | 'parsing' | 'inserting' | 'completed' | 'error' | 'stopped';
  totalRecords: number;
  processedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  errors: number;
  lastError: string;
  startTime: Date | null;
  endTime: Date | null;
}

export interface GLBalanceRecord {
  period_type: string | null;
  period_name: string;
  actual_flag: string;
  period_year: string;
  period_num: string;
  ledger_id: string;
  company: string;
  lob: string;
  department: string;
  account: string;
  account_desc: string;
  sub_account: string;
  analysis: string;
  intercompany: string;
  future1: string | null;
  future2: string | null;
  account_type: string;
  currency: string;
  opening_balance: number;
  period_activity: number | null;
  closing_balance: number;
  debit: number;
  credit: number;
  currency_code: string | null;
}

export type LogCallback = (type: 'info' | 'success' | 'error' | 'warning' | 'step', message: string) => void;
export type ProgressCallback = (progress: Partial<GLBalancesSyncProgress>) => void;
export type BalancePayloadCallback = (batchNum: number, payload: GLBalanceRecord[], result?: unknown, error?: string) => void;

// Build SOAP envelope for BI Publisher report
const buildSoapEnvelope = (
  reportPath: string,
  parameters: Record<string, string>,
  username: string,
  password: string
): string => {
  // Build parameter XML
  const paramXml = Object.entries(parameters)
    .filter(([key]) => key !== 'environment') // Skip environment parameter
    .map(([key, value]) => `
            <v2:item>
              <v2:name>${key}</v2:name>
              <v2:values><v2:item>${value}</v2:item></v2:values>
            </v2:item>`)
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>${paramXml}
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>${username}</v2:userID>
      <v2:password>${password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;
};

// Parse XML and extract GL Balance records
const parseGLBalancesXml = (xmlString: string): GLBalanceRecord[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  // Check for parse errors
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML Parse Error: ' + parseError.textContent);
  }

  const records: GLBalanceRecord[] = [];

  // Find all G_1 elements (each represents a balance record)
  const g1Elements = xmlDoc.querySelectorAll('G_1');

  g1Elements.forEach((g1) => {
    const getText = (tagName: string): string => {
      const el = g1.querySelector(tagName);
      return el?.textContent?.trim() || '';
    };

    const getNumber = (tagName: string): number => {
      const text = getText(tagName);
      const num = parseFloat(text);
      return isNaN(num) ? 0 : num;
    };

    const record: GLBalanceRecord = {
      period_type: getText('PERIOD_TYPE') || null,
      period_name: getText('PERIOD_NAME'),
      actual_flag: getText('ACTUAL_FLAG') || 'A',
      period_year: getText('PERIOD_YEAR'),
      period_num: getText('PERIOD_NO'),
      ledger_id: getText('LEDGER_ID'),
      company: getText('COMPANY'),
      lob: getText('LOB'),
      department: getText('DEPARTMENT'),
      account: getText('ACCOUNT'),
      account_desc: getText('ACCOUNT_DESCRIPTION'),
      sub_account: getText('SUB_ACCOUNT'),
      analysis: getText('ANALYSIS'),
      intercompany: getText('INTERCOMPANY'),
      future1: getText('FUTURE1') || null,
      future2: getText('FUTURE2') || null,
      account_type: getText('ACCOUNT_TYPE'),
      currency: getText('CURRENCY'),
      opening_balance: getNumber('OPENING'),
      period_activity: getNumber('PERIOD_ACTIVITY') || null,
      closing_balance: getNumber('CLOSING'),
      debit: getNumber('DEBIT'),
      credit: getNumber('CREDIT'),
      currency_code: getText('CURRENCY_CODE') || null,
    };

    records.push(record);
  });

  return records;
};

// Test SOAP connection
export const testGLBalancesConnection = async (
  parameters: Record<string, string>,
  log?: LogCallback
): Promise<{ success: boolean; error?: string }> => {
  log?.('info', 'Testing GL Balances SOAP connection...');

  const environment = (parameters.environment || 'prod') as 'prod' | 'test';
  const config = ORACLE_SOAP_CONFIG[environment];

  log?.('info', `Environment: ${environment}`);
  log?.('info', `SOAP URL: ${config.baseUrl}`);

  try {
    // Build a test request with minimal data
    const soapEnvelope = buildSoapEnvelope(
      ORACLE_SOAP_CONFIG.reports.glBalances,
      parameters,
      config.username,
      config.password
    );

    log?.('info', 'Testing direct SOAP connection...');

    const result = await callSoapBip(config.baseUrl, soapEnvelope, log);

    if (result.success) {
      log?.('success', 'SOAP connection successful!');
      return { success: true };
    } else {
      log?.('error', `SOAP connection failed: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Connection test failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
};

// Main sync function
export const syncGLBalances = async (
  parameters: Record<string, string>,
  testMode: boolean | 'single' = true,
  log?: LogCallback,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onPayload?: BalancePayloadCallback,
  verboseConsole: boolean = false
): Promise<GLBalancesSyncProgress> => {
  const progress: GLBalancesSyncProgress = {
    status: 'idle',
    totalRecords: 0,
    processedRecords: 0,
    insertedRecords: 0,
    updatedRecords: 0,
    errors: 0,
    lastError: '',
    startTime: new Date(),
    endTime: null,
  };

  const updateProgress = (updates: Partial<GLBalancesSyncProgress>) => {
    Object.assign(progress, updates);
    onProgress?.(progress);
  };

  try {
    // ========================================
    // STEP 1: Build SOAP Request
    // ========================================
    updateProgress({ status: 'fetching' });
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 1: Building SOAP Request');
    log?.('step', '═══════════════════════════════════════════════════════════');

    const environment = (parameters.environment || 'prod') as 'prod' | 'test';
    const config = ORACLE_SOAP_CONFIG[environment];

    log?.('info', `Environment: ${environment.toUpperCase()}`);
    log?.('info', `SOAP Endpoint: ${config.baseUrl}`);
    log?.('info', `Report Path: ${ORACLE_SOAP_CONFIG.reports.glBalances}`);
    log?.('info', `Parameter P_PERIOD_NAME: ${parameters.P_PERIOD_NAME}`);
    log?.('info', `Username: ${config.username}`);

    const soapEnvelope = buildSoapEnvelope(
      ORACLE_SOAP_CONFIG.reports.glBalances,
      parameters,
      config.username,
      config.password
    );

    // Log SOAP Envelope
    log?.('step', '──── SOAP ENVELOPE ────');
    log?.('info', soapEnvelope);

    if (verboseConsole) {
      console.log('=== SOAP REQUEST ===');
      console.log('URL:', config.baseUrl);
      console.log('Envelope:', soapEnvelope);
    }

    // ========================================
    // STEP 2: Send SOAP Request via Proxy
    // ========================================
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 2: Sending SOAP Request to Oracle BI Publisher');
    log?.('step', '═══════════════════════════════════════════════════════════');

    log?.('info', `SOAP URL: ${config.baseUrl}`);
    log?.('info', 'Sending request...');

    if (abortSignal?.aborted) {
      updateProgress({ status: 'stopped' });
      log?.('warning', 'Sync stopped by user');
      return progress;
    }

    const result = await callSoapBip(config.baseUrl, soapEnvelope, log);

    log?.('info', `Response received in ${result.duration ?? 0}ms`);

    if (!result.success) {
      log?.('error', `SOAP request failed: ${result.error}`);
      if (result.details) {
        log?.('error', `Details: ${result.details}`);
      }
      updateProgress({ status: 'error', lastError: result.error });
      return progress;
    }

    log?.('success', `SOAP Response: Success`);
    log?.('info', `Records found in response: ${result.recordCount}`);

    // ========================================
    // STEP 3: Show Base64 & Decoded XML
    // ========================================
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 3: Decoding Base64 Response');
    log?.('step', '═══════════════════════════════════════════════════════════');

    const decodedXml = result.decodedXml;

    if (!decodedXml) {
      log?.('error', 'No XML data in response');
      updateProgress({ status: 'error', lastError: 'No XML data in response' });
      return progress;
    }

    log?.('info', `Decoded XML Length: ${decodedXml.length} characters`);

    // Show sample of decoded XML (first 2000 chars)
    log?.('step', '──── DECODED XML (Sample - first 2000 chars) ────');
    log?.('info', decodedXml.substring(0, 2000) + (decodedXml.length > 2000 ? '...' : ''));

    if (verboseConsole) {
      console.log('=== DECODED XML ===');
      console.log(decodedXml.substring(0, 5000));
    }

    // ========================================
    // STEP 4: Parse XML to JSON Records
    // ========================================
    updateProgress({ status: 'parsing' });
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 4: Parsing XML to JSON Records');
    log?.('step', '═══════════════════════════════════════════════════════════');

    if (abortSignal?.aborted) {
      updateProgress({ status: 'stopped' });
      log?.('warning', 'Sync stopped by user');
      return progress;
    }

    // Parse XML to records
    const records = parseGLBalancesXml(decodedXml);

    log?.('success', `Parsed ${records.length} GL Balance records`);
    updateProgress({ totalRecords: records.length });

    if (records.length === 0) {
      log?.('warning', 'No records found in response');
      updateProgress({ status: 'completed', endTime: new Date() });
      return progress;
    }

    // Show sample JSON record
    log?.('step', '──── SAMPLE JSON RECORD (First Record) ────');
    log?.('info', JSON.stringify(records[0], null, 2));

    if (verboseConsole) {
      console.log('=== PARSED JSON RECORDS (first 3) ===');
      console.log(JSON.stringify(records.slice(0, 3), null, 2));
    }

    // Apply test mode limits
    let recordsToProcess = records;
    if (testMode === 'single') {
      recordsToProcess = records.slice(0, 1);
      log?.('warning', `SINGLE RECORD MODE: Processing 1 of ${records.length} records`);
    } else if (testMode === true) {
      recordsToProcess = records.slice(0, 25);
      log?.('warning', `TEST MODE: Processing ${recordsToProcess.length} of ${records.length} records`);
    } else {
      log?.('info', `FULL SYNC MODE: Processing all ${records.length} records`);
    }

    updateProgress({ totalRecords: recordsToProcess.length });

    // ========================================
    // STEP 5: Insert to APEX Database
    // ========================================
    updateProgress({ status: 'inserting' });
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  STEP 5: Inserting Records to APEX Database');
    log?.('step', '═══════════════════════════════════════════════════════════');

    const apexUrl = `${APEX_DB_CONFIG.baseUrl}/${APEX_DB_CONFIG.endpoints.glBalances}`;

    log?.('info', `APEX URL: ${apexUrl}`);

    const batchSize = 500;
    let batchNum = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    for (let i = 0; i < recordsToProcess.length; i += batchSize) {
      if (abortSignal?.aborted) {
        updateProgress({ status: 'stopped' });
        log?.('warning', 'Sync stopped by user');
        return progress;
      }

      batchNum++;
      const batch = recordsToProcess.slice(i, i + batchSize);

      log?.('step', `──── BATCH ${batchNum} ────`);
      log?.('info', `Records: ${batch.length} (${i + 1}-${i + batch.length} of ${recordsToProcess.length})`);

      // Show POST payload for first batch
      if (batchNum === 1) {
        log?.('step', '──── APEX POST PAYLOAD (First Batch Sample) ────');
        const payloadSample = { items: batch.slice(0, 2) };
        log?.('info', JSON.stringify(payloadSample, null, 2));
        if (batch.length > 2) {
          log?.('info', `... and ${batch.length - 2} more records in this batch`);
        }
      }

      try {
        if (verboseConsole) {
          console.log(`=== APEX POST BATCH ${batchNum} ===`);
          console.log('URL:', apexUrl);
          console.log('Records:', batch.length);
          console.log('Payload:', JSON.stringify({ items: batch.slice(0, 2) }, null, 2));
        }

        const insertStart = Date.now();
        const insertResponse = await fetch(apexUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ items: batch }),
        });

        const insertDuration = Date.now() - insertStart;
        const insertResult = await insertResponse.json();

        // Log response
        log?.('step', '──── APEX RESPONSE ────');
        log?.('info', JSON.stringify(insertResult, null, 2));

        if (verboseConsole) {
          console.log('Response:', insertResult);
        }

        if (insertResult.success) {
          totalInserted += insertResult.inserted || 0;
          totalUpdated += insertResult.updated || 0;
          totalErrors += insertResult.errors || 0;

          log?.('success', `Batch ${batchNum} completed in ${insertDuration}ms`);
          log?.('info', `  Inserted: ${insertResult.inserted || 0}`);
          log?.('info', `  Updated: ${insertResult.updated || 0}`);
          log?.('info', `  Errors: ${insertResult.errors || 0}`);

          onPayload?.(batchNum, batch, insertResult);
        } else {
          totalErrors += batch.length;
          log?.('error', `Batch ${batchNum} failed: ${insertResult.error}`);
          onPayload?.(batchNum, batch, undefined, insertResult.error);
        }

        updateProgress({
          processedRecords: Math.min(i + batch.length, recordsToProcess.length),
          insertedRecords: totalInserted,
          updatedRecords: totalUpdated,
          errors: totalErrors,
          lastError: insertResult.lastError || '',
        });

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        totalErrors += batch.length;
        log?.('error', `Batch ${batchNum} error: ${errorMsg}`);
        onPayload?.(batchNum, batch, undefined, errorMsg);

        updateProgress({
          errors: totalErrors,
          lastError: errorMsg,
        });
      }
    }

    // ========================================
    // STEP 6: Summary
    // ========================================
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('step', '  SYNC COMPLETED');
    log?.('step', '═══════════════════════════════════════════════════════════');
    log?.('success', `Total Records Processed: ${recordsToProcess.length}`);
    log?.('success', `Inserted: ${totalInserted}`);
    log?.('success', `Updated: ${totalUpdated}`);
    if (totalErrors > 0) {
      log?.('error', `Errors: ${totalErrors}`);
    } else {
      log?.('info', `Errors: 0`);
    }

    const totalDuration = Date.now() - progress.startTime!.getTime();
    log?.('info', `Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);

    updateProgress({
      status: 'completed',
      endTime: new Date(),
    });

    return progress;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log?.('error', `Sync failed: ${errorMsg}`);
    updateProgress({
      status: 'error',
      lastError: errorMsg,
      endTime: new Date(),
    });
    return progress;
  }
};
