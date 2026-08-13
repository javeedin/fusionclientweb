-- ============================================================
-- GET cash/externaltransactions/batchstatus/:ids
-- Returns STATUS + ACCOUNTING_FLAG for a slash-delimited path
-- of comma-separated external transaction IDs.
-- Usage: GET .../batchstatus/101,102,103
--        GET .../batchstatus/1000000014
-- Run this in Oracle APEX SQL Workshop (reerp module must exist)
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/batchstatus',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DELETE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/batchstatus'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/batchstatus/:ids',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DELETE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/batchstatus/:ids'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/externaltransactions/batchstatus/:ids',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Batch-fetch STATUS + ACCOUNTING_FLAG for comma-separated bank transaction IDs'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/batchstatus/:ids',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => ':ids = comma-separated EXTERNAL_TRANSACTION_ID values in the URL path',
        p_source         => q'[
DECLARE
    l_json  VARCHAR2(32767) := '[';
    l_first BOOLEAN         := TRUE;
BEGIN
    FOR r IN (
        SELECT t.EXTERNAL_TRANSACTION_ID,
               t.STATUS,
               NVL(t.ACCOUNTING_FLAG, 'N') AS ACCOUNTING_FLAG
        FROM   RR_EXTERNAL_CASH_TRANSACTIONS t
        WHERE  INSTR(',' || :ids || ',',
                     ',' || TO_CHAR(t.EXTERNAL_TRANSACTION_ID) || ',') > 0
        ORDER  BY t.EXTERNAL_TRANSACTION_ID
    ) LOOP
        IF NOT l_first THEN l_json := l_json || ','; END IF;
        l_json := l_json
            || '{"externalTransactionId":' || r.EXTERNAL_TRANSACTION_ID
            || ',"status":"'         || REPLACE(r.STATUS,          '"', '\"') || '"'
            || ',"accountingFlag":"' || REPLACE(r.ACCOUNTING_FLAG, '"', '\"') || '"'
            || '}';
        l_first := FALSE;
    END LOOP;

    l_json := l_json || ']';
    :status_code := 200;
    HTP.PRN('{"items":' || l_json || '}');
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    HTP.PRN('{"items":[],"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/
