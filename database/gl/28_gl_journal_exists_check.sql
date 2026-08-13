-- =============================================================================
-- 28_GL_JOURNAL_EXISTS_CHECK.SQL
--
-- ORDS GET handler: /reerp/gl/journals/check
--
-- Checks whether a GL journal already exists for a given source transaction
-- using the REFERENCE columns stored on RR_GL_JE_LINES_ALL.
--
-- Parameters (query string):
--   reference1  — source identifier 1  (e.g. invoice number)
--   reference2  — source identifier 2  (e.g. invoice ID)
--   reference5  — subledger event type (e.g. AP-INVOICE-CREATION)
--                 if omitted, matches any reference5 value
--
-- Response:
--   {
--     "exists":    true/false,
--     "batchId":   <number|null>,
--     "headerId":  <number|null>,
--     "status":    "P"|"NEW"|null,   -- P = Posted
--     "period":    "Apr-26"|null,
--     "lineCount": <number>
--   }
--
-- Purpose: idempotency guard — callers check this before calling
--          journals/create to prevent duplicate GL journal entries.
-- =============================================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'gl/journals/check');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/check',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Check if a GL journal already exists for a source transaction'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/check',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns exists flag + batchId/headerId/status for the matching journal',
        p_source         => q'[
DECLARE
    v_batch_id   NUMBER  := NULL;
    v_header_id  NUMBER  := NULL;
    v_status     VARCHAR2(30) := NULL;
    v_period     VARCHAR2(15) := NULL;
    v_count      NUMBER  := 0;
BEGIN
    -- Match on reference1 + reference2, optionally filter by reference5
    SELECT COUNT(*),
           MIN(h.BATCH_ID),
           MIN(l.JE_HEADER_ID),
           MIN(b.STATUS),
           MIN(h.PERIOD_NAME)
    INTO   v_count, v_batch_id, v_header_id, v_status, v_period
    FROM   RR_GL_JE_LINES_ALL     l
    JOIN   RR_GL_JE_HEADERS       h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    JOIN   RR_GL_JOURNAL_BATCHES  b ON b.JE_BATCH_ID  = h.BATCH_ID
    WHERE  l.REFERENCE1 = :reference1
      AND  l.REFERENCE2 = :reference2
      AND  (:reference5 IS NULL OR l.REFERENCE5 = :reference5);

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('exists',    v_count > 0);
    APEX_JSON.WRITE('batchId',   v_batch_id);
    APEX_JSON.WRITE('headerId',  v_header_id);
    APEX_JSON.WRITE('status',    v_status);
    APEX_JSON.WRITE('period',    v_period);
    APEX_JSON.WRITE('lineCount', v_count);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('exists', FALSE);
        APEX_JSON.WRITE('error',  SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
        ]'
    );
    COMMIT;
END;
/

-- Verify
SELECT module_name, uri_template, method
FROM   user_ords_handlers
WHERE  module_name = 'reerp'
  AND  uri_template = 'gl/journals/check';
