-- ============================================================
-- FX Revaluation Package + Updated ORDS Handlers
--
-- 1. ALTER TABLE  – add LEDGER_NAME, GL_BATCH_NAME, GL_HEADER_ID
-- 2. Package spec  RR_REVALUE_PKG
-- 3. Package body  RR_REVALUE_PKG
-- 4. Updated POST handler  – calls RR_REVALUE_PKG.create_revaluation
-- 5. Updated PUT  handler  – persists GL_BATCH_NAME + GL_HEADER_ID
-- 6. Updated GET (list)    – returns new columns
-- 7. Updated GET (by id)   – returns new columns
-- ============================================================


-- ── 1. Add missing columns to RR_REVALUE_HEADER ─────────────────────────────
ALTER TABLE RR_REVALUE_HEADER ADD (
    LEDGER_NAME    VARCHAR2(240),
    GL_BATCH_NAME  VARCHAR2(240),
    GL_HEADER_ID   NUMBER
);
/


-- ── 2. Package Spec ──────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_REVALUE_PKG AS

    -- Create a full revaluation (header + CCY rows + lines) from a JSON body.
    -- Returns the new REVALUE_ID via p_revalue_id.
    -- Raises application_error on validation failure.
    PROCEDURE create_revaluation (
        p_body       IN  CLOB,
        p_revalue_id OUT NUMBER
    );

END RR_REVALUE_PKG;
/


