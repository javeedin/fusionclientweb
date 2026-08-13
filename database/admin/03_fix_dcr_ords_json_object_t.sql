-- ============================================================
-- FIX: Replace JSON_OBJECT_T with JSON_VALUE / JSON_TABLE
-- ORA-40573: PL/SQL JSON object type not supported in ORDS sandbox
-- Re-registers all 5 change-request handlers + search + record
-- ============================================================


-- ── POST /admin/change-requests  (create header) ─────────────────────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/change-requests',p_method=>'POST'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/change-requests',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_body  CLOB := :body_text;
  v_id    NUMBER;
  v_num   VARCHAR2(20);
BEGIN
  INSERT INTO rr_data_change_request_header (
    transaction_type, transaction_id, transaction_ref,
    table_name, description, created_by
  ) VALUES (
    JSON_VALUE(v_body, '$.transactionType'),
    TO_NUMBER(JSON_VALUE(v_body, '$.transactionId')),
    JSON_VALUE(v_body, '$.transactionRef'),
    JSON_VALUE(v_body, '$.tableName'),
    JSON_VALUE(v_body, '$.description'),
    NVL(JSON_VALUE(v_body, '$.createdBy'), 'ERP_USER')
  ) RETURNING request_id, request_number INTO v_id, v_num;
  COMMIT;
  HTP.P('{"success":true,"requestId":' || v_id || ',"requestNumber":"' || v_num || '"}');
EXCEPTION WHEN OTHERS THEN
  ROLLBACK;
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}'); END;
END;
    ]'
  );
  COMMIT;
END;
/


-- ── GET /admin/change-requests  (list) ───────────────────────────────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/change-requests',p_method=>'GET'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/change-requests',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_collection_feed,
    p_items_per_page => 0,
    p_source         => q'[
      SELECT h.request_id, h.request_number, h.status, h.transaction_type,
             h.transaction_id, h.transaction_ref, h.table_name, h.description,
             h.created_by, h.creation_date, h.approved_by, h.approval_date,
             h.executed_by, h.executed_date, h.rejected_by, h.rejection_reason,
             (SELECT COUNT(*) FROM rr_data_change_request_details d WHERE d.request_id = h.request_id) AS detail_count
      FROM   rr_data_change_request_header h
      WHERE  (:status IS NULL OR h.status = :status)
        AND  (:transaction_type IS NULL OR h.transaction_type = :transaction_type)
        AND  (:created_by IS NULL OR UPPER(h.created_by) LIKE '%' || UPPER(:created_by) || '%')
      ORDER BY h.creation_date DESC
    ]'
  );
  COMMIT;
END;
/


-- ── GET /admin/change-requests/:id  (single + details + sqls) ────────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/change-requests/:id',p_method=>'GET'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/change-requests/:id',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_header CLOB;
  v_details CLOB;
  v_sqls    CLOB;
