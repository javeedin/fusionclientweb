-- ============================================================
-- 117_patch_get_payments_add_currency.sql
-- Adds p_payment_currency to XXAP_PAYMENTS_PKG.get_payments
-- Run in SQL Developer on BCLDIFC schema.
-- After this, run 116_add_payment_currency_filter.sql to update ORDS.
-- ============================================================

-- Step 1: Update PACKAGE SPEC — replace the get_payments declaration
-- Find this in your spec and add the new parameter:
--
--     FUNCTION get_payments(
--         p_payment_number    IN VARCHAR2 DEFAULT NULL,
--         p_payment_status    IN VARCHAR2 DEFAULT NULL,
--         p_payee             IN VARCHAR2 DEFAULT NULL,
--         p_supplier_number   IN VARCHAR2 DEFAULT NULL,
--         p_business_unit     IN VARCHAR2 DEFAULT NULL,
--         p_payment_currency  IN VARCHAR2 DEFAULT NULL,   -- ADD THIS LINE
--         p_date_from         IN DATE     DEFAULT NULL,
--         p_date_to           IN DATE     DEFAULT NULL,
--         p_only_pdc          IN VARCHAR2 DEFAULT 'N',
--         p_limit             IN NUMBER   DEFAULT 100,
--         p_offset            IN NUMBER   DEFAULT 0
--     ) RETURN CLOB;

-- Step 2: Replace ONLY the get_payments function body.
-- Paste this into your package body, replacing the existing get_payments function:

