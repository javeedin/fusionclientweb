-- ============================================================
-- 119d_delete_sla_correct_tables.sql
-- GET /sla/accounting/delete?headerId=N
-- Correct table names: RR_SLA_ACCOUNTING_HEADERS / LINES
-- Module: sla, Pattern: accounting/delete
-- Run in SQL Developer against the BCLDIFC schema.
-- ============================================================

-- Remove any previous handlers on this pattern
BEGIN
  ORDS.DELETE_HANDLER(p_module_name=>'sla', p_pattern=>'accounting/delete', p_method=>'GET');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  ORDS.DELETE_HANDLER(p_module_name=>'sla', p_pattern=>'accounting/delete', p_method=>'POST');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
  ORDS.DELETE_HANDLER(p_module_name=>'sla', p_pattern=>'accounting/delete', p_method=>'DELETE');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'sla',
    p_pattern        => 'accounting/delete',
    p_method         => 'GET',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_id     NUMBER  := TO_NUMBER(:headerId);
  v_status VARCHAR2(30);
  v_lines  NUMBER := 0;
BEGIN
  SELECT NVL(ACCOUNTING_STATUS, 'DRAFT')
  INTO   v_status
  FROM   RR_SLA_ACCOUNTING_HEADERS
  WHERE  HEADER_ID = v_id;

  IF v_status = 'POSTED' THEN
    HTP.P('{"status":"error","message":"Cannot delete a POSTED header"}');
    RETURN;
  END IF;

  DELETE FROM RR_SLA_ACCOUNTING_LINES   WHERE HEADER_ID = v_id;
  v_lines := SQL%ROWCOUNT;
  DELETE FROM RR_SLA_ACCOUNTING_HEADERS WHERE HEADER_ID = v_id;
  COMMIT;

  HTP.P('{"status":"success","linesDeleted":' || v_lines || '}');
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    HTP.P('{"status":"error","message":"Header not found"}');
  WHEN OTHERS THEN
    ROLLBACK;
    HTP.P('{"status":"error","message":"Internal error"}');
END;
]'
  );
  COMMIT;
END;
/
