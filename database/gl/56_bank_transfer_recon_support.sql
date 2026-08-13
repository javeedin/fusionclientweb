-- ============================================================
-- PATCH 56: Bank Transfer Reconciliation Support
--
-- Purpose:
--   Enable GL journal lines to be used for bank statement
--   reconciliation of bank transfers.
--
-- Changes:
--   1. Add RECONCILED_FLAG to RR_GL_LINES_ALL
--   2. Add REFERENCE7 (bank account name) to journals/create handler
--   3. New endpoint: GET /gl/journals/banktxn-lines
--      Returns GL lines where REFERENCE7 matches a bank account,
--      used by the bank recon page instead of cash/banktransfers.
--
-- HOW TO RUN:
--   SQL Workshop → SQL Commands
--   Copy each BEGIN...END; block and run separately.
--   Expected: "PL/SQL procedure successfully completed."
-- ============================================================


-- ── STEP 1: Add RECONCILED_FLAG to RR_GL_LINES_ALL ──────────────────────────
-- Run this block first.
BEGIN
    EXECUTE IMMEDIATE '
        ALTER TABLE RR_GL_LINES_ALL
        ADD RECONCILED_FLAG VARCHAR2(1) DEFAULT ''N'' NOT NULL
    ';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -01430 THEN NULL; -- column already exists
        ELSE RAISE;
        END IF;
END;
/


-- ── STEP 2: Update journals/create handler to store REFERENCE7 ──────────────
-- This replaces the INSERT in the journals/create handler so that
-- REFERENCE7 (bank account name for bank transfers) is persisted.
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'journals/create',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'journals/create',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Create a GL journal batch + header + lines',
        p_source         => q'[
DECLARE
    v_body          CLOB          := :body_text;
    v_root          APEX_JSON.t_values;

    v_batch_name    VARCHAR2(240);
    v_je_batch_id   NUMBER;
    v_je_header_id  NUMBER;
    v_header        APEX_JSON.t_values;
    v_currency      VARCHAR2(15);
    v_conv_rate     NUMBER;
    v_acctg_date    DATE;
    v_created_by    VARCHAR2(100) := 'ERP_USER';
    v_period_name   VARCHAR2(40);
    v_ledger_id     NUMBER;
    v_ledger_name   VARCHAR2(240);
    v_je_source     VARCHAR2(100);
    v_je_category   VARCHAR2(100);
    v_legal_entity  VARCHAR2(240);
    v_business_unit VARCHAR2(240);

    v_lines         APEX_JSON.t_values;
    v_line          APEX_JSON.t_values;
    v_line_count    NUMBER;
    v_line_num      NUMBER := 0;
