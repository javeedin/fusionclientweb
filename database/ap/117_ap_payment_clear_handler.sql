-- =====================================================
-- AP Payment Clear PDC Handler
-- PUT /ap/payments/clear
-- Body: { "CheckId": N, "PaymentStatus": "Cleared", "ClearingDate": "YYYY-MM-DD" }
-- =====================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'payments/clear');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'payments/clear',
        p_comments    => 'Mark a PDC payment as Cleared and stamp clearing date'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'payments/clear',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Clear a PDC payment: set PAYMENT_STATUS and CLEARING_DATE',
        p_source         => q'[
DECLARE
    l_body           CLOB := :body_text;
    l_check_id       NUMBER;
    l_payment_status VARCHAR2(50);
    l_clearing_date  DATE;
    l_rows           NUMBER;
BEGIN
    l_check_id       := TO_NUMBER(JSON_VALUE(l_body, '$.CheckId'));
    l_payment_status := NVL(JSON_VALUE(l_body, '$.PaymentStatus'), 'Negotiable');
    l_clearing_date  := TO_DATE(JSON_VALUE(l_body, '$.ClearingDate'), 'YYYY-MM-DD');

    IF l_check_id IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","message":"CheckId is required"}');
        RETURN;
    END IF;

    IF l_clearing_date IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","message":"ClearingDate is required (YYYY-MM-DD)"}');
        RETURN;
    END IF;

    UPDATE RR_AP_PAYMENTS_ALL
    SET    PAYMENT_STATUS   = l_payment_status,
           CLEARING_DATE    = l_clearing_date,
           LAST_UPDATE_DATE = SYSTIMESTAMP,
           LAST_UPDATED_BY  = 'SYSTEM'
    WHERE  CHECK_ID         = l_check_id;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"error","message":"Payment not found: ' || l_check_id || '"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"success","message":"Payment cleared","checkId":' || l_check_id ||
              ',"paymentStatus":"' || l_payment_status || '"' ||
              ',"clearingDate":"' || TO_CHAR(l_clearing_date, 'YYYY-MM-DD') || '"}');
    END IF;

EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- PUT {base}/ap/payments/clear
--     Body: { "CheckId": 300000088638812,
--             "PaymentStatus": "Cleared",
--             "ClearingDate": "2026-06-19" }
--     Returns: { "status": "success", "checkId": N,
--                "paymentStatus": "Cleared",
--                "clearingDate": "YYYY-MM-DD" }
-- =====================================================
