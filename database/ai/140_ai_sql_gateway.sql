-- ============================================================
-- PATCH 140: AI SQL gateway — metadata + guarded SELECT executor
--
-- Gives the AI Assistant a direct-SQL answer path (SQL mode):
--   GET  reerp/ai/objects        — tables/views + columns + comments
--                                  (?object=NAME adds that object's indexes)
--   POST reerp/ai/executequery   — run ONE guarded SELECT, JSON result
--
-- Modeled on the GraysWMS AI Analysis gateway (WMS_AI_* objects):
--   * ACL table: empty = whole schema visible; any 'Y' row switches to
--     whitelist mode; 'N' rows always hide. AI-internal tables seeded 'N'.
--   * Executor: single SELECT/WITH only, keyword ban, row cap via
--     FETCH FIRST, DBMS_SQL describe/fetch, full query log.
-- ============================================================

-- ── 1. ACL ─────────────────────────────────────────────────────────────────
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE RR_AI_OBJECT_ACL (
      OBJECT_NAME   VARCHAR2(128) PRIMARY KEY,
      ALLOWED_FLAG  VARCHAR2(1) DEFAULT 'Y' NOT NULL,
      CREATED_BY    VARCHAR2(100) DEFAULT USER,
      CREATION_DATE TIMESTAMP DEFAULT SYSTIMESTAMP
    )]';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- ── 2. Query log + autonomous logger ───────────────────────────────────────
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE RR_AI_QUERY_LOG (
      LOG_ID        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      CREATED_AT    TIMESTAMP DEFAULT SYSTIMESTAMP,
      APP_USER      VARCHAR2(100),
      SQL_TEXT      CLOB,
      ROW_COUNT     NUMBER,
      ELAPSED_MS    NUMBER,
      SUCCESS_FLAG  VARCHAR2(1),
      ERROR_TEXT    VARCHAR2(4000)
    )]';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

CREATE OR REPLACE PROCEDURE RR_AI_LOG_QUERY (
    p_app_user  IN VARCHAR2,
    p_sql       IN CLOB,
    p_rows      IN NUMBER,
    p_ms        IN NUMBER,
    p_success   IN VARCHAR2,
    p_error     IN VARCHAR2
) AS
    PRAGMA AUTONOMOUS_TRANSACTION;
BEGIN
    INSERT INTO RR_AI_QUERY_LOG (APP_USER, SQL_TEXT, ROW_COUNT, ELAPSED_MS, SUCCESS_FLAG, ERROR_TEXT)
    VALUES (p_app_user, p_sql, p_rows, p_ms, p_success, SUBSTR(p_error, 1, 4000));
    COMMIT;
EXCEPTION WHEN OTHERS THEN ROLLBACK;
END RR_AI_LOG_QUERY;
/

-- Hide the AI-internal tables from the AI itself
MERGE INTO RR_AI_OBJECT_ACL t
USING (SELECT 'RR_AI_QUERY_LOG' n FROM dual UNION ALL SELECT 'RR_AI_OBJECT_ACL' FROM dual) s
ON (t.OBJECT_NAME = s.n)
WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'N');
COMMIT;

-- ── 3. Guarded executor ────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE RR_AI_EXECUTE_SQL (
    p_sql       IN  CLOB,
    p_max_rows  IN  NUMBER,
    p_app_user  IN  VARCHAR2,
    p_result    OUT CLOB
) AS
    v_sql        CLOB;
    v_check      VARCHAR2(32767);
    v_max        NUMBER := LEAST(NVL(p_max_rows, 200), 1000);
    v_cur        INTEGER;
    v_cols       INTEGER;
    v_desc       DBMS_SQL.DESC_TAB2;
    v_varchar    VARCHAR2(4000);
    v_number     NUMBER;
    v_date       DATE;
    v_ts         TIMESTAMP;
    v_rows       NUMBER := 0;
    v_truncated  BOOLEAN := FALSE;
    v_t0         NUMBER := DBMS_UTILITY.GET_TIME;

    PROCEDURE fail (p_msg IN VARCHAR2, p_code IN VARCHAR2 DEFAULT 'REJECTED') AS
    BEGIN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('code',    p_code);
        APEX_JSON.WRITE('error',   p_msg);
        APEX_JSON.CLOSE_OBJECT;
        p_result := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RR_AI_LOG_QUERY(p_app_user, p_sql, NULL,
                        (DBMS_UTILITY.GET_TIME - v_t0) * 10, 'N', p_msg);
    END fail;
