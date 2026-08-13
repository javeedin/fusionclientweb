-- ============================================================
-- Patch: reerp/gl/journals/lines — add reference3-5, batch status,
--        je_category, je_source so View Accounting can use this
--        endpoint exclusively (no SLA tables needed).
--
-- Run in APEX SQL Workshop (reerp module)
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/lines',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/lines',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'GL lines filtered by period_name / reference1 / reference2 / account / date range; includes ref3-5, batch status',
        p_source         => q'[
SELECT
    l.LINE_ID                   AS line_id,
    l.JE_LINE_NUMBER            AS line_num,
    l.JE_HEADER_ID              AS je_header_id,
    b.JE_BATCH_ID               AS je_batch_id,
    h.JOURNAL_NAME              AS journal_name,
    b.NAME                      AS batch_name,
    h.PERIOD_NAME               AS period_name,
    h.DEFAULT_EFFECTIVE_DATE    AS accounting_date,
    h.JE_CATEGORY               AS je_category,
    h.JE_SOURCE                 AS je_source,
    h.STATUS                    AS journal_status,
    b.STATUS                    AS batch_status,
    l.REFERENCE1                AS reference1,
    l.REFERENCE2                AS reference2,
    l.REFERENCE3                AS reference3,
    l.REFERENCE4                AS reference4,
    l.REFERENCE5                AS reference5,
    l.REFERENCE6                AS reference6,
    l.ACCOUNT_COMBINATION       AS account,
    l.DESCRIPTION               AS description,
    l.ENTERED_DR                AS entered_dr,
    l.ENTERED_CR                AS entered_cr,
    l.ACCOUNTED_DR              AS accounted_dr,
    l.ACCOUNTED_CR              AS accounted_cr,
    l.CURRENCY_CODE             AS currency_code
FROM RR_GL_JE_LINES_ALL  l
JOIN RR_GL_JE_HEADERS    h ON h.JE_HEADER_ID = l.JE_HEADER_ID
JOIN RR_GL_JE_BATCHES    b ON b.JE_BATCH_ID  = h.JE_BATCH_ID
WHERE (:period_name IS NULL OR h.PERIOD_NAME   = :period_name)
  AND (:reference1  IS NULL OR l.REFERENCE1    = :reference1)
  AND (:reference2  IS NULL OR l.REFERENCE2    = :reference2)
  AND (:reference5  IS NULL OR l.REFERENCE5    = :reference5)
  AND (:account     IS NULL OR l.ACCOUNT_COMBINATION LIKE '%' || :account || '%')
  AND (:date_from   IS NULL OR h.DEFAULT_EFFECTIVE_DATE >= TO_DATE(:date_from, 'YYYY-MM-DD'))
  AND (:date_to     IS NULL OR h.DEFAULT_EFFECTIVE_DATE <= TO_DATE(:date_to,   'YYYY-MM-DD'))
ORDER BY h.DEFAULT_EFFECTIVE_DATE, l.JE_HEADER_ID, l.JE_LINE_NUMBER
FETCH FIRST NVL(:limit, 2000) ROWS ONLY
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('reerp/gl/journals/lines updated with reference3-5 and batch status');
END;
/

-- ============================================================
-- ENDPOINT SUMMARY
-- GET {base}/gl/journals/lines?reference2={checkId}&limit=500
--   Returns: line_id, je_header_id, je_batch_id, journal_name,
--            batch_name, period_name, accounting_date, je_category,
--            journal_status, batch_status, reference1-6,
--            account, description, entered_dr, entered_cr,
--            accounted_dr, accounted_cr, currency_code
-- ============================================================
