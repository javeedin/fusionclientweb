-- =====================================================
-- ORDS REST API for AP Invoice Installments
-- =====================================================
-- Created: 2024
-- Description: REST endpoints for AP Invoice Installments
-- Endpoint: /ap/invoices/installments
-- =====================================================

-- =====================================================
-- Step 1: Ensure ORDS is enabled for the schema
-- =====================================================
BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled             => TRUE,
        p_schema              => USER,
        p_url_mapping_type    => 'BASE_PATH',
        p_url_mapping_pattern => LOWER(USER),
        p_auto_rest_auth      => FALSE
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        -- Schema may already be enabled
        NULL;
END;
/

-- =====================================================
-- Step 2: Create or update the 'ap' module
-- =====================================================
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'ap',
        p_base_path      => '/ap/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => 'AP REST API'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        -- Module may already exist, that's OK
        DBMS_OUTPUT.PUT_LINE('Module ap may already exist: ' || SQLERRM);
END;
/

-- =====================================================
-- Step 3: Delete existing installments handlers/templates (clean slate)
-- =====================================================
BEGIN
    -- Delete handlers first
    FOR rec IN (
        SELECT h.id AS handler_id
        FROM user_ords_handlers h
        JOIN user_ords_templates t ON h.template_id = t.id
        JOIN user_ords_modules m ON t.module_id = m.id
        WHERE m.name = 'ap'
          AND t.uri_template LIKE '%installments%'
    ) LOOP
        BEGIN
            ORDS.DELETE_HANDLER(
                p_module_name => 'ap',
                p_pattern     => NULL,
                p_method      => NULL
            );
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;
    END LOOP;
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('Cleanup handlers: ' || SQLERRM);
END;
/

-- Delete templates
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/installments/:invoice_id/:installment_number'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/installments/:invoice_id'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/installments'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/

-- =====================================================
-- Step 4: Create Template - /ap/invoices/installments
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'AP Invoice Installments endpoint'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 5: POST /ap/invoices/installments - Create/Update Installments (Bulk)
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create or update AP Invoice Installments in bulk',
        p_source         => q'[
DECLARE
    l_success_count NUMBER;
    l_error_count   NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
