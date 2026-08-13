-- =====================================================
-- ORDS REST Handlers for RR_ERP_TRIALBALANCE
-- Generated Trial Balance from RR_GL_JE_LINES_ALL
--
-- Endpoints:
--   POST /reerp/gl/rr-trialbalance/generate  → call RR_ERP_TB_PKG.GENERATE_TB
--   GET  /reerp/gl/rr-trialbalance           → query RR_ERP_TRIALBALANCE
--   GET  /reerp/gl/rr-trialbalance/ledgers   → distinct ledger names
--   GET  /reerp/gl/rr-trialbalance/periods   → distinct periods for ledger/year
-- =====================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TEMPLATE: gl/rr-trialbalance
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'RR Trial Balance — derived from journal lines'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 2. GET /reerp/gl/rr-trialbalance
--    Query RR_ERP_TRIALBALANCE with optional filters
--    Params: ledger_name, period_year, period_name, account_type, company
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Retrieve RR Trial Balance rows with optional filters',
        p_source         => q'[
SELECT
    tb.tb_id,
    tb.ledger_name,
    tb.period_name,
    tb.period_year,
    tb.period_num,
    tb.currency_code,
    tb.account_combination,
    tb.company,
    tb.lob,
    tb.department,
    tb.account,
    NVL(vsv.description, tb.account_desc) AS account_desc,
    tb.sub_account,
    tb.analysis,
    tb.intercompany,
    tb.future1,
    tb.future2,
    tb.account_type,
    NVL(tb.opening_dr, 0)  AS opening_dr,
    NVL(tb.opening_cr, 0)  AS opening_cr,
    NVL(tb.ptd_dr, 0)      AS ptd_dr,
    NVL(tb.ptd_cr, 0)      AS ptd_cr,
    NVL(tb.ytd_dr, 0)      AS ytd_dr,
    NVL(tb.ytd_cr, 0)      AS ytd_cr,
    NVL(tb.closing_dr, 0)  AS closing_dr,
    NVL(tb.closing_cr, 0)  AS closing_cr,
    TO_CHAR(tb.run_date, 'YYYY-MM-DD HH24:MI:SS') AS run_date
FROM rr_erp_trialbalance tb
LEFT JOIN rr_value_set_values vsv
       ON vsv.value_set_code = 'BUIMERC_FIN_GLB_COA_ACCOUNT'
      AND vsv.value          = tb.account
WHERE (:ledger_name IS NULL OR tb.ledger_name = :ledger_name)
  AND (:period_year IS NULL OR tb.period_year = TO_NUMBER(:period_year))
  AND (:period_name IS NULL OR tb.period_name = :period_name)
  AND (:account_type IS NULL OR tb.account_type = :account_type)
  AND (:company IS NULL OR tb.company = :company)
ORDER BY
    tb.period_year,
    tb.period_num,
    CASE tb.account_type
        WHEN 'A' THEN 1   -- Asset
        WHEN 'L' THEN 2   -- Liability
        WHEN 'O' THEN 3   -- Equity
        WHEN 'R' THEN 4   -- Revenue
        WHEN 'E' THEN 5   -- Expense
        ELSE 6
    END,
    tb.account,
    tb.company,
    tb.department
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 3. TEMPLATE: gl/rr-trialbalance/generate
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/generate',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'RR Trial Balance — generate from journal lines'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 4. POST /reerp/gl/rr-trialbalance/generate
--    Body: { "p_ledger_name": "...", "p_period_year": 2025, "p_period_name": "Mar-25" }
--    Calls RR_ERP_TB_PKG.GENERATE_TB and returns result summary
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/generate',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Generate RR Trial Balance from journal lines',
        p_source         => q'[
DECLARE
    v_body           CLOB := :body_text;
    v_ledger_name    VARCHAR2(240);
    v_period_name    VARCHAR2(30);
    v_company        VARCHAR2(30);
    v_fiscal_year    NUMBER;
    v_fiscal_period  NUMBER;
    v_inserted       NUMBER := 0;
    v_updated        NUMBER := 0;
    v_errors         NUMBER := 0;
    v_error_msg      VARCHAR2(4000);
    v_msg            VARCHAR2(500);
    v_start          TIMESTAMP := SYSTIMESTAMP;
    v_elapsed_sec    NUMBER;