BEGIN
    -- Normalize: strip block + line comments, collapse whitespace, drop one trailing ;
    v_sql := REGEXP_REPLACE(p_sql, '/\*.*?\*/', ' ', 1, 0, 'n');
    v_sql := REGEXP_REPLACE(v_sql, '--[^' || CHR(10) || ']*', ' ');
    v_sql := TRIM(v_sql);
    IF v_sql IS NULL OR LENGTH(v_sql) = 0 THEN fail('Empty SQL'); RETURN; END IF;
    IF SUBSTR(v_sql, -1) = ';' THEN v_sql := TRIM(SUBSTR(v_sql, 1, LENGTH(v_sql) - 1)); END IF;

    v_check := UPPER(DBMS_LOB.SUBSTR(v_sql, 32000, 1));

    -- Single statement only
    IF INSTR(v_check, ';') > 0 THEN
        fail('Only a single SQL statement is allowed'); RETURN;
    END IF;
    -- Must be a query
    IF NOT REGEXP_LIKE(v_check, '^\s*(SELECT|WITH)\b') THEN
        fail('Only SELECT (or WITH ... SELECT) statements are allowed'); RETURN;
    END IF;
    -- Keyword ban (word-boundary, anywhere in the text)
    IF REGEXP_LIKE(v_check,
        '(^|\W)(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|BEGIN|DECLARE|CALL|LOCK|COMMIT|ROLLBACK)(\W|$)')
       OR REGEXP_LIKE(v_check, 'FOR\s+UPDATE')
       OR REGEXP_LIKE(v_check, '(^|\W)(DBMS_|UTL_)') THEN
        fail('Statement contains a banned keyword — only plain SELECT queries are allowed'); RETURN;
    END IF;

    -- Row cap: fetch one row beyond the cap to detect truncation
    v_sql := 'SELECT * FROM (' || v_sql || ') FETCH FIRST ' || TO_CHAR(v_max + 1) || ' ROWS ONLY';

    v_cur := DBMS_SQL.OPEN_CURSOR;
    BEGIN
        DBMS_SQL.PARSE(v_cur, v_sql, DBMS_SQL.NATIVE);
        DBMS_SQL.DESCRIBE_COLUMNS2(v_cur, v_cols, v_desc);

        FOR i IN 1 .. v_cols LOOP
            CASE
                WHEN v_desc(i).col_type = 2 THEN                      -- NUMBER
                    DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_number);
                WHEN v_desc(i).col_type = 12 THEN                     -- DATE
                    DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_date);
                WHEN v_desc(i).col_type IN (180, 181, 231) THEN       -- TIMESTAMP variants
                    DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_ts);
                ELSE
                    DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_varchar, 4000);
            END CASE;
        END LOOP;

        DECLARE v_ignore INTEGER; BEGIN v_ignore := DBMS_SQL.EXECUTE(v_cur); END;

        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.OPEN_ARRAY('columns');
        FOR i IN 1 .. v_cols LOOP APEX_JSON.WRITE(v_desc(i).col_name); END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        APEX_JSON.OPEN_ARRAY('rows');
        WHILE DBMS_SQL.FETCH_ROWS(v_cur) > 0 LOOP
            v_rows := v_rows + 1;
            IF v_rows > v_max THEN v_truncated := TRUE; v_rows := v_max; EXIT; END IF;
            APEX_JSON.OPEN_ARRAY;
            FOR i IN 1 .. v_cols LOOP
                CASE
                    WHEN v_desc(i).col_type = 2 THEN
                        DBMS_SQL.COLUMN_VALUE(v_cur, i, v_number);
                        IF v_number IS NULL THEN APEX_JSON.WRITE(TO_CHAR(NULL)); ELSE APEX_JSON.WRITE(v_number); END IF;
                    WHEN v_desc(i).col_type = 12 THEN
                        DBMS_SQL.COLUMN_VALUE(v_cur, i, v_date);
                        IF v_date IS NULL THEN APEX_JSON.WRITE(TO_CHAR(NULL));
                        ELSE APEX_JSON.WRITE(TO_CHAR(v_date, 'YYYY-MM-DD"T"HH24:MI:SS')); END IF;
                    WHEN v_desc(i).col_type IN (180, 181, 231) THEN
                        DBMS_SQL.COLUMN_VALUE(v_cur, i, v_ts);
                        IF v_ts IS NULL THEN APEX_JSON.WRITE(TO_CHAR(NULL));
                        ELSE APEX_JSON.WRITE(TO_CHAR(v_ts, 'YYYY-MM-DD"T"HH24:MI:SS')); END IF;
                    ELSE
                        DBMS_SQL.COLUMN_VALUE(v_cur, i, v_varchar);
                        IF v_varchar IS NULL THEN APEX_JSON.WRITE(TO_CHAR(NULL)); ELSE APEX_JSON.WRITE(v_varchar); END IF;
                END CASE;
            END LOOP;
            APEX_JSON.CLOSE_ARRAY;
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;  -- rows

        APEX_JSON.WRITE('success',   TRUE);
        APEX_JSON.WRITE('rowCount',  v_rows);
        APEX_JSON.WRITE('truncated', v_truncated);
        APEX_JSON.WRITE('elapsedMs', (DBMS_UTILITY.GET_TIME - v_t0) * 10);
        APEX_JSON.CLOSE_OBJECT;
        p_result := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        DBMS_SQL.CLOSE_CURSOR(v_cur);

        RR_AI_LOG_QUERY(p_app_user, p_sql, v_rows,
                        (DBMS_UTILITY.GET_TIME - v_t0) * 10, 'Y', NULL);
    EXCEPTION
        WHEN OTHERS THEN
            IF DBMS_SQL.IS_OPEN(v_cur) THEN DBMS_SQL.CLOSE_CURSOR(v_cur); END IF;
            fail(SQLERRM, 'ORA');
    END;
