-- ============================================================
-- PATCH 303: Purchasing-RR write dispatcher
--
--   POST reerp/po/execute
--     body: { "proc": "RR_PO_DOC_PKG.SAVE_PO",
--             "params": { "p_json": {...} | "...", "p_po_header_id": "123" },
--             "user": "jdoe" }
--     resp: { "success": true|false, "status": "S"|"W"|"E",
--             "id": 123, "number": "PO-2026-00001", "message": "..." }
--
--   * Only procedures registered (and enabled) in RR_PO_PROC_REGISTRY can
--     be called; only the IN parameters listed in PARAMS_CSV are bound
--     (by name, never concatenated), p_user and the 4 OUTs are implicit.
--   * CLOB_PARAMS: params bound as CLOB (objects/arrays are serialised).
--   * Commit on S/W, rollback on E or exception. Every call is logged in
--     RR_PO_EXEC_LOG (autonomous).
-- Run after 300 → 301 → 302.
-- ============================================================

CREATE OR REPLACE PROCEDURE RR_PO_LOG_EXEC (
    p_user IN VARCHAR2, p_proc IN VARCHAR2, p_params IN CLOB, p_status IN VARCHAR2,
    p_message IN VARCHAR2, p_id IN NUMBER, p_ms IN NUMBER
) AS
    PRAGMA AUTONOMOUS_TRANSACTION;
BEGIN
    INSERT INTO RR_PO_EXEC_LOG (USER_NAME, PROC_NAME, PARAMS_CLOB, STATUS, MESSAGE, RESULT_ID, ELAPSED_MS, CREATED_BY)
    VALUES (p_user, p_proc, p_params, p_status, SUBSTR(p_message, 1, 4000), p_id, p_ms, p_user);
    COMMIT;
EXCEPTION WHEN OTHERS THEN ROLLBACK;
END RR_PO_LOG_EXEC;
/

CREATE OR REPLACE PROCEDURE RR_PO_PRINT_CLOB (p_clob IN CLOB) AS
    v_len NUMBER := NVL(DBMS_LOB.GETLENGTH(p_clob), 0);
    v_pos NUMBER := 1;
BEGIN
    WHILE v_pos <= v_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(p_clob, 8000, v_pos));
        v_pos := v_pos + 8000;
    END LOOP;
END RR_PO_PRINT_CLOB;
/

CREATE OR REPLACE PROCEDURE RR_PO_EXECUTE (
    p_body   IN  CLOB,
    p_http   OUT NUMBER,
    p_result OUT CLOB
) AS
    v_t0      TIMESTAMP := SYSTIMESTAMP;
    v_body    JSON_OBJECT_T;
    v_params  JSON_OBJECT_T;
    v_proc    VARCHAR2(128);
    v_user    VARCHAR2(150);
    v_reg     RR_PO_PROC_REGISTRY%ROWTYPE;
    v_sql     VARCHAR2(32767);
    v_cur     INTEGER;
    v_dummy   INTEGER;
    v_name    VARCHAR2(128);
    v_clobs   VARCHAR2(600);
    v_el      JSON_ELEMENT_T;
    v_txt     VARCHAR2(32767);
    v_clob    CLOB;
    v_id      NUMBER;
    v_number  VARCHAR2(200);
    v_status  VARCHAR2(10);
    v_message VARCHAR2(4000);
    v_out     JSON_OBJECT_T := JSON_OBJECT_T();
    v_ms      NUMBER;
    v_plist   SYS.ODCIVARCHAR2LIST;

    FUNCTION ms RETURN NUMBER IS
        d INTERVAL DAY TO SECOND := SYSTIMESTAMP - v_t0;
    BEGIN
        RETURN ROUND(EXTRACT(SECOND FROM d) * 1000 + EXTRACT(MINUTE FROM d) * 60000);
    END;

    FUNCTION param_list RETURN SYS.ODCIVARCHAR2LIST IS
        l SYS.ODCIVARCHAR2LIST := SYS.ODCIVARCHAR2LIST();
    BEGIN
        FOR r IN (SELECT LOWER(TRIM(REGEXP_SUBSTR(v_reg.PARAMS_CSV, '[^,]+', 1, LEVEL))) p
                    FROM dual CONNECT BY REGEXP_SUBSTR(v_reg.PARAMS_CSV, '[^,]+', 1, LEVEL) IS NOT NULL) LOOP
            IF r.p IS NOT NULL THEN
                IF NOT REGEXP_LIKE(r.p, '^p_[a-z0-9_]{1,60}$') THEN
                    RAISE_APPLICATION_ERROR(-20001, 'Bad registry parameter ' || r.p);
                END IF;
                l.EXTEND; l(l.COUNT) := r.p;
            END IF;
        END LOOP;
        RETURN l;
    END;
