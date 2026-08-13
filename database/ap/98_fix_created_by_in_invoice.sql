-- =============================================================================
-- PATCH 98: Use login user as CREATED_BY when creating AP Invoices
--
-- PROBLEM:
--   RR_AP_CREATE_INVOICE_PKG inserts USER (the Oracle DB schema name, e.g.
--   BCLDIFC) as CREATED_BY.  The React UI sends the logged-in user's username
--   in the JSON field "CreatedBy", but the package ignores it.
--
-- FIX:
--   Add l_created_by local variable, parse it from the JSON payload (falling
--   back to USER if absent), and use it in both the header INSERT and the
--   lines INSERT.
--
-- CHANGES vs original (2 lines only):
--   1. Added  l_created_by VARCHAR2(240);  in the DECLARE section
--   2. Added  l_created_by := NVL(JSON_VALUE(p_json, '$.CreatedBy'), USER);
--      after l_supplier_tax_reg_num parsing
--   3. Replaced USER with l_created_by in the header INSERT CREATED_BY value
--   4. Replaced USER with l_created_by in the lines INSERT CREATED_BY value
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run the whole block at once
-- =============================================================================

create or replace PACKAGE BODY RR_AP_CREATE_INVOICE_PKG AS

    PROCEDURE create_invoice(
        p_json          IN  CLOB,
        p_invoice_id    OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) AS
        -- Header fields
        l_invoice_id                NUMBER;
        l_invoice_number            VARCHAR2(50);
        l_invoice_currency          VARCHAR2(15);
        l_payment_currency          VARCHAR2(15);
        l_invoice_amount            NUMBER;
        l_invoice_date              DATE;
        l_business_unit             VARCHAR2(240);
        l_legal_entity              VARCHAR2(240);
        l_supplier                  VARCHAR2(360);
        l_supplier_number           VARCHAR2(30);
        l_supplier_site             VARCHAR2(240);
        l_invoice_type              VARCHAR2(30);
        l_description               VARCHAR2(4000);
        l_invoice_group             VARCHAR2(80);
        l_invoice_source            VARCHAR2(80);
        l_accounting_date           DATE;
        l_terms_date                DATE;
        l_goods_received_date       DATE;
        l_pay_group                 VARCHAR2(80);
        l_payment_terms             VARCHAR2(50);
        l_payment_method            VARCHAR2(80);
        l_pay_alone_flag            VARCHAR2(1);
        -- Accounting fields
        l_liability_distribution    VARCHAR2(250);
        l_conversion_rate_type      VARCHAR2(30);
        l_conversion_date           DATE;
        l_conversion_rate           NUMBER;
        l_document_category         VARCHAR2(80);
        l_document_sequence         NUMBER;
        l_voucher_number            VARCHAR2(50);
        l_first_party_tax_reg_num   VARCHAR2(50);
        l_supplier_tax_reg_num      VARCHAR2(50);
        l_apply_after_date          DATE;
        -- Audit
        l_created_by                VARCHAR2(240);
        -- Validation
        l_dup_count                 NUMBER;
        l_dist_missing              VARCHAR2(4000);
        -- Lines
        l_line_count                NUMBER := 0;
        l_line_success              NUMBER := 0;
        l_line_error                NUMBER := 0;
        l_line_acct_date            DATE;
    BEGIN
        -- Parse header fields from JSON
        l_invoice_number    := JSON_VALUE(p_json, '$.InvoiceNumber');
        l_invoice_currency  := NVL(JSON_VALUE(p_json, '$.InvoiceCurrency'), 'AED');
        l_payment_currency  := NVL(JSON_VALUE(p_json, '$.PaymentCurrency'), l_invoice_currency);
        l_invoice_amount    := JSON_VALUE(p_json, '$.InvoiceAmount' RETURNING NUMBER);
        l_business_unit     := JSON_VALUE(p_json, '$.BusinessUnit');
        l_legal_entity      := JSON_VALUE(p_json, '$.LegalEntity');
        l_supplier          := JSON_VALUE(p_json, '$.Supplier');
        l_supplier_number   := JSON_VALUE(p_json, '$.SupplierNumber');
        l_supplier_site     := JSON_VALUE(p_json, '$.SupplierSite');
        l_invoice_type      := NVL(JSON_VALUE(p_json, '$.InvoiceType'), 'Standard');
        l_description       := JSON_VALUE(p_json, '$.Description' RETURNING VARCHAR2(4000));
        l_invoice_group     := JSON_VALUE(p_json, '$.InvoiceGroup');
        l_invoice_source    := NVL(JSON_VALUE(p_json, '$.InvoiceSource'), 'MANUAL');
        l_pay_group         := JSON_VALUE(p_json, '$.PayGroup');
        l_payment_terms     := JSON_VALUE(p_json, '$.PaymentTerms');
        l_payment_method    := JSON_VALUE(p_json, '$.PaymentMethod');
        l_pay_alone_flag    := CASE
            WHEN UPPER(JSON_VALUE(p_json, '$.PayAlone')) IN ('Y', 'YES') THEN 'Y'
            ELSE 'N'
        END;

        -- Parse accounting fields
        l_liability_distribution  := JSON_VALUE(p_json, '$.LiabilityDistribution');
        l_conversion_rate_type    := JSON_VALUE(p_json, '$.ConversionRateType');
        l_conversion_rate         := JSON_VALUE(p_json, '$.ConversionRate' RETURNING NUMBER);
        l_document_category       := JSON_VALUE(p_json, '$.DocumentCategory');
        l_voucher_number          := JSON_VALUE(p_json, '$.VoucherNumber');
        l_first_party_tax_reg_num := JSON_VALUE(p_json, '$.FirstPartyTaxRegistrationNumber');
        l_supplier_tax_reg_num    := JSON_VALUE(p_json, '$.SupplierTaxRegistrationNumber');

        -- Audit: use the logged-in app user if supplied, otherwise fall back to DB user
        l_created_by := NVL(JSON_VALUE(p_json, '$.CreatedBy'), USER);

        -- Parse dates
        BEGIN
            l_invoice_date := TO_DATE(JSON_VALUE(p_json, '$.InvoiceDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_invoice_date := SYSDATE;
        END;

        BEGIN
            l_accounting_date := TO_DATE(JSON_VALUE(p_json, '$.AccountingDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_accounting_date := l_invoice_date;
        END;

        BEGIN
            l_terms_date := TO_DATE(JSON_VALUE(p_json, '$.TermsDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_terms_date := NULL;
        END;

        BEGIN
            l_goods_received_date := TO_DATE(JSON_VALUE(p_json, '$.GoodsReceivedDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_goods_received_date := NULL;
        END;

        BEGIN
            l_conversion_date := TO_DATE(JSON_VALUE(p_json, '$.ConversionDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_conversion_date := NULL;
        END;

        BEGIN
            l_apply_after_date := TO_DATE(JSON_VALUE(p_json, '$.ApplyAfterDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_apply_after_date := NULL;
        END;

        -- Default ApplyAfterDate to invoice date for Prepayment
        IF l_invoice_type = 'Prepayment' THEN
            l_apply_after_date := NVL(l_apply_after_date, l_invoice_date);
        END IF;

        -- ========== VALIDATIONS ==========

        -- 1. Invoice number must be unique
        IF l_invoice_number IS NOT NULL THEN
            SELECT COUNT(*) INTO l_dup_count
            FROM RR_AP_INVOICES_ALL
            WHERE INVOICE_NUMBER = l_invoice_number
              AND SUPPLIER_NUMBER = l_supplier_number;

            IF l_dup_count > 0 THEN
                p_invoice_id := NULL;
                p_status := 'ERROR';
                p_message := 'Invoice number "' || l_invoice_number || '" already exists for this supplier. Please use a unique invoice number.';
                RETURN;
            END IF;
        END IF;

        -- 2. Every Item line must have a distribution combination
        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json, '$.lines[*]'
                COLUMNS (
                    line_number             NUMBER          PATH '$.LineNumber',
                    line_type               VARCHAR2(50)    PATH '$.LineType',
                    distribution_combination VARCHAR2(500)  PATH '$.DistributionCombination',
                    distribution_set        VARCHAR2(240)   PATH '$.DistributionSet'
                )
            ) jt
        ) LOOP
            IF NVL(rec.line_type, 'Item') = 'Item'
               AND rec.distribution_combination IS NULL
               AND rec.distribution_set IS NULL THEN
                l_dist_missing := l_dist_missing || rec.line_number || ', ';
            END IF;
        END LOOP;

        IF l_dist_missing IS NOT NULL THEN
            p_invoice_id := NULL;
            p_status := 'ERROR';
            p_message := 'Distribution is required for Item line(s): ' || RTRIM(l_dist_missing, ', ');
            RETURN;
        END IF;

        -- Generate InvoiceId and DocumentSequence from sequences
        SELECT RR_AP_INVOICES_ALL_SEQ.NEXTVAL INTO l_invoice_id FROM DUAL;
        SELECT SEQ_AP_DOCUMENT_SEQ.NEXTVAL INTO l_document_sequence FROM DUAL;

        -- ========== INSERT HEADER ==========
        INSERT INTO RR_AP_INVOICES_ALL (
            INVOICE_ID,
            INVOICE_NUMBER,
            INVOICE_CURRENCY,
            PAYMENT_CURRENCY,
            INVOICE_AMOUNT,
            INVOICE_DATE,
            BUSINESS_UNIT,
            LEGAL_ENTITY,
            SUPPLIER,
            SUPPLIER_NUMBER,
            SUPPLIER_SITE,
            INVOICE_TYPE,
            DESCRIPTION,
            INVOICE_GROUP,
            INVOICE_SOURCE,
            ACCOUNTING_DATE,
            TERMS_DATE,
            GOODS_RECEIVED_DATE,
            PAY_GROUP,
            PAYMENT_TERMS,
            PAYMENT_METHOD,
            PAY_ALONE_FLAG,
            LIABILITY_DISTRIBUTION,
            CONVERSION_RATE_TYPE,
            CONVERSION_DATE,
            CONVERSION_RATE,
            DOCUMENT_CATEGORY,
            DOCUMENT_SEQUENCE,
            VOUCHER_NUMBER,
            FIRST_PARTY_TAX_REGISTRATION_NUM,
            SUPPLIER_TAX_REGISTRATION_NUMBER,
            APPLY_AFTER_DATE,
            VALIDATION_STATUS,
            APPROVAL_STATUS,
            PAID_STATUS,
            ACCOUNTING_STATUS,
            SYNC_STATUS,
            CREATED_BY,
            CREATION_DATE
        ) VALUES (
            l_invoice_id,
            l_invoice_number,
            l_invoice_currency,
            l_payment_currency,
            l_invoice_amount,
            l_invoice_date,
            l_business_unit,
            l_legal_entity,
            l_supplier,
            l_supplier_number,
            l_supplier_site,
            l_invoice_type,
            l_description,
            l_invoice_group,
            l_invoice_source,
            l_accounting_date,
            l_terms_date,
            l_goods_received_date,
            l_pay_group,
            l_payment_terms,
            l_payment_method,
            l_pay_alone_flag,
            l_liability_distribution,
            l_conversion_rate_type,
            l_conversion_date,
            l_conversion_rate,
            l_document_category,
            l_document_sequence,
            l_voucher_number,
            l_first_party_tax_reg_num,
            l_supplier_tax_reg_num,
            l_apply_after_date,
            CASE WHEN l_invoice_type = 'Prepayment' THEN 'Validated-Unpaid' ELSE 'Needs Revalidation' END,
            'Required',
            'Unpaid',
            'Not Accounted',
            'NEW',
            l_created_by,        -- was: USER
            SYSTIMESTAMP
        );

        -- ========== INSERT LINES ==========
        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json, '$.lines[*]'
                COLUMNS (
                    line_number             NUMBER          PATH '$.LineNumber',
                    line_type               VARCHAR2(50)    PATH '$.LineType',
                    line_amount             NUMBER          PATH '$.LineAmount',
                    description             VARCHAR2(4000)  PATH '$.Description',
                    accounting_date         VARCHAR2(10)    PATH '$.AccountingDate',
                    distribution_combination VARCHAR2(500)  PATH '$.DistributionCombination',
                    distribution_set        VARCHAR2(240)   PATH '$.DistributionSet',
                    tax_classification      VARCHAR2(240)   PATH '$.TaxClassification',
                    quantity                NUMBER          PATH '$.Quantity',
                    unit_price              NUMBER          PATH '$.UnitPrice',
                    uom                     VARCHAR2(25)    PATH '$.UOM',
                    purchase_order_number   VARCHAR2(50)    PATH '$.PONumber',
                    purchase_order_line_number NUMBER       PATH '$.POLineNumber',
                    receipt_number              VARCHAR2(50)    PATH '$.ReceiptNumber',
                    receipt_line_number         NUMBER          PATH '$.ReceiptLineNumber',
                    ship_to_location            VARCHAR2(240)   PATH '$.ShipToLocation',
                    multiperiod_start_date      VARCHAR2(10)    PATH '$.MultiperiodStartDate',
                    multiperiod_end_date        VARCHAR2(10)    PATH '$.MultiperiodEndDate',
                    multiperiod_accrual_account VARCHAR2(500)   PATH '$.MultiperiodAccrualAccount'
                )
            ) jt
        ) LOOP
            l_line_count := l_line_count + 1;

            -- Parse line accounting date (try multiple formats)
            BEGIN
                l_line_acct_date := TO_DATE(rec.accounting_date, 'YYYY-MM-DD');
            EXCEPTION WHEN OTHERS THEN
                BEGIN
                    l_line_acct_date := TO_DATE(rec.accounting_date, 'DD-Mon-YYYY');
                EXCEPTION WHEN OTHERS THEN
                    l_line_acct_date := l_invoice_date;
                END;
            END;

            BEGIN
                INSERT INTO RR_AP_INVOICE_LINES_ALL (
                    INVOICE_ID,
                    INVOICE_NUMBER,
                    LINE_NUMBER,
                    LINE_TYPE,
                    LINE_AMOUNT,
                    DESCRIPTION,
                    ACCOUNTING_DATE,
                    DISTRIBUTION_COMBINATION,
                    DISTRIBUTION_SET,
                    TAX_CLASSIFICATION,
                    QUANTITY,
                    UNIT_PRICE,
                    UOM,
                    PURCHASE_ORDER_NUMBER,
                    PURCHASE_ORDER_LINE_NUMBER,
                    RECEIPT_NUMBER,
                    RECEIPT_LINE_NUMBER,
                    SHIP_TO_LOCATION,
                    MULTIPERIOD_START_DATE,
                    MULTIPERIOD_END_DATE,
                    MULTIPERIOD_ACCRUAL_ACCOUNT,
                    PROCESS_STATUS,
                    CREATED_BY,
                    CREATION_DATE
                ) VALUES (
                    l_invoice_id,
                    l_invoice_number,
                    rec.line_number,
                    NVL(rec.line_type, 'Item'),
                    rec.line_amount,
                    rec.description,
                    NVL(l_line_acct_date, l_invoice_date),
                    rec.distribution_combination,
                    rec.distribution_set,
                    rec.tax_classification,
                    rec.quantity,
                    rec.unit_price,
                    rec.uom,
                    rec.purchase_order_number,
                    rec.purchase_order_line_number,
                    rec.receipt_number,
                    rec.receipt_line_number,
                    rec.ship_to_location,
                    TO_DATE(rec.multiperiod_start_date, 'YYYY-MM-DD'),
                    TO_DATE(rec.multiperiod_end_date, 'YYYY-MM-DD'),
                    rec.multiperiod_accrual_account,
                    'NEW',
                    l_created_by,        -- was: USER
                    SYSTIMESTAMP
                );
                l_line_success := l_line_success + 1;
            EXCEPTION
                WHEN OTHERS THEN
                    l_line_error := l_line_error + 1;
            END;
        END LOOP;

        -- Only commit if no line errors
        IF l_line_error = 0 THEN
            COMMIT;
            p_invoice_id := l_invoice_id;
            -- Generate multiperiod schedule for any MPA lines (best-effort; does not affect invoice status)
            BEGIN
                RR_AP_MPA_PKG.generate_schedule(p_invoice_id => l_invoice_id);
            EXCEPTION
                WHEN OTHERS THEN NULL;
            END;
            p_status := 'SUCCESS';
            p_message := 'Invoice ' || l_invoice_number || ' created (ID: ' || l_invoice_id || ') with ' || l_line_success || ' lines'
                      || ' [json=' || NVL(DBMS_LOB.GETLENGTH(p_json), 0) || ' bytes, parsed=' || l_line_count || ' lines]';
        ELSE
            ROLLBACK;
            p_invoice_id := NULL;
            p_status := 'ERROR';
            p_message := 'Invoice creation rolled back. ' || l_line_error || ' of ' || l_line_count || ' lines failed'
                      || ' [json=' || NVL(DBMS_LOB.GETLENGTH(p_json), 0) || ' bytes]';
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_invoice_id := NULL;
            p_status := 'ERROR';
            p_message := 'Error creating invoice: ' || SQLERRM;
    END create_invoice;

END RR_AP_CREATE_INVOICE_PKG;
/
