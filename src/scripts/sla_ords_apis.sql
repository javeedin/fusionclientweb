-- =============================================================================
-- RR ERP – SLA ORDS REST API Handlers
-- Prerequisite: run sla_tables.sql then sla_package.sql first.
-- Each handler is a thin wrapper that delegates to RR_SLA_PKG.
-- Base path: /reerp/sla/
-- =============================================================================

-- =============================================================================
-- HANDLER 1 – POST /reerp/sla/accounting/create
--   Body: { header: {...}, lines: [{...}] }
-- =============================================================================
-- Paste the block below as the PL/SQL source in the ORDS handler:
/*
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.create_accounting(
    p_body_json => :body_text,
    p_status    => v_status,
    p_response  => v_response
  );
  :status := v_status;
  :body   := v_response;
END;
*/

-- =============================================================================
-- HANDLER 2 – POST /reerp/sla/accounting/post
--   Body: { headerId, postedBy, glBatchId, glBatchName, glHeaderId }
-- =============================================================================
/*
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.post_to_ledger(
    p_body_json => :body_text,
    p_status    => v_status,
    p_response  => v_response
  );
  :status := v_status;
  :body   := v_response;
END;
*/

-- =============================================================================
-- HANDLER 3 – POST /reerp/sla/accounting/error
--   Body: { headerId, errorMessage, postedBy }
-- =============================================================================
/*
DECLARE
  v_status   NUMBER;
  v_response CLOB;
BEGIN
  RR_SLA_PKG.mark_error(
    p_body_json => :body_text,
    p_status    => v_status,
    p_response  => v_response
  );
  :status := v_status;
  :body   := v_response;
END;
*/

-- =============================================================================
-- HANDLER 4 – GET /reerp/sla/accounting?sourceTable=AP_INVOICES&sourceId=123
-- =============================================================================
/*
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
  :status := v_status;
  :body   := v_response;
END;
*/

-- =============================================================================
-- HANDLER 5 – GET /reerp/sla/accounting/exists?sourceTable=AP_INVOICES&sourceId=123&eventType=AP_INVOICE_CREATION
-- =============================================================================
/*
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
  :status := v_status;
  :body   := v_response;
END;
*/

-- =============================================================================
-- ORDS Module Registration
-- Run once to wire up the module + templates + handlers programmatically.
-- Alternatively register each handler manually in the APEX REST Workshop UI.
-- =============================================================================
BEGIN
  -- ── Module ──────────────────────────────────────────────────────────────────
  ORDS.DEFINE_MODULE(
    p_module_name    => 'reerp.sla',
    p_base_path      => '/reerp/sla/',
    p_items_per_page => 0,    -- no paging for action endpoints
    p_status         => 'PUBLISHED',
    p_comments       => 'RR ERP Subledger Accounting REST APIs'
  );

  -- ── Template + Handler: create ──────────────────────────────────────────────
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp.sla',
    p_pattern     => 'accounting/create',
    p_comments    => 'Create or replace a DRAFT SLA header + lines'
  );
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp.sla',
    p_pattern        => 'accounting/create',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Delegates to RR_SLA_PKG.create_accounting',
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
  :status := v_status;
  :body   := v_response;
END;
]'
  );

  -- ── Template + Handler: post ─────────────────────────────────────────────────
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp.sla',
    p_pattern     => 'accounting/post',
    p_comments    => 'Stamp GL IDs and lock header to POSTED'
  );
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp.sla',
    p_pattern        => 'accounting/post',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Delegates to RR_SLA_PKG.post_to_ledger',
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
  :status := v_status;
  :body   := v_response;
END;
]'
  );

  -- ── Template + Handler: error ────────────────────────────────────────────────
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp.sla',
    p_pattern     => 'accounting/error',
    p_comments    => 'Mark a header as ERROR when GL write fails'
  );
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp.sla',
    p_pattern        => 'accounting/error',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Delegates to RR_SLA_PKG.mark_error',
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
  :status := v_status;
  :body   := v_response;
END;
]'
  );

  -- ── Template + Handler: GET accounting ──────────────────────────────────────
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp.sla',
    p_pattern     => 'accounting',
    p_comments    => 'Fetch SLA header + lines for a source transaction'
  );
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp.sla',
    p_pattern        => 'accounting',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_comments       => 'Delegates to RR_SLA_PKG.get_accounting',
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
  :status := v_status;
  :body   := v_response;
END;
]'
  );

  -- ── Template + Handler: check_accounting_exists ──────────────────────────────
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp.sla',
    p_pattern     => 'accounting/exists',
    p_comments    => 'Check if SLA accounting entry exists for a source transaction'
  );
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp.sla',
    p_pattern        => 'accounting/exists',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_comments       => 'Delegates to RR_SLA_PKG.check_accounting_exists',
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
  :status := v_status;
  :body   := v_response;
END;
]'
  );

  COMMIT;
END;
/

-- =============================================================================
-- END OF ORDS API HANDLERS
-- =============================================================================
