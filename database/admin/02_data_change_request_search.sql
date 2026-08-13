-- ============================================================
-- Dynamic Search Endpoint for Data Change Request
-- POST /change-requests/search
-- Body: { "transactionType": "JOURNAL", "params": {...} }
-- Returns matching records for user to pick from.
-- ============================================================

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
  v_body   CLOB         := :body_text;
  v_root   JSON_OBJECT_T := JSON_OBJECT_T.parse(v_body);
  v_params JSON_OBJECT_T;
  v_type   VARCHAR2(50);
  v_sql    VARCHAR2(32767);
  v_where  VARCHAR2(4000) := ' WHERE 1=1';
  v_cur    SYS_REFCURSOR;
  v_rows   JSON_ARRAY_T  := JSON_ARRAY_T();
  v_obj    JSON_OBJECT_T;

  -- generic helpers
  FUNCTION gp(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN v_params.get_string(p);
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
  v_type   := v_root.get_string('transactionType');
  v_params := v_root.get_object('params');
  IF v_params IS NULL THEN v_params := JSON_OBJECT_T(); END IF;

  -- ── GL Journal Batch ────────────────────────────────────────
  IF v_type = 'JOURNAL' THEN
    add_like('BATCH_NAME',          'batchName');
    add_like('BATCH_DESCRIPTION',   'description');
    add_eq  ('STATUS',              'status');
    add_eq  ('DEFAULT_PERIOD_NAME', 'periodName');
    add_like('LEDGER_NAME',         'ledgerName');
    v_sql := 'SELECT JE_BATCH_ID, BATCH_NAME, STATUS, DEFAULT_PERIOD_NAME, LEDGER_NAME, BATCH_DESCRIPTION '
          || 'FROM RR_GL_JOURNAL_BATCHES' || v_where
          || ' ORDER BY ORACLE_CREATION_DATE DESC FETCH FIRST 100 ROWS ONLY';

    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE
        v1 NUMBER; v2 VARCHAR2(500); v3 VARCHAR2(30); v4 VARCHAR2(50); v5 VARCHAR2(100); v6 VARCHAR2(2000);
      BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6;
        EXIT WHEN v_cur%NOTFOUND;
        v_obj := JSON_OBJECT_T();
        v_obj.put('id',    v1);
        v_obj.put('col1',  NVL(v2,''));
        v_obj.put('col2',  NVL(v3,''));
        v_obj.put('col3',  NVL(v4,''));
        v_obj.put('col4',  NVL(v5,''));
        v_obj.put('col5',  NVL(v6,''));
        v_rows.append(v_obj);
      END;
    END LOOP;
    CLOSE v_cur;

  -- ── GL Journal Header ───────────────────────────────────────
  ELSIF v_type = 'JOURNAL_HEADER' THEN
    add_like('JOURNAL_NAME',     'journalName');
    add_eq  ('PERIOD_NAME',      'periodName');
    add_eq  ('POSTING_STATUS',   'postingStatus');
    add_like('LEDGER_NAME',      'ledgerName');
    add_like('DESCRIPTION',      'description');
    v_sql := 'SELECT JE_HEADER_ID, JOURNAL_NAME, PERIOD_NAME, POSTING_STATUS, LEDGER_NAME, DESCRIPTION '
          || 'FROM RR_GL_JE_HEADERS' || v_where
          || ' ORDER BY FUSION_CREATION_DATE DESC FETCH FIRST 100 ROWS ONLY';

    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE
        v1 NUMBER; v2 VARCHAR2(500); v3 VARCHAR2(50); v4 VARCHAR2(30); v5 VARCHAR2(100); v6 VARCHAR2(2000);
      BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6;
        EXIT WHEN v_cur%NOTFOUND;
        v_obj := JSON_OBJECT_T();
        v_obj.put('id',   v1); v_obj.put('col1', NVL(v2,'')); v_obj.put('col2', NVL(v3,''));
        v_obj.put('col3', NVL(v4,'')); v_obj.put('col4', NVL(v5,'')); v_obj.put('col5', NVL(v6,''));
        v_rows.append(v_obj);
      END;
    END LOOP;
    CLOSE v_cur;

  -- ── AP Invoice ──────────────────────────────────────────────
  ELSIF v_type = 'AP_INVOICE' THEN
    add_like('INVOICE_NUM',         'invoiceNum');
    add_like('VENDOR_NAME',         'vendorName');
    add_like('DESCRIPTION',         'description');
    add_eq  ('PAYMENT_STATUS_FLAG', 'paymentStatus');
    add_date_from('INVOICE_DATE',   'dateFrom');
    add_date_to  ('INVOICE_DATE',   'dateTo');
    v_sql := 'SELECT INVOICE_ID, INVOICE_NUM, VENDOR_NAME, TO_CHAR(INVOICE_DATE,''YYYY-MM-DD''), INVOICE_AMOUNT, PAYMENT_STATUS_FLAG '
          || 'FROM RR_RAW_AP_INVOICES_ALL' || v_where
          || ' ORDER BY INVOICE_DATE DESC FETCH FIRST 100 ROWS ONLY';

    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE
        v1 NUMBER; v2 VARCHAR2(200); v3 VARCHAR2(300); v4 VARCHAR2(20); v5 NUMBER; v6 VARCHAR2(10);
      BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6;
        EXIT WHEN v_cur%NOTFOUND;
        v_obj := JSON_OBJECT_T();
        v_obj.put('id',   v1); v_obj.put('col1', NVL(v2,'')); v_obj.put('col2', NVL(v3,''));
        v_obj.put('col3', NVL(v4,'')); v_obj.put('col4', TO_CHAR(v5)); v_obj.put('col5', NVL(v6,''));
        v_rows.append(v_obj);
      END;
    END LOOP;
    CLOSE v_cur;

  -- ── AP Payment ──────────────────────────────────────────────
  ELSIF v_type = 'AP_PAYMENT' THEN
    add_like('CHECK_NUMBER',        'checkNumber');
    add_like('VENDOR_NAME',         'vendorName');
    add_eq  ('STATUS_LOOKUP_CODE',  'status');
    add_date_from('CHECK_DATE',     'dateFrom');
    add_date_to  ('CHECK_DATE',     'dateTo');
    v_sql := 'SELECT CHECK_ID, CHECK_NUMBER, VENDOR_NAME, TO_CHAR(CHECK_DATE,''YYYY-MM-DD''), AMOUNT, STATUS_LOOKUP_CODE '
          || 'FROM RR_AP_PAYMENTS_ALL' || v_where
          || ' ORDER BY CHECK_DATE DESC FETCH FIRST 100 ROWS ONLY';

    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE
        v1 NUMBER; v2 VARCHAR2(200); v3 VARCHAR2(300); v4 VARCHAR2(20); v5 NUMBER; v6 VARCHAR2(30);
      BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6;
        EXIT WHEN v_cur%NOTFOUND;
        v_obj := JSON_OBJECT_T();
        v_obj.put('id',   v1); v_obj.put('col1', NVL(v2,'')); v_obj.put('col2', NVL(v3,''));
        v_obj.put('col3', NVL(v4,'')); v_obj.put('col4', TO_CHAR(v5)); v_obj.put('col5', NVL(v6,''));
        v_rows.append(v_obj);
      END;
    END LOOP;
    CLOSE v_cur;

  -- ── External Cash Transaction ────────────────────────────────
  ELSIF v_type = 'EXTERNAL_TXN' THEN
    add_like('DESCRIPTION',       'description');
    add_eq  ('STATUS',            'status');
    add_like('REFERENCE_NUMBER',  'referenceNumber');
    add_date_from('TRX_DATE',     'dateFrom');
    add_date_to  ('TRX_DATE',     'dateTo');
    v_sql := 'SELECT TRX_ID, TO_CHAR(TRX_DATE,''YYYY-MM-DD''), AMOUNT, DESCRIPTION, STATUS, REFERENCE_NUMBER '
          || 'FROM RR_EXTERNAL_CASH_TRANSACTIONS' || v_where
          || ' ORDER BY TRX_DATE DESC FETCH FIRST 100 ROWS ONLY';

    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE
        v1 NUMBER; v2 VARCHAR2(20); v3 NUMBER; v4 VARCHAR2(500); v5 VARCHAR2(30); v6 VARCHAR2(200);
      BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6;
        EXIT WHEN v_cur%NOTFOUND;
        v_obj := JSON_OBJECT_T();
        v_obj.put('id',   v1); v_obj.put('col1', NVL(v2,'')); v_obj.put('col2', TO_CHAR(v3));
        v_obj.put('col3', NVL(v4,'')); v_obj.put('col4', NVL(v5,'')); v_obj.put('col5', NVL(v6,''));
        v_rows.append(v_obj);
      END;
    END LOOP;
    CLOSE v_cur;

  -- ── Bank Account Transfer ────────────────────────────────────
  ELSIF v_type = 'BANK_TRANSFER' THEN
    add_like('DESCRIPTION',     'description');
    add_eq  ('STATUS',          'status');
    add_date_from('TRANSFER_DATE', 'dateFrom');
    add_date_to  ('TRANSFER_DATE', 'dateTo');
    v_sql := 'SELECT TRANSFER_ID, TO_CHAR(TRANSFER_DATE,''YYYY-MM-DD''), AMOUNT, STATUS, DESCRIPTION, '''''
          || 'FROM RR_BANK_ACCOUNT_TRANSFERS' || v_where
          || ' ORDER BY TRANSFER_DATE DESC FETCH FIRST 100 ROWS ONLY';

    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE
        v1 NUMBER; v2 VARCHAR2(20); v3 NUMBER; v4 VARCHAR2(30); v5 VARCHAR2(500); v6 VARCHAR2(1);
      BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6;
        EXIT WHEN v_cur%NOTFOUND;
        v_obj := JSON_OBJECT_T();
        v_obj.put('id',   v1); v_obj.put('col1', NVL(v2,'')); v_obj.put('col2', TO_CHAR(v3));
        v_obj.put('col3', NVL(v4,'')); v_obj.put('col4', NVL(v5,'')); v_obj.put('col5', '');
        v_rows.append(v_obj);
      END;
    END LOOP;
    CLOSE v_cur;

  -- ── Bank Statement Header ────────────────────────────────────
  ELSIF v_type = 'BANK_STMT_HDR' THEN
    add_like('STATEMENT_NUMBER', 'statementNumber');
    add_date_from('STATEMENT_DATE', 'dateFrom');
    add_date_to  ('STATEMENT_DATE', 'dateTo');
    v_sql := 'SELECT STATEMENT_HEADER_ID, STATEMENT_NUMBER, TO_CHAR(STATEMENT_DATE,''YYYY-MM-DD''), CONTROL_BEGIN_BALANCE, CONTROL_END_BALANCE, '''''
          || 'FROM RR_BANK_STATEMENT_HEADER' || v_where
          || ' ORDER BY STATEMENT_DATE DESC FETCH FIRST 100 ROWS ONLY';

    OPEN v_cur FOR v_sql;
    LOOP
      DECLARE
        v1 NUMBER; v2 VARCHAR2(100); v3 VARCHAR2(20); v4 NUMBER; v5 NUMBER; v6 VARCHAR2(1);
      BEGIN
        FETCH v_cur INTO v1,v2,v3,v4,v5,v6;
        EXIT WHEN v_cur%NOTFOUND;
        v_obj := JSON_OBJECT_T();
        v_obj.put('id',   v1); v_obj.put('col1', NVL(v2,'')); v_obj.put('col2', NVL(v3,''));
        v_obj.put('col3', TO_CHAR(v4)); v_obj.put('col4', TO_CHAR(v5)); v_obj.put('col5', '');
        v_rows.append(v_obj);
      END;
    END LOOP;
    CLOSE v_cur;

  ELSE
    HTP.P('{"success":false,"error":"Unknown transaction type: ' || v_type || '"}');
    RETURN;
  END IF;

  HTP.P('{"success":true,"count":' || v_rows.get_size() || ',"rows":' || v_rows.to_clob() || '}');
EXCEPTION WHEN OTHERS THEN
  IF v_cur%ISOPEN THEN CLOSE v_cur; END IF;
  HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","sql":"' || REPLACE(v_sql,'"','\"') || '"}');
