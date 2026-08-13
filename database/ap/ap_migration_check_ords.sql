-- =============================================================================
-- ORDS Handlers — AP Migration Check
-- =============================================================================
-- Module  : reerp
-- Patterns:
--   GET /reerp/ap/migration-check/summary
--   GET /reerp/ap/migration-check/details
--
-- Query parameters (summary):
--   businessUnit   VARCHAR2   filter by business unit (optional)
--
-- Query parameters (details):
--   businessUnit   VARCHAR2   filter by business unit (optional)
--   filter         VARCHAR2   ALL | ISSUES (default) | MISSING_LINES | AMOUNT_MISMATCH | TRUNCATED
--   limit          NUMBER     default 500
--   offset         NUMBER     default 0
--
-- Examples:
--   GET .../reerp/ap/migration-check/summary
--   GET .../reerp/ap/migration-check/summary?businessUnit=BUIMERC+CORP+FZE_JAFZA_TRADING
--   GET .../reerp/ap/migration-check/details?filter=ISSUES&limit=100&offset=0
--   GET .../reerp/ap/migration-check/details?filter=MISSING_LINES
-- =============================================================================


-- ===========================================================================
-- 1.  SUMMARY  handler
-- ===========================================================================

-- 1a. Drop if exists
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/migration-check/summary'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- 1b. Create template
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/migration-check/summary',
        p_comments    => 'AP migration check — summary statistics'
    );
    COMMIT;
END;
/

-- 1c. GET handler
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'ap/migration-check/summary',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Delegates to RR_AP_MIGRATION_CHECK_PKG.get_summary',
        p_source      =>
'DECLARE
  v_result CLOB;
BEGIN
  v_result := RR_AP_MIGRATION_CHECK_PKG.get_summary(
    p_business_unit => :businessUnit
  );
  :status_code := 200;
  OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
  HTP.PRN(v_result);
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
    HTP.PRN(''{"error":true,"message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/


-- ===========================================================================
-- 2.  DETAILS  handler
-- ===========================================================================

-- 2a. Drop if exists
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/migration-check/details'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- 2b. Create template
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/migration-check/details',
        p_comments    => 'AP migration check — per-invoice comparison details (paginated)'
    );
    COMMIT;
END;
/

-- 2c. GET handler
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'ap/migration-check/details',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Delegates to RR_AP_MIGRATION_CHECK_PKG.get_details',
        p_source      =>
'DECLARE
  v_result CLOB;
  v_limit  NUMBER := NVL(TO_NUMBER(:limit),  500);
  v_offset NUMBER := NVL(TO_NUMBER(:offset), 0);
BEGIN
  v_result := RR_AP_MIGRATION_CHECK_PKG.get_details(
    p_business_unit => :businessUnit,
    p_filter        => NVL(:filter, ''ISSUES''),
    p_limit         => v_limit,
    p_offset        => v_offset
  );
  :status_code := 200;
  OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
  HTP.PRN(v_result);
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
    HTP.PRN(''{"error":true,"message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/


-- ===========================================================================
-- 3.  Verify
-- ===========================================================================
SELECT t.uri_template, h.method, SUBSTR(h.source, 1, 60) AS source_preview
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
  AND  t.uri_template IN ('ap/migration-check/summary', 'ap/migration-check/details')
ORDER BY t.uri_template, h.method;