-- ── 3. Package Body ──────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE BODY RR_REVALUE_PKG AS

    -- ── Private helper: assert a required VARCHAR value is not null ──────────
    PROCEDURE assert_required (p_val VARCHAR2, p_name VARCHAR2) IS
    BEGIN
        IF p_val IS NULL OR TRIM(p_val) IS NULL THEN
            RAISE_APPLICATION_ERROR(-20101, 'Required field missing: ' || p_name);
        END IF;
    END assert_required;


    -- ── create_revaluation ───────────────────────────────────────────────────
    PROCEDURE create_revaluation (
        p_body       IN  CLOB,
        p_revalue_id OUT NUMBER
    ) IS
        v_ledger_id    NUMBER;
        v_ledger_name  VARCHAR2(240);
        v_period       VARCHAR2(100);
        v_account      VARCHAR2(100);
        v_acct_desc    VARCHAR2(500);
        v_func_ccy     VARCHAR2(10);
        v_gain_acct    VARCHAR2(200);
        v_loss_acct    VARCHAR2(200);
        v_t_gain       NUMBER := 0;
        v_t_loss       NUMBER := 0;
        v_notes        VARCHAR2(1000);
        v_created_by   VARCHAR2(200);
        v_new_id       NUMBER;
        v_line_count   NUMBER := 0;
    BEGIN
        -- ── Parse header fields ──────────────────────────────────────────────
        SELECT
            JSON_VALUE(p_body, '$.ledger_id'      RETURNING NUMBER),
            JSON_VALUE(p_body, '$.ledger_name'),
            JSON_VALUE(p_body, '$.period_name'),
            JSON_VALUE(p_body, '$.account'),
            JSON_VALUE(p_body, '$.account_desc'),
            JSON_VALUE(p_body, '$.functional_ccy'),
            JSON_VALUE(p_body, '$.gain_account'),
            JSON_VALUE(p_body, '$.loss_account'),
            JSON_VALUE(p_body, '$.total_gain'      RETURNING NUMBER),
            JSON_VALUE(p_body, '$.total_loss'      RETURNING NUMBER),
            JSON_VALUE(p_body, '$.notes'),
            JSON_VALUE(p_body, '$.created_by')
        INTO
            v_ledger_id, v_ledger_name, v_period, v_account, v_acct_desc,
            v_func_ccy, v_gain_acct, v_loss_acct, v_t_gain, v_t_loss,
            v_notes, v_created_by
        FROM DUAL;

        -- ── Validate required fields ─────────────────────────────────────────
        assert_required(v_period,    'period_name');
        assert_required(v_account,   'account');
        assert_required(v_func_ccy,  'functional_ccy');
        assert_required(v_gain_acct, 'gain_account');
        assert_required(v_loss_acct, 'loss_account');

        -- ── Validate that at least one journal line exists ───────────────────
        SELECT COUNT(*)
        INTO   v_line_count
        FROM   JSON_TABLE(p_body, '$.lines[*]' COLUMNS (rn FOR ORDINALITY));

        IF NVL(v_line_count, 0) = 0 THEN
            RAISE_APPLICATION_ERROR(-20102, 'At least one journal line is required');
        END IF;

        -- ── Insert header ────────────────────────────────────────────────────
        INSERT INTO RR_REVALUE_HEADER (
            LEDGER_ID, LEDGER_NAME, PERIOD_NAME, ACCOUNT, ACCOUNT_DESC,
            FUNCTIONAL_CCY, GAIN_ACCOUNT, LOSS_ACCOUNT,
            TOTAL_GAIN, TOTAL_LOSS, NOTES, CREATED_BY
        ) VALUES (
            v_ledger_id,   v_ledger_name,  v_period, v_account, v_acct_desc,
            v_func_ccy,    v_gain_acct,    v_loss_acct,
            NVL(v_t_gain, 0), NVL(v_t_loss, 0), v_notes, v_created_by
        )
        RETURNING REVALUE_ID INTO v_new_id;

        -- ── Insert CCY rows ──────────────────────────────────────────────────
        INSERT INTO RR_REVALUE_CCY (
            REVALUE_ID, CURRENCY_CODE, ENT_CLOSING, ACCT_CLOSING,
            BOOK_RATE, NEW_RATE, NEW_ACCT_VALUE, REVAL_AMT, IS_GAIN
        )
        SELECT
            v_new_id,
            jt.CURRENCY_CODE,
            jt.ENT_CLOSING,
            jt.ACCT_CLOSING,
            jt.BOOK_RATE,
            jt.NEW_RATE,
            jt.NEW_ACCT_VALUE,
            jt.REVAL_AMT,
            jt.IS_GAIN
        FROM JSON_TABLE(p_body, '$.ccy_rows[*]' COLUMNS (
            CURRENCY_CODE  VARCHAR2(10)  PATH '$.currency_code',
            ENT_CLOSING    NUMBER        PATH '$.ent_closing',
            ACCT_CLOSING   NUMBER        PATH '$.acct_closing',
            BOOK_RATE      NUMBER        PATH '$.book_rate',
            NEW_RATE       NUMBER        PATH '$.new_rate',
            NEW_ACCT_VALUE NUMBER        PATH '$.new_acct_value',
            REVAL_AMT      NUMBER        PATH '$.reval_amt',
            IS_GAIN        NUMBER        PATH '$.is_gain'
        )) jt;

        -- ── Insert journal lines ─────────────────────────────────────────────
        INSERT INTO RR_REVALUE_LINES (
            REVALUE_ID, LINE_NUM, COMBO, DESCRIPTION, COMMENT_TEXT,
            DR_AMOUNT, CR_AMOUNT
        )
        SELECT
            v_new_id,
            jt.LINE_NUM,
            jt.COMBO,
            jt.DESCRIPTION,
            jt.COMMENT_TEXT,
            NVL(jt.DR_AMOUNT, 0),
            NVL(jt.CR_AMOUNT, 0)
        FROM JSON_TABLE(p_body, '$.lines[*]' COLUMNS (
            LINE_NUM     NUMBER        PATH '$.line_num',
            COMBO        VARCHAR2(200) PATH '$.combo',
            DESCRIPTION  VARCHAR2(500) PATH '$.description',
            COMMENT_TEXT VARCHAR2(500) PATH '$.comment_text',
            DR_AMOUNT    NUMBER        PATH '$.dr_amount',
            CR_AMOUNT    NUMBER        PATH '$.cr_amount'
        )) jt;

        COMMIT;
        p_revalue_id := v_new_id;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE;
    END create_revaluation;

END RR_REVALUE_PKG;
/


-- ── 4. POST reerp/gl/revaluation – call the package ─────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Create new FX Revaluation via RR_REVALUE_PKG.create_revaluation',
        p_source         => q'[
DECLARE
    v_id   NUMBER;
