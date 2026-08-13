-- ============================================================
-- PATCH 74: PUT /cash/externaltransactions/:externalTransactionId
--           for bank reconciliation (sets RECONCILED_FLAG + RECONCILED_DATE)
--
-- Problem:
--   When reconciling an external transaction from the bank recon page,
--   the frontend calls PUT /cash/externaltransactions/:id but no PUT
--   handler exists at that path (only DELETE and /accountingflag subpath).
--   RR_EXTERNAL_CASH_TRANSACTIONS also lacks a RECONCILED_DATE column.
--
-- Fix:
--   Step 1: Add RECONCILED_DATE column (idempotent)
--   Step 2: Add PUT handler at cash/externaltransactions/:externalTransactionId
--           that sets RECONCILED_FLAG='Y' and RECONCILED_DATE
--
-- Request body (from bank recon frontend):
--   {
--     "reconciledFlag":  "Y",
--     "reconciledDate":  "2026-05-14",
--     "statementId":     22,
--     "stmtLineId":      60
--   }
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run each block (Step 1, Step 2) separately.
-- ============================================================

-- ── Step 1: Add RECONCILED_DATE column (idempotent) ──────────
BEGIN
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_CASH_TRANSACTIONS ADD RECONCILED_DATE DATE';
        DBMS_OUTPUT.PUT_LINE('RECONCILED_DATE column added');
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLCODE = -1430 THEN
                DBMS_OUTPUT.PUT_LINE('RECONCILED_DATE already exists — skipped');
            ELSE RAISE;
            END IF;
    END;
END;
/

-- ── Step 2: Add PUT handler ───────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Template already exists (DELETE handler registered it); this is a no-op if present
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId',
            p_priority    => 0,
            p_etag_type   => 'HASH',
            p_comments    => 'Single external cash transaction operations'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:externalTransactionId',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Reconcile external cash transaction — sets RECONCILED_FLAG and RECONCILED_DATE',
        p_source         => q'[
DECLARE
    v_id            NUMBER;
    v_recon_flag    VARCHAR2(1)  := 'Y';
    v_recon_date    DATE         := SYSDATE;
    v_stmt_id       NUMBER;
    v_stmt_line_id  NUMBER;
    v_rows          NUMBER;

    FUNCTION sstr(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        RETURN p_obj.get_string(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION snum(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        RETURN p_obj.get_number(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
BEGIN
    v_id := TO_NUMBER(:externalTransactionId);

    DECLARE
        v_obj  JSON_OBJECT_T;
        v_flag VARCHAR2(1);
        v_date VARCHAR2(20);
    BEGIN
        v_obj          := JSON_OBJECT_T.parse(:body_text);
        v_flag         := sstr(v_obj, 'reconciledFlag');
        v_date         := sstr(v_obj, 'reconciledDate');
        v_stmt_id      := snum(v_obj, 'statementId');
        v_stmt_line_id := snum(v_obj, 'stmtLineId');
        IF v_flag IS NOT NULL THEN v_recon_flag := v_flag; END IF;
        IF v_date IS NOT NULL THEN v_recon_date := TO_DATE(v_date, 'YYYY-MM-DD'); END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
       SET RECONCILED_FLAG  = v_recon_flag,
           RECONCILED_DATE  = v_recon_date,
           STATUS           = CASE WHEN v_recon_flag = 'Y' THEN 'REC' ELSE STATUS END,
           LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE EXTERNAL_TRANSACTION_ID = v_id;

    v_rows := SQL%ROWCOUNT;
    COMMIT;

    IF v_rows = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"error","message":"External transaction not found: ' || v_id || '"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"success"'
           || ',"externalTransactionId":' || v_id
           || ',"reconciledFlag":"'       || v_recon_flag || '"'
           || ',"statementId":'           || NVL(TO_CHAR(v_stmt_id),  'null')
           || ',"stmtLineId":'            || NVL(TO_CHAR(v_stmt_line_id), 'null')
           || '}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
