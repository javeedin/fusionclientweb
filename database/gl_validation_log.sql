-- =============================================================================
-- RR_GL_VALIDATION_LOG — Journal pre-flight validation log
-- =============================================================================
-- Records every GL journal validation attempt (pass or fail) with full payload.
-- Enables post-hoc debugging of any journal anomaly across all modules.
--
-- Run each block separately in SQL Workshop > SQL Commands (as schema owner)
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1.  Sequence
-- ---------------------------------------------------------------------------
BEGIN
  EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_GL_VAL_LOG_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF; -- already exists
END;
/


-- ---------------------------------------------------------------------------
-- 2.  Table
-- ---------------------------------------------------------------------------
BEGIN
  EXECUTE IMMEDIATE '
    CREATE TABLE RR_GL_VALIDATION_LOG (
      LOG_ID            NUMBER         CONSTRAINT RR_GL_VAL_LOG_PK PRIMARY KEY,
      MODULE            VARCHAR2(50)   NOT NULL,
      REFERENCE_NO      VARCHAR2(200),
      BATCH_NAME        VARCHAR2(500),
      RESULT            VARCHAR2(10)   NOT NULL,
      ERROR_COUNT       NUMBER         DEFAULT 0  NOT NULL,
      WARNING_COUNT     NUMBER         DEFAULT 0  NOT NULL,
      ERROR_CATEGORIES  VARCHAR2(1000),
      ERROR_SUMMARY     VARCHAR2(4000),
      ERROR_DETAIL      CLOB,
      GL_PAYLOAD        CLOB,
      CREATED_BY        VARCHAR2(200),
      CREATION_DATE     TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT RR_GL_VAL_LOG_RESULT_CK CHECK (RESULT IN (''FAILED'',''PASSED''))
    )
  ';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX RR_GL_VAL_LOG_DATE_IX   ON RR_GL_VALIDATION_LOG (CREATION_DATE DESC)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX RR_GL_VAL_LOG_MODULE_IX ON RR_GL_VALIDATION_LOG (MODULE, RESULT)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;
/


-- ---------------------------------------------------------------------------
-- 3.  Package spec
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE RR_GL_VAL_PKG AS

  PROCEDURE insert_log (
    p_module            IN  VARCHAR2,
    p_reference_no      IN  VARCHAR2,
    p_batch_name        IN  VARCHAR2,
    p_result            IN  VARCHAR2,
    p_error_count       IN  NUMBER,
    p_warning_count     IN  NUMBER,
    p_error_categories  IN  VARCHAR2,
    p_error_summary     IN  VARCHAR2,
    p_error_detail      IN  CLOB,
    p_gl_payload        IN  CLOB,
    p_created_by        IN  VARCHAR2,
    p_log_id            OUT NUMBER
  );

  FUNCTION get_logs (
    p_module    IN VARCHAR2 DEFAULT NULL,
    p_result    IN VARCHAR2 DEFAULT NULL,
    p_date_from IN VARCHAR2 DEFAULT NULL,
    p_date_to   IN VARCHAR2 DEFAULT NULL,
    p_limit     IN NUMBER   DEFAULT 200
  ) RETURN CLOB;

END RR_GL_VAL_PKG;
/


