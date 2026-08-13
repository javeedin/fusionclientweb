-- ============================================================
-- Data Change Request Tables + ORDS Handlers
-- Allows controlled, audited updates to transactional data
-- through the ReERP UI with full SQL preview and audit trail.
--
-- Tables:
--   RR_DATA_CHANGE_REQUEST_HEADER  - one row per change request
--   RR_DATA_CHANGE_REQUEST_DETAILS - one row per column change
--   RR_DATA_CHANGE_REQUEST_SQL     - generated SQL + execution log
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────────────────────

CREATE SEQUENCE rr_dcr_header_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE rr_dcr_detail_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE rr_dcr_sql_seq    START WITH 1 INCREMENT BY 1 NOCACHE;

CREATE TABLE rr_data_change_request_header (
  request_id        NUMBER DEFAULT rr_dcr_header_seq.NEXTVAL PRIMARY KEY,
  request_number    VARCHAR2(20),         -- DCR-00001
  status            VARCHAR2(30) DEFAULT 'DRAFT',
                                          -- DRAFT | PENDING | APPROVED | EXECUTED | REJECTED
  transaction_type  VARCHAR2(50),         -- JOURNAL | AP_INVOICE | EXTERNAL_TXN | BANK_TRANSFER | AP_PAYMENT
  transaction_id    NUMBER,               -- PK of the main record
  transaction_ref   VARCHAR2(500),        -- display reference (batch name, invoice number, etc.)
  table_name        VARCHAR2(100),        -- primary table being updated
  description       VARCHAR2(4000),       -- reason / notes
  created_by        VARCHAR2(100) DEFAULT USER,
  creation_date     TIMESTAMP    DEFAULT SYSTIMESTAMP,
  last_updated_by   VARCHAR2(100),
  last_update_date  TIMESTAMP,
  approved_by       VARCHAR2(100),
  approval_date     TIMESTAMP,
  executed_by       VARCHAR2(100),
  executed_date     TIMESTAMP,
  rejected_by       VARCHAR2(100),
  rejection_date    TIMESTAMP,
  rejection_reason  VARCHAR2(4000)
);

CREATE INDEX idx_dcr_hdr_status   ON rr_data_change_request_header(status);
CREATE INDEX idx_dcr_hdr_txn_type ON rr_data_change_request_header(transaction_type);
CREATE INDEX idx_dcr_hdr_txn_id   ON rr_data_change_request_header(transaction_id);
COMMENT ON TABLE rr_data_change_request_header IS 'Change request header — one per transaction to be updated';


