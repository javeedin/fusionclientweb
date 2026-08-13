-- ============================================================
-- 119b_fix_delete_sla_use_query_param.sql
-- Replaces the path-param DELETE handler (which caused ORDS 400)
-- with a query-param DELETE at sla/accounting/delete?headerId=X
-- ============================================================

-- Remove old path-param handler if it was registered
BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'ap',
    p_pattern     => 'sla/accounting/:headerId',
    p_method      => 'DELETE'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Remove existing handler on new pattern if any
BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'ap',
    p_pattern     => 'sla/accounting/delete',
    p_method      => 'DELETE'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Define the DELETE handler using query parameter :headerId
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'sla/accounting/delete',
    p_method         => 'DELETE',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_comments       => 'Delete a DRAFT SLA accounting header and its lines (headerId as query param)',
    p_source         => q'[
DECLARE
  v_header_id  NUMBER;
  v_status     VARCHAR2(20);
  v_line_count NUMBER;
BEGIN
  BEGIN
    v_header_id := TO_NUMBER(:headerId);
  EXCEPTION WHEN OTHERS THEN
    :status := 400;
    HTP.P('{"status":"error","message":"headerId must be a number"}');
    RETURN;
  END;

  IF v_header_id IS NULL THEN
    :status := 400;
    HTP.P('{"status":"error","message":"headerId query parameter is required"}');
    RETURN;
  END IF;

  -- Check the header exists and is not POSTED
  BEGIN
    SELECT NVL(ACCOUNTING_STATUS, 'DRAFT')
    INTO   v_status
    FROM   RR_SLA_JOURNAL_HEADERS
    WHERE  HEADER_ID = v_header_id;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      :status := 404;
      HTP.P('{"status":"error","message":"SLA header not found: ' || v_header_id || '"}');
      RETURN;
  END;

  IF v_status = 'POSTED' THEN
    :status := 409;
    HTP.P('{"status":"error","message":"Cannot delete a POSTED SLA header"}');
    RETURN;
  END IF;

  -- Delete lines first (FK constraint)
  DELETE FROM RR_SLA_JOURNAL_LINES  WHERE HEADER_ID = v_header_id;
  v_line_count := SQL%ROWCOUNT;

  -- Delete header
  DELETE FROM RR_SLA_JOURNAL_HEADERS WHERE HEADER_ID = v_header_id;

  COMMIT;

  HTP.P('{"status":"success","headerId":' || v_header_id || ',"linesDeleted":' || v_line_count || ',"message":"Deleted successfully"}');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status := 500;
    HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
  );
  COMMIT;
END;
/
