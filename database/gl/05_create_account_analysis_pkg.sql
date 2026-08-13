-- ============================================================
-- Package: REERP_ACCOUNT_ANALYSIS_PKG
-- Purpose: Account Analysis procedures for GL Journal Lines
-- ============================================================

CREATE OR REPLACE PACKAGE REERP_ACCOUNT_ANALYSIS_PKG AS

    -- Get Journal Lines with Segments (main search)
    PROCEDURE get_journal_lines_segments(
        p_ledger_name       IN VARCHAR2 DEFAULT NULL,
        p_period_names      IN VARCHAR2 DEFAULT NULL,  -- Comma-separated
        p_company           IN VARCHAR2 DEFAULT NULL,
        p_lob               IN VARCHAR2 DEFAULT NULL,
        p_department        IN VARCHAR2 DEFAULT NULL,
        p_account           IN VARCHAR2 DEFAULT NULL,
        p_sub_account       IN VARCHAR2 DEFAULT NULL,
        p_analysis          IN VARCHAR2 DEFAULT NULL,
        p_intercompany      IN VARCHAR2 DEFAULT NULL,
        p_je_source         IN VARCHAR2 DEFAULT NULL,
        p_je_category       IN VARCHAR2 DEFAULT NULL,
        p_page_size         IN NUMBER DEFAULT 500,
        p_page_number       IN NUMBER DEFAULT 1
    );

    -- Get distinct periods for dropdown
    PROCEDURE get_distinct_periods;

    -- Get distinct ledgers for dropdown
    PROCEDURE get_distinct_ledgers;

    -- Get all distinct segment values for dropdowns
    PROCEDURE get_distinct_segments;

    -- Get pivot data for account analysis
    PROCEDURE get_pivot_data(
        p_ledger_name       IN VARCHAR2 DEFAULT NULL,
        p_period_names      IN VARCHAR2 DEFAULT NULL,  -- Comma-separated
        p_company           IN VARCHAR2 DEFAULT NULL,
        p_lob               IN VARCHAR2 DEFAULT NULL,
        p_department        IN VARCHAR2 DEFAULT NULL,
        p_account           IN VARCHAR2 DEFAULT NULL,
        p_sub_account       IN VARCHAR2 DEFAULT NULL,
        p_analysis          IN VARCHAR2 DEFAULT NULL,
        p_intercompany      IN VARCHAR2 DEFAULT NULL
    );

END REERP_ACCOUNT_ANALYSIS_PKG;
/