CREATE TABLE rr_data_change_request_details (
  detail_id         NUMBER DEFAULT rr_dcr_detail_seq.NEXTVAL PRIMARY KEY,
  request_id        NUMBER NOT NULL REFERENCES rr_data_change_request_header(request_id),
  seq_num           NUMBER,
  table_name        VARCHAR2(100),        -- table containing this column
  column_name       VARCHAR2(100),        -- exact DB column name
  column_label      VARCHAR2(200),        -- display label
  data_type         VARCHAR2(30),         -- VARCHAR2 | NUMBER | DATE | TIMESTAMP
  old_value         VARCHAR2(4000),       -- captured from DB before change
  new_value         VARCHAR2(4000),       -- entered by user
  where_column      VARCHAR2(100),        -- PK column name e.g. JE_BATCH_ID
  where_value       VARCHAR2(200),        -- PK value e.g. 1000000518
  created_by        VARCHAR2(100) DEFAULT USER,
  creation_date     TIMESTAMP    DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_dcr_det_request_id ON rr_data_change_request_details(request_id);
COMMENT ON TABLE rr_data_change_request_details IS 'Change request lines — one per column to be updated';


CREATE TABLE rr_data_change_request_sql (
  sql_id            NUMBER DEFAULT rr_dcr_sql_seq.NEXTVAL PRIMARY KEY,
  request_id        NUMBER NOT NULL REFERENCES rr_data_change_request_header(request_id),
  detail_id         NUMBER,
  sql_text          CLOB,                 -- the full UPDATE statement
  generated_date    TIMESTAMP DEFAULT SYSTIMESTAMP,
  generated_by      VARCHAR2(100),
  executed_date     TIMESTAMP,
  executed_by       VARCHAR2(100),
  execution_status  VARCHAR2(20),         -- PENDING | SUCCESS | ERROR
  error_message     VARCHAR2(4000),
  rows_affected     NUMBER
);

CREATE INDEX idx_dcr_sql_request_id ON rr_data_change_request_sql(request_id);
COMMENT ON TABLE rr_data_change_request_sql IS 'Generated UPDATE SQL + execution audit log';


-- Auto-generate request_number on insert
CREATE OR REPLACE TRIGGER trg_dcr_header_number
BEFORE INSERT ON rr_data_change_request_header
FOR EACH ROW
BEGIN
  IF :NEW.request_number IS NULL THEN
    SELECT 'DCR-' || LPAD(rr_dcr_header_seq.CURRVAL, 5, '0')
    INTO :NEW.request_number FROM DUAL;
  END IF;
END;
/


-- ─────────────────────────────────────────────────────────────
-- 2. ORDS HANDLERS
-- ─────────────────────────────────────────────────────────────

-- ── GET /change-requests  (list) ─────────────────────────────
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

-- ── POST /change-requests  (create header) ───────────────────
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
  v_body      CLOB := :body_text;
  v_root      JSON_OBJECT_T := JSON_OBJECT_T.parse(v_body);
  v_id        NUMBER;
  v_num       VARCHAR2(20);
BEGIN
  INSERT INTO rr_data_change_request_header (
    transaction_type, transaction_id, transaction_ref, table_name, description, created_by
  ) VALUES (
    v_root.get_string('transactionType'),
    v_root.get_number('transactionId'),
    v_root.get_string('transactionRef'),
    v_root.get_string('tableName'),
    v_root.get_string('description'),
    NVL(v_root.get_string('createdBy'), 'ERP_USER')
  ) RETURNING request_id, request_number INTO v_id, v_num;
  COMMIT;
  HTP.P('{"success":true,"requestId":' || v_id || ',"requestNumber":"' || v_num || '"}');
END;
    ]'
  );
  COMMIT;
END;
/

-- ── GET /change-requests/:id  (single with details) ──────────
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
  v_result  JSON_OBJECT_T := JSON_OBJECT_T();
  v_header  JSON_OBJECT_T := JSON_OBJECT_T();
  v_details JSON_ARRAY_T  := JSON_ARRAY_T();
  v_sqls    JSON_ARRAY_T  := JSON_ARRAY_T();
  v_det     JSON_OBJECT_T;
  v_sql_obj JSON_OBJECT_T;
