-- ============================================================
-- Patch 85: DELETE /cash/externaltransactions/:externalTransactionId
--
-- Creates the DELETE handler for single external cash transactions.
-- Refuses deletion when ACCOUNTING_FLAG = 'Y'.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — paste and run as one block.
-- ============================================================

BEGIN
    -- Drop existing handler if present (idempotent)
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Template already exists (PUT handler from patch 74 created it)
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
        p_comments       => 'Delete external cash transaction — blocked if already accounted',
        p_source         => q'[
DECLARE
    l_flag VARCHAR2(1);
    l_rows NUMBER;
BEGIN
    BEGIN
        SELECT NVL(ACCOUNTING_FLAG, 'N')
          INTO l_flag
          FROM RR_EXTERNAL_CASH_TRANSACTIONS
         WHERE EXTERNAL_TRANSACTION_ID = :externalTransactionId;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.PRN('{"status":"error","message":"Transaction not found"}');
            RETURN;
    END;

    IF l_flag = 'Y' THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Cannot delete an accounted transaction"}');
        RETURN;
    END IF;

    DELETE FROM RR_EXTERNAL_CASH_TRANSACTIONS
     WHERE EXTERNAL_TRANSACTION_ID = :externalTransactionId;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"status":"error","message":"Transaction not found"}');
    ELSE
        :status_code := 200;
        HTP.PRN('{"status":"success","message":"Transaction deleted"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.PRN('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );

    COMMIT;
END;
/
