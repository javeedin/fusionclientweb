-- =====================================================
-- RR_AP_CREATE_INVOICE_PKG
-- =====================================================
-- Purpose: Create new AP Invoice (Header + Lines) from UI
-- Target Tables: RR_AP_INVOICES_ALL (header), RR_AP_INVOICE_LINES_ALL (lines)
-- Single JSON POST with header + lines array
-- InvoiceId generated from sequence
-- =====================================================

-- =====================================================
-- 1. Create Sequence (if not exists)
-- =====================================================
DECLARE
    l_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_count
    FROM user_sequences
    WHERE sequence_name = 'RR_AP_INVOICES_ALL_SEQ';

    IF l_count = 0 THEN
        EXECUTE IMMEDIATE '
            CREATE SEQUENCE RR_AP_INVOICES_ALL_SEQ
                START WITH 900001
                INCREMENT BY 1
                NOCACHE
                NOCYCLE
        ';
    END IF;
END;
/

-- Create document sequence (run once)
DECLARE
    l_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_count
    FROM user_sequences
    WHERE sequence_name = 'SEQ_AP_DOCUMENT_SEQ';

    IF l_count = 0 THEN
        EXECUTE IMMEDIATE '
            CREATE SEQUENCE SEQ_AP_DOCUMENT_SEQ
                START WITH 1000
                INCREMENT BY 1
                NOCACHE
                NOCYCLE
        ';
    END IF;
END;
/

-- =====================================================
-- 2. Package Specification
-- =====================================================
CREATE OR REPLACE PACKAGE RR_AP_CREATE_INVOICE_PKG AS

    -- Create invoice with header + lines in one transaction
    -- JSON format:
    -- {
    --   "InvoiceNumber": "INV-001",
    --   "InvoiceCurrency": "AED",
    --   "InvoiceAmount": 1050,
    --   "InvoiceDate": "2026-02-14",
    --   "BusinessUnit": "BU_NAME",
    --   "Supplier": "Supplier Name",
    --   "SupplierNumber": "S0001",
    --   "SupplierSite": "DUBAI",
    --   "InvoiceType": "Standard",
    --   "Description": "Test invoice",
    --   ...
    --   "lines": [
    --     {
    --       "LineNumber": 1,
    --       "LineType": "Item",
    --       "LineAmount": 1000,
    --       "Description": "Line 1",
    --       "DistributionCombination": "01-000-1234-0000-000",
    --       ...
    --     }
    --   ]
    -- }
    PROCEDURE create_invoice(
        p_json          IN  CLOB,
        p_invoice_id    OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

END RR_AP_CREATE_INVOICE_PKG;
/

-- =====================================================
-- 3. Package Body
-- =====================================================
CREATE OR REPLACE PACKAGE BODY RR_AP_CREATE_INVOICE_PKG AS

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
            USER,
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
                    tax_control_amount      NUMBER          PATH '$.TaxAmount',
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
                    TAX_CONTROL_AMOUNT,
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
                    rec.tax_control_amount,
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
                    USER,
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

-- =====================================================
-- 4. ORDS REST Handler
-- =====================================================

-- Template for combined create
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'createinvoicefull',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Create invoice with header + lines in one POST'
    );
    COMMIT;
END;
/

-- POST handler
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'createinvoicefull',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create AP Invoice (header + lines) from single JSON',
        p_source         => q'[
DECLARE
    l_blob          BLOB := :body;
    l_clob          CLOB;
    l_dest_offset   INTEGER := 1;
    l_src_offset    INTEGER := 1;
    l_lang_context  INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    l_warning       INTEGER;
    l_invoice_id        NUMBER;
    l_status            VARCHAR2(20);
    l_message           VARCHAR2(4000);
    l_document_sequence NUMBER;
