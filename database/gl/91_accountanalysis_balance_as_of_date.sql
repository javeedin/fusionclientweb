-- =============================================================================
-- PATCH 91: Opening/Closing Balance as-of-Date endpoint
--
-- New GET endpoint: gl/accountanalysis/balanceasof
--
-- Returns the net accounted and entered balance for an account
-- (and optional segment filters) as at a given date:
--   balance = SUM(accounted_dr) - SUM(accounted_cr)
--   for all journal lines where ACCOUNTING_DATE < :as_of_date
--
-- Used by Account Analysis V2 when the user switches to Date Range mode
-- instead of Period mode, to compute opening balance as at fromDate
-- and closing balance as at toDate + 1.
--
-- Parameters:
--   as_of_date    DATE    YYYY-MM-DD  (required) — balance UP TO but NOT INCLUDING this date
--   ledger_name   VARCHAR2            (required)
--   account       VARCHAR2            (optional) segment filter
--   company       VARCHAR2            (optional)
--   lob           VARCHAR2            (optional)
--   department    VARCHAR2            (optional)
--   sub_account   VARCHAR2            (optional)
--   analysis      VARCHAR2            (optional)
--   intercompany  VARCHAR2            (optional)
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands (run the single BEGIN...END; block)
-- =============================================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/accountanalysis/balanceasof',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DELETE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/accountanalysis/balanceasof'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/accountanalysis/balanceasof',
        p_comments    => 'Net balance for an account as at a given date'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/accountanalysis/balanceasof',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns net accounted + entered balance as at as_of_date (exclusive)',
        p_source         => q'[
DECLARE
    v_as_of_date   DATE           := TO_DATE(:as_of_date,  'YYYY-MM-DD');
    v_ledger_name  VARCHAR2(240)  := :ledger_name;
    v_account      VARCHAR2(25)   := :account;
    v_company      VARCHAR2(25)   := :company;
    v_lob          VARCHAR2(25)   := :lob;
    v_department   VARCHAR2(25)   := :department;
    v_sub_account  VARCHAR2(25)   := :sub_account;
    v_analysis     VARCHAR2(25)   := :analysis;
    v_intercompany VARCHAR2(25)   := :intercompany;

    v_acc_dr   NUMBER := 0;
    v_acc_cr   NUMBER := 0;
    v_ent_dr   NUMBER := 0;
    v_ent_cr   NUMBER := 0;
BEGIN
    IF v_as_of_date IS NULL OR v_ledger_name IS NULL THEN
        :status_code := 400;
        HTP.P('{"success":false,"error":"as_of_date and ledger_name are required"}');
        RETURN;
    END IF;

    SELECT
        NVL(SUM(jls.ACCOUNTED_DR), 0),
        NVL(SUM(jls.ACCOUNTED_CR), 0),
        NVL(SUM(jls.ENTERED_DR),   0),
        NVL(SUM(jls.ENTERED_CR),   0)
    INTO v_acc_dr, v_acc_cr, v_ent_dr, v_ent_cr
    FROM V_GL_JOURNAL_LINES_SEGMENTS jls
    WHERE jls.LEDGER_NAME    = v_ledger_name
      AND jls.ACCOUNTING_DATE < v_as_of_date
      AND (v_account      IS NULL OR jls.ACCOUNT      = v_account)
      AND (v_company      IS NULL OR jls.COMPANY      = v_company)
      AND (v_lob          IS NULL OR jls.LOB          = v_lob)
      AND (v_department   IS NULL OR jls.DEPARTMENT   = v_department)
      AND (v_sub_account  IS NULL OR jls.SUB_ACCOUNT  = v_sub_account)
      AND (v_analysis     IS NULL OR jls.ANALYSIS     = v_analysis)
      AND (v_intercompany IS NULL OR jls.INTERCOMPANY = v_intercompany);

    :status_code := 200;
    HTP.P(
        '{"success":true'
        || ',"asOfDate":"'    || TO_CHAR(v_as_of_date, 'YYYY-MM-DD') || '"'
        || ',"accountedDr":'  || TO_CHAR(v_acc_dr)
        || ',"accountedCr":'  || TO_CHAR(v_acc_cr)
        || ',"enteredDr":'    || TO_CHAR(v_ent_dr)
        || ',"enteredCr":'    || TO_CHAR(v_ent_cr)
        || ',"netAccounted":' || TO_CHAR(v_acc_dr - v_acc_cr)
        || ',"netEntered":'   || TO_CHAR(v_ent_dr - v_ent_cr)
        || '}'
    );
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- Verify
SELECT t.uri_template, h.method
FROM   user_ords_modules m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template = 'gl/accountanalysis/balanceasof';
