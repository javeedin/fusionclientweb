-- ============================================================
-- FX Revaluation Tables + ORDS REST Handlers
--
-- Module: reerp
-- Endpoints:
--   GET    reerp/gl/revaluation       → list all revaluation headers
--   GET    reerp/gl/revaluation/:id   → get single revaluation with CCY rows and lines
--   POST   reerp/gl/revaluation       → create new revaluation
--   PUT    reerp/gl/revaluation/:id   → update status / GL_BATCH_ID
--   DELETE reerp/gl/revaluation/:id   → delete revaluation (cascades)
-- ============================================================


-- ── 1. Create Tables ──────────────────────────────────────────────────────────

CREATE TABLE RR_REVALUE_HEADER (
  REVALUE_ID     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  LEDGER_ID      NUMBER,
  PERIOD_NAME    VARCHAR2(100),
  ACCOUNT        VARCHAR2(100),
  ACCOUNT_DESC   VARCHAR2(500),
  FUNCTIONAL_CCY VARCHAR2(10),
  GAIN_ACCOUNT   VARCHAR2(200),
  LOSS_ACCOUNT   VARCHAR2(200),
  TOTAL_GAIN     NUMBER DEFAULT 0,
  TOTAL_LOSS     NUMBER DEFAULT 0,
  STATUS         VARCHAR2(20) DEFAULT 'DRAFT',
  GL_BATCH_ID    NUMBER,
  NOTES          VARCHAR2(1000),
  CREATED_DATE   DATE DEFAULT SYSDATE,
  CREATED_BY     VARCHAR2(200)
);

CREATE TABLE RR_REVALUE_CCY (
  CCY_ID         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  REVALUE_ID     NUMBER NOT NULL REFERENCES RR_REVALUE_HEADER(REVALUE_ID) ON DELETE CASCADE,
  CURRENCY_CODE  VARCHAR2(10),
  ENT_CLOSING    NUMBER,
  ACCT_CLOSING   NUMBER,
  BOOK_RATE      NUMBER,
  NEW_RATE       NUMBER,
  NEW_ACCT_VALUE NUMBER,
  REVAL_AMT      NUMBER,
  IS_GAIN        NUMBER(1)
);

CREATE TABLE RR_REVALUE_LINES (
  LINE_ID        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  REVALUE_ID     NUMBER NOT NULL REFERENCES RR_REVALUE_HEADER(REVALUE_ID) ON DELETE CASCADE,
  LINE_NUM       NUMBER,
  COMBO          VARCHAR2(200),
  DESCRIPTION    VARCHAR2(500),
  COMMENT_TEXT   VARCHAR2(500),
  DR_AMOUNT      NUMBER DEFAULT 0,
  CR_AMOUNT      NUMBER DEFAULT 0
);


-- ── 2. ORDS Template: gl/revaluation ────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/revaluation'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/


