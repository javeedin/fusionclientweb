-- =====================================================
-- ORDS REST Handlers — GL Journal Lines Summary
--
-- Endpoints:
--   GET /reerp/gl/lines-summary        → aggregated data
--   GET /reerp/gl/lines-summary/diag   → diagnostic
--
-- Uses plsql/block + APEX_JSON (writes to HTP buffer
-- which ORDS returns as the response body).
-- =====================================================

-- ─────────────────────────────────────────────────────
-- Drop existing handlers before redefining
-- ─────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/lines-summary',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/lines-summary/diag',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────
-- Templates
-- ─────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/lines-summary',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'GL Journal Lines summary grouped by account combination'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/lines-summary/diag',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Diagnostic for GL lines summary'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -20001 THEN NULL; ELSE RAISE; END IF;
END;
/

-- ─────────────────────────────────────────────────────
-- GET gl/lines-summary
--
-- Uses APEX_JSON to build JSON directly into HTP buffer.
-- ORDS returns HTP buffer as response body for plsql/block.
-- Parameters resolved to local PL/SQL vars — no bind
-- variable conflicts with ORDS auto-mapping.
-- ─────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/lines-summary',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'GL Lines summary by account combination',
        p_source         => q'[
DECLARE
    l_period  VARCHAR2(100) := NULLIF(TRIM(:period_name), '');
    l_company VARCHAR2(100) := NULLIF(TRIM(:company), '');
    l_cnt     PLS_INTEGER   := 0;
BEGIN
    APEX_JSON.initialize_output;
    APEX_JSON.open_object;
    APEX_JSON.open_array('items');
    FOR r IN (
        SELECT *
        FROM (
            SELECT
                REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,1)                AS seg1_company,
                REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,4)                AS seg4_account,
                hdr.LEDGER_NAME                                                    AS ledger_name,
                hdr.PERIOD_NAME                                                    AS period_name,
                NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)                  AS currency,
                SUM(NVL(lin.ACCOUNTED_DR,0))                                       AS total_dr,
                SUM(NVL(lin.ACCOUNTED_CR,0))                                       AS total_cr,
                SUM(NVL(lin.ACCOUNTED_DR,0)) - SUM(NVL(lin.ACCOUNTED_CR,0))       AS net_amount,
                COUNT(*)                                                            AS line_count
            FROM RR_GL_JE_LINES_ALL  lin
            JOIN RR_GL_JE_HEADERS     hdr ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
            WHERE lin.ACCOUNT_COMBINATION IS NOT NULL
              AND (l_period  IS NULL OR UPPER(hdr.PERIOD_NAME) = UPPER(l_period))
              AND (l_company IS NULL OR UPPER(REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,1)) = UPPER(l_company))
            GROUP BY
                REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,1),
                REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,4),
                hdr.LEDGER_NAME,
                hdr.PERIOD_NAME,
                NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)
        )
        ORDER BY seg1_company, seg4_account, currency
    ) LOOP
        APEX_JSON.open_object;
        APEX_JSON.write('seg1_company',  r.seg1_company);
        APEX_JSON.write('seg4_account',  r.seg4_account);
        APEX_JSON.write('ledger_name',   r.ledger_name);
        APEX_JSON.write('period_name',   r.period_name);
        APEX_JSON.write('currency',      NVL(r.currency, ''));
        APEX_JSON.write('total_dr',      r.total_dr);
        APEX_JSON.write('total_cr',      r.total_cr);
        APEX_JSON.write('net_amount',    r.net_amount);
        APEX_JSON.write('line_count',    r.line_count);
        APEX_JSON.close_object;
        l_cnt := l_cnt + 1;
    END LOOP;
    APEX_JSON.close_array;
    APEX_JSON.write('count',  l_cnt);
    APEX_JSON.write('period', l_period);
    APEX_JSON.close_object;
END;
]'
    );
    COMMIT;
END;
/

-- ─────────────────────────────────────────────────────
-- GET gl/lines-summary/diag
-- ─────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/lines-summary/diag',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Diagnostic for GL lines summary',
        p_source         => q'[
DECLARE
    l_cnt_lines  NUMBER;
    l_cnt_hdrs   NUMBER;
    l_cnt_join   NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_cnt_lines FROM RR_GL_JE_LINES_ALL;
    SELECT COUNT(*) INTO l_cnt_hdrs  FROM RR_GL_JE_HEADERS;
    SELECT COUNT(*) INTO l_cnt_join
    FROM RR_GL_JE_LINES_ALL lin
    JOIN RR_GL_JE_HEADERS hdr ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID;

    APEX_JSON.initialize_output;
    APEX_JSON.open_object;
    APEX_JSON.write('lines_count',   l_cnt_lines);
    APEX_JSON.write('headers_count', l_cnt_hdrs);
    APEX_JSON.write('join_count',    l_cnt_join);

    APEX_JSON.open_array('period_samples');
    FOR r IN (
        SELECT DISTINCT PERIOD_NAME
        FROM RR_GL_JE_HEADERS
        WHERE PERIOD_NAME IS NOT NULL
        ORDER BY PERIOD_NAME DESC
        FETCH FIRST 10 ROWS ONLY
    ) LOOP
        APEX_JSON.write(r.PERIOD_NAME);
    END LOOP;
    APEX_JSON.close_array;

    APEX_JSON.open_array('account_combo_samples');
    FOR r IN (
        SELECT DISTINCT ACCOUNT_COMBINATION
        FROM RR_GL_JE_LINES_ALL
        WHERE ACCOUNT_COMBINATION IS NOT NULL
        ORDER BY ACCOUNT_COMBINATION
        FETCH FIRST 5 ROWS ONLY
    ) LOOP
        APEX_JSON.write(r.ACCOUNT_COMBINATION);
    END LOOP;
    APEX_JSON.close_array;
    APEX_JSON.close_object;
END;
]'
    );
    COMMIT;
END;
/