END;
    ]'
  );
  COMMIT;
END;
/

-- ── GET /admin/record  (fetch single row for column editing) ──────────────────
-- Called after user selects a record: fetches all columns by PK
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
  v_sql  VARCHAR2(1000);
  v_cur  SYS_REFCURSOR;
  v_cols DBMS_SQL.VARCHAR2_TABLE;
  v_col  VARCHAR2(100);
  v_val  VARCHAR2(4000);
  v_obj  JSON_OBJECT_T := JSON_OBJECT_T();
  v_desc DBMS_SQL.DESC_TAB;
  v_cnt  NUMBER;
  v_cid  NUMBER;
BEGIN
  v_sql := 'SELECT * FROM ' || :table_name || ' WHERE ' || :pk_col || ' = ' || :pk_val;
  v_cid := DBMS_SQL.OPEN_CURSOR;
  DBMS_SQL.PARSE(v_cid, v_sql, DBMS_SQL.NATIVE);
  DBMS_SQL.DESCRIBE_COLUMNS(v_cid, v_cnt, v_desc);

  FOR i IN 1..v_cnt LOOP
    DBMS_SQL.DEFINE_COLUMN(v_cid, i, v_val, 4000);
  END LOOP;

  IF DBMS_SQL.EXECUTE_AND_FETCH(v_cid) > 0 THEN
    FOR i IN 1..v_cnt LOOP
      DBMS_SQL.COLUMN_VALUE(v_cid, i, v_val);
      v_obj.put(v_desc(i).col_name, NVL(v_val,''));
    END LOOP;
    v_obj.put('_found', TRUE);
  ELSE
    v_obj.put('_found', FALSE);
  END IF;

  DBMS_SQL.CLOSE_CURSOR(v_cid);
  HTP.P('{"success":true,"row":' || v_obj.to_clob() || '}');
EXCEPTION WHEN OTHERS THEN
  IF DBMS_SQL.IS_OPEN(v_cid) THEN DBMS_SQL.CLOSE_CURSOR(v_cid); END IF;
  HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
    ]'
  );
  COMMIT;
END;
/
