-- ============================================================
-- Patch 88: DELETE /cash/externaltransactions/:externalTransactionId
--
-- Workaround: ORDS is not binding :externalTransactionId for the DELETE
-- method (path param comes through as NULL). This version reads the
-- actual request URL via OWA_UTIL.get_cgi_env('PATH_INFO') and
-- extracts the transaction ID from the last URL segment manually.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — paste and run as one block.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId',
            p_priority    => 0,
            p_etag_type   => 'HASH',
            p_comments    => 'Single external cash transaction operations'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:externalTransactionId',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Delete external cash transaction — reads ID from URL path',
        p_source         => q'[
DECLARE
    v_path VARCHAR2(1000);
    v_raw  VARCHAR2(200);
    v_id   NUMBER;
    l_flag VARCHAR2(1);
    l_rows NUMBER;
BEGIN
    -- Read path parameter from URL: prefer bind var, fall back to URL parsing
    v_raw := :externalTransactionId;

    IF v_raw IS NULL THEN
        -- Fallback: extract last numeric segment from request PATH_INFO
        -- e.g. /ords/bcldifc/reerp/cash/externaltransactions/1000000087
        v_path := OWA_UTIL.get_cgi_env('PATH_INFO');
        v_raw  := REGEXP_SUBSTR(v_path, '[0-9]+$');
    END IF;

    IF v_raw IS NULL THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Could not determine transaction ID from request","path":"' || NVL(v_path,'null') || '"}');
        RETURN;
    END IF;

    BEGIN
        v_id := TO_NUMBER(v_raw);
    EXCEPTION WHEN OTHERS THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Invalid transaction ID: ' || v_raw || '"}');
        RETURN;
    END;

    BEGIN
        SELECT NVL(ACCOUNTING_FLAG, 'N')
          INTO l_flag
          FROM RR_EXTERNAL_CASH_TRANSACTIONS
         WHERE EXTERNAL_TRANSACTION_ID = v_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.PRN('{"status":"error","message":"Transaction not found","id":' || v_id || ',"path":"' || NVL(v_path,'') || '"}');
            RETURN;
    END;

    IF l_flag = 'Y' THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Cannot delete an accounted transaction","id":' || v_id || '}');
        RETURN;
    END IF;

    DELETE FROM RR_EXTERNAL_CASH_TRANSACTIONS
     WHERE EXTERNAL_TRANSACTION_ID = v_id;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"status":"error","message":"Transaction not found","id":' || v_id || '}');
    ELSE
        :status_code := 200;
        HTP.PRN('{"status":"success","message":"Transaction deleted","externalTransactionId":' || v_id || '}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.PRN('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || ',"id":"' || NVL(v_raw,'NULL') || '"}');
END;
]'
    );

    COMMIT;
END;
/
