-- ============================================================
-- Fix: reerp/gl/journals/lines — remove RR_GL_JE_BATCHES join
-- (table may not exist); filter date via PERIOD_NAME or acct_date
-- if DEFAULT_EFFECTIVE_DATE column is available on headers.
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
        p_comments       => 'GL lines — filter by reference1/2/5, account (LIKE), date range on ACCOUNTING_DATE',
        p_source         => q'[
SELECT
    l.LINE_ID                   AS line_id,
    l.JE_LINE_NUMBER            AS line_num,
    l.JE_HEADER_ID              AS je_header_id,
    h.JOURNAL_NAME              AS journal_name,
    h.PERIOD_NAME               AS period_name,
    h.ACCOUNTING_DATE           AS accounting_date,
    h.JE_BATCH_ID               AS je_batch_id,
    h.JE_CATEGORY               AS je_category,
    h.JE_SOURCE                 AS je_source,
    h.STATUS                    AS journal_status,
    CASE WHEN h.STATUS = 'P' THEN 'POSTED'
         WHEN h.STATUS = 'U' THEN 'UNPOSTED'
         ELSE NVL(h.STATUS, 'UNKNOWN')
    END                         AS posting_status,
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
WHERE (:period_name IS NULL OR h.PERIOD_NAME        = :period_name)
  AND (:reference1  IS NULL OR l.REFERENCE1         = :reference1)
  AND (:reference2  IS NULL OR l.REFERENCE2         = :reference2)
  AND (:reference5  IS NULL OR l.REFERENCE5         = :reference5)
  AND (:account     IS NULL OR l.ACCOUNT_COMBINATION LIKE '%' || :account || '%')
  AND (:date_from   IS NULL OR h.ACCOUNTING_DATE   >= TO_DATE(:date_from, 'YYYY-MM-DD'))
  AND (:date_to     IS NULL OR h.ACCOUNTING_DATE   <= TO_DATE(:date_to,   'YYYY-MM-DD'))
ORDER BY h.ACCOUNTING_DATE, l.JE_HEADER_ID, l.JE_LINE_NUMBER
FETCH FIRST NVL(:limit, 2000) ROWS ONLY
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('reerp/gl/journals/lines fixed — no batch join');
END;
/

-- ============================================================
-- NOTE: Uses h.ACCOUNTING_DATE (standard GL column name).
-- If that column doesn't exist on your RR_GL_JE_HEADERS, try:
--   h.DEFAULT_EFFECTIVE_DATE  or  h.POSTED_DATE
-- Check with: SELECT column_name FROM user_tab_columns
--             WHERE table_name = 'RR_GL_JE_HEADERS';
-- ============================================================
