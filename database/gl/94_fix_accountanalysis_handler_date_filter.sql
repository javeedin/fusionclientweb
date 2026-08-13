-- =============================================================================
-- PATCH 94: Redeploy gl/accountanalysis ORDS handler
--
-- FIXES:
--   1. Use < to_date + 1 instead of <= to_date to include all records on the
--      last day regardless of time component on ACCOUNTING_DATE.
--   2. Remove second COUNT query (doubles the scan) — use totalCount = null
--      and rely on client page logic.
--   3. LINE_DESCRIPTION fetched directly from RR_GL_JE_LINES_ALL (correct table).
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
-- =============================================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/accountanalysis',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'GL Account Analysis — date or period filter',
        p_source         => q'[
DECLARE
    v_ledger_name   VARCHAR2(240)  := :ledger_name;
    v_period_names  VARCHAR2(4000) := :period_names;
    v_company       VARCHAR2(25)   := :company;
    v_lob           VARCHAR2(25)   := :lob;
    v_department    VARCHAR2(25)   := :department;
    v_account       VARCHAR2(25)   := :account;
    v_sub_account   VARCHAR2(25)   := :sub_account;
    v_analysis      VARCHAR2(25)   := :analysis;
    v_intercompany  VARCHAR2(25)   := :intercompany;
    v_je_source     VARCHAR2(240)  := :je_source;
    v_je_category   VARCHAR2(240)  := :je_category;
    v_from_date     VARCHAR2(30)   := :from_date;
    v_to_date       VARCHAR2(30)   := :to_date;
    v_page_size     NUMBER := NVL(:page_size,   500);
    v_page_number   NUMBER := NVL(:page_number, 1);
    v_offset        NUMBER;
    v_d_from        DATE;
    v_d_to          DATE;
