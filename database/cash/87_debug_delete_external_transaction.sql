-- ============================================================
-- Patch 87: Debug DELETE /cash/externaltransactions/:externalTransactionId
--
-- Adds raw bind variable value to every response so we can see
-- exactly what ORDS is passing. Also uses string comparison to
-- avoid any NUMBER/VARCHAR2 implicit conversion issues.
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
        p_comments       => 'Delete external cash transaction (debug version)',
        p_source         => q'[
DECLARE
    v_raw  VARCHAR2(200) := :externalTransactionId;
    l_flag VARCHAR2(1);
    l_rows NUMBER;
    l_count NUMBER := 0;
BEGIN
    -- Check what value ORDS bound to the path parameter
    IF v_raw IS NULL THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"externalTransactionId bind variable is NULL — ORDS did not bind the path parameter"}');
        RETURN;
    END IF;

    -- Use string comparison to avoid implicit NUMBER conversion issues
    BEGIN
        SELECT NVL(ACCOUNTING_FLAG, 'N'), COUNT(*) OVER ()
          INTO l_flag, l_count
          FROM RR_EXTERNAL_CASH_TRANSACTIONS
         WHERE TO_CHAR(EXTERNAL_TRANSACTION_ID) = v_raw;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN l_count := 0;
    END;

    IF l_count = 0 THEN
        :status_code := 404;
        HTP.PRN('{"status":"error","message":"Transaction not found","receivedId":"' || v_raw || '"}');
        RETURN;
    END IF;

    IF l_flag = 'Y' THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Cannot delete an accounted transaction","receivedId":"' || v_raw || '"}');
        RETURN;
    END IF;

    DELETE FROM RR_EXTERNAL_CASH_TRANSACTIONS
     WHERE TO_CHAR(EXTERNAL_TRANSACTION_ID) = v_raw;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"status":"error","message":"Transaction not found after delete attempt","receivedId":"' || v_raw || '"}');
    ELSE
        :status_code := 200;
        HTP.PRN('{"status":"success","message":"Transaction deleted","receivedId":"' || v_raw || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.PRN('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || ',"receivedId":"' || NVL(v_raw,'NULL') || '"}');
END;
]'
    );

    COMMIT;
END;
/
