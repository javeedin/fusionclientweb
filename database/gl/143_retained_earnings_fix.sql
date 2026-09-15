-- ============================================================
-- 143: Retained Earnings — fix save + standardRE + retrieve
--
-- Written against the REAL deployed table (bcldifc):
--   RR_GL_RETAINED_EARNINGS (LEDGER_NAME, FISCAL_YEAR, PERIOD_NAME,
--     ACCOUNT_COMBINATION, COMPANY, ACCOUNT, ACCOUNT_DESC,
--     ACCOUNT_TYPE, CURRENCY_CODE, REVENUE, EXPENSES, NET_PL,
--     RE_CURRENT, CUMULATIVE_RE, OPENING, PTD_DR, PTD_CR, CLOSING,
--     ENTERED_OPENING, ENTERED_CLOSING, CALCULATED_DATE, CREATED_BY)
--   UNIQUE (LEDGER_NAME, FISCAL_YEAR, COMPANY)
--   + BEFORE DELETE trigger TRG_NODELETE_... (deletes are blocked)
--
-- Run the WHOLE file in APEX SQL Workshop. Safe to re-run.
--
--   1. Adds RE_MOVEMENT column if missing.
--   2. Replaces POST gl/retained-earnings/save — maps the UI payload
--      to the real columns (openingRe -> OPENING, closingRe -> CLOSING,
--      reBalance -> RE_CURRENT, reMovement -> RE_MOVEMENT, ...).
--      The old save put the RE account balance into OPENING — that is
--      why the TB showed 41,818,707.61 as the B/F.
--   3. Replaces GET gl/rr-trialbalance/standardRE (same shape as your
--      current handler, plus re_movement; closing = CUMULATIVE_RE).
--   4. Defines GET gl/retained-earnings for the "Retrieve Retained
--      Earnings" tab, aliased to the names the UI expects.
--   5. Verification queries.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Add RE_MOVEMENT (skipped silently if it already exists)
-- ------------------------------------------------------------
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_GL_RETAINED_EARNINGS ADD (RE_MOVEMENT NUMBER DEFAULT 0)';
EXCEPTION WHEN OTHERS THEN
    IF SQLCODE = -1430 THEN NULL;   -- column already exists
    ELSE RAISE;
    END IF;
END;
/

COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.RE_MOVEMENT IS 'Direct postings to the RE account during the year (delta of its year-end balances)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.OPENING     IS 'Opening RE for the year = previous year closing (B/F)';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.CLOSING     IS 'Closing RE = OPENING + NET_PL + RE_MOVEMENT';
COMMENT ON COLUMN RR_GL_RETAINED_EARNINGS.RE_CURRENT  IS 'RE GL account (3112100) cumulative balance at year end';


-- ------------------------------------------------------------
-- 2. POST gl/retained-earnings/save
--    Body: JSON array of rollforward rows from the UI:
--    [{ ledgerName, year, lastPeriod, company, reAccount,
--       revenue, expenses, netPL, reBalance, reMovement,
--       openingRe, closingRe, cumulativeRE }]
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
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].year',         p0 => i) AS fiscal_year,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].lastPeriod',   p0 => i) AS period_name,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].company',      p0 => i) AS company,
                APEX_JSON.get_varchar2(p_values => l_rows, p_path => '[%d].reAccount',    p0 => i) AS account,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].revenue',      p0 => i) AS revenue,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].expenses',     p0 => i) AS expenses,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].netPL',        p0 => i) AS net_pl,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].reBalance',    p0 => i) AS re_current,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].reMovement',   p0 => i) AS re_movement,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].openingRe',    p0 => i) AS opening_re,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].closingRe',    p0 => i) AS closing_re,
                APEX_JSON.get_number  (p_values => l_rows, p_path => '[%d].cumulativeRE', p0 => i) AS cumulative_re
            FROM DUAL
        ) s
        ON (
            t.LEDGER_NAME       = s.ledger_name
            AND t.FISCAL_YEAR   = s.fiscal_year
            AND NVL(t.COMPANY, '~') = NVL(s.company, '~')
        )
        WHEN MATCHED THEN
            UPDATE SET
                t.PERIOD_NAME     = s.period_name,
                t.ACCOUNT         = s.account,
                t.ACCOUNT_DESC    = 'Retained Earnings',
                t.REVENUE         = NVL(s.revenue,       0),
                t.EXPENSES        = NVL(s.expenses,      0),
                t.NET_PL          = NVL(s.net_pl,        0),
                t.RE_CURRENT      = NVL(s.re_current,    0),
                t.RE_MOVEMENT     = NVL(s.re_movement,   0),
                t.OPENING         = NVL(s.opening_re,    0),
                t.CLOSING         = NVL(s.closing_re,    0),
                t.ENTERED_OPENING = NVL(s.opening_re,    0),
                t.ENTERED_CLOSING = NVL(s.closing_re,    0),
                t.CUMULATIVE_RE   = NVL(s.cumulative_re, 0),
                t.CALCULATED_DATE = SYSDATE
        WHEN NOT MATCHED THEN
            INSERT (
                LEDGER_NAME, FISCAL_YEAR, PERIOD_NAME, COMPANY,
                ACCOUNT, ACCOUNT_DESC,
                REVENUE, EXPENSES, NET_PL,
                RE_CURRENT, RE_MOVEMENT,
                OPENING, CLOSING, ENTERED_OPENING, ENTERED_CLOSING,
                CUMULATIVE_RE, CREATED_BY
            )
            VALUES (
                s.ledger_name, s.fiscal_year, s.period_name, s.company,
                s.account, 'Retained Earnings',
                NVL(s.revenue, 0), NVL(s.expenses, 0), NVL(s.net_pl, 0),
                NVL(s.re_current, 0), NVL(s.re_movement, 0),
                NVL(s.opening_re, 0), NVL(s.closing_re, 0),
                NVL(s.opening_re, 0), NVL(s.closing_re, 0),
                NVL(s.cumulative_re, 0), 'REERP_UI'
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
--    Same shape as the current deployed handler; adds re_movement.
--    UI calls:  ?ledger_name=SB%20LEDGER&period_year=2026
--    opening = OPENING (B/F) — correct once step 2 re-save runs.
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
    re.PERIOD_NAME                                       AS period_name,
    re.FISCAL_YEAR                                       AS fiscal_year,
    12                                                   AS fiscal_period,
    re.CURRENCY_CODE                                     AS currency_code,
    re.ACCOUNT_COMBINATION                               AS account_combination,
    re.COMPANY                                           AS company,
    re.ACCOUNT                                           AS account,
    re.ACCOUNT_TYPE                                      AS account_type,
    re.ACCOUNT_DESC                                      AS account_desc,
    NVL(re.OPENING, 0)                                   AS opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS credit,
    NVL(re.CUMULATIVE_RE, 0)                             AS closing,
    NVL(re.RE_MOVEMENT, 0)                               AS re_movement,
    NVL(re.ENTERED_OPENING, 0)                           AS entered_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS entered_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS entered_credit,
    NVL(re.ENTERED_CLOSING, 0)                           AS entered_closing,
    NVL(re.OPENING, 0)                                   AS ytd_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS ytd_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS ytd_credit,
    NVL(re.OPENING, 0)                                   AS ytd_entered_opening,
    CASE WHEN re.NET_PL > 0 THEN  re.NET_PL ELSE 0 END   AS ytd_entered_debit,
    CASE WHEN re.NET_PL < 0 THEN -re.NET_PL ELSE 0 END   AS ytd_entered_credit
FROM RR_GL_RETAINED_EARNINGS re
WHERE re.LEDGER_NAME = :ledger_name
  AND (:company     IS NULL OR re.COMPANY              = :company)
  AND (:period_name IS NULL OR re.PERIOD_NAME          = :period_name)
  AND (:period_year IS NULL OR TO_CHAR(re.FISCAL_YEAR) = :period_year)
ORDER BY re.FISCAL_YEAR, re.COMPANY
]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET gl/rr-trialbalance/standardRE replaced');
END;
/