-- ============================================================
-- COPY FROM HERE INTO YOUR PACKAGE BODY (replace get_payments)
-- ============================================================
/*

    FUNCTION get_payments(
        p_payment_number    IN VARCHAR2 DEFAULT NULL,
        p_payment_status    IN VARCHAR2 DEFAULT NULL,
        p_payee             IN VARCHAR2 DEFAULT NULL,
        p_supplier_number   IN VARCHAR2 DEFAULT NULL,
        p_business_unit     IN VARCHAR2 DEFAULT NULL,
        p_payment_currency  IN VARCHAR2 DEFAULT NULL,
        p_date_from         IN DATE     DEFAULT NULL,
        p_date_to           IN DATE     DEFAULT NULL,
        p_only_pdc          IN VARCHAR2 DEFAULT 'N',
        p_limit             IN NUMBER   DEFAULT 100,
        p_offset            IN NUMBER   DEFAULT 0
    ) RETURN CLOB IS
        v_result CLOB;
        v_count  NUMBER;
    BEGIN
        -- Get total count
        SELECT COUNT(*)
        INTO v_count
        FROM RR_AP_PAYMENTS_ALL
        WHERE (p_payment_number   IS NULL OR PAYMENT_NUMBER   = p_payment_number)
          AND (p_payment_status   IS NULL OR PAYMENT_STATUS   = p_payment_status)
          AND (p_payee            IS NULL OR UPPER(PAYEE) LIKE '%' || UPPER(p_payee) || '%')
          AND (p_supplier_number  IS NULL OR SUPPLIER_NUMBER  = p_supplier_number)
          AND (p_business_unit    IS NULL OR BUSINESS_UNIT    = p_business_unit)
          AND (p_payment_currency IS NULL OR PAYMENT_CURRENCY = p_payment_currency)
          AND (p_date_from        IS NULL OR PAYMENT_DATE    >= p_date_from)
          AND (p_date_to          IS NULL OR PAYMENT_DATE    <= p_date_to)
          AND (p_only_pdc <> 'Y' OR MATURITY_DATE IS NOT NULL);

        -- Get paginated results with full Fusion-compatible JSON
        SELECT JSON_OBJECT(
            'count' VALUE v_count,
            'limit' VALUE p_limit,
            'offset' VALUE p_offset,
            'items' VALUE (
                SELECT JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'CheckId' VALUE CHECK_ID,
                        'PaymentId' VALUE PAYMENT_ID,
                        'PaymentReference' VALUE PAYMENT_REFERENCE,
                        'PaperDocumentNumber' VALUE PAPER_DOCUMENT_NUMBER,
                        'PaymentNumber' VALUE PAYMENT_NUMBER,
                        'PaymentFileReference' VALUE PAYMENT_FILE_REFERENCE,
                        'PaymentProcessRequest' VALUE PAYMENT_PROCESS_REQUEST,
                        'PaymentAmount' VALUE PAYMENT_AMOUNT,
                        'PaymentDate' VALUE TO_CHAR(PAYMENT_DATE, 'YYYY-MM-DD'),
                        'AccountingDate' VALUE TO_CHAR(ACCOUNTING_DATE, 'YYYY-MM-DD'),
                        'PaymentDescription' VALUE PAYMENT_DESCRIPTION,
                        'ConversionRate' VALUE CONVERSION_RATE,
                        'ConversionDate' VALUE TO_CHAR(CONVERSION_DATE, 'YYYY-MM-DD'),
                        'ConversionRateType' VALUE CONVERSION_RATE_TYPE,
                        'ClearingDate' VALUE TO_CHAR(CLEARING_DATE, 'YYYY-MM-DD'),
                        'ClearingAmount' VALUE CLEARING_AMOUNT,
                        'ClearingLedgerAmount' VALUE CLEARING_LEDGER_AMOUNT,
                        'ClearingConversionRate' VALUE CLEARING_CONVERSION_RATE,
                        'ClearingConversionDate' VALUE TO_CHAR(CLEARING_CONVERSION_DATE, 'YYYY-MM-DD'),
                        'ClearingConversionRateType' VALUE CLEARING_CONVERSION_RATE_TYPE,
                        'CrossCurrencyRateType' VALUE CROSS_CURRENCY_RATE_TYPE,
                        'MaturityDate' VALUE TO_CHAR(MATURITY_DATE, 'YYYY-MM-DD'),
                        'MaturityConversionRateType' VALUE MATURITY_CONVERSION_RATE_TYPE,
                        'MaturityConversionDate' VALUE TO_CHAR(MATURITY_CONVERSION_DATE, 'YYYY-MM-DD'),
                        'MaturityConversionRate' VALUE MATURITY_CONVERSION_RATE,
                        'AnticipatedValueDate' VALUE TO_CHAR(ANTICIPATED_VALUE_DATE, 'YYYY-MM-DD'),
                        'ClearingValueDate' VALUE TO_CHAR(CLEARING_VALUE_DATE, 'YYYY-MM-DD'),
                        'StopDate' VALUE TO_CHAR(STOP_DATE, 'YYYY-MM-DD'),
                        'VoidDate' VALUE TO_CHAR(VOID_DATE, 'YYYY-MM-DD'),
                        'VoidAccountingDate' VALUE TO_CHAR(VOID_ACCOUNTING_DATE, 'YYYY-MM-DD'),
                        'PaymentStatus' VALUE PAYMENT_STATUS,
                        'SeparateRemittanceAdviceCreated' VALUE SEPARATE_REMITTANCE_ADVICE_CREATED,
                        'AccountingStatus' VALUE SLA_ACCOUNTING_STATUS,
                        'ReconciledFlag' VALUE CASE WHEN RECONCILED_FLAG = 'Y' THEN 'true' ELSE 'false' END,
                        'PaymentType' VALUE PAYMENT_TYPE,
                        'PaymentCurrency' VALUE PAYMENT_CURRENCY,
                        'WithheldAmount' VALUE WITHHELD_AMOUNT,
                        'BankChargeAmount' VALUE BANK_CHARGE_AMOUNT,
                        'LegalEntity' VALUE LEGAL_ENTITY,
                        'BusinessUnit' VALUE BUSINESS_UNIT,
                        'PaymentFunction' VALUE PAYMENT_FUNCTION,
                        'Payee' VALUE PAYEE,
                        'PartyId' VALUE PARTY_ID,
                        'ProcurementBU' VALUE PROCUREMENT_BU,
                        'PayeeSite' VALUE PAYEE_SITE,
                        'EmployeeAddress' VALUE EMPLOYEE_ADDRESS,
                        'SupplierNumber' VALUE SUPPLIER_NUMBER,
                        'ThirdPartySupplier' VALUE THIRD_PARTY_SUPPLIER,
                        'ThirdPartyAddressName' VALUE THIRD_PARTY_ADDRESS_NAME,
                        'ExternalBankAccountId' VALUE EXTERNAL_BANK_ACCOUNT_ID,
                        'RemitToAccountNumber' VALUE REMIT_TO_ACCOUNT_NUMBER,
                        'DisbursementBankAccountNumber' VALUE DISBURSEMENT_BANK_ACCOUNT_NUMBER,
                        'DisbursementBankAccountName' VALUE DISBURSEMENT_BANK_ACCOUNT_NAME,
                        'PaymentMethodCode' VALUE PAYMENT_METHOD_CODE,
                        'PaymentMethod' VALUE PAYMENT_METHOD,
                        'PaymentDocument' VALUE PAYMENT_DOCUMENT,
                        'PaymentProcessProfileCode' VALUE PAYMENT_PROCESS_PROFILE_CODE,
                        'PaymentProcessProfile' VALUE PAYMENT_PROCESS_PROFILE,
                        'DocumentCategory' VALUE DOCUMENT_CATEGORY,
                        'DocumentSequence' VALUE DOCUMENT_SEQUENCE,
                        'VoucherNumber' VALUE VOUCHER_NUMBER,
                        'PaymentBaseAmount' VALUE PAYMENT_BASE_AMOUNT,
                        'PaymentBaseCurrency' VALUE PAYMENT_BASE_CURRENCY,
                        'AddressLine1' VALUE ADDRESS_LINE1,
                        'AddressLine2' VALUE ADDRESS_LINE2,
                        'AddressLine3' VALUE ADDRESS_LINE3,
                        'AddressLine4' VALUE ADDRESS_LINE4,
                        'City' VALUE CITY,
                        'County' VALUE COUNTY,
                        'Province' VALUE PROVINCE,
                        'State' VALUE STATE,
                        'Country' VALUE COUNTRY,
                        'Zip' VALUE ZIP,
                        'CreatedBy' VALUE CREATED_BY,
                        'CreationDate' VALUE TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'),
                        'LastUpdatedBy' VALUE LAST_UPDATED_BY,
                        'LastUpdateDate' VALUE TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                        'LastUpdateLogin' VALUE LAST_UPDATE_LOGIN,
                        'StopReason' VALUE STOP_REASON,
                        'StopReference' VALUE STOP_REFERENCE,
                        'IbyPaymentStatus' VALUE IBY_PAYMENT_STATUS,
                        'PaymentMode' VALUE PAYMENT_MODE,
                        'FundingCardAccount' VALUE FUNDING_CARD_ACCOUNT,
                        'DigitalPaymentAccount' VALUE DIGITAL_PAYMENT_ACCOUNT,
                        'SyncStatus' VALUE SYNC_STATUS
                        ABSENT ON NULL
                    ) ORDER BY PAYMENT_DATE DESC
                    RETURNING CLOB
                )
                FROM (
                    SELECT p.*,
                        (SELECT sh.ACCOUNTING_STATUS
                         FROM RR_SLA_ACCOUNTING_HEADERS sh
                         WHERE sh.SOURCE_TABLE = 'AP_PAYMENTS'
                           AND sh.SOURCE_ID = p.CHECK_ID
                         ORDER BY sh.HEADER_ID DESC
                         FETCH FIRST 1 ROW ONLY) AS SLA_ACCOUNTING_STATUS
                    FROM RR_AP_PAYMENTS_ALL p
                    WHERE (p_payment_number   IS NULL OR p.PAYMENT_NUMBER   = p_payment_number)
                      AND (p_payment_status   IS NULL OR p.PAYMENT_STATUS   = p_payment_status)
                      AND (p_payee            IS NULL OR UPPER(p.PAYEE) LIKE '%' || UPPER(p_payee) || '%')
                      AND (p_supplier_number  IS NULL OR p.SUPPLIER_NUMBER  = p_supplier_number)
                      AND (p_business_unit    IS NULL OR p.BUSINESS_UNIT    = p_business_unit)
                      AND (p_payment_currency IS NULL OR p.PAYMENT_CURRENCY = p_payment_currency)
                      AND (p_date_from        IS NULL OR p.PAYMENT_DATE    >= p_date_from)
                      AND (p_date_to          IS NULL OR p.PAYMENT_DATE    <= p_date_to)
                      AND (p_only_pdc <> 'Y' OR p.MATURITY_DATE IS NOT NULL)
                    ORDER BY p.PAYMENT_DATE DESC
                    OFFSET p_offset ROWS FETCH NEXT p_limit ROWS ONLY
                )
            )
            RETURNING CLOB
        )
        INTO v_result
        FROM DUAL;

        RETURN v_result;

    EXCEPTION
        WHEN OTHERS THEN
            RETURN '{"status": "error", "message": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_payments;

*/
-- ============================================================
-- END OF FUNCTION — paste above into package body, then compile.
-- Then run 116_add_payment_currency_filter.sql to update ORDS handler.
-- ============================================================
