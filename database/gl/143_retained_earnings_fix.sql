-- ============================================================
-- 143: Retained Earnings — full fix (table + save + standardRE)
--
-- Run the WHOLE file in APEX SQL Workshop. It is safe to re-run.
--
-- What it does:
--   1. Adds OPENING_RE / CLOSING_RE / RE_MOVEMENT columns to
--      RR_GL_RETAINED_EARNINGS if they are missing.
--   2. Replaces POST gl/retained-earnings/save so every field the
--      UI sends is stored (openingRe, closingRe, reMovement too).
--   3. Replaces GET gl/rr-trialbalance/standardRE so `opening`
--      returns OPENING_RE (the brought-forward balance) and
--      `closing` returns CLOSING_RE — queried by the TB's own
--      year:  ?ledger_name=...&period_year=<TB year>
--   4. Verification queries at the end.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Add missing columns (each skipped silently if it exists)
-- ------------------------------------------------------------
DECLARE
    PROCEDURE add_col(p_sql VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLCODE = -1430 THEN NULL;   -- column already exists
        ELSE RAISE;
        END IF;
    END;
BEGIN
    add_col('ALTER TABLE RR_GL_RETAINED_EARNINGS ADD (OPENING_RE  NUMBER(20,2) DEFAULT 0)');
    add_col('ALTER TABLE RR_GL_RETAINED_EARNINGS ADD (CLOSING_RE  NUMBER(20,2) DEFAULT 0)');
    add_col('ALTER TABLE RR_GL_RETAINED_EARNINGS ADD (RE_MOVEMENT NUMBER(20,2) DEFAULT 0)');
END;
/

COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.OPENING_RE  IS 'Opening RE for the year = previous year closing (B/F); seeded from GL for the first year';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.CLOSING_RE  IS 'Closing RE = OPENING_RE + NET_PL + RE_MOVEMENT';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.RE_MOVEMENT IS 'Direct postings to the RE account during the year (delta of its year-end balances)';


-- ------------------------------------------------------------
-- 2. POST gl/retained-earnings/save — store every field
--    Body: JSON array of rows from the rollforward grid
-- ------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/retained-earnings/save',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Upsert RE rollforward rows incl. opening/closing/movement',
        p_source         => q'[
DECLARE
    l_body  CLOB   := :body;
    l_rows  APEX_JSON.t_values;
    l_count NUMBER := 0;
BEGIN
    APEX_JSON.parse(l_rows, l_body);

    FOR i IN 1 .. APEX_JSON.get_count(p_values => l_rows, p_path => '.') LOOP

        MERGE INTO RR_GL_RETAINED_EARNINGS t
        USING (
            SELECT
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].ledgerName',   p0 => i) AS ledger_name,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].year',         p0 => i) AS yr,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].lastPeriod',   p0 => i) AS last_period,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].company',      p0 => i) AS company,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].reAccount',    p0 => i) AS re_account,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].revenue',      p0 => i) AS revenue,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].expenses',     p0 => i) AS expenses,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].netPL',        p0 => i) AS net_pl,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].reBalance',    p0 => i) AS re_balance,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].reMovement',   p0 => i) AS re_movement,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].openingRe',    p0 => i) AS opening_re,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].closingRe',    p0 => i) AS closing_re,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].cumulativeRE', p0 => i) AS cumulative_re
            FROM DUAL
        ) s
        ON (
            t.LEDGER_NAME = s.ledger_name
            AND t.YEAR    = s.yr
            AND NVL(t.COMPANY, '~') = NVL(s.company, '~')
        )
        WHEN MATCHED THEN
            UPDATE SET
                t.LAST_PERIOD   = s.last_period,
                t.RE_ACCOUNT    = s.re_account,
                t.REVENUE       = NVL(s.revenue,       0),
                t.EXPENSES      = NVL(s.expenses,      0),
                t.NET_PL        = NVL(s.net_pl,        0),
                t.RE_BALANCE    = NVL(s.re_balance,    0),
                t.RE_MOVEMENT   = NVL(s.re_movement,   0),
                t.OPENING_RE    = NVL(s.opening_re,    0),
                t.CLOSING_RE    = NVL(s.closing_re,    0),
                t.CUMULATIVE_RE = NVL(s.cumulative_re, 0),
                t.UPDATED_DATE  = SYSDATE
        WHEN NOT MATCHED THEN
            INSERT (
                LEDGER_NAME, YEAR, LAST_PERIOD, COMPANY, RE_ACCOUNT,
                REVENUE, EXPENSES, NET_PL, RE_BALANCE, RE_MOVEMENT,
                OPENING_RE, CLOSING_RE, CUMULATIVE_RE
            )
            VALUES (
                s.ledger_name, s.yr, s.last_period, s.company, s.re_account,
                NVL(s.revenue, 0), NVL(s.expenses, 0), NVL(s.net_pl, 0),
                NVL(s.re_balance, 0), NVL(s.re_movement, 0),
                NVL(s.opening_re, 0), NVL(s.closing_re, 0), NVL(s.cumulative_re, 0)
            );

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
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST gl/retained-earnings/save replaced');
END;
/


