-- =============================================================================
-- 120 (v3): Update journal batch period + accounting date
--
-- PUT reerp/gl/journals/batches/:jeBatchId/period
-- Body: { "periodName": "Jun-26", "accountingDate": "2026-06-06", "updatedBy": "name" }
--
-- Updates, keyed by JE_BATCH_ID:
--   RR_GL_JOURNAL_BATCHES.DEFAULT_PERIOD_NAME
--   RR_GL_JE_HEADERS.PERIOD_NAME + DEFAULT_EFFECTIVE_DATE   (every header in the batch)
--
-- v3: mirrors the PROVEN-WORKING gl/journals/:jeBatchId/post recipe exactly —
--     camelCase URI bind (no underscores), :status (not :status_code),
--     stored procedure + APEX_JSON, separate DEFINE_TEMPLATE block.
--     Earlier variants returned ORDS-25001 / HTTP 555.
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands — run each block separately.
-- =============================================================================


-- =============================================================================
-- 1. PROCEDURE: RR_UPDATE_JOURNAL_PERIOD
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
-- 2. Clean up any earlier (broken) template variants
-- =============================================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/journals/batches/:batch_id/period');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/journals/batches/:jeBatchId/period');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- =============================================================================
-- 3. Template (same style as 12_post_journal_handler.sql)
-- =============================================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/batches/:jeBatchId/period',
        p_comments    => 'Update a journal batch period + accounting date'
    );
    COMMIT;
END;
/


-- =============================================================================
-- 4. Handler (same recipe as the working gl/journals/:jeBatchId/post)
-- =============================================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/batches/:jeBatchId/period',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                v_body     CLOB := :body_text;
                v_batch    NUMBER;
                v_period   VARCHAR2(100);
                v_date_str VARCHAR2(100);
                v_status   NUMBER;
                v_message  CLOB;
            BEGIN
                -- jeBatchId: URI bind first, JSON body as fallback
                BEGIN v_batch := TO_NUMBER(:jeBatchId); EXCEPTION WHEN OTHERS THEN v_batch := NULL; END;
                IF v_batch IS NULL AND v_body IS NOT NULL THEN
                    v_batch := TO_NUMBER(JSON_VALUE(v_body, '$.jeBatchId'));
                END IF;
                IF v_body IS NOT NULL THEN
                    v_period   := JSON_VALUE(v_body, '$.periodName');
                    v_date_str := JSON_VALUE(v_body, '$.accountingDate');
                END IF;

                IF v_batch IS NULL OR v_period IS NULL OR v_date_str IS NULL THEN
                    :status := 400;
                    HTP.P('{"success":false,"error":"jeBatchId, periodName and accountingDate are required",'
                       || '"diag":{"uriBind":"'   || NVL(:jeBatchId, 'NULL') || '",'
                       || '"bodyLength":'         || NVL(DBMS_LOB.GETLENGTH(v_body), 0) || ','
                       || '"bodyStart":"'
                       || REPLACE(REPLACE(REPLACE(NVL(DBMS_LOB.SUBSTR(v_body, 150, 1), '(empty)'), CHR(92), ''), '"', ''''), CHR(10), ' ')
                       || '"}}');
                    RETURN;
                END IF;

                RR_UPDATE_JOURNAL_PERIOD(
                    p_je_batch_id => v_batch,
                    p_period_name => v_period,
                    p_date_str    => v_date_str,
                    p_updated_by  => JSON_VALUE(v_body, '$.updatedBy'),
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
