-- Generic ORDS Handlers — reusable across any table
-- Module: reerp
--
-- Endpoints:
--   POST /reerp/generic/ddl     -> execute DDL (CREATE TABLE, DROP TABLE, etc.)
--   POST /reerp/generic/query   -> execute any SELECT, returns { items: [...] }
-- ============================================================

BEGIN
  -- ----------------------------------------------------------------
  -- POST /reerp/generic/ddl
  -- Body: { "sql": "CREATE TABLE ..." }
  -- ----------------------------------------------------------------
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp',
    p_pattern     => 'generic/ddl'
  );

  ORDS.DEFINE_HANDLER(
    p_module_name => 'reerp',
    p_pattern     => 'generic/ddl',
    p_method      => 'POST',
    p_source_type => ORDS.SOURCE_TYPE_PLSQL,
    p_source      => q'[
DECLARE
  l_sql VARCHAR2(32767);
BEGIN
  APEX_JSON.PARSE(:body_text);
  l_sql := APEX_JSON.GET_VARCHAR2(p_path => 'sql');
  EXECUTE IMMEDIATE l_sql;
  :status := 200;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'ok');
  APEX_JSON.CLOSE_OBJECT;
EXCEPTION WHEN OTHERS THEN
  :status := 500;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'error');
  APEX_JSON.WRITE('message', SQLERRM);
  APEX_JSON.CLOSE_OBJECT;
END;
]'
  );

  -- ----------------------------------------------------------------
  -- POST /reerp/generic/query
  -- Body: { "sql": "SELECT * FROM RR_RAW_CUSTOMER_SITE_ACTIVITIES WHERE ..." }
  -- Returns: { "items": [ { col: val, ... }, ... ] }
  -- Only SELECT statements are permitted.
  -- ----------------------------------------------------------------
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp',
    p_pattern     => 'generic/query'
  );

  ORDS.DEFINE_HANDLER(
    p_module_name => 'reerp',
    p_pattern     => 'generic/query',
    p_method      => 'POST',
    p_source_type => ORDS.SOURCE_TYPE_PLSQL,
    p_source      => q'[
DECLARE
  l_sql      VARCHAR2(32767);
  l_cursor   INTEGER;
  l_col_cnt  INTEGER;
  l_desctab  DBMS_SQL.DESC_TAB;
  l_col_val  VARCHAR2(32767);
  l_fetched  INTEGER;
BEGIN
  APEX_JSON.PARSE(:body_text);
  l_sql := APEX_JSON.GET_VARCHAR2(p_path => 'sql');

  -- Security: only allow SELECT
  IF UPPER(LTRIM(l_sql)) NOT LIKE 'SELECT%' THEN
    :status := 403;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('error', 'Only SELECT statements are allowed');
    APEX_JSON.CLOSE_OBJECT;
    RETURN;
  END IF;

  l_cursor := DBMS_SQL.OPEN_CURSOR;
  DBMS_SQL.PARSE(l_cursor, l_sql, DBMS_SQL.NATIVE);
  DBMS_SQL.DESCRIBE_COLUMNS(l_cursor, l_col_cnt, l_desctab);

  FOR i IN 1..l_col_cnt LOOP
    DBMS_SQL.DEFINE_COLUMN(l_cursor, i, l_col_val, 32767);
  END LOOP;

  l_fetched := DBMS_SQL.EXECUTE(l_cursor);

  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.OPEN_ARRAY('items');
  LOOP
    EXIT WHEN DBMS_SQL.FETCH_ROWS(l_cursor) = 0;
    APEX_JSON.OPEN_OBJECT;
    FOR i IN 1..l_col_cnt LOOP
      DBMS_SQL.COLUMN_VALUE(l_cursor, i, l_col_val);
      APEX_JSON.WRITE(l_desctab(i).col_name, l_col_val);
    END LOOP;
    APEX_JSON.CLOSE_OBJECT;
  END LOOP;
  APEX_JSON.CLOSE_ARRAY;
  DBMS_SQL.CLOSE_CURSOR(l_cursor);
  APEX_JSON.WRITE('status', 'ok');
  APEX_JSON.CLOSE_OBJECT;
  :status := 200;
EXCEPTION WHEN OTHERS THEN
  IF DBMS_SQL.IS_OPEN(l_cursor) THEN DBMS_SQL.CLOSE_CURSOR(l_cursor); END IF;
  :status := 500;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'error');
  APEX_JSON.WRITE('error', SQLERRM);
  APEX_JSON.CLOSE_OBJECT;