-- ── 3. GET reerp/gl/revaluation ─────────────────────────────────────────────
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
               h.NOTES,
               TO_CHAR(h.CREATED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_DATE,
               h.CREATED_BY,
               (SELECT COUNT(*) FROM RR_REVALUE_LINES l WHERE l.REVALUE_ID = h.REVALUE_ID) AS LINE_COUNT
        FROM   RR_REVALUE_HEADER h
        ORDER  BY h.CREATED_DATE DESC
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('revalueId',     rec.REVALUE_ID);
        APEX_JSON.WRITE('ledgerId',      rec.LEDGER_ID);
        APEX_JSON.WRITE('periodName',    rec.PERIOD_NAME);
        APEX_JSON.WRITE('account',       rec.ACCOUNT);
        APEX_JSON.WRITE('accountDesc',   rec.ACCOUNT_DESC);
        APEX_JSON.WRITE('functionalCcy', rec.FUNCTIONAL_CCY);
        APEX_JSON.WRITE('gainAccount',   rec.GAIN_ACCOUNT);
        APEX_JSON.WRITE('lossAccount',   rec.LOSS_ACCOUNT);
        APEX_JSON.WRITE('totalGain',     rec.TOTAL_GAIN);
        APEX_JSON.WRITE('totalLoss',     rec.TOTAL_LOSS);
        APEX_JSON.WRITE('status',        rec.STATUS);
        APEX_JSON.WRITE('glBatchId',     rec.GL_BATCH_ID);
        APEX_JSON.WRITE('notes',         rec.NOTES);
        APEX_JSON.WRITE('createdDate',   rec.CREATED_DATE);
        APEX_JSON.WRITE('createdBy',     rec.CREATED_BY);
        APEX_JSON.WRITE('lineCount',     rec.LINE_COUNT);
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


-- ── 4. POST reerp/gl/revaluation ────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Create new FX Revaluation (header + CCY rows + lines)',
        p_source         => q'[
DECLARE
    v_body      CLOB;
    v_id        NUMBER;
    v_ledger_id NUMBER;
    v_period    VARCHAR2(100);
    v_account   VARCHAR2(100);
    v_acct_desc VARCHAR2(500);
    v_func_ccy  VARCHAR2(10);
    v_gain_acct VARCHAR2(200);
    v_loss_acct VARCHAR2(200);
    v_t_gain    NUMBER := 0;
    v_t_loss    NUMBER := 0;
    v_notes     VARCHAR2(1000);
    v_created_by VARCHAR2(200);
BEGIN
    v_body := :body_text;

    -- Parse header fields
    SELECT
        JSON_VALUE(v_body, '$.ledger_id'      RETURNING NUMBER),
        JSON_VALUE(v_body, '$.period_name'),
        JSON_VALUE(v_body, '$.account'),
        JSON_VALUE(v_body, '$.account_desc'),
        JSON_VALUE(v_body, '$.functional_ccy'),
        JSON_VALUE(v_body, '$.gain_account'),
        JSON_VALUE(v_body, '$.loss_account'),
        JSON_VALUE(v_body, '$.total_gain'      RETURNING NUMBER),
        JSON_VALUE(v_body, '$.total_loss'      RETURNING NUMBER),
        JSON_VALUE(v_body, '$.notes'),
        JSON_VALUE(v_body, '$.created_by')
    INTO v_ledger_id, v_period, v_account, v_acct_desc, v_func_ccy,
         v_gain_acct, v_loss_acct, v_t_gain, v_t_loss, v_notes, v_created_by
    FROM DUAL;

    -- Insert header
    INSERT INTO RR_REVALUE_HEADER (
        LEDGER_ID, PERIOD_NAME, ACCOUNT, ACCOUNT_DESC, FUNCTIONAL_CCY,
        GAIN_ACCOUNT, LOSS_ACCOUNT, TOTAL_GAIN, TOTAL_LOSS,
        NOTES, CREATED_BY
    ) VALUES (
        v_ledger_id, v_period, v_account, v_acct_desc, v_func_ccy,
        v_gain_acct, v_loss_acct, NVL(v_t_gain, 0), NVL(v_t_loss, 0),
        v_notes, v_created_by
    ) RETURNING REVALUE_ID INTO v_id;

    -- Insert CCY rows
    FOR rec IN (
        SELECT jt.*
        FROM JSON_TABLE(v_body, '$.ccy_rows[*]' COLUMNS (
            CURRENCY_CODE  VARCHAR2(10)  PATH '$.currency_code',
            ENT_CLOSING    NUMBER        PATH '$.ent_closing',
            ACCT_CLOSING   NUMBER        PATH '$.acct_closing',
            BOOK_RATE      NUMBER        PATH '$.book_rate',
            NEW_RATE       NUMBER        PATH '$.new_rate',
            NEW_ACCT_VALUE NUMBER        PATH '$.new_acct_value',
            REVAL_AMT      NUMBER        PATH '$.reval_amt',
            IS_GAIN        NUMBER        PATH '$.is_gain'
        )) jt
    ) LOOP
        INSERT INTO RR_REVALUE_CCY (
            REVALUE_ID, CURRENCY_CODE, ENT_CLOSING, ACCT_CLOSING,
            BOOK_RATE, NEW_RATE, NEW_ACCT_VALUE, REVAL_AMT, IS_GAIN
        ) VALUES (
            v_id, rec.CURRENCY_CODE, rec.ENT_CLOSING, rec.ACCT_CLOSING,
            rec.BOOK_RATE, rec.NEW_RATE, rec.NEW_ACCT_VALUE, rec.REVAL_AMT, rec.IS_GAIN
        );
    END LOOP;

    -- Insert journal lines
    FOR rec IN (
        SELECT jt.*
        FROM JSON_TABLE(v_body, '$.lines[*]' COLUMNS (
            LINE_NUM     NUMBER        PATH '$.line_num',
            COMBO        VARCHAR2(200) PATH '$.combo',
            DESCRIPTION  VARCHAR2(500) PATH '$.description',
            COMMENT_TEXT VARCHAR2(500) PATH '$.comment_text',
            DR_AMOUNT    NUMBER        PATH '$.dr_amount',
            CR_AMOUNT    NUMBER        PATH '$.cr_amount'
        )) jt
    ) LOOP
        INSERT INTO RR_REVALUE_LINES (
            REVALUE_ID, LINE_NUM, COMBO, DESCRIPTION, COMMENT_TEXT, DR_AMOUNT, CR_AMOUNT
        ) VALUES (
            v_id, rec.LINE_NUM, rec.COMBO, rec.DESCRIPTION, rec.COMMENT_TEXT,
            NVL(rec.DR_AMOUNT, 0), NVL(rec.CR_AMOUNT, 0)
        );
    END LOOP;

    COMMIT;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status',    'SUCCESS');
    APEX_JSON.WRITE('revalueId', v_id);
    APEX_JSON.CLOSE_OBJECT;

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


-- ── 5. ORDS Template: gl/revaluation/:id ────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/revaluation/:id'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    COMMIT;
END;
/


-- ── 6. GET reerp/gl/revaluation/:id ─────────────────────────────────────────
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
    v_id NUMBER := TO_NUMBER(:id);
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

    -- Header
    FOR h IN (
        SELECT REVALUE_ID, LEDGER_ID, PERIOD_NAME, ACCOUNT, ACCOUNT_DESC,
               FUNCTIONAL_CCY, GAIN_ACCOUNT, LOSS_ACCOUNT, TOTAL_GAIN, TOTAL_LOSS,
               STATUS, GL_BATCH_ID, NOTES,
               TO_CHAR(CREATED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_DATE,
               CREATED_BY
        FROM   RR_REVALUE_HEADER
        WHERE  REVALUE_ID = v_id
    ) LOOP
        APEX_JSON.WRITE('revalueId',     h.REVALUE_ID);
        APEX_JSON.WRITE('ledgerId',      h.LEDGER_ID);
        APEX_JSON.WRITE('periodName',    h.PERIOD_NAME);
        APEX_JSON.WRITE('account',       h.ACCOUNT);
        APEX_JSON.WRITE('accountDesc',   h.ACCOUNT_DESC);
        APEX_JSON.WRITE('functionalCcy', h.FUNCTIONAL_CCY);
        APEX_JSON.WRITE('gainAccount',   h.GAIN_ACCOUNT);
        APEX_JSON.WRITE('lossAccount',   h.LOSS_ACCOUNT);
        APEX_JSON.WRITE('totalGain',     h.TOTAL_GAIN);
        APEX_JSON.WRITE('totalLoss',     h.TOTAL_LOSS);
        APEX_JSON.WRITE('status',        h.STATUS);
        APEX_JSON.WRITE('glBatchId',     h.GL_BATCH_ID);
        APEX_JSON.WRITE('notes',         h.NOTES);
        APEX_JSON.WRITE('createdDate',   h.CREATED_DATE);
        APEX_JSON.WRITE('createdBy',     h.CREATED_BY);
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
END;
/


-- ── 7. PUT reerp/gl/revaluation/:id ─────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Update FX Revaluation STATUS and GL_BATCH_ID',
        p_source         => q'[
DECLARE
    v_id         NUMBER := TO_NUMBER(:id);
    v_body       CLOB;
    v_status     VARCHAR2(20);
    v_batch_id   NUMBER;
    v_rows       NUMBER;
BEGIN
    v_body := :body_text;

    SELECT
        JSON_VALUE(v_body, '$.status'),
        JSON_VALUE(v_body, '$.gl_batch_id' RETURNING NUMBER)
    INTO v_status, v_batch_id
    FROM DUAL;

    UPDATE RR_REVALUE_HEADER
    SET    STATUS      = NVL(v_status, STATUS),
           GL_BATCH_ID = NVL(v_batch_id, GL_BATCH_ID)
    WHERE  REVALUE_ID  = v_id;

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


-- ── 8. DELETE reerp/gl/revaluation/:id ──────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Delete FX Revaluation header (cascades to CCY rows and lines)',
        p_source         => q'[
DECLARE
    v_id   NUMBER := TO_NUMBER(:id);
    v_rows NUMBER;
BEGIN
    DELETE FROM RR_REVALUE_HEADER WHERE REVALUE_ID = v_id;
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
    DBMS_OUTPUT.PUT_LINE('FX Revaluation handlers registered successfully');
END;
/
