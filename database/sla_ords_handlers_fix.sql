-- =============================================================================
-- FIX: SLA ORDS Handlers — PLS-00382 type error
-- =============================================================================
-- Root cause: ORDS bind variable :body is BLOB, but handlers were assigning
--             CLOB (v_response) to it → PLS-00382 at compile time.
--             Also :status is non-standard; correct name is :status_code.
--
-- Pattern applied to ALL five SLA handlers:
--   BEFORE (broken):  :status := v_status;  :body := v_response;
--   AFTER  (fixed):   :status_code := v_status;
--                     OWA_UTIL.MIME_HEADER('application/json', TRUE);
--                     HTP.PRN(v_response);
--
-- Module : reerp
-- Schema : bcldifc  (adjust if different)
-- Run in : SQL Workshop > SQL Commands (as schema owner)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. sla/accounting/create  (POST)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/accounting/create',
        p_method      => 'POST'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'sla/accounting/create',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create SLA accounting entries from JSON payload',
        p_source         => q'[
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.create_accounting(
    p_body_json => :body_text,
    p_status    => v_status,
    p_response  => v_response
  );
  :status_code := v_status;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(v_response);
END;]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 2. sla/accounting/post  (POST)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/accounting/post',
        p_method      => 'POST'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'sla/accounting/post',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Post SLA accounting to GL — stamps GL batch/header IDs and locks header',
        p_source         => q'[
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.post_to_ledger(
    p_body_json => :body_text,
    p_status    => v_status,
    p_response  => v_response
  );
  :status_code := v_status;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(v_response);
END;]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 3. sla/accounting/error  (POST)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/accounting/error',
        p_method      => 'POST'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'sla/accounting/error',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Mark SLA header as ERROR when GL write fails',
        p_source         => q'[
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.mark_error(
    p_body_json => :body_text,
    p_status    => v_status,
    p_response  => v_response
  );
  :status_code := v_status;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(v_response);
END;]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 4. sla/accounting  (GET) — get header + lines for a source transaction
--    Uses query parameters: sourceTable, sourceId
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/accounting',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'sla/accounting',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_comments       => 'Retrieve SLA header + lines for a source transaction',
        p_source         => q'[
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.get_accounting(
    p_source_table => :sourceTable,
    p_source_id    => TO_NUMBER(:sourceId),
    p_status       => v_status,
    p_response     => v_response
  );
  :status_code := v_status;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(v_response);
END;]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 5. sla/accounting/exists  (GET) — check if accounting exists
--    Uses query parameters: sourceTable, sourceId, eventType (optional)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/accounting/exists',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'sla/accounting/exists',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_comments       => 'Check whether accounting exists for a source transaction',
        p_source         => q'[
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.check_accounting_exists(
    p_source_table => :sourceTable,
    p_source_id    => TO_NUMBER(:sourceId),
    p_event_type   => :eventType,
    p_status       => v_status,
    p_response     => v_response
  );
  :status_code := v_status;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(v_response);
END;]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- Verify all five handlers are registered
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, h.source_type,
       SUBSTR(h.source, 1, 80) AS source_preview
FROM   user_ords_modules m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template LIKE 'sla/%'
ORDER BY t.uri_template, h.method;
