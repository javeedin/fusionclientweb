-- =============================================================================
-- PATCH 127: RR_UPDATE_JOURNAL_PERIOD — reject period / accounting-date mismatch
--
-- PROBLEM:
--   PUT gl/journals/batches/:jeBatchId/period (patch 120) stored whatever
--   period + date it received, with no consistency check. Combined with a
--   fail-open check in the UI, users could save e.g. period Jun-26 with an
--   accounting date of 16-Aug-2026 — the exact mismatch behind the 89.00
--   opening-balance discrepancy on account 1242137.
--
-- FIX (procedure only — the ORDS template/handler from patch 120 stay as-is):
--   Before updating, validate that the accounting date belongs to the target
--   period:
--     1. If RR_GL_FISCAL_PERIODS has the period (GL, non-adjusting), the date
--        must fall within its START_DATE..END_DATE.
--     2. Otherwise the date's month label TO_CHAR(date,'Mon-YY') must equal
--        the period name.
--   A mismatch returns 400 with a clear message and changes nothing.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands → run the CREATE OR REPLACE PROCEDURE.
-- =============================================================================

CREATE OR REPLACE PROCEDURE RR_UPDATE_JOURNAL_PERIOD (
    p_je_batch_id  IN  NUMBER,
    p_period_name  IN  VARCHAR2,
    p_date_str     IN  VARCHAR2,
    p_updated_by   IN  VARCHAR2,
    p_status       OUT NUMBER,
    p_message      OUT CLOB
) AS
    v_date        DATE;
    v_hdr_count   NUMBER := 0;
    v_batch_count NUMBER := 0;
    v_cal_count   NUMBER := 0;
    v_in_period   NUMBER := 0;
    v_month_label VARCHAR2(10);
BEGIN
    IF p_je_batch_id IS NULL OR p_period_name IS NULL OR p_date_str IS NULL THEN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'jeBatchId, periodName and accountingDate are required');
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 400;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    v_date := TO_DATE(SUBSTR(p_date_str, 1, 10), 'YYYY-MM-DD');

    -- ── PATCH 127: the accounting date must belong to the target period ──
    SELECT COUNT(*),
           SUM(CASE WHEN v_date BETWEEN START_DATE AND END_DATE THEN 1 ELSE 0 END)
    INTO   v_cal_count, v_in_period
    FROM   RR_GL_FISCAL_PERIODS
    WHERE  PERIOD_NAME          = p_period_name
      AND  TO_CHAR(APPLICATION) = 'GL'
      AND  TO_CHAR(ADJ_FLAG)    = 'N';

    v_month_label := TO_CHAR(v_date, 'Mon-YY', 'NLS_DATE_LANGUAGE=ENGLISH');

    IF (v_cal_count > 0 AND NVL(v_in_period, 0) = 0)
       OR (v_cal_count = 0 AND v_month_label <> p_period_name) THEN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error',
            'Accounting date ' || TO_CHAR(v_date, 'YYYY-MM-DD') ||
            ' is not within period ' || p_period_name ||
            '. Period and accounting date must belong to the same GL period.');
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 400;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;
    -- ── end PATCH 127 validation ──

    UPDATE RR_GL_JE_HEADERS
       SET PERIOD_NAME            = p_period_name,
           DEFAULT_EFFECTIVE_DATE = v_date
     WHERE JE_BATCH_ID = p_je_batch_id;
    v_hdr_count := SQL%ROWCOUNT;

    UPDATE RR_GL_JOURNAL_BATCHES
       SET DEFAULT_PERIOD_NAME = p_period_name
     WHERE JE_BATCH_ID = p_je_batch_id;
    v_batch_count := SQL%ROWCOUNT;

    IF v_hdr_count = 0 AND v_batch_count = 0 THEN
        ROLLBACK;
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', 'No batch or headers found for JE_BATCH_ID ' || p_je_batch_id);
        APEX_JSON.CLOSE_OBJECT;
        p_status  := 404;
        p_message := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
        RETURN;
    END IF;

    COMMIT;
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',        TRUE);
    APEX_JSON.WRITE('jeBatchId',      p_je_batch_id);
    APEX_JSON.WRITE('periodName',     p_period_name);
    APEX_JSON.WRITE('accountingDate', TO_CHAR(v_date, 'YYYY-MM-DD'));
    APEX_JSON.WRITE('headersUpdated', v_hdr_count);
    APEX_JSON.WRITE('batchesUpdated', v_batch_count);
    APEX_JSON.WRITE('updatedBy',      NVL(p_updated_by, 'REERP'));
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
END RR_UPDATE_JOURNAL_PERIOD;
/

-- =============================================================================
-- VERIFICATION — both should now be rejected with HTTP 400:
--   PUT gl/journals/batches/<id>/period
--     { "periodName": "Jun-26", "accountingDate": "2026-08-16", ... }  → 400
--     { "periodName": "Jun-26", "accountingDate": "2026-06-16", ... }  → 200
-- =============================================================================