-- ---------------------------------------------------------------------------
-- 4.  Package body
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PACKAGE BODY RR_GL_VAL_PKG AS

  -- JSON escaping helpers
  FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REPLACE(REPLACE(p, CHR(92), CHR(92)||CHR(92)), '"', CHR(92)||'"');
  END;

  FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"' || esc(p) || '"' END;
  END;

  FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE TO_CHAR(p) END;
  END;

  FUNCTION jts(p IN TIMESTAMP) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null'
           ELSE '"' || TO_CHAR(p, 'YYYY-MM-DD"T"HH24:MI:SS') || '"' END;
  END;

  -- -------------------------------------------------------------------------
  PROCEDURE insert_log (
    p_module            IN  VARCHAR2,
    p_reference_no      IN  VARCHAR2,
    p_batch_name        IN  VARCHAR2,
    p_result            IN  VARCHAR2,
    p_error_count       IN  NUMBER,
    p_warning_count     IN  NUMBER,
    p_error_categories  IN  VARCHAR2,
    p_error_summary     IN  VARCHAR2,
    p_error_detail      IN  CLOB,
    p_gl_payload        IN  CLOB,
    p_created_by        IN  VARCHAR2,
    p_log_id            OUT NUMBER
  ) IS
  BEGIN
    SELECT RR_GL_VAL_LOG_SEQ.NEXTVAL INTO p_log_id FROM DUAL;

    INSERT INTO RR_GL_VALIDATION_LOG (
      LOG_ID, MODULE, REFERENCE_NO, BATCH_NAME, RESULT,
      ERROR_COUNT, WARNING_COUNT, ERROR_CATEGORIES, ERROR_SUMMARY,
      ERROR_DETAIL, GL_PAYLOAD, CREATED_BY, CREATION_DATE
    ) VALUES (
      p_log_id,
      p_module,
      p_reference_no,
      p_batch_name,
      p_result,
      NVL(p_error_count,   0),
      NVL(p_warning_count, 0),
      p_error_categories,
      p_error_summary,
      p_error_detail,
      p_gl_payload,
      p_created_by,
      SYSTIMESTAMP
    );

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END insert_log;

  -- -------------------------------------------------------------------------
  FUNCTION get_logs (
    p_module    IN VARCHAR2 DEFAULT NULL,
    p_result    IN VARCHAR2 DEFAULT NULL,
    p_date_from IN VARCHAR2 DEFAULT NULL,
    p_date_to   IN VARCHAR2 DEFAULT NULL,
    p_limit     IN NUMBER   DEFAULT 200
  ) RETURN CLOB IS
    v_buf     CLOB := '{"items":[';
    v_first   BOOLEAN := TRUE;

    CURSOR c IS
      SELECT LOG_ID, MODULE, REFERENCE_NO, BATCH_NAME, RESULT,
             ERROR_COUNT, WARNING_COUNT, ERROR_CATEGORIES, ERROR_SUMMARY,
             ERROR_DETAIL, CREATED_BY, CREATION_DATE
      FROM   RR_GL_VALIDATION_LOG
      WHERE  (p_module    IS NULL OR MODULE = p_module)
      AND    (p_result    IS NULL OR RESULT = p_result)
      AND    (p_date_from IS NULL OR TRUNC(CAST(CREATION_DATE AS DATE)) >= TO_DATE(p_date_from, 'YYYY-MM-DD'))
      AND    (p_date_to   IS NULL OR TRUNC(CAST(CREATION_DATE AS DATE)) <= TO_DATE(p_date_to,   'YYYY-MM-DD'))
      ORDER  BY CREATION_DATE DESC
      FETCH  FIRST p_limit ROWS ONLY;

  BEGIN
    FOR r IN c LOOP
      IF NOT v_first THEN v_buf := v_buf || ','; END IF;
      v_first := FALSE;

      v_buf := v_buf || '{'
        || '"logId":'           || jnum(r.LOG_ID)           || ','
        || '"module":'          || jstr(r.MODULE)            || ','
        || '"referenceNo":'     || jstr(r.REFERENCE_NO)      || ','
        || '"batchName":'       || jstr(r.BATCH_NAME)        || ','
        || '"result":'          || jstr(r.RESULT)             || ','
        || '"errorCount":'      || jnum(r.ERROR_COUNT)       || ','
        || '"warningCount":'    || jnum(r.WARNING_COUNT)     || ','
        || '"errorCategories":' || jstr(r.ERROR_CATEGORIES)  || ','
        || '"errorSummary":'    || jstr(r.ERROR_SUMMARY)     || ','
        || '"errorDetail":'     || NVL(r.ERROR_DETAIL, 'null') || ','
        || '"createdBy":'       || jstr(r.CREATED_BY)        || ','
        || '"creationDate":'    || jts(r.CREATION_DATE)
      || '}';
    END LOOP;

    v_buf := v_buf || ']}';
    RETURN v_buf;
  END get_logs;

END RR_GL_VAL_PKG;
/


-- ---------------------------------------------------------------------------
-- 5.  ORDS handlers: GET + POST gl/validation-log
--
--  Drop the entire template first (removes all method handlers in one shot)
--  so we can safely recreate both GET and POST without residual state.
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/validation-log');
  COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Re-create the template (required before defining handlers)
