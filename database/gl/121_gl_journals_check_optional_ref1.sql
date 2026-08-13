-- =============================================================================
-- 121_GL_JOURNALS_CHECK_OPTIONAL_REF1.SQL
--
-- Make reference1 OPTIONAL in GET /reerp/gl/journals/check.
--
-- Why:
--   AR receipt journals store REFERENCE1 = receipt number (a long, free-text
--   value that can contain '#', spaces, etc.) and REFERENCE2 = standard receipt
--   id, REFERENCE5 = 'AR_RECEIPTS'. Matching on the messy REFERENCE1 is fragile;
--   the receipt is uniquely identified by REFERENCE2 + REFERENCE5 alone. This
--   mirrors how other modules retrieve their journal by reference2 + reference5.
--
--   Previously the handler required l.REFERENCE1 = :reference1, so callers that
--   only knew reference2/reference5 (e.g. View Accounting) could not find the
--   journal. Now reference1 is optional: pass it blank to match on
--   reference2 (+ optional reference5) only.
--
-- Parameters (query string):
--   reference1  — optional; if blank/NULL, matches any reference1
--   reference2  — source identifier 2 (e.g. standard receipt id)  [required]
--   reference5  — subledger event type (e.g. AR_RECEIPTS); optional
--
-- Run in APEX SQL Workshop -> SQL Commands.
-- =============================================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/check',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns exists flag + batchId/headerId/status; reference1 optional (match by reference2 + reference5)',
        p_source         => q'[
DECLARE
    v_batch_id   NUMBER  := NULL;
    v_header_id  NUMBER  := NULL;
    v_status     VARCHAR2(30) := NULL;
    v_period     VARCHAR2(15) := NULL;
    v_count      NUMBER  := 0;
BEGIN
    -- Match on reference2, optionally filter by reference1 and reference5.
    -- reference1 is optional so a caller that only knows reference2 + reference5
    -- (e.g. the receipt View Accounting screen) can still find the journal.
    SELECT COUNT(*),
           MIN(h.BATCH_ID),
           MIN(l.JE_HEADER_ID),
           MIN(b.STATUS),
           MIN(h.PERIOD_NAME)
    INTO   v_count, v_batch_id, v_header_id, v_status, v_period
    FROM   RR_GL_JE_LINES_ALL     l
    JOIN   RR_GL_JE_HEADERS       h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    JOIN   RR_GL_JOURNAL_BATCHES  b ON b.JE_BATCH_ID  = h.BATCH_ID
    WHERE  l.REFERENCE2 = :reference2
      AND  (:reference1 IS NULL OR l.REFERENCE1 = :reference1)
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
