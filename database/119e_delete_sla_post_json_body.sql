-- ============================================================
-- 119e_delete_sla_post_json_body.sql
-- POST /sla/accounting/delete
-- Body: {"headerId": 845}
-- Module: sla, Pattern: accounting/delete
-- Run in SQL Developer against the BCLDIFC schema.
-- ============================================================

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
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_body   CLOB;
  v_json   CLOB;
  v_id     NUMBER;
  v_status VARCHAR2(30);
  v_lines  NUMBER := 0;
BEGIN
  v_body := :body;
  v_id   := TO_NUMBER(JSON_VALUE(v_body, '$.headerId'));

  IF v_id IS NULL THEN
    HTP.P('{"status":"error","message":"headerId is required in JSON body"}');
    RETURN;
  END IF;

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
