-- ============================================================
-- 119_add_delete_sla_accounting_handler.sql
-- Adds DELETE handler for ap/sla/accounting/:headerId
-- Used by Re-create Accounting to delete old DRAFT SLA header
-- before creating a fresh one.
-- Run in SQL Developer against the BCLDIFC schema.
-- ============================================================

-- Remove existing DELETE handler if any
BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'ap',
    p_pattern     => 'sla/accounting/:headerId',
    p_method      => 'DELETE'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Define the DELETE handler
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'sla/accounting/:headerId',
    p_method         => 'DELETE',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_comments       => 'Delete a DRAFT SLA accounting header and its lines',
    p_source         => q'[
DECLARE
  v_header_id  NUMBER := TO_NUMBER(:headerId DEFAULT NULL ON CONVERSION ERROR);
  v_status     VARCHAR2(20);
  v_line_count NUMBER;
BEGIN
  IF v_header_id IS NULL THEN
    :status := 400;
    HTP.P('{"status":"error","message":"headerId is required"}');
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
      HTP.P('{"status":"error","message":"SLA header ' || v_header_id || ' not found"}');
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

  HTP.P('{"status":"success","message":"SLA header ' || v_header_id || ' deleted","linesDeleted":' || v_line_count || '}');
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
