-- ============================================================
-- 116c_payments_get_with_currency.sql
-- Replaces GET /ap/payments handler to query RR_AP_PAYMENTS_ALL
-- directly, adding payment_currency filter without changing the package.
-- ============================================================

BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'ap',
    p_pattern     => 'payments',
    p_method      => 'GET'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'payments',
    p_method         => 'GET',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_comments       => 'Get AP Payments with all filters including payment_currency',
    p_source         => q'[
DECLARE
    v_result     CLOB;
    v_date_from  DATE    := NULL;
    v_date_to    DATE    := NULL;
    v_only_pdc   VARCHAR2(1) := NVL(:only_pdc, 'N');
    v_limit      NUMBER  := NVL(TO_NUMBER(:limit  DEFAULT 100 ON CONVERSION ERROR), 100);
    v_offset     NUMBER  := NVL(TO_NUMBER(:offset DEFAULT 0   ON CONVERSION ERROR), 0);
    v_count      NUMBER;
    v_off        NUMBER  := 1;
    v_chunk_size NUMBER  := 30000;
    v_length     NUMBER;
BEGIN
    IF :date_from IS NOT NULL THEN
        BEGIN v_date_from := TO_DATE(:date_from, 'YYYY-MM-DD'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF :date_to IS NOT NULL THEN
        BEGIN v_date_to := TO_DATE(:date_to, 'YYYY-MM-DD'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM RR_AP_PAYMENTS_ALL
    WHERE ((:payment_number   IS NULL) OR PAYMENT_NUMBER   = :payment_number)
      AND ((:payment_status   IS NULL) OR PAYMENT_STATUS   = :payment_status)
      AND ((:payee            IS NULL) OR UPPER(PAYEE) LIKE '%' || UPPER(:payee) || '%')
      AND ((:supplier_number  IS NULL) OR SUPPLIER_NUMBER  = :supplier_number)
      AND ((:business_unit    IS NULL) OR BUSINESS_UNIT    = :business_unit)
      AND ((:payment_currency IS NULL) OR PAYMENT_CURRENCY = :payment_currency)
      AND ((v_date_from       IS NULL) OR PAYMENT_DATE    >= v_date_from)
      AND ((v_date_to         IS NULL) OR PAYMENT_DATE    <= v_date_to)
      AND (v_only_pdc <> 'Y' OR MATURITY_DATE IS NOT NULL);

    SELECT JSON_OBJECT(
        'count' VALUE v_count,
        'limit' VALUE v_limit,
        'offset' VALUE v_offset,
        'items' VALUE (
            SELECT JSON_ARRAYAGG(
                JSON_OBJECT(
                    'CheckId'                    VALUE p.CHECK_ID,
                    'PaymentId'                  VALUE p.PAYMENT_ID,
                    'PaymentReference'           VALUE p.PAYMENT_REFERENCE,
                    'PaperDocumentNumber'        VALUE p.PAPER_DOCUMENT_NUMBER,
                    'PaymentNumber'              VALUE p.PAYMENT_NUMBER,
                    'PaymentFileReference'       VALUE p.PAYMENT_FILE_REFERENCE,
                    'PaymentProcessRequest'      VALUE p.PAYMENT_PROCESS_REQUEST,
                    'PaymentAmount'              VALUE p.PAYMENT_AMOUNT,
                    'PaymentDate'                VALUE TO_CHAR(p.PAYMENT_DATE, 'YYYY-MM-DD'),
                    'AccountingDate'             VALUE TO_CHAR(p.ACCOUNTING_DATE, 'YYYY-MM-DD'),
                    'PaymentDescription'         VALUE p.PAYMENT_DESCRIPTION,
                    'ConversionRate'             VALUE p.CONVERSION_RATE,
                    'ConversionDate'             VALUE TO_CHAR(p.CONVERSION_DATE, 'YYYY-MM-DD'),
                    'ConversionRateType'         VALUE p.CONVERSION_RATE_TYPE,
                    'ClearingDate'               VALUE TO_CHAR(p.CLEARING_DATE, 'YYYY-MM-DD'),
                    'ClearingAmount'             VALUE p.CLEARING_AMOUNT,
                    'ClearingLedgerAmount'       VALUE p.CLEARING_LEDGER_AMOUNT,
                    'ClearingConversionRate'     VALUE p.CLEARING_CONVERSION_RATE,
                    'ClearingConversionDate'     VALUE TO_CHAR(p.CLEARING_CONVERSION_DATE, 'YYYY-MM-DD'),
                    'ClearingConversionRateType' VALUE p.CLEARING_CONVERSION_RATE_TYPE,
                    'CrossCurrencyRateType'      VALUE p.CROSS_CURRENCY_RATE_TYPE,
                    'MaturityDate'               VALUE TO_CHAR(p.MATURITY_DATE, 'YYYY-MM-DD'),
                    'MaturityConversionRateType' VALUE p.MATURITY_CONVERSION_RATE_TYPE,
                    'MaturityConversionDate'     VALUE TO_CHAR(p.MATURITY_CONVERSION_DATE, 'YYYY-MM-DD'),
                    'MaturityConversionRate'     VALUE p.MATURITY_CONVERSION_RATE,
                    'AnticipatedValueDate'       VALUE TO_CHAR(p.ANTICIPATED_VALUE_DATE, 'YYYY-MM-DD'),
                    'ClearingValueDate'          VALUE TO_CHAR(p.CLEARING_VALUE_DATE, 'YYYY-MM-DD'),
                    'StopDate'                   VALUE TO_CHAR(p.STOP_DATE, 'YYYY-MM-DD'),
                    'VoidDate'                   VALUE TO_CHAR(p.VOID_DATE, 'YYYY-MM-DD'),
                    'VoidAccountingDate'         VALUE TO_CHAR(p.VOID_ACCOUNTING_DATE, 'YYYY-MM-DD'),
                    'PaymentStatus'              VALUE p.PAYMENT_STATUS,
                    'AccountingStatus'           VALUE (
                        SELECT sh.ACCOUNTING_STATUS
                        FROM RR_SLA_ACCOUNTING_HEADERS sh
                        WHERE sh.SOURCE_TABLE = 'AP_PAYMENTS'
                          AND sh.SOURCE_ID    = p.CHECK_ID
                          AND ROWNUM = 1
                    ),
                    'ReconciledFlag'             VALUE CASE WHEN p.RECONCILED_FLAG = 'Y' THEN 'true' ELSE 'false' END,
                    'PaymentType'                VALUE p.PAYMENT_TYPE,
                    'PaymentCurrency'            VALUE p.PAYMENT_CURRENCY,
                    'WithheldAmount'             VALUE p.WITHHELD_AMOUNT,
                    'BankChargeAmount'           VALUE p.BANK_CHARGE_AMOUNT,
                    'LegalEntity'                VALUE p.LEGAL_ENTITY,
                    'BusinessUnit'               VALUE p.BUSINESS_UNIT,
                    'PaymentFunction'            VALUE p.PAYMENT_FUNCTION,
                    'Payee'                      VALUE p.PAYEE,
                    'PartyId'                    VALUE p.PARTY_ID,
                    'ProcurementBU'              VALUE p.PROCUREMENT_BU,
                    'PayeeSite'                  VALUE p.PAYEE_SITE,
                    'SupplierNumber'             VALUE p.SUPPLIER_NUMBER,
                    'RemitToAccountNumber'       VALUE p.REMIT_TO_ACCOUNT_NUMBER,
                    'DisbursementBankAccountNumber' VALUE p.DISBURSEMENT_BANK_ACCOUNT_NUMBER,
                    'DisbursementBankAccountName'   VALUE p.DISBURSEMENT_BANK_ACCOUNT_NAME,
                    'PaymentMethodCode'          VALUE p.PAYMENT_METHOD_CODE,
                    'PaymentMethod'              VALUE p.PAYMENT_METHOD,
                    'PaymentDocument'            VALUE p.PAYMENT_DOCUMENT,
                    'PaymentProcessProfile'      VALUE p.PAYMENT_PROCESS_PROFILE,
                    'DocumentCategory'           VALUE p.DOCUMENT_CATEGORY,
                    'DocumentSequence'           VALUE p.DOCUMENT_SEQUENCE,
                    'VoucherNumber'              VALUE p.VOUCHER_NUMBER,
                    'PaymentBaseAmount'          VALUE p.PAYMENT_BASE_AMOUNT,
                    'PaymentBaseCurrency'        VALUE p.PAYMENT_BASE_CURRENCY,
                    'AddressLine1'               VALUE p.ADDRESS_LINE1,
                    'AddressLine2'               VALUE p.ADDRESS_LINE2,
                    'AddressLine3'               VALUE p.ADDRESS_LINE3,
                    'AddressLine4'               VALUE p.ADDRESS_LINE4,
                    'City'                       VALUE p.CITY,
                    'Country'                    VALUE p.COUNTRY,
                    'CreatedBy'                  VALUE p.CREATED_BY,
                    'CreationDate'               VALUE TO_CHAR(p.CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'),
                    'LastUpdatedBy'              VALUE p.LAST_UPDATED_BY,
                    'LastUpdateDate'             VALUE TO_CHAR(p.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
                    'StopReason'                 VALUE p.STOP_REASON,
                    'StopReference'              VALUE p.STOP_REFERENCE,
                    'PaymentMode'                VALUE p.PAYMENT_MODE,
                    'SyncStatus'                 VALUE p.SYNC_STATUS
                    ABSENT ON NULL
                ) ORDER BY p.PAYMENT_DATE DESC
                RETURNING CLOB
            )
            FROM RR_AP_PAYMENTS_ALL p
            WHERE ((:payment_number   IS NULL) OR p.PAYMENT_NUMBER   = :payment_number)
              AND ((:payment_status   IS NULL) OR p.PAYMENT_STATUS   = :payment_status)
              AND ((:payee            IS NULL) OR UPPER(p.PAYEE) LIKE '%' || UPPER(:payee) || '%')
              AND ((:supplier_number  IS NULL) OR p.SUPPLIER_NUMBER  = :supplier_number)
              AND ((:business_unit    IS NULL) OR p.BUSINESS_UNIT    = :business_unit)
              AND ((:payment_currency IS NULL) OR p.PAYMENT_CURRENCY = :payment_currency)
              AND ((v_date_from       IS NULL) OR p.PAYMENT_DATE    >= v_date_from)
              AND ((v_date_to         IS NULL) OR p.PAYMENT_DATE    <= v_date_to)
              AND (v_only_pdc <> 'Y' OR p.MATURITY_DATE IS NOT NULL)
            OFFSET v_offset ROWS FETCH NEXT v_limit ROWS ONLY
        )
        RETURNING CLOB
    )
    INTO v_result
    FROM DUAL;

    OWA_UTIL.MIME_HEADER('application/json', FALSE);

    v_length := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
    WHILE v_off <= v_length LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_chunk_size, v_off));
        v_off := v_off + v_chunk_size;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
  );
  COMMIT;
END;
/