BEGIN
    p_http := 200;
    BEGIN
        v_body := JSON_OBJECT_T.parse(p_body);
    EXCEPTION WHEN OTHERS THEN
        p_http := 400;
        p_result := '{"success":false,"status":"E","message":"Body must be JSON: {proc, params, user}"}';
        RETURN;
    END;

    v_proc := UPPER(TRIM(v_body.get_string('proc')));
    v_user := SUBSTR(NVL(v_body.get_string('user'), 'UNKNOWN'), 1, 150);
    v_params := CASE WHEN v_body.has('params') AND v_body.get('params').is_object
                     THEN TREAT(v_body.get('params') AS JSON_OBJECT_T) ELSE JSON_OBJECT_T() END;

    BEGIN
        SELECT * INTO v_reg FROM RR_PO_PROC_REGISTRY WHERE PROC_NAME = v_proc AND ENABLED_FLAG = 'Y';
    EXCEPTION WHEN NO_DATA_FOUND THEN
        p_http := 403;
        v_out.put('success', FALSE); v_out.put('status', 'E');
        v_out.put('message', 'Procedure ' || NVL(v_proc, '(none)') || ' is not registered for po/execute');
        p_result := v_out.to_clob;
        RR_PO_LOG_EXEC(v_user, v_proc, p_body, 'E', 'not registered', NULL, ms);
        RETURN;
    END;

    v_plist := param_list();
    v_clobs := ',' || LOWER(REPLACE(NVL(v_reg.CLOB_PARAMS, ''), ' ', '')) || ',';

    -- Build the call text from the registry only (never from the request)
    v_sql := 'BEGIN ' || DBMS_ASSERT.QUALIFIED_SQL_NAME(v_reg.PROC_NAME) || '(';
    FOR i IN 1 .. v_plist.COUNT LOOP
        v_name := v_plist(i);
        v_sql := v_sql || v_name || ' => :' || v_name || ', ';
    END LOOP;
    v_sql := v_sql || 'p_user => :p_user, p_id => :o_id, p_number => :o_number, '
                   || 'p_status => :o_status, p_message => :o_message); END;';

    SAVEPOINT rr_po_exec;
    v_cur := DBMS_SQL.OPEN_CURSOR;
    BEGIN
        DBMS_SQL.PARSE(v_cur, v_sql, DBMS_SQL.NATIVE);
        FOR i IN 1 .. v_plist.COUNT LOOP
            v_name := v_plist(i);
            v_el := NULL;
            IF v_params.has(v_name) THEN v_el := v_params.get(v_name); END IF;
            IF INSTR(v_clobs, ',' || v_name || ',') > 0 THEN
                IF v_el IS NULL OR v_el.is_null THEN v_clob := NULL;
                ELSIF v_el.is_string THEN v_clob := v_params.get_clob(v_name);
                ELSE v_clob := v_el.to_clob;
                END IF;
                DBMS_SQL.BIND_VARIABLE(v_cur, ':' || v_name, v_clob);
            ELSE
                IF v_el IS NULL OR v_el.is_null THEN v_txt := NULL;
                ELSIF v_el.is_string THEN v_txt := v_params.get_string(v_name);
                ELSIF v_el.is_boolean THEN v_txt := CASE WHEN v_params.get_boolean(v_name) THEN 'Y' ELSE 'N' END;
                ELSE v_txt := v_el.to_string;   -- numbers (and anything else) as text
                END IF;
                DBMS_SQL.BIND_VARIABLE(v_cur, ':' || v_name, v_txt, 32767);
            END IF;
        END LOOP;
        DBMS_SQL.BIND_VARIABLE(v_cur, ':p_user', v_user, 150);
        DBMS_SQL.BIND_VARIABLE(v_cur, ':o_id', v_id);
        DBMS_SQL.BIND_VARIABLE(v_cur, ':o_number', v_number, 200);
        DBMS_SQL.BIND_VARIABLE(v_cur, ':o_status', v_status, 10);
        DBMS_SQL.BIND_VARIABLE(v_cur, ':o_message', v_message, 4000);
        v_dummy := DBMS_SQL.EXECUTE(v_cur);
        DBMS_SQL.VARIABLE_VALUE(v_cur, ':o_id', v_id);
        DBMS_SQL.VARIABLE_VALUE(v_cur, ':o_number', v_number);
        DBMS_SQL.VARIABLE_VALUE(v_cur, ':o_status', v_status);
        DBMS_SQL.VARIABLE_VALUE(v_cur, ':o_message', v_message);
        DBMS_SQL.CLOSE_CURSOR(v_cur);
    EXCEPTION WHEN OTHERS THEN
        IF DBMS_SQL.IS_OPEN(v_cur) THEN DBMS_SQL.CLOSE_CURSOR(v_cur); END IF;
        v_status := 'E';
        v_message := SUBSTR(REGEXP_REPLACE(SQLERRM, '^ORA-2[0-9]{4}: ', ''), 1, 4000);
    END;

    IF NVL(v_status, 'E') IN ('S', 'W') THEN
        COMMIT;
    ELSE
        ROLLBACK TO rr_po_exec;
        v_status := 'E';
    END IF;

    v_ms := ms;
    v_out.put('success', v_status IN ('S', 'W'));
    v_out.put('status', v_status);
    IF v_id IS NULL THEN v_out.put_null('id'); ELSE v_out.put('id', v_id); END IF;
    v_out.put('number', v_number);
    v_out.put('message', v_message);
    v_out.put('elapsedMs', v_ms);
    p_result := v_out.to_clob;
    RR_PO_LOG_EXEC(v_user, v_proc, v_params.to_clob, v_status, v_message, v_id, v_ms);
