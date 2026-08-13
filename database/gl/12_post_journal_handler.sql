-- =============================================================================
-- 12_POST_JOURNAL_HANDLER.SQL
-- Adds a PUT endpoint to post a journal batch:
--   PUT reerp/gl/journals/:jeBatchId/post
--
-- Updates RR_GL_JOURNAL_BATCHES status to 'P' / 'Posted' for the given batch.
-- =============================================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/:jeBatchId/post',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Post a GL journal batch'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/:jeBatchId/post',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            DECLARE
                v_rows_updated NUMBER := 0;
            BEGIN
                UPDATE RR_GL_JOURNAL_BATCHES
                SET    STATUS         = 'P',
                       STATUS_MEANING = 'Posted',
                       POSTED_DATE   = SYSDATE
                WHERE  JE_BATCH_ID   = :jeBatchId;

                v_rows_updated := SQL%ROWCOUNT;
                COMMIT;

                :status := 200;
                APEX_JSON.OPEN_OBJECT;
                APEX_JSON.WRITE('success',    TRUE);
                APEX_JSON.WRITE('message',    'Journal batch posted successfully');
                APEX_JSON.WRITE('jeBatchId',  TO_NUMBER(:jeBatchId));
                APEX_JSON.WRITE('rowsUpdated', v_rows_updated);
                APEX_JSON.CLOSE_OBJECT;
            EXCEPTION
                WHEN OTHERS THEN
                    ROLLBACK;
                    :status := 500;
                    APEX_JSON.OPEN_OBJECT;
                    APEX_JSON.WRITE('success', FALSE);
                    APEX_JSON.WRITE('error',   SQLERRM);
                    APEX_JSON.CLOSE_OBJECT;
            END;
        ]'
    );
    COMMIT;
END;
/
