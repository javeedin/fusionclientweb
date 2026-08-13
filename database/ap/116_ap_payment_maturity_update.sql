-- =====================================================
-- AP Payment Maturity Date Update
-- PUT /ap/payments/:check_id/maturity
-- Body: { "CheckId": N, "MaturityDate": "YYYY-MM-DD" }
-- =====================================================

-- Drop + recreate template
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'payments/:check_id/maturity');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'payments/:check_id/maturity',
        p_comments    => 'Update maturity date for a PDC payment'
    );
    COMMIT;
END;
/

-- PUT /ap/payments/:check_id/maturity
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'payments/:check_id/maturity',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update maturity (void) date for a PDC payment',
        p_source         => q'[
DECLARE
    l_body          CLOB := :body_text;
    l_check_id      NUMBER;
    l_maturity_date DATE;
    l_updated_by    VARCHAR2(240);
    l_rows          NUMBER;
BEGIN
    l_check_id      := TO_NUMBER(:check_id);
    l_maturity_date := TO_DATE(JSON_VALUE(l_body, '$.MaturityDate'), 'YYYY-MM-DD');
    l_updated_by    := NVL(JSON_VALUE(l_body, '$.UpdatedBy'), 'SYSTEM');

    IF l_check_id IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","message":"check_id is required"}');
        RETURN;
    END IF;

    IF l_maturity_date IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","message":"MaturityDate is required (YYYY-MM-DD)"}');
        RETURN;
    END IF;

    -- Validate: new date must not be earlier than existing maturity date
    DECLARE
        l_existing_maturity DATE;
    BEGIN
        SELECT MATURITY_DATE INTO l_existing_maturity
        FROM   RR_AP_PAYMENTS_ALL
        WHERE  CHECK_ID = l_check_id;

        IF l_existing_maturity IS NOT NULL AND l_maturity_date < l_existing_maturity THEN
            :status_code := 400;
            HTP.P('{"status":"error","message":"New Maturity Date (' ||
                  TO_CHAR(l_maturity_date, 'YYYY-MM-DD') ||
                  ') cannot be earlier than the original Maturity Date (' ||
                  TO_CHAR(l_existing_maturity, 'YYYY-MM-DD') || ')"}');
            RETURN;
        END IF;
    EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
    END;

    UPDATE RR_AP_PAYMENTS_ALL
    SET    MATURITY_DATE    = l_maturity_date,
           LAST_UPDATE_DATE = SYSTIMESTAMP,
           LAST_UPDATED_BY  = l_updated_by
    WHERE  CHECK_ID         = l_check_id;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"error","message":"Payment not found: ' || l_check_id || '"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"success","message":"Maturity date updated","checkId":' || l_check_id ||
              ',"maturityDate":"' || TO_CHAR(l_maturity_date, 'YYYY-MM-DD') || '"}');
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
-- PUT {base}/ap/payments/:check_id/maturity
--     Body: { "CheckId": 300000088638812, "MaturityDate": "2026-12-31" }
--     Returns: { "status": "success", "checkId": N, "maturityDate": "YYYY-MM-DD" }
-- =====================================================