END RR_PO_EXECUTE;
/

-- ── Registry: every public procedure the frontend may call ────────────────
MERGE INTO RR_PO_PROC_REGISTRY t
USING (
    SELECT 'RR_PO_SETUP_PKG.SAVE_SETUP' n, 'p_entity,p_json' p, 'p_json' c, 'Save a setup row (entity + JSON)' d FROM dual UNION ALL
    SELECT 'RR_PO_SETUP_PKG.DELETE_SETUP', 'p_entity,p_row_id', NULL, 'Delete a setup row' FROM dual UNION ALL
    SELECT 'RR_PO_REQ_PKG.SAVE_REQUISITION', 'p_json', 'p_json', 'Create/update a requisition' FROM dual UNION ALL
    SELECT 'RR_PO_REQ_PKG.SUBMIT', 'p_req_header_id', NULL, 'Submit a requisition for approval' FROM dual UNION ALL
    SELECT 'RR_PO_REQ_PKG.WITHDRAW', 'p_req_header_id', NULL, 'Withdraw a requisition from approval' FROM dual UNION ALL
    SELECT 'RR_PO_REQ_PKG.CANCEL', 'p_req_header_id,p_reason', NULL, 'Cancel a requisition' FROM dual UNION ALL
    SELECT 'RR_PO_REQ_PKG.DELETE_DRAFT', 'p_req_header_id', NULL, 'Delete a draft requisition' FROM dual UNION ALL
    SELECT 'RR_PO_REQ_PKG.RETURN_LINES', 'p_req_line_ids,p_reason', NULL, 'Buyer returns requisition lines' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.SAVE_PO', 'p_json', 'p_json', 'Create/update a purchase order' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.AUTOCREATE', 'p_json', 'p_json', 'Create a PO from requisition lines' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.COPY_PO', 'p_po_header_id', NULL, 'Copy a PO' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.SUBMIT_PO', 'p_po_header_id', NULL, 'Submit a PO for approval' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.WITHDRAW_PO', 'p_po_header_id', NULL, 'Withdraw a PO from approval' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.DELETE_PO', 'p_po_header_id', NULL, 'Delete a draft PO' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.CANCEL_PO', 'p_po_header_id,p_po_line_id,p_reason,p_recreate_demand', NULL, 'Cancel a PO or line' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.CLOSE_PO', 'p_po_header_id,p_po_line_id,p_action,p_reason', NULL, 'Close / reopen / final close' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.HOLD_PO', 'p_po_header_id,p_action,p_reason', NULL, 'Hold / release a PO' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.MARK_COMMUNICATED', 'p_po_header_id,p_method,p_to', NULL, 'Record PO communication' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.SUBMIT_CHANGE', 'p_po_header_id,p_changes_json,p_reason', 'p_changes_json', 'Submit a change order' FROM dual UNION ALL
    SELECT 'RR_PO_DOC_PKG.CANCEL_CHANGE', 'p_change_order_id', NULL, 'Cancel a pending change order' FROM dual UNION ALL
    SELECT 'RR_PO_RCV_PKG.RECEIVE', 'p_json', 'p_json', 'Receive against PO schedules' FROM dual UNION ALL
    SELECT 'RR_PO_RCV_PKG.RETURN_TO_SUPPLIER', 'p_rcv_transaction_id,p_quantity,p_amount,p_reason,p_txn_date,p_comments', NULL, 'Return to supplier' FROM dual UNION ALL
    SELECT 'RR_PO_RCV_PKG.CORRECT', 'p_rcv_transaction_id,p_quantity,p_amount,p_txn_date,p_comments', NULL, 'Correct a receipt' FROM dual UNION ALL
    SELECT 'RR_PO_ACCT_PKG.MARK_ACCOUNTED', 'p_entity,p_ids,p_sla_header_id,p_gl_batch_id,p_reversal_gl_batch_id', NULL, 'Stamp SLA/GL ids' FROM dual UNION ALL
    SELECT 'RR_PO_ACCT_PKG.RUN_PERIOD_END_ACCRUAL', 'p_business_unit_id,p_period_name,p_accrual_date,p_reversal_date', NULL, 'Period-end accrual run' FROM dual UNION ALL
    SELECT 'RR_PO_ACCT_PKG.CANCEL_ACCRUAL_RUN', 'p_run_id', NULL, 'Cancel an accrual run' FROM dual UNION ALL
    SELECT 'RR_PO_ACCT_PKG.WRITE_OFF', 'p_json', 'p_json', 'Write off uninvoiced receipts' FROM dual UNION ALL
    SELECT 'RR_PO_APPROVAL_PKG.DECIDE', 'p_request_id,p_decision,p_comments', NULL, 'Approve / reject a procurement request' FROM dual
) s ON (t.PROC_NAME = s.n)
WHEN MATCHED THEN UPDATE SET t.PARAMS_CSV = s.p, t.CLOB_PARAMS = s.c, t.DESCRIPTION = s.d,
                             t.LAST_UPDATED_BY = 'PATCH303', t.LAST_UPDATE_DATE = SYSTIMESTAMP
