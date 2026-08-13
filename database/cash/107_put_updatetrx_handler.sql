-- ============================================================
-- Patch 107: PUT /cash/externaltransactions/:txnId/updatetrx
--
-- Updates editable fields on RR_EXTERNAL_CASH_TRANSACTIONS
-- for a given EXTERNAL_TRANSACTION_ID.
-- ============================================================

BEGIN
    -- Remove old handler if exists
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:txnId/updatetrx',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Create URI template if not exists
    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'cash/externaltransactions/:txnId/updatetrx',
            p_priority    => 0,
            p_etag_type   => 'HASH'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Define PUT handler
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/externaltransactions/:txnId/updatetrx',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update external transaction fields including currency, rate, dates',
        p_source         => q'[
DECLARE
    l_body          CLOB;
    l_rows_updated  NUMBER;
BEGIN
    -- Read request body
    l_body := :body_text;

    -- Parse JSON and update
    APEX_JSON.parse(l_body);

    UPDATE RR_EXTERNAL_CASH_TRANSACTIONS
    SET
        TRANSACTION_DATE          = TO_DATE(APEX_JSON.get_varchar2(p_path => 'items[1].TransactionDate'),   'YYYY-MM-DD'),
        VALUE_DATE                = TO_DATE(APEX_JSON.get_varchar2(p_path => 'items[1].ValueDate'),         'YYYY-MM-DD'),
        CLEARED_DATE              = TO_DATE(APEX_JSON.get_varchar2(p_path => 'items[1].ClearedDate'),       'YYYY-MM-DD'),
        CURRENCY_CODE             = APEX_JSON.get_varchar2(p_path => 'items[1].CurrencyCode'),
        AMOUNT                    = APEX_JSON.get_number  (p_path => 'items[1].Amount'),
        REFERENCE_TEXT            = APEX_JSON.get_varchar2(p_path => 'items[1].ReferenceText'),
        TRANSACTION_TYPE          = APEX_JSON.get_varchar2(p_path => 'items[1].TransactionType'),
        DESCRIPTION               = APEX_JSON.get_varchar2(p_path => 'items[1].Description'),
        TRANSACTION_DIRECTION     = APEX_JSON.get_varchar2(p_path => 'items[1].TransactionDirection'),
        ASSET_ACCOUNT_COMBINATION = APEX_JSON.get_varchar2(p_path => 'items[1].AssetAccountCombination'),
        OFFSET_ACCOUNT_COMBINATION= APEX_JSON.get_varchar2(p_path => 'items[1].OffsetAccountCombination'),
        BANK_CONVERSION_RATE      = APEX_JSON.get_number  (p_path => 'items[1].BankConversionRate'),
        BANK_CONVERSION_RATE_TYPE = APEX_JSON.get_varchar2(p_path => 'items[1].BankConversionRateType'),
        BANK_CONVERSION_DATE      = TO_DATE(APEX_JSON.get_varchar2(p_path => 'items[1].BankConversionDate'), 'YYYY-MM-DD'),
        PAYMENT_METHOD            = APEX_JSON.get_varchar2(p_path => 'items[1].PaymentMethod'),
        PAYMENT_DOCUMENT          = APEX_JSON.get_varchar2(p_path => 'items[1].PaymentDocument'),
        PAPER_DOCUMENT_NUMBER     = APEX_JSON.get_varchar2(p_path => 'items[1].PaperDocumentNumber'),
        PAYEE_NAME                = APEX_JSON.get_varchar2(p_path => 'items[1].PayeeName'),
        PAYEE_ID                  = APEX_JSON.get_number  (p_path => 'items[1].PayeeId'),
        LAST_UPDATED_BY           = APEX_JSON.get_varchar2(p_path => 'items[1].LastUpdatedBy'),
        LAST_UPDATE_DATE          = SYSTIMESTAMP,
        LAST_UPDATE_LOGIN         = APEX_JSON.get_varchar2(p_path => 'items[1].LastUpdateLogin')
    WHERE EXTERNAL_TRANSACTION_ID = :txnId;

    l_rows_updated := SQL%ROWCOUNT;

    IF l_rows_updated = 0 THEN
        :status := 404;
        HTP.p('{"status":"error","message":"Transaction not found for ID ' || :txnId || '"}');
    ELSE
        COMMIT;
        :status := 200;
        HTP.p('{"status":"success","message":"Transaction updated successfully","rows_updated":' || l_rows_updated || '}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status := 500;
        HTP.p('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
]'
    );

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT handler for cash/externaltransactions/:txnId/updatetrx created successfully.');
END;
/
