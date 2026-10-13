-- ============================================================
-- FX Revaluation: store the currency of every revaluation line
--
-- Root cause of "only the first two lines reached the GL":
--   The Trial Balance writes one Dr/Cr pair per account combination × currency
--   (an account with three INR combinations = three INR pairs), but the lines
--   carried no currency. The accounting flow therefore paired currency #k with
--   lines 2k and 2k+1 — only the first combination of each currency was posted
--   and the rest were silently dropped, and with several currencies a pair could
--   land in the wrong currency's journal at the wrong rate.
--
--   The app now posts every line in its currency's journal, refuses lines it
--   cannot place, posts only what the GL is missing and reads the GL back before
--   marking ACCOUNTED (src/services/revaluationPosting.service.ts). This script
--   makes the line currency explicit so multi-currency revaluations never depend
--   on guessing it from the description.
--
-- Steps:
--   1. ALTER TABLE  – RR_REVALUE_LINES.CURRENCY_CODE (re-runnable)
--   2. Backfill     – single-currency revaluations: that currency;
--                     multi-currency: the currency in the pair's gain/loss
--                     description ("Unrealized FX Gain - INR (Sep-26)")
--   3. Package body – create_revaluation saves lines[].currency_code
--   4. PUT handler  – full update saves lines[].currency_code
--   5. GET detail   – lines return currencyCode
--   6. Report       – accounted revaluations whose lines are not all in the GL
--                     (fix them from Manage FX Revaluation → View Accounting →
--                     Post missing lines)
--
-- Run after 49 (base currency). Re-runnable. Run in APEX SQL Workshop.
-- ============================================================


-- ── 1. Add column ────────────────────────────────────────────────────────────
DECLARE
    e_exists EXCEPTION;
    PRAGMA EXCEPTION_INIT(e_exists, -1430);   -- column being added already exists
BEGIN
    EXECUTE IMMEDIATE 'ALTER TABLE RR_REVALUE_LINES ADD CURRENCY_CODE VARCHAR2(15)';
EXCEPTION
    WHEN e_exists THEN NULL;
END;
/


-- ── 2. Backfill existing rows ────────────────────────────────────────────────
-- 2a. revaluations with a single currency: every line is in it
UPDATE RR_REVALUE_LINES l
SET    l.CURRENCY_CODE = (SELECT MAX(UPPER(c.CURRENCY_CODE)) FROM RR_REVALUE_CCY c
                          WHERE c.REVALUE_ID = l.REVALUE_ID AND c.CURRENCY_CODE IS NOT NULL)
WHERE  l.CURRENCY_CODE IS NULL
AND    (SELECT COUNT(DISTINCT UPPER(c.CURRENCY_CODE)) FROM RR_REVALUE_CCY c
        WHERE c.REVALUE_ID = l.REVALUE_ID AND c.CURRENCY_CODE IS NOT NULL) = 1;

-- 2b. several currencies: lines are written in Dr/Cr pairs (1-2, 3-4, …) and the
--     gain/loss line of each pair names its currency — give it to both lines
MERGE INTO RR_REVALUE_LINES t
USING (
    SELECT p.LINE_ID, p.PAIR_CCY
    FROM (
        SELECT q.LINE_ID, q.REVALUE_ID,
               MAX(q.DESC_CCY) OVER (PARTITION BY q.REVALUE_ID, q.PAIR_NO) AS PAIR_CCY
        FROM (
            SELECT x.LINE_ID, x.REVALUE_ID,
                   CEIL(ROW_NUMBER() OVER (PARTITION BY x.REVALUE_ID ORDER BY x.LINE_NUM, x.LINE_ID) / 2) AS PAIR_NO,
                   UPPER(REGEXP_SUBSTR(x.DESCRIPTION,
                         'FX[[:space:]]+(Gain|Loss)[^A-Za-z]{1,5}([A-Za-z]{3})', 1, 1, 'i', 2)) AS DESC_CCY
            FROM   RR_REVALUE_LINES x
            WHERE  NVL(x.DR_AMOUNT, 0) <> 0 OR NVL(x.CR_AMOUNT, 0) <> 0
        ) q
    ) p
    WHERE p.PAIR_CCY IS NOT NULL
    AND   EXISTS (SELECT 1 FROM RR_REVALUE_CCY c
                  WHERE c.REVALUE_ID = p.REVALUE_ID AND UPPER(c.CURRENCY_CODE) = p.PAIR_CCY)
) s
ON (t.LINE_ID = s.LINE_ID)
WHEN MATCHED THEN UPDATE SET t.CURRENCY_CODE = s.PAIR_CCY WHERE t.CURRENCY_CODE IS NULL;