BEGIN
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp',
    p_pattern     => 'gl/validation-log',
    p_priority    => 0,
    p_etag_type   => 'HASH',
    p_comments    => 'GL journal pre-flight validation log — GET (list) + POST (insert)'
  );
  COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 5a.  ORDS handler: POST gl/validation-log  (insert)
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'gl/validation-log',
    p_method        => 'POST',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => 'application/json',
    p_comments      => 'Insert a GL validation log entry',
    p_source        => q'[
DECLARE
  v_body    CLOB;
  v_log_id  NUMBER;

  v_module    VARCHAR2(50);
  v_ref_no    VARCHAR2(200);
  v_batch     VARCHAR2(500);
  v_result    VARCHAR2(10);
  v_err_cnt   NUMBER;
  v_warn_cnt  NUMBER;
  v_cats      VARCHAR2(1000);
  v_summary   VARCHAR2(4000);
  v_detail    CLOB;
  v_payload   CLOB;
  v_created   VARCHAR2(200);

BEGIN
  v_body := :body_text;

  APEX_JSON.PARSE(v_body);

  v_module   := APEX_JSON.GET_VARCHAR2(p_path => 'module');
  v_ref_no   := APEX_JSON.GET_VARCHAR2(p_path => 'referenceNo');
  v_batch    := APEX_JSON.GET_VARCHAR2(p_path => 'batchName');
  v_result   := NVL(APEX_JSON.GET_VARCHAR2(p_path => 'result'), 'FAILED');
  v_err_cnt  := NVL(APEX_JSON.GET_NUMBER(p_path => 'errorCount'), 0);
  v_warn_cnt := NVL(APEX_JSON.GET_NUMBER(p_path => 'warningCount'), 0);
  v_cats     := APEX_JSON.GET_VARCHAR2(p_path => 'errorCategories');
  v_summary  := APEX_JSON.GET_VARCHAR2(p_path => 'errorSummary');
  v_created  := APEX_JSON.GET_VARCHAR2(p_path => 'createdBy');

  -- errorDetail and glPayload are nested JSON — extract as raw text
  BEGIN
    SELECT JSON_QUERY(v_body, '$.errorDetail' RETURNING CLOB WITH CONDITIONAL WRAPPER)
    INTO   v_detail FROM DUAL;
  EXCEPTION WHEN OTHERS THEN v_detail := NULL;
  END;

  BEGIN
    SELECT JSON_QUERY(v_body, '$.glPayload' RETURNING CLOB WITH CONDITIONAL WRAPPER)
    INTO   v_payload FROM DUAL;
  EXCEPTION WHEN OTHERS THEN v_payload := NULL;
  END;

  RR_GL_VAL_PKG.insert_log(
    p_module           => v_module,
    p_reference_no     => v_ref_no,
    p_batch_name       => v_batch,
    p_result           => v_result,
    p_error_count      => v_err_cnt,
    p_warning_count    => v_warn_cnt,
    p_error_categories => v_cats,
    p_error_summary    => v_summary,
    p_error_detail     => v_detail,
    p_gl_payload       => v_payload,
    p_created_by       => v_created,
    p_log_id           => v_log_id
  );

  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"success":true,"logId":' || v_log_id || '}');

EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"message":' || '"' || REPLACE(SQLERRM,'"','\"') || '"' || '}');
END;]'
  );
  COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 5b.  ORDS handler: GET gl/validation-log  (list)
-- ---------------------------------------------------------------------------
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name   => 'reerp',
    p_pattern       => 'gl/validation-log',
    p_method        => 'GET',
    p_source_type   => 'plsql/block',
    p_mimes_allowed => '',
    p_comments      => 'List GL validation log entries',
    p_source        => q'[
DECLARE
  v_result CLOB;
BEGIN
  v_result := RR_GL_VAL_PKG.get_logs(
    p_module    => :module,
    p_result    => :result,
    p_date_from => :date_from,
    p_date_to   => :date_to,
    p_limit     => NVL(TO_NUMBER(:limit), 200)
  );
  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(v_result);
EXCEPTION
  WHEN OTHERS THEN
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"message":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;]'
  );
  COMMIT;
END;
/