BEGIN
    -- Parse JSON body
    v_ledger_name   := JSON_VALUE(v_body, '$.p_ledger_name');
    v_period_name   := JSON_VALUE(v_body, '$.p_period_name');
    v_company       := JSON_VALUE(v_body, '$.p_company');
    v_fiscal_year   := TO_NUMBER(JSON_VALUE(v_body, '$.p_fiscal_year'));
    v_fiscal_period := TO_NUMBER(JSON_VALUE(v_body, '$.p_fiscal_period'));

    -- Sync fiscal period into RR_GL_FISCAL_PERIODS so GENERATE_TB can join it.
    -- This ensures the table is always current before we compute the trial balance.
    IF v_ledger_name IS NOT NULL AND v_period_name IS NOT NULL
       AND v_fiscal_year IS NOT NULL AND v_fiscal_period IS NOT NULL
    THEN
        MERGE INTO RR_GL_FISCAL_PERIODS tgt
        USING (
            SELECT v_period_name AS period_name,
                   v_ledger_name AS ledger_name,
                   'GL'          AS application
            FROM DUAL
        ) src
        ON (    tgt.PERIOD_NAME = src.period_name
            AND tgt.LEDGER_NAME = src.ledger_name
            AND tgt.APPLICATION = src.application)
        WHEN MATCHED THEN
            UPDATE SET
                tgt.FISCAL_YEAR   = v_fiscal_year,
                tgt.FISCAL_PERIOD = v_fiscal_period,
                tgt.ADJ_FLAG      = 'N',
                tgt.SYNC_DATE     = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (PERIOD_NAME, LEDGER_NAME, APPLICATION, FISCAL_YEAR, FISCAL_PERIOD, ADJ_FLAG)
            VALUES (v_period_name, v_ledger_name, 'GL', v_fiscal_year, v_fiscal_period, 'N');
        COMMIT;
    END IF;

    -- Run the generation procedure.
    -- Pass p_period_name only (not p_period_year) so GENERATE_TB uses the
    -- fiscal year it just read from RR_GL_FISCAL_PERIODS rather than any
    -- calendar-year fallback, and uses PERIOD_NAME as the sole output filter.
    RR_ERP_TB_PKG.GENERATE_TB(
        p_ledger_name => v_ledger_name,
        p_period_year => NULL,           -- let package derive from RR_GL_FISCAL_PERIODS
        p_period_name => v_period_name,
        p_company     => v_company,
        p_inserted    => v_inserted,
        p_updated     => v_updated,
        p_errors      => v_errors,
        p_error_msg   => v_error_msg
    );

    v_elapsed_sec := ROUND(
        (CAST(SYSTIMESTAMP AS DATE) - CAST(v_start AS DATE)) * 86400, 1
    );

    v_msg := 'Generated ' || (v_inserted + v_updated) || ' rows'
          || ' (' || v_inserted || ' new, ' || v_updated || ' replaced)'
          || ' in ' || v_elapsed_sec || 's';

    :status_code := CASE WHEN v_errors > 0 THEN 207 ELSE 200 END;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',      v_errors = 0);
    APEX_JSON.WRITE('inserted',     v_inserted);
    APEX_JSON.WRITE('updated',      v_updated);
    APEX_JSON.WRITE('errors',       v_errors);
    APEX_JSON.WRITE('error_msg',    v_error_msg);
    APEX_JSON.WRITE('message',      v_msg);
    APEX_JSON.WRITE('elapsed_sec',  v_elapsed_sec);
    APEX_JSON.WRITE('ledger_name',   v_ledger_name);
    APEX_JSON.WRITE('fiscal_year',   v_fiscal_year);
    APEX_JSON.WRITE('fiscal_period', v_fiscal_period);
    APEX_JSON.WRITE('period_name',   v_period_name);
    APEX_JSON.WRITE('company',      v_company);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',   FALSE);
        APEX_JSON.WRITE('inserted',  0);
        APEX_JSON.WRITE('updated',   0);
        APEX_JSON.WRITE('errors',    1);
        APEX_JSON.WRITE('error_msg', SQLERRM);
        APEX_JSON.WRITE('message',   'Fatal error during TB generation: ' || SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 5. TEMPLATE: gl/rr-trialbalance/ledgers
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/ledgers',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Distinct ledger names from RR_GL_JE_HEADERS'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 6. GET /reerp/gl/rr-trialbalance/ledgers
--    Returns distinct ledger names (for UI dropdown)
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/ledgers',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Distinct ledger names available in journal headers',
        p_source         => q'[
SELECT DISTINCT
    LEDGER_NAME  AS ledger_name
FROM RR_GL_JE_HEADERS
WHERE LEDGER_NAME IS NOT NULL
ORDER BY LEDGER_NAME
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 7. TEMPLATE: gl/rr-trialbalance/periods
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/periods',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Distinct period names for ledger/year'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 8. GET /reerp/gl/rr-trialbalance/periods
--    Params: ledger_name, period_year (optional)
--    Returns distinct period names sorted chronologically
-- ─────────────────────────────────────────────────────────────

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/periods',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Distinct period names from journal headers for a given ledger/year',
        p_source         => q'[
-- Fiscal year and period number come from RR_GL_FISCAL_PERIODS (synced from
-- Oracle Fusion via periodsstatus/create).  Calendar year/month are used only
-- as a fallback when no match exists in the fiscal periods table.
SELECT DISTINCT
    hdr.PERIOD_NAME                                                                 AS period_name,
    NVL(fp.FISCAL_YEAR,
        EXTRACT(YEAR  FROM TO_DATE('01-'||hdr.PERIOD_NAME,'DD-Mon-RR')))            AS period_year,
    NVL(fp.FISCAL_PERIOD,
        EXTRACT(MONTH FROM TO_DATE('01-'||hdr.PERIOD_NAME,'DD-Mon-RR')))            AS period_num
FROM RR_GL_JE_HEADERS hdr
LEFT JOIN RR_GL_FISCAL_PERIODS fp
       ON fp.PERIOD_NAME = hdr.PERIOD_NAME
      AND fp.LEDGER_NAME = hdr.LEDGER_NAME
      AND fp.APPLICATION = 'GL'
      AND fp.ADJ_FLAG    = 'N'
WHERE hdr.PERIOD_NAME IS NOT NULL
  AND (:ledger_name IS NULL OR hdr.LEDGER_NAME = :ledger_name)
  AND (:period_year IS NULL OR
       NVL(fp.FISCAL_YEAR,
           EXTRACT(YEAR FROM TO_DATE('01-'||hdr.PERIOD_NAME,'DD-Mon-RR'))) = TO_NUMBER(:period_year))
ORDER BY period_year DESC, period_num DESC
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 9. TEMPLATE: gl/rr-trialbalance/companies
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/companies',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Distinct company (segment 1) values from journal lines'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 10. GET /reerp/gl/rr-trialbalance/companies
--     Param: ledger_name (optional)
--     Returns distinct Segment 1 (Company) values from journal lines
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/companies',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Distinct company values (segment 1 of account combination)',
        p_source         => q'[
SELECT
    COMPANY AS company
FROM RR_GL_LEDGER_COMPANIES
WHERE (:ledger_name IS NULL OR LEDGER_NAME = :ledger_name)
ORDER BY COMPANY
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 11. TEMPLATE: gl/rr-trialbalance/standard
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standard',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Standard TB format: Opening / Debit / Credit / Closing (net)'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 12. GET /reerp/gl/rr-trialbalance/standard
--
--  Live Trial Balance via RR_V_STANDARD_TB view.
--  The view handles all CTE logic (cross-join dense matrix,
--  window-function opening balances, zero-suppression).
--  This handler only adds the caller-side WHERE filters.
--
--  Params:
--    ledger_name   REQUIRED
--    period_name   optional  e.g. 'Sep-23'
--    period_year   optional  e.g. '2024'  (fiscal year as text)
--    account_type  optional  A / L / O / R / E
--    company       optional  segment 1 value
--    currency_code optional  e.g. 'AED'
--    account       optional  e.g. '1240100'
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standard',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Live TB via RR_V_STANDARD_TB — Opening/Debit/Credit/Closing with optional filters',
        p_source         => q'[
SELECT
    ledger_name,
    period_name,
    fiscal_year,
    fiscal_period,
    currency_code,
    account_combination,
    company,
    account,
    account_type,
    account_desc,
    opening,
    debit,
    credit,
    closing,
    entered_opening,
    entered_debit,
    entered_credit,
    entered_closing
FROM RR_V_STANDARD_TB
WHERE ledger_name          = :ledger_name
  AND (:period_name   IS NULL OR period_name          = :period_name)
  AND (:period_year   IS NULL OR TO_CHAR(fiscal_year) = :period_year)
  AND (:account_type  IS NULL OR account_type         = :account_type)
  AND (:company       IS NULL OR company              = :company)
  AND (:currency_code IS NULL OR currency_code        = :currency_code)
  AND (:account       IS NULL OR account              = :account)
ORDER BY
    fiscal_year,
    fiscal_period,
    CASE account_type
        WHEN 'A' THEN 1 WHEN 'L' THEN 2 WHEN 'O' THEN 3
        WHEN 'R' THEN 4 WHEN 'E' THEN 5 ELSE 6
    END,
    account,
    account_combination,
    currency_code
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 13. TEMPLATE: gl/rr-trialbalance/lines
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/lines',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'GL journal lines for a specific account + period (TB drill-down)'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────────────
-- 14. GET /reerp/gl/rr-trialbalance/lines
--
--  Returns individual GL journal lines for drill-down from the
--  trial balance.  Joins RR_GL_JE_LINES_ALL → RR_GL_JE_HEADERS.
--
--  Params:
--    ledger_name         REQUIRED
--    period_name         REQUIRED  e.g. 'Jul-23'
--    account             REQUIRED  segment 4 value, e.g. '1134100'
--    account_combination optional  full combination — narrows to one row
--    company             optional  segment 1 value
-- ─────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/lines',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'GL journal lines for TB drill-down by account + period',
        p_source         => q'[
SELECT
    lin.LINE_ID                                                      AS line_id,
    lin.JE_LINE_NUMBER                                               AS line_num,
    hdr.JE_HEADER_ID                                                 AS je_header_id,
    hdr.NAME                                                         AS je_name,
    hdr.DESCRIPTION                                                  AS je_description,
    hdr.PERIOD_NAME                                                  AS period_name,
    hdr.LEDGER_NAME                                                  AS ledger_name,
    hdr.USER_JE_SOURCE_NAME                                          AS source,
    hdr.USER_JE_CATEGORY_NAME                                        AS category,
    hdr.STATUS                                                       AS status,
    hdr.EFFECTIVE_DATE                                               AS effective_date,
    lin.ACCOUNT_COMBINATION                                          AS account_combination,
    TRIM(REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,1))         AS company,
    TRIM(REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,4))         AS account,
    NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)                 AS currency_code,
    NVL(lin.ENTERED_DR,   0)                                         AS entered_dr,
    NVL(lin.ENTERED_CR,   0)                                         AS entered_cr,
    NVL(lin.ACCOUNTED_DR, 0)                                         AS accounted_dr,
    NVL(lin.ACCOUNTED_CR, 0)                                         AS accounted_cr,
    lin.DESCRIPTION                                                  AS line_description
FROM RR_GL_JE_LINES_ALL  lin
JOIN RR_GL_JE_HEADERS    hdr  ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
WHERE hdr.LEDGER_NAME  = :ledger_name
  AND hdr.PERIOD_NAME  = :period_name
  AND TRIM(REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,4)) = :account
  AND (:account_combination IS NULL OR lin.ACCOUNT_COMBINATION = :account_combination)
  AND (:company             IS NULL OR
       TRIM(REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,1)) = :company)
ORDER BY
    lin.ACCOUNT_COMBINATION,
    hdr.EFFECTIVE_DATE,
    hdr.JE_HEADER_ID,
    lin.JE_LINE_NUMBER
]'
    );
    COMMIT;
END;
/
