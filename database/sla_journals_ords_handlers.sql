-- =============================================================================
-- SLA Journals ORDS handlers — OWA_UTIL.MIME_HEADER + chunked output
-- Run in: SQL Workshop > SQL Commands  (one block at a time)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Drop existing handlers / templates
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'sla/journals');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'sla/journals/lines');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- ---------------------------------------------------------------------------
-- Recreate templates
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals',
        p_comments    => 'SLA Journal Entries (headers)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals/lines',
        p_comments    => 'SLA Journal Entry Lines'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- GET sla/journals
-- OWA_UTIL.MIME_HEADER bypasses ORDS JSON-string wrapping so that
-- chunked HTP.PRN output is served as raw bytes (no double-encoding).
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Query SLA headers',
        p_source      =>
'DECLARE
  v_result CLOB;
  v_offset INTEGER := 1;
  v_len    INTEGER;
  v_amt    CONSTANT INTEGER := 8000;
BEGIN
  v_result := RR_SLA_JOURNALS_PKG.get_headers(
    p_accounting_status => :accountingStatus,
    p_module_name       => :moduleName,
    p_source_table      => :sourceTable,
    p_event_type_code   => :eventTypeCode,
    p_period_name       => :periodName,
    p_source_number     => :sourceNumber,
    p_date_from         => :dateFrom,
    p_date_to           => :dateTo,
    p_limit             => TO_NUMBER(:limit)
  );
  :status_code := 200;
  OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
  v_len := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
  WHILE v_offset <= v_len LOOP
    HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_amt, v_offset));
    v_offset := v_offset + v_amt;
  END LOOP;
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


-- ---------------------------------------------------------------------------
-- GET sla/journals/lines
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'sla/journals/lines',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Query SLA lines',
        p_source      =>
'DECLARE
  v_result CLOB;
  v_offset INTEGER := 1;
  v_len    INTEGER;
  v_amt    CONSTANT INTEGER := 8000;
BEGIN
  v_result := RR_SLA_JOURNALS_PKG.get_lines(
    p_header_id           => TO_NUMBER(:headerId),
    p_source_id           => TO_NUMBER(:sourceId),
    p_accounting_status   => :accountingStatus,
    p_module_name         => :moduleName,
    p_source_table        => :sourceTable,
    p_line_type           => :lineType,
    p_accounting_class    => :accountingClass,
    p_account_combination => :accountCombination,
    p_source_number       => :sourceNumber,
    p_date_from           => :dateFrom,
    p_date_to             => :dateTo,
    p_limit               => TO_NUMBER(:limit)
  );
  :status_code := 200;
  OWA_UTIL.MIME_HEADER(''application/json'', TRUE);
  v_len := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
  WHILE v_offset <= v_len LOOP
    HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_amt, v_offset));
    v_offset := v_offset + v_amt;
  END LOOP;
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