BEGIN
  -- Build header JSON
  SELECT JSON_OBJECT(
    'requestId'       VALUE request_id,
    'requestNumber'   VALUE request_number,
    'status'          VALUE status,
    'transactionType' VALUE transaction_type,
    'transactionId'   VALUE transaction_id,
    'transactionRef'  VALUE transaction_ref,
    'tableName'       VALUE table_name,
    'description'     VALUE description,
    'createdBy'       VALUE created_by,
    'creationDate'    VALUE TO_CHAR(creation_date,'YYYY-MM-DD HH24:MI:SS'),
    'approvedBy'      VALUE approved_by,
    'executedBy'      VALUE executed_by,
    'executedDate'    VALUE TO_CHAR(executed_date,'YYYY-MM-DD HH24:MI:SS'),
    'rejectedBy'      VALUE rejected_by,
    'rejectionReason' VALUE rejection_reason
    ABSENT ON NULL
  )
  INTO v_header
  FROM rr_data_change_request_header
  WHERE request_id = :id;

  -- Build details JSON array
  SELECT NVL(JSON_ARRAYAGG(
    JSON_OBJECT(
      'detailId'    VALUE detail_id,
      'tableName'   VALUE table_name,
      'columnName'  VALUE column_name,
      'columnLabel' VALUE column_label,
      'dataType'    VALUE data_type,
      'oldValue'    VALUE old_value,
      'newValue'    VALUE new_value,
      'whereColumn' VALUE where_column,
      'whereValue'  VALUE where_value
      ABSENT ON NULL
    ) ORDER BY seq_num
  ), '[]')
  INTO v_details
  FROM rr_data_change_request_details
  WHERE request_id = :id;

  -- Build sqls JSON array
  SELECT NVL(JSON_ARRAYAGG(
    JSON_OBJECT(
      'sqlId'           VALUE sql_id,
      'sqlText'         VALUE sql_text,
      'executionStatus' VALUE execution_status,
      'executedDate'    VALUE TO_CHAR(executed_date,'YYYY-MM-DD HH24:MI:SS'),
      'rowsAffected'    VALUE rows_affected,
      'errorMessage'    VALUE error_message
      ABSENT ON NULL
    ) ORDER BY sql_id
  ), '[]')
  INTO v_sqls
  FROM rr_data_change_request_sql
  WHERE request_id = :id;

  HTP.P('{"success":true,"header":' || v_header || ',"details":' || v_details || ',"sqls":' || v_sqls || '}');
EXCEPTION WHEN OTHERS THEN
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}'); END;
END;
    ]'
  );
  COMMIT;
END;
/


-- ── POST /admin/change-requests/:id/details  (save lines) ────────────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/change-requests/:id/details',p_method=>'POST'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/change-requests/:id/details',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_body CLOB := :body_text;
  v_cnt  NUMBER := 0;
BEGIN
  DELETE FROM rr_data_change_request_details WHERE request_id = :id;

  FOR r IN (
    SELECT jt.*
    FROM JSON_TABLE(v_body, '$.items[*]'
      COLUMNS (
        table_name   VARCHAR2(100)  PATH '$.tableName',
        column_name  VARCHAR2(100)  PATH '$.columnName',
        column_label VARCHAR2(200)  PATH '$.columnLabel',
        data_type    VARCHAR2(30)   PATH '$.dataType',
        old_value    VARCHAR2(4000) PATH '$.oldValue',
        new_value    VARCHAR2(4000) PATH '$.newValue',
        where_column VARCHAR2(100)  PATH '$.whereColumn',
        where_value  VARCHAR2(200)  PATH '$.whereValue',
        created_by   VARCHAR2(100)  PATH '$.createdBy'
      )
    ) jt
  ) LOOP
    v_cnt := v_cnt + 1;
    INSERT INTO rr_data_change_request_details (
      request_id, seq_num, table_name, column_name, column_label,
      data_type, old_value, new_value, where_column, where_value, created_by
    ) VALUES (
      :id, v_cnt,
      r.table_name, r.column_name, r.column_label,
      NVL(r.data_type,'VARCHAR2'),
      r.old_value, r.new_value, r.where_column, r.where_value,
      NVL(r.created_by,'ERP_USER')
    );
  END LOOP;

  COMMIT;
  HTP.P('{"success":true,"saved":' || v_cnt || '}');
EXCEPTION WHEN OTHERS THEN
  ROLLBACK;
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}'); END;
END;
    ]'
  );
  COMMIT;
END;
/


-- ── POST /admin/change-requests/:id/execute ──────────────────────────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/change-requests/:id/execute',p_method=>'POST'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/change-requests/:id/execute',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_body        CLOB    := :body_text;
  v_executed_by VARCHAR2(100) := NVL(JSON_VALUE(v_body,'$.executedBy'),'ERP_USER');
  v_sql         CLOB;
  v_sql_id      NUMBER;
  v_rows        NUMBER := 0;
  v_results     CLOB   := '[';
  v_sep         VARCHAR2(1) := '';
