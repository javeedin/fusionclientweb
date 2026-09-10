-- ============================================================
-- PATCH 139: Robust ledger resolution in the post-journal period check
--            + datafix for FA book controls carrying no real LEDGER_ID
--
-- Symptom (after patch 138):
--   PUT gl/journals/:id/post -> 422
--   'Period "May-26" was not found in the period status table for
--    ledger 1. Verify the period is open before posting.'
--
-- Cause:
--   FA accounting previews (database/fa/24/25/36) read LEDGER_ID from
--   RR_FA_BOOK_CONTROLS and default to 1 when it is NULL / the row is
--   missing. Journals created by those flows are stored with
--   LEDGER_ID = 1, an id that does not exist in
--   RR_ACCOUNTING_PERIODS_STATUS — the real rows sit under the
--   ledger's id from RR_LEDGERS (e.g. SB LEDGER).
--
-- Fixes:
--   1. Datafix: point RR_FA_BOOK_CONTROLS.LEDGER_ID at the real id
--      from RR_LEDGERS (matched by name) where it is NULL or 1.
--      Future FA journals then carry the right ledger from creation.
--   2. RR_POST_JOURNAL: resolve the ledger in stages —
--        a) period rows for the header's LEDGER_ID;
--        b) none found -> resolve the id from RR_LEDGERS by the
--           header's LEDGER_NAME and retry (covers journals already
--           stored with LEDGER_ID = 1);
--        c) still none -> any-ledger match (pre-138 behavior) so a
--           bad stored id degrades gracefully instead of blocking.
--      Everything outside the period check is unchanged from 138.
-- ============================================================

-- ── 1. Datafix: FA book controls ------------------------------------------
UPDATE rr_fa_book_controls bc
SET    bc.ledger_id = (SELECT l.ledger_id FROM rr_ledgers l
                       WHERE UPPER(l.ledger_name) = UPPER(bc.ledger_name)
                       AND   ROWNUM = 1)
WHERE  (bc.ledger_id IS NULL OR bc.ledger_id = 1)
AND    EXISTS (SELECT 1 FROM rr_ledgers l
               WHERE UPPER(l.ledger_name) = UPPER(bc.ledger_name));

COMMIT;

