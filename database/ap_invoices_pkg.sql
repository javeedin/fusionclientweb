-- =====================================================
-- AP Invoices Package Specification
-- =====================================================

CREATE OR REPLACE PACKAGE XXAP_INVOICES_PKG AS

    -- Record type for invoice data
    TYPE invoice_rec_type IS RECORD (
        invoice_id                          NUMBER,
        invoice_number                      VARCHAR2(50),
        invoice_currency                    VARCHAR2(15),
        payment_currency                    VARCHAR2(15),
        invoice_amount                      NUMBER,
        invoice_date                        DATE,
        business_unit                       VARCHAR2(240),
        legal_entity                        VARCHAR2(240),
        legal_entity_identifier             VARCHAR2(30),
        supplier                            VARCHAR2(360),
        supplier_number                     VARCHAR2(30),
        supplier_site                       VARCHAR2(240),
        supplier_tax_registration_number    VARCHAR2(50),
        party                               VARCHAR2(360),
        party_site                          VARCHAR2(240),
        procurement_bu                      VARCHAR2(240),
        purchase_order_number               VARCHAR2(50),
        requester_id                        NUMBER,
        requester                           VARCHAR2(240),
        invoice_group                       VARCHAR2(80),
        invoice_source_code                 VARCHAR2(30),
        invoice_source                      VARCHAR2(80),
        invoice_type                        VARCHAR2(30),
        description                         VARCHAR2(4000),
        conversion_rate_type                VARCHAR2(30),
        conversion_date                     DATE,
        conversion_rate                     NUMBER,
        base_amount                         NUMBER,
        accounting_date                     DATE,
        terms_date                          DATE,
        goods_received_date                 DATE,
        invoice_received_date               DATE,
        pay_group                           VARCHAR2(80),
        payment_terms                       VARCHAR2(50),
        payment_method_code                 VARCHAR2(30),
        payment_method                      VARCHAR2(80),
        pay_alone_flag                      VARCHAR2(1),
        amount_paid                         NUMBER,
        control_amount                      NUMBER,
        delivery_channel_code               VARCHAR2(30),
        delivery_channel                    VARCHAR2(80),
        taxation_country                    VARCHAR2(80),
        liability_distribution              VARCHAR2(250),
        document_category                   VARCHAR2(80),
        document_sequence                   NUMBER,
        voucher_number                      VARCHAR2(50),
        validation_status                   VARCHAR2(30),
        approval_status                     VARCHAR2(30),
        paid_status                         VARCHAR2(30),
        accounting_status                   VARCHAR2(30),
        account_coding_status               VARCHAR2(30),
        funds_status                        VARCHAR2(30),
        canceled_flag                       VARCHAR2(1),
        canceled_date                       DATE,
        canceled_by                         VARCHAR2(100),
        budget_date                         DATE,
        fusion_created_by                   VARCHAR2(100),
        fusion_creation_date                TIMESTAMP,
        fusion_last_updated_by              VARCHAR2(100),
        fusion_last_update_date             TIMESTAMP,
        fusion_last_update_login            VARCHAR2(50)
    );

    -- Table type for bulk operations
    TYPE invoice_tbl_type IS TABLE OF invoice_rec_type INDEX BY BINARY_INTEGER;

    -- Procedure to save single invoice
    PROCEDURE save_invoice (
        p_invoice_json  IN  CLOB,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

    -- Procedure to save multiple invoices (bulk)
    PROCEDURE save_invoices_bulk (
        p_invoices_json IN  CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

    -- Procedure to merge invoice (insert or update)
    PROCEDURE merge_invoice (
        p_invoice_id                        IN NUMBER,
        p_invoice_number                    IN VARCHAR2,
        p_invoice_currency                  IN VARCHAR2,
        p_payment_currency                  IN VARCHAR2,
        p_invoice_amount                    IN NUMBER,
        p_invoice_date                      IN DATE,
        p_business_unit                     IN VARCHAR2,
        p_legal_entity                      IN VARCHAR2,
        p_legal_entity_identifier           IN VARCHAR2,
        p_supplier                          IN VARCHAR2,
        p_supplier_number                   IN VARCHAR2,
        p_supplier_site                     IN VARCHAR2,
        p_party                             IN VARCHAR2,
        p_party_site                        IN VARCHAR2,
        p_invoice_group                     IN VARCHAR2,
        p_invoice_source_code               IN VARCHAR2,
        p_invoice_source                    IN VARCHAR2,
        p_invoice_type                      IN VARCHAR2,
        p_description                       IN VARCHAR2,
        p_conversion_rate_type              IN VARCHAR2,
        p_conversion_date                   IN DATE,
        p_conversion_rate                   IN NUMBER,
        p_accounting_date                   IN DATE,
        p_terms_date                        IN DATE,
        p_pay_group                         IN VARCHAR2,
        p_payment_terms                     IN VARCHAR2,
        p_payment_method_code               IN VARCHAR2,
        p_payment_method                    IN VARCHAR2,
        p_pay_alone_flag                    IN VARCHAR2,
        p_amount_paid                       IN NUMBER,
        p_delivery_channel_code             IN VARCHAR2,
        p_delivery_channel                  IN VARCHAR2,
        p_taxation_country                  IN VARCHAR2,
        p_liability_distribution            IN VARCHAR2,
        p_document_category                 IN VARCHAR2,
        p_document_sequence                 IN NUMBER,
        p_validation_status                 IN VARCHAR2,
        p_approval_status                   IN VARCHAR2,
        p_paid_status                       IN VARCHAR2,
        p_accounting_status                 IN VARCHAR2,
        p_account_coding_status             IN VARCHAR2,
        p_canceled_flag                     IN VARCHAR2,
        p_budget_date                       IN DATE,
        p_fusion_created_by                 IN VARCHAR2,
        p_fusion_creation_date              IN TIMESTAMP,
        p_fusion_last_updated_by            IN VARCHAR2,
        p_fusion_last_update_date           IN TIMESTAMP,
        p_fusion_last_update_login          IN VARCHAR2,
        p_status                            OUT VARCHAR2,
        p_message                           OUT VARCHAR2
    );

    -- Function to get invoice count by status
    FUNCTION get_invoice_count (
        p_status IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER;

END XXAP_INVOICES_PKG;
/

-- =====================================================
-- AP Invoices Package Body
-- =====================================================

CREATE OR REPLACE PACKAGE BODY XXAP_INVOICES_PKG AS

    -- =====================================================
    -- Save Single Invoice from JSON
    -- =====================================================
    PROCEDURE save_invoice (
        p_invoice_json  IN  CLOB,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) AS
        l_invoice_id                NUMBER;
        l_invoice_number            VARCHAR2(50);
        l_invoice_currency          VARCHAR2(15);
        l_payment_currency          VARCHAR2(15);
        l_invoice_amount            NUMBER;
        l_invoice_date              DATE;
        l_business_unit             VARCHAR2(240);
        l_supplier                  VARCHAR2(360);
        l_supplier_number           VARCHAR2(30);
        l_supplier_site             VARCHAR2(240);
        l_party                     VARCHAR2(360);
        l_party_site                VARCHAR2(240);
        l_invoice_group             VARCHAR2(80);
        l_invoice_source_code       VARCHAR2(30);
        l_invoice_source            VARCHAR2(80);
        l_invoice_type              VARCHAR2(30);
        l_description               VARCHAR2(4000);
        l_conversion_rate_type      VARCHAR2(30);
        l_conversion_date           DATE;
        l_conversion_rate           NUMBER;
        l_base_amount               NUMBER;
        l_accounting_date           DATE;
        l_terms_date                DATE;
        l_pay_group                 VARCHAR2(80);
        l_payment_terms             VARCHAR2(50);
        l_payment_method_code       VARCHAR2(30);
        l_payment_method            VARCHAR2(80);
        l_pay_alone_flag            VARCHAR2(1);
        l_amount_paid               NUMBER;
        l_control_amount            NUMBER;
        l_delivery_channel_code     VARCHAR2(30);
        l_delivery_channel          VARCHAR2(80);
        l_taxation_country          VARCHAR2(80);
        l_liability_distribution    VARCHAR2(250);
        l_document_category         VARCHAR2(80);
        l_document_sequence         NUMBER;
        l_voucher_number            VARCHAR2(50);
        l_validation_status         VARCHAR2(30);
        l_approval_status           VARCHAR2(30);
        l_paid_status               VARCHAR2(30);
        l_accounting_status         VARCHAR2(30);
        l_account_coding_status     VARCHAR2(30);
        l_funds_status              VARCHAR2(30);
        l_canceled_flag             VARCHAR2(1);
        l_canceled_date             DATE;
        l_canceled_by               VARCHAR2(100);
        l_budget_date               DATE;
        l_legal_entity              VARCHAR2(240);
        l_legal_entity_identifier   VARCHAR2(30);
        l_purchase_order_number     VARCHAR2(50);
        l_fusion_created_by         VARCHAR2(100);
        l_fusion_creation_date      TIMESTAMP;
        l_fusion_last_updated_by    VARCHAR2(100);
        l_fusion_last_update_date   TIMESTAMP;
        l_fusion_last_update_login  VARCHAR2(50);
    BEGIN
        -- Parse JSON and extract values
        l_invoice_id := JSON_VALUE(p_invoice_json, '$.InvoiceId' RETURNING NUMBER);
        l_invoice_number := JSON_VALUE(p_invoice_json, '$.InvoiceNumber');
        l_invoice_currency := JSON_VALUE(p_invoice_json, '$.InvoiceCurrency');
        l_payment_currency := JSON_VALUE(p_invoice_json, '$.PaymentCurrency');
        l_invoice_amount := JSON_VALUE(p_invoice_json, '$.InvoiceAmount' RETURNING NUMBER);
        l_invoice_date := TO_DATE(JSON_VALUE(p_invoice_json, '$.InvoiceDate'), 'YYYY-MM-DD');
        l_business_unit := JSON_VALUE(p_invoice_json, '$.BusinessUnit');
        l_supplier := JSON_VALUE(p_invoice_json, '$.Supplier');
        l_supplier_number := JSON_VALUE(p_invoice_json, '$.SupplierNumber');
        l_supplier_site := JSON_VALUE(p_invoice_json, '$.SupplierSite');
        l_party := JSON_VALUE(p_invoice_json, '$.Party');
        l_party_site := JSON_VALUE(p_invoice_json, '$.PartySite');
        l_invoice_group := JSON_VALUE(p_invoice_json, '$.InvoiceGroup');
        l_invoice_source_code := JSON_VALUE(p_invoice_json, '$.InvoiceSourceCode');
        l_invoice_source := JSON_VALUE(p_invoice_json, '$.InvoiceSource');
        l_invoice_type := JSON_VALUE(p_invoice_json, '$.InvoiceType');
        l_description := JSON_VALUE(p_invoice_json, '$.Description');
        l_conversion_rate_type := JSON_VALUE(p_invoice_json, '$.ConversionRateType');
        l_conversion_date := TO_DATE(JSON_VALUE(p_invoice_json, '$.ConversionDate'), 'YYYY-MM-DD');
        l_conversion_rate := JSON_VALUE(p_invoice_json, '$.ConversionRate' RETURNING NUMBER);
        l_base_amount := JSON_VALUE(p_invoice_json, '$.BaseAmount' RETURNING NUMBER);
        l_accounting_date := TO_DATE(JSON_VALUE(p_invoice_json, '$.AccountingDate'), 'YYYY-MM-DD');
        l_terms_date := TO_DATE(JSON_VALUE(p_invoice_json, '$.TermsDate'), 'YYYY-MM-DD');
        l_pay_group := JSON_VALUE(p_invoice_json, '$.PayGroup');
        l_payment_terms := JSON_VALUE(p_invoice_json, '$.PaymentTerms');
        l_payment_method_code := JSON_VALUE(p_invoice_json, '$.PaymentMethodCode');
        l_payment_method := JSON_VALUE(p_invoice_json, '$.PaymentMethod');
        l_pay_alone_flag := CASE WHEN JSON_VALUE(p_invoice_json, '$.PayAloneFlag') = 'true' THEN 'Y' ELSE 'N' END;
        l_amount_paid := JSON_VALUE(p_invoice_json, '$.AmountPaid' RETURNING NUMBER);
        l_control_amount := JSON_VALUE(p_invoice_json, '$.ControlAmount' RETURNING NUMBER);
        l_delivery_channel_code := JSON_VALUE(p_invoice_json, '$.DeliveryChannelCode');
        l_delivery_channel := JSON_VALUE(p_invoice_json, '$.DeliveryChannel');
        l_taxation_country := JSON_VALUE(p_invoice_json, '$.TaxationCountry');
        l_liability_distribution := JSON_VALUE(p_invoice_json, '$.LiabilityDistribution');
        l_document_category := JSON_VALUE(p_invoice_json, '$.DocumentCategory');
        -- document_sequence is auto-assigned via sequence on INSERT; preserved on UPDATE
        l_voucher_number := JSON_VALUE(p_invoice_json, '$.VoucherNumber');
        l_validation_status := JSON_VALUE(p_invoice_json, '$.ValidationStatus');
        l_approval_status := JSON_VALUE(p_invoice_json, '$.ApprovalStatus');
        l_paid_status := JSON_VALUE(p_invoice_json, '$.PaidStatus');
        l_accounting_status := JSON_VALUE(p_invoice_json, '$.AccountingStatus');
        l_account_coding_status := JSON_VALUE(p_invoice_json, '$.AccountCodingStatus');
        l_funds_status := JSON_VALUE(p_invoice_json, '$.FundsStatus');
        l_canceled_flag := CASE WHEN JSON_VALUE(p_invoice_json, '$.CanceledFlag') = 'true' THEN 'Y' ELSE 'N' END;
        l_canceled_date := TO_DATE(JSON_VALUE(p_invoice_json, '$.CanceledDate'), 'YYYY-MM-DD');
        l_canceled_by := JSON_VALUE(p_invoice_json, '$.CanceledBy');
        l_budget_date := TO_DATE(JSON_VALUE(p_invoice_json, '$.BudgetDate'), 'YYYY-MM-DD');
        l_legal_entity := JSON_VALUE(p_invoice_json, '$.LegalEntity');
        l_legal_entity_identifier := JSON_VALUE(p_invoice_json, '$.LegalEntityIdentifier');
        l_purchase_order_number := JSON_VALUE(p_invoice_json, '$.PurchaseOrderNumber');
        l_fusion_created_by := JSON_VALUE(p_invoice_json, '$.CreatedBy');
        -- Handle timestamp with timezone and milliseconds (strip both)
        l_fusion_creation_date := TO_TIMESTAMP(
            REGEXP_REPLACE(JSON_VALUE(p_invoice_json, '$.CreationDate'), '(\.\d+)?[+-]\d{2}:\d{2}$', ''),
            'YYYY-MM-DD"T"HH24:MI:SS'
        );
        l_fusion_last_updated_by := JSON_VALUE(p_invoice_json, '$.LastUpdatedBy');
        l_fusion_last_update_date := TO_TIMESTAMP(
            REGEXP_REPLACE(JSON_VALUE(p_invoice_json, '$.LastUpdateDate'), '(\.\d+)?[+-]\d{2}:\d{2}$', ''),
            'YYYY-MM-DD"T"HH24:MI:SS'
        );
        l_fusion_last_update_login := JSON_VALUE(p_invoice_json, '$.LastUpdateLogin');

        -- Merge (Insert or Update)
        MERGE INTO RR_AP_INVOICES_ALL tgt
        USING (SELECT l_invoice_id AS invoice_id FROM DUAL) src
        ON (tgt.invoice_id = src.invoice_id)
        WHEN MATCHED THEN
            UPDATE SET
                invoice_number = l_invoice_number,
                invoice_currency = l_invoice_currency,
                payment_currency = l_payment_currency,
                invoice_amount = l_invoice_amount,
                invoice_date = l_invoice_date,
                business_unit = l_business_unit,
                supplier = l_supplier,
                supplier_number = l_supplier_number,
                supplier_site = l_supplier_site,
                party = l_party,
                party_site = l_party_site,
                invoice_group = l_invoice_group,
                invoice_source_code = l_invoice_source_code,
                invoice_source = l_invoice_source,
                invoice_type = l_invoice_type,
                description = l_description,
                conversion_rate_type = l_conversion_rate_type,
                conversion_date = l_conversion_date,
                conversion_rate = l_conversion_rate,
                base_amount = l_base_amount,
                accounting_date = l_accounting_date,
                terms_date = l_terms_date,
                pay_group = l_pay_group,
                payment_terms = l_payment_terms,
                payment_method_code = l_payment_method_code,
                payment_method = l_payment_method,
                pay_alone_flag = l_pay_alone_flag,
                amount_paid = l_amount_paid,
                control_amount = l_control_amount,
                delivery_channel_code = l_delivery_channel_code,
                delivery_channel = l_delivery_channel,
                taxation_country = l_taxation_country,
                liability_distribution = l_liability_distribution,
                document_category = l_document_category,
                -- document_sequence intentionally excluded: auto-assigned at creation, never overwritten on update
                voucher_number = l_voucher_number,
                validation_status = l_validation_status,
                approval_status = l_approval_status,
                paid_status = l_paid_status,
                accounting_status = l_accounting_status,
                account_coding_status = l_account_coding_status,
                funds_status = l_funds_status,
                canceled_flag = l_canceled_flag,
                canceled_date = l_canceled_date,
                canceled_by = l_canceled_by,
                budget_date = l_budget_date,
                legal_entity = l_legal_entity,
                legal_entity_identifier = l_legal_entity_identifier,
                purchase_order_number = l_purchase_order_number,
                fusion_created_by = l_fusion_created_by,
                fusion_creation_date = l_fusion_creation_date,
                fusion_last_updated_by = l_fusion_last_updated_by,
                fusion_last_update_date = l_fusion_last_update_date,
                fusion_last_update_login = l_fusion_last_update_login,
                last_updated_by = USER,
                last_update_date = SYSTIMESTAMP,
                sync_status = 'UPDATED',
                sync_date = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                invoice_id, invoice_number, invoice_currency, payment_currency,
                invoice_amount, invoice_date, business_unit, supplier, supplier_number,
                supplier_site, party, party_site, invoice_group, invoice_source_code,
                invoice_source, invoice_type, description, conversion_rate_type,
                conversion_date, conversion_rate, base_amount, accounting_date, terms_date,
                pay_group, payment_terms, payment_method_code, payment_method, pay_alone_flag,
                amount_paid, control_amount, delivery_channel_code, delivery_channel,
                taxation_country, liability_distribution, document_category, document_sequence,
                voucher_number, validation_status, approval_status, paid_status,
                accounting_status, account_coding_status, funds_status, canceled_flag,
                canceled_date, canceled_by, budget_date, legal_entity, legal_entity_identifier,
                purchase_order_number, fusion_created_by, fusion_creation_date,
                fusion_last_updated_by, fusion_last_update_date, fusion_last_update_login,
                created_by, creation_date, sync_status, sync_date
            )
            VALUES (
                l_invoice_id, l_invoice_number, l_invoice_currency, l_payment_currency,
                l_invoice_amount, l_invoice_date, l_business_unit, l_supplier, l_supplier_number,
                l_supplier_site, l_party, l_party_site, l_invoice_group, l_invoice_source_code,
                l_invoice_source, l_invoice_type, l_description, l_conversion_rate_type,
                l_conversion_date, l_conversion_rate, l_base_amount, l_accounting_date, l_terms_date,
                l_pay_group, l_payment_terms, l_payment_method_code, l_payment_method, l_pay_alone_flag,
                l_amount_paid, l_control_amount, l_delivery_channel_code, l_delivery_channel,
                l_taxation_country, l_liability_distribution, l_document_category, seq_ap_document_seq.NEXTVAL,
                l_voucher_number, l_validation_status, l_approval_status, l_paid_status,
                l_accounting_status, l_account_coding_status, l_funds_status, l_canceled_flag,
                l_canceled_date, l_canceled_by, l_budget_date, l_legal_entity, l_legal_entity_identifier,
                l_purchase_order_number, l_fusion_created_by, l_fusion_creation_date,
                l_fusion_last_updated_by, l_fusion_last_update_date, l_fusion_last_update_login,
                USER, SYSTIMESTAMP, 'NEW', SYSTIMESTAMP
            );

        COMMIT;

        p_status := 'SUCCESS';
        p_message := 'Invoice ' || l_invoice_number || ' saved successfully';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status := 'ERROR';
            p_message := 'Error saving invoice: ' || SQLERRM;
    END save_invoice;

    -- =====================================================
    -- Save Multiple Invoices from JSON Array (Bulk)
    -- =====================================================
    PROCEDURE save_invoices_bulk (
        p_invoices_json IN  CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) AS
        l_invoice_json  CLOB;
        l_inv_status    VARCHAR2(20);
        l_inv_message   VARCHAR2(4000);
        l_count         NUMBER := 0;
    BEGIN
        p_success_count := 0;
        p_error_count := 0;

        -- Loop through items array
        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_invoices_json, '$.items[*]'
                COLUMNS (
                    invoice_json CLOB FORMAT JSON PATH '$'
                )
            ) jt
        ) LOOP
            l_count := l_count + 1;

            BEGIN
                save_invoice(
                    p_invoice_json => rec.invoice_json,
                    p_status => l_inv_status,
                    p_message => l_inv_message
                );

                IF l_inv_status = 'SUCCESS' THEN
                    p_success_count := p_success_count + 1;
                ELSE
                    p_error_count := p_error_count + 1;
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    p_error_count := p_error_count + 1;
            END;
        END LOOP;

        IF p_error_count = 0 THEN
            p_status := 'SUCCESS';
            p_message := 'All ' || p_success_count || ' invoices saved successfully';
        ELSIF p_success_count = 0 THEN
            p_status := 'ERROR';
            p_message := 'Failed to save all ' || p_error_count || ' invoices';
        ELSE
            p_status := 'PARTIAL';
            p_message := 'Saved ' || p_success_count || ' invoices, ' || p_error_count || ' failed';
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := 'Error in bulk save: ' || SQLERRM;
    END save_invoices_bulk;

    -- =====================================================
    -- Merge Invoice (Insert or Update)
    -- =====================================================
    PROCEDURE merge_invoice (
        p_invoice_id                        IN NUMBER,
        p_invoice_number                    IN VARCHAR2,
        p_invoice_currency                  IN VARCHAR2,
        p_payment_currency                  IN VARCHAR2,
        p_invoice_amount                    IN NUMBER,
        p_invoice_date                      IN DATE,
        p_business_unit                     IN VARCHAR2,
        p_legal_entity                      IN VARCHAR2,
        p_legal_entity_identifier           IN VARCHAR2,
        p_supplier                          IN VARCHAR2,
        p_supplier_number                   IN VARCHAR2,
        p_supplier_site                     IN VARCHAR2,
        p_party                             IN VARCHAR2,
        p_party_site                        IN VARCHAR2,
        p_invoice_group                     IN VARCHAR2,
        p_invoice_source_code               IN VARCHAR2,
        p_invoice_source                    IN VARCHAR2,
        p_invoice_type                      IN VARCHAR2,
        p_description                       IN VARCHAR2,
        p_conversion_rate_type              IN VARCHAR2,
        p_conversion_date                   IN DATE,
        p_conversion_rate                   IN NUMBER,
        p_accounting_date                   IN DATE,
        p_terms_date                        IN DATE,
        p_pay_group                         IN VARCHAR2,
        p_payment_terms                     IN VARCHAR2,
        p_payment_method_code               IN VARCHAR2,
        p_payment_method                    IN VARCHAR2,
        p_pay_alone_flag                    IN VARCHAR2,
        p_amount_paid                       IN NUMBER,
        p_delivery_channel_code             IN VARCHAR2,
        p_delivery_channel                  IN VARCHAR2,
        p_taxation_country                  IN VARCHAR2,
        p_liability_distribution            IN VARCHAR2,
        p_document_category                 IN VARCHAR2,
        p_document_sequence                 IN NUMBER,
        p_validation_status                 IN VARCHAR2,
        p_approval_status                   IN VARCHAR2,
        p_paid_status                       IN VARCHAR2,
        p_accounting_status                 IN VARCHAR2,
        p_account_coding_status             IN VARCHAR2,
        p_canceled_flag                     IN VARCHAR2,
        p_budget_date                       IN DATE,
        p_fusion_created_by                 IN VARCHAR2,
        p_fusion_creation_date              IN TIMESTAMP,
        p_fusion_last_updated_by            IN VARCHAR2,
        p_fusion_last_update_date           IN TIMESTAMP,
        p_fusion_last_update_login          IN VARCHAR2,
        p_status                            OUT VARCHAR2,
        p_message                           OUT VARCHAR2
    ) AS
    BEGIN
        MERGE INTO RR_AP_INVOICES_ALL tgt
        USING (SELECT p_invoice_id AS invoice_id FROM DUAL) src
        ON (tgt.invoice_id = src.invoice_id)
        WHEN MATCHED THEN
            UPDATE SET
                invoice_number = p_invoice_number,
                invoice_currency = p_invoice_currency,
                payment_currency = p_payment_currency,
                invoice_amount = p_invoice_amount,
                invoice_date = p_invoice_date,
                business_unit = p_business_unit,
                legal_entity = p_legal_entity,
                legal_entity_identifier = p_legal_entity_identifier,
                supplier = p_supplier,
                supplier_number = p_supplier_number,
                supplier_site = p_supplier_site,
                party = p_party,
                party_site = p_party_site,
                invoice_group = p_invoice_group,
                invoice_source_code = p_invoice_source_code,
                invoice_source = p_invoice_source,
                invoice_type = p_invoice_type,
                description = p_description,
                conversion_rate_type = p_conversion_rate_type,
                conversion_date = p_conversion_date,
                conversion_rate = p_conversion_rate,
                accounting_date = p_accounting_date,
                terms_date = p_terms_date,
                pay_group = p_pay_group,
                payment_terms = p_payment_terms,
                payment_method_code = p_payment_method_code,
                payment_method = p_payment_method,
                pay_alone_flag = p_pay_alone_flag,
                amount_paid = p_amount_paid,
                delivery_channel_code = p_delivery_channel_code,
                delivery_channel = p_delivery_channel,
                taxation_country = p_taxation_country,
                liability_distribution = p_liability_distribution,
                document_category = p_document_category,
                -- document_sequence intentionally excluded: auto-assigned at creation, never overwritten on update
                validation_status = p_validation_status,
                approval_status = p_approval_status,
                paid_status = p_paid_status,
                accounting_status = p_accounting_status,
                account_coding_status = p_account_coding_status,
                canceled_flag = p_canceled_flag,
                budget_date = p_budget_date,
                fusion_created_by = p_fusion_created_by,
                fusion_creation_date = p_fusion_creation_date,
                fusion_last_updated_by = p_fusion_last_updated_by,
                fusion_last_update_date = p_fusion_last_update_date,
                fusion_last_update_login = p_fusion_last_update_login,
                last_updated_by = USER,
                last_update_date = SYSTIMESTAMP,
                sync_status = 'UPDATED',
                sync_date = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                invoice_id, invoice_number, invoice_currency, payment_currency,
                invoice_amount, invoice_date, business_unit, legal_entity,
                legal_entity_identifier, supplier, supplier_number, supplier_site,
                party, party_site, invoice_group, invoice_source_code, invoice_source,
                invoice_type, description, conversion_rate_type, conversion_date,
                conversion_rate, accounting_date, terms_date, pay_group, payment_terms,
                payment_method_code, payment_method, pay_alone_flag, amount_paid,
                delivery_channel_code, delivery_channel, taxation_country,
                liability_distribution, document_category, document_sequence,
                validation_status, approval_status, paid_status, accounting_status,
                account_coding_status, canceled_flag, budget_date, fusion_created_by,
                fusion_creation_date, fusion_last_updated_by, fusion_last_update_date,
                fusion_last_update_login, created_by, creation_date, sync_status, sync_date
            )
            VALUES (
                p_invoice_id, p_invoice_number, p_invoice_currency, p_payment_currency,
                p_invoice_amount, p_invoice_date, p_business_unit, p_legal_entity,
                p_legal_entity_identifier, p_supplier, p_supplier_number, p_supplier_site,
                p_party, p_party_site, p_invoice_group, p_invoice_source_code, p_invoice_source,
                p_invoice_type, p_description, p_conversion_rate_type, p_conversion_date,
                p_conversion_rate, p_accounting_date, p_terms_date, p_pay_group, p_payment_terms,
                p_payment_method_code, p_payment_method, p_pay_alone_flag, p_amount_paid,
                p_delivery_channel_code, p_delivery_channel, p_taxation_country,
                p_liability_distribution, p_document_category, seq_ap_document_seq.NEXTVAL,
                p_validation_status, p_approval_status, p_paid_status, p_accounting_status,
                p_account_coding_status, p_canceled_flag, p_budget_date, p_fusion_created_by,
                p_fusion_creation_date, p_fusion_last_updated_by, p_fusion_last_update_date,
                p_fusion_last_update_login, USER, SYSTIMESTAMP, 'NEW', SYSTIMESTAMP
            );

        COMMIT;
        p_status := 'SUCCESS';
        p_message := 'Invoice ' || p_invoice_number || ' merged successfully';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status := 'ERROR';
            p_message := 'Error merging invoice: ' || SQLERRM;
    END merge_invoice;

    -- =====================================================
    -- Get Invoice Count by Status
    -- =====================================================
    FUNCTION get_invoice_count (
        p_status IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER AS
        l_count NUMBER;
    BEGIN
        IF p_status IS NULL THEN
            SELECT COUNT(*) INTO l_count FROM RR_AP_INVOICES_ALL;
        ELSE
            SELECT COUNT(*) INTO l_count
            FROM RR_AP_INVOICES_ALL
            WHERE sync_status = p_status;
        END IF;

        RETURN l_count;
    END get_invoice_count;

END XXAP_INVOICES_PKG;
/
