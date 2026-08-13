-- =============================================================================
-- 14_POST_JOURNAL_WITH_VALIDATION.SQL
--
-- 1. Creates procedure RR_POST_JOURNAL
--    Validates before posting:
--      a) Batch exists and is not already posted
--      b) Period format is Mon-YY  (e.g. Apr-26) — REGEXP check
--      c) Accounting period is Open  (RR_ACCOUNTING_PERIODS_STATUS.CLOSING_STATUS = 'O')
--      d) At least one line exists
--      e) Total Debit = Total Credit (within 0.01)
--      f) All lines have an account code
--      g) No lines with zero Debit AND zero Credit
--    On success: UPDATE RR_GL_JOURNAL_BATCHES SET STATUS = 'P' / 'Posted'
--
-- 2. Redefines the ORDS handler:
--      PUT reerp/gl/journals/:jeBatchId/post
--    (replaces the simple handler from 12_post_journal_handler.sql)
-- =============================================================================


-- =============================================================================
-- PROCEDURE: RR_POST_JOURNAL
-- =============================================================================
CREATE OR REPLACE PROCEDURE RR_POST_JOURNAL (
    p_je_batch_id   IN  NUMBER,
    p_status        OUT NUMBER,
    p_message       OUT CLOB
) AS
    -- Batch / header info
    v_batch_status      VARCHAR2(30);
    v_period_name       VARCHAR2(100);
    v_closing_status    VARCHAR2(10);

    -- Line aggregates
    v_line_count        NUMBER := 0;
    v_total_dr          NUMBER := 0;
    v_total_cr          NUMBER := 0;
    v_no_account_lines  NUMBER := 0;
    v_zero_amount_lines NUMBER := 0;

    -- Validation error accumulator
    v_has_error         BOOLEAN := FALSE;

    -- Helper: append a validation error message
    PROCEDURE add_error (p_msg IN VARCHAR2) AS
    BEGIN
        v_has_error := TRUE;
        -- Write each error as a JSON array element
        APEX_JSON.WRITE(p_msg);
    END add_error;