BEGIN
  FOR h IN (SELECT * FROM rr_data_change_request_header WHERE request_id = :id) LOOP
    v_header.put('requestId',       h.request_id);
    v_header.put('requestNumber',   h.request_number);
    v_header.put('status',          h.status);
    v_header.put('transactionType', h.transaction_type);
    v_header.put('transactionId',   h.transaction_id);
    v_header.put('transactionRef',  h.transaction_ref);
    v_header.put('tableName',       h.table_name);
    v_header.put('description',     h.description);
    v_header.put('createdBy',       h.created_by);
    v_header.put('creationDate',    TO_CHAR(h.creation_date,'YYYY-MM-DD HH24:MI:SS'));
    v_header.put('approvedBy',      h.approved_by);
    v_header.put('executedBy',      h.executed_by);
    v_header.put('executedDate',    TO_CHAR(h.executed_date,'YYYY-MM-DD HH24:MI:SS'));
    v_header.put('rejectedBy',      h.rejected_by);
    v_header.put('rejectionReason', h.rejection_reason);
  END LOOP;
  FOR d IN (SELECT * FROM rr_data_change_request_details WHERE request_id = :id ORDER BY seq_num) LOOP
    v_det := JSON_OBJECT_T();
    v_det.put('detailId',     d.detail_id);
    v_det.put('tableName',    d.table_name);
    v_det.put('columnName',   d.column_name);
    v_det.put('columnLabel',  d.column_label);
    v_det.put('dataType',     d.data_type);
    v_det.put('oldValue',     d.old_value);
    v_det.put('newValue',     d.new_value);
    v_det.put('whereColumn',  d.where_column);
    v_det.put('whereValue',   d.where_value);
    v_details.append(v_det);
  END LOOP;
  FOR s IN (SELECT * FROM rr_data_change_request_sql WHERE request_id = :id ORDER BY sql_id) LOOP
    v_sql_obj := JSON_OBJECT_T();
    v_sql_obj.put('sqlId',           s.sql_id);
    v_sql_obj.put('sqlText',         s.sql_text);
    v_sql_obj.put('executionStatus', s.execution_status);
    v_sql_obj.put('executedDate',    TO_CHAR(s.executed_date,'YYYY-MM-DD HH24:MI:SS'));
    v_sql_obj.put('rowsAffected',    s.rows_affected);
    v_sql_obj.put('errorMessage',    s.error_message);
    v_sqls.append(v_sql_obj);
  END LOOP;
  v_result.put('success', TRUE);
  v_result.put('header',  v_header);
  v_result.put('details', v_details);
  v_result.put('sqls',    v_sqls);
  HTP.P(v_result.to_clob());
END;
    ]'
  );
  COMMIT;
END;
/

-- ── POST /change-requests/:id/details  (save detail lines) ───
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
  v_body   CLOB := :body_text;
  v_root   JSON_OBJECT_T := JSON_OBJECT_T.parse(v_body);
  v_items  JSON_ARRAY_T  := v_root.get_array('items');
  v_item   JSON_OBJECT_T;
  v_cnt    NUMBER := 0;
BEGIN
  DELETE FROM rr_data_change_request_details WHERE request_id = :id;
  FOR i IN 0 .. v_items.get_size() - 1 LOOP
    v_item := JSON_OBJECT_T(v_items.get(i));
    v_cnt  := v_cnt + 1;
    INSERT INTO rr_data_change_request_details (
      request_id, seq_num, table_name, column_name, column_label,
      data_type, old_value, new_value, where_column, where_value, created_by
    ) VALUES (
      :id, v_cnt,
      v_item.get_string('tableName'),
      v_item.get_string('columnName'),
      v_item.get_string('columnLabel'),
      NVL(v_item.get_string('dataType'),'VARCHAR2'),
      v_item.get_string('oldValue'),
      v_item.get_string('newValue'),
      v_item.get_string('whereColumn'),
      v_item.get_string('whereValue'),
      NVL(v_item.get_string('createdBy'),'ERP_USER')
    );
  END LOOP;
  COMMIT;
  HTP.P('{"success":true,"saved":' || v_cnt || '}');
END;
    ]'
  );
  COMMIT;
END;
/

-- ── POST /change-requests/:id/execute  (run SQL + log) ───────
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
  v_body        CLOB := :body_text;
  v_root        JSON_OBJECT_T := JSON_OBJECT_T.parse(v_body);
  v_sql         CLOB;
  v_executed_by VARCHAR2(100) := NVL(v_root.get_string('executedBy'),'ERP_USER');
  v_sql_id      NUMBER;
  v_rows        NUMBER := 0;
  v_results     JSON_ARRAY_T := JSON_ARRAY_T();
  v_res_obj     JSON_OBJECT_T;