-- ------------------------------------------------------------
-- 4. GET gl/retained-earnings — for the Retrieve tab
--    Aliased to the names the UI grid expects.
--    NOTE: the table has a no-delete trigger, so no DELETE
--    handler is defined — rows are corrected by re-saving.
-- ------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/retained-earnings',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Saved retained earnings rows'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/retained-earnings',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Saved RE rows for the Retrieve Retained Earnings tab',
        p_source         => q'[
SELECT
    re.ID                                                AS id,
    re.LEDGER_NAME                                       AS ledger_name,
    re.FISCAL_YEAR                                       AS year,
    re.PERIOD_NAME                                       AS last_period,
    re.COMPANY                                           AS company,
    re.ACCOUNT                                           AS re_account,
    NVL(re.REVENUE, 0)                                   AS revenue,
    NVL(re.EXPENSES, 0)                                  AS expenses,
    NVL(re.NET_PL, 0)                                    AS net_pl,
    NVL(re.RE_CURRENT, 0)                                AS re_balance,
    NVL(re.RE_MOVEMENT, 0)                               AS re_movement,
    NVL(re.OPENING, 0)                                   AS opening_re,
    NVL(re.CLOSING, 0)                                   AS closing_re,
    NVL(re.CUMULATIVE_RE, 0)                             AS cumulative_re,
    TO_CHAR(re.CALCULATED_DATE, 'YYYY-MM-DD HH24:MI')    AS updated_date,
    re.CREATED_BY                                        AS created_by
FROM RR_GL_RETAINED_EARNINGS re
WHERE (:ledger_name IS NULL OR re.LEDGER_NAME = :ledger_name)
  AND (:company     IS NULL OR NVL(re.COMPANY, '~') = NVL(:company, '~'))
ORDER BY re.LEDGER_NAME, re.COMPANY, re.FISCAL_YEAR
]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET gl/retained-earnings defined');
END;
/


-- ------------------------------------------------------------
-- 5. Verify
-- ------------------------------------------------------------

-- 5a. Handlers deployed?
SELECT t.uri_template, h.method, h.source_type
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template IN ('gl/retained-earnings',
                          'gl/retained-earnings/save',
                          'gl/rr-trialbalance/standardRE')
ORDER  BY t.uri_template, h.method;

-- 5b. Data check — AFTER re-saving the rollforward from the UI:
--     2026 should show OPENING = -1,392,372,150.89,
--     RE_MOVEMENT = 41,818,707.61, CLOSING = -1,593,162,949.32
SELECT fiscal_year, period_name, company,
       opening, net_pl, re_movement, closing, re_current, cumulative_re
FROM   rr_gl_retained_earnings
WHERE  ledger_name = 'SB LEDGER'
ORDER  BY company, fiscal_year;
