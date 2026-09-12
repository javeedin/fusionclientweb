-- ============================================================
-- PATCH 142: AI Assistant saved reports
--
-- Save a chat-generated SQL as a named report, list, re-run live,
-- and delete. Runs reuse the guarded executor (RR_AI_EXECUTE_SQL),
-- so saved reports stay SELECT-only with the same row caps + logging.
--
--   POST ai/reports/save    {name, category, description, sql, createdBy}
--   GET  ai/reports/list    -> {reports:[...] } (includes sqlText)
--   POST ai/reports/run     {reportId, maxRows, appUser}
--   POST ai/reports/delete  {reportId}
--
-- Prereq: 140_ai_sql_gateway.sql (RR_AI_EXECUTE_SQL, RR_AI_PRINT_CLOB).
-- Handler bodies stay trivial (no ':' literals — ORDS bind scanning).
-- ============================================================

BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE RR_AI_REPORTS (
      REPORT_ID      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      REPORT_NAME    VARCHAR2(200) NOT NULL,
      CATEGORY       VARCHAR2(100),
      DESCRIPTION    VARCHAR2(1000),
      SQL_TEXT       CLOB NOT NULL,
      CREATED_BY     VARCHAR2(100) DEFAULT USER,
      CREATION_DATE  TIMESTAMP DEFAULT SYSTIMESTAMP,
      LAST_RUN_DATE  TIMESTAMP,
      LAST_RUN_ROWS  NUMBER
    )]';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

-- Keep the reports table out of the AI's schema catalog
MERGE INTO RR_AI_OBJECT_ACL t
USING (SELECT 'RR_AI_REPORTS' n FROM dual) s ON (t.OBJECT_NAME = s.n)
WHEN NOT MATCHED THEN INSERT (OBJECT_NAME, ALLOWED_FLAG) VALUES (s.n, 'N');
COMMIT;

-- ── Save ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE RR_AI_REPORT_SAVE (
    p_body   IN  CLOB,
    p_status OUT NUMBER,
    p_result OUT CLOB
) AS
    v_name  VARCHAR2(200);
    v_cat   VARCHAR2(100);
    v_desc  VARCHAR2(1000);
    v_sql   CLOB;
    v_by    VARCHAR2(100);
    v_id    NUMBER;
BEGIN
    SELECT JSON_VALUE(p_body, '$.name'),
           JSON_VALUE(p_body, '$.category'),
           JSON_VALUE(p_body, '$.description'),
           JSON_VALUE(p_body, '$.sql' RETURNING CLOB),
           JSON_VALUE(p_body, '$.createdBy')
    INTO   v_name, v_cat, v_desc, v_sql, v_by
    FROM   dual;

    IF v_name IS NULL OR v_sql IS NULL THEN
        p_status := 400;
        p_result := '{"success":false,"error":"name and sql are required"}';
        RETURN;
    END IF;

    INSERT INTO RR_AI_REPORTS (REPORT_NAME, CATEGORY, DESCRIPTION, SQL_TEXT, CREATED_BY)
    VALUES (v_name, NVL(v_cat, 'General'), v_desc, v_sql, NVL(v_by, USER))
    RETURNING REPORT_ID INTO v_id;
    COMMIT;

    p_status := 200;
    p_result := '{"success":true,"reportId":' || v_id || '}';
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    p_status := 500;
    p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
END RR_AI_REPORT_SAVE;
/