CREATE OR REPLACE PACKAGE BODY REERP_ACCOUNT_ANALYSIS_PKG AS

    -- ============================================================
    -- Get Journal Lines with Segments (main search)
    -- ============================================================
    PROCEDURE get_journal_lines_segments(
        p_ledger_name       IN VARCHAR2 DEFAULT NULL,
        p_period_names      IN VARCHAR2 DEFAULT NULL,
        p_company           IN VARCHAR2 DEFAULT NULL,
        p_lob               IN VARCHAR2 DEFAULT NULL,
        p_department        IN VARCHAR2 DEFAULT NULL,
        p_account           IN VARCHAR2 DEFAULT NULL,
        p_sub_account       IN VARCHAR2 DEFAULT NULL,
        p_analysis          IN VARCHAR2 DEFAULT NULL,
        p_intercompany      IN VARCHAR2 DEFAULT NULL,
        p_je_source         IN VARCHAR2 DEFAULT NULL,
        p_je_category       IN VARCHAR2 DEFAULT NULL,
        p_page_size         IN NUMBER DEFAULT 500,
        p_page_number       IN NUMBER DEFAULT 1
    ) IS
        v_offset        NUMBER;
        v_total_count   NUMBER := 0;
    BEGIN
        v_offset := (p_page_number - 1) * p_page_size;

        -- Get total count
        SELECT COUNT(*) INTO v_total_count
        FROM V_GL_JOURNAL_LINES_SEGMENTS jls
        WHERE (p_ledger_name IS NULL OR jls.LEDGER_NAME = p_ledger_name)
          AND (p_period_names IS NULL OR jls.DEFAULT_PERIOD_NAME IN (
               SELECT TRIM(REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL))
               FROM DUAL
               CONNECT BY REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL) IS NOT NULL
          ))
          AND (p_company IS NULL OR jls.COMPANY = p_company)
          AND (p_lob IS NULL OR jls.LOB = p_lob)
          AND (p_department IS NULL OR jls.DEPARTMENT = p_department)
          AND (p_account IS NULL OR jls.ACCOUNT = p_account)
          AND (p_sub_account IS NULL OR jls.SUB_ACCOUNT = p_sub_account)
          AND (p_analysis IS NULL OR jls.ANALYSIS = p_analysis)
          AND (p_intercompany IS NULL OR jls.INTERCOMPANY = p_intercompany)
          AND (p_je_source IS NULL OR jls.USER_JE_SOURCE_NAME = p_je_source)
          AND (p_je_category IS NULL OR jls.USER_JE_CATEGORY_NAME = p_je_category)
          AND jls.APPROVAL_STATUS_MEANING = 'Posted';


        -- Build JSON response
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('totalCount', v_total_count);
        APEX_JSON.WRITE('pageSize', p_page_size);
        APEX_JSON.WRITE('pageNumber', p_page_number);
        APEX_JSON.WRITE('totalPages', CEIL(v_total_count / p_page_size));

        APEX_JSON.OPEN_ARRAY('items');

        FOR rec IN (
            SELECT
                jls.BATCH_ID,
                jls.JE_HEADER_ID,
                jls.JE_LINE_NUMBER,
                COALESCE(gl.DESCRIPTION, h.JOURNAL_DESCRIPTION, h.JOURNAL_NAME) AS DESCRIPTION,
                jls.CURRENCY_CODE,
                jls.COMPANY,
                jls.LOB,
                jls.DEPARTMENT,
                jls.ACCOUNT,
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
                jls.BATCH_NAME,
                jls.ACTUAL_FLAG_MEANING,
                jls.APPROVAL_STATUS_MEANING,
                jls.USER_PERIOD_SET_NAME,
                jls.USER_JE_SOURCE_NAME,
                jls.LEDGER_NAME,
                jls.LEGAL_ENTITY_NAME,
                jls.USER_JE_CATEGORY_NAME
            FROM V_GL_JOURNAL_LINES_SEGMENTS jls
            LEFT JOIN RR_GL_JE_LINES_ALL gl
                   ON gl.JE_HEADER_ID  = jls.JE_HEADER_ID
                  AND gl.JE_LINE_NUMBER = jls.JE_LINE_NUMBER
            LEFT JOIN RR_GL_JE_HEADERS h
                   ON h.JE_HEADER_ID   = jls.JE_HEADER_ID
            WHERE (p_ledger_name IS NULL OR jls.LEDGER_NAME = p_ledger_name)
              AND (p_period_names IS NULL OR jls.DEFAULT_PERIOD_NAME IN (
                   SELECT TRIM(REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL))
                   FROM DUAL
                   CONNECT BY REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL) IS NOT NULL
              ))
              AND (p_company IS NULL OR jls.COMPANY = p_company)
              AND (p_lob IS NULL OR jls.LOB = p_lob)
              AND (p_department IS NULL OR jls.DEPARTMENT = p_department)
              AND (p_account IS NULL OR jls.ACCOUNT = p_account)
              AND (p_sub_account IS NULL OR jls.SUB_ACCOUNT = p_sub_account)
              AND (p_analysis IS NULL OR jls.ANALYSIS = p_analysis)
              AND (p_intercompany IS NULL OR jls.INTERCOMPANY = p_intercompany)
              AND (p_je_source IS NULL OR jls.USER_JE_SOURCE_NAME = p_je_source)
              AND (p_je_category IS NULL OR jls.USER_JE_CATEGORY_NAME = p_je_category)
              AND jls.APPROVAL_STATUS_MEANING = 'Posted'
            ORDER BY jls.DEFAULT_PERIOD_NAME, jls.BATCH_NAME, jls.JE_LINE_NUMBER
            OFFSET v_offset ROWS FETCH NEXT p_page_size ROWS ONLY
        ) LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('batchId', rec.BATCH_ID);
            APEX_JSON.WRITE('jeHeaderId', rec.JE_HEADER_ID);
            APEX_JSON.WRITE('jeLineNumber', rec.JE_LINE_NUMBER);
            APEX_JSON.WRITE('description', rec.DESCRIPTION);
            APEX_JSON.WRITE('currencyCode', rec.CURRENCY_CODE);
            APEX_JSON.WRITE('company', rec.COMPANY);
            APEX_JSON.WRITE('lob', rec.LOB);
            APEX_JSON.WRITE('department', rec.DEPARTMENT);
            APEX_JSON.WRITE('account', rec.ACCOUNT);
            APEX_JSON.WRITE('subAccount', rec.SUB_ACCOUNT);
            APEX_JSON.WRITE('analysis', rec.ANALYSIS);
            APEX_JSON.WRITE('intercompany', rec.INTERCOMPANY);
            APEX_JSON.WRITE('future1', rec.FUTURE1);
            APEX_JSON.WRITE('future2', rec.FUTURE2);
            APEX_JSON.WRITE('enteredDr', rec.ENTERED_DR);
            APEX_JSON.WRITE('enteredCr', rec.ENTERED_CR);
            APEX_JSON.WRITE('accountedDr', rec.ACCOUNTED_DR);
            APEX_JSON.WRITE('accountedCr', rec.ACCOUNTED_CR);
            APEX_JSON.WRITE('chartOfAccountsName', rec.CHART_OF_ACCOUNTS_NAME);
            APEX_JSON.WRITE('defaultPeriodName', rec.DEFAULT_PERIOD_NAME);
            APEX_JSON.WRITE('batchName', rec.BATCH_NAME);
            APEX_JSON.WRITE('actualFlagMeaning', rec.ACTUAL_FLAG_MEANING);
            APEX_JSON.WRITE('approvalStatusMeaning', rec.APPROVAL_STATUS_MEANING);
            APEX_JSON.WRITE('userPeriodSetName', rec.USER_PERIOD_SET_NAME);
            APEX_JSON.WRITE('userJeSourceName', rec.USER_JE_SOURCE_NAME);
            APEX_JSON.WRITE('ledgerName', rec.LEDGER_NAME);
            APEX_JSON.WRITE('legalEntityName', rec.LEGAL_ENTITY_NAME);
            APEX_JSON.WRITE('userJeCategoryName', rec.USER_JE_CATEGORY_NAME);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;

    END get_journal_lines_segments;

    -- ============================================================
    -- Get distinct periods for dropdown
    -- ============================================================
    PROCEDURE get_distinct_periods IS
    BEGIN
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.OPEN_ARRAY('items');

        FOR rec IN (
            SELECT DISTINCT
                DEFAULT_PERIOD_NAME,
                USER_PERIOD_SET_NAME
            FROM V_GL_JOURNAL_LINES_SEGMENTS
            WHERE DEFAULT_PERIOD_NAME IS NOT NULL
            ORDER BY DEFAULT_PERIOD_NAME DESC
        ) LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('periodName', rec.DEFAULT_PERIOD_NAME);
            APEX_JSON.WRITE('periodSetName', rec.USER_PERIOD_SET_NAME);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;
    END get_distinct_periods;

    -- ============================================================
    -- Get distinct ledgers for dropdown
    -- ============================================================
    PROCEDURE get_distinct_ledgers IS
    BEGIN
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.OPEN_ARRAY('items');

        FOR rec IN (
            SELECT DISTINCT
                LEDGER_NAME,
                LEGAL_ENTITY_NAME
            FROM V_GL_JOURNAL_LINES_SEGMENTS
            WHERE LEDGER_NAME IS NOT NULL
            ORDER BY LEDGER_NAME
        ) LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('ledgerName', rec.LEDGER_NAME);
            APEX_JSON.WRITE('legalEntityName', rec.LEGAL_ENTITY_NAME);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;
    END get_distinct_ledgers;

    -- ============================================================
    -- Get all distinct segment values for dropdowns
    -- ============================================================
    PROCEDURE get_distinct_segments IS
    BEGIN
        APEX_JSON.OPEN_OBJECT;

        -- Company values
        APEX_JSON.OPEN_ARRAY('company');
        FOR rec IN (SELECT DISTINCT COMPANY FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE COMPANY IS NOT NULL ORDER BY COMPANY) LOOP
            APEX_JSON.WRITE(rec.COMPANY);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- LOB values
        APEX_JSON.OPEN_ARRAY('lob');
        FOR rec IN (SELECT DISTINCT LOB FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE LOB IS NOT NULL ORDER BY LOB) LOOP
            APEX_JSON.WRITE(rec.LOB);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- Department values
        APEX_JSON.OPEN_ARRAY('department');
        FOR rec IN (SELECT DISTINCT DEPARTMENT FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE DEPARTMENT IS NOT NULL ORDER BY DEPARTMENT) LOOP
            APEX_JSON.WRITE(rec.DEPARTMENT);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- Account values
        APEX_JSON.OPEN_ARRAY('account');
        FOR rec IN (SELECT DISTINCT ACCOUNT FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE ACCOUNT IS NOT NULL ORDER BY ACCOUNT) LOOP
            APEX_JSON.WRITE(rec.ACCOUNT);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- Sub Account values
        APEX_JSON.OPEN_ARRAY('subAccount');
        FOR rec IN (SELECT DISTINCT SUB_ACCOUNT FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE SUB_ACCOUNT IS NOT NULL ORDER BY SUB_ACCOUNT) LOOP
            APEX_JSON.WRITE(rec.SUB_ACCOUNT);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- Analysis values
        APEX_JSON.OPEN_ARRAY('analysis');
        FOR rec IN (SELECT DISTINCT ANALYSIS FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE ANALYSIS IS NOT NULL ORDER BY ANALYSIS) LOOP
            APEX_JSON.WRITE(rec.ANALYSIS);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- Intercompany values
        APEX_JSON.OPEN_ARRAY('intercompany');
        FOR rec IN (SELECT DISTINCT INTERCOMPANY FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE INTERCOMPANY IS NOT NULL ORDER BY INTERCOMPANY) LOOP
            APEX_JSON.WRITE(rec.INTERCOMPANY);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- JE Sources
        APEX_JSON.OPEN_ARRAY('jeSources');
        FOR rec IN (SELECT DISTINCT USER_JE_SOURCE_NAME FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE USER_JE_SOURCE_NAME IS NOT NULL ORDER BY USER_JE_SOURCE_NAME) LOOP
            APEX_JSON.WRITE(rec.USER_JE_SOURCE_NAME);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- JE Categories
        APEX_JSON.OPEN_ARRAY('jeCategories');
        FOR rec IN (SELECT DISTINCT USER_JE_CATEGORY_NAME FROM V_GL_JOURNAL_LINES_SEGMENTS WHERE USER_JE_CATEGORY_NAME IS NOT NULL ORDER BY USER_JE_CATEGORY_NAME) LOOP
            APEX_JSON.WRITE(rec.USER_JE_CATEGORY_NAME);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        APEX_JSON.CLOSE_OBJECT;
    END get_distinct_segments;

    -- ============================================================
    -- Get pivot data for account analysis
    -- ============================================================
    PROCEDURE get_pivot_data(
        p_ledger_name       IN VARCHAR2 DEFAULT NULL,
        p_period_names      IN VARCHAR2 DEFAULT NULL,
        p_company           IN VARCHAR2 DEFAULT NULL,
        p_lob               IN VARCHAR2 DEFAULT NULL,
        p_department        IN VARCHAR2 DEFAULT NULL,
        p_account           IN VARCHAR2 DEFAULT NULL,
        p_sub_account       IN VARCHAR2 DEFAULT NULL,
        p_analysis          IN VARCHAR2 DEFAULT NULL,
        p_intercompany      IN VARCHAR2 DEFAULT NULL
    ) IS
    BEGIN
        APEX_JSON.OPEN_OBJECT;

        -- Return periods array
        APEX_JSON.OPEN_ARRAY('periods');
        FOR rec IN (
            SELECT TRIM(REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL)) AS period_name
            FROM DUAL
            WHERE p_period_names IS NOT NULL
            CONNECT BY REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL) IS NOT NULL
        ) LOOP
            APEX_JSON.WRITE(rec.period_name);
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- Build pivot data
        APEX_JSON.OPEN_ARRAY('data');

        FOR rec IN (
            SELECT
                COMPANY,
                LOB,
                DEPARTMENT,
                ACCOUNT,
                SUB_ACCOUNT,
                ANALYSIS,
                INTERCOMPANY,
                COMPANY || '-' || LOB || '-' || DEPARTMENT || '-' || ACCOUNT || '-' || SUB_ACCOUNT || '-' || ANALYSIS || '-' || INTERCOMPANY AS CONCATENATED_SEGMENTS,
                DEFAULT_PERIOD_NAME,
                SUM(NVL(ACCOUNTED_DR, 0) - NVL(ACCOUNTED_CR, 0)) AS NET_AMOUNT
            FROM V_GL_JOURNAL_LINES_SEGMENTS
            WHERE (p_ledger_name IS NULL OR LEDGER_NAME = p_ledger_name)
              AND (p_period_names IS NULL OR DEFAULT_PERIOD_NAME IN (
                   SELECT TRIM(REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL))
                   FROM DUAL
                   CONNECT BY REGEXP_SUBSTR(p_period_names, '[^,]+', 1, LEVEL) IS NOT NULL
              ))
              AND (p_company IS NULL OR COMPANY = p_company)
              AND (p_lob IS NULL OR LOB = p_lob)
              AND (p_department IS NULL OR DEPARTMENT = p_department)
              AND (p_account IS NULL OR ACCOUNT = p_account)
              AND (p_sub_account IS NULL OR SUB_ACCOUNT = p_sub_account)
              AND (p_analysis IS NULL OR ANALYSIS = p_analysis)
              AND (p_intercompany IS NULL OR INTERCOMPANY = p_intercompany)
            GROUP BY
                COMPANY, LOB, DEPARTMENT, ACCOUNT, SUB_ACCOUNT, ANALYSIS, INTERCOMPANY,
                DEFAULT_PERIOD_NAME
            ORDER BY COMPANY, LOB, DEPARTMENT, ACCOUNT, SUB_ACCOUNT, ANALYSIS, INTERCOMPANY, DEFAULT_PERIOD_NAME
        ) LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('company', rec.COMPANY);
            APEX_JSON.WRITE('lob', rec.LOB);
            APEX_JSON.WRITE('department', rec.DEPARTMENT);
            APEX_JSON.WRITE('account', rec.ACCOUNT);
            APEX_JSON.WRITE('subAccount', rec.SUB_ACCOUNT);
            APEX_JSON.WRITE('analysis', rec.ANALYSIS);
            APEX_JSON.WRITE('intercompany', rec.INTERCOMPANY);
            APEX_JSON.WRITE('concatenatedSegments', rec.CONCATENATED_SEGMENTS);
            APEX_JSON.WRITE('periodName', rec.DEFAULT_PERIOD_NAME);
            APEX_JSON.WRITE('netAmount', rec.NET_AMOUNT);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;

    END get_pivot_data;

END REERP_ACCOUNT_ANALYSIS_PKG;
/

-- Grant execute to ORDS user
-- GRANT EXECUTE ON REERP_ACCOUNT_ANALYSIS_PKG TO ORDS_PUBLIC_USER;
