-- =====================================================
-- AP Invoice Installments Package
-- =====================================================
-- Created: 2024
-- Description: Package to save AP Invoice Installments from JSON
-- =====================================================

CREATE OR REPLACE PACKAGE XXAP_INVOICE_INSTALLMENTS_PKG AS

    -- Save a single installment from JSON
    PROCEDURE save_installment(
        p_invoice_id    IN NUMBER,
        p_inst_json     IN CLOB,
        p_inst_id       OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_error_message OUT VARCHAR2
    );

    -- Save multiple installments from JSON array
    PROCEDURE save_installments_bulk(
        p_invoice_id    IN NUMBER,
        p_inst_json     IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

    -- Save installments from items array format
    PROCEDURE save_installments_from_items(
        p_json          IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

END XXAP_INVOICE_INSTALLMENTS_PKG;
/

CREATE OR REPLACE PACKAGE BODY XXAP_INVOICE_INSTALLMENTS_PKG AS

    -- =========================================
    -- Save a single installment from JSON
    -- =========================================
    PROCEDURE save_installment(
        p_invoice_id    IN NUMBER,
        p_inst_json     IN CLOB,
        p_inst_id       OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_error_message OUT VARCHAR2
    ) IS
        l_installment_number        NUMBER;
        l_fusion_creation_date      TIMESTAMP;
        l_fusion_last_update_date   TIMESTAMP;
        l_existing_inst_id          NUMBER;
        l_hold_flag                 VARCHAR2(1);
    BEGIN
        p_status := 'SUCCESS';
        p_error_message := NULL;

        -- Extract installment number for duplicate check
        l_installment_number := JSON_VALUE(p_inst_json, '$.InstallmentNumber' RETURNING NUMBER);

        -- Parse hold flag (boolean to Y/N)
        l_hold_flag := CASE
            WHEN JSON_VALUE(p_inst_json, '$.HoldFlag') = 'true' THEN 'Y'
            ELSE 'N'
        END;

        -- Parse timestamps (strip timezone)
        BEGIN
            l_fusion_creation_date := TO_TIMESTAMP(
                REGEXP_REPLACE(JSON_VALUE(p_inst_json, '$.CreationDate'), '[+-]\d{2}:\d{2}$', ''),
                'YYYY-MM-DD"T"HH24:MI:SS'
            );
        EXCEPTION
            WHEN OTHERS THEN l_fusion_creation_date := NULL;
        END;

        BEGIN
            l_fusion_last_update_date := TO_TIMESTAMP(
                REGEXP_REPLACE(JSON_VALUE(p_inst_json, '$.LastUpdateDate'), '[+-]\d{2}:\d{2}$', ''),
                'YYYY-MM-DD"T"HH24:MI:SS'
            );
        EXCEPTION
            WHEN OTHERS THEN l_fusion_last_update_date := NULL;
        END;

        -- Check if installment already exists
        BEGIN
            SELECT INSTALLMENT_ID INTO l_existing_inst_id
            FROM RR_AP_INVOICE_INSTALLMENTS
            WHERE INVOICE_ID = p_invoice_id
              AND INSTALLMENT_NUMBER = l_installment_number;

            -- Update existing installment
            UPDATE RR_AP_INVOICE_INSTALLMENTS SET
                DUE_DATE                    = TO_DATE(JSON_VALUE(p_inst_json, '$.DueDate'), 'YYYY-MM-DD'),
                GROSS_AMOUNT                = JSON_VALUE(p_inst_json, '$.GrossAmount' RETURNING NUMBER),
                UNPAID_AMOUNT               = JSON_VALUE(p_inst_json, '$.UnpaidAmount' RETURNING NUMBER),
                FIRST_DISCOUNT_AMOUNT       = JSON_VALUE(p_inst_json, '$.FirstDiscountAmount' RETURNING NUMBER),
                FIRST_DISCOUNT_DATE         = TO_DATE(JSON_VALUE(p_inst_json, '$.FirstDiscountDate'), 'YYYY-MM-DD'),
                SECOND_DISCOUNT_AMOUNT      = JSON_VALUE(p_inst_json, '$.SecondDiscountAmount' RETURNING NUMBER),
                SECOND_DISCOUNT_DATE        = TO_DATE(JSON_VALUE(p_inst_json, '$.SecondDiscountDate'), 'YYYY-MM-DD'),
                THIRD_DISCOUNT_AMOUNT       = JSON_VALUE(p_inst_json, '$.ThirdDiscountAmount' RETURNING NUMBER),
                THIRD_DISCOUNT_DATE         = TO_DATE(JSON_VALUE(p_inst_json, '$.ThirdDiscountDate'), 'YYYY-MM-DD'),
                NET_AMOUNT_ONE              = JSON_VALUE(p_inst_json, '$.NetAmountOne' RETURNING NUMBER),
                NET_AMOUNT_TWO              = JSON_VALUE(p_inst_json, '$.NetAmountTwo' RETURNING NUMBER),
                NET_AMOUNT_THREE            = JSON_VALUE(p_inst_json, '$.NetAmountThree' RETURNING NUMBER),
                PAYMENT_PRIORITY            = JSON_VALUE(p_inst_json, '$.PaymentPriority' RETURNING NUMBER),
                PAYMENT_METHOD              = JSON_VALUE(p_inst_json, '$.PaymentMethod'),
                PAYMENT_METHOD_CODE         = JSON_VALUE(p_inst_json, '$.PaymentMethodCode'),
                HOLD_FLAG                   = l_hold_flag,
                HOLD_REASON                 = JSON_VALUE(p_inst_json, '$.HoldReason'),
                HOLD_TYPE                   = JSON_VALUE(p_inst_json, '$.HoldType'),
                HOLD_DATE                   = TO_DATE(JSON_VALUE(p_inst_json, '$.HoldDate'), 'YYYY-MM-DD'),
                HELD_BY                     = JSON_VALUE(p_inst_json, '$.HeldBy'),
                BANK_ACCOUNT                = JSON_VALUE(p_inst_json, '$.BankAccount'),
                EXTERNAL_BANK_ACCOUNT_ID    = JSON_VALUE(p_inst_json, '$.ExternalBankAccountId' RETURNING NUMBER),
                DIGITAL_PAYMENT_ACCOUNT     = JSON_VALUE(p_inst_json, '$.DigitalPaymentAccount'),
                REMIT_TO_ADDRESS_NAME       = JSON_VALUE(p_inst_json, '$.RemitToAddressName'),
                REMIT_TO_SUPPLIER           = JSON_VALUE(p_inst_json, '$.RemitToSupplier'),
                REMITTANCE_MESSAGE_ONE      = JSON_VALUE(p_inst_json, '$.RemittanceMessageOne'),
                REMITTANCE_MESSAGE_TWO      = JSON_VALUE(p_inst_json, '$.RemittanceMessageTwo'),
                REMITTANCE_MESSAGE_THREE    = JSON_VALUE(p_inst_json, '$.RemittanceMessageThree'),
                FUSION_CREATED_BY           = JSON_VALUE(p_inst_json, '$.CreatedBy'),
                FUSION_CREATION_DATE        = l_fusion_creation_date,
                FUSION_LAST_UPDATED_BY      = JSON_VALUE(p_inst_json, '$.LastUpdatedBy'),
                FUSION_LAST_UPDATE_DATE     = l_fusion_last_update_date,
                FUSION_LAST_UPDATE_LOGIN    = JSON_VALUE(p_inst_json, '$.LastUpdateLogin'),
                LAST_UPDATED_BY             = USER,
                LAST_UPDATE_DATE            = SYSTIMESTAMP,
                PROCESS_STATUS              = 'UPDATED'
            WHERE INSTALLMENT_ID = l_existing_inst_id;

            p_inst_id := l_existing_inst_id;

        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                -- Insert new installment
                INSERT INTO RR_AP_INVOICE_INSTALLMENTS (
                    INVOICE_ID,
                    INSTALLMENT_NUMBER,
                    DUE_DATE,
                    GROSS_AMOUNT,
                    UNPAID_AMOUNT,
                    FIRST_DISCOUNT_AMOUNT,
                    FIRST_DISCOUNT_DATE,
                    SECOND_DISCOUNT_AMOUNT,
                    SECOND_DISCOUNT_DATE,
                    THIRD_DISCOUNT_AMOUNT,
                    THIRD_DISCOUNT_DATE,
                    NET_AMOUNT_ONE,
                    NET_AMOUNT_TWO,
                    NET_AMOUNT_THREE,
                    PAYMENT_PRIORITY,
                    PAYMENT_METHOD,
                    PAYMENT_METHOD_CODE,
                    HOLD_FLAG,
                    HOLD_REASON,
                    HOLD_TYPE,
                    HOLD_DATE,
                    HELD_BY,
                    BANK_ACCOUNT,
                    EXTERNAL_BANK_ACCOUNT_ID,
                    DIGITAL_PAYMENT_ACCOUNT,
                    REMIT_TO_ADDRESS_NAME,
                    REMIT_TO_SUPPLIER,
                    REMITTANCE_MESSAGE_ONE,
                    REMITTANCE_MESSAGE_TWO,
                    REMITTANCE_MESSAGE_THREE,
                    FUSION_CREATED_BY,
                    FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE,
                    FUSION_LAST_UPDATE_LOGIN,
                    PROCESS_STATUS
                ) VALUES (
                    p_invoice_id,
                    l_installment_number,
                    TO_DATE(JSON_VALUE(p_inst_json, '$.DueDate'), 'YYYY-MM-DD'),
                    JSON_VALUE(p_inst_json, '$.GrossAmount' RETURNING NUMBER),
                    JSON_VALUE(p_inst_json, '$.UnpaidAmount' RETURNING NUMBER),
                    JSON_VALUE(p_inst_json, '$.FirstDiscountAmount' RETURNING NUMBER),
                    TO_DATE(JSON_VALUE(p_inst_json, '$.FirstDiscountDate'), 'YYYY-MM-DD'),
                    JSON_VALUE(p_inst_json, '$.SecondDiscountAmount' RETURNING NUMBER),
                    TO_DATE(JSON_VALUE(p_inst_json, '$.SecondDiscountDate'), 'YYYY-MM-DD'),
                    JSON_VALUE(p_inst_json, '$.ThirdDiscountAmount' RETURNING NUMBER),
                    TO_DATE(JSON_VALUE(p_inst_json, '$.ThirdDiscountDate'), 'YYYY-MM-DD'),
                    JSON_VALUE(p_inst_json, '$.NetAmountOne' RETURNING NUMBER),
                    JSON_VALUE(p_inst_json, '$.NetAmountTwo' RETURNING NUMBER),
                    JSON_VALUE(p_inst_json, '$.NetAmountThree' RETURNING NUMBER),
                    JSON_VALUE(p_inst_json, '$.PaymentPriority' RETURNING NUMBER),
                    JSON_VALUE(p_inst_json, '$.PaymentMethod'),
                    JSON_VALUE(p_inst_json, '$.PaymentMethodCode'),
                    l_hold_flag,
                    JSON_VALUE(p_inst_json, '$.HoldReason'),
                    JSON_VALUE(p_inst_json, '$.HoldType'),
                    TO_DATE(JSON_VALUE(p_inst_json, '$.HoldDate'), 'YYYY-MM-DD'),
                    JSON_VALUE(p_inst_json, '$.HeldBy'),
                    JSON_VALUE(p_inst_json, '$.BankAccount'),
                    JSON_VALUE(p_inst_json, '$.ExternalBankAccountId' RETURNING NUMBER),
                    JSON_VALUE(p_inst_json, '$.DigitalPaymentAccount'),
                    JSON_VALUE(p_inst_json, '$.RemitToAddressName'),
                    JSON_VALUE(p_inst_json, '$.RemitToSupplier'),
                    JSON_VALUE(p_inst_json, '$.RemittanceMessageOne'),
                    JSON_VALUE(p_inst_json, '$.RemittanceMessageTwo'),
                    JSON_VALUE(p_inst_json, '$.RemittanceMessageThree'),
                    JSON_VALUE(p_inst_json, '$.CreatedBy'),
                    l_fusion_creation_date,
                    JSON_VALUE(p_inst_json, '$.LastUpdatedBy'),
                    l_fusion_last_update_date,
                    JSON_VALUE(p_inst_json, '$.LastUpdateLogin'),
                    'NEW'
                ) RETURNING INSTALLMENT_ID INTO p_inst_id;
        END;

        COMMIT;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_error_message := SQLERRM;
            ROLLBACK;
    END save_installment;

    -- =========================================
    -- Save multiple installments from JSON array
    -- =========================================
    PROCEDURE save_installments_bulk(
        p_invoice_id    IN NUMBER,
        p_inst_json     IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) IS
        l_inst_json     CLOB;
        l_inst_id       NUMBER;
        l_inst_status   VARCHAR2(20);
        l_inst_error    VARCHAR2(4000);
        l_count         NUMBER;
    BEGIN
        p_success_count := 0;
        p_error_count := 0;

        -- Count items in array
        SELECT COUNT(*) INTO l_count
        FROM JSON_TABLE(p_inst_json, '$[*]' COLUMNS (dummy VARCHAR2(1) PATH '$.InstallmentNumber'));

        -- Process each installment
        FOR rec IN (
            SELECT jt.inst_json
            FROM JSON_TABLE(p_inst_json, '$[*]'
                COLUMNS (inst_json CLOB FORMAT JSON PATH '$')
            ) jt
        ) LOOP
            save_installment(
                p_invoice_id    => p_invoice_id,
                p_inst_json     => rec.inst_json,
                p_inst_id       => l_inst_id,
                p_status        => l_inst_status,
                p_error_message => l_inst_error
            );

            IF l_inst_status = 'SUCCESS' THEN
                p_success_count := p_success_count + 1;
            ELSE
                p_error_count := p_error_count + 1;
            END IF;
        END LOOP;

        -- Set overall status
        IF p_error_count = 0 THEN
            p_status := 'SUCCESS';
            p_message := 'All ' || p_success_count || ' installments saved successfully';
        ELSIF p_success_count = 0 THEN
            p_status := 'ERROR';
            p_message := 'All ' || p_error_count || ' installments failed';
        ELSE
            p_status := 'PARTIAL';
            p_message := p_success_count || ' installments saved, ' || p_error_count || ' failed';
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := SQLERRM;
    END save_installments_bulk;

    -- =========================================
    -- Save installments from items array format
    -- =========================================
    PROCEDURE save_installments_from_items(
        p_json          IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) IS
        l_invoice_id        NUMBER;
        l_inst_json         CLOB;
        l_inst_id           NUMBER;
        l_inst_status       VARCHAR2(20);
        l_inst_error        VARCHAR2(4000);
        l_last_error        VARCHAR2(4000);
        l_installment_num   NUMBER;
    BEGIN
        p_success_count := 0;
        p_error_count := 0;
        l_last_error := NULL;

        -- Process each item in the items array
        FOR rec IN (
            SELECT jt.invoice_id, jt.installment_number, jt.inst_json
            FROM JSON_TABLE(p_json, '$.items[*]'
                COLUMNS (
                    invoice_id NUMBER PATH '$.InvoiceId',
                    installment_number NUMBER PATH '$.InstallmentNumber',
                    inst_json CLOB FORMAT JSON PATH '$'
                )
            ) jt
        ) LOOP
            -- Check if InvoiceId is present
            IF rec.invoice_id IS NULL THEN
                p_error_count := p_error_count + 1;
                l_last_error := 'Installment ' || NVL(rec.installment_number, 0) || ': InvoiceId is required but missing';
            ELSE
                save_installment(
                    p_invoice_id    => rec.invoice_id,
                    p_inst_json     => rec.inst_json,
                    p_inst_id       => l_inst_id,
                    p_status        => l_inst_status,
                    p_error_message => l_inst_error
                );

                IF l_inst_status = 'SUCCESS' THEN
                    p_success_count := p_success_count + 1;
                ELSE
                    p_error_count := p_error_count + 1;
                    l_last_error := 'Installment ' || NVL(rec.installment_number, 0) || ': ' || l_inst_error;
                END IF;
            END IF;
        END LOOP;

        -- Set overall status
        IF p_error_count = 0 THEN
            p_status := 'SUCCESS';
            p_message := 'All ' || p_success_count || ' installments saved successfully';
        ELSIF p_success_count = 0 THEN
            p_status := 'ERROR';
            p_message := 'All ' || p_error_count || ' installments failed. Last error: ' || NVL(l_last_error, 'Unknown');
        ELSE
            p_status := 'PARTIAL';
            p_message := p_success_count || ' installments saved, ' || p_error_count || ' failed. Last error: ' || NVL(l_last_error, 'Unknown');
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := 'Exception: ' || SQLERRM;
    END save_installments_from_items;

END XXAP_INVOICE_INSTALLMENTS_PKG;
/