BEGIN
    -- Call the package to save installments from items array
    XXAP_INVOICE_INSTALLMENTS_PKG.save_installments_from_items(
        p_json          => :body_text,
        p_success_count => l_success_count,
        p_error_count   => l_error_count,
        p_status        => l_status,
        p_message       => l_message
    );

    -- Set HTTP status code
    :status_code := CASE
        WHEN l_status = 'SUCCESS' THEN 201
        WHEN l_status = 'PARTIAL' THEN 207
        ELSE 400
    END;

    -- Return JSON response
    HTP.P('{');
    HTP.P('"success": ' || CASE WHEN l_status = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.P('"status": "' || l_status || '",');
    HTP.P('"message": "' || l_message || '",');
    HTP.P('"successCount": ' || l_success_count || ',');
    HTP.P('"errorCount": ' || l_error_count);
    HTP.P('}');
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 6: GET /ap/invoices/installments - Get All Installments
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Get all invoice installments with pagination',
        p_source         => q'[
SELECT
    INSTALLMENT_ID,
    INVOICE_ID,
    INSTALLMENT_NUMBER,
    TO_CHAR(DUE_DATE, 'YYYY-MM-DD') AS DUE_DATE,
    GROSS_AMOUNT,
    UNPAID_AMOUNT,
    FIRST_DISCOUNT_AMOUNT,
    TO_CHAR(FIRST_DISCOUNT_DATE, 'YYYY-MM-DD') AS FIRST_DISCOUNT_DATE,
    SECOND_DISCOUNT_AMOUNT,
    TO_CHAR(SECOND_DISCOUNT_DATE, 'YYYY-MM-DD') AS SECOND_DISCOUNT_DATE,
    THIRD_DISCOUNT_AMOUNT,
    TO_CHAR(THIRD_DISCOUNT_DATE, 'YYYY-MM-DD') AS THIRD_DISCOUNT_DATE,
    NET_AMOUNT_ONE,
    NET_AMOUNT_TWO,
    NET_AMOUNT_THREE,
    PAYMENT_PRIORITY,
    PAYMENT_METHOD,
    PAYMENT_METHOD_CODE,
    HOLD_FLAG,
    HOLD_REASON,
    HOLD_TYPE,
    TO_CHAR(HOLD_DATE, 'YYYY-MM-DD') AS HOLD_DATE,
    HELD_BY,
    BANK_ACCOUNT,
    EXTERNAL_BANK_ACCOUNT_ID,
    DIGITAL_PAYMENT_ACCOUNT,
    REMIT_TO_ADDRESS_NAME,
    REMIT_TO_SUPPLIER,
    REMITTANCE_MESSAGE_ONE,
    REMITTANCE_MESSAGE_TWO,
    REMITTANCE_MESSAGE_THREE,
    PROCESS_STATUS,
    TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
    TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE
FROM RR_AP_INVOICE_INSTALLMENTS
ORDER BY INVOICE_ID, INSTALLMENT_NUMBER
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 7: Create Template - /ap/invoices/installments/:invoice_id
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments/:invoice_id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'AP Invoice Installments for specific invoice'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 8: POST /ap/invoices/installments/:invoice_id
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments/:invoice_id',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create or update AP Invoice Installments for a specific invoice',
        p_source         => q'[
DECLARE
    l_success_count NUMBER;
    l_error_count   NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
    l_inst_json     CLOB;
BEGIN
    -- Extract installments array from items
    SELECT JSON_QUERY(:body_text, '$.items') INTO l_inst_json FROM DUAL;

    -- If no items array, try direct array
    IF l_inst_json IS NULL THEN
        l_inst_json := :body_text;
    END IF;

    -- Call the package to save installments
    XXAP_INVOICE_INSTALLMENTS_PKG.save_installments_bulk(
        p_invoice_id    => :invoice_id,
        p_inst_json     => l_inst_json,
        p_success_count => l_success_count,
        p_error_count   => l_error_count,
        p_status        => l_status,
        p_message       => l_message
    );

    -- Set HTTP status code
    :status_code := CASE
        WHEN l_status = 'SUCCESS' THEN 201
        WHEN l_status = 'PARTIAL' THEN 207
        ELSE 400
    END;

    -- Return JSON response
    HTP.P('{');
    HTP.P('"success": ' || CASE WHEN l_status = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.P('"status": "' || l_status || '",');
    HTP.P('"message": "' || l_message || '",');
    HTP.P('"invoiceId": ' || :invoice_id || ',');
    HTP.P('"successCount": ' || l_success_count || ',');
    HTP.P('"errorCount": ' || l_error_count);
    HTP.P('}');
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 9: GET /ap/invoices/installments/:invoice_id
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments/:invoice_id',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Get all installments for an invoice',
        p_source         => q'[
SELECT
    INSTALLMENT_ID,
    INVOICE_ID,
    INSTALLMENT_NUMBER AS "InstallmentNumber",
    TO_CHAR(DUE_DATE, 'YYYY-MM-DD') AS "DueDate",
    GROSS_AMOUNT AS "GrossAmount",
    UNPAID_AMOUNT AS "UnpaidAmount",
    FIRST_DISCOUNT_AMOUNT AS "FirstDiscountAmount",
    TO_CHAR(FIRST_DISCOUNT_DATE, 'YYYY-MM-DD') AS "FirstDiscountDate",
    SECOND_DISCOUNT_AMOUNT AS "SecondDiscountAmount",
    TO_CHAR(SECOND_DISCOUNT_DATE, 'YYYY-MM-DD') AS "SecondDiscountDate",
    THIRD_DISCOUNT_AMOUNT AS "ThirdDiscountAmount",
    TO_CHAR(THIRD_DISCOUNT_DATE, 'YYYY-MM-DD') AS "ThirdDiscountDate",
    NET_AMOUNT_ONE AS "NetAmountOne",
    NET_AMOUNT_TWO AS "NetAmountTwo",
    NET_AMOUNT_THREE AS "NetAmountThree",
    PAYMENT_PRIORITY AS "PaymentPriority",
    PAYMENT_METHOD AS "PaymentMethod",
    PAYMENT_METHOD_CODE AS "PaymentMethodCode",
    CASE WHEN HOLD_FLAG = 'Y' THEN 'true' ELSE 'false' END AS "HoldFlag",
    HOLD_REASON AS "HoldReason",
    HOLD_TYPE AS "HoldType",
    TO_CHAR(HOLD_DATE, 'YYYY-MM-DD') AS "HoldDate",
    HELD_BY AS "HeldBy",
    BANK_ACCOUNT AS "BankAccount",
    EXTERNAL_BANK_ACCOUNT_ID AS "ExternalBankAccountId",
    DIGITAL_PAYMENT_ACCOUNT AS "DigitalPaymentAccount",
    REMIT_TO_ADDRESS_NAME AS "RemitToAddressName",
    REMIT_TO_SUPPLIER AS "RemitToSupplier",
    REMITTANCE_MESSAGE_ONE AS "RemittanceMessageOne",
    REMITTANCE_MESSAGE_TWO AS "RemittanceMessageTwo",
    REMITTANCE_MESSAGE_THREE AS "RemittanceMessageThree",
    FUSION_CREATED_BY AS "CreatedBy",
    TO_CHAR(FUSION_CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS "CreationDate",
    TO_CHAR(FUSION_LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS "LastUpdateDate",
    FUSION_LAST_UPDATED_BY AS "LastUpdatedBy",
    FUSION_LAST_UPDATE_LOGIN AS "LastUpdateLogin"
FROM RR_AP_INVOICE_INSTALLMENTS
WHERE INVOICE_ID = :invoice_id
ORDER BY INSTALLMENT_NUMBER
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 10: DELETE /ap/invoices/installments/:invoice_id
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments/:invoice_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => NULL,
        p_comments       => 'Delete all installments for an invoice',
        p_source         => q'[
DECLARE
    l_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_count
    FROM RR_AP_INVOICE_INSTALLMENTS
    WHERE INVOICE_ID = :invoice_id;

    DELETE FROM RR_AP_INVOICE_INSTALLMENTS
    WHERE INVOICE_ID = :invoice_id;

    COMMIT;

    :status_code := 200;

    HTP.P('{');
    HTP.P('"success": true,');
    HTP.P('"message": "Deleted ' || l_count || ' installments for invoice ' || :invoice_id || '",');
    HTP.P('"deletedCount": ' || l_count);
    HTP.P('}');
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 11: Create Template - /ap/invoices/installments/:invoice_id/:installment_number
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments/:invoice_id/:installment_number',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Single AP Invoice Installment'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 12: GET /ap/invoices/installments/:invoice_id/:installment_number
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments/:invoice_id/:installment_number',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_mimes_allowed  => NULL,
        p_comments       => 'Get a single installment',
        p_source         => q'[
SELECT
    INSTALLMENT_ID,
    INVOICE_ID,
    INSTALLMENT_NUMBER AS "InstallmentNumber",
    TO_CHAR(DUE_DATE, 'YYYY-MM-DD') AS "DueDate",
    GROSS_AMOUNT AS "GrossAmount",
    UNPAID_AMOUNT AS "UnpaidAmount",
    FIRST_DISCOUNT_AMOUNT AS "FirstDiscountAmount",
    TO_CHAR(FIRST_DISCOUNT_DATE, 'YYYY-MM-DD') AS "FirstDiscountDate",
    SECOND_DISCOUNT_AMOUNT AS "SecondDiscountAmount",
    TO_CHAR(SECOND_DISCOUNT_DATE, 'YYYY-MM-DD') AS "SecondDiscountDate",
    THIRD_DISCOUNT_AMOUNT AS "ThirdDiscountAmount",
    TO_CHAR(THIRD_DISCOUNT_DATE, 'YYYY-MM-DD') AS "ThirdDiscountDate",
    NET_AMOUNT_ONE AS "NetAmountOne",
    NET_AMOUNT_TWO AS "NetAmountTwo",
    NET_AMOUNT_THREE AS "NetAmountThree",
    PAYMENT_PRIORITY AS "PaymentPriority",
    PAYMENT_METHOD AS "PaymentMethod",
    PAYMENT_METHOD_CODE AS "PaymentMethodCode",
    CASE WHEN HOLD_FLAG = 'Y' THEN 'true' ELSE 'false' END AS "HoldFlag",
    HOLD_REASON AS "HoldReason",
    HOLD_TYPE AS "HoldType",
    TO_CHAR(HOLD_DATE, 'YYYY-MM-DD') AS "HoldDate",
    HELD_BY AS "HeldBy",
    BANK_ACCOUNT AS "BankAccount",
    EXTERNAL_BANK_ACCOUNT_ID AS "ExternalBankAccountId",
    DIGITAL_PAYMENT_ACCOUNT AS "DigitalPaymentAccount",
    REMIT_TO_ADDRESS_NAME AS "RemitToAddressName",
    REMIT_TO_SUPPLIER AS "RemitToSupplier",
    REMITTANCE_MESSAGE_ONE AS "RemittanceMessageOne",
    REMITTANCE_MESSAGE_TWO AS "RemittanceMessageTwo",
    REMITTANCE_MESSAGE_THREE AS "RemittanceMessageThree",
    FUSION_CREATED_BY AS "CreatedBy",
    TO_CHAR(FUSION_CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS "CreationDate",
    TO_CHAR(FUSION_LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') AS "LastUpdateDate",
    FUSION_LAST_UPDATED_BY AS "LastUpdatedBy",
    FUSION_LAST_UPDATE_LOGIN AS "LastUpdateLogin"
FROM RR_AP_INVOICE_INSTALLMENTS
WHERE INVOICE_ID = :invoice_id
  AND INSTALLMENT_NUMBER = :installment_number
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- Step 13: DELETE /ap/invoices/installments/:invoice_id/:installment_number
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/installments/:invoice_id/:installment_number',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => NULL,
        p_comments       => 'Delete a single installment',
        p_source         => q'[
DECLARE
    l_count NUMBER;
BEGIN
    DELETE FROM RR_AP_INVOICE_INSTALLMENTS
    WHERE INVOICE_ID = :invoice_id
      AND INSTALLMENT_NUMBER = :installment_number;

    l_count := SQL%ROWCOUNT;
    COMMIT;

    IF l_count > 0 THEN
        :status_code := 200;
        HTP.P('{');
        HTP.P('"success": true,');
        HTP.P('"message": "Installment ' || :installment_number || ' deleted successfully"');
        HTP.P('}');
    ELSE
        :status_code := 404;
        HTP.P('{');
        HTP.P('"success": false,');
        HTP.P('"message": "Installment not found"');
        HTP.P('}');
    END IF;
END;
]'
    );
    COMMIT;
END;
/


-- =====================================================
-- GET /ap/createinvoice/installments?P_INVOICE_ID=...
-- Returns installments with effective unpaid amount
-- derived from RR_AP_PAYMENTS_RELATED_INVOICES (source of truth).
-- UNPAID_AMOUNT / AMOUNT_REMAINING = GROSS_AMOUNT - SUM(payments paid against invoice)
-- PAYMENT_STATUS = derived live, not from stale stored column
-- All original columns preserved for UI mapping compatibility.
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name   => 'ap',
        p_pattern       => 'createinvoice/installments',
        p_method        => 'GET',
        p_source_type   => 'json/collection',
        p_mimes_allowed => NULL,
        p_comments      => 'Get installments for invoice with live unpaid amount from payments',
        p_source        => q'[
SELECT
    inst.INSTALLMENT_ID,
    inst.INVOICE_ID,
    inst.INSTALLMENT_NUMBER,
    TO_CHAR(inst.DUE_DATE, 'DD-MON-YYYY')                          AS DUE_DATE,
    inst.GROSS_AMOUNT,
    -- UNPAID_AMOUNT: derived from actual payments (replaces stale stored column)
    GREATEST(0,
        NVL(inst.GROSS_AMOUNT, 0) -
        NVL((SELECT SUM(NVL(rel.AMOUNT_PAID_PAYMENT_CURRENCY, 0))
             FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
             WHERE  rel.INVOICE_ID = inst.INVOICE_ID), 0)
    )                                                               AS UNPAID_AMOUNT,
    -- AMOUNT_REMAINING: same value, kept for newer UI mapping compatibility
    GREATEST(0,
        NVL(inst.GROSS_AMOUNT, 0) -
        NVL((SELECT SUM(NVL(rel.AMOUNT_PAID_PAYMENT_CURRENCY, 0))
             FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
             WHERE  rel.INVOICE_ID = inst.INVOICE_ID), 0)
    )                                                               AS AMOUNT_REMAINING,
    -- PAYMENT_STATUS: derived live from payments vs gross amount
    CASE
        WHEN GREATEST(0,
                 NVL(inst.GROSS_AMOUNT, 0) -
                 NVL((SELECT SUM(NVL(rel.AMOUNT_PAID_PAYMENT_CURRENCY, 0))
                      FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
                      WHERE  rel.INVOICE_ID = inst.INVOICE_ID), 0)
             ) <= 0
            THEN 'Fully Paid'
        WHEN NVL((SELECT SUM(NVL(rel.AMOUNT_PAID_PAYMENT_CURRENCY, 0))
                  FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
                  WHERE  rel.INVOICE_ID = inst.INVOICE_ID), 0) > 0
            THEN 'Partially Paid'
        ELSE 'Unpaid'
    END                                                             AS PAYMENT_STATUS,
    inst.FIRST_DISCOUNT_AMOUNT,
    TO_CHAR(inst.FIRST_DISCOUNT_DATE, 'DD-MON-YYYY')               AS FIRST_DISCOUNT_DATE,
    inst.SECOND_DISCOUNT_AMOUNT,
    TO_CHAR(inst.SECOND_DISCOUNT_DATE, 'DD-MON-YYYY')              AS SECOND_DISCOUNT_DATE,
    inst.THIRD_DISCOUNT_AMOUNT,
    TO_CHAR(inst.THIRD_DISCOUNT_DATE, 'DD-MON-YYYY')               AS THIRD_DISCOUNT_DATE,
    inst.NET_AMOUNT_ONE,
    inst.NET_AMOUNT_TWO,
    inst.NET_AMOUNT_THREE,
    inst.PAYMENT_PRIORITY,
    inst.PAYMENT_METHOD,
    inst.PAYMENT_METHOD_CODE,
    inst.HOLD_FLAG,
    inst.HOLD_REASON,
    inst.HOLD_TYPE,
    TO_CHAR(inst.HOLD_DATE, 'DD-MON-YYYY')                         AS HOLD_DATE,
    inst.HELD_BY,
    inst.BANK_ACCOUNT,
    inst.EXTERNAL_BANK_ACCOUNT_ID,
    inst.DIGITAL_PAYMENT_ACCOUNT,
    inst.REMIT_TO_ADDRESS_NAME,
    inst.REMIT_TO_SUPPLIER,
    inst.REMITTANCE_MESSAGE_ONE,
    inst.REMITTANCE_MESSAGE_TWO,
    inst.REMITTANCE_MESSAGE_THREE,
    inst.PROCESS_STATUS,
    TO_CHAR(inst.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS')         AS CREATION_DATE,
    TO_CHAR(inst.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS')      AS LAST_UPDATE_DATE
FROM  RR_AP_INVOICE_INSTALLMENTS inst
WHERE inst.INVOICE_ID = NVL(:P_INVOICE_ID, inst.INVOICE_ID)
ORDER BY inst.INVOICE_ID, inst.INSTALLMENT_NUMBER
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- PUT /ap/createinvoice/installments
-- Updates PaymentStatus and UnpaidAmount (AmountRemaining)
-- for a single installment identified by InstallmentId.
-- Body: { "InstallmentId": 26, "InvoiceId": ...,
--         "PaymentStatus": "Fully Paid", "AmountRemaining": 0 }
-- =====================================================

-- Define template (no-op if already exists)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'createinvoice/installments',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'AP Invoice Installment payment status update'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL; -- template already defined by another handler
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name   => 'ap',
        p_pattern       => 'createinvoice/installments',
        p_method        => 'PUT',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments      => 'Update installment payment status and unpaid amount',
        p_source        => q'[
DECLARE
    l_installment_id  NUMBER;
    l_invoice_id      NUMBER;
    l_payment_status  VARCHAR2(50);
    l_amount_remaining NUMBER;
    l_rows_updated    NUMBER;
BEGIN
    -- Extract fields from JSON body
    SELECT
        JSON_VALUE(:body_text, '$.InstallmentId' RETURNING NUMBER),
        JSON_VALUE(:body_text, '$.InvoiceId'     RETURNING NUMBER),
        JSON_VALUE(:body_text, '$.PaymentStatus'),
        JSON_VALUE(:body_text, '$.AmountRemaining' RETURNING NUMBER)
    INTO l_installment_id, l_invoice_id, l_payment_status, l_amount_remaining
    FROM DUAL;

    IF l_installment_id IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"error","message":"InstallmentId is required"}');
        RETURN;
    END IF;

    UPDATE RR_AP_INVOICE_INSTALLMENTS
    SET
        PAYMENT_STATUS    = NVL(l_payment_status, PAYMENT_STATUS),
        UNPAID_AMOUNT     = NVL(l_amount_remaining, UNPAID_AMOUNT),
        LAST_UPDATE_DATE  = SYSTIMESTAMP,
        LAST_UPDATED_BY   = NVL(SYS_CONTEXT('APEX$SESSION','APP_USER'), USER)
    WHERE INSTALLMENT_ID = l_installment_id
      AND (l_invoice_id IS NULL OR INVOICE_ID = l_invoice_id);

    l_rows_updated := SQL%ROWCOUNT;
    COMMIT;

    IF l_rows_updated > 0 THEN
        :status_code := 200;
        HTP.P('{');
        HTP.P('"status":"success",');
        HTP.P('"message":"Installment updated successfully",');
        HTP.P('"installmentId":' || l_installment_id || ',');
        HTP.P('"paymentStatus":"' || l_payment_status || '",');
        HTP.P('"amountRemaining":' || NVL(l_amount_remaining, 0));
        HTP.P('}');
    ELSE
        :status_code := 404;
        HTP.P('{"status":"error","message":"Installment not found"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- Verify the endpoints
-- =====================================================
SELECT
    module_name,
    uri_template,
    method,
    source_type
FROM user_ords_handlers
WHERE module_name = 'ap'
  AND uri_template LIKE '%installments%'
ORDER BY uri_template, method;

-- =====================================================
-- REST API Endpoints Summary:
-- =====================================================
/*
Base URL: https://your-server/ords/schema/ap/

ENDPOINTS:

1. POST /invoices/installments
   - Save multiple installments (bulk)
   - Body: { "items": [ { "InvoiceId": 1021, "InstallmentNumber": 1, ... } ] }

2. GET /invoices/installments
   - Get all installments (paginated)

3. POST /invoices/installments/:invoice_id
   - Save installments for a specific invoice
   - Body: { "items": [ { "InstallmentNumber": 1, ... } ] } or [ { "InstallmentNumber": 1, ... } ]

4. GET /invoices/installments/:invoice_id
   - Get all installments for a specific invoice

5. DELETE /invoices/installments/:invoice_id
   - Delete all installments for a specific invoice

6. GET /invoices/installments/:invoice_id/:installment_number
   - Get a single installment

7. DELETE /invoices/installments/:invoice_id/:installment_number
   - Delete a single installment

*/