END;
]'
  );

  COMMIT;
END;
/

-- ============================================================
-- PASTE-DIRECTLY versions (for ORDS UI editor — no wrapper)
-- ============================================================

-- >> POST /reerp/generic/ddl  (paste into handler source)
/*
DECLARE
  l_sql VARCHAR2(32767);
BEGIN
  APEX_JSON.PARSE(:body_text);
  l_sql := APEX_JSON.GET_VARCHAR2(p_path => 'sql');
  EXECUTE IMMEDIATE l_sql;
  :status := 200;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'ok');
  APEX_JSON.CLOSE_OBJECT;
EXCEPTION WHEN OTHERS THEN
  :status := 500;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'error');
  APEX_JSON.WRITE('message', SQLERRM);
  APEX_JSON.CLOSE_OBJECT;
END;
*/

-- >> POST /reerp/generic/query  (paste into handler source)
/*
DECLARE
  l_sql      VARCHAR2(32767);
  l_cursor   INTEGER;
  l_col_cnt  INTEGER;
  l_desctab  DBMS_SQL.DESC_TAB;
  l_col_val  VARCHAR2(32767);
  l_fetched  INTEGER;
BEGIN
  APEX_JSON.PARSE(:body_text);
  l_sql := APEX_JSON.GET_VARCHAR2(p_path => 'sql');
  IF UPPER(LTRIM(l_sql)) NOT LIKE 'SELECT%' THEN
    :status := 403;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('error', 'Only SELECT statements are allowed');
    APEX_JSON.CLOSE_OBJECT;
    RETURN;
  END IF;
  l_cursor := DBMS_SQL.OPEN_CURSOR;
  DBMS_SQL.PARSE(l_cursor, l_sql, DBMS_SQL.NATIVE);
  DBMS_SQL.DESCRIBE_COLUMNS(l_cursor, l_col_cnt, l_desctab);
  FOR i IN 1..l_col_cnt LOOP
    DBMS_SQL.DEFINE_COLUMN(l_cursor, i, l_col_val, 32767);
  END LOOP;
  l_fetched := DBMS_SQL.EXECUTE(l_cursor);
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.OPEN_ARRAY('items');
  LOOP
    EXIT WHEN DBMS_SQL.FETCH_ROWS(l_cursor) = 0;
    APEX_JSON.OPEN_OBJECT;
    FOR i IN 1..l_col_cnt LOOP
      DBMS_SQL.COLUMN_VALUE(l_cursor, i, l_col_val);
      APEX_JSON.WRITE(l_desctab(i).col_name, l_col_val);
    END LOOP;
    APEX_JSON.CLOSE_OBJECT;
  END LOOP;
  APEX_JSON.CLOSE_ARRAY;
  DBMS_SQL.CLOSE_CURSOR(l_cursor);
  APEX_JSON.WRITE('status', 'ok');
  APEX_JSON.CLOSE_OBJECT;
  :status := 200;
EXCEPTION WHEN OTHERS THEN
  IF DBMS_SQL.IS_OPEN(l_cursor) THEN DBMS_SQL.CLOSE_CURSOR(l_cursor); END IF;
  :status := 500;
  APEX_JSON.OPEN_OBJECT;
  APEX_JSON.WRITE('status', 'error');
  APEX_JSON.WRITE('error', SQLERRM);
  APEX_JSON.CLOSE_OBJECT;
END;
*/