BEGIN
  FOR d IN (
    SELECT * FROM rr_data_change_request_details
    WHERE request_id = :id
    ORDER BY seq_num
  ) LOOP
    -- Validate WHERE exists
    IF d.where_column IS NULL OR d.where_value IS NULL THEN
      v_results := v_results || v_sep
        || '{"detailId":' || d.detail_id || ',"status":"ERROR","error":"Missing WHERE clause — update rejected"}';
      v_sep := ',';
      CONTINUE;
    END IF;

    -- Build UPDATE SQL
    v_sql := 'UPDATE ' || d.table_name || ' SET ' || d.column_name || ' = ';
    IF d.data_type = 'NUMBER' THEN
      v_sql := v_sql || d.new_value;
    ELSIF d.data_type IN ('DATE','TIMESTAMP') THEN
      v_sql := v_sql || 'TO_DATE(''' || d.new_value || ''',''YYYY-MM-DD'')';
    ELSE
      v_sql := v_sql || '''' || REPLACE(d.new_value,'''','''''') || '''';
    END IF;
    v_sql := v_sql || ' WHERE ' || d.where_column || ' = ' || d.where_value;

    -- Log before executing
    INSERT INTO rr_data_change_request_sql (
      request_id, detail_id, sql_text, generated_by, execution_status
    ) VALUES (
      :id, d.detail_id, v_sql, v_executed_by, 'PENDING'
    ) RETURNING sql_id INTO v_sql_id;

    -- Execute
    DECLARE
      v_err VARCHAR2(4000);
    BEGIN
      EXECUTE IMMEDIATE v_sql;
      v_rows := SQL%ROWCOUNT;
      UPDATE rr_data_change_request_sql
      SET execution_status = 'SUCCESS', executed_date = SYSTIMESTAMP,
          executed_by = v_executed_by, rows_affected = v_rows
      WHERE sql_id = v_sql_id;

      v_results := v_results || v_sep
        || '{"detailId":' || d.detail_id
        || ',"sqlId":' || v_sql_id
        || ',"status":"SUCCESS"'
        || ',"rowsAffected":' || v_rows
        || ',"sql":"' || REPLACE(REPLACE(TO_CHAR(v_sql),'\','\\'),'"','\"') || '"'
        || '}';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      UPDATE rr_data_change_request_sql
      SET execution_status = 'ERROR', executed_date = SYSTIMESTAMP,
          executed_by = v_executed_by, error_message = v_err
      WHERE sql_id = v_sql_id;

      v_results := v_results || v_sep
        || '{"detailId":' || d.detail_id
        || ',"sqlId":' || v_sql_id
        || ',"status":"ERROR"'
        || ',"error":"' || REPLACE(v_err,'"','\"') || '"'
        || '}';
    END;
    v_sep := ',';
  END LOOP;

  v_results := v_results || ']';

  UPDATE rr_data_change_request_header
  SET status = 'EXECUTED', executed_by = v_executed_by, executed_date = SYSTIMESTAMP,
      last_updated_by = v_executed_by, last_update_date = SYSTIMESTAMP
  WHERE request_id = :id;

  COMMIT;
  HTP.P('{"success":true,"results":' || v_results || '}');
EXCEPTION WHEN OTHERS THEN
  ROLLBACK;
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}'); END;
END;
    ]'
  );
  COMMIT;
END;
/


-- ── PUT /admin/change-requests/:id/status ────────────────────────────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/change-requests/:id/status',p_method=>'PUT'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/change-requests/:id/status',
    p_method         => 'PUT',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_body   CLOB         := :body_text;
  v_status VARCHAR2(30) := JSON_VALUE(v_body, '$.status');
  v_by     VARCHAR2(100):= NVL(JSON_VALUE(v_body, '$.updatedBy'),'ERP_USER');
  v_reason VARCHAR2(4000):= JSON_VALUE(v_body, '$.rejectionReason');
