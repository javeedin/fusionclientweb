-- ============================================================
-- New endpoint: POST gl/revaluation/:id/accounting
--
-- Dedicated status-update handler that ONLY updates:
--   STATUS, GL_BATCH_ID, GL_BATCH_NAME, GL_HEADER_ID
--
-- Completely separate from the PUT full-body handler.
-- Called by the Create Accounting flow in ManageRevaluation.
--
-- Body:
--   { "status": "ACCOUNTED",
--     "gl_batch_id": 123,
--     "gl_batch_name": "REVAL-...",
--     "gl_header_id": 456 }
-- ============================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/revaluation/:id/accounting',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Update revaluation accounting status and GL batch reference',
        p_source         => q'[
DECLARE
    v_id          NUMBER  := TO_NUMBER(:id);
    v_body        CLOB    := :body_text;
    v_status      VARCHAR2(20);
    v_batch_id    NUMBER;
    v_batch_name  VARCHAR2(240);
    v_header_id   NUMBER;
    v_rows        NUMBER;
BEGIN
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
    COMMIT;

    IF v_rows = 0 THEN
        :status_code := 404;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status', 'ERROR');
        APEX_JSON.WRITE('error',  'Revaluation not found: ' || v_id);
        APEX_JSON.CLOSE_OBJECT;
    ELSE
        :status_code := 200;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('status',     'SUCCESS');
        APEX_JSON.WRITE('revalueId',  v_id);
        APEX_JSON.WRITE('newStatus',  v_status);
        APEX_JSON.WRITE('glBatchId',  v_batch_id);
        APEX_JSON.WRITE('glBatchName',v_batch_name);
        APEX_JSON.WRITE('glHeaderId', v_header_id);
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
    DBMS_OUTPUT.PUT_LINE('POST gl/revaluation/:id/accounting handler created');
END;
/
