-- ============================================================
-- Fix: PUT gl/revaluation/:id — full body update
--
-- The original PUT handler only updated status + GL batch fields.
-- This replaces it with a handler that accepts the full revaluation
-- body, updates all header fields, and replaces CCY rows + lines.
-- ============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Full update of FX Revaluation header, CCY rows, and lines',
        p_source         => q'[
DECLARE
    v_id           NUMBER  := TO_NUMBER(:id);
    v_body         CLOB;
    v_rows         NUMBER;
    v_status       VARCHAR2(20);
    v_batch_id     NUMBER;
    v_batch_name   VARCHAR2(240);
    v_header_id    NUMBER;
    -- header fields
    v_ledger_id    NUMBER;
    v_ledger_name  VARCHAR2(240);
    v_period       VARCHAR2(100);
    v_account      VARCHAR2(100);
    v_acct_desc    VARCHAR2(500);
    v_func_ccy     VARCHAR2(10);
    v_gain_acct    VARCHAR2(200);
    v_loss_acct    VARCHAR2(200);
    v_t_gain       NUMBER;
    v_t_loss       NUMBER;
    v_notes        VARCHAR2(1000);
BEGIN
    v_body := :body_text;

    -- ── Detect mode: status-only update vs full update ─────────────────────
    -- If the body contains 'account' key → full update; otherwise status-only
    SELECT JSON_VALUE(v_body, '$.account') INTO v_account FROM DUAL;

    IF v_account IS NULL THEN
        -- Status-only update (called from Create Accounting flow)
        SELECT
            JSON_VALUE(v_body, '$.status'),
            JSON_VALUE(v_body, '$.gl_batch_id'   RETURNING NUMBER),
            JSON_VALUE(v_body, '$.gl_batch_name'),
            JSON_VALUE(v_body, '$.gl_header_id'  RETURNING NUMBER)
        INTO v_status, v_batch_id, v_batch_name, v_header_id
        FROM DUAL;

        UPDATE RR_REVALUE_HEADER
        SET
            STATUS        = NVL(v_status,     STATUS),
            GL_BATCH_ID   = NVL(v_batch_id,   GL_BATCH_ID),
            GL_BATCH_NAME = NVL(v_batch_name, GL_BATCH_NAME),
            GL_HEADER_ID  = NVL(v_header_id,  GL_HEADER_ID)
        WHERE REVALUE_ID = v_id;

        v_rows := SQL%ROWCOUNT;
    ELSE
        -- Full update — replace header + CCY rows + lines
        SELECT
            JSON_VALUE(v_body, '$.ledger_id'      RETURNING NUMBER),
            JSON_VALUE(v_body, '$.ledger_name'),
            JSON_VALUE(v_body, '$.period_name'),
            JSON_VALUE(v_body, '$.account_desc'),
            JSON_VALUE(v_body, '$.functional_ccy'),
            JSON_VALUE(v_body, '$.gain_account'),
            JSON_VALUE(v_body, '$.loss_account'),
            JSON_VALUE(v_body, '$.total_gain'      RETURNING NUMBER),
            JSON_VALUE(v_body, '$.total_loss'      RETURNING NUMBER),
            JSON_VALUE(v_body, '$.notes')
        INTO
            v_ledger_id, v_ledger_name, v_period, v_acct_desc,
            v_func_ccy, v_gain_acct, v_loss_acct, v_t_gain, v_t_loss, v_notes
        FROM DUAL;

        UPDATE RR_REVALUE_HEADER
        SET
            LEDGER_ID      = NVL(v_ledger_id,   LEDGER_ID),
            LEDGER_NAME    = NVL(v_ledger_name,  LEDGER_NAME),
            PERIOD_NAME    = NVL(v_period,       PERIOD_NAME),
            ACCOUNT_DESC   = NVL(v_acct_desc,    ACCOUNT_DESC),
            FUNCTIONAL_CCY = NVL(v_func_ccy,     FUNCTIONAL_CCY),
            GAIN_ACCOUNT   = NVL(v_gain_acct,    GAIN_ACCOUNT),
            LOSS_ACCOUNT   = NVL(v_loss_acct,    LOSS_ACCOUNT),
            TOTAL_GAIN     = NVL(v_t_gain,       TOTAL_GAIN),
            TOTAL_LOSS     = NVL(v_t_loss,       TOTAL_LOSS),
            NOTES          = v_notes
        WHERE REVALUE_ID = v_id;

        v_rows := SQL%ROWCOUNT;

        IF v_rows > 0 THEN
            -- Replace CCY rows
            DELETE FROM RR_REVALUE_CCY   WHERE REVALUE_ID = v_id;
            DELETE FROM RR_REVALUE_LINES WHERE REVALUE_ID = v_id;

            INSERT INTO RR_REVALUE_CCY (
                REVALUE_ID, CURRENCY_CODE, ENT_CLOSING, ACCT_CLOSING,
                BOOK_RATE, NEW_RATE, NEW_ACCT_VALUE, REVAL_AMT, IS_GAIN
            )
            SELECT
                v_id,
                j.CURRENCY_CODE, j.ENT_CLOSING, j.ACCT_CLOSING,
                j.BOOK_RATE, j.NEW_RATE, j.NEW_ACCT_VALUE, j.REVAL_AMT, j.IS_GAIN
            FROM JSON_TABLE(v_body, '$.ccy_rows[*]' COLUMNS (
                CURRENCY_CODE  VARCHAR2(10)  PATH '$.currency_code',
                ENT_CLOSING    NUMBER        PATH '$.ent_closing',
                ACCT_CLOSING   NUMBER        PATH '$.acct_closing',
                BOOK_RATE      NUMBER        PATH '$.book_rate',
                NEW_RATE       NUMBER        PATH '$.new_rate',
                NEW_ACCT_VALUE NUMBER        PATH '$.new_acct_value',
                REVAL_AMT      NUMBER        PATH '$.reval_amt',
                IS_GAIN        NUMBER        PATH '$.is_gain'
            )) j;

            INSERT INTO RR_REVALUE_LINES (
                REVALUE_ID, LINE_NUM, COMBO,
                DESCRIPTION, COMMENT_TEXT, DR_AMOUNT, CR_AMOUNT
            )
            SELECT
                v_id,
                j.LINE_NUM, j.COMBO, j.DESCRIPTION, j.COMMENT_TEXT,
                j.DR_AMOUNT, j.CR_AMOUNT
            FROM JSON_TABLE(v_body, '$.lines[*]' COLUMNS (
                LINE_NUM     NUMBER        PATH '$.line_num',
                COMBO        VARCHAR2(200) PATH '$.combo',
                DESCRIPTION  VARCHAR2(500) PATH '$.description',
                COMMENT_TEXT VARCHAR2(500) PATH '$.comment_text',
                DR_AMOUNT    NUMBER        PATH '$.dr_amount',
                CR_AMOUNT    NUMBER        PATH '$.cr_amount'
            )) j;
        END IF;
    END IF;

    COMMIT;

    IF v_rows = 0 THEN
        :status_code := 404;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('error', 'Revaluation not found');
        APEX_JSON.CLOSE_OBJECT;
    ELSE
        :status_code := 200;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',    'SUCCESS');
        APEX_JSON.WRITE('revalueId', v_id);
        APEX_JSON.CLOSE_OBJECT;
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status', 'ERROR');
        APEX_JSON.WRITE('error',  SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT gl/revaluation/:id handler updated for full body update');
END;
/