BEGIN
  -- Process each detail line
  FOR d IN (SELECT * FROM rr_data_change_request_details WHERE request_id = :id ORDER BY seq_num) LOOP
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

    -- Validate WHERE clause exists
    IF d.where_column IS NULL OR d.where_value IS NULL THEN
      v_res_obj := JSON_OBJECT_T();
      v_res_obj.put('detailId', d.detail_id);
      v_res_obj.put('status',   'ERROR');
      v_res_obj.put('error',    'Missing WHERE clause — update rejected');
      v_results.append(v_res_obj);
      CONTINUE;
    END IF;

    -- Log SQL before executing
    INSERT INTO rr_data_change_request_sql (
      request_id, detail_id, sql_text, generated_by, execution_status
    ) VALUES (
      :id, d.detail_id, v_sql, v_executed_by, 'PENDING'
    ) RETURNING sql_id INTO v_sql_id;

    -- Execute
    BEGIN
      EXECUTE IMMEDIATE v_sql;
      v_rows := SQL%ROWCOUNT;
      UPDATE rr_data_change_request_sql
      SET execution_status = 'SUCCESS', executed_date = SYSTIMESTAMP,
          executed_by = v_executed_by, rows_affected = v_rows
      WHERE sql_id = v_sql_id;

      v_res_obj := JSON_OBJECT_T();
      v_res_obj.put('detailId',     d.detail_id);
      v_res_obj.put('sqlId',        v_sql_id);
      v_res_obj.put('status',       'SUCCESS');
      v_res_obj.put('rowsAffected', v_rows);
      v_res_obj.put('sql',          v_sql);
      v_results.append(v_res_obj);
    EXCEPTION WHEN OTHERS THEN
      UPDATE rr_data_change_request_sql
      SET execution_status = 'ERROR', executed_date = SYSTIMESTAMP,
          executed_by = v_executed_by, error_message = SQLERRM
      WHERE sql_id = v_sql_id;

      v_res_obj := JSON_OBJECT_T();
      v_res_obj.put('detailId', d.detail_id);
      v_res_obj.put('sqlId',    v_sql_id);
      v_res_obj.put('status',   'ERROR');
      v_res_obj.put('error',    SQLERRM);
      v_results.append(v_res_obj);
    END;
  END LOOP;

  -- Update header status
  UPDATE rr_data_change_request_header
  SET status = 'EXECUTED', executed_by = v_executed_by, executed_date = SYSTIMESTAMP,
      last_updated_by = v_executed_by, last_update_date = SYSTIMESTAMP
  WHERE request_id = :id;

  COMMIT;
  HTP.P('{"success":true,"results":' || v_results.to_clob() || '}');
EXCEPTION WHEN OTHERS THEN
  ROLLBACK;
  HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
    ]'
  );
  COMMIT;
END;
/

-- ── PUT /change-requests/:id/status  (approve/reject) ────────
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
  v_root   JSON_OBJECT_T := JSON_OBJECT_T.parse(:body_text);
  v_status VARCHAR2(30)  := v_root.get_string('status');
  v_by     VARCHAR2(100) := NVL(v_root.get_string('updatedBy'),'ERP_USER');
  v_reason VARCHAR2(4000):= v_root.get_string('rejectionReason');
BEGIN
  UPDATE rr_data_change_request_header SET
    status           = v_status,
    approved_by      = CASE WHEN v_status='APPROVED'  THEN v_by  ELSE approved_by  END,
    approval_date    = CASE WHEN v_status='APPROVED'  THEN SYSTIMESTAMP ELSE approval_date END,
    rejected_by      = CASE WHEN v_status='REJECTED'  THEN v_by  ELSE rejected_by  END,
    rejection_date   = CASE WHEN v_status='REJECTED'  THEN SYSTIMESTAMP ELSE rejection_date END,
    rejection_reason = CASE WHEN v_status='REJECTED'  THEN v_reason ELSE rejection_reason END,
    last_updated_by  = v_by,
    last_update_date = SYSTIMESTAMP
  WHERE request_id = :id;
  COMMIT;
  HTP.P('{"success":true,"status":"' || v_status || '"}');
END;
    ]'
  );
  COMMIT;
END;
/
