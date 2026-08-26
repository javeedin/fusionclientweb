-- =============================================================================
-- 120 (v2): Update journal batch period + accounting date
--
-- PUT reerp/gl/journals/batches/:batch_id/period
-- Body: { "periodName": "Jun-26", "accountingDate": "2026-06-06", "updatedBy": "name" }
--
-- Updates, keyed by JE_BATCH_ID:
--   RR_GL_JOURNAL_BATCHES.DEFAULT_PERIOD_NAME
--   RR_GL_JE_HEADERS.PERIOD_NAME + DEFAULT_EFFECTIVE_DATE   (every header in the batch)
--
-- v2: rewritten to mirror the proven approvals PUT pattern
-- (ORDS.source_type_plsql, JSON_VALUE body parsing, HTP.P responses).
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands — run the single block below.
-- =============================================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/batches/:batch_id/period',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/batches/:batch_id/period'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/batches/:batch_id/period',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_batch_id    NUMBER        := TO_NUMBER(:batch_id);
    v_body        CLOB          := :body_text;
    v_period      VARCHAR2(15)  := JSON_VALUE(v_body, '$.periodName');
    v_date_str    VARCHAR2(30)  := JSON_VALUE(v_body, '$.accountingDate');
    v_updated_by  VARCHAR2(200) := JSON_VALUE(v_body, '$.updatedBy');
    v_date        DATE;
    v_hdr_count   NUMBER := 0;
    v_batch_count NUMBER := 0;
BEGIN
    IF v_batch_id IS NULL OR v_period IS NULL OR v_date_str IS NULL THEN
        :status_code := 400;
        HTP.P('{"success":false,"error":"batch_id, periodName and accountingDate are required"}');
        RETURN;
    END IF;

    v_date := TO_DATE(SUBSTR(v_date_str, 1, 10), 'YYYY-MM-DD');

    UPDATE RR_GL_JE_HEADERS
       SET PERIOD_NAME            = v_period,
           DEFAULT_EFFECTIVE_DATE = v_date
     WHERE JE_BATCH_ID = v_batch_id;
    v_hdr_count := SQL%ROWCOUNT;

    UPDATE RR_GL_JOURNAL_BATCHES
       SET DEFAULT_PERIOD_NAME = v_period
     WHERE JE_BATCH_ID = v_batch_id;
    v_batch_count := SQL%ROWCOUNT;

    IF v_hdr_count = 0 AND v_batch_count = 0 THEN
        ROLLBACK;
        :status_code := 404;
        HTP.P('{"success":false,"error":"No batch or headers found for JE_BATCH_ID ' || v_batch_id || '"}');
        RETURN;
    END IF;

    COMMIT;
    :status_code := 200;
    HTP.P('{"success":true,"jeBatchId":' || v_batch_id
       || ',"periodName":"' || v_period || '"'
       || ',"accountingDate":"' || TO_CHAR(v_date, 'YYYY-MM-DD') || '"'
       || ',"headersUpdated":' || v_hdr_count
       || ',"batchesUpdated":' || v_batch_count || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;]'
    );
    COMMIT;
END;
/