BEGIN
    -- ── 1. Batch exists? ──────────────────────────────────────────────────────
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

    -- ── 2. Get period name from the journal header ────────────────────────────
    BEGIN
        SELECT PERIOD_NAME
        INTO   v_period_name
        FROM   RR_GL_JE_HEADERS
        WHERE  BATCH_ID = p_je_batch_id
        AND    ROWNUM   = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_period_name := NULL;
    END;

    -- ── Start building the error-array JSON output ────────────────────────────
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.OPEN_ARRAY('errors');

    -- ── 3. Already posted? ────────────────────────────────────────────────────
    IF v_batch_status = 'P' THEN
        add_error('Journal batch is already posted.');
    END IF;

    -- ── 4a. Period format: must be Mon-YY (e.g. Apr-26) ──────────────────────
    IF v_period_name IS NULL THEN
        add_error('Accounting period is missing. Cannot post without a valid period.');
    ELSIF NOT REGEXP_LIKE(v_period_name, '^[A-Z][a-z]{2}-[0-9]{2}$') THEN
        add_error(
            'Accounting period "' || v_period_name ||
            '" is in the wrong format. Expected Mon-YY (e.g. Apr-26).'
        );
    END IF;

    -- ── 4b. Period is Open? ───────────────────────────────────────────────────
    IF v_period_name IS NOT NULL
       AND REGEXP_LIKE(v_period_name, '^[A-Z][a-z]{2}-[0-9]{2}$')
    THEN
        BEGIN
            SELECT CLOSING_STATUS
            INTO   v_closing_status
            FROM   RR_ACCOUNTING_PERIODS_STATUS
            WHERE  PERIOD_NAME_ID  = v_period_name
            AND    APPLICATION_ID  = 101   -- 101 = General Ledger
            AND    ROWNUM          = 1;

            IF v_closing_status != 'O' THEN
                DECLARE
                    v_status_label VARCHAR2(80);
                BEGIN
                    v_status_label :=
                        CASE v_closing_status
                            WHEN 'C' THEN 'Closed'
                            WHEN 'F' THEN 'Future'
                            WHEN 'N' THEN 'Never Opened'
                            WHEN 'P' THEN 'Permanently Closed'
                            ELSE v_closing_status
                        END;
                    add_error(
                        'Accounting period "' || v_period_name ||
                        '" is ' || v_status_label ||
                        '. Only Open periods can be posted to.'
                    );
                END;
            END IF;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                -- Period not in status table — warn but do not block
                add_error(
                    'Period "' || v_period_name ||
                    '" was not found in the period status table. Verify the period is open before posting.'
                );
        END;
    END IF;

    -- ── 5. Lines exist + totals + data quality ────────────────────────────────
    SELECT COUNT(*),
           NVL(SUM(ENTERED_DR), 0),
           NVL(SUM(ENTERED_CR), 0),
           SUM(CASE WHEN NVL(TRIM(ACCOUNT_COMBINATION), '') = '' THEN 1 ELSE 0 END),
           SUM(CASE WHEN NVL(ENTERED_DR, 0) = 0 AND NVL(ENTERED_CR, 0) = 0 THEN 1 ELSE 0 END)
    INTO   v_line_count,
           v_total_dr,
           v_total_cr,
           v_no_account_lines,
           v_zero_amount_lines
    FROM   RR_GL_JE_LINES_ALL
    WHERE  JE_HEADER_ID IN (
               SELECT JE_HEADER_ID FROM RR_GL_JE_HEADERS WHERE BATCH_ID = p_je_batch_id
           );

    IF v_line_count = 0 THEN
        add_error('Journal batch has no lines. At least one line is required.');
    END IF;

    -- ── 6. Debit = Credit balance ─────────────────────────────────────────────
    IF v_line_count > 0 AND ABS(v_total_dr - v_total_cr) > 0.01 THEN
        add_error(
            'Journal is out of balance. ' ||
            'Total Debit = ' || TO_CHAR(v_total_dr, 'FM999,999,999,990.99') ||
            ', Total Credit = ' || TO_CHAR(v_total_cr, 'FM999,999,999,990.99') ||
            ' (difference = ' || TO_CHAR(ABS(v_total_dr - v_total_cr), 'FM999,999,999,990.99') || ').'
        );
    END IF;

    -- ── 7. All lines have an account code ─────────────────────────────────────
    IF v_no_account_lines > 0 THEN
        add_error(v_no_account_lines || ' line(s) have no account code.');
    END IF;

    -- ── 8. No zero-amount lines ───────────────────────────────────────────────
    IF v_zero_amount_lines > 0 THEN
        add_error(v_zero_amount_lines || ' line(s) have both Debit and Credit equal to zero.');
    END IF;

    -- ── Close the errors array ────────────────────────────────────────────────
    APEX_JSON.CLOSE_ARRAY;  -- errors[]

    -- ── Return validation failure? ────────────────────────────────────────────
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

    -- ── 9. All validations passed — post the batch ────────────────────────────
    UPDATE RR_GL_JOURNAL_BATCHES
    SET    STATUS            = 'P',
           STATUS_MEANING    = 'Posted',
           POSTED_DATE       = SYSDATE,
           LAST_UPDATED_BY   = 'REACTERP',
           LAST_UPDATE_DATE  = SYSTIMESTAMP
    WHERE  JE_BATCH_ID = p_je_batch_id;

    COMMIT;

    -- ── Success response ──────────────────────────────────────────────────────
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


-- =============================================================================
-- ORDS HANDLER: PUT reerp/gl/journals/:jeBatchId/post
-- Replaces the simple handler from 12_post_journal_handler.sql
-- Template is already defined — only redefine the handler.
-- =============================================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/:jeBatchId/post',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                v_status  NUMBER;
                v_message CLOB;
            BEGIN
                RR_POST_JOURNAL(
                    p_je_batch_id => TO_NUMBER(:jeBatchId),
                    p_status      => v_status,
                    p_message     => v_message
                );

                :status := v_status;
                HTP.P(v_message);
            END;
        ]'
    );
    COMMIT;
END;
/
