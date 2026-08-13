-- ============================================================
-- PUT cash/externaltransactions/:externalTransactionId/void
-- Sets STATUS = 'VOID' on a single external cash transaction.
-- Usage: PUT .../void?updated_by=user@email.com
-- Run this in Oracle APEX SQL Workshop (reerp module must exist)
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId/void',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DELETE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:externalTransactionId/void'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'cash/externaltransactions/:externalTransactionId/void',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Void an external cash transaction'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:externalTransactionId/void',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'Set STATUS = VOID on external transaction; no body needed',
        p_source         => q'[
DECLARE
    l_status          VARCHAR2(30);
    l_accounting_flag VARCHAR2(1);
BEGIN
    -- Read current state before touching anything
    BEGIN
        SELECT STATUS, NVL(ACCOUNTING_FLAG, 'N')
        INTO   l_status, l_accounting_flag
        FROM   RR_EXTERNAL_CASH_TRANSACTIONS
        WHERE  EXTERNAL_TRANSACTION_ID = :externalTransactionId;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            :status_code := 404;
            HTP.PRN('{"success":false,"message":"Transaction not found"}');
            RETURN;
    END;

    -- Guard: already voided
    IF l_status = 'VOID' THEN
        :status_code := 422;
        HTP.PRN('{"success":false,"code":"ALREADY_VOID","message":"Transaction is already voided."}');
        RETURN;
    END IF;

    -- Guard: reconciled — must unreconcile in Oracle Fusion first
    IF l_status = 'REC' THEN
        :status_code := 422;
        HTP.PRN('{"success":false,"code":"IS_RECONCILED","message":"Transaction is reconciled (REC). Unreconcile it in Oracle Fusion Cash Management before voiding."}');
        RETURN;
    END IF;

    -- Guard: accounted — must reverse accounting entries first
    IF l_accounting_flag = 'Y' THEN
        :status_code := 422;
        HTP.PRN('{"success":false,"code":"IS_ACCOUNTED","message":"Transaction has been accounted (posted to GL). Reverse the accounting entries before voiding."}');
        RETURN;
    END IF;

    -- Safe to void
    UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
    SET    STATUS           = 'VOID',
           LAST_UPDATED_BY  = NVL(:updated_by, 'SYSTEM'),
           LAST_UPDATE_DATE = SYSTIMESTAMP
    WHERE  EXTERNAL_TRANSACTION_ID = :externalTransactionId;

    COMMIT;
    :status_code := 200;
    HTP.PRN('{"success":true,"message":"Transaction voided successfully."}');

EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.PRN('{"success":false,"message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );

    COMMIT;
END;
/