WHEN NOT MATCHED THEN INSERT (PROC_NAME, PARAMS_CSV, CLOB_PARAMS, ENABLED_FLAG, DESCRIPTION, CREATED_BY)
                      VALUES (s.n, s.p, s.c, 'Y', s.d, 'PATCH303');
COMMIT;

-- ── ORDS handler: POST reerp/po/execute ──────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'po/execute');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'po/execute');
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'po/execute',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Purchasing-RR write dispatcher (registry-whitelisted procedures)',
        p_source         => q'[
DECLARE
    l_http   NUMBER;
    l_result CLOB;
BEGIN
    RR_PO_EXECUTE(:body_text, l_http, l_result);
    :status_code := l_http;
    RR_PO_PRINT_CLOB(l_result);
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"status":"E","message":"' ||
            REPLACE(REPLACE(SQLERRM, '\', ' '), '"', '''') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Smoke checks ─────────────────────────────────────────────────────────────
SELECT OBJECT_NAME, OBJECT_TYPE, STATUS FROM USER_OBJECTS
 WHERE OBJECT_NAME LIKE 'RR\_PO\_%' ESCAPE '\' AND OBJECT_TYPE IN ('PACKAGE', 'PACKAGE BODY', 'PROCEDURE', 'TRIGGER', 'VIEW')
 ORDER BY STATUS, OBJECT_TYPE, OBJECT_NAME;

SELECT PROC_NAME, PARAMS_CSV FROM RR_PO_PROC_REGISTRY ORDER BY PROC_NAME;
