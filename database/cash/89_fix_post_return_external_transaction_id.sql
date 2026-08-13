-- ============================================================
-- Patch 89: Fix POST /cash/externaltransactions to always return
--           externalTransactionId in the response.
--
-- Problem: response was {"status":"success","count":1} with no ID
--          when ReferenceText was blank (manual transactions).
--
-- Fix: read ExternalTransactionId from the JSON first; if null
--      (sequence-generated), find the row by SYNC_DATE >= timestamp
--      captured before the insert.
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'cash/externaltransactions',
        p_method      => 'POST'
    );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync external cash transactions — always returns externalTransactionId',
        p_source         => q'[
DECLARE
    l_json        CLOB;
    l_count       NUMBER;
    l_error       VARCHAR2(4000);
    l_ext_id      NUMBER;
    l_json_ext_id NUMBER;
    l_ts_before   TIMESTAMP;
BEGIN
    l_json := :body_text;

    -- 1. Try to read ExternalTransactionId directly from the request JSON
    BEGIN
        SELECT TO_NUMBER(ext_id) INTO l_json_ext_id
        FROM JSON_TABLE(l_json, '$.items[0]'
            COLUMNS (ext_id VARCHAR2(30) PATH '$.ExternalTransactionId')) t;
    EXCEPTION WHEN OTHERS THEN l_json_ext_id := NULL; END;

    -- Capture timestamp before insert so we can find the new row if ID was not supplied
    l_ts_before := SYSTIMESTAMP;

    RR_SYNC_EXTERNAL_CASH_TRANSACTIONS(
        p_json  => l_json,
        p_count => l_count,
        p_error => l_error
    );

    IF l_error IS NOT NULL THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(l_error, '"', '\"') || '"}');
    ELSE
        IF l_json_ext_id IS NOT NULL THEN
            -- ID came from the request — use it directly
            l_ext_id := l_json_ext_id;
        ELSE
            -- Manual transaction: sequence fired inside the procedure.
            -- Find the row inserted in this same DB session (SYNC_DATE >= our timestamp).
            BEGIN
                SELECT EXTERNAL_TRANSACTION_ID INTO l_ext_id
                FROM (
                    SELECT EXTERNAL_TRANSACTION_ID
                      FROM RR_EXTERNAL_CASH_TRANSACTIONS
                     WHERE SYNC_DATE >= l_ts_before
                     ORDER BY EXTERNAL_TRANSACTION_ID DESC
                )
                WHERE ROWNUM = 1;
            EXCEPTION WHEN OTHERS THEN l_ext_id := NULL; END;
        END IF;

        :status_code := 200;
        IF l_ext_id IS NOT NULL THEN
            HTP.P('{"status":"success","count":' || l_count || ',"externalTransactionId":' || l_ext_id || '}');
        ELSE
            HTP.P('{"status":"success","count":' || l_count || '}');
        END IF;
    END IF;
END;
]'
    );

    COMMIT;
END;
/