BEGIN
    -- Convert BLOB to CLOB (avoids :body_text VARCHAR2 truncation)
    IF l_blob IS NOT NULL AND DBMS_LOB.GETLENGTH(l_blob) > 0 THEN
        DBMS_LOB.CREATETEMPORARY(l_clob, TRUE);
        DBMS_LOB.CONVERTTOCLOB(
            dest_lob     => l_clob,
            src_blob     => l_blob,
            amount       => DBMS_LOB.LOBMAXSIZE,
            dest_offset  => l_dest_offset,
            src_offset   => l_src_offset,
            blob_csid    => DBMS_LOB.DEFAULT_CSID,
            lang_context => l_lang_context,
            warning      => l_warning
        );
    ELSE
        -- Fallback to :body_text if :body is empty
        l_clob := :body_text;
    END IF;

    RR_AP_CREATE_INVOICE_PKG.create_invoice(
        p_json       => l_clob,
        p_invoice_id => l_invoice_id,
        p_status     => l_status,
        p_message    => l_message
    );

    -- Read back the auto-generated document_sequence
    IF l_status = 'SUCCESS' AND l_invoice_id IS NOT NULL THEN
        BEGIN
            SELECT document_sequence INTO l_document_sequence
            FROM RR_AP_INVOICES_ALL
            WHERE invoice_id = l_invoice_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 201 ELSE 400 END;

    HTP.P('{"status": "' || l_status || '",'
       || '"message": "' || REPLACE(l_message, '"', '\"') || '",'
       || '"invoiceId": ' || NVL(TO_CHAR(l_invoice_id), 'null') || ','
       || '"documentSequence": ' || NVL(TO_CHAR(l_document_sequence), 'null') || ','
       || '"success": ' || CASE WHEN l_status = 'SUCCESS' THEN 'true' ELSE 'false' END
       || '}');

    -- Free temporary CLOB
    IF DBMS_LOB.ISTEMPORARY(l_clob) = 1 THEN
        DBMS_LOB.FREETEMPORARY(l_clob);
    END IF;
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. Verify
-- =====================================================
SELECT
    module_name,
    uri_template,
    method,
    source_type
FROM user_ords_handlers
WHERE module_name = 'ap'
  AND uri_template LIKE '%createinvoicefull%'
ORDER BY uri_template, method;

-- =====================================================
-- Sample JSON for Postman Testing:
-- =====================================================
/*
POST URL: https://<your-apex-host>/ords/<schema>/reerp/ap/createinvoicefull
Content-Type: application/json

{
    "InvoiceNumber": "TEST-INV-001",
    "InvoiceCurrency": "AED",
    "PaymentCurrency": "AED",
    "InvoiceAmount": 1050.00,
    "InvoiceDate": "2026-02-14",
    "BusinessUnit": "BUIMERC CORP_DIFC_INVST",
    "Supplier": "TEST SUPPLIER LLC",
    "SupplierNumber": "T0001",
    "SupplierSite": "DUBAI",
    "InvoiceType": "Standard",
    "Description": "Test invoice from UI",
    "PaymentTerms": "Immediate",
    "PayGroup": "Standard",
    "PayAlone": "N",
    "LiabilityDistribution": "01-000-2100-0000-000",
    "ConversionRateType": "Corporate",
    "ConversionDate": "2026-02-14",
    "ConversionRate": 1.0,
    "DocumentCategory": "Standard Invoices",
    "VoucherNumber": "V-001",
    "FirstPartyTaxRegistrationNumber": "100123456700003",
    "SupplierTaxRegistrationNumber": "300987654321234",
    "lines": [
        {
            "LineNumber": 1,
            "LineType": "Item",
            "LineAmount": 1000.00,
            "Description": "Office Supplies",
            "AccountingDate": "2026-02-14",
            "DistributionCombination": "01-000-6310-0000-000",
            "TaxClassification": "VAT 5%",
            "Quantity": 10,
            "UnitPrice": 100
        },
        {
            "LineNumber": 2,
            "LineType": "Tax",
            "LineAmount": 50.00,
            "Description": "VAT 5%",
            "AccountingDate": "2026-02-14"
        }
    ]
}

Expected Response (success):
{
    "status": "SUCCESS",
    "message": "Invoice TEST-INV-001 created (ID: 900001) with 2 lines [json=... bytes, parsed=2 lines]",
    "invoiceId": 900001,
    "success": true
}

Expected Response (duplicate invoice number):
{
    "status": "ERROR",
    "message": "Invoice number \"TEST-INV-001\" already exists for this supplier. Please use a unique invoice number.",
    "invoiceId": null,
    "success": false
}

Expected Response (missing distribution on lines):
{
    "status": "ERROR",
    "message": "Distribution is required for Item line(s): 1",
    "invoiceId": null,
    "success": false
}
*/
