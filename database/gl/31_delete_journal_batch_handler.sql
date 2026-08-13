-- ============================================================
-- DELETE /journals/batches/:batchId
-- Cascades: lines → headers → batch
-- Only allowed when batch status is NOT 'P' (Posted)
-- ============================================================

DECLARE
    v_batch_id   NUMBER       := :batchId;
    v_status     VARCHAR2(10);
    v_line_cnt   NUMBER := 0;
    v_hdr_cnt    NUMBER := 0;
    v_result     JSON_OBJECT_T := JSON_OBJECT_T();
BEGIN
    :content_type := 'application/json; charset=utf-8';

    -- Validate batch exists and is not posted
    BEGIN
        SELECT STATUS_MEANING
        INTO   v_status
        FROM   RR_GL_JOURNAL_BATCHES
        WHERE  JE_BATCH_ID = v_batch_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.P('{"status":"error","message":"Batch not found","batchId":' || v_batch_id || '}');
            RETURN;
    END;

    IF UPPER(v_status) IN ('P', 'POSTED') THEN
        :status_code := 409;
        HTP.P('{"status":"error","message":"Cannot delete a posted batch","batchId":' || v_batch_id || '}');
        RETURN;
    END IF;

    -- 1. Delete all lines belonging to this batch
    DELETE FROM RR_GL_JE_LINES_ALL
    WHERE  BATCH_ID = v_batch_id;
    v_line_cnt := SQL%ROWCOUNT;

    -- 2. Delete all headers belonging to this batch
    DELETE FROM RR_GL_JE_HEADERS
    WHERE  BATCH_ID = v_batch_id;
    v_hdr_cnt := SQL%ROWCOUNT;

    -- 3. Delete the batch itself
    DELETE FROM RR_GL_JOURNAL_BATCHES
    WHERE  JE_BATCH_ID = v_batch_id;

    COMMIT;

    :status_code := 200;
    v_result.put('status',       'SUCCESS');
    v_result.put('batchId',      v_batch_id);
    v_result.put('headersDeleted', v_hdr_cnt);
    v_result.put('linesDeleted',   v_line_cnt);
    HTP.P(v_result.to_clob());

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '","batchId":' || v_batch_id || '}');
END;
/

-- ============================================================
-- Register with ORDS
-- Module: reerp (already exists)
-- Template: gl/journals/batches/:batchId
-- ============================================================
BEGIN
    -- Remove old handler if re-running
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name   => 'reerp',
            p_pattern       => 'gl/journals/batches/:batchId',
            p_method        => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Ensure template exists
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'gl/journals/batches/:batchId'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name   => 'reerp',
        p_pattern       => 'gl/journals/batches/:batchId',
        p_method        => 'DELETE',
        p_source_type   => ORDS.source_type_plsql,
        p_source        => q'[
DECLARE
    v_batch_id   NUMBER       := :batchId;
    v_status     VARCHAR2(10);
    v_line_cnt   NUMBER := 0;
    v_hdr_cnt    NUMBER := 0;
    v_result     JSON_OBJECT_T := JSON_OBJECT_T();
BEGIN
    :content_type := 'application/json; charset=utf-8';

    BEGIN
        SELECT STATUS_MEANING
        INTO   v_status
        FROM   RR_GL_JOURNAL_BATCHES
        WHERE  JE_BATCH_ID = v_batch_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.P('{"status":"error","message":"Batch not found","batchId":' || v_batch_id || '}');
            RETURN;
    END;

    IF UPPER(v_status) IN ('P', 'POSTED') THEN
        :status_code := 409;
        HTP.P('{"status":"error","message":"Cannot delete a posted batch","batchId":' || v_batch_id || '}');
        RETURN;
    END IF;

    DELETE FROM RR_GL_JE_LINES_ALL  WHERE BATCH_ID = v_batch_id;
    v_line_cnt := SQL%ROWCOUNT;

    DELETE FROM RR_GL_JE_HEADERS    WHERE BATCH_ID = v_batch_id;
    v_hdr_cnt := SQL%ROWCOUNT;

    DELETE FROM RR_GL_JOURNAL_BATCHES WHERE JE_BATCH_ID = v_batch_id;

    COMMIT;

    :status_code := 200;
    v_result.put('status',         'SUCCESS');
    v_result.put('batchId',        v_batch_id);
    v_result.put('headersDeleted', v_hdr_cnt);
    v_result.put('linesDeleted',   v_line_cnt);
    HTP.P(v_result.to_clob());

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '","batchId":' || v_batch_id || '}');
END;
]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('DELETE /journals/batches/:batchId registered successfully');
END;
/
