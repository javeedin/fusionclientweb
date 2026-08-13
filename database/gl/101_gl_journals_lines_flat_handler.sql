-- ============================================================
-- New endpoint: reerp/gl/journals/lines
--
-- Flat GL journal lines query — no journal ID required.
-- Supports filtering by period_name, reference1, reference2, limit.
-- Used by AP/Cash–GL reconciliation tabs.
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
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/lines'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/lines',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Flat GL journal lines with period and reference filters'
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
        p_comments       => 'GL lines filtered by period_name / reference1 / reference2',
        p_source         => q'[
SELECT
    l.LINE_ID                   AS line_id,
    l.JE_LINE_NUMBER            AS line_num,
    l.JE_HEADER_ID              AS je_header_id,
    h.NAME                      AS journal_name,
    h.PERIOD_NAME               AS period_name,
    l.REFERENCE1                AS reference1,
    l.REFERENCE2                AS reference2,
    l.ACCOUNT_COMBINATION       AS account,
    l.DESCRIPTION               AS description,
    l.ENTERED_DR                AS entered_dr,
    l.ENTERED_CR                AS entered_cr,
    l.ACCOUNTED_DR              AS accounted_dr,
    l.ACCOUNTED_CR              AS accounted_cr,
    l.CURRENCY_CODE             AS currency_code
FROM RR_GL_JE_LINES_ALL  l
JOIN RR_GL_JE_HEADERS    h ON h.JE_HEADER_ID = l.JE_HEADER_ID
WHERE (:period_name IS NULL OR h.PERIOD_NAME = :period_name)
  AND (:reference1  IS NULL OR l.REFERENCE1  = :reference1)
  AND (:reference2  IS NULL OR l.REFERENCE2  = :reference2)
ORDER BY h.PERIOD_NAME, l.JE_HEADER_ID, l.JE_LINE_NUMBER
FETCH FIRST NVL(:limit, 1000) ROWS ONLY
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('reerp/gl/journals/lines created successfully');
END;
/
