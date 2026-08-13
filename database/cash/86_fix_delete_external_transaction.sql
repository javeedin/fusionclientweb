-- ============================================================
-- Patch 86: Fix DELETE /cash/externaltransactions/:externalTransactionId
--
-- Patch 85 omitted TO_NUMBER() on the bind variable; comparing a NUMBER
-- column directly against a VARCHAR2 bind can silently yield NO_DATA_FOUND.
-- This patch redeploys the handler using TO_NUMBER() consistently, matching
-- the pattern used in patch 74 (PUT reconcile handler).
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
        p_comments       => 'Delete external cash transaction — blocked if already accounted',
        p_source         => q'[
DECLARE
    v_id   NUMBER;
    l_flag VARCHAR2(1);
    l_rows NUMBER;
BEGIN
    v_id := TO_NUMBER(:externalTransactionId);

    BEGIN
        SELECT NVL(ACCOUNTING_FLAG, 'N')
          INTO l_flag
          FROM RR_EXTERNAL_CASH_TRANSACTIONS
         WHERE EXTERNAL_TRANSACTION_ID = v_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.PRN('{"status":"error","message":"Transaction not found: ' || v_id || '"}');
            RETURN;
    END;

    IF l_flag = 'Y' THEN
        :status_code := 400;
        HTP.PRN('{"status":"error","message":"Cannot delete an accounted transaction"}');
        RETURN;
    END IF;

    DELETE FROM RR_EXTERNAL_CASH_TRANSACTIONS
     WHERE EXTERNAL_TRANSACTION_ID = v_id;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.PRN('{"status":"error","message":"Transaction not found: ' || v_id || '"}');
    ELSE
        :status_code := 200;
        HTP.PRN('{"status":"success","message":"Transaction deleted","externalTransactionId":' || v_id || '}');
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
