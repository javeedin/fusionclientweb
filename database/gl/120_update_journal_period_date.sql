-- =============================================================================
-- 120: Update journal batch period + accounting date
--
-- PUT reerp/gl/journals/batches/:batch_id/period
-- Body: { "periodName": "Jun-26", "accountingDate": "2026-06-06", "updatedBy": "name" }
--
-- Updates, keyed by JE_BATCH_ID:
--   RR_GL_JOURNAL_BATCHES.DEFAULT_PERIOD_NAME
--   RR_GL_JE_HEADERS.PERIOD_NAME + DEFAULT_EFFECTIVE_DATE   (every header in the batch)
--
-- Run each block separately in SQL Workshop > SQL Commands (as schema owner)
-- =============================================================================

BEGIN
  ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/journals/batches/:batch_id/period');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'gl/journals/batches/:batch_id/period',
    p_method        => 'PUT',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => 'application/json',
    p_comments      => 'Update batch DEFAULT_PERIOD_NAME + all headers PERIOD_NAME/DEFAULT_EFFECTIVE_DATE',
    p_source        => q'[
DECLARE
  v_body        CLOB   := :body_text;
  v_json        JSON_OBJECT_T;
  v_batch_id    NUMBER := :batch_id;
  v_period      VARCHAR2(15);
  v_date_str    VARCHAR2(30);
  v_date        DATE;
  v_updated_by  VARCHAR2(200);
  v_hdr_count   NUMBER := 0;
  v_batch_count NUMBER := 0;
BEGIN
  v_json       := JSON_OBJECT_T.PARSE(v_body);
  v_period     := v_json.GET_STRING('periodName');
  v_date_str   := v_json.GET_STRING('accountingDate');
  v_updated_by := v_json.GET_STRING('updatedBy');

  IF v_batch_id IS NULL OR v_period IS NULL OR v_date_str IS NULL THEN
    :status_code := 400;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"batch_id, periodName and accountingDate are required"}');
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
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"No batch or headers found for JE_BATCH_ID ' || v_batch_id || '"}');
    RETURN;
  END IF;

  COMMIT;
  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"success":true,"jeBatchId":' || v_batch_id
       || ',"periodName":"' || v_period || '"'
       || ',"accountingDate":"' || TO_CHAR(v_date, 'YYYY-MM-DD') || '"'
       || ',"headersUpdated":' || v_hdr_count
       || ',"batchesUpdated":' || v_batch_count
       || ',"updatedBy":"' || REPLACE(NVL(v_updated_by,''), '"', '') || '"}');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
  );
  COMMIT;
END;
/