END RR_AI_EXECUTE_SQL;
/

-- ── 3b. Chunked CLOB printer (HTP.P fails over ~32k) ───────────────────────
CREATE OR REPLACE PROCEDURE RR_AI_PRINT_CLOB (p_clob IN CLOB) AS
    v_len    NUMBER := DBMS_LOB.GETLENGTH(p_clob);
    v_offset NUMBER := 1;
    c_chunk  CONSTANT NUMBER := 8000;
BEGIN
    WHILE v_offset <= v_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(p_clob, c_chunk, v_offset));
        v_offset := v_offset + c_chunk;
    END LOOP;
END RR_AI_PRINT_CLOB;
/

-- ── 3c. Metadata builder ───────────────────────────────────────────────────
-- In a stored procedure (NOT inline in the ORDS handler): ORDS scans handler
-- source for ":" binds, so literals like 'HH24:MI:SS' break the handler with
-- a 555 User Defined Resource Error. Compiled PL/SQL has no such problem.
CREATE OR REPLACE PROCEDURE RR_AI_GET_OBJECTS (
    p_object IN  VARCHAR2,
    p_result OUT CLOB
) AS
    l_object    VARCHAR2(128) := UPPER(TRIM(p_object));
    l_whitelist NUMBER;

    -- visible = not denied, and (no whitelist OR whitelisted)
    FUNCTION visible (p_name IN VARCHAR2) RETURN BOOLEAN IS
        l_flag VARCHAR2(1);
    BEGIN
        BEGIN
            SELECT allowed_flag INTO l_flag FROM rr_ai_object_acl WHERE object_name = p_name;
        EXCEPTION WHEN NO_DATA_FOUND THEN l_flag := NULL; END;
        IF l_flag = 'N' THEN RETURN FALSE; END IF;
        IF l_whitelist > 0 THEN RETURN l_flag = 'Y'; END IF;
        RETURN TRUE;
    END;