BEGIN
    RR_REVALUE_PKG.create_revaluation(
        p_body       => :body_text,
        p_revalue_id => v_id
    );

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',    'SUCCESS');
    APEX_JSON.WRITE('revalueId', v_id);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status', 'ERROR');
        APEX_JSON.WRITE('error',  SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ── 5. PUT reerp/gl/revaluation/:id – persist batch name + header id ────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Update FX Revaluation status, GL batch ID/name, GL header ID',
        p_source         => q'[
DECLARE
    v_id           NUMBER := TO_NUMBER(:id);
    v_body         CLOB;
    v_status       VARCHAR2(20);
    v_batch_id     NUMBER;
    v_batch_name   VARCHAR2(240);
    v_header_id    NUMBER;
    v_rows         NUMBER;
BEGIN
    v_body := :body_text;

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
END;
/


-- ── 6. GET reerp/gl/revaluation – list with new columns ─────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'List all FX Revaluation headers with line count',
        p_source         => q'[
DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM RR_REVALUE_HEADER;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('totalCount', v_count);
    APEX_JSON.OPEN_ARRAY('items');

    FOR rec IN (
        SELECT h.REVALUE_ID,
               h.LEDGER_ID,
               h.LEDGER_NAME,
               h.PERIOD_NAME,
               h.ACCOUNT,
               h.ACCOUNT_DESC,
               h.FUNCTIONAL_CCY,
               h.GAIN_ACCOUNT,
               h.LOSS_ACCOUNT,
               h.TOTAL_GAIN,
               h.TOTAL_LOSS,
               h.STATUS,
               h.GL_BATCH_ID,
               h.GL_BATCH_NAME,
               h.GL_HEADER_ID,
               h.NOTES,
               TO_CHAR(h.CREATED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_DATE,
               h.CREATED_BY,
               (SELECT COUNT(*) FROM RR_REVALUE_LINES l WHERE l.REVALUE_ID = h.REVALUE_ID) AS LINE_COUNT
        FROM   RR_REVALUE_HEADER h
        ORDER  BY h.CREATED_DATE DESC
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('revalueId',    rec.REVALUE_ID);
        APEX_JSON.WRITE('ledgerId',     rec.LEDGER_ID);
        APEX_JSON.WRITE('ledgerName',   rec.LEDGER_NAME);
        APEX_JSON.WRITE('periodName',   rec.PERIOD_NAME);
        APEX_JSON.WRITE('account',      rec.ACCOUNT);
        APEX_JSON.WRITE('accountDesc',  rec.ACCOUNT_DESC);
        APEX_JSON.WRITE('functionalCcy',rec.FUNCTIONAL_CCY);
        APEX_JSON.WRITE('gainAccount',  rec.GAIN_ACCOUNT);
        APEX_JSON.WRITE('lossAccount',  rec.LOSS_ACCOUNT);
        APEX_JSON.WRITE('totalGain',    rec.TOTAL_GAIN);
        APEX_JSON.WRITE('totalLoss',    rec.TOTAL_LOSS);
        APEX_JSON.WRITE('status',       rec.STATUS);
        APEX_JSON.WRITE('glBatchId',    rec.GL_BATCH_ID);
        APEX_JSON.WRITE('glBatchName',  rec.GL_BATCH_NAME);
        APEX_JSON.WRITE('glHeaderId',   rec.GL_HEADER_ID);
        APEX_JSON.WRITE('notes',        rec.NOTES);
        APEX_JSON.WRITE('createdDate',  rec.CREATED_DATE);
        APEX_JSON.WRITE('createdBy',    rec.CREATED_BY);
        APEX_JSON.WRITE('lineCount',    rec.LINE_COUNT);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ── 7. GET reerp/gl/revaluation/:id – detail with new columns ───────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Get single FX Revaluation with CCY rows and journal lines',
        p_source         => q'[
DECLARE
    v_id    NUMBER := TO_NUMBER(:id);
    v_found NUMBER := 0;
BEGIN
    SELECT COUNT(*) INTO v_found FROM RR_REVALUE_HEADER WHERE REVALUE_ID = v_id;
    IF v_found = 0 THEN
        :status_code := 404;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('error', 'Revaluation not found');
        APEX_JSON.CLOSE_OBJECT;
        RETURN;
    END IF;

    APEX_JSON.OPEN_OBJECT;

    FOR h IN (
        SELECT REVALUE_ID, LEDGER_ID, LEDGER_NAME, PERIOD_NAME, ACCOUNT, ACCOUNT_DESC,
               FUNCTIONAL_CCY, GAIN_ACCOUNT, LOSS_ACCOUNT, TOTAL_GAIN, TOTAL_LOSS,
               STATUS, GL_BATCH_ID, GL_BATCH_NAME, GL_HEADER_ID, NOTES,
               TO_CHAR(CREATED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_DATE,
               CREATED_BY
        FROM   RR_REVALUE_HEADER
        WHERE  REVALUE_ID = v_id
    ) LOOP
        APEX_JSON.WRITE('revalueId',    h.REVALUE_ID);
        APEX_JSON.WRITE('ledgerId',     h.LEDGER_ID);
        APEX_JSON.WRITE('ledgerName',   h.LEDGER_NAME);
        APEX_JSON.WRITE('periodName',   h.PERIOD_NAME);
        APEX_JSON.WRITE('account',      h.ACCOUNT);
        APEX_JSON.WRITE('accountDesc',  h.ACCOUNT_DESC);
        APEX_JSON.WRITE('functionalCcy',h.FUNCTIONAL_CCY);
        APEX_JSON.WRITE('gainAccount',  h.GAIN_ACCOUNT);
        APEX_JSON.WRITE('lossAccount',  h.LOSS_ACCOUNT);
        APEX_JSON.WRITE('totalGain',    h.TOTAL_GAIN);
        APEX_JSON.WRITE('totalLoss',    h.TOTAL_LOSS);
        APEX_JSON.WRITE('status',       h.STATUS);
        APEX_JSON.WRITE('glBatchId',    h.GL_BATCH_ID);
        APEX_JSON.WRITE('glBatchName',  h.GL_BATCH_NAME);
        APEX_JSON.WRITE('glHeaderId',   h.GL_HEADER_ID);
        APEX_JSON.WRITE('notes',        h.NOTES);
        APEX_JSON.WRITE('createdDate',  h.CREATED_DATE);
        APEX_JSON.WRITE('createdBy',    h.CREATED_BY);
    END LOOP;

    -- CCY rows
    APEX_JSON.OPEN_ARRAY('ccyRows');
    FOR c IN (
        SELECT CCY_ID, CURRENCY_CODE, ENT_CLOSING, ACCT_CLOSING,
               BOOK_RATE, NEW_RATE, NEW_ACCT_VALUE, REVAL_AMT, IS_GAIN
        FROM   RR_REVALUE_CCY
        WHERE  REVALUE_ID = v_id
        ORDER  BY CCY_ID
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('ccyId',        c.CCY_ID);
        APEX_JSON.WRITE('currencyCode', c.CURRENCY_CODE);
        APEX_JSON.WRITE('entClosing',   c.ENT_CLOSING);
        APEX_JSON.WRITE('acctClosing',  c.ACCT_CLOSING);
        APEX_JSON.WRITE('bookRate',     c.BOOK_RATE);
        APEX_JSON.WRITE('newRate',      c.NEW_RATE);
        APEX_JSON.WRITE('newAcctValue', c.NEW_ACCT_VALUE);
        APEX_JSON.WRITE('revalAmt',     c.REVAL_AMT);
        APEX_JSON.WRITE('isGain',       c.IS_GAIN);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    -- Journal lines
    APEX_JSON.OPEN_ARRAY('lines');
    FOR l IN (
        SELECT LINE_ID, LINE_NUM, COMBO, DESCRIPTION, COMMENT_TEXT, DR_AMOUNT, CR_AMOUNT
        FROM   RR_REVALUE_LINES
        WHERE  REVALUE_ID = v_id
        ORDER  BY LINE_NUM
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('lineId',      l.LINE_ID);
        APEX_JSON.WRITE('lineNum',     l.LINE_NUM);
        APEX_JSON.WRITE('combo',       l.COMBO);
        APEX_JSON.WRITE('description', l.DESCRIPTION);
        APEX_JSON.WRITE('commentText', l.COMMENT_TEXT);
        APEX_JSON.WRITE('drAmount',    l.DR_AMOUNT);
        APEX_JSON.WRITE('crAmount',    l.CR_AMOUNT);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;

    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('RR_REVALUE_PKG and all handlers updated successfully');
END;
/
