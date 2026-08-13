CREATE OR REPLACE PROCEDURE RR_POST_JOURNAL (
    p_je_batch_id   IN  NUMBER,
    p_status        OUT NUMBER,
    p_message       OUT CLOB
) AS
    v_batch_status      VARCHAR2(30);
    v_period_name       VARCHAR2(100);
    v_je_category       VARCHAR2(100);
    v_closing_status    VARCHAR2(10);

    v_line_count        NUMBER := 0;
    v_total_dr          NUMBER := 0;
    v_total_cr          NUMBER := 0;
    v_no_account_lines  NUMBER := 0;
    v_zero_amount_lines NUMBER := 0;

    v_has_error         BOOLEAN := FALSE;

    PROCEDURE add_error (p_msg IN VARCHAR2) AS
    BEGIN
        v_has_error := TRUE;
        APEX_JSON.WRITE(p_msg);
    END add_error;

BEGIN
    -- ── 1. Batch exists? ────────────────────────────────────────────────────
    BEGIN
        SELECT STATUS
        INTO   v_batch_status
        FROM   RR_GL_JOURNAL_BATCHES
        WHERE  JE_BATCH_ID = p_je_batch_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_status := 404;
            APEX_JSON.INITIALIZE_CLOB_OUTPUT;
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('success', FALSE);
            APEX_JSON.WRITE('error',   'Journal batch ' || p_je_batch_id || ' not found.');
            APEX_JSON.CLOSE_OBJECT;
            p_message := APEX_JSON.GET_CLOB_OUTPUT;
            APEX_JSON.FREE_OUTPUT;
            RETURN;
    END;

    -- ── 2. Period name + JE category ───────────────────────────────────────
    BEGIN
        SELECT PERIOD_NAME,
               NVL(UPPER(USER_JE_CATEGORY_NAME), '')
        INTO   v_period_name, v_je_category
        FROM   RR_GL_JE_HEADERS
        WHERE  BATCH_ID = p_je_batch_id
        AND    ROWNUM   = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_period_name := NULL;
            v_je_category := '';
    END;

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.OPEN_ARRAY('errors');

    -- ── 3. Already posted? ─────────────────────────────────────────────────
    IF v_batch_status = 'P' THEN
        add_error('Journal batch is already posted.');
    END IF;

    -- ── 4a. Period format: Mon-YY ──────────────────────────────────────────
    IF v_period_name IS NULL THEN
        add_error('Accounting period is missing. Cannot post without a valid period.');
    ELSIF NOT REGEXP_LIKE(v_period_name, '^[A-Z][a-z]{2}-[0-9]{2}$') THEN
        add_error(
            'Accounting period "' || v_period_name ||
            '" is in the wrong format. Expected Mon-YY (e.g. Apr-26).'
        );
    END IF;

    -- ── 4b. Period is Open? ────────────────────────────────────────────────
    IF v_period_name IS NOT NULL
       AND REGEXP_LIKE(v_period_name, '^[A-Z][a-z]{2}-[0-9]{2}$')
    THEN
        BEGIN
            SELECT CLOSING_STATUS
            INTO   v_closing_status
            FROM   RR_ACCOUNTING_PERIODS_STATUS
            WHERE  PERIOD_NAME_ID  = v_period_name
            AND    APPLICATION_ID  = 101
            AND    ROWNUM          = 1;

            IF v_closing_status != 'O' THEN
                DECLARE v_label VARCHAR2(80); BEGIN
                    v_label := CASE v_closing_status
                        WHEN 'C' THEN 'Closed'  WHEN 'F' THEN 'Future'
                        WHEN 'N' THEN 'Never Opened'  WHEN 'P' THEN 'Permanently Closed'
                        ELSE v_closing_status END;
                    add_error('Accounting period "' || v_period_name || '" is ' || v_label ||
                              '. Only Open periods can be posted to.');
                END;
            END IF;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                add_error('Period "' || v_period_name ||
                    '" was not found in the period status table. Verify the period is open before posting.');
        END;
    END IF;

    -- ── 5. Lines exist + data quality ─────────────────────────────────────
    -- Zero-amount check: a line is invalid only when ALL four amounts
    -- (ENTERED_DR, ENTERED_CR, ACCOUNTED_DR, ACCOUNTED_CR) are zero.
    -- This correctly allows FX Realized Gain/Loss lines that carry value
    -- only in ACCOUNTED_CR/DR (entered amounts are legitimately zero).
    SELECT COUNT(*),
           NVL(SUM(ENTERED_DR),   0),
           NVL(SUM(ENTERED_CR),   0),
           SUM(CASE WHEN NVL(TRIM(ACCOUNT_COMBINATION), '') = '' THEN 1 ELSE 0 END),
           SUM(
               CASE WHEN NVL(ENTERED_DR,   0) = 0 AND NVL(ENTERED_CR,   0) = 0
                     AND NVL(ACCOUNTED_DR, 0) = 0 AND NVL(ACCOUNTED_CR, 0) = 0
                    THEN 1 ELSE 0 END
           )
    INTO   v_line_count, v_total_dr, v_total_cr, v_no_account_lines, v_zero_amount_lines
    FROM   RR_GL_JE_LINES_ALL
    WHERE  JE_HEADER_ID IN (
               SELECT JE_HEADER_ID FROM RR_GL_JE_HEADERS WHERE BATCH_ID = p_je_batch_id
           );

    IF v_line_count = 0 THEN
        add_error('Journal batch has no lines. At least one line is required.');
    END IF;

    -- ── 6. Balance check ──────────────────────────────────────────────────
    -- Revaluation: entered totals are always 0 — balance on accounted totals.
    -- All others: balance on entered totals.
    IF v_line_count > 0 THEN
        DECLARE
            v_chk_dr NUMBER;
            v_chk_cr NUMBER;
        BEGIN
            IF v_je_category = 'REVALUATION' THEN
                SELECT NVL(SUM(ACCOUNTED_DR), 0), NVL(SUM(ACCOUNTED_CR), 0)
                INTO   v_chk_dr, v_chk_cr
                FROM   RR_GL_JE_LINES_ALL
                WHERE  JE_HEADER_ID IN (
                           SELECT JE_HEADER_ID FROM RR_GL_JE_HEADERS WHERE BATCH_ID = p_je_batch_id
                       );
            ELSE
                v_chk_dr := v_total_dr;
                v_chk_cr := v_total_cr;
            END IF;

            IF ABS(v_chk_dr - v_chk_cr) > 0.01 THEN
                add_error(
                    'Journal is out of balance. Total Debit = ' ||
                    TO_CHAR(v_chk_dr, 'FM999,999,999,990.99') ||
                    ', Total Credit = ' || TO_CHAR(v_chk_cr, 'FM999,999,999,990.99') ||
                    ' (difference = ' || TO_CHAR(ABS(v_chk_dr - v_chk_cr), 'FM999,999,999,990.99') || ').'
                );
            END IF;
        END;
    END IF;

    -- ── 7. All lines have an account code ─────────────────────────────────
    IF v_no_account_lines > 0 THEN
        add_error(v_no_account_lines || ' line(s) have no account code.');
    END IF;

    -- ── 8. No fully-zero lines ────────────────────────────────────────────
    IF v_zero_amount_lines > 0 THEN
        add_error(v_zero_amount_lines || ' line(s) have both Debit and Credit equal to zero.');
    END IF;

    APEX_JSON.CLOSE_ARRAY;  -- errors[]

    IF v_has_error THEN
        APEX_JSON.WRITE('success',   FALSE);
        APEX_JSON.WRITE('error',     'Validation failed. See errors array for details.');
        APEX_JSON.WRITE('jeBatchId', p_je_batch_id);
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 422;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    -- ── 9. Post ───────────────────────────────────────────────────────────
    UPDATE RR_GL_JOURNAL_BATCHES
    SET    STATUS           = 'P',
           STATUS_MEANING   = 'Posted',
           POSTED_DATE      = SYSDATE,
           LAST_UPDATED_BY  = 'REACTERP',
           LAST_UPDATE_DATE = SYSTIMESTAMP
    WHERE  JE_BATCH_ID = p_je_batch_id;

    COMMIT;

    APEX_JSON.WRITE('success',    TRUE);
    APEX_JSON.WRITE('message',    'Journal batch posted successfully');
    APEX_JSON.WRITE('jeBatchId',  p_je_batch_id);
    APEX_JSON.WRITE('period',     v_period_name);
    APEX_JSON.WRITE('totalDr',    v_total_dr);
    APEX_JSON.WRITE('totalCr',    v_total_cr);
    APEX_JSON.WRITE('linesCount', v_line_count);
    APEX_JSON.CLOSE_OBJECT;
    p_status  := 200;
    p_message := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',   FALSE);
        APEX_JSON.WRITE('error',     SQLERRM);
        APEX_JSON.WRITE('errorCode', SQLCODE);
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 500;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
END RR_POST_JOURNAL;
/
