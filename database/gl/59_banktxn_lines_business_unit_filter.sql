-- ============================================================
-- PATCH 59: Add business_unit filter and REFERENCE4 to banktxn-lines
--
-- Purpose:
--   GET /gl/journals/banktxn-lines now accepts business_unit param
--   (matched against REFERENCE4) and returns businessUnit in response.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run the BEGIN...END; block below.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/banktxn-lines',
            p_method      => 'GET'
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
    l_bank_acct   VARCHAR2(360) := :bank_account;
    l_bus_unit    VARCHAR2(360) := :business_unit;
    l_date_from   VARCHAR2(30)  := :date_from;
    l_date_to     VARCHAR2(30)  := :date_to;
    l_reconciled  VARCHAR2(1)   := :reconciled;
    l_limit       NUMBER        := NVL(TO_NUMBER(:row_limit), 500);
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
            l.REFERENCE4                                 AS BUSINESS_UNIT,
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
        WHERE (l_bank_acct IS NULL OR UPPER(l.REFERENCE7) LIKE '%' || UPPER(l_bank_acct) || '%')
          AND (l_bus_unit   IS NULL OR UPPER(l.REFERENCE4) LIKE '%' || UPPER(l_bus_unit)  || '%')
          AND (l_date_from  IS NULL OR h.ACCOUNTING_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
          AND (l_date_to    IS NULL OR h.ACCOUNTING_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
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
        APEX_JSON.WRITE('businessUnit',     r.BUSINESS_UNIT);
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
