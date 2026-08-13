-- ============================================================
-- Add ACCOUNTING_DATE (H.DEFAULT_EFFECTIVE_DATE) to view and
-- add from_date / to_date filter to the accountanalysis handler.
-- Note: RR_GL_JE_HEADERS uses DEFAULT_EFFECTIVE_DATE.
-- Run in APEX SQL Workshop.
-- ============================================================

-- Step 1: Recreate the view with ACCOUNTING_DATE column
CREATE OR REPLACE FORCE EDITIONABLE VIEW "V_GL_JOURNAL_LINES_SEGMENTS"
    ("BATCH_ID","JE_HEADER_ID","JE_LINE_NUMBER","CURRENCY_CODE",
     "ACCOUNT_COMBINATION","COMPANY","LOB","DEPARTMENT","ACCOUNT",
     "ACCOUNT_DESCRIPTION","SUB_ACCOUNT","ANALYSIS","INTERCOMPANY",
     "FUTURE1","FUTURE2","ENTERED_DR","ENTERED_CR","ACCOUNTED_DR",
     "ACCOUNTED_CR","CHART_OF_ACCOUNTS_NAME","DEFAULT_PERIOD_NAME",
     "BATCH_NAME","ACTUAL_FLAG_MEANING","APPROVAL_STATUS_MEANING",
     "USER_PERIOD_SET_NAME","USER_JE_SOURCE_NAME","LEDGER_NAME",
     "LEGAL_ENTITY_NAME","USER_JE_CATEGORY_NAME","ACCOUNTING_DATE") AS
SELECT
    L.BATCH_ID,
    L.JE_HEADER_ID,
    L.JE_LINE_NUMBER,
    L.CURRENCY_CODE,
    L.ACCOUNT_COMBINATION,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 1) AS COMPANY,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 2) AS LOB,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 3) AS DEPARTMENT,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 4) AS ACCOUNT,
    V.DESCRIPTION AS ACCOUNT_DESCRIPTION,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 5) AS SUB_ACCOUNT,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 6) AS ANALYSIS,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 7) AS INTERCOMPANY,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 8) AS FUTURE1,
    REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 9) AS FUTURE2,
    L.ENTERED_DR,
    L.ENTERED_CR,
    L.ACCOUNTED_DR,
    L.ACCOUNTED_CR,
    L.CHART_OF_ACCOUNTS_NAME,
    B.DEFAULT_PERIOD_NAME,
    B.BATCH_NAME,
    B.ACTUAL_FLAG_MEANING,
    B.APPROVAL_STATUS_MEANING,
    B.USER_PERIOD_SET_NAME,
    B.USER_JE_SOURCE_NAME,
    H.LEDGER_NAME,
    H.LEGAL_ENTITY_NAME,
    H.USER_JE_CATEGORY_NAME,
    H.DEFAULT_EFFECTIVE_DATE AS ACCOUNTING_DATE
FROM RR_GL_JE_LINES_ALL L
JOIN RR_GL_JE_HEADERS H ON L.JE_HEADER_ID = H.JE_HEADER_ID
JOIN RR_GL_JOURNAL_BATCHES B ON B.JE_BATCH_ID = L.BATCH_ID
LEFT JOIN RR_VALUE_SET_VALUES V
    ON V.VALUE = REGEXP_SUBSTR(L.ACCOUNT_COMBINATION, '[^-]+', 1, 4)
   AND V.VALUE_SET_CODE = 'BUIMERC_FIN_GLB_COA_ACCOUNT';
/

-- Step 2: Recreate the ORDS handler with accounting date filter + output
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/accountanalysis',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'GL Account Analysis — with accounting date filter',
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
    v_total_count   NUMBER := 0;
BEGIN
    v_offset := (v_page_number - 1) * v_page_size;

    APEX_JSON.OPEN_OBJECT;

    -- Total count
    SELECT COUNT(*) INTO v_total_count
    FROM V_GL_JOURNAL_LINES_SEGMENTS jls
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
      AND (v_from_date    IS NULL OR jls.ACCOUNTING_DATE      >= TO_DATE(v_from_date, 'YYYY-MM-DD'))
      AND (v_to_date      IS NULL OR jls.ACCOUNTING_DATE      <= TO_DATE(v_to_date,   'YYYY-MM-DD'));

    APEX_JSON.WRITE('totalCount',  v_total_count);
    APEX_JSON.WRITE('pageSize',    v_page_size);
    APEX_JSON.WRITE('pageNumber',  v_page_number);
    APEX_JSON.WRITE('totalPages',  CEIL(v_total_count / v_page_size));

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
            COALESCE(l.DESCRIPTION, h.JOURNAL_DESCRIPTION, h.JOURNAL_NAME) AS LINE_DESCRIPTION
        FROM V_GL_JOURNAL_LINES_SEGMENTS jls
        LEFT JOIN RR_GL_JE_LINES_ALL l
               ON l.JE_HEADER_ID  = jls.JE_HEADER_ID
              AND l.JE_LINE_NUMBER = jls.JE_LINE_NUMBER
        LEFT JOIN RR_GL_JE_HEADERS h
               ON h.JE_HEADER_ID  = jls.JE_HEADER_ID
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
          AND (v_from_date    IS NULL OR jls.ACCOUNTING_DATE      >= TO_DATE(v_from_date, 'YYYY-MM-DD'))
          AND (v_to_date      IS NULL OR jls.ACCOUNTING_DATE      <= TO_DATE(v_to_date,   'YYYY-MM-DD'))
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