-- ------------------------------------------------------------
-- 3. GET gl/rr-trialbalance/standardRE
--    Query by the TB tab's OWN year:
--      ?ledger_name=SB%20LEDGER&period_year=2026
--    opening      = OPENING_RE  (the B/F the UI injects)
--    closing      = CLOSING_RE  (incl. net P&L and RE movement)
--    re_movement  = the year's direct RE-account postings
-- ------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/rr-trialbalance/standardRE',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Saved Retained Earnings rows for the YTD Trial Balance'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/rr-trialbalance/standardRE',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Saved RE rows from RR_GL_RETAINED_EARNINGS (opening = B/F)',
        p_source         => q'[
SELECT
    re.LEDGER_NAME                                       AS ledger_name,
    re.LAST_PERIOD                                       AS period_name,
    re.YEAR                                              AS fiscal_year,
    12                                                   AS fiscal_period,
    'AED'                                                AS currency_code,
    re.RE_ACCOUNT                                        AS account_combination,
    re.COMPANY                                           AS company,
    re.RE_ACCOUNT                                        AS account,
    'OE'                                                 AS account_type,
    'Retained Earnings'                                  AS account_desc,
    NVL(re.OPENING_RE, 0)                                AS opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS credit,
    NVL(re.CLOSING_RE, 0)                                AS closing,
    NVL(re.RE_MOVEMENT, 0)                               AS re_movement,
    NVL(re.OPENING_RE, 0)                                AS entered_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS entered_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS entered_credit,
    NVL(re.CLOSING_RE, 0)                                AS entered_closing,
    NVL(re.OPENING_RE, 0)                                AS ytd_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS ytd_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS ytd_credit,
    NVL(re.OPENING_RE, 0)                                AS ytd_entered_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS ytd_entered_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS ytd_entered_credit
FROM RR_GL_RETAINED_EARNINGS re
WHERE re.LEDGER_NAME = :ledger_name
  AND (:company     IS NULL OR re.COMPANY       = :company)
  AND (:period_name IS NULL OR re.LAST_PERIOD   = :period_name)
  AND (:period_year IS NULL OR TO_CHAR(re.YEAR) = :period_year)
ORDER BY re.YEAR, re.COMPANY
]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET gl/rr-trialbalance/standardRE replaced');
END;
/


-- ------------------------------------------------------------
-- 4. Verify
-- ------------------------------------------------------------

-- 4a. Handlers deployed?
SELECT t.uri_template, h.method, h.source_type
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template IN ('gl/retained-earnings/save', 'gl/rr-trialbalance/standardRE');

-- 4b. Data check — after re-saving the rollforward from the UI,
--     OPENING_RE for 2026 should be the 2025 closing and
--     RE_MOVEMENT should carry the year's direct RE postings:
SELECT year, last_period, company,
       opening_re, net_pl, re_movement, closing_re, re_balance, cumulative_re
FROM   rr_gl_retained_earnings
WHERE  ledger_name = 'SB LEDGER'
ORDER  BY company, year;
