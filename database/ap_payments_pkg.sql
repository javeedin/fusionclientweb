-- ============================================
-- XXAP_PAYMENTS_PKG Package
-- Handles AP Payment data operations
-- ============================================

-- ============================================
-- Sequence for locally-created payments
-- Used when CheckId is null (not synced from Fusion).
-- Generates negative IDs so they never collide with
-- Oracle Fusion's positive 18-digit CHECK_IDs.
-- Safe to re-run: ignores ORA-00955 if already exists.
-- ============================================
BEGIN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_AP_PAYMENTS_SEQ
        START WITH 1
        INCREMENT BY 1
        NOCACHE
        NOCYCLE';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF; -- ORA-00955: already exists
END;
/

-- Dedicated sequence for PAYMENT_NUMBER (PAY-YYYYMMDD-NNNNNN)
-- Separate from CHECK_ID sequence so numbers are compact and predictable.
BEGIN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_AP_PAY_NUM_SEQ
        START WITH 1
        INCREMENT BY 1
        NOCACHE
        NOCYCLE';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

CREATE OR REPLACE PACKAGE XXAP_PAYMENTS_PKG AS

    -- Save single payment from JSON
    PROCEDURE save_payment(
        p_json_data IN CLOB,
        p_result OUT VARCHAR2
    );

    -- Save multiple payments from JSON array
    PROCEDURE save_payments_bulk(
        p_json_data IN CLOB,
        p_result OUT VARCHAR2
    );

    -- Save payments from items array format { "items": [...] }
    PROCEDURE save_payments_from_items(
        p_json_data IN CLOB,
        p_result OUT VARCHAR2
    );

    -- Get payment by Check ID
    FUNCTION get_payment_by_check_id(
        p_check_id IN NUMBER
    ) RETURN CLOB;

    -- Get payments with filters
    FUNCTION get_payments(
        p_payment_number    IN VARCHAR2 DEFAULT NULL,
        p_payment_status    IN VARCHAR2 DEFAULT NULL,
        p_payee             IN VARCHAR2 DEFAULT NULL,
        p_supplier_number   IN VARCHAR2 DEFAULT NULL,
        p_business_unit     IN VARCHAR2 DEFAULT NULL,
        p_date_from         IN DATE DEFAULT NULL,
        p_date_to           IN DATE DEFAULT NULL,
        p_only_pdc          IN VARCHAR2 DEFAULT 'N',
        p_limit             IN NUMBER DEFAULT 100,
        p_offset            IN NUMBER DEFAULT 0
    ) RETURN CLOB;

END XXAP_PAYMENTS_PKG;
/

