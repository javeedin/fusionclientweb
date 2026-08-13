-- ============================================================
-- GET reerp/SYNC/jebatches
-- Returns JE_BATCH_ID values from RR_GL_JOURNAL_BATCHES
-- so that syncGLHeadersOnly can fetch headers from Oracle
-- Fusion for each known batch.
--
-- Optional query param: PERIOD_NAME (filters by period)
-- Response: { "items": [{ "je_batch_id": N }, ...] }
-- ============================================================

BEGIN
    -- Ensure the template exists (no-op if already there)
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'SYNC/jebatches'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'SYNC/jebatches',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_comments       => 'Return JE_BATCH_ID list for GL Headers sync',
        p_source         => q'[
DECLARE
    v_period  VARCHAR2(15) := :PERIOD_NAME;
BEGIN
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.OPEN_ARRAY('items');

    FOR rec IN (
        SELECT JE_BATCH_ID
        FROM   RR_GL_JOURNAL_BATCHES
        WHERE  (v_period IS NULL OR DEFAULT_PERIOD_NAME = v_period)
        ORDER  BY JE_BATCH_ID
    ) LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('je_batch_id', rec.JE_BATCH_ID);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    :status_code := 200;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET SYNC/jebatches registered');
END;
/