-- ── 2. RR_POST_JOURNAL with staged ledger resolution ----------------------
CREATE OR REPLACE PROCEDURE RR_POST_JOURNAL (
    p_je_batch_id   IN  NUMBER,
    p_status        OUT NUMBER,
    p_message       OUT CLOB
) AS
    v_batch_status      VARCHAR2(30);
    v_period_name       VARCHAR2(100);
    v_je_category       VARCHAR2(100);
    v_ledger_id         NUMBER;
    v_ledger_name       VARCHAR2(240);
    v_closing_status    VARCHAR2(10);
    v_period_rows       NUMBER := 0;
    v_open_rows         NUMBER := 0;

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

    -- Count period rows (total + open) for one ledger id; NULL id = any ledger
    PROCEDURE check_period (p_ledger IN NUMBER) AS
    BEGIN
        SELECT COUNT(*),
               SUM(CASE WHEN CLOSING_STATUS = 'O' THEN 1 ELSE 0 END),
               MIN(CLOSING_STATUS)
        INTO   v_period_rows, v_open_rows, v_closing_status
        FROM   RR_ACCOUNTING_PERIODS_STATUS
        WHERE  APPLICATION_ID = 101   -- 101 = General Ledger
        AND    (   PERIOD_NAME_ID = v_period_name
                OR PERIOD_NAME_ID LIKE '%\_' || v_period_name ESCAPE '\')
        AND    (p_ledger IS NULL OR LEDGER_ID = p_ledger);
    END check_period;

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

    -- ── 2. Period, JE category + ledger from the first journal header ─────────
    BEGIN
        SELECT PERIOD_NAME,
               NVL(UPPER(USER_JE_CATEGORY_NAME), ''),
               LEDGER_ID,
               LEDGER_NAME
        INTO   v_period_name, v_je_category, v_ledger_id, v_ledger_name
        FROM   RR_GL_JE_HEADERS
        WHERE  BATCH_ID = p_je_batch_id
        AND    ROWNUM   = 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_period_name := NULL;
            v_je_category := '';
            v_ledger_id   := NULL;
            v_ledger_name := NULL;
    END;

    -- Fallback: header has no ledger — take it from the batch
    IF v_ledger_id IS NULL OR v_ledger_name IS NULL THEN
        BEGIN
            SELECT NVL(v_ledger_id, LEDGER_ID), NVL(v_ledger_name, LEDGER_NAME)
            INTO   v_ledger_id, v_ledger_name
            FROM   RR_GL_JOURNAL_BATCHES
            WHERE  JE_BATCH_ID = p_je_batch_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN NULL;
        END;
    END IF;

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.OPEN_ARRAY('errors');

    -- ── 3. Already posted? ────────────────────────────────────────────────────
    IF v_batch_status = 'P' THEN
        add_error('Journal batch is already posted.');
    END IF;

    -- ── 4a. Period format: Mon-YY ─────────────────────────────────────────────
    IF v_period_name IS NULL THEN
        add_error('Accounting period is missing. Cannot post without a valid period.');
    ELSIF NOT REGEXP_LIKE(v_period_name, '^[A-Z][a-z]{2}-[0-9]{2}$') THEN
        add_error(
            'Accounting period "' || v_period_name ||
            '" is in the wrong format. Expected Mon-YY (e.g. Apr-26).'
        );
    END IF;

    -- ── 4b. Period is Open for this ledger? ───────────────────────────────────
    -- Stage a: rows for the header's LEDGER_ID.
    -- Stage b: none found -> resolve the id from RR_LEDGERS by LEDGER_NAME and
    --          retry (journals created with a placeholder id, e.g. 1).
    -- Stage c: still none -> any-ledger match, the pre-138 behavior.
    IF v_period_name IS NOT NULL
       AND REGEXP_LIKE(v_period_name, '^[A-Z][a-z]{2}-[0-9]{2}$')
    THEN
        check_period(v_ledger_id);

        IF v_period_rows = 0 AND v_ledger_name IS NOT NULL THEN
            DECLARE
                v_resolved_id NUMBER;
            BEGIN
                SELECT ledger_id
                INTO   v_resolved_id
                FROM   rr_ledgers
                WHERE  UPPER(ledger_name) = UPPER(v_ledger_name)
                AND    ROWNUM = 1;

                IF v_resolved_id IS NOT NULL AND
                   (v_ledger_id IS NULL OR v_resolved_id != v_ledger_id) THEN
                    v_ledger_id := v_resolved_id;
                    check_period(v_ledger_id);
                END IF;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN NULL;
            END;
        END IF;

        IF v_period_rows = 0 AND v_ledger_id IS NOT NULL THEN
            check_period(NULL);   -- last resort: any ledger
        END IF;

        IF v_period_rows = 0 THEN
            add_error('Period "' || v_period_name ||
                '" was not found in the period status table' ||
                CASE WHEN v_ledger_name IS NOT NULL
                     THEN ' for ledger "' || v_ledger_name || '"' ELSE '' END ||
                '. Verify the period is open before posting.');
        ELSIF v_open_rows = 0 THEN
            DECLARE v_label VARCHAR2(80); BEGIN
                v_label := CASE v_closing_status
                    WHEN 'C' THEN 'Closed'  WHEN 'F' THEN 'Future'
                    WHEN 'N' THEN 'Never Opened'  WHEN 'P' THEN 'Permanently Closed'
                    ELSE v_closing_status END;
                add_error('Accounting period "' || v_period_name || '" is ' || v_label ||
                          CASE WHEN v_ledger_name IS NOT NULL
                               THEN ' for ledger "' || v_ledger_name || '"' ELSE '' END ||
                          '. Only Open periods can be posted to.');
            END;
        END IF;
    END IF;

    -- ── 5. Lines exist + data quality ────────────────────────────────────────
    -- Zero-amount check:
    --   Revaluation: entered = 0 by design; invalid only when BOTH entered AND accounted are zero.
    --   All other categories: invalid when entered DR and CR are both zero.
    SELECT COUNT(*),
           NVL(SUM(ENTERED_DR),   0),
           NVL(SUM(ENTERED_CR),   0),
           SUM(CASE WHEN NVL(TRIM(ACCOUNT_COMBINATION), '') = '' THEN 1 ELSE 0 END),
           SUM(CASE
                   WHEN v_je_category = 'REVALUATION' THEN
                       CASE WHEN NVL(ENTERED_DR,   0) = 0 AND NVL(ENTERED_CR,   0) = 0
                             AND NVL(ACCOUNTED_DR, 0) = 0 AND NVL(ACCOUNTED_CR, 0) = 0
                            THEN 1 ELSE 0 END
                   ELSE
                       CASE WHEN NVL(ENTERED_DR, 0) = 0 AND NVL(ENTERED_CR, 0) = 0
                            THEN 1 ELSE 0 END
               END)
    INTO   v_line_count, v_total_dr, v_total_cr, v_no_account_lines, v_zero_amount_lines
    FROM   RR_GL_JE_LINES_ALL
    WHERE  JE_HEADER_ID IN (
               SELECT JE_HEADER_ID FROM RR_GL_JE_HEADERS WHERE BATCH_ID = p_je_batch_id
           );

    IF v_line_count = 0 THEN
        add_error('Journal batch has no lines. At least one line is required.');
    END IF;

    -- ── 6. Balance check ─────────────────────────────────────────────────────
    -- Revaluation: entered totals are always 0 — balance check on accounted totals instead.
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

    -- ── 7. All lines have an account code ────────────────────────────────────
    IF v_no_account_lines > 0 THEN
        add_error(v_no_account_lines || ' line(s) have no account code.');
    END IF;

    -- ── 8. No zero-amount lines ───────────────────────────────────────────────
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

    -- ── 9. Post ───────────────────────────────────────────────────────────────
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

DBMS_OUTPUT.PUT_LINE('RR_POST_JOURNAL updated — ledger resolved by id, then by name via RR_LEDGERS, then any-ledger fallback');
