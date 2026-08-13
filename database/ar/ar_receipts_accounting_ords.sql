-- =====================================================
-- ORDS REST Handler: PUT /ar/receipts/:id/accounting-status
-- Called after GL posting succeeds to stamp the receipt
-- ACCOUNTING_STATUS = 'Accounted' and ACCOUNTING_DATE = SYSDATE
-- =====================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receipts/:id/accounting-status');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'receipts/:id/accounting-status',
        p_comments    => 'Update AR receipt accounting status after GL posting'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipts/:id/accounting-status',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Set ACCOUNTING_STATUS=Accounted and ACCOUNTING_DATE=SYSDATE after GL post',
        p_source         => '
DECLARE
    l_rows   NUMBER;
BEGIN
    UPDATE RR_AR_RECEIPTS
    SET    ACCOUNTING_STATUS = ''Accounted'',
           ACCOUNTING_DATE   = SYSDATE,
           LAST_UPDATED_BY   = USER,
           LAST_UPDATE_DATE  = SYSTIMESTAMP
    WHERE  STANDARD_RECEIPT_ID = :id;

    l_rows := SQL%ROWCOUNT;
    COMMIT;

    :status_code := CASE WHEN l_rows > 0 THEN 200 ELSE 404 END;
    HTP.P(''{"status":"'' || CASE WHEN l_rows > 0 THEN ''SUCCESS'' ELSE ''NOT_FOUND'' END ||
          ''","accountingStatus":"Accounted","updated":'' || l_rows || ''}'');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P(''{"status":"ERROR","message":"'' || REPLACE(SQLERRM,''"'',''\\"'') || ''"}'' );
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- PUT {base}/ar/receipts/:id/accounting-status
--   Sets ACCOUNTING_STATUS='Accounted', ACCOUNTING_DATE=SYSDATE
--   Called automatically after Post Accounting succeeds in the UI
-- =====================================================
