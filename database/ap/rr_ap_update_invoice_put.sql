-- =====================================================
-- PUT Handler for /ap/createinvoicefull/:id
-- =====================================================
-- Purpose: Update an existing AP Invoice (Header + Lines)
--          using the same flat JSON structure as the POST create.
-- Strategy: Update header fields, then DELETE all existing lines
--           and re-INSERT from the payload (replace-all approach).
-- Business Rules:
--   - Invoice must exist
--   - Invoice must not be Paid or Accounted
--   - After update, VALIDATION_STATUS is reset to 'Needs Revalidation'
-- Target Tables: RR_AP_INVOICES_ALL (header), RR_AP_INVOICE_LINES_ALL (lines)
-- =====================================================

-- =====================================================
-- 1. Package Specification
-- =====================================================
CREATE OR REPLACE PACKAGE RR_AP_UPDATE_INVOICE_PKG AS

    -- Update invoice header + replace all lines in one transaction
    -- JSON format: same flat structure as POST /ap/createinvoicefull
    -- {
    --   "InvoiceId": 900009,
    --   "InvoiceNumber": "INV-001",
    --   "InvoiceCurrency": "AED",
    --   "InvoiceAmount": 1050,
    --   "InvoiceDate": "2026-02-14",
    --   "BusinessUnit": "BU_NAME",
    --   "Supplier": "Supplier Name",
    --   ...
    --   "lines": [
    --     { "LineNumber": 1, "LineType": "Item", "LineAmount": 1000, ... },
    --     { "LineNumber": 2, "LineType": "Tax",  "LineAmount": 50,   ... }
    --   ]
    -- }
    PROCEDURE update_invoice(
        p_json          IN  CLOB,
        p_invoice_id    OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

END RR_AP_UPDATE_INVOICE_PKG;
/

-- =====================================================
-- 2. Package Body
-- =====================================================
CREATE OR REPLACE PACKAGE BODY RR_AP_UPDATE_INVOICE_PKG AS

    PROCEDURE update_invoice(
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
        l_voucher_number            VARCHAR2(50);
        l_first_party_tax_reg_num   VARCHAR2(50);
        l_supplier_tax_reg_num      VARCHAR2(50);
        l_apply_after_date          DATE;
        -- Existing invoice check
        l_paid_status               VARCHAR2(30);
        l_accounting_status         VARCHAR2(30);
        l_existing_inv_number       VARCHAR2(50);
        -- Duplicate check
        l_dup_count                 NUMBER;
        -- Distribution validation
        l_dist_missing              VARCHAR2(4000);
        -- Lines
        l_lines_deleted             NUMBER := 0;
        l_line_count                NUMBER := 0;
        l_line_success              NUMBER := 0;
        l_line_error                NUMBER := 0;
        l_line_acct_date            DATE;
    BEGIN
        -- ========== PARSE INVOICE ID ==========
        l_invoice_id := JSON_VALUE(p_json, '$.InvoiceId' RETURNING NUMBER);

        IF l_invoice_id IS NULL THEN
            p_invoice_id := NULL;
            p_status     := 'ERROR';
            p_message    := 'InvoiceId is required for update';
            RETURN;
        END IF;

        -- ========== CHECK INVOICE EXISTS & IS EDITABLE ==========
        BEGIN
            SELECT NVL(paid_status, 'Unpaid'),
                   NVL(accounting_status, 'Not Accounted'),
                   invoice_number
            INTO   l_paid_status, l_accounting_status, l_existing_inv_number
            FROM   RR_AP_INVOICES_ALL
            WHERE  invoice_id = l_invoice_id;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                p_invoice_id := NULL;
                p_status     := 'ERROR';
                p_message    := 'Invoice not found: ' || l_invoice_id;
                RETURN;
        END;

        IF l_paid_status IN ('Paid', 'Available') THEN
            p_invoice_id := l_invoice_id;
            p_status     := 'ERROR';
            p_message    := 'Invoice cannot be edited: already ' || l_paid_status;
            RETURN;
        END IF;

        IF l_accounting_status = 'Accounted' THEN
            p_invoice_id := l_invoice_id;
            p_status     := 'ERROR';
            p_message    := 'Invoice cannot be edited: already Accounted';
            RETURN;
        END IF;

        -- ========== PARSE HEADER FIELDS ==========
        l_invoice_number    := JSON_VALUE(p_json, '$.InvoiceNumber');
        l_invoice_currency  := JSON_VALUE(p_json, '$.InvoiceCurrency');
        l_payment_currency  := JSON_VALUE(p_json, '$.PaymentCurrency');
        l_invoice_amount    := JSON_VALUE(p_json, '$.InvoiceAmount' RETURNING NUMBER);
        l_business_unit     := JSON_VALUE(p_json, '$.BusinessUnit');
        l_legal_entity      := JSON_VALUE(p_json, '$.LegalEntity');
        l_supplier          := JSON_VALUE(p_json, '$.Supplier');
        l_supplier_number   := JSON_VALUE(p_json, '$.SupplierNumber');
        l_supplier_site     := JSON_VALUE(p_json, '$.SupplierSite');
        l_invoice_type      := JSON_VALUE(p_json, '$.InvoiceType');
        l_description       := JSON_VALUE(p_json, '$.Description' RETURNING VARCHAR2(4000));
        l_invoice_group     := JSON_VALUE(p_json, '$.InvoiceGroup');
        l_invoice_source    := JSON_VALUE(p_json, '$.InvoiceSource');
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
        EXCEPTION WHEN OTHERS THEN l_invoice_date := NULL;
        END;

        BEGIN
            l_accounting_date := TO_DATE(JSON_VALUE(p_json, '$.AccountingDate'), 'YYYY-MM-DD');
        EXCEPTION WHEN OTHERS THEN l_accounting_date := NULL;
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

        -- ========== VALIDATIONS ==========

        -- 1. If invoice number changed, check uniqueness
        IF l_invoice_number IS NOT NULL AND l_invoice_number != l_existing_inv_number THEN
            SELECT COUNT(*) INTO l_dup_count
            FROM RR_AP_INVOICES_ALL
            WHERE INVOICE_NUMBER = l_invoice_number
              AND SUPPLIER_NUMBER = NVL(l_supplier_number, SUPPLIER_NUMBER)
              AND INVOICE_ID != l_invoice_id;

            IF l_dup_count > 0 THEN
                p_invoice_id := l_invoice_id;
                p_status     := 'ERROR';
                p_message    := 'Invoice number "' || l_invoice_number || '" already exists for this supplier.';
                RETURN;
            END IF;
        END IF;

        -- 2. Every Item line must have a distribution combination
        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json, '$.lines[*]'
                COLUMNS (
                    line_number              NUMBER          PATH '$.LineNumber',
                    line_type                VARCHAR2(50)    PATH '$.LineType',
                    distribution_combination VARCHAR2(500)   PATH '$.DistributionCombination',
                    distribution_set         VARCHAR2(240)   PATH '$.DistributionSet'
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
            p_invoice_id := l_invoice_id;
            p_status     := 'ERROR';
            p_message    := 'Distribution is required for Item line(s): ' || RTRIM(l_dist_missing, ', ');
            RETURN;
        END IF;

        -- ========== UPDATE HEADER ==========
        UPDATE RR_AP_INVOICES_ALL
        SET    invoice_number                    = NVL(l_invoice_number, invoice_number),
               invoice_currency                  = NVL(l_invoice_currency, invoice_currency),
               payment_currency                  = NVL(l_payment_currency, payment_currency),
               invoice_amount                    = NVL(l_invoice_amount, invoice_amount),
               invoice_date                      = NVL(l_invoice_date, invoice_date),
               business_unit                     = NVL(l_business_unit, business_unit),
               legal_entity                      = NVL(l_legal_entity, legal_entity),
               supplier                          = NVL(l_supplier, supplier),
               supplier_number                   = NVL(l_supplier_number, supplier_number),
               supplier_site                     = NVL(l_supplier_site, supplier_site),
               invoice_type                      = NVL(l_invoice_type, invoice_type),
               description                       = NVL(l_description, description),
               invoice_group                     = NVL(l_invoice_group, invoice_group),
               invoice_source                    = NVL(l_invoice_source, invoice_source),
               accounting_date                   = NVL(l_accounting_date, accounting_date),
               terms_date                        = NVL(l_terms_date, terms_date),
               goods_received_date               = NVL(l_goods_received_date, goods_received_date),
               pay_group                         = NVL(l_pay_group, pay_group),
               payment_terms                     = NVL(l_payment_terms, payment_terms),
               payment_method                    = NVL(l_payment_method, payment_method),
               pay_alone_flag                    = NVL(l_pay_alone_flag, pay_alone_flag),
               liability_distribution            = NVL(l_liability_distribution, liability_distribution),
               conversion_rate_type              = NVL(l_conversion_rate_type, conversion_rate_type),
               conversion_date                   = NVL(l_conversion_date, conversion_date),
               conversion_rate                   = NVL(l_conversion_rate, conversion_rate),
               document_category                 = NVL(l_document_category, document_category),
               voucher_number                    = NVL(l_voucher_number, voucher_number),
               first_party_tax_registration_num  = NVL(l_first_party_tax_reg_num, first_party_tax_registration_num),
               supplier_tax_registration_number  = NVL(l_supplier_tax_reg_num, supplier_tax_registration_number),
               apply_after_date                  = CASE
                   WHEN NVL(l_invoice_type, invoice_type) = 'Prepayment'
                   THEN NVL(l_apply_after_date, apply_after_date)
                   ELSE apply_after_date
               END,
               -- For Prepayment, keep Validated-Unpaid; reset all others after edit
               validation_status                 = CASE
                   WHEN NVL(l_invoice_type, invoice_type) = 'Prepayment' THEN 'Validated-Unpaid'
                   ELSE 'Needs Revalidation'
               END,
               last_updated_by                   = USER,
               last_update_date                  = SYSTIMESTAMP
        WHERE  invoice_id = l_invoice_id;

        IF SQL%ROWCOUNT = 0 THEN
            p_invoice_id := l_invoice_id;
            p_status     := 'ERROR';
            p_message    := 'Invoice header update failed for ID: ' || l_invoice_id;
            RETURN;
        END IF;

        -- ========== REPLACE LINES (delete all + re-insert) ==========
        DELETE FROM RR_AP_INVOICE_LINES_ALL
        WHERE  invoice_id = l_invoice_id;
        l_lines_deleted := SQL%ROWCOUNT;

        -- Use the updated invoice number (in case it was changed)
        l_invoice_number := NVL(l_invoice_number, l_existing_inv_number);

        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json, '$.lines[*]'
                COLUMNS (
                    line_number              NUMBER          PATH '$.LineNumber',
                    line_type                VARCHAR2(50)    PATH '$.LineType',
                    line_amount              NUMBER          PATH '$.LineAmount',
                    description              VARCHAR2(4000)  PATH '$.Description',
                    accounting_date          VARCHAR2(10)    PATH '$.AccountingDate',
                    distribution_combination VARCHAR2(500)   PATH '$.DistributionCombination',
                    distribution_set         VARCHAR2(240)   PATH '$.DistributionSet',
                    tax_classification       VARCHAR2(240)   PATH '$.TaxClassification',
                    tax_control_amount       NUMBER          PATH '$.TaxAmount',
                    quantity                 NUMBER          PATH '$.Quantity',
                    unit_price               NUMBER          PATH '$.UnitPrice',
                    uom                      VARCHAR2(25)    PATH '$.UOM',
                    purchase_order_number    VARCHAR2(50)    PATH '$.PONumber',
                    purchase_order_line_number NUMBER        PATH '$.POLineNumber',
                    receipt_number               VARCHAR2(50)    PATH '$.ReceiptNumber',
                    receipt_line_number          NUMBER          PATH '$.ReceiptLineNumber',
                    ship_to_location             VARCHAR2(240)   PATH '$.ShipToLocation',
                    multiperiod_start_date       VARCHAR2(10)    PATH '$.MultiperiodStartDate',
                    multiperiod_end_date         VARCHAR2(10)    PATH '$.MultiperiodEndDate',
                    multiperiod_accrual_account  VARCHAR2(500)   PATH '$.MultiperiodAccrualAccount'
                )
            ) jt
        ) LOOP
            l_line_count := l_line_count + 1;

            -- Parse line accounting date
            BEGIN
                l_line_acct_date := TO_DATE(rec.accounting_date, 'YYYY-MM-DD');
            EXCEPTION WHEN OTHERS THEN
                BEGIN
                    l_line_acct_date := TO_DATE(rec.accounting_date, 'DD-Mon-YYYY');
                EXCEPTION WHEN OTHERS THEN
                    l_line_acct_date := NVL(l_invoice_date, SYSDATE);
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
                    NVL(l_line_acct_date, NVL(l_invoice_date, SYSDATE)),
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
                    'UPDATED',
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
            -- Regenerate multiperiod schedule for any MPA lines (best-effort; does not affect invoice status)
            BEGIN
                RR_AP_MPA_PKG.generate_schedule(p_invoice_id => l_invoice_id);
            EXCEPTION
                WHEN OTHERS THEN NULL;
            END;
            p_status     := 'SUCCESS';
            p_message    := 'Invoice ' || l_invoice_number || ' updated (ID: ' || l_invoice_id || ') with '
                         || l_line_success || ' lines (replaced ' || l_lines_deleted || ' previous lines)';
        ELSE
            ROLLBACK;
            p_invoice_id := l_invoice_id;
            p_status     := 'ERROR';
            p_message    := 'Invoice update rolled back. ' || l_line_error || ' of ' || l_line_count || ' lines failed';
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_invoice_id := NULL;
            p_status     := 'ERROR';
            p_message    := 'Error updating invoice: ' || SQLERRM;
    END update_invoice;

END RR_AP_UPDATE_INVOICE_PKG;
/

-- =====================================================
-- 3. ORDS Template for createinvoicefull/:id
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'createinvoicefull/:id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_comments       => 'Update invoice (header + lines) by ID via PUT'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. PUT Handler
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'createinvoicefull/:id',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update AP Invoice (header + lines) by ID',
        p_source         => q'[
DECLARE
    l_blob          BLOB := :body;
    l_clob          CLOB;
    l_dest_offset   INTEGER := 1;
    l_src_offset    INTEGER := 1;
    l_lang_context  INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    l_warning       INTEGER;
    l_invoice_id    NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
    l_merged_json   CLOB;
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
        l_clob := :body_text;
    END IF;

    -- Inject InvoiceId from URL path parameter into the JSON body
    SELECT JSON_MERGEPATCH(
        l_clob,
        '{"InvoiceId":' || :id || '}'
    ) INTO l_merged_json FROM DUAL;

    RR_AP_UPDATE_INVOICE_PKG.update_invoice(
        p_json       => l_merged_json,
        p_invoice_id => l_invoice_id,
        p_status     => l_status,
        p_message    => l_message
    );

    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 400 END;

    HTP.P('{"status": "' || l_status || '",'
       || '"message": "' || l_message || '",'
       || '"invoiceId": ' || NVL(TO_CHAR(l_invoice_id), 'null') || ','
       || '"success": ' || CASE WHEN l_status = 'SUCCESS' THEN 'true' ELSE 'false' END
       || '}');

    -- Free temporary CLOB
    IF l_clob IS NOT NULL AND DBMS_LOB.ISTEMPORARY(l_clob) = 1 THEN
        DBMS_LOB.FREETEMPORARY(l_clob);
    END IF;
    IF l_merged_json IS NOT NULL AND DBMS_LOB.ISTEMPORARY(l_merged_json) = 1 THEN
        DBMS_LOB.FREETEMPORARY(l_merged_json);
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
-- 6. Sample curl for Testing
-- =====================================================
/*

-- ===== UPDATE INVOICE 900009 =====
-- curl -X PUT /ap/createinvoicefull/900009

PUT URL: https://<your-apex-host>/ords/<schema>/reerp/ap/createinvoicefull/900009
Content-Type: application/json

{
    "InvoiceNumber": "TEST-INV-001",
    "InvoiceCurrency": "AED",
    "PaymentCurrency": "AED",
    "InvoiceAmount": 2100.00,
    "InvoiceDate": "2026-02-14",
    "BusinessUnit": "BUIMERC CORP_DIFC_INVST",
    "Supplier": "TEST SUPPLIER LLC",
    "SupplierNumber": "T0001",
    "SupplierSite": "DUBAI",
    "InvoiceType": "Standard",
    "Description": "Updated invoice from UI",
    "PaymentTerms": "Immediate",
    "PayGroup": "Standard",
    "PayAlone": "N",
    "LiabilityDistribution": "01-000-2100-0000-000",
    "ConversionRateType": "Corporate",
    "ConversionDate": "2026-02-14",
    "ConversionRate": 1.0,
    "DocumentCategory": "Standard Invoices",
    "VoucherNumber": "V-002",
    "FirstPartyTaxRegistrationNumber": "100123456700003",
    "SupplierTaxRegistrationNumber": "300987654321234",
    "lines": [
        {
            "LineNumber": 1,
            "LineType": "Item",
            "LineAmount": 2000.00,
            "Description": "Updated Office Supplies",
            "AccountingDate": "2026-02-14",
            "DistributionCombination": "01-000-6310-0000-000",
            "TaxClassification": "VAT 5%",
            "Quantity": 20,
            "UnitPrice": 100
        },
        {
            "LineNumber": 2,
            "LineType": "Tax",
            "LineAmount": 100.00,
            "Description": "VAT 5%",
            "AccountingDate": "2026-02-14"
        }
    ]
}

Expected Response (success):
{
    "status": "SUCCESS",
    "message": "Invoice TEST-INV-001 updated (ID: 900009) with 2 lines (replaced 2 previous lines)",
    "invoiceId": 900009,
    "success": true
}

Expected Response (invoice not found):
{
    "status": "ERROR",
    "message": "Invoice not found: 900009",
    "invoiceId": null,
    "success": false
}

Expected Response (already paid):
{
    "status": "ERROR",
    "message": "Invoice cannot be edited: already Paid",
    "invoiceId": 900009,
    "success": false
}

-- ===== BUSINESS RULES =====
-- Invoice is EDITABLE when:
--   PAID_STATUS       != 'Paid'
--   ACCOUNTING_STATUS != 'Accounted'
--
-- After update, VALIDATION_STATUS is reset to 'Needs Revalidation'
-- Lines strategy: DELETE ALL existing lines, then INSERT new lines from payload

*/