COMMIT;


-- ── 3. Package body — save lines[].currency_code on POST ─────────────────────
CREATE OR REPLACE PACKAGE BODY RR_REVALUE_PKG AS

    PROCEDURE assert_required (p_val VARCHAR2, p_name VARCHAR2) IS
    BEGIN
        IF p_val IS NULL OR TRIM(p_val) IS NULL THEN
            RAISE_APPLICATION_ERROR(-20101, 'Required field missing: ' || p_name);
        END IF;
    END assert_required;

    PROCEDURE create_revaluation (
        p_body       IN  CLOB,
        p_revalue_id OUT NUMBER
    ) IS
        v_ledger_id    NUMBER;
        v_ledger_name  VARCHAR2(240);
        v_period       VARCHAR2(100);
        v_account      VARCHAR2(100);
        v_acct_desc    VARCHAR2(500);
        v_func_ccy     VARCHAR2(15);
        v_base_ccy     VARCHAR2(15);
        v_gain_acct    VARCHAR2(200);
        v_loss_acct    VARCHAR2(200);
        v_t_gain       NUMBER := 0;
        v_t_loss       NUMBER := 0;
        v_notes        VARCHAR2(1000);
        v_created_by   VARCHAR2(200);
        v_new_id       NUMBER;
        v_line_count   NUMBER := 0;
    BEGIN
        SELECT
            JSON_VALUE(p_body, '$.ledger_id'      RETURNING NUMBER),
            JSON_VALUE(p_body, '$.ledger_name'),
            JSON_VALUE(p_body, '$.period_name'),
            JSON_VALUE(p_body, '$.account'),
            JSON_VALUE(p_body, '$.account_desc'),
            JSON_VALUE(p_body, '$.functional_ccy'),
            JSON_VALUE(p_body, '$.base_currency'),
            JSON_VALUE(p_body, '$.gain_account'),
            JSON_VALUE(p_body, '$.loss_account'),
            JSON_VALUE(p_body, '$.total_gain'     RETURNING NUMBER),
            JSON_VALUE(p_body, '$.total_loss'     RETURNING NUMBER),
            JSON_VALUE(p_body, '$.notes'),
            JSON_VALUE(p_body, '$.created_by')
        INTO
            v_ledger_id, v_ledger_name, v_period, v_account, v_acct_desc,
            v_func_ccy, v_base_ccy, v_gain_acct, v_loss_acct,
            v_t_gain, v_t_loss, v_notes, v_created_by
        FROM DUAL;

        -- If base_currency not sent, fall back to functional_ccy
        v_base_ccy := NVL(v_base_ccy, v_func_ccy);

        assert_required(v_period,    'period_name');
        assert_required(v_account,   'account');
        assert_required(v_func_ccy,  'functional_ccy');
        assert_required(v_gain_acct, 'gain_account');
        assert_required(v_loss_acct, 'loss_account');

        SELECT COUNT(*)
        INTO   v_line_count
        FROM   JSON_TABLE(p_body, '$.lines[*]' COLUMNS (rn FOR ORDINALITY));

        IF NVL(v_line_count, 0) = 0 THEN
            RAISE_APPLICATION_ERROR(-20102, 'At least one journal line is required');
        END IF;

        INSERT INTO RR_REVALUE_HEADER (
            LEDGER_ID, LEDGER_NAME, PERIOD_NAME, ACCOUNT, ACCOUNT_DESC,
            FUNCTIONAL_CCY, BASE_CURRENCY,
            GAIN_ACCOUNT, LOSS_ACCOUNT,
            TOTAL_GAIN, TOTAL_LOSS, NOTES, CREATED_BY
        ) VALUES (
            v_ledger_id, v_ledger_name, v_period, v_account, v_acct_desc,
            v_func_ccy, v_base_ccy,
            v_gain_acct, v_loss_acct,
            NVL(v_t_gain, 0), NVL(v_t_loss, 0), v_notes, v_created_by
        )
        RETURNING REVALUE_ID INTO v_new_id;

        INSERT INTO RR_REVALUE_CCY (
            REVALUE_ID, CURRENCY_CODE, ENT_CLOSING, ACCT_CLOSING,
            BOOK_RATE, NEW_RATE, NEW_ACCT_VALUE, REVAL_AMT, IS_GAIN
        )
        SELECT
            v_new_id,
            jt.CURRENCY_CODE, jt.ENT_CLOSING, jt.ACCT_CLOSING,
            jt.BOOK_RATE, jt.NEW_RATE, jt.NEW_ACCT_VALUE, jt.REVAL_AMT, jt.IS_GAIN
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

        INSERT INTO RR_REVALUE_LINES (
            REVALUE_ID, LINE_NUM, COMBO, DESCRIPTION, COMMENT_TEXT,
            DR_AMOUNT, CR_AMOUNT, CURRENCY_CODE
        )
        SELECT
            v_new_id,
            jt.LINE_NUM, jt.COMBO, jt.DESCRIPTION, jt.COMMENT_TEXT,
            NVL(jt.DR_AMOUNT, 0), NVL(jt.CR_AMOUNT, 0), UPPER(jt.CURRENCY_CODE)
        FROM JSON_TABLE(p_body, '$.lines[*]' COLUMNS (
            LINE_NUM      NUMBER        PATH '$.line_num',
            COMBO         VARCHAR2(200) PATH '$.combo',
            DESCRIPTION   VARCHAR2(500) PATH '$.description',
            COMMENT_TEXT  VARCHAR2(500) PATH '$.comment_text',
            DR_AMOUNT     NUMBER        PATH '$.dr_amount',
            CR_AMOUNT     NUMBER        PATH '$.cr_amount',
            CURRENCY_CODE VARCHAR2(15)  PATH '$.currency_code'
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


-- ── 4. PUT handler — full + status-only; full update saves the line currency ──
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Full update of FX Revaluation header, CCY rows, and lines (incl. base_currency, line currency_code)',
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
    v_func_ccy     VARCHAR2(15);
    v_base_ccy     VARCHAR2(15);
    v_gain_acct    VARCHAR2(200);
    v_loss_acct    VARCHAR2(200);
    v_t_gain       NUMBER;
    v_t_loss       NUMBER;
    v_notes        VARCHAR2(1000);
BEGIN
    v_body := :body_text;

    -- Detect mode: presence of 'account' key means full update
    SELECT JSON_VALUE(v_body, '$.account') INTO v_account FROM DUAL;

    IF v_account IS NULL THEN
        -- ── Status-only update (Create Accounting flow) ──────────────────────
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
        -- ── Full update — replace header + CCY rows + lines ──────────────────
        SELECT
            JSON_VALUE(v_body, '$.ledger_id'      RETURNING NUMBER),
            JSON_VALUE(v_body, '$.ledger_name'),
            JSON_VALUE(v_body, '$.period_name'),
            JSON_VALUE(v_body, '$.account_desc'),
            JSON_VALUE(v_body, '$.functional_ccy'),
            JSON_VALUE(v_body, '$.base_currency'),
            JSON_VALUE(v_body, '$.gain_account'),
            JSON_VALUE(v_body, '$.loss_account'),
            JSON_VALUE(v_body, '$.total_gain'     RETURNING NUMBER),
            JSON_VALUE(v_body, '$.total_loss'     RETURNING NUMBER),
            JSON_VALUE(v_body, '$.notes')
        INTO
            v_ledger_id, v_ledger_name, v_period, v_acct_desc,
            v_func_ccy, v_base_ccy, v_gain_acct, v_loss_acct,
            v_t_gain, v_t_loss, v_notes
        FROM DUAL;

        -- If base_currency not sent, fall back to functional_ccy
        v_base_ccy := NVL(v_base_ccy, v_func_ccy);

        UPDATE RR_REVALUE_HEADER
        SET
            LEDGER_ID      = NVL(v_ledger_id,   LEDGER_ID),
            LEDGER_NAME    = NVL(v_ledger_name,  LEDGER_NAME),
            PERIOD_NAME    = NVL(v_period,       PERIOD_NAME),
            ACCOUNT_DESC   = NVL(v_acct_desc,    ACCOUNT_DESC),
            FUNCTIONAL_CCY = NVL(v_func_ccy,     FUNCTIONAL_CCY),
            BASE_CURRENCY  = NVL(v_base_ccy,     BASE_CURRENCY),
            GAIN_ACCOUNT   = NVL(v_gain_acct,    GAIN_ACCOUNT),
            LOSS_ACCOUNT   = NVL(v_loss_acct,    LOSS_ACCOUNT),
            TOTAL_GAIN     = NVL(v_t_gain,       TOTAL_GAIN),
            TOTAL_LOSS     = NVL(v_t_loss,       TOTAL_LOSS),
            NOTES          = v_notes
        WHERE REVALUE_ID = v_id;

        v_rows := SQL%ROWCOUNT;

        IF v_rows > 0 THEN
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
                DESCRIPTION, COMMENT_TEXT, DR_AMOUNT, CR_AMOUNT, CURRENCY_CODE
            )
            SELECT
                v_id,
                j.LINE_NUM, j.COMBO, j.DESCRIPTION, j.COMMENT_TEXT,
                j.DR_AMOUNT, j.CR_AMOUNT, UPPER(j.CURRENCY_CODE)
            FROM JSON_TABLE(v_body, '$.lines[*]' COLUMNS (
                LINE_NUM      NUMBER        PATH '$.line_num',
                COMBO         VARCHAR2(200) PATH '$.combo',
                DESCRIPTION   VARCHAR2(500) PATH '$.description',
                COMMENT_TEXT  VARCHAR2(500) PATH '$.comment_text',
                DR_AMOUNT     NUMBER        PATH '$.dr_amount',
                CR_AMOUNT     NUMBER        PATH '$.cr_amount',
                CURRENCY_CODE VARCHAR2(15)  PATH '$.currency_code'
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
    DBMS_OUTPUT.PUT_LINE('PUT gl/revaluation/:id handler updated (line currency_code)');
END;
/


-- ── 5. GET detail — lines return currencyCode ────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Get single FX Revaluation with CCY rows and lines (incl. base_currency, line currencyCode)',
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
               FUNCTIONAL_CCY, BASE_CURRENCY,
               GAIN_ACCOUNT, LOSS_ACCOUNT, TOTAL_GAIN, TOTAL_LOSS,
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
        APEX_JSON.WRITE('baseCurrency', h.BASE_CURRENCY);
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

    APEX_JSON.OPEN_ARRAY('lines');
    FOR l IN (
        SELECT LINE_ID, LINE_NUM, COMBO, DESCRIPTION, COMMENT_TEXT, DR_AMOUNT, CR_AMOUNT, CURRENCY_CODE
        FROM   RR_REVALUE_LINES
        WHERE  REVALUE_ID = v_id
        ORDER  BY LINE_NUM
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('lineId',       l.LINE_ID);
        APEX_JSON.WRITE('lineNum',      l.LINE_NUM);
        APEX_JSON.WRITE('combo',        l.COMBO);
        APEX_JSON.WRITE('description',  l.DESCRIPTION);
        APEX_JSON.WRITE('commentText',  l.COMMENT_TEXT);
        APEX_JSON.WRITE('drAmount',     l.DR_AMOUNT);
        APEX_JSON.WRITE('crAmount',     l.CR_AMOUNT);
        APEX_JSON.WRITE('currencyCode', l.CURRENCY_CODE);
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
    DBMS_OUTPUT.PUT_LINE('GET gl/revaluation/:id detail handler updated (line currencyCode)');
END;
/


-- ── 6. Report — accounted revaluations whose lines are not all in the GL ──────
-- Each row was hit by the old posting loop. Fix it from Manage FX Revaluation →
-- View Accounting → Post missing lines (posts only what the GL does not have).
SELECT r.REVALUE_ID, r.PERIOD_NAME, r.ACCOUNT, r.ACCOUNT_DESC,
       r.REVAL_LINES, r.GL_LINES,
       r.REVAL_DR,    r.GL_DR,
       r.REVAL_DR - NVL(r.GL_DR, 0) AS MISSING_DR
FROM (
    SELECT h.REVALUE_ID, h.PERIOD_NAME, h.ACCOUNT, h.ACCOUNT_DESC,
           (SELECT COUNT(*) FROM RR_REVALUE_LINES l
             WHERE l.REVALUE_ID = h.REVALUE_ID
               AND (NVL(l.DR_AMOUNT, 0) <> 0 OR NVL(l.CR_AMOUNT, 0) <> 0))          AS REVAL_LINES,
           (SELECT ROUND(SUM(NVL(l.DR_AMOUNT, 0)), 2) FROM RR_REVALUE_LINES l
             WHERE l.REVALUE_ID = h.REVALUE_ID)                                       AS REVAL_DR,
           (SELECT COUNT(*) FROM RR_GL_JE_LINES_ALL g
             WHERE g.REFERENCE2 = TO_CHAR(h.REVALUE_ID)
               AND UPPER(g.REFERENCE5) IN ('GL_REVALUATION', 'GL-REVALUATION'))      AS GL_LINES,
           (SELECT ROUND(SUM(NVL(g.ACCOUNTED_DR, 0)), 2) FROM RR_GL_JE_LINES_ALL g
             WHERE g.REFERENCE2 = TO_CHAR(h.REVALUE_ID)
               AND UPPER(g.REFERENCE5) IN ('GL_REVALUATION', 'GL-REVALUATION'))      AS GL_DR
    FROM RR_REVALUE_HEADER h
    WHERE h.STATUS = 'ACCOUNTED'
) r
WHERE r.REVAL_LINES <> r.GL_LINES
   OR ABS(NVL(r.REVAL_DR, 0) - NVL(r.GL_DR, 0)) > 0.01
ORDER BY r.REVALUE_ID DESC;