BEGIN
    v_offset := (v_page_number - 1) * v_page_size;

    -- Parse dates once; v_d_to is set to start of next day so < covers full last day
    IF v_from_date IS NOT NULL THEN
        v_d_from := TO_DATE(v_from_date, 'YYYY-MM-DD');
    END IF;
    IF v_to_date IS NOT NULL THEN
        v_d_to := TO_DATE(v_to_date, 'YYYY-MM-DD') + 1;
    END IF;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.OPEN_ARRAY('items');

    FOR rec IN (
        SELECT
            jls.BATCH_ID,
            jls.JE_HEADER_ID,
            jls.JE_LINE_NUMBER,
            jls.CURRENCY_CODE,
            jls.COMPANY,
            jls.LOB,
            jls.DEPARTMENT,
            jls.ACCOUNT,
            jls.ACCOUNT_DESCRIPTION,
            jls.SUB_ACCOUNT,
            jls.ANALYSIS,
            jls.INTERCOMPANY,
            jls.FUTURE1,
            jls.FUTURE2,
            jls.ENTERED_DR,
            jls.ENTERED_CR,
            jls.ACCOUNTED_DR,
            jls.ACCOUNTED_CR,
            jls.CHART_OF_ACCOUNTS_NAME,
            jls.DEFAULT_PERIOD_NAME,
            TO_CHAR(jls.ACCOUNTING_DATE, 'DD-MON-YYYY') AS ACCOUNTING_DATE,
            jls.BATCH_NAME,
            jls.ACTUAL_FLAG_MEANING,
            jls.APPROVAL_STATUS_MEANING,
            jls.USER_PERIOD_SET_NAME,
            jls.USER_JE_SOURCE_NAME,
            jls.LEDGER_NAME,
            jls.LEGAL_ENTITY_NAME,
            jls.USER_JE_CATEGORY_NAME,
            l.DESCRIPTION                               AS LINE_DESCRIPTION
        FROM V_GL_JOURNAL_LINES_SEGMENTS jls
        LEFT JOIN RR_GL_JE_LINES_ALL l
               ON l.JE_HEADER_ID  = jls.JE_HEADER_ID
              AND l.JE_LINE_NUMBER = jls.JE_LINE_NUMBER
        WHERE (v_ledger_name  IS NULL OR jls.LEDGER_NAME           = v_ledger_name)
          AND (v_period_names IS NULL OR jls.DEFAULT_PERIOD_NAME   IN (
                   SELECT TRIM(REGEXP_SUBSTR(v_period_names,'[^,]+',1,LEVEL))
                   FROM DUAL
                   CONNECT BY REGEXP_SUBSTR(v_period_names,'[^,]+',1,LEVEL) IS NOT NULL))
          AND (v_company      IS NULL OR jls.COMPANY               = v_company)
          AND (v_lob          IS NULL OR jls.LOB                   = v_lob)
          AND (v_department   IS NULL OR jls.DEPARTMENT            = v_department)
          AND (v_account      IS NULL OR jls.ACCOUNT               = v_account)
          AND (v_sub_account  IS NULL OR jls.SUB_ACCOUNT           = v_sub_account)
          AND (v_analysis     IS NULL OR jls.ANALYSIS              = v_analysis)
          AND (v_intercompany IS NULL OR jls.INTERCOMPANY          = v_intercompany)
          AND (v_je_source    IS NULL OR jls.USER_JE_SOURCE_NAME   = v_je_source)
          AND (v_je_category  IS NULL OR jls.USER_JE_CATEGORY_NAME = v_je_category)
          AND (v_d_from       IS NULL OR jls.ACCOUNTING_DATE      >= v_d_from)
          AND (v_d_to         IS NULL OR jls.ACCOUNTING_DATE       < v_d_to)
        ORDER BY jls.ACCOUNTING_DATE, jls.DEFAULT_PERIOD_NAME, jls.BATCH_NAME, jls.JE_LINE_NUMBER
        OFFSET v_offset ROWS FETCH NEXT v_page_size ROWS ONLY
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('batchId',               rec.BATCH_ID);
        APEX_JSON.WRITE('jeHeaderId',            rec.JE_HEADER_ID);
        APEX_JSON.WRITE('jeLineNumber',          rec.JE_LINE_NUMBER);
        APEX_JSON.WRITE('currencyCode',          rec.CURRENCY_CODE);
        APEX_JSON.WRITE('company',               rec.COMPANY);
        APEX_JSON.WRITE('lob',                   rec.LOB);
        APEX_JSON.WRITE('department',            rec.DEPARTMENT);
        APEX_JSON.WRITE('account',               rec.ACCOUNT);
        APEX_JSON.WRITE('accountDescription',    rec.ACCOUNT_DESCRIPTION);
        APEX_JSON.WRITE('subAccount',            rec.SUB_ACCOUNT);
        APEX_JSON.WRITE('analysis',              rec.ANALYSIS);
        APEX_JSON.WRITE('intercompany',          rec.INTERCOMPANY);
        APEX_JSON.WRITE('future1',               rec.FUTURE1);
        APEX_JSON.WRITE('future2',               rec.FUTURE2);
        APEX_JSON.WRITE('enteredDr',             rec.ENTERED_DR);
        APEX_JSON.WRITE('enteredCr',             rec.ENTERED_CR);
        APEX_JSON.WRITE('accountedDr',           rec.ACCOUNTED_DR);
        APEX_JSON.WRITE('accountedCr',           rec.ACCOUNTED_CR);
        APEX_JSON.WRITE('chartOfAccountsName',   rec.CHART_OF_ACCOUNTS_NAME);
        APEX_JSON.WRITE('defaultPeriodName',     rec.DEFAULT_PERIOD_NAME);
        APEX_JSON.WRITE('accountingDate',        rec.ACCOUNTING_DATE);
        APEX_JSON.WRITE('batchName',             rec.BATCH_NAME);
        APEX_JSON.WRITE('actualFlagMeaning',     rec.ACTUAL_FLAG_MEANING);
        APEX_JSON.WRITE('approvalStatusMeaning', rec.APPROVAL_STATUS_MEANING);
        APEX_JSON.WRITE('userPeriodSetName',     rec.USER_PERIOD_SET_NAME);
        APEX_JSON.WRITE('userJeSourceName',      rec.USER_JE_SOURCE_NAME);
        APEX_JSON.WRITE('ledgerName',            rec.LEDGER_NAME);
        APEX_JSON.WRITE('legalEntityName',       rec.LEGAL_ENTITY_NAME);
        APEX_JSON.WRITE('userJeCategoryName',    rec.USER_JE_CATEGORY_NAME);
        APEX_JSON.WRITE('description',           rec.LINE_DESCRIPTION);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/
