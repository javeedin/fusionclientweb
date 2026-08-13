-- ============================================================
-- APEX REST Handlers — Retained Earnings
-- Module  : reerp
-- Base URL: /ords/bcldifc/reerp/
--
-- Endpoints registered:
--   POST   /gl/retained-earnings/save   — upsert rows (array body)
--   GET    /gl/retained-earnings        — query rows
--   DELETE /gl/retained-earnings/:id    — delete single row
--
-- Run in APEX SQL Workshop or via ORDS REST Service setup
-- ============================================================

BEGIN

    -- ----------------------------------------------------------
    -- Template: gl/retained-earnings/save
    -- ----------------------------------------------------------
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/retained-earnings/save',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Retained Earnings save endpoint'
    );

    -- POST /gl/retained-earnings/save
    -- Body: JSON array of row objects
    -- Response: { "status": "ok", "saved": N }
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/retained-earnings/save',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert retained earnings rows',
        p_source         => q'[
DECLARE
    l_blob    BLOB := :body;
    l_body    CLOB;
    l_rows    APEX_JSON.t_values;
    l_count   NUMBER := 0;
    l_doff    INTEGER := 1;
    l_soff    INTEGER := 1;
    l_lctx    INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    l_warn    INTEGER;
    v_ledger  VARCHAR2(200);
    v_year    NUMBER;
    v_period  VARCHAR2(30);
    v_company VARCHAR2(30);
    v_acct    VARCHAR2(30);
    v_rev     NUMBER;
    v_exp     NUMBER;
    v_netpl   NUMBER;
    v_rebal   NUMBER;
    v_cumre   NUMBER;
    v_openre  NUMBER;
    v_closere NUMBER;
BEGIN
    IF l_blob IS NOT NULL AND DBMS_LOB.GETLENGTH(l_blob) > 0 THEN
        DBMS_LOB.CREATETEMPORARY(l_body, TRUE);
        DBMS_LOB.CONVERTTOCLOB(l_body, l_blob, DBMS_LOB.LOBMAXSIZE,
            l_doff, l_soff, NLS_CHARSET_ID('AL32UTF8'), l_lctx, l_warn);
    END IF;

    APEX_JSON.parse(l_rows, l_body);

    FOR i IN 1 .. APEX_JSON.get_count(p_values => l_rows, p_path => '.') LOOP
        v_ledger  := APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].ledgerName',   p0 => i);
        v_year    := APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].year',          p0 => i);
        v_period  := APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].lastPeriod',   p0 => i);
        v_company := APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].company',      p0 => i);
        v_acct    := APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].reAccount',    p0 => i);
        v_rev     := NVL(APEX_JSON.get_number(p_values => l_rows, p_path => '[%d].revenue',      p0 => i), 0);
        v_exp     := NVL(APEX_JSON.get_number(p_values => l_rows, p_path => '[%d].expenses',     p0 => i), 0);
        v_netpl   := NVL(APEX_JSON.get_number(p_values => l_rows, p_path => '[%d].netPL',        p0 => i), 0);
        v_rebal   := NVL(APEX_JSON.get_number(p_values => l_rows, p_path => '[%d].reBalance',    p0 => i), 0);
        v_cumre   := NVL(APEX_JSON.get_number(p_values => l_rows, p_path => '[%d].cumulativeRE', p0 => i), 0);
        v_openre  := NVL(APEX_JSON.get_number(p_values => l_rows, p_path => '[%d].openingRe',    p0 => i), 0);
        v_closere := NVL(APEX_JSON.get_number(p_values => l_rows, p_path => '[%d].closingRe',    p0 => i), 0);

        MERGE INTO RR_GL_RETAINED_EARNINGS t
        USING (SELECT 1 FROM DUAL) d
        ON (t.LEDGER_NAME = v_ledger AND t.YEAR = v_year AND NVL(t.COMPANY,'~') = NVL(v_company,'~'))
        WHEN MATCHED THEN UPDATE SET
            t.LAST_PERIOD   = v_period,
            t.RE_ACCOUNT    = v_acct,
            t.REVENUE       = v_rev,
            t.EXPENSES      = v_exp,
            t.NET_PL        = v_netpl,
            t.RE_BALANCE    = v_rebal,
            t.CUMULATIVE_RE = v_cumre,
            t.OPENING_RE    = v_openre,
            t.CLOSING_RE    = v_closere,
            t.UPDATED_DATE  = SYSDATE
        WHEN NOT MATCHED THEN INSERT
            (LEDGER_NAME, YEAR, LAST_PERIOD, COMPANY, RE_ACCOUNT, REVENUE, EXPENSES, NET_PL, RE_BALANCE, CUMULATIVE_RE, OPENING_RE, CLOSING_RE)
        VALUES
            (v_ledger, v_year, v_period, v_company, v_acct, v_rev, v_exp, v_netpl, v_rebal, v_cumre, v_openre, v_closere);

        l_count := l_count + 1;
    END LOOP;

    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('status', 'ok');
    APEX_JSON.write('saved',  l_count);
    APEX_JSON.close_object;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    APEX_JSON.open_object;
    APEX_JSON.write('status',  'error');
    APEX_JSON.write('message', SQLERRM);
    APEX_JSON.close_object;
END;
]'
    );

    -- ----------------------------------------------------------
    -- Template: gl/retained-earnings
    -- ----------------------------------------------------------
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/retained-earnings',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Retained Earnings query endpoint'
    );

    -- GET /gl/retained-earnings
    -- Query params: ledger_name (optional), company (optional)
    -- Response: standard ORDS JSON collection
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/retained-earnings',
        p_method         => 'GET',
        p_source_type    => 'collection/query',
        p_items_per_page => 500,
        p_mimes_allowed  => NULL,
        p_comments       => 'Query retained earnings rows',
        p_source         => q'[
SELECT
    ID,
    LEDGER_NAME,
    YEAR,
    LAST_PERIOD,
    COMPANY,
    RE_ACCOUNT,
    REVENUE,
    EXPENSES,
    NET_PL,
    RE_BALANCE,
    OPENING_RE,
    CLOSING_RE,
    CUMULATIVE_RE,
    TO_CHAR(CREATED_DATE, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_DATE,
    TO_CHAR(UPDATED_DATE, 'YYYY-MM-DD HH24:MI:SS') AS UPDATED_DATE
FROM RR_GL_RETAINED_EARNINGS
WHERE (:ledger_name IS NULL OR LEDGER_NAME = :ledger_name)
  AND (:company     IS NULL OR NVL(COMPANY, '~') = NVL(:company, '~'))
ORDER BY LEDGER_NAME, YEAR
]'
    );

    -- ----------------------------------------------------------
    -- Template: gl/retained-earnings/:id
    -- ----------------------------------------------------------
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/retained-earnings/:id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Retained Earnings single-row endpoint'
    );

    -- DELETE /gl/retained-earnings/:id
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/retained-earnings/:id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Delete a retained earnings row by ID',
        p_source         => q'[
BEGIN
    DELETE FROM RR_GL_RETAINED_EARNINGS
    WHERE ID = :id;

    COMMIT;

    APEX_JSON.open_object;
    APEX_JSON.write('status',  'ok');
    APEX_JSON.write('deleted', SQL%ROWCOUNT);
    APEX_JSON.close_object;

EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    APEX_JSON.open_object;
    APEX_JSON.write('status',  'error');
    APEX_JSON.write('message', SQLERRM);
    APEX_JSON.close_object;
END;
]'
    );

    COMMIT;
END;
/
