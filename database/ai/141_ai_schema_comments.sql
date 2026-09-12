-- ============================================================
-- PATCH 141: Table/column comments for the AI SQL gateway
--
-- The AI Assistant's SQL mode reads its ONLY semantics from
-- USER_TAB_COMMENTS / USER_COL_COMMENTS (served by GET ai/objects).
-- This pass documents the core operational tables so generated SQL
-- picks the right tables, joins and status codes.
--
-- Every comment is applied via EXECUTE IMMEDIATE inside a safe block:
-- a table or column that does not exist in the deployed schema is
-- skipped silently, so this script is idempotent and drift-tolerant.
--
-- After running: clear the assistant's cached catalog (it refreshes
-- automatically after 24h, or clear localStorage key
-- 'reerp.ai.schemaCatalog').
-- ============================================================

DECLARE
    PROCEDURE tab (p_table IN VARCHAR2, p_txt IN VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE 'COMMENT ON TABLE ' || p_table || ' IS q''[' || p_txt || ']''';
    EXCEPTION WHEN OTHERS THEN NULL; -- table absent — skip
    END;
    PROCEDURE col (p_table IN VARCHAR2, p_col IN VARCHAR2, p_txt IN VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE 'COMMENT ON COLUMN ' || p_table || '.' || p_col || ' IS q''[' || p_txt || ']''';
    EXCEPTION WHEN OTHERS THEN NULL; -- column absent — skip
    END;
BEGIN
    -- ── GENERAL LEDGER ─────────────────────────────────────────────────────
    tab('RR_LEDGERS', 'Ledgers (chart of books). One row per ledger, e.g. BUIMERC LEDGER, SB LEDGER');
    col('RR_LEDGERS', 'LEDGER_ID',   'PK. Joins RR_GL_JE_HEADERS.LEDGER_ID and RR_ACCOUNTING_PERIODS_STATUS.LEDGER_ID');
    col('RR_LEDGERS', 'LEDGER_NAME', 'Ledger display name, e.g. BUIMERC LEDGER');
    col('RR_LEDGERS', 'CURRENCY_CODE', 'Ledger (functional) currency, e.g. AED');

    tab('RR_GL_JOURNAL_BATCHES', 'GL journal batches. One batch groups one or more journals (RR_GL_JE_HEADERS via BATCH_ID)');
    col('RR_GL_JOURNAL_BATCHES', 'JE_BATCH_ID',        'PK. RR_GL_JE_HEADERS.BATCH_ID references it');
    col('RR_GL_JOURNAL_BATCHES', 'STATUS',             'P = Posted, otherwise unposted (see STATUS_MEANING)');
    col('RR_GL_JOURNAL_BATCHES', 'STATUS_MEANING',     'Human status: Posted / Unposted');
    col('RR_GL_JOURNAL_BATCHES', 'DEFAULT_PERIOD_NAME','GL period in Mon-YY format, e.g. Aug-26');
    col('RR_GL_JOURNAL_BATCHES', 'BATCH_NAME',         'Batch name, e.g. Manual - 1000002073 or BANK-<id>-<ts>');
    col('RR_GL_JOURNAL_BATCHES', 'USER_JE_SOURCE_NAME','Journal source: Manual, Cash Management, Petty Cash, Fixed Assets, Payables, Receivables');
    col('RR_GL_JOURNAL_BATCHES', 'POSTED_DATE',        'When the batch was posted');

    tab('RR_GL_JE_HEADERS', 'GL journals (one per batch usually). Join RR_GL_JOURNAL_BATCHES on BATCH_ID = JE_BATCH_ID; lines in RR_GL_JE_LINES_ALL on JE_HEADER_ID');
    col('RR_GL_JE_HEADERS', 'JE_HEADER_ID',          'PK. RR_GL_JE_LINES_ALL.JE_HEADER_ID references it');
    col('RR_GL_JE_HEADERS', 'BATCH_ID',              'FK to RR_GL_JOURNAL_BATCHES.JE_BATCH_ID');
    col('RR_GL_JE_HEADERS', 'PERIOD_NAME',           'GL period in Mon-YY format, e.g. Aug-26');
    col('RR_GL_JE_HEADERS', 'LEDGER_ID',             'FK to RR_LEDGERS. May be a placeholder (1) on old FA journals — prefer LEDGER_NAME');
    col('RR_GL_JE_HEADERS', 'LEDGER_NAME',           'Ledger name, source of truth for the journal''s ledger');
    col('RR_GL_JE_HEADERS', 'USER_JE_CATEGORY_NAME', 'Journal category: Misc Transaction, Depreciation, Cash Management, Petty Cash, Revaluation, Assets ...');
    col('RR_GL_JE_HEADERS', 'USER_JE_SOURCE_NAME',   'Journal source: Manual, Fixed Assets, Cash Management, Petty Cash, Payables, Receivables');
    col('RR_GL_JE_HEADERS', 'CURRENCY_CODE',         'Entered currency of the journal');

    tab('RR_GL_JE_LINES_ALL', 'GL journal lines. Join RR_GL_JE_HEADERS on JE_HEADER_ID. REFERENCE1..5 identify the source document (see column comments)');
    col('RR_GL_JE_LINES_ALL', 'JE_HEADER_ID',        'FK to RR_GL_JE_HEADERS');
    col('RR_GL_JE_LINES_ALL', 'ACCOUNT_COMBINATION', 'Full GL account string, segments dash-separated, e.g. 01-00-00-1242137-0000-000-00-000-000. Segment 4 is the natural account');
    col('RR_GL_JE_LINES_ALL', 'ENTERED_DR',          'Debit in entered currency (null on credit lines)');
    col('RR_GL_JE_LINES_ALL', 'ENTERED_CR',          'Credit in entered currency (null on debit lines)');
    col('RR_GL_JE_LINES_ALL', 'ACCOUNTED_DR',        'Debit in ledger currency (AED)');
    col('RR_GL_JE_LINES_ALL', 'ACCOUNTED_CR',        'Credit in ledger currency (AED)');
    col('RR_GL_JE_LINES_ALL', 'REFERENCE1',          'Source doc no: bank txn number / PC voucher / asset number depending on REFERENCE5');
    col('RR_GL_JE_LINES_ALL', 'REFERENCE2',          'Source doc id: external transaction id (bank), distribution/asset ref (FA), register name (petty cash)');
    col('RR_GL_JE_LINES_ALL', 'REFERENCE3',          'Accounting class (DR/CR side label) or PETTY_CASH marker');
    col('RR_GL_JE_LINES_ALL', 'REFERENCE4',          'Business unit name (where populated)');
    col('RR_GL_JE_LINES_ALL', 'REFERENCE5',          'Source system marker: BANK_EXTERNAL_TRANSACTIONS, FA_DEPRECIATION, FA_ADDITIONS, or voucher no (petty cash)');

    tab('RR_ACCOUNTING_PERIODS_STATUS', 'Accounting period status per (period, application, ledger). CLOSING_STATUS: O=Open C=Closed F=Future N=Never Opened P=Permanently Closed');
    col('RR_ACCOUNTING_PERIODS_STATUS', 'PERIOD_NAME_ID', 'Period key: plain Mon-YY (Aug-26) for local ledgers or <set>_Mon-YY (16_Aug-26) for Fusion-synced rows — match both with LIKE');
    col('RR_ACCOUNTING_PERIODS_STATUS', 'APPLICATION_ID', '101=General Ledger, 200=Payables, 222=Receivables, 401=Inventory');
    col('RR_ACCOUNTING_PERIODS_STATUS', 'LEDGER_ID',      'FK to RR_LEDGERS');
    col('RR_ACCOUNTING_PERIODS_STATUS', 'CLOSING_STATUS', 'O=Open C=Closed F=Future N=Never Opened P=Permanently Closed');

    tab('RR_GL_BALANCES', 'GL balances by account/period/ledger (period activity and balances)');
    tab('RR_GL_BUSINESS_UNITS', 'Business units. LEGAL_ENTITY/LEDGER columns link a BU to its legal entity and ledger');
    tab('RR_GL_LEGAL_ENTITIES', 'Legal entities');
    tab('RR_GL_CATEGORIES', 'GL journal categories lookup');
    tab('RR_DIST_COMBINATIONS', 'Named distribution sets: shortcut name to a full GL account combination, used by AP invoice entry');
    tab('REERP_GL_CODE_COMBINATIONS', 'Chart of accounts code combinations (CCID to segment values and descriptions)');
    tab('RR_ERP_TRIALBALANCE', 'Trial balance snapshot rows (ledger, period, account, opening/period/closing amounts)');
    tab('RR_GL_RETAINED_EARNINGS', 'Retained earnings computation rows per ledger/period');

    -- ── SUBLEDGER ACCOUNTING (SLA) ─────────────────────────────────────────
    tab('RR_SLA_ACCOUNTING_HEADERS', 'Subledger accounting events. One per source doc accounting run; SOURCE_TABLE+SOURCE_ID point at the origin (e.g. RR_FA_ADDITIONS, RR_EXTERNAL_CASH_TRANSACTIONS)');
    col('RR_SLA_ACCOUNTING_HEADERS', 'EVENT_TYPE_CODE', 'e.g. FA_ADDITION, FA_DEPRECIATION, BANK_TXN');
    tab('RR_SLA_ACCOUNTING_LINES', 'Subledger accounting DR/CR lines for a header');

    -- ── ACCOUNTS PAYABLE ───────────────────────────────────────────────────
    tab('RR_AP_INVOICES_ALL', 'AP supplier invoices (header). Amounts, supplier, status, payment status');
    tab('RR_AP_INVOICE_LINES_ALL', 'AP invoice lines with distributions/accounts');
    tab('RR_AP_INVOICE_INSTALLMENTS', 'AP invoice installments (due dates, remaining amounts) — basis for outstanding balances');
    tab('RR_AP_INVOICE_MULTIPERIOD_SCHEDULE', 'Multiperiod accrual recognition schedule per AP invoice line');
    tab('RR_AP_PAYMENTS_ALL', 'AP payments (header): payment number, supplier, amount, date, bank account, status');
    tab('RR_AP_PAYMENTS_RELATED_INVOICES', 'Which invoices each AP payment paid (payment to invoice link)');
    tab('RR_AP_APPLIED_PREPAYMENTS', 'Prepayments applied to AP invoices');
    tab('RR_SUPPLIER_MASTER', 'Suppliers master (supplier number, name, status)');
    tab('RR_SUPPLIER_SITES', 'Supplier sites/addresses per supplier');

    -- ── ACCOUNTS RECEIVABLE ────────────────────────────────────────────────
    tab('RR_AR_INVOICE_HEADERS', 'AR customer invoices (header). Balance in INVOICE_BALANCE_AMOUNT; join lines/installments on CUSTOMER_TRANSACTION_ID');
    col('RR_AR_INVOICE_HEADERS', 'CUSTOMER_TRANSACTION_ID', 'PK. Lines, installments and receipt applications reference it');
    col('RR_AR_INVOICE_HEADERS', 'TRANSACTION_NUMBER',      'Invoice number shown to users');
    col('RR_AR_INVOICE_HEADERS', 'INVOICE_STATUS',          'Invoice status (e.g. Complete/Incomplete)');
    col('RR_AR_INVOICE_HEADERS', 'ENTERED_AMOUNT',          'Invoice total in entered currency');
    col('RR_AR_INVOICE_HEADERS', 'INVOICE_BALANCE_AMOUNT',  'Open (unpaid) balance');
    col('RR_AR_INVOICE_HEADERS', 'BILL_TO_CUSTOMER_NAME',   'Customer name');
    tab('RR_AR_INVOICE_LINES', 'AR invoice lines (item/description/amounts)');
    tab('RR_AR_INVOICE_DISTRIBUTIONS', 'AR invoice GL distributions (account combinations per line)');
    tab('RR_AR_INVOICE_INSTALLMENTS', 'AR invoice installments: due date, original and balance amounts — basis for customer outstanding');
    tab('RR_AR_RECEIPTS', 'AR customer receipts. AMOUNT = received; UNAPPLIED_AMOUNT = not yet applied to invoices');
    col('RR_AR_RECEIPTS', 'STANDARD_RECEIPT_ID', 'PK. RR_AR_RECEIPT_APPLICATIONS references it');
    col('RR_AR_RECEIPTS', 'STATE',  'Receipt state (e.g. APPLIED / UNAPPLIED / REVERSED)');
    col('RR_AR_RECEIPTS', 'STATUS', 'Receipt status');
    tab('RR_AR_RECEIPT_APPLICATIONS', 'Receipt-to-invoice applications: which invoices a receipt paid, with applied amounts');
    tab('RR_AR_ADJUSTMENTS', 'AR adjustments against invoices (write-offs etc.)');
    tab('RR_AR_CREDITMEMO_HEADERS', 'AR credit memos (header)');
    tab('RR_AR_TXN_TYPES', 'AR transaction types lookup');
    tab('RR_AR_PAYMENT_TERMS', 'AR payment terms lookup');

    -- ── CASH MANAGEMENT ────────────────────────────────────────────────────
    tab('RR_BANKS', 'Banks master');
    tab('RR_BANK_ACCOUNTS', 'Bank accounts: account number/name, currency, legal entity, GL cash account combination');
    tab('RR_BANK_STATEMENT_HEADER', 'Bank statements (header): bank account, statement number, dates, balances');
    tab('RR_BANK_STATEMENT_LINES', 'Bank statement lines: date, amount (sign = direction), description, reconciliation status and matched transaction refs');
    tab('RR_EXTERNAL_CASH_TRANSACTIONS', 'External/manual bank transactions. Negative AMOUNT = money out (DR), positive = money in (CR)');
    col('RR_EXTERNAL_CASH_TRANSACTIONS', 'EXTERNAL_TRANSACTION_ID', 'PK. GL lines reference it in REFERENCE2 with REFERENCE5=BANK_EXTERNAL_TRANSACTIONS');
    col('RR_EXTERNAL_CASH_TRANSACTIONS', 'ACCOUNTING_FLAG', 'Y = accounted (GL journal exists), N = not accounted');
    col('RR_EXTERNAL_CASH_TRANSACTIONS', 'RECONCILED_FLAG', 'Y = reconciled to a bank statement line');
    col('RR_EXTERNAL_CASH_TRANSACTIONS', 'STATUS', 'UNR = unreconciled; REC = reconciled; VOID = voided');
    col('RR_EXTERNAL_CASH_TRANSACTIONS', 'ASSET_ACCOUNT_COMBINATION',  'Bank/cash GL account of the transaction');
    col('RR_EXTERNAL_CASH_TRANSACTIONS', 'OFFSET_ACCOUNT_COMBINATION', 'Offset (expense/income) GL account');
    tab('RR_BANK_ACCOUNT_TRANSFERS', 'Bank-to-bank transfers');
    tab('RR_CURRENCY_DAILY_RATES', 'Daily FX rates (from/to currency, rate date, rate)');
    tab('RR_CURRENCY_LIST', 'Currencies lookup');

    -- ── FIXED ASSETS ───────────────────────────────────────────────────────
    tab('RR_FA_ADDITIONS', 'Fixed assets master: asset number, description, category, accounted status');
    col('RR_FA_ADDITIONS', 'ASSET_ID',        'PK. Books/history/deprn reference it');
    col('RR_FA_ADDITIONS', 'ASSET_NUMBER',    'Asset number shown to users, e.g. 100083');
    col('RR_FA_ADDITIONS', 'ACCOUNTED_STATUS','ACCOUNTED / UNACCOUNTED — whether the addition was posted to GL');
    tab('RR_FA_BOOKS', 'Asset financial data per book: cost, date placed in service, method, life');
    tab('RR_FA_BOOK_CONTROLS', 'Asset books setup: book type code, ledger (LEDGER_ID/LEDGER_NAME), currency, company code');
    tab('RR_FA_CATEGORIES_B', 'Asset categories');
    tab('RR_FA_CATEGORY_BOOKS', 'Category accounting per book: asset cost / clearing / expense / reserve account CCIDs');
    tab('RR_FA_DEPRN_DETAIL', 'Depreciation lines per asset per period, with accounted flag');
    tab('RR_FA_DEPRN_PERIODS', 'Depreciation periods per book (period name Mon-YY, open/closed)');
    tab('RR_FA_DEPRN_SUMMARY', 'Depreciation totals per asset (cost, YTD, reserve)');
    tab('RR_FA_RETIREMENTS', 'Asset retirements: retirement date, proceeds, cost retired, gain/loss');
    tab('RR_FA_ASSET_HISTORY', 'Asset change history (adjustments, transfers)');

    -- ── PETTY CASH ─────────────────────────────────────────────────────────
    tab('RR_PC_REGISTERS', 'Petty cash registers: name, business unit, currency, balance');
    tab('RR_PC_TRANSACTIONS', 'Petty cash transactions per register. DEBIT_AMOUNT = money into the register, CREDIT_AMOUNT = expense out');
    col('RR_PC_TRANSACTIONS', 'TRANSACTION_TYPE', 'Balance Refill / Balance Refund / Opening Fund Balance / expense types');
    col('RR_PC_TRANSACTIONS', 'POSTING_STATUS',   'Posted = accounted to GL, Unposted = not yet');
    col('RR_PC_TRANSACTIONS', 'BANK_TXN_ID',      'Link to RR_EXTERNAL_CASH_TRANSACTIONS.EXTERNAL_TRANSACTION_ID for bank-funded refills');
    col('RR_PC_TRANSACTIONS', 'CHARGE_ACCOUNT_DESC', 'GL account combination charged for expenses');
    col('RR_PC_TRANSACTIONS', 'REFERENCE_NO',     'Voucher number, e.g. R1-01');

    -- ── APPROVALS / ADMIN (context tables) ────────────────────────────────
    tab('RR_APPROVAL_REQUESTS', 'In-app approval requests (documents pending approval) with status');
    tab('RR_USER_ACCOUNTS', 'Application users');
    tab('RR_WEBSERVICES', 'Registered webservice catalog (admin)');

    DBMS_OUTPUT.PUT_LINE('AI schema comments applied (missing tables/columns skipped silently).');
END;
/