BEGIN
    APEX_JSON.PARSE(v_root, v_body);

    -- ── Batch ──
    v_batch_name    := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'batchName');
    v_period_name   := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'periodName');
    v_ledger_id     := NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'ledgerId'), 1);
    v_ledger_name   := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'ledgerName'), 'BUIMERC LEDGER');
    v_currency      := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'currency'), 'AED');
    v_conv_rate     := NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'conversionRate'), 1);
    v_acctg_date    := NVL(TO_DATE(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'accountingDate'), 'YYYY-MM-DD'), SYSDATE);
    v_je_source     := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'jeSource'), 'Cash Management');
    v_je_category   := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'jeCategory'), 'Bank Transfer');
    v_legal_entity  := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'legalEntity');
    v_business_unit := APEX_JSON.get_varchar2(p_values => v_root, p_path => 'businessUnit');
    v_created_by    := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'createdBy'), 'ERP_USER');

    -- ── Batch ID (reuse sequence) ──
    SELECT NVL(MAX(JE_BATCH_ID), 0) + 1
      INTO v_je_batch_id
      FROM RR_GL_JE_BATCHES;

    INSERT INTO RR_GL_JE_BATCHES (
        JE_BATCH_ID, NAME, STATUS, PERIOD_NAME, ACTUAL_FLAG,
        DEFAULT_PERIOD_NAME, SET_OF_BOOKS_ID,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
        DESCRIPTION
    ) VALUES (
        v_je_batch_id,
        v_batch_name,
        'Posted',
        v_period_name,
        'A',
        v_period_name,
        v_ledger_id,
        SYSDATE, v_created_by, SYSDATE, v_created_by,
        APEX_JSON.get_varchar2(p_values => v_root, p_path => 'batchDescription')
    );

    -- ── Header ID (sequence) ──
    SELECT RR_JE_HEADER_ID_SEQ.NEXTVAL INTO v_je_header_id FROM DUAL;

    INSERT INTO RR_GL_JE_HEADERS (
        JE_HEADER_ID, JE_BATCH_ID, NAME, STATUS,
        LEDGER_ID, LEDGER_NAME,
        PERIOD_NAME, DEFAULT_PERIOD_NAME,
        CURRENCY_CODE, CURRENCY_CONVERSION_RATE, CURRENCY_CONVERSION_TYPE,
        ACTUAL_FLAG, JE_SOURCE, JE_CATEGORY,
        ACCOUNTING_DATE, DEFAULT_EFFECTIVE_DATE,
        LEGAL_ENTITY_NAME, LEGAL_ENTITY_ID, ORG_ID,
        CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY,
        DESCRIPTION, RUNNING_TOTAL_DR, RUNNING_TOTAL_CR,
        RUNNING_TOTAL_ACCOUNTED_DR, RUNNING_TOTAL_ACCOUNTED_CR
    ) VALUES (
        v_je_header_id, v_je_batch_id,
        NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'journalName'), v_batch_name),
        'Posted',
        v_ledger_id, v_ledger_name,
        v_period_name, v_period_name,
        v_currency, v_conv_rate, 'User',
        'A', v_je_source, v_je_category,
        v_acctg_date, v_acctg_date,
        v_legal_entity, NULL, NULL,
        SYSDATE, v_created_by, SYSDATE, v_created_by,
        APEX_JSON.get_varchar2(p_values => v_root, p_path => 'journalDescription'),
        0, 0, 0, 0
    );

    -- ── Lines ──
    v_line_count := APEX_JSON.get_count(p_values => v_root, p_path => 'lines');

    FOR i IN 1 .. NVL(v_line_count, 0) LOOP
        v_line_num := v_line_num + 1;

        INSERT INTO RR_GL_LINES_ALL (
            JE_HEADER_ID, JE_LINE_NUMBER, BATCH_ID,
            ENTERED_DR, ENTERED_CR, ACCOUNTED_DR, ACCOUNTED_CR,
            DESCRIPTION, CURRENCY_CODE, ACCOUNT_COMBINATION,
            CHART_OF_ACCOUNTS_NAME,
            REFERENCE1, REFERENCE2, REFERENCE3, REFERENCE4, REFERENCE5,
            REFERENCE7,
            RECONCILED_FLAG,
            CREATED_BY
        ) VALUES (
            v_je_header_id, v_line_num, v_je_batch_id,
            APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredDr',  p0 => i),
            APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredCr',  p0 => i),
            NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].accountedDr', p0 => i),
                APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredDr',   p0 => i)),
            NVL(APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].accountedCr', p0 => i),
                APEX_JSON.get_number(p_values => v_root, p_path => 'lines[%d].enteredCr',   p0 => i)),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].description',        p0 => i),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].currencyCode',   p0 => i), v_currency),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].accountCombination', p0 => i),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].chartOfAccountsName', p0 => i), 'Chart of Accounts'),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference1', p0 => i),
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference2', p0 => i), v_batch_name),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference3', p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference4', p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference5', p0 => i),
            APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].reference7', p0 => i),
            'N',
            NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'lines[%d].createdBy', p0 => i), v_created_by)
        );
    END LOOP;

    COMMIT;

    :status_code := 201;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',       TRUE);
    APEX_JSON.WRITE('jeBatchId',     v_je_batch_id);
    APEX_JSON.WRITE('jeHeaderId',    v_je_header_id);
    APEX_JSON.WRITE('linesInserted', v_line_num);
    APEX_JSON.WRITE('batchName',     v_batch_name);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('message', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ── STEP 3: New endpoint GET /gl/journals/banktxn-lines ─────────────────────
-- Returns GL journal lines tagged with a bank account (REFERENCE7).
-- Used by the bank recon page for reconciling bank transfers.
-- Query params:
--   bank_account  (required) — matches REFERENCE7 (exact or LIKE)
--   date_from     (optional) — YYYY-MM-DD
--   date_to       (optional) — YYYY-MM-DD
--   reconciled    (optional) — Y / N (omit for all)
--   row_limit     (optional) — default 500
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/banktxn-lines',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/banktxn-lines',
            p_priority    => 0,
            p_etag_type   => 'HASH'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/banktxn-lines',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'GL journal lines for bank transfer reconciliation (REFERENCE7 = bank account)',
        p_source         => q'[
DECLARE
    l_bank_acct  VARCHAR2(360) := :bank_account;
    l_date_from  VARCHAR2(30)  := :date_from;
    l_date_to    VARCHAR2(30)  := :date_to;
    l_reconciled VARCHAR2(1)   := :reconciled;
    l_limit      NUMBER        := NVL(TO_NUMBER(:row_limit), 500);
BEGIN
    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status', 'success');
    APEX_JSON.OPEN_ARRAY('items');

    FOR r IN (
        SELECT
            l.JE_LINE_NUMBER,
            l.JE_HEADER_ID,
            l.BATCH_ID,
            h.NAME                                       AS JOURNAL_NAME,
            b.NAME                                       AS BATCH_NAME,
            l.REFERENCE1                                 AS SOURCE_NUMBER,
            l.REFERENCE2                                 AS SOURCE_NAME,
            l.REFERENCE3                                 AS ACCOUNTING_CLASS,
            l.REFERENCE5                                 AS EVENT_TYPE,
            l.REFERENCE7                                 AS BANK_ACCOUNT_NAME,
            l.DESCRIPTION,
            l.CURRENCY_CODE,
            l.ENTERED_DR,
            l.ENTERED_CR,
            l.ACCOUNTED_DR,
            l.ACCOUNTED_CR,
            NVL(l.RECONCILED_FLAG, 'N')                 AS RECONCILED_FLAG,
            TO_CHAR(h.ACCOUNTING_DATE, 'YYYY-MM-DD')    AS ACCOUNTING_DATE,
            h.PERIOD_NAME,
            h.JE_SOURCE,
            h.JE_CATEGORY,
            h.LEDGER_NAME,
            l.CREATED_BY,
            TO_CHAR(l.CREATION_DATE, 'YYYY-MM-DD')      AS CREATION_DATE
        FROM RR_GL_LINES_ALL     l
        JOIN RR_GL_JE_HEADERS    h ON h.JE_HEADER_ID = l.JE_HEADER_ID
        JOIN RR_GL_JE_BATCHES    b ON b.JE_BATCH_ID  = l.BATCH_ID
        WHERE UPPER(l.REFERENCE7) LIKE '%' || UPPER(l_bank_acct) || '%'
          AND (l_date_from IS NULL OR h.ACCOUNTING_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
          AND (l_date_to   IS NULL OR h.ACCOUNTING_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
          AND (l_reconciled IS NULL OR NVL(l.RECONCILED_FLAG, 'N') = l_reconciled)
        ORDER BY h.ACCOUNTING_DATE DESC, l.JE_HEADER_ID DESC, l.JE_LINE_NUMBER
        FETCH FIRST l_limit ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('jeLineNumber',     r.JE_LINE_NUMBER);
        APEX_JSON.WRITE('jeHeaderId',       r.JE_HEADER_ID);
        APEX_JSON.WRITE('batchId',          r.BATCH_ID);
        APEX_JSON.WRITE('journalName',      r.JOURNAL_NAME);
        APEX_JSON.WRITE('batchName',        r.BATCH_NAME);
        APEX_JSON.WRITE('sourceNumber',     r.SOURCE_NUMBER);
        APEX_JSON.WRITE('sourceName',       r.SOURCE_NAME);
        APEX_JSON.WRITE('accountingClass',  r.ACCOUNTING_CLASS);
        APEX_JSON.WRITE('eventType',        r.EVENT_TYPE);
        APEX_JSON.WRITE('bankAccountName',  r.BANK_ACCOUNT_NAME);
        APEX_JSON.WRITE('description',      r.DESCRIPTION);
        APEX_JSON.WRITE('currencyCode',     r.CURRENCY_CODE);
        APEX_JSON.WRITE('enteredDr',        r.ENTERED_DR);
        APEX_JSON.WRITE('enteredCr',        r.ENTERED_CR);
        APEX_JSON.WRITE('accountedDr',      r.ACCOUNTED_DR);
        APEX_JSON.WRITE('accountedCr',      r.ACCOUNTED_CR);
        APEX_JSON.WRITE('reconciledFlag',   r.RECONCILED_FLAG);
        APEX_JSON.WRITE('accountingDate',   r.ACCOUNTING_DATE);
        APEX_JSON.WRITE('periodName',       r.PERIOD_NAME);
        APEX_JSON.WRITE('jeSource',         r.JE_SOURCE);
        APEX_JSON.WRITE('jeCategory',       r.JE_CATEGORY);
        APEX_JSON.WRITE('ledgerName',       r.LEDGER_NAME);
        APEX_JSON.WRITE('createdBy',        r.CREATED_BY);
        APEX_JSON.WRITE('creationDate',     r.CREATION_DATE);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  'error');
    APEX_JSON.WRITE('message', SQLERRM);
    APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ── STEP 4: Endpoint to mark a GL line as reconciled ────────────────────────
-- PUT /gl/journals/lines/:jeHeaderId/:jeLineNumber/reconcile
-- Body: { "reconciled": "Y" or "N", "updatedBy": "user" }
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/lines/:jeHeaderId/:jeLineNumber/reconcile',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/lines/:jeHeaderId/:jeLineNumber/reconcile',
            p_priority    => 0,
            p_etag_type   => 'HASH'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/lines/:jeHeaderId/:jeLineNumber/reconcile',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Mark a GL journal line as reconciled / unreconciled',
        p_source         => q'[
DECLARE
    v_body       CLOB := :body_text;
    v_reconciled VARCHAR2(1);
    v_updated_by VARCHAR2(100);
    v_root       APEX_JSON.t_values;
BEGIN
    APEX_JSON.PARSE(v_root, v_body);
    v_reconciled := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'reconciled'), 'Y');
    v_updated_by := NVL(APEX_JSON.get_varchar2(p_values => v_root, p_path => 'updatedBy'), 'ERP_USER');

    UPDATE RR_GL_LINES_ALL
       SET RECONCILED_FLAG  = v_reconciled,
           LAST_UPDATED_BY  = v_updated_by,
           LAST_UPDATE_DATE = SYSDATE
     WHERE JE_HEADER_ID  = :jeHeaderId
       AND JE_LINE_NUMBER = :jeLineNumber;

    IF SQL%ROWCOUNT = 0 THEN
        :status_code := 404;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',  'error');
        APEX_JSON.WRITE('message', 'Journal line not found');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    COMMIT;
    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  'success');
    APEX_JSON.WRITE('message', 'Reconciled flag updated');
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',  'error');
    APEX_JSON.WRITE('message', SQLERRM);
    APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/