BEGIN
    SELECT COUNT(*) INTO l_whitelist FROM rr_ai_object_acl WHERE allowed_flag = 'Y';

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('generatedAt', TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS'));
    APEX_JSON.OPEN_ARRAY('objects');

    FOR o IN (
        SELECT table_name AS name, 'TABLE' AS obj_type FROM user_tables
        UNION ALL
        SELECT view_name, 'VIEW' FROM user_views
        ORDER BY 1
    ) LOOP
        IF l_object IS NOT NULL AND o.name != l_object THEN CONTINUE; END IF;
        IF NOT visible(o.name) THEN CONTINUE; END IF;

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('name', o.name);
        APEX_JSON.WRITE('type', o.obj_type);
        FOR c IN (SELECT comments FROM user_tab_comments
                  WHERE table_name = o.name AND comments IS NOT NULL) LOOP
            APEX_JSON.WRITE('comment', c.comments);
        END LOOP;

        APEX_JSON.OPEN_ARRAY('columns');
        FOR c IN (
            SELECT tc.column_name,
                   tc.data_type ||
                     CASE WHEN tc.data_type = 'NUMBER' AND tc.data_precision IS NOT NULL
                            THEN '(' || tc.data_precision || NVL2(NULLIF(tc.data_scale,0), ',' || tc.data_scale, '') || ')'
                          WHEN tc.data_type LIKE '%CHAR%'
                            THEN '(' || tc.char_length || ')'
                          ELSE '' END AS data_type,
                   tc.nullable,
                   cc.comments
            FROM   user_tab_columns tc
            LEFT   JOIN user_col_comments cc
                   ON cc.table_name = tc.table_name AND cc.column_name = tc.column_name
            WHERE  tc.table_name = o.name
            ORDER  BY tc.column_id
        ) LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('name',     c.column_name);
            APEX_JSON.WRITE('dataType', c.data_type);
            APEX_JSON.WRITE('nullable', c.nullable);
            IF c.comments IS NOT NULL THEN APEX_JSON.WRITE('comment', c.comments); END IF;
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;
        APEX_JSON.CLOSE_ARRAY;

        -- Indexes only in single-object detail (keeps the full listing light)
        IF l_object IS NOT NULL THEN
            APEX_JSON.OPEN_ARRAY('indexes');
            FOR ix IN (
                SELECT i.index_name, i.uniqueness,
                       LISTAGG(ic.column_name, ',') WITHIN GROUP (ORDER BY ic.column_position) AS cols
                FROM   user_indexes i
                JOIN   user_ind_columns ic ON ic.index_name = i.index_name
                WHERE  i.table_name = l_object
                GROUP  BY i.index_name, i.uniqueness
                ORDER  BY i.index_name
            ) LOOP
                APEX_JSON.OPEN_OBJECT;
                APEX_JSON.WRITE('name',    ix.index_name);
                APEX_JSON.WRITE('unique',  ix.uniqueness);
                APEX_JSON.WRITE('columns', ix.cols);
                APEX_JSON.CLOSE_OBJECT;
            END LOOP;
            APEX_JSON.CLOSE_ARRAY;
        END IF;

        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    p_result := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
END RR_AI_GET_OBJECTS;
/

-- ── 4. Body-parsing wrapper for the ORDS handler ───────────────────────────
CREATE OR REPLACE PROCEDURE RR_AI_EXECUTE_QUERY (
    p_body   IN  CLOB,
    p_status OUT NUMBER,
    p_result OUT CLOB
) AS
    v_sql      CLOB;
    v_max      NUMBER;
    v_app_user VARCHAR2(100);
BEGIN
    BEGIN
        SELECT JSON_VALUE(p_body, '$.sql' RETURNING CLOB),
               JSON_VALUE(p_body, '$.maxRows' RETURNING NUMBER),
               JSON_VALUE(p_body, '$.appUser')
        INTO   v_sql, v_max, v_app_user
        FROM   dual;
    EXCEPTION WHEN OTHERS THEN
        p_status := 400;
        p_result := '{"success":false,"code":"REJECTED","error":"Body must be JSON: {sql, maxRows, appUser}"}';
        RETURN;
    END;
    RR_AI_EXECUTE_SQL(v_sql, v_max, NVL(v_app_user, 'AI'), p_result);
    p_status := 200;
END RR_AI_EXECUTE_QUERY;
/

-- ── 5. ORDS handlers ───────────────────────────────────────────────────────
-- POST reerp/ai/executequery
BEGIN
    BEGIN
        ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ai/executequery');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ai/executequery');
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ai/executequery',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'AI SQL gateway — guarded SELECT-only executor',
        p_source         => q'[
