-- ============================================================
-- Compare endpoint: current row vs _UPD history
-- GET /admin/compare?table_name=RR_GL_JOURNAL_BATCHES&pk_col=JE_BATCH_ID&pk_val=123
-- Returns current values + all _UPD rows (change history) for a record
-- NOTE: ORDS sandbox does not allow FUNCTION declarations in DECLARE section.
--       Logic is inlined using separate DBMS_SQL cursor blocks.
-- ============================================================

BEGIN
  BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'admin/compare',p_method=>'GET'); EXCEPTION WHEN OTHERS THEN NULL; END;
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'admin/compare',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => q'[
DECLARE
  v_table   VARCHAR2(100) := UPPER(:table_name);
  v_upd_tbl VARCHAR2(104) := UPPER(:table_name) || '_UPD';
  v_pk_col  VARCHAR2(100) := UPPER(:pk_col);
  v_pk_val  VARCHAR2(200) := :pk_val;

  v_sql   VARCHAR2(600);
  v_cid   NUMBER;
  v_desc  DBMS_SQL.DESC_TAB;
  v_cnt   NUMBER;
  v_val   VARCHAR2(4000);
  v_sep   VARCHAR2(1);
  v_rsep  VARCHAR2(1);
  v_row   CLOB;
  v_found NUMBER := 0;

  v_current CLOB := '{"_found":0}';
  v_history CLOB := '[]';
BEGIN

  -- ── 1. Fetch current row ───────────────────────────────────
  BEGIN
    v_sql := 'SELECT * FROM ' || v_table
          || ' WHERE ' || v_pk_col || ' = ' || v_pk_val
          || ' AND ROWNUM = 1';
    v_cid := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(v_cid, v_sql, DBMS_SQL.NATIVE);
    DBMS_SQL.DESCRIBE_COLUMNS(v_cid, v_cnt, v_desc);
    FOR i IN 1..v_cnt LOOP
      DBMS_SQL.DEFINE_COLUMN(v_cid, i, v_val, 4000);
    END LOOP;
    v_current := '{';
    v_sep     := '';
    IF DBMS_SQL.EXECUTE_AND_FETCH(v_cid) > 0 THEN
      v_found := 1;
      FOR i IN 1..v_cnt LOOP
        DBMS_SQL.COLUMN_VALUE(v_cid, i, v_val);
        v_current := v_current || v_sep
          || '"' || v_desc(i).col_name || '":"'
          || REPLACE(REPLACE(NVL(v_val,''),'\','\\'),'"','\"') || '"';
        v_sep := ',';
      END LOOP;
    END IF;
    DBMS_SQL.CLOSE_CURSOR(v_cid);
    v_current := v_current || ',"_found":' || v_found || '}';
  EXCEPTION WHEN OTHERS THEN
    DECLARE v_e1 VARCHAR2(4000) := SQLERRM; BEGIN
      IF DBMS_SQL.IS_OPEN(v_cid) THEN DBMS_SQL.CLOSE_CURSOR(v_cid); END IF;
      v_current := '{"_found":0,"_error":"' || REPLACE(v_e1,'"','\"') || '"}';
    END;
  END;

  -- ── 2. Fetch _UPD history ──────────────────────────────────
  BEGIN
    v_sql := 'SELECT * FROM ' || v_upd_tbl
          || ' WHERE ' || v_pk_col || ' = ' || v_pk_val
          || ' ORDER BY CHANGED_DATE DESC FETCH FIRST 20 ROWS ONLY';
    v_cid := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(v_cid, v_sql, DBMS_SQL.NATIVE);
    DBMS_SQL.DESCRIBE_COLUMNS(v_cid, v_cnt, v_desc);
    FOR i IN 1..v_cnt LOOP
      DBMS_SQL.DEFINE_COLUMN(v_cid, i, v_val, 4000);
    END LOOP;
    v_history := '[';
    v_sep     := '';
    LOOP
      EXIT WHEN DBMS_SQL.FETCH_ROWS(v_cid) = 0;
      v_row  := '{';
      v_rsep := '';
      FOR i IN 1..v_cnt LOOP
        DBMS_SQL.COLUMN_VALUE(v_cid, i, v_val);
        v_row := v_row || v_rsep
          || '"' || v_desc(i).col_name || '":"'
          || REPLACE(REPLACE(NVL(v_val,''),'\','\\'),'"','\"') || '"';
        v_rsep := ',';
      END LOOP;
      v_history := v_history || v_sep || v_row || '}';
      v_sep := ',';
    END LOOP;
    DBMS_SQL.CLOSE_CURSOR(v_cid);
    v_history := v_history || ']';
  EXCEPTION WHEN OTHERS THEN
    DECLARE v_e2 VARCHAR2(4000) := SQLERRM; BEGIN
      IF DBMS_SQL.IS_OPEN(v_cid) THEN DBMS_SQL.CLOSE_CURSOR(v_cid); END IF;
      v_history := '[{"_error":"' || REPLACE(v_e2,'"','\"') || '"}]';
    END;
  END;

  -- ── 3. Output ──────────────────────────────────────────────
  HTP.P('{"success":true,"tableName":"' || v_table || '","updTable":"' || v_upd_tbl
     || '","current":' || v_current
     || ',"history":' || v_history || '}');

EXCEPTION WHEN OTHERS THEN
  DECLARE v_e VARCHAR2(4000) := SQLERRM; BEGIN
    HTP.P('{"success":false,"error":"' || REPLACE(v_e,'"','\"') || '"}');
  END;
END;
    ]'
  );
  COMMIT;
END;
/