BEGIN
  UPDATE rr_data_change_request_header SET
    status           = v_status,
    approved_by      = CASE WHEN v_status='APPROVED' THEN v_by  ELSE approved_by  END,
    approval_date    = CASE WHEN v_status='APPROVED' THEN SYSTIMESTAMP ELSE approval_date END,
    rejected_by      = CASE WHEN v_status='REJECTED' THEN v_by  ELSE rejected_by  END,
    rejection_date   = CASE WHEN v_status='REJECTED' THEN SYSTIMESTAMP ELSE rejection_date END,
    rejection_reason = CASE WHEN v_status='REJECTED' THEN v_reason ELSE rejection_reason END,
    last_updated_by  = v_by,
    last_update_date = SYSTIMESTAMP
  WHERE request_id = :id;
  COMMIT;
  HTP.P('{"success":true,"status":"' || v_status || '"}');
EXCEPTION WHEN OTHERS THEN
  ROLLBACK;
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}'); END;
END;
    ]'
  );
  COMMIT;
END;
/


-- ── POST /admin/change-requests/search ───────────────────────────────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/change-requests/search',p_method=>'POST'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/change-requests/search',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_body  CLOB := :body_text;
  v_type  VARCHAR2(50)   := JSON_VALUE(v_body, '$.transactionType');
  v_sql   VARCHAR2(32767);
  v_where VARCHAR2(4000) := ' WHERE 1=1';
  v_cur   SYS_REFCURSOR;
  v_rows  CLOB   := '[';
  v_sep   VARCHAR2(1) := '';

  -- Extract a string param from $.params.key
  FUNCTION gp(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN JSON_VALUE(v_body, '$.params.' || p);
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;

  PROCEDURE add_like(col IN VARCHAR2, param IN VARCHAR2) IS
    v VARCHAR2(4000) := gp(param);
  BEGIN
    IF v IS NOT NULL THEN
      v_where := v_where || ' AND UPPER(' || col || ') LIKE ''%'' || UPPER(''' || REPLACE(v,'''','''''') || ''') || ''%''';
    END IF;
  END;

  PROCEDURE add_eq(col IN VARCHAR2, param IN VARCHAR2) IS
    v VARCHAR2(4000) := gp(param);
  BEGIN
    IF v IS NOT NULL THEN
      v_where := v_where || ' AND ' || col || ' = ''' || REPLACE(v,'''','''''') || '''';
    END IF;
  END;

  PROCEDURE add_date_from(col IN VARCHAR2, param IN VARCHAR2) IS
    v VARCHAR2(50) := gp(param);
  BEGIN
    IF v IS NOT NULL THEN
      v_where := v_where || ' AND ' || col || ' >= TO_DATE(''' || v || ''',''YYYY-MM-DD'')';
    END IF;
  END;

  PROCEDURE add_date_to(col IN VARCHAR2, param IN VARCHAR2) IS
    v VARCHAR2(50) := gp(param);
  BEGIN
    IF v IS NOT NULL THEN
      v_where := v_where || ' AND ' || col || ' < TO_DATE(''' || v || ''',''YYYY-MM-DD'') + 1';
    END IF;
  END;

BEGIN

  IF v_type = 'JOURNAL' THEN
    add_like('BATCH_NAME',          'batchName');
    add_like('BATCH_DESCRIPTION',   'description');
    add_eq  ('STATUS',              'status');
    add_eq  ('DEFAULT_PERIOD_NAME', 'periodName');
    add_like('LEDGER_NAME',         'ledgerName');
    v_sql := 'SELECT JE_BATCH_ID, BATCH_NAME, STATUS, DEFAULT_PERIOD_NAME, LEDGER_NAME, BATCH_DESCRIPTION'
          || ' FROM RR_GL_JOURNAL_BATCHES' || v_where
          || ' ORDER BY ORACLE_CREATION_DATE DESC FETCH FIRST 100 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(500); v3 VARCHAR2(30); v4 VARCHAR2(50); v5 VARCHAR2(100); v6 VARCHAR2(2000); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || REPLACE(NVL(v2,''),'"','\"')
          || '","col2":"' || REPLACE(NVL(v3,''),'"','\"')
          || '","col3":"' || REPLACE(NVL(v4,''),'"','\"')
          || '","col4":"' || REPLACE(NVL(v5,''),'"','\"')
          || '","col5":"' || REPLACE(NVL(v6,''),'"','\"') || '"}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSIF v_type = 'JOURNAL_HEADER' THEN
    add_like('JOURNAL_NAME',   'journalName');
    add_eq  ('PERIOD_NAME',    'periodName');
    add_eq  ('POSTING_STATUS', 'postingStatus');
    add_like('LEDGER_NAME',    'ledgerName');
    add_like('DESCRIPTION',    'description');
    v_sql := 'SELECT JE_HEADER_ID, JOURNAL_NAME, PERIOD_NAME, POSTING_STATUS, LEDGER_NAME, DESCRIPTION'
          || ' FROM RR_GL_JE_HEADERS' || v_where
          || ' ORDER BY FUSION_CREATION_DATE DESC FETCH FIRST 100 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(500); v3 VARCHAR2(50); v4 VARCHAR2(30); v5 VARCHAR2(100); v6 VARCHAR2(2000); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || REPLACE(NVL(v2,''),'"','\"')
          || '","col2":"' || REPLACE(NVL(v3,''),'"','\"')
          || '","col3":"' || REPLACE(NVL(v4,''),'"','\"')
          || '","col4":"' || REPLACE(NVL(v5,''),'"','\"')
          || '","col5":"' || REPLACE(NVL(v6,''),'"','\"') || '"}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSIF v_type = 'AP_INVOICE' THEN
    add_like('INVOICE_NUM',         'invoiceNum');
    add_like('VENDOR_NAME',         'vendorName');
    add_like('DESCRIPTION',         'description');
    add_eq  ('PAYMENT_STATUS_FLAG', 'paymentStatus');
    add_date_from('INVOICE_DATE',   'dateFrom');
    add_date_to  ('INVOICE_DATE',   'dateTo');
    v_sql := 'SELECT INVOICE_ID, INVOICE_NUM, VENDOR_NAME, TO_CHAR(INVOICE_DATE,''YYYY-MM-DD''), INVOICE_AMOUNT, PAYMENT_STATUS_FLAG'
          || ' FROM RR_RAW_AP_INVOICES_ALL' || v_where
          || ' ORDER BY INVOICE_DATE DESC FETCH FIRST 100 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(200); v3 VARCHAR2(300); v4 VARCHAR2(20); v5 NUMBER; v6 VARCHAR2(10); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || REPLACE(NVL(v2,''),'"','\"')
          || '","col2":"' || REPLACE(NVL(v3,''),'"','\"')
          || '","col3":"' || NVL(v4,'')
          || '","col4":"' || NVL(TO_CHAR(v5),'')
          || '","col5":"' || NVL(v6,'') || '"}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSIF v_type = 'AP_PAYMENT' THEN
    add_like('CHECK_NUMBER',       'checkNumber');
    add_like('VENDOR_NAME',        'vendorName');
    add_eq  ('STATUS_LOOKUP_CODE', 'status');
    add_date_from('CHECK_DATE',    'dateFrom');
    add_date_to  ('CHECK_DATE',    'dateTo');
    v_sql := 'SELECT CHECK_ID, CHECK_NUMBER, VENDOR_NAME, TO_CHAR(CHECK_DATE,''YYYY-MM-DD''), AMOUNT, STATUS_LOOKUP_CODE'
          || ' FROM RR_AP_PAYMENTS_ALL' || v_where
          || ' ORDER BY CHECK_DATE DESC FETCH FIRST 100 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(200); v3 VARCHAR2(300); v4 VARCHAR2(20); v5 NUMBER; v6 VARCHAR2(30); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || REPLACE(NVL(v2,''),'"','\"')
          || '","col2":"' || REPLACE(NVL(v3,''),'"','\"')
          || '","col3":"' || NVL(v4,'')
          || '","col4":"' || NVL(TO_CHAR(v5),'')
          || '","col5":"' || NVL(v6,'') || '"}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSIF v_type = 'EXTERNAL_TXN' THEN
    add_like('DESCRIPTION',      'description');
    add_eq  ('STATUS',           'status');
    add_like('REFERENCE_NUMBER', 'referenceNumber');
    add_date_from('TRX_DATE',    'dateFrom');
    add_date_to  ('TRX_DATE',    'dateTo');
    v_sql := 'SELECT TRX_ID, TO_CHAR(TRX_DATE,''YYYY-MM-DD''), AMOUNT, DESCRIPTION, STATUS, REFERENCE_NUMBER'
          || ' FROM RR_EXTERNAL_CASH_TRANSACTIONS' || v_where
          || ' ORDER BY TRX_DATE DESC FETCH FIRST 100 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(20); v3 NUMBER; v4 VARCHAR2(500); v5 VARCHAR2(30); v6 VARCHAR2(200); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || NVL(v2,'')
          || '","col2":"' || NVL(TO_CHAR(v3),'')
          || '","col3":"' || REPLACE(NVL(v4,''),'"','\"')
          || '","col4":"' || NVL(v5,'')
          || '","col5":"' || REPLACE(NVL(v6,''),'"','\"') || '"}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSIF v_type = 'BANK_TRANSFER' THEN
    add_like('DESCRIPTION',       'description');
    add_eq  ('STATUS',            'status');
    add_date_from('TRANSFER_DATE','dateFrom');
    add_date_to  ('TRANSFER_DATE','dateTo');
    v_sql := 'SELECT TRANSFER_ID, TO_CHAR(TRANSFER_DATE,''YYYY-MM-DD''), AMOUNT, STATUS, DESCRIPTION, '''' '
          || ' FROM RR_BANK_ACCOUNT_TRANSFERS' || v_where
          || ' ORDER BY TRANSFER_DATE DESC FETCH FIRST 100 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(20); v3 NUMBER; v4 VARCHAR2(30); v5 VARCHAR2(500); v6 VARCHAR2(1); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || NVL(v2,'')
          || '","col2":"' || NVL(TO_CHAR(v3),'')
          || '","col3":"' || NVL(v4,'')
          || '","col4":"' || REPLACE(NVL(v5,''),'"','\"')
          || '","col5":""}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSIF v_type = 'BANK_STMT_HDR' THEN
    add_like('STATEMENT_NUMBER',      'statementNumber');
    add_like('BANK_ACCOUNT_NUMBER',   'bankAccount');
    add_like('STATUS',                'status');
    add_date_from('STATEMENT_DATE',   'dateFrom');
    add_date_to  ('STATEMENT_DATE',   'dateTo');
    v_sql := 'SELECT STATEMENT_ID, STATEMENT_NUMBER, BANK_ACCOUNT_NUMBER, TO_CHAR(STATEMENT_DATE,''YYYY-MM-DD''), STATUS, TO_CHAR(CLOSING_BALANCE) '
          || ' FROM RR_BANK_STATEMENT_HEADER' || v_where
          || ' ORDER BY STATEMENT_DATE DESC FETCH FIRST 100 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(100); v3 VARCHAR2(100); v4 VARCHAR2(20); v5 VARCHAR2(30); v6 VARCHAR2(100); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || REPLACE(NVL(v2,''),'"','\"')
          || '","col2":"' || REPLACE(NVL(v3,''),'"','\"')
          || '","col3":"' || NVL(v4,'')
          || '","col4":"' || NVL(v5,'')
          || '","col5":"' || NVL(v6,'') || '"}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSIF v_type = 'BANK_STMT_LINES' THEN
    IF gp('lineId') IS NOT NULL THEN
      v_where := v_where || ' AND LINE_ID = ' || gp('lineId');
    END IF;
    add_like('DESCRIPTION',      'description');
    add_like('REFERENCE',        'reference');
    add_like('COUNTERPARTY_NAME','counterpartyName');
    add_like('TRANSACTION_CODE', 'transactionCode');
    add_like('RECON_STATUS',     'reconStatus');
    add_date_from('TRANSACTION_DATE','dateFrom');
    add_date_to  ('TRANSACTION_DATE','dateTo');
    v_sql := 'SELECT LINE_ID, TO_CHAR(LINE_ID), TO_CHAR(TRANSACTION_DATE,''YYYY-MM-DD''), TO_CHAR(AMOUNT), DESCRIPTION, RECON_STATUS '
          || ' FROM RR_BANK_STATEMENT_LINES' || v_where
          || ' ORDER BY TRANSACTION_DATE DESC FETCH FIRST 200 ROWS ONLY';
    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE v1 NUMBER; v2 VARCHAR2(20); v3 VARCHAR2(20); v4 VARCHAR2(100); v5 VARCHAR2(1000); v6 VARCHAR2(30); BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6; EXIT WHEN v_cur%NOTFOUND;
        v_rows := v_rows || v_sep || '{"id":' || v1
          || ',"col1":"' || NVL(v2,'')
          || '","col2":"' || NVL(v3,'')
          || '","col3":"' || NVL(v4,'')
          || '","col4":"' || REPLACE(NVL(SUBSTR(v5,1,100),''),'"','\"')
          || '","col5":"' || NVL(v6,'') || '"}';
        v_sep := ',';
      END;
    END LOOP;
    CLOSE v_cur;

  ELSE
    HTP.P('{"success":false,"error":"Unknown transaction type: ' || NVL(v_type,'(null)') || '"}');
    RETURN;
  END IF;

  IF v_cur%ISOPEN THEN CLOSE v_cur; END IF;
  v_rows := v_rows || ']';
  DECLARE v_cnt NUMBER; BEGIN
    SELECT REGEXP_COUNT(v_rows,'\"id\":') INTO v_cnt FROM DUAL;
    HTP.P('{"success":true,"count":' || v_cnt || ',"rows":' || v_rows || '}');
  END;
EXCEPTION WHEN OTHERS THEN
  IF v_cur%ISOPEN THEN CLOSE v_cur; END IF;
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}'); END;
END;
    ]'
  );
  COMMIT;
