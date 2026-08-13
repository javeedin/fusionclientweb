-- ============================================================
-- APEX REST Handler for GL Journal Batches
-- POST endpoint to receive and insert journal batches
-- ============================================================

-- NOTE: Run this in APEX SQL Workshop or via ORDS REST Service setup
-- Endpoint: POST /ords/bcldifc/reerp/gl/journalbatches

BEGIN
    -- Create ORDS Module (if not exists)
    ORDS.DEFINE_MODULE(
        p_module_name    => 'reerp',
        p_base_path      => '/reerp/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => 'ReactERP Integration Module'
    );

    -- Create Template for GL Journal Batches
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journalbatches',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'GL Journal Batches endpoint'
    );

    -- Create POST Handler
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journalbatches',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Insert GL Journal Batches from Oracle Fusion',
        p_source         => q'[
DECLARE
    v_json_data     CLOB;
    v_success_count NUMBER := 0;
    v_error_count   NUMBER := 0;
    v_result        VARCHAR2(4000);
BEGIN
    -- Get JSON body
    v_json_data := :body_text;

    -- Call package procedure to insert batches
    REERP_GL_JOURNAL_PKG.insert_journal_batches(
        p_json_data     => v_json_data,
        p_success_count => v_success_count,
        p_error_count   => v_error_count,
        p_result        => v_result
    );

    -- Return response
    :status_code := 200;

    HTP.P('{');
    HTP.P('  "success": true,');
    HTP.P('  "successCount": ' || v_success_count || ',');
    HTP.P('  "errorCount": ' || v_error_count || ',');
    HTP.P('  "message": "' || v_result || '"');
    HTP.P('}');

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{');
        HTP.P('  "success": false,');
        HTP.P('  "error": "' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.P('}');
END;
]'
    );

    -- Create GET Handler (to retrieve journal batches)
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journalbatches',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 100,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get GL Journal Batches',
        p_source         => q'[
SELECT
    JOURNAL_BATCH_ID,
    JOURNAL_NAME,
    JOURNAL_DESCRIPTION,
    PERIOD_NAME,
    DEFAULT_EFFECTIVE_DATE,
    CURRENCY_CODE,
    RUNNING_TOTAL_DR,
    RUNNING_TOTAL_CR,
    LEDGER_NAME,
    USER_JE_CATEGORY_NAME,
    SYNC_DATE,
    SYNC_STATUS
FROM REERP_GL_JOURNAL_BATCHES
ORDER BY SYNC_DATE DESC
]'
    );

    COMMIT;
END;
/

-- ============================================================
-- Alternative: Simple REST Handler (if ORDS.DEFINE not available)
-- Use this approach in APEX SQL Workshop > RESTful Services
-- ============================================================

/*
-- Module: reerp
-- Template: gl/journalbatches
-- Handler: POST
-- Source Type: PL/SQL Block
-- Source:

DECLARE
    v_json_data     CLOB;
    v_success_count NUMBER := 0;
    v_error_count   NUMBER := 0;
    v_result        VARCHAR2(4000);
    v_items_count   NUMBER := 0;
BEGIN
    -- Get JSON body from request
    v_json_data := :body_text;

    -- Log incoming request (optional - for debugging)
    INSERT INTO REERP_SYNC_LOG (LOG_MESSAGE, LOG_DATE)
    VALUES ('Received POST request with ' || NVL(LENGTH(v_json_data), 0) || ' bytes', SYSTIMESTAMP);

    -- Count items in JSON array
    SELECT COUNT(*) INTO v_items_count
    FROM JSON_TABLE(v_json_data, '$.items[*]' COLUMNS (dummy VARCHAR2(1) PATH '$'));

    -- Process each item
    REERP_GL_JOURNAL_PKG.insert_journal_batches(
        p_json_data     => v_json_data,
        p_success_count => v_success_count,
        p_error_count   => v_error_count,
        p_result        => v_result
    );

    -- Set response
    :status_code := 200;

    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('successCount', v_success_count);
    APEX_JSON.WRITE('errorCount', v_error_count);
    APEX_JSON.WRITE('totalReceived', v_items_count);
    APEX_JSON.WRITE('message', v_result);
    APEX_JSON.CLOSE_OBJECT;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;

*/

-- ============================================================
-- Optional: Create sync log table for debugging
-- ============================================================

CREATE TABLE REERP_SYNC_LOG (
    LOG_ID      NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    LOG_DATE    TIMESTAMP DEFAULT SYSTIMESTAMP,
    LOG_TYPE    VARCHAR2(20) DEFAULT 'INFO',
    LOG_MESSAGE VARCHAR2(4000),
    LOG_DETAILS CLOB
);

-- Grant privileges (run as admin if needed)
-- GRANT EXECUTE ON REERP_GL_JOURNAL_PKG TO ORDS_PUBLIC_USER;
-- GRANT INSERT, SELECT ON REERP_GL_JOURNAL_BATCHES TO ORDS_PUBLIC_USER;
