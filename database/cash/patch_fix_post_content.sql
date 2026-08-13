-- ============================================================
-- PATCH v8: Change FILE_CONTENT to BLOB + JSON_OBJECT_T upload
--           Mirrors RR_AP_INVOICE_ATTACHMENTS exactly.
--
-- HOW TO RUN: SQL Workshop → SQL Commands
--   Copy the entire BEGIN...END; block, paste, Run.
--   Expected: "PL/SQL procedure successfully completed."
--
-- REQUEST FORMAT:
--   POST  .../attachments
--   Content-Type: application/json
--   Body: { "fileName":"...", "fileType":"...", "fileSize":N,
--           "content":"<base64>", "createdBy":"..." }
-- ============================================================

BEGIN
    -- Step 1: Rename old CLOB column, add new BLOB column
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_TRX_ATTACHMENTS RENAME COLUMN FILE_CONTENT TO FILE_CONTENT_CLB';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        EXECUTE IMMEDIATE 'ALTER TABLE RR_EXTERNAL_TRX_ATTACHMENTS ADD (FILE_CONTENT BLOB)';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Step 2: Remove old POST handler
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId/attachments',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Step 3: Define new POST handler — stores raw BLOB
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:externalTransactionId/attachments',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Upload attachment v8 - stores BLOB',
        p_source         => q'[
DECLARE
    v_blob       BLOB := :body;
    v_blob_len   INTEGER;
    v_body_clob  CLOB;
    v_dest_off   INTEGER := 1;
    v_src_off    INTEGER := 1;
    v_lang_ctx   INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    v_warning    INTEGER;
    v_json       JSON_OBJECT_T;
    v_file_name  VARCHAR2(500);
    v_file_type  VARCHAR2(100);
    v_file_size  NUMBER;
    v_created_by VARCHAR2(150);
    v_b64_clob   CLOB;
    v_content    BLOB;
    v_new_id     NUMBER;
BEGIN
    v_blob_len := CASE WHEN v_blob IS NULL THEN 0 ELSE DBMS_LOB.GETLENGTH(v_blob) END;
    IF v_blob_len = 0 THEN
        HTP.P('{"status":"error","message":"empty body"}');
        RETURN;
    END IF;

    -- Convert body BLOB to CLOB for JSON parsing
    DBMS_LOB.CREATETEMPORARY(v_body_clob, TRUE);
    DBMS_LOB.CONVERTTOCLOB(
        v_body_clob, v_blob, DBMS_LOB.LOBMAXSIZE,
        v_dest_off, v_src_off,
        NLS_CHARSET_ID('AL32UTF8'), v_lang_ctx, v_warning
    );

    -- Parse JSON and extract fields
    v_json       := JSON_OBJECT_T.PARSE(v_body_clob);
    v_file_name  := v_json.GET_STRING('fileName');
    v_file_type  := v_json.GET_STRING('fileType');
    v_file_size  := v_json.GET_NUMBER('fileSize');
    v_created_by := v_json.GET_STRING('createdBy');
    v_b64_clob   := v_json.GET_CLOB('content');

    -- Decode base64 → BLOB (reuse invoice attachment package)
    RR_AP_ATTACH_PKG.base64_to_blob(p_base64 => v_b64_clob, p_blob => v_content);

    INSERT INTO RR_EXTERNAL_TRX_ATTACHMENTS
        (EXTERNAL_TRANSACTION_ID, FILE_NAME, FILE_TYPE, FILE_SIZE, FILE_CONTENT, CREATED_BY)
    VALUES
        (:externalTransactionId, v_file_name, v_file_type, v_file_size, v_content,
         NVL(v_created_by, 'SYSTEM'))
    RETURNING ID INTO v_new_id;

    COMMIT;
    HTP.P('{"status":"success","id":' || v_new_id
        || ',"bodyLen":'       || v_blob_len
        || ',"blobLength":'    || NVL(DBMS_LOB.GETLENGTH(v_content), 0)
        || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM)
        || ',"bodyLen":' || NVL(v_blob_len, -1) || '}');
END;
]'
    );
    COMMIT;
END;
/