END;
/


-- ── GET /admin/record  (fetch single row by PK for column editing) ────────────
BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/record',p_method=>'GET'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/record',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_sql  VARCHAR2(500);
  v_cid  NUMBER;
  v_desc DBMS_SQL.DESC_TAB;
  v_cnt  NUMBER;
  v_val  VARCHAR2(4000);
  v_row  CLOB := '{';
  v_sep  VARCHAR2(1) := '';
  v_found NUMBER := 0;
BEGIN
  v_sql := 'SELECT * FROM ' || :table_name || ' WHERE ' || :pk_col || ' = ' || :pk_val;
  v_cid := DBMS_SQL.OPEN_CURSOR;
  DBMS_SQL.PARSE(v_cid, v_sql, DBMS_SQL.NATIVE);
  DBMS_SQL.DESCRIBE_COLUMNS(v_cid, v_cnt, v_desc);

  FOR i IN 1..v_cnt LOOP
    DBMS_SQL.DEFINE_COLUMN(v_cid, i, v_val, 4000);
  END LOOP;

  IF DBMS_SQL.EXECUTE_AND_FETCH(v_cid) > 0 THEN
    v_found := 1;
    FOR i IN 1..v_cnt LOOP
      DBMS_SQL.COLUMN_VALUE(v_cid, i, v_val);
      v_row := v_row || v_sep
        || '"' || v_desc(i).col_name || '":"'
        || REPLACE(REPLACE(NVL(v_val,''),'\','\\'),'"','\"') || '"';
      v_sep := ',';
    END LOOP;
  END IF;

  DBMS_SQL.CLOSE_CURSOR(v_cid);
  v_row := v_row || ',"_found":' || v_found || '}';
  HTP.P('{"success":true,"row":' || v_row || '}');
EXCEPTION WHEN OTHERS THEN
  IF DBMS_SQL.IS_OPEN(v_cid) THEN DBMS_SQL.CLOSE_CURSOR(v_cid); END IF;
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}'); END;
END;
    ]'
  );
  COMMIT;
END;
/