CREATE OR REPLACE PACKAGE BODY XXAP_PAYMENTS_PKG AS

    -- Save single payment
    PROCEDURE save_payment(
        p_json_data IN CLOB,
        p_result OUT VARCHAR2
    ) IS
        -- Payment identification
        v_check_id NUMBER;
        v_payment_id NUMBER;
        v_payment_reference VARCHAR2(240);
        v_paper_document_number VARCHAR2(100);
        v_payment_number VARCHAR2(100);
        v_payment_file_reference NUMBER;
        v_payment_process_request VARCHAR2(500);
        v_voucher_number VARCHAR2(100);

        -- Amounts
        v_payment_amount NUMBER;
        v_payment_base_amount NUMBER;
        v_withheld_amount NUMBER;
        v_bank_charge_amount NUMBER;

        -- Dates
        v_payment_date DATE;
        v_accounting_date DATE;
        v_maturity_date DATE;
        v_anticipated_value_date DATE;
        v_stop_date DATE;
        v_void_date DATE;
        v_void_accounting_date DATE;
        v_conversion_date DATE;
        v_clearing_date DATE;
        v_clearing_conversion_date DATE;
        v_clearing_value_date DATE;
        v_maturity_conversion_date DATE;

        -- Timestamps
        v_creation_date TIMESTAMP WITH TIME ZONE;
        v_last_update_date TIMESTAMP WITH TIME ZONE;

        -- Details
        v_payment_description VARCHAR2(500);
        v_payment_status VARCHAR2(50);
        v_payment_type VARCHAR2(50);
        v_payment_mode VARCHAR2(50);
        v_payment_function VARCHAR2(100);

        -- Currency
        v_payment_currency VARCHAR2(15);
        v_payment_base_currency VARCHAR2(15);
        v_conversion_rate NUMBER;
        v_conversion_rate_type VARCHAR2(50);
        v_cross_currency_rate_type VARCHAR2(50);

        -- Clearing
        v_clearing_amount NUMBER;
        v_clearing_ledger_amount NUMBER;
        v_clearing_conversion_rate NUMBER;
        v_clearing_conv_rate_type VARCHAR2(50);

        -- Maturity
        v_maturity_conv_rate_type VARCHAR2(50);
        v_maturity_conversion_rate NUMBER;

        -- Status
        v_accounting_status VARCHAR2(50);
        v_reconciled_flag VARCHAR2(1);
        v_separate_remit_advice VARCHAR2(1);
        v_iby_payment_status VARCHAR2(50);

        -- Organization
        v_legal_entity VARCHAR2(240);
        v_business_unit VARCHAR2(240);
        v_procurement_bu VARCHAR2(240);

        -- Payee
        v_payee VARCHAR2(360);
        v_party_id NUMBER;
        v_payee_site VARCHAR2(240);
        v_supplier_number VARCHAR2(100);
        v_employee_address VARCHAR2(500);
        v_third_party_supplier VARCHAR2(360);
        v_third_party_address_name VARCHAR2(240);

        -- Bank
        v_external_bank_account_id NUMBER;
        v_remit_to_account_number VARCHAR2(100);
        v_disb_bank_account_number VARCHAR2(100);
        v_disb_bank_account_name VARCHAR2(240);
        v_funding_card_account VARCHAR2(100);
        v_digital_payment_account VARCHAR2(100);

        -- Payment method
        v_payment_method_code VARCHAR2(50);
        v_payment_method VARCHAR2(100);
        v_payment_document VARCHAR2(240);
        v_payment_process_profile_code VARCHAR2(100);
        v_payment_process_profile VARCHAR2(240);

        -- Document
        v_document_category VARCHAR2(100);
        v_document_sequence VARCHAR2(100);

        -- Address
        v_address_line1 VARCHAR2(240);
        v_address_line2 VARCHAR2(240);
        v_address_line3 VARCHAR2(240);
        v_address_line4 VARCHAR2(240);
        v_city VARCHAR2(100);
        v_county VARCHAR2(100);
        v_province VARCHAR2(100);
        v_state VARCHAR2(100);
        v_country VARCHAR2(10);
        v_zip VARCHAR2(50);

        -- Stop/Void
        v_stop_reason VARCHAR2(500);
        v_stop_reference VARCHAR2(240);

        -- Audit
        v_created_by VARCHAR2(100);
        v_last_updated_by VARCHAR2(100);
        v_last_update_login VARCHAR2(100);

        -- Temp variables for parsing
        v_temp_str VARCHAR2(100);
        v_reconciled_raw VARCHAR2(10);
        v_is_local VARCHAR2(1) := 'N'; -- 'Y' when CHECK_ID was auto-generated (not from Fusion)

    BEGIN
        -- Step 1: Read CheckId from JSON (Fusion sync provides it; local payments send null)
        v_check_id := JSON_VALUE(p_json_data, '$.CheckId' RETURNING NUMBER);

        -- Step 2: No CheckId in JSON → auto-assign via sequence (negative = local, never collides with Fusion)
        IF v_check_id IS NULL THEN
            SELECT -RR_AP_PAYMENTS_SEQ.NEXTVAL INTO v_check_id FROM DUAL;
            v_is_local := 'Y';
        END IF;

        -- Step 3: Extract all other fields (CheckId already resolved above)
        SELECT
            JSON_VALUE(p_json_data, '$.PaymentId' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.PaymentReference'),
            JSON_VALUE(p_json_data, '$.PaperDocumentNumber'),
            JSON_VALUE(p_json_data, '$.PaymentNumber'),
            JSON_VALUE(p_json_data, '$.PaymentFileReference' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.PaymentProcessRequest'),
            JSON_VALUE(p_json_data, '$.VoucherNumber'),
            JSON_VALUE(p_json_data, '$.PaymentAmount' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.PaymentBaseAmount' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.WithheldAmount' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.BankChargeAmount' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.PaymentDescription'),
            JSON_VALUE(p_json_data, '$.PaymentStatus'),
            JSON_VALUE(p_json_data, '$.PaymentType'),
            JSON_VALUE(p_json_data, '$.PaymentMode'),
            JSON_VALUE(p_json_data, '$.PaymentFunction'),
            JSON_VALUE(p_json_data, '$.PaymentCurrency'),
            JSON_VALUE(p_json_data, '$.PaymentBaseCurrency'),
            JSON_VALUE(p_json_data, '$.ConversionRate' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.ConversionRateType'),
            JSON_VALUE(p_json_data, '$.CrossCurrencyRateType'),
            JSON_VALUE(p_json_data, '$.ClearingAmount' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.ClearingLedgerAmount' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.ClearingConversionRate' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.ClearingConversionRateType'),
            JSON_VALUE(p_json_data, '$.MaturityConversionRateType'),
            JSON_VALUE(p_json_data, '$.MaturityConversionRate' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.AccountingStatus'),
            JSON_VALUE(p_json_data, '$.ReconciledFlag'),
            JSON_VALUE(p_json_data, '$.SeparateRemittanceAdviceCreated'),
            JSON_VALUE(p_json_data, '$.IbyPaymentStatus'),
            JSON_VALUE(p_json_data, '$.LegalEntity'),
            JSON_VALUE(p_json_data, '$.BusinessUnit'),
            JSON_VALUE(p_json_data, '$.ProcurementBU'),
            JSON_VALUE(p_json_data, '$.Payee'),
            JSON_VALUE(p_json_data, '$.PartyId' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.PayeeSite'),
            JSON_VALUE(p_json_data, '$.SupplierNumber'),
            JSON_VALUE(p_json_data, '$.EmployeeAddress'),
            JSON_VALUE(p_json_data, '$.ThirdPartySupplier'),
            JSON_VALUE(p_json_data, '$.ThirdPartyAddressName'),
            JSON_VALUE(p_json_data, '$.ExternalBankAccountId' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.RemitToAccountNumber'),
            JSON_VALUE(p_json_data, '$.DisbursementBankAccountNumber'),
            JSON_VALUE(p_json_data, '$.DisbursementBankAccountName'),
            JSON_VALUE(p_json_data, '$.FundingCardAccount'),
            JSON_VALUE(p_json_data, '$.DigitalPaymentAccount'),
            JSON_VALUE(p_json_data, '$.PaymentMethodCode'),
            JSON_VALUE(p_json_data, '$.PaymentMethod'),
            JSON_VALUE(p_json_data, '$.PaymentDocument'),
            JSON_VALUE(p_json_data, '$.PaymentProcessProfileCode'),
            JSON_VALUE(p_json_data, '$.PaymentProcessProfile'),
            JSON_VALUE(p_json_data, '$.DocumentCategory'),
            JSON_VALUE(p_json_data, '$.DocumentSequence'),
            JSON_VALUE(p_json_data, '$.AddressLine1'),
            JSON_VALUE(p_json_data, '$.AddressLine2'),
            JSON_VALUE(p_json_data, '$.AddressLine3'),
            JSON_VALUE(p_json_data, '$.AddressLine4'),
            JSON_VALUE(p_json_data, '$.City'),
            JSON_VALUE(p_json_data, '$.County'),
            JSON_VALUE(p_json_data, '$.Province'),
            JSON_VALUE(p_json_data, '$.State'),
            JSON_VALUE(p_json_data, '$.Country'),
            JSON_VALUE(p_json_data, '$.Zip'),
            JSON_VALUE(p_json_data, '$.StopReason'),
            JSON_VALUE(p_json_data, '$.StopReference'),
            JSON_VALUE(p_json_data, '$.CreatedBy'),
            JSON_VALUE(p_json_data, '$.LastUpdatedBy'),
            JSON_VALUE(p_json_data, '$.LastUpdateLogin')
        INTO
            v_payment_id, v_payment_reference, v_paper_document_number,
            v_payment_number, v_payment_file_reference, v_payment_process_request, v_voucher_number,
            v_payment_amount, v_payment_base_amount, v_withheld_amount, v_bank_charge_amount,
            v_payment_description, v_payment_status, v_payment_type, v_payment_mode, v_payment_function,
            v_payment_currency, v_payment_base_currency, v_conversion_rate, v_conversion_rate_type,
            v_cross_currency_rate_type, v_clearing_amount, v_clearing_ledger_amount,
            v_clearing_conversion_rate, v_clearing_conv_rate_type, v_maturity_conv_rate_type,
            v_maturity_conversion_rate, v_accounting_status, v_reconciled_raw, v_separate_remit_advice,
            v_iby_payment_status, v_legal_entity, v_business_unit, v_procurement_bu,
            v_payee, v_party_id, v_payee_site, v_supplier_number, v_employee_address,
            v_third_party_supplier, v_third_party_address_name, v_external_bank_account_id,
            v_remit_to_account_number, v_disb_bank_account_number, v_disb_bank_account_name,
            v_funding_card_account, v_digital_payment_account, v_payment_method_code, v_payment_method,
            v_payment_document, v_payment_process_profile_code, v_payment_process_profile,
            v_document_category, v_document_sequence, v_address_line1, v_address_line2,
            v_address_line3, v_address_line4, v_city, v_county, v_province, v_state,
            v_country, v_zip, v_stop_reason, v_stop_reference, v_created_by, v_last_updated_by,
            v_last_update_login
        FROM DUAL;

        -- Parse reconciled flag
        v_reconciled_flag := CASE WHEN UPPER(v_reconciled_raw) IN ('TRUE', 'Y', '1') THEN 'Y' ELSE 'N' END;

        -- Auto-generate PaymentNumber if not supplied using a dedicated sequence.
        -- Format: PAY-YYYYMMDD-NNNNNN
        IF v_payment_number IS NULL THEN
            v_payment_number := 'PAY-' || TO_CHAR(SYSDATE, 'YYYYMMDD') || '-' || LPAD(TO_CHAR(RR_AP_PAY_NUM_SEQ.NEXTVAL), 6, '0');
        END IF;
        IF v_paper_document_number IS NULL THEN
            v_paper_document_number := v_payment_number;
        END IF;

        -- Parse dates
        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.PaymentDate');
            IF v_temp_str IS NOT NULL THEN
                v_payment_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_payment_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.AccountingDate');
            IF v_temp_str IS NOT NULL THEN
                v_accounting_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_accounting_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.MaturityDate');
            IF v_temp_str IS NOT NULL THEN
                v_maturity_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_maturity_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.AnticipatedValueDate');
            IF v_temp_str IS NOT NULL THEN
                v_anticipated_value_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_anticipated_value_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.StopDate');
            IF v_temp_str IS NOT NULL THEN
                v_stop_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_stop_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.VoidDate');
            IF v_temp_str IS NOT NULL THEN
                v_void_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_void_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.VoidAccountingDate');
            IF v_temp_str IS NOT NULL THEN
                v_void_accounting_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_void_accounting_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.ConversionDate');
            IF v_temp_str IS NOT NULL THEN
                v_conversion_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_conversion_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.ClearingDate');
            IF v_temp_str IS NOT NULL THEN
                v_clearing_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_clearing_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.ClearingConversionDate');
            IF v_temp_str IS NOT NULL THEN
                v_clearing_conversion_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_clearing_conversion_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.ClearingValueDate');
            IF v_temp_str IS NOT NULL THEN
                v_clearing_value_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_clearing_value_date := NULL;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.MaturityConversionDate');
            IF v_temp_str IS NOT NULL THEN
                v_maturity_conversion_date := TO_DATE(SUBSTR(v_temp_str, 1, 10), 'YYYY-MM-DD');
            END IF;
        EXCEPTION WHEN OTHERS THEN v_maturity_conversion_date := NULL;
        END;

        -- Parse timestamps
        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.CreationDate');
            IF v_temp_str IS NOT NULL THEN
                v_creation_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM');
            END IF;
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                v_creation_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
            EXCEPTION WHEN OTHERS THEN v_creation_date := NULL;
            END;
        END;

        BEGIN
            v_temp_str := JSON_VALUE(p_json_data, '$.LastUpdateDate');
            IF v_temp_str IS NOT NULL THEN
                v_last_update_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM');
            END IF;
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                v_last_update_date := TO_TIMESTAMP_TZ(v_temp_str, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
            EXCEPTION WHEN OTHERS THEN v_last_update_date := NULL;
            END;
        END;

        -- Merge (upsert) payment data
        MERGE INTO RR_AP_PAYMENTS_ALL tgt
        USING (SELECT v_check_id AS CHECK_ID FROM DUAL) src
        ON (tgt.CHECK_ID = src.CHECK_ID)
        WHEN MATCHED THEN
            UPDATE SET
                PAYMENT_ID = v_payment_id,
                PAYMENT_REFERENCE = v_payment_reference,
                PAPER_DOCUMENT_NUMBER = v_paper_document_number,
                PAYMENT_NUMBER = v_payment_number,
                PAYMENT_FILE_REFERENCE = v_payment_file_reference,
                PAYMENT_PROCESS_REQUEST = v_payment_process_request,
                VOUCHER_NUMBER = v_voucher_number,
                PAYMENT_AMOUNT = v_payment_amount,
                PAYMENT_BASE_AMOUNT = v_payment_base_amount,
                WITHHELD_AMOUNT = v_withheld_amount,
                BANK_CHARGE_AMOUNT = v_bank_charge_amount,
                PAYMENT_DATE = v_payment_date,
                ACCOUNTING_DATE = v_accounting_date,
                MATURITY_DATE = v_maturity_date,
                ANTICIPATED_VALUE_DATE = v_anticipated_value_date,
                STOP_DATE = v_stop_date,
                VOID_DATE = v_void_date,
                VOID_ACCOUNTING_DATE = v_void_accounting_date,
                PAYMENT_DESCRIPTION = v_payment_description,
                PAYMENT_STATUS = v_payment_status,
                PAYMENT_TYPE = v_payment_type,
                PAYMENT_MODE = v_payment_mode,
                PAYMENT_FUNCTION = v_payment_function,
                PAYMENT_CURRENCY = v_payment_currency,
                PAYMENT_BASE_CURRENCY = v_payment_base_currency,
                CONVERSION_RATE = v_conversion_rate,
                CONVERSION_DATE = v_conversion_date,
                CONVERSION_RATE_TYPE = v_conversion_rate_type,
                CROSS_CURRENCY_RATE_TYPE = v_cross_currency_rate_type,
                CLEARING_DATE = v_clearing_date,
                CLEARING_AMOUNT = v_clearing_amount,
                CLEARING_LEDGER_AMOUNT = v_clearing_ledger_amount,
                CLEARING_CONVERSION_RATE = v_clearing_conversion_rate,
                CLEARING_CONVERSION_DATE = v_clearing_conversion_date,
                CLEARING_CONVERSION_RATE_TYPE = v_clearing_conv_rate_type,
                CLEARING_VALUE_DATE = v_clearing_value_date,
                MATURITY_CONVERSION_RATE_TYPE = v_maturity_conv_rate_type,
                MATURITY_CONVERSION_DATE = v_maturity_conversion_date,
                MATURITY_CONVERSION_RATE = v_maturity_conversion_rate,
                ACCOUNTING_STATUS = v_accounting_status,
                RECONCILED_FLAG = v_reconciled_flag,
                SEPARATE_REMITTANCE_ADVICE_CREATED = v_separate_remit_advice,
                IBY_PAYMENT_STATUS = v_iby_payment_status,
                LEGAL_ENTITY = v_legal_entity,
                BUSINESS_UNIT = v_business_unit,
                PROCUREMENT_BU = v_procurement_bu,
                PAYEE = v_payee,
                PARTY_ID = v_party_id,
                PAYEE_SITE = v_payee_site,
                SUPPLIER_NUMBER = v_supplier_number,
                EMPLOYEE_ADDRESS = v_employee_address,
                THIRD_PARTY_SUPPLIER = v_third_party_supplier,
                THIRD_PARTY_ADDRESS_NAME = v_third_party_address_name,
                EXTERNAL_BANK_ACCOUNT_ID = v_external_bank_account_id,
                REMIT_TO_ACCOUNT_NUMBER = v_remit_to_account_number,
                DISBURSEMENT_BANK_ACCOUNT_NUMBER = v_disb_bank_account_number,
                DISBURSEMENT_BANK_ACCOUNT_NAME = v_disb_bank_account_name,
                FUNDING_CARD_ACCOUNT = v_funding_card_account,
                DIGITAL_PAYMENT_ACCOUNT = v_digital_payment_account,
                PAYMENT_METHOD_CODE = v_payment_method_code,
                PAYMENT_METHOD = v_payment_method,
                PAYMENT_DOCUMENT = v_payment_document,
                PAYMENT_PROCESS_PROFILE_CODE = v_payment_process_profile_code,
                PAYMENT_PROCESS_PROFILE = v_payment_process_profile,
                DOCUMENT_CATEGORY = v_document_category,
                DOCUMENT_SEQUENCE = v_document_sequence,
                ADDRESS_LINE1 = v_address_line1,
                ADDRESS_LINE2 = v_address_line2,
                ADDRESS_LINE3 = v_address_line3,
                ADDRESS_LINE4 = v_address_line4,
                CITY = v_city,
                COUNTY = v_county,
                PROVINCE = v_province,
                STATE = v_state,
                COUNTRY = v_country,
                ZIP = v_zip,
                STOP_REASON = v_stop_reason,
                STOP_REFERENCE = v_stop_reference,
                CREATED_BY = v_created_by,
                CREATION_DATE = v_creation_date,
                LAST_UPDATED_BY = v_last_updated_by,
                LAST_UPDATE_DATE = v_last_update_date,
                LAST_UPDATE_LOGIN = v_last_update_login,
                LOCAL_UPDATED_DATE = SYSTIMESTAMP,
                SYNC_STATUS = 'SYNCED'
        WHEN NOT MATCHED THEN
            INSERT (
                CHECK_ID, PAYMENT_ID, PAYMENT_REFERENCE, PAPER_DOCUMENT_NUMBER,
                PAYMENT_NUMBER, PAYMENT_FILE_REFERENCE, PAYMENT_PROCESS_REQUEST, VOUCHER_NUMBER,
                PAYMENT_AMOUNT, PAYMENT_BASE_AMOUNT, WITHHELD_AMOUNT, BANK_CHARGE_AMOUNT,
                PAYMENT_DATE, ACCOUNTING_DATE, MATURITY_DATE, ANTICIPATED_VALUE_DATE,
                STOP_DATE, VOID_DATE, VOID_ACCOUNTING_DATE,
                PAYMENT_DESCRIPTION, PAYMENT_STATUS, PAYMENT_TYPE, PAYMENT_MODE, PAYMENT_FUNCTION,
                PAYMENT_CURRENCY, PAYMENT_BASE_CURRENCY, CONVERSION_RATE, CONVERSION_DATE, CONVERSION_RATE_TYPE,
                CROSS_CURRENCY_RATE_TYPE,
                CLEARING_DATE, CLEARING_AMOUNT, CLEARING_LEDGER_AMOUNT, CLEARING_CONVERSION_RATE,
                CLEARING_CONVERSION_DATE, CLEARING_CONVERSION_RATE_TYPE, CLEARING_VALUE_DATE,
                MATURITY_CONVERSION_RATE_TYPE, MATURITY_CONVERSION_DATE, MATURITY_CONVERSION_RATE,
                ACCOUNTING_STATUS, RECONCILED_FLAG, SEPARATE_REMITTANCE_ADVICE_CREATED, IBY_PAYMENT_STATUS,
                LEGAL_ENTITY, BUSINESS_UNIT, PROCUREMENT_BU,
                PAYEE, PARTY_ID, PAYEE_SITE, SUPPLIER_NUMBER, EMPLOYEE_ADDRESS,
                THIRD_PARTY_SUPPLIER, THIRD_PARTY_ADDRESS_NAME,
                EXTERNAL_BANK_ACCOUNT_ID, REMIT_TO_ACCOUNT_NUMBER, DISBURSEMENT_BANK_ACCOUNT_NUMBER,
                DISBURSEMENT_BANK_ACCOUNT_NAME, FUNDING_CARD_ACCOUNT, DIGITAL_PAYMENT_ACCOUNT,
                PAYMENT_METHOD_CODE, PAYMENT_METHOD, PAYMENT_DOCUMENT,
                PAYMENT_PROCESS_PROFILE_CODE, PAYMENT_PROCESS_PROFILE,
                DOCUMENT_CATEGORY, DOCUMENT_SEQUENCE,
                ADDRESS_LINE1, ADDRESS_LINE2, ADDRESS_LINE3, ADDRESS_LINE4,
                CITY, COUNTY, PROVINCE, STATE, COUNTRY, ZIP,
                STOP_REASON, STOP_REFERENCE,
                CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE, LAST_UPDATE_LOGIN,
                LOCAL_CREATED_DATE, LOCAL_UPDATED_DATE, SYNC_STATUS
            )
            VALUES (
                v_check_id, v_payment_id, v_payment_reference, v_paper_document_number,
                v_payment_number, v_payment_file_reference, v_payment_process_request, v_voucher_number,
                v_payment_amount, v_payment_base_amount, v_withheld_amount, v_bank_charge_amount,
                v_payment_date, v_accounting_date, v_maturity_date, v_anticipated_value_date,
                v_stop_date, v_void_date, v_void_accounting_date,
                v_payment_description, v_payment_status, v_payment_type, v_payment_mode, v_payment_function,
                v_payment_currency, v_payment_base_currency, v_conversion_rate, v_conversion_date, v_conversion_rate_type,
                v_cross_currency_rate_type,
                v_clearing_date, v_clearing_amount, v_clearing_ledger_amount, v_clearing_conversion_rate,
                v_clearing_conversion_date, v_clearing_conv_rate_type, v_clearing_value_date,
                v_maturity_conv_rate_type, v_maturity_conversion_date, v_maturity_conversion_rate,
                v_accounting_status, v_reconciled_flag, v_separate_remit_advice, v_iby_payment_status,
                v_legal_entity, v_business_unit, v_procurement_bu,
                v_payee, v_party_id, v_payee_site, v_supplier_number, v_employee_address,
                v_third_party_supplier, v_third_party_address_name,
                v_external_bank_account_id, v_remit_to_account_number, v_disb_bank_account_number,
                v_disb_bank_account_name, v_funding_card_account, v_digital_payment_account,
                v_payment_method_code, v_payment_method, v_payment_document,
                v_payment_process_profile_code, v_payment_process_profile,
                v_document_category, v_document_sequence,
                v_address_line1, v_address_line2, v_address_line3, v_address_line4,
                v_city, v_county, v_province, v_state, v_country, v_zip,
                v_stop_reason, v_stop_reference,
                v_created_by, v_creation_date, v_last_updated_by, v_last_update_date, v_last_update_login,
                SYSTIMESTAMP, SYSTIMESTAMP, CASE WHEN v_is_local = 'Y' THEN 'LOCAL' ELSE 'SYNCED' END
            );

        COMMIT;
        p_result := '{"status": "success", "message": "Payment saved successfully", "checkId": ' || v_check_id || ', "paymentNumber": "' || v_payment_number || '"}';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status": "error", "message": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END save_payment;

    -- Save multiple payments from JSON array
    PROCEDURE save_payments_bulk(
        p_json_data IN CLOB,
        p_result OUT VARCHAR2
    ) IS
        v_count         NUMBER := 0;
        v_errors        NUMBER := 0;
        v_result        VARCHAR2(4000);
        v_check_ids     VARCHAR2(4000) := '';
        v_check_id_str  VARCHAR2(50);
        v_first_check_id VARCHAR2(50) := 'null';
    BEGIN
        -- Loop through JSON array
        FOR rec IN (
            SELECT jt.payment_data
            FROM JSON_TABLE(p_json_data, '$[*]'
                COLUMNS (
                    payment_data CLOB FORMAT JSON PATH '$'
                )
            ) jt
        ) LOOP
            BEGIN
                save_payment(rec.payment_data, v_result);
                IF INSTR(v_result, '"status": "success"') > 0 THEN
                    v_count := v_count + 1;
                    -- Extract the checkId generated by save_payment()
                    v_check_id_str := REGEXP_SUBSTR(v_result, '"checkId":\s*(-?\d+)', 1, 1, NULL, 1);
                    IF v_check_id_str IS NOT NULL THEN
                        IF v_check_ids IS NOT NULL THEN v_check_ids := v_check_ids || ','; END IF;
                        v_check_ids := v_check_ids || v_check_id_str;
                        -- Keep first checkId as top-level convenience field
                        IF v_first_check_id = 'null' THEN
                            v_first_check_id := v_check_id_str;
                        END IF;
                    END IF;
                ELSE
                    v_errors := v_errors + 1;
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    v_errors := v_errors + 1;
            END;
        END LOOP;

        p_result := '{"status": "success", "saved": ' || v_count ||
                    ', "errors": ' || v_errors ||
                    ', "checkId": '  || v_first_check_id ||
                    ', "checkIds": [' || v_check_ids || ']}';

    EXCEPTION
        WHEN OTHERS THEN
            p_result := '{"status": "error", "message": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END save_payments_bulk;

    -- Save payments from items format
    PROCEDURE save_payments_from_items(
        p_json_data IN CLOB,
        p_result OUT VARCHAR2
    ) IS
        v_count          NUMBER := 0;
        v_errors         NUMBER := 0;
        v_result         VARCHAR2(4000);
        v_check_ids      VARCHAR2(4000) := '';
        v_check_id_str   VARCHAR2(50);
        v_first_check_id VARCHAR2(50) := 'null';
    BEGIN
        -- Loop through items array
        FOR rec IN (
            SELECT jt.payment_data
            FROM JSON_TABLE(p_json_data, '$.items[*]'
                COLUMNS (
                    payment_data CLOB FORMAT JSON PATH '$'
                )
            ) jt
        ) LOOP
            BEGIN
                save_payment(rec.payment_data, v_result);
                IF INSTR(v_result, '"status": "success"') > 0 THEN
                    v_count := v_count + 1;
                    -- Extract the checkId generated by save_payment()
                    v_check_id_str := REGEXP_SUBSTR(v_result, '"checkId":\s*(-?\d+)', 1, 1, NULL, 1);
                    IF v_check_id_str IS NOT NULL THEN
                        IF v_check_ids IS NOT NULL THEN v_check_ids := v_check_ids || ','; END IF;
                        v_check_ids := v_check_ids || v_check_id_str;
                        -- Keep first checkId as top-level convenience field
                        IF v_first_check_id = 'null' THEN
                            v_first_check_id := v_check_id_str;
                        END IF;
                    END IF;
                ELSE
                    v_errors := v_errors + 1;
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    v_errors := v_errors + 1;
            END;
        END LOOP;

        p_result := '{"status": "success", "saved": ' || v_count ||
                    ', "errors": ' || v_errors ||
                    ', "checkId": '  || v_first_check_id ||
                    ', "checkIds": [' || v_check_ids || ']}';

    EXCEPTION
        WHEN OTHERS THEN
            p_result := '{"status": "error", "message": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END save_payments_from_items;

    -- Get payment by Check ID (returns full Fusion-compatible JSON)
    FUNCTION get_payment_by_check_id(
        p_check_id IN NUMBER
    ) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_OBJECT(
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
            'AccountingStatus' VALUE ACCOUNTING_STATUS,
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
            RETURNING CLOB
        )
        INTO v_result
        FROM RR_AP_PAYMENTS_ALL
        WHERE CHECK_ID = p_check_id;

        RETURN v_result;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN '{"status": "error", "message": "Payment not found"}';
        WHEN OTHERS THEN
            RETURN '{"status": "error", "message": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
    END get_payment_by_check_id;

    -- Get payments with filters
    FUNCTION get_payments(
    p_payment_number  IN VARCHAR2 DEFAULT NULL,
    p_payment_status  IN VARCHAR2 DEFAULT NULL,
    p_payee           IN VARCHAR2 DEFAULT NULL,
    p_supplier_number IN VARCHAR2 DEFAULT NULL,
    p_business_unit   IN VARCHAR2 DEFAULT NULL,
    p_date_from       IN DATE     DEFAULT NULL,
    p_date_to         IN DATE     DEFAULT NULL,
    p_only_pdc        IN VARCHAR2 DEFAULT 'N',
    p_limit           IN NUMBER   DEFAULT 100,
    p_offset          IN NUMBER   DEFAULT 0
) RETURN CLOB IS
    v_result CLOB;
    v_count  NUMBER;
BEGIN
    -- Get total count
    SELECT COUNT(*)
    INTO v_count
    FROM RR_AP_PAYMENTS_ALL
    WHERE (p_payment_number IS NULL OR PAYMENT_NUMBER = p_payment_number)
      AND (p_payment_status IS NULL OR PAYMENT_STATUS = p_payment_status)
      AND (p_payee IS NULL OR UPPER(PAYEE) LIKE '%' || UPPER(p_payee) || '%')
      AND (p_supplier_number IS NULL OR SUPPLIER_NUMBER = p_supplier_number)
      AND (p_business_unit IS NULL OR BUSINESS_UNIT = p_business_unit)
      AND (p_date_from IS NULL OR PAYMENT_DATE >= p_date_from)
      AND (p_date_to IS NULL OR PAYMENT_DATE <= p_date_to)
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
                WHERE (p_payment_number IS NULL OR p.PAYMENT_NUMBER = p_payment_number)
                  AND (p_payment_status IS NULL OR p.PAYMENT_STATUS = p_payment_status)
                  AND (p_payee IS NULL OR UPPER(p.PAYEE) LIKE '%' || UPPER(p_payee) || '%')
                  AND (p_supplier_number IS NULL OR p.SUPPLIER_NUMBER = p_supplier_number)
                  AND (p_business_unit IS NULL OR p.BUSINESS_UNIT = p_business_unit)
                  AND (p_date_from IS NULL OR p.PAYMENT_DATE >= p_date_from)
                  AND (p_date_to IS NULL OR p.PAYMENT_DATE <= p_date_to)
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

END XXAP_PAYMENTS_PKG;
/