-- ── List ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE RR_AI_REPORT_LIST (
    p_result OUT CLOB
) AS
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('reports');
    FOR r IN (
        SELECT report_id, report_name, category, description, sql_text,
               created_by, creation_date, last_run_date, last_run_rows
        FROM   rr_ai_reports
        ORDER  BY category, report_name
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('reportId',    r.report_id);
        APEX_JSON.WRITE('name',        r.report_name);
        APEX_JSON.WRITE('category',    r.category);
        APEX_JSON.WRITE('description', r.description);
        APEX_JSON.WRITE('sqlText',     r.sql_text);
        APEX_JSON.WRITE('createdBy',   r.created_by);
        APEX_JSON.WRITE('createdDate', TO_CHAR(r.creation_date, 'YYYY-MM-DD HH24:MI'));
        IF r.last_run_date IS NOT NULL THEN
            APEX_JSON.WRITE('lastRunDate', TO_CHAR(r.last_run_date, 'YYYY-MM-DD HH24:MI'));
            APEX_JSON.WRITE('lastRunRows', r.last_run_rows);
        END IF;
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    p_result := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
END RR_AI_REPORT_LIST;
/

-- ── Run (live, via the guarded executor) ───────────────────────────────────
CREATE OR REPLACE PROCEDURE RR_AI_REPORT_RUN (
    p_body   IN  CLOB,
    p_status OUT NUMBER,
    p_result OUT CLOB
) AS
    v_id   NUMBER;
    v_max  NUMBER;
    v_usr  VARCHAR2(100);
    v_sql  CLOB;
    v_rows NUMBER;
BEGIN
    SELECT JSON_VALUE(p_body, '$.reportId' RETURNING NUMBER),
           JSON_VALUE(p_body, '$.maxRows'  RETURNING NUMBER),
           JSON_VALUE(p_body, '$.appUser')
    INTO   v_id, v_max, v_usr
    FROM   dual;

    BEGIN
        SELECT sql_text INTO v_sql FROM rr_ai_reports WHERE report_id = v_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        p_status := 404;
        p_result := '{"success":false,"error":"Report ' || v_id || ' not found"}';
        RETURN;
    END;

    RR_AI_EXECUTE_SQL(v_sql, NVL(v_max, 500), NVL(v_usr, 'AI_REPORT'), p_result);
    p_status := 200;

    -- Stamp last run when the executor reported success
    v_rows := JSON_VALUE(p_result, '$.rowCount' RETURNING NUMBER);
    IF JSON_VALUE(p_result, '$.success') = 'true' THEN
        UPDATE rr_ai_reports
        SET    last_run_date = SYSTIMESTAMP, last_run_rows = v_rows
        WHERE  report_id = v_id;
        COMMIT;
    END IF;
EXCEPTION WHEN OTHERS THEN
    p_status := 500;
    p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
END RR_AI_REPORT_RUN;
/

-- ── Delete ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE RR_AI_REPORT_DELETE (
    p_body   IN  CLOB,
    p_status OUT NUMBER,
    p_result OUT CLOB
) AS
    v_id NUMBER;
BEGIN
    v_id := JSON_VALUE(p_body, '$.reportId' RETURNING NUMBER);
    DELETE FROM rr_ai_reports WHERE report_id = v_id;
    IF SQL%ROWCOUNT = 0 THEN
        p_status := 404;
        p_result := '{"success":false,"error":"Report ' || v_id || ' not found"}';
        ROLLBACK;
        RETURN;
    END IF;
    COMMIT;
    p_status := 200;
    p_result := '{"success":true,"deleted":' || v_id || '}';
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    p_status := 500;
    p_result := '{"success":false,"error":"' || REPLACE(SQLERRM, '"', '''') || '"}';
END RR_AI_REPORT_DELETE;
/

-- ── ORDS handlers (thin wrappers) ──────────────────────────────────────────
DECLARE
    PROCEDURE def_post (p_pattern IN VARCHAR2, p_proc IN VARCHAR2) IS
    BEGIN
        BEGIN
            ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => p_pattern);
        EXCEPTION WHEN OTHERS THEN NULL; END;
        ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => p_pattern);
        ORDS.DEFINE_HANDLER(
            p_module_name    => 'reerp',
            p_pattern        => p_pattern,
            p_method         => 'POST',
            p_source_type    => 'plsql/block',
            p_items_per_page => 0,
            p_mimes_allowed  => 'application/json',
            p_source         =>
                'DECLARE l_status NUMBER; l_result CLOB; ' ||
                'BEGIN ' || p_proc || '(:body_text, l_status, l_result); ' ||
                ':status_code := l_status; RR_AI_PRINT_CLOB(l_result); ' ||
                'EXCEPTION WHEN OTHERS THEN :status_code := 500; ' ||
                'HTP.PRN(''{"success":false,"error":"'' || REPLACE(SQLERRM, ''"'', '''''''') || ''"}''); END;'
        );
    END;
BEGIN
    def_post('ai/reports/save',   'RR_AI_REPORT_SAVE');
    def_post('ai/reports/run',    'RR_AI_REPORT_RUN');
    def_post('ai/reports/delete', 'RR_AI_REPORT_DELETE');

    BEGIN
        ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ai/reports/list');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ai/reports/list');
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ai/reports/list',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_source         =>
            'DECLARE l_result CLOB; BEGIN RR_AI_REPORT_LIST(l_result); RR_AI_PRINT_CLOB(l_result); ' ||
            'EXCEPTION WHEN OTHERS THEN ' ||
            'HTP.PRN(''{"success":false,"error":"'' || REPLACE(SQLERRM, ''"'', '''''''') || ''"}''); END;'
    );
    COMMIT;
END;
/

-- ── Self-check ─────────────────────────────────────────────────────────────
DECLARE
    v_bad VARCHAR2(4000);
BEGIN
    SELECT LISTAGG(object_name, ', ') WITHIN GROUP (ORDER BY object_name)
    INTO   v_bad
    FROM   user_objects
    WHERE  object_name LIKE 'RR_AI_REPORT%' AND status = 'INVALID';
    IF v_bad IS NOT NULL THEN
        RAISE_APPLICATION_ERROR(-20142, 'Saved-report objects INVALID: ' || v_bad);
    END IF;
    DBMS_OUTPUT.PUT_LINE('AI saved reports installed — all objects VALID.');
END;
/