DECLARE
    l_status NUMBER;
    l_result CLOB;
BEGIN
    RR_AI_EXECUTE_QUERY(:body_text, l_status, l_result);
    :status_code := l_status;
    RR_AI_PRINT_CLOB(l_result);
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    HTP.PRN('{"success":false,"code":"HANDLER","error":"' ||
            REPLACE(REPLACE(SQLERRM, '\', ' '), '"', '''') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- GET reerp/ai/objects  (optional ?object=NAME adds indexes for that object)
BEGIN
    BEGIN
        ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ai/objects');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ai/objects');
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ai/objects',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'AI SQL gateway — schema metadata (tables/views, columns, comments, indexes)',
        p_source         => q'[
DECLARE
    l_result CLOB;
BEGIN
    RR_AI_GET_OBJECTS(:object, l_result);
    RR_AI_PRINT_CLOB(l_result);
EXCEPTION WHEN OTHERS THEN
    HTP.PRN('{"success":false,"code":"HANDLER","error":"' ||
            REPLACE(REPLACE(SQLERRM, '\', ' '), '"', '''') || '"}');
END;
]'
    );
    -- GET query params must be DECLARED or ORDS throws 555/ORDS-25001
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'ai/objects',
        p_method             => 'GET',
        p_name               => 'object',
        p_bind_variable_name => 'object',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN'
    );
    COMMIT;
END;
/

-- ── Self-check: fail loudly if any RR_AI% object did not compile ───────────
DECLARE
    v_bad VARCHAR2(4000);
BEGIN
    SELECT LISTAGG(object_name, ', ') WITHIN GROUP (ORDER BY object_name)
    INTO   v_bad
    FROM   user_objects
    WHERE  object_name LIKE 'RR_AI%' AND status = 'INVALID';
    IF v_bad IS NOT NULL THEN
        RAISE_APPLICATION_ERROR(-20140,
            'AI gateway objects INVALID: ' || v_bad ||
            ' — run: SELECT name, line, text FROM user_errors WHERE name LIKE ''RR_AI%''');
    END IF;
    DBMS_OUTPUT.PUT_LINE('AI SQL gateway installed — all RR_AI% objects VALID.');
END;
/

-- ── Verify ─────────────────────────────────────────────────────────────────
--   GET  {base}/ai/objects                     -> whole schema
--   GET  {base}/ai/objects?object=RR_LEDGERS   -> one object + indexes
--   POST {base}/ai/executequery {"sql":"SELECT ledger_id, ledger_name FROM rr_ledgers","maxRows":50,"appUser":"TEST"}
--   POST {base}/ai/executequery {"sql":"DELETE FROM rr_ledgers"}   -> success:false REJECTED
