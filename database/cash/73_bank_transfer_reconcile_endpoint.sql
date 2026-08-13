-- ============================================================
-- PATCH 73: PUT /cash/reconciliation/bank_transfers/:transferId
--
-- When reconciling a bank transfer, update BOTH:
--   1. RR_GL_JE_LINES_ALL  — set RECONCILED_FLAG='Y' for the
--      specific journal line (jeHeaderId + jeLineNumber in body)
--   2. RR_BANK_ACCOUNT_TRANSFERS — set RECONCILED_FLAG='Y',
--      RECONCILED_DATE = reconciledDate for the transfer record
--
-- Request body:
--   {
--     "jeHeaderId":    1000000209,
--     "jeLineNumber":  1,
--     "reconciledDate": "2026-05-14",
--     "statementId":   22,
--     "stmtLineId":    60
--   }
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run each block (Step 1, Step 2) separately.
-- ============================================================

-- ── Step 1: Register template ────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/reconciliation/bank_transfers/:transferId'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/reconciliation/bank_transfers/:transferId',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Bank transfer reconciliation update — updates GL line and bank transfer record'
    );
    COMMIT;
END;
/

-- ── Step 2: PUT handler ──────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/reconciliation/bank_transfers/:transferId',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_transfer_id   NUMBER;
    v_je_header_id  NUMBER;
    v_je_line_num   NUMBER;
    v_recon_date    DATE;
    v_stmt_id       NUMBER;
    v_stmt_line_id  NUMBER;
    v_body          CLOB;
    v_obj           JSON_OBJECT_T;
    v_gl_rows       NUMBER := 0;
    v_bat_rows      NUMBER := 0;

    FUNCTION snum(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        RETURN p_obj.get_number(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION sstr(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj IS NULL OR NOT p_obj.has(p_key) OR p_obj.get(p_key).is_null() THEN RETURN NULL; END IF;
        RETURN p_obj.get_string(p_key);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
BEGIN
    v_transfer_id := TO_NUMBER(:transferId);

    v_body := :body_text;
    IF v_body IS NOT NULL AND LENGTH(v_body) > 0 THEN
        v_obj          := JSON_OBJECT_T.parse(v_body);
        v_je_header_id := snum(v_obj, 'jeHeaderId');
        v_je_line_num  := snum(v_obj, 'jeLineNumber');
        v_stmt_id      := snum(v_obj, 'statementId');
        v_stmt_line_id := snum(v_obj, 'stmtLineId');
        DECLARE v_d VARCHAR2(30) := sstr(v_obj, 'reconciledDate');
        BEGIN
            v_recon_date := CASE WHEN v_d IS NOT NULL THEN TO_DATE(v_d, 'YYYY-MM-DD') ELSE SYSDATE END;
        END;
    ELSE
        v_recon_date := SYSDATE;
    END IF;

    -- 1. Update specific GL journal line if header/line provided
    IF v_je_header_id IS NOT NULL AND v_je_line_num IS NOT NULL THEN
        UPDATE RR_GL_JE_LINES_ALL
           SET RECONCILED_FLAG = 'Y'
         WHERE JE_HEADER_ID  = v_je_header_id
           AND JE_LINE_NUMBER = v_je_line_num;
        v_gl_rows := SQL%ROWCOUNT;
    END IF;

    -- 2. Update RR_BANK_ACCOUNT_TRANSFERS
    UPDATE RR_BANK_ACCOUNT_TRANSFERS
       SET RECONCILED_FLAG = 'Y',
           RECONCILED_DATE = v_recon_date,
           LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE BANK_ACCOUNT_TRANSFER_ID = v_transfer_id;
    v_bat_rows := SQL%ROWCOUNT;

    COMMIT;

    :status_code := 200;
    HTP.P('{"status":"success"'
       || ',"transferId":'     || v_transfer_id
       || ',"glRowsUpdated":'  || v_gl_rows
       || ',"batRowsUpdated":' || v_bat_rows
       || '}');
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
