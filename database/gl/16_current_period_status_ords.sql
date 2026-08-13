-- ============================================================
-- ORDS Handler: GET /reerp/currentperiodstatus
--
-- Returns one row per (LEDGER_NAME, APPLICATION) combination
-- showing the prior, current and next accounting period with status.
--
-- "Current" period = the period whose date range contains SYSDATE.
-- If none contains SYSDATE, falls back to the most recent Open period,
-- then to the most recent period overall.
--
-- Source table: RR_GL_FISCAL_PERIODS (adj_flag = 'N' rows only)
--
-- Response shape (per item):
--   ledger_name, app, application_name,
--   prior_period,   prior_status,
--   current_period, current_status,
--   next_period,    next_status
-- ============================================================

BEGIN
    -- ── Template ──────────────────────────────────────────────
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'currentperiodstatus',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Current period status summary — prior/current/next per ledger/application'
    );

    -- ── GET handler ───────────────────────────────────────────
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'currentperiodstatus',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'One row per ledger/app with prior, current and next period info',
        p_source         => '
SELECT
    ledger_name,
    application     AS app,
    CASE application
        WHEN ''GL''  THEN ''General Ledger''
        WHEN ''AP''  THEN ''Payables''
        WHEN ''AR''  THEN ''Receivables''
        WHEN ''INV'' THEN ''Inventory''
        WHEN ''FA''  THEN ''Fixed Assets''
        ELSE application
    END             AS application_name,
    prior_period,
    prior_status,
    current_period,
    current_status,
    next_period,
    next_status
FROM (
    SELECT
        fp.ledger_name,
        fp.application,
        fp.period_name                                                             AS current_period,
        fp.status                                                                  AS current_status,
        LAG(fp.period_name)  OVER (PARTITION BY fp.ledger_name, fp.application
                                   ORDER BY fp.fiscal_year, fp.fiscal_period)     AS prior_period,
        LAG(fp.status)       OVER (PARTITION BY fp.ledger_name, fp.application
                                   ORDER BY fp.fiscal_year, fp.fiscal_period)     AS prior_status,
        LEAD(fp.period_name) OVER (PARTITION BY fp.ledger_name, fp.application
                                   ORDER BY fp.fiscal_year, fp.fiscal_period)     AS next_period,
        LEAD(fp.status)      OVER (PARTITION BY fp.ledger_name, fp.application
                                   ORDER BY fp.fiscal_year, fp.fiscal_period)     AS next_status,
        ROW_NUMBER() OVER (
            PARTITION BY fp.ledger_name, fp.application
            ORDER BY
                -- 1st preference: period date range contains today
                CASE WHEN fp.start_date <= SYSDATE AND fp.end_date >= SYSDATE THEN 0 ELSE 1 END,
                -- 2nd preference: Open period
                CASE WHEN fp.status = ''Open'' THEN 0 ELSE 1 END,
                -- 3rd preference: most recent period
                fp.fiscal_year  DESC,
                fp.fiscal_period DESC
        ) AS rn
    FROM rr_gl_fiscal_periods fp
    WHERE fp.adj_flag = ''N''
)
WHERE rn = 1
ORDER BY ledger_name, application
'
    );

    COMMIT;
END;
/

-- ============================================================
-- To verify after running:
--   SELECT * FROM TABLE(APEX_REST.GET_HANDLER('reerp','currentperiodstatus','GET'));
-- Or just hit the endpoint:
--   GET /ords/bcldifc/reerp/currentperiodstatus
-- ============================================================
