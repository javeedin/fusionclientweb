-- =====================================================
-- AR Credit Memo Headers PL/SQL Package
-- Package : RR_AR_CREDITMEMO_PKG
-- Table   : RR_AR_CREDITMEMO_HEADERS
-- Source  : Oracle Fusion receivablesCreditMemos
-- =====================================================

CREATE OR REPLACE PACKAGE RR_AR_CREDITMEMO_PKG AS

    PROCEDURE save_creditmemos_bulk (
        p_json      IN  CLOB,
        p_status    OUT VARCHAR2,
        p_message   OUT VARCHAR2,
        p_inserted  OUT NUMBER,
        p_updated   OUT NUMBER,
        p_errors    OUT NUMBER
    );

    PROCEDURE save_creditmemo_lines (
        p_transaction_id IN  NUMBER,
        p_lines_json     IN  CLOB,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2
    );

    PROCEDURE save_creditmemo_distributions (
        p_transaction_id   IN  NUMBER,
        p_distributions_json IN CLOB,
        p_status           OUT VARCHAR2,
        p_message          OUT VARCHAR2
    );

END RR_AR_CREDITMEMO_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_AR_CREDITMEMO_PKG AS

    FUNCTION to_safe_date (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(SUBSTR(TRIM(p_str), 1, 10), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_date;

    FUNCTION to_safe_ts (p_str IN VARCHAR2) RETURN TIMESTAMP IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP_TZ(TRIM(p_str), 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            RETURN TO_TIMESTAMP(SUBSTR(TRIM(p_str), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS');
        EXCEPTION WHEN OTHERS THEN RETURN NULL;
        END;
    END to_safe_ts;

    -- -------------------------------------------------------
    -- save_creditmemos_bulk: {"items":[...]}
    -- Pre-computes all date/timestamp values into local PL/SQL
    -- variables before the MERGE (private functions cannot be
    -- called directly inside SQL statements in Oracle).
    -- -------------------------------------------------------
    PROCEDURE save_creditmemos_bulk (
        p_json      IN  CLOB,
        p_status    OUT VARCHAR2,
        p_message   OUT VARCHAR2,
        p_inserted  OUT NUMBER,
        p_updated   OUT NUMBER,
        p_errors    OUT NUMBER
    ) IS
        l_err_log   VARCHAR2(4000) := '';
        l_err_msg   VARCHAR2(4000);
        l_exists    NUMBER;

        -- Pre-computed date/timestamp locals
        l_txn_date          DATE;
        l_acct_date         DATE;
        l_billing_date      DATE;
        l_cust_ref_date     DATE;
        l_freight_ship_date DATE;
        l_po_date           DATE;
        l_print_date        DATE;
        l_conv_date         DATE;
        l_creation_ts       TIMESTAMP;
        l_last_update_ts    TIMESTAMP;
    BEGIN
        p_inserted := 0;
        p_updated  := 0;
        p_errors   := 0;

        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_json, '$.items[*]' COLUMNS (
                CUSTOMER_TRANSACTION_ID     NUMBER          PATH '$.CustomerTransactionId',
                TRANSACTION_NUMBER          VARCHAR2(50)    PATH '$.TransactionNumber',
                DOCUMENT_NUMBER             NUMBER          PATH '$.DocumentNumber',
                CROSS_REFERENCE             VARCHAR2(150)   PATH '$.CrossReference',
                CUSTOMER_REFERENCE          VARCHAR2(150)   PATH '$.CustomerReference',

                TRANSACTION_DATE_STR        VARCHAR2(30)    PATH '$.TransactionDate',
                ACCOUNTING_DATE_STR         VARCHAR2(30)    PATH '$.AccountingDate',
                BILLING_DATE_STR            VARCHAR2(30)    PATH '$.BillingDate',
                CUSTOMER_REF_DATE_STR       VARCHAR2(30)    PATH '$.CustomerReferenceDate',
                FREIGHT_SHIP_DATE_STR       VARCHAR2(30)    PATH '$.FreightShipDate',
                PURCHASE_ORDER_DATE_STR     VARCHAR2(30)    PATH '$.PurchaseOrderDate',
                PRINT_DATE_STR              VARCHAR2(30)    PATH '$.PrintDate',
                CONVERSION_RATE_DATE_STR    VARCHAR2(30)    PATH '$.ConversionRateDate',

                TRANSACTION_TYPE            VARCHAR2(50)    PATH '$.TransactionType',
                TRANSACTION_SOURCE          VARCHAR2(240)   PATH '$.TransactionSource',
                CREDIT_MEMO_STATUS          VARCHAR2(30)    PATH '$.CreditMemoStatus',

                CREDIT_MEMO_CURRENCY        VARCHAR2(15)    PATH '$.CreditMemoCurrency',
                CONVERSION_RATE_TYPE        VARCHAR2(30)    PATH '$.ConversionRateType',
                CONVERSION_RATE             NUMBER          PATH '$.ConversionRate',

                ENTERED_AMOUNT              NUMBER          PATH '$.EnteredAmount',
                TRANSACTION_BALANCE_DUE     NUMBER          PATH '$.TransactionBalanceDue',
                FREIGHT_CREDIT_AMOUNT       NUMBER          PATH '$.FreightCreditAmount',
                CREDIT_REASON               VARCHAR2(240)   PATH '$.CreditReason',

                BILL_TO_CUSTOMER_NUMBER     VARCHAR2(50)    PATH '$.BillToCustomerNumber',
                BILL_TO_CUSTOMER_NAME       VARCHAR2(360)   PATH '$.BillToCustomerName',
                BILL_TO_SITE                VARCHAR2(50)    PATH '$.BillToSite',
                BILL_TO_CONTACT             VARCHAR2(360)   PATH '$.BillToContact',

                SHIP_TO_CUSTOMER_NUMBER     VARCHAR2(50)    PATH '$.ShipToCustomerNumber',
                SHIP_TO_CUSTOMER_NAME       VARCHAR2(360)   PATH '$.ShipToCustomerName',
                SHIP_TO_CUSTOMER_SITE       VARCHAR2(50)    PATH '$.ShipToCustomerSite',
                SHIP_TO_CONTACT             VARCHAR2(360)   PATH '$.ShipToContact',

                PAYING_CUSTOMER_NAME        VARCHAR2(360)   PATH '$.PayingCustomerName',
                PAYING_CUSTOMER_SITE        VARCHAR2(50)    PATH '$.PayingCustomerSite',
                PAYING_CUSTOMER_ACCOUNT     VARCHAR2(100)   PATH '$.PayingCustomerAccount',
                SOLD_TO_PARTY_NUMBER        VARCHAR2(50)    PATH '$.SoldToPartyNumber',

                BUSINESS_UNIT               VARCHAR2(240)   PATH '$.BusinessUnit',
                LEGAL_ENTITY_IDENTIFIER     VARCHAR2(30)    PATH '$.LegalEntityIdentifier',

                PURCHASE_ORDER              VARCHAR2(150)   PATH '$.PurchaseOrder',
                PURCHASE_ORDER_REVISION     VARCHAR2(50)    PATH '$.PurchaseOrderRevision',

                CARRIER                     VARCHAR2(100)   PATH '$.Carrier',
                SHIPPING_REFERENCE          VARCHAR2(150)   PATH '$.FreightShippingReference',
                FREIGHT_FOB                 VARCHAR2(100)   PATH '$.FreightFOB',

                DEFAULT_TAXATION_COUNTRY    VARCHAR2(10)    PATH '$.DefaultTaxationCountry',
                FIRST_PARTY_REG_NUMBER      VARCHAR2(100)   PATH '$.FirstPartyRegistrationNumber',
                THIRD_PARTY_REG_NUMBER      VARCHAR2(100)   PATH '$.ThirdPartyRegistrationNumber',

                INTERCOMPANY                VARCHAR2(10)    PATH '$.Intercompany',
                GENERATE_BILL               VARCHAR2(10)    PATH '$.GenerateBill',
                ALLOW_COMPLETION            VARCHAR2(10)    PATH '$.AllowCompletion',
                CONTROL_COMPLETION_REASON   VARCHAR2(240)   PATH '$.ControlCompletionReason',
                DOC_FISCAL_CLASSIFICATION   VARCHAR2(100)   PATH '$.DocumentFiscalClassifcation',
                STRUCTURED_PAYMENT_REF      VARCHAR2(240)   PATH '$.StructuredPaymentReference',

                PRINT_STATUS                VARCHAR2(10)    PATH '$.PrintStatus',
                DELIVERY_METHOD             VARCHAR2(50)    PATH '$.DeliveryMethod',
                PRIMARY_SALESPERSON         VARCHAR2(240)   PATH '$.PrimarySalesperson',

                SPECIAL_INSTRUCTIONS        VARCHAR2(4000)  PATH '$.SpecialInstructions',
                CREDIT_MEMO_COMMENTS        VARCHAR2(4000)  PATH '$.CreditMemoComments',
                INTERNAL_NOTES              VARCHAR2(4000)  PATH '$.InternalNotes',
                EMAIL                       VARCHAR2(240)   PATH '$.RecipientEmail',

                CREATED_BY_STR              VARCHAR2(240)   PATH '$.CreatedBy',
                CREATION_DATE_STR           VARCHAR2(50)    PATH '$.CreationDate',
                LAST_UPDATED_BY_STR         VARCHAR2(240)   PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE_STR        VARCHAR2(50)    PATH '$.LastUpdateDate'
            )) j
        ) LOOP
            BEGIN
                -- Pre-compute all dates/timestamps into PL/SQL variables.
                -- Private package functions cannot be called inside SQL (MERGE),
                -- so they must be resolved here before the MERGE statement.
                l_txn_date          := to_safe_date(rec.TRANSACTION_DATE_STR);
                l_acct_date         := to_safe_date(rec.ACCOUNTING_DATE_STR);
                l_billing_date      := to_safe_date(rec.BILLING_DATE_STR);
                l_cust_ref_date     := to_safe_date(rec.CUSTOMER_REF_DATE_STR);
                l_freight_ship_date := to_safe_date(rec.FREIGHT_SHIP_DATE_STR);
                l_po_date           := to_safe_date(rec.PURCHASE_ORDER_DATE_STR);
                l_print_date        := to_safe_date(rec.PRINT_DATE_STR);
                l_conv_date         := to_safe_date(rec.CONVERSION_RATE_DATE_STR);
                l_creation_ts       := to_safe_ts(rec.CREATION_DATE_STR);
                l_last_update_ts    := to_safe_ts(rec.LAST_UPDATE_DATE_STR);

                -- Determine insert vs update for accurate counters
                SELECT COUNT(1) INTO l_exists
                FROM   RR_AR_CREDITMEMO_HEADERS
                WHERE  CUSTOMER_TRANSACTION_ID = rec.CUSTOMER_TRANSACTION_ID;

                MERGE INTO RR_AR_CREDITMEMO_HEADERS t
                USING (SELECT rec.CUSTOMER_TRANSACTION_ID AS ID FROM DUAL) s
                ON (t.CUSTOMER_TRANSACTION_ID = s.ID)
                WHEN MATCHED THEN UPDATE SET
                    TRANSACTION_NUMBER          = rec.TRANSACTION_NUMBER,
                    DOCUMENT_NUMBER             = rec.DOCUMENT_NUMBER,
                    CROSS_REFERENCE             = rec.CROSS_REFERENCE,
                    CUSTOMER_REFERENCE          = rec.CUSTOMER_REFERENCE,
                    TRANSACTION_DATE            = l_txn_date,
                    ACCOUNTING_DATE             = l_acct_date,
                    BILLING_DATE                = l_billing_date,
                    CUSTOMER_REFERENCE_DATE     = l_cust_ref_date,
                    FREIGHT_SHIP_DATE           = l_freight_ship_date,
                    PURCHASE_ORDER_DATE         = l_po_date,
                    PRINT_DATE                  = l_print_date,
                    CONVERSION_DATE             = l_conv_date,
                    TRANSACTION_TYPE            = rec.TRANSACTION_TYPE,
                    TRANSACTION_SOURCE          = rec.TRANSACTION_SOURCE,
                    CREDIT_MEMO_STATUS          = rec.CREDIT_MEMO_STATUS,
                    CREDIT_MEMO_CURRENCY        = rec.CREDIT_MEMO_CURRENCY,
                    CONVERSION_RATE_TYPE        = rec.CONVERSION_RATE_TYPE,
                    CONVERSION_RATE             = rec.CONVERSION_RATE,
                    ENTERED_AMOUNT              = rec.ENTERED_AMOUNT,
                    TRANSACTION_BALANCE_DUE     = rec.TRANSACTION_BALANCE_DUE,
                    FREIGHT_CREDIT_AMOUNT       = rec.FREIGHT_CREDIT_AMOUNT,
                    CREDIT_REASON               = rec.CREDIT_REASON,
                    BILL_TO_CUSTOMER_NUMBER     = rec.BILL_TO_CUSTOMER_NUMBER,
                    BILL_TO_CUSTOMER_NAME       = rec.BILL_TO_CUSTOMER_NAME,
                    BILL_TO_SITE                = rec.BILL_TO_SITE,
                    BILL_TO_CONTACT             = rec.BILL_TO_CONTACT,
                    SHIP_TO_CUSTOMER_NUMBER     = rec.SHIP_TO_CUSTOMER_NUMBER,
                    SHIP_TO_CUSTOMER_NAME       = rec.SHIP_TO_CUSTOMER_NAME,
                    SHIP_TO_CUSTOMER_SITE       = rec.SHIP_TO_CUSTOMER_SITE,
                    SHIP_TO_CONTACT             = rec.SHIP_TO_CONTACT,
                    PAYING_CUSTOMER_NAME        = rec.PAYING_CUSTOMER_NAME,
                    PAYING_CUSTOMER_SITE        = rec.PAYING_CUSTOMER_SITE,
                    PAYING_CUSTOMER_ACCOUNT     = rec.PAYING_CUSTOMER_ACCOUNT,
                    SOLD_TO_PARTY_NUMBER        = rec.SOLD_TO_PARTY_NUMBER,
                    BUSINESS_UNIT               = rec.BUSINESS_UNIT,
                    LEGAL_ENTITY_IDENTIFIER     = rec.LEGAL_ENTITY_IDENTIFIER,
                    PURCHASE_ORDER              = rec.PURCHASE_ORDER,
                    PURCHASE_ORDER_REVISION     = rec.PURCHASE_ORDER_REVISION,
                    CARRIER                     = rec.CARRIER,
                    SHIPPING_REFERENCE          = rec.SHIPPING_REFERENCE,
                    FREIGHT_FOB                 = rec.FREIGHT_FOB,
                    DEFAULT_TAXATION_COUNTRY    = rec.DEFAULT_TAXATION_COUNTRY,
                    FIRST_PARTY_REG_NUMBER      = rec.FIRST_PARTY_REG_NUMBER,
                    THIRD_PARTY_REG_NUMBER      = rec.THIRD_PARTY_REG_NUMBER,
                    INTERCOMPANY                = rec.INTERCOMPANY,
                    GENERATE_BILL               = rec.GENERATE_BILL,
                    ALLOW_COMPLETION            = rec.ALLOW_COMPLETION,
                    CONTROL_COMPLETION_REASON   = rec.CONTROL_COMPLETION_REASON,
                    DOCUMENT_FISCAL_CLASSIFICATION = rec.DOC_FISCAL_CLASSIFICATION,
                    STRUCTURED_PAYMENT_REFERENCE = rec.STRUCTURED_PAYMENT_REF,
                    PRINT_STATUS                = rec.PRINT_STATUS,
                    DELIVERY_METHOD             = rec.DELIVERY_METHOD,
                    PRIMARY_SALESPERSON         = rec.PRIMARY_SALESPERSON,
                    SPECIAL_INSTRUCTIONS        = rec.SPECIAL_INSTRUCTIONS,
                    CREDIT_MEMO_COMMENTS        = rec.CREDIT_MEMO_COMMENTS,
                    INTERNAL_NOTES              = rec.INTERNAL_NOTES,
                    EMAIL                       = rec.EMAIL,
                    FUSION_CREATED_BY           = rec.CREATED_BY_STR,
                    FUSION_CREATION_DATE        = l_creation_ts,
                    FUSION_LAST_UPDATED_BY      = rec.LAST_UPDATED_BY_STR,
                    FUSION_LAST_UPDATE_DATE     = l_last_update_ts,
                    SYNC_DATE                   = SYSTIMESTAMP,
                    SYNC_STATUS                 = 'SYNCED',
                    ERROR_MESSAGE               = NULL
                WHEN NOT MATCHED THEN INSERT (
                    CUSTOMER_TRANSACTION_ID,
                    TRANSACTION_NUMBER, DOCUMENT_NUMBER, CROSS_REFERENCE, CUSTOMER_REFERENCE,
                    TRANSACTION_DATE, ACCOUNTING_DATE, BILLING_DATE, CUSTOMER_REFERENCE_DATE,
                    FREIGHT_SHIP_DATE, PURCHASE_ORDER_DATE, PRINT_DATE, CONVERSION_DATE,
                    TRANSACTION_TYPE, TRANSACTION_SOURCE, CREDIT_MEMO_STATUS,
                    CREDIT_MEMO_CURRENCY, CONVERSION_RATE_TYPE, CONVERSION_RATE,
                    ENTERED_AMOUNT, TRANSACTION_BALANCE_DUE, FREIGHT_CREDIT_AMOUNT, CREDIT_REASON,
                    BILL_TO_CUSTOMER_NUMBER, BILL_TO_CUSTOMER_NAME, BILL_TO_SITE, BILL_TO_CONTACT,
                    SHIP_TO_CUSTOMER_NUMBER, SHIP_TO_CUSTOMER_NAME, SHIP_TO_CUSTOMER_SITE, SHIP_TO_CONTACT,
                    PAYING_CUSTOMER_NAME, PAYING_CUSTOMER_SITE, PAYING_CUSTOMER_ACCOUNT,
                    SOLD_TO_PARTY_NUMBER, BUSINESS_UNIT, LEGAL_ENTITY_IDENTIFIER,
                    PURCHASE_ORDER, PURCHASE_ORDER_REVISION,
                    CARRIER, SHIPPING_REFERENCE, FREIGHT_FOB,
                    DEFAULT_TAXATION_COUNTRY, FIRST_PARTY_REG_NUMBER, THIRD_PARTY_REG_NUMBER,
                    INTERCOMPANY, GENERATE_BILL, ALLOW_COMPLETION, CONTROL_COMPLETION_REASON,
                    DOCUMENT_FISCAL_CLASSIFICATION, STRUCTURED_PAYMENT_REFERENCE,
                    PRINT_STATUS, DELIVERY_METHOD, PRIMARY_SALESPERSON,
                    SPECIAL_INSTRUCTIONS, CREDIT_MEMO_COMMENTS, INTERNAL_NOTES, EMAIL,
                    FUSION_CREATED_BY, FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY, FUSION_LAST_UPDATE_DATE,
                    SYNC_DATE, SYNC_STATUS
                ) VALUES (
                    rec.CUSTOMER_TRANSACTION_ID,
                    rec.TRANSACTION_NUMBER, rec.DOCUMENT_NUMBER, rec.CROSS_REFERENCE, rec.CUSTOMER_REFERENCE,
                    l_txn_date, l_acct_date, l_billing_date, l_cust_ref_date,
                    l_freight_ship_date, l_po_date, l_print_date, l_conv_date,
                    rec.TRANSACTION_TYPE, rec.TRANSACTION_SOURCE, rec.CREDIT_MEMO_STATUS,
                    rec.CREDIT_MEMO_CURRENCY, rec.CONVERSION_RATE_TYPE, rec.CONVERSION_RATE,
                    rec.ENTERED_AMOUNT, rec.TRANSACTION_BALANCE_DUE, rec.FREIGHT_CREDIT_AMOUNT, rec.CREDIT_REASON,
                    rec.BILL_TO_CUSTOMER_NUMBER, rec.BILL_TO_CUSTOMER_NAME, rec.BILL_TO_SITE, rec.BILL_TO_CONTACT,
                    rec.SHIP_TO_CUSTOMER_NUMBER, rec.SHIP_TO_CUSTOMER_NAME, rec.SHIP_TO_CUSTOMER_SITE, rec.SHIP_TO_CONTACT,
                    rec.PAYING_CUSTOMER_NAME, rec.PAYING_CUSTOMER_SITE, rec.PAYING_CUSTOMER_ACCOUNT,
                    rec.SOLD_TO_PARTY_NUMBER, rec.BUSINESS_UNIT, rec.LEGAL_ENTITY_IDENTIFIER,
                    rec.PURCHASE_ORDER, rec.PURCHASE_ORDER_REVISION,
                    rec.CARRIER, rec.SHIPPING_REFERENCE, rec.FREIGHT_FOB,
                    rec.DEFAULT_TAXATION_COUNTRY, rec.FIRST_PARTY_REG_NUMBER, rec.THIRD_PARTY_REG_NUMBER,
                    rec.INTERCOMPANY, rec.GENERATE_BILL, rec.ALLOW_COMPLETION, rec.CONTROL_COMPLETION_REASON,
                    rec.DOC_FISCAL_CLASSIFICATION, rec.STRUCTURED_PAYMENT_REF,
                    rec.PRINT_STATUS, rec.DELIVERY_METHOD, rec.PRIMARY_SALESPERSON,
                    rec.SPECIAL_INSTRUCTIONS, rec.CREDIT_MEMO_COMMENTS, rec.INTERNAL_NOTES, rec.EMAIL,
                    rec.CREATED_BY_STR, l_creation_ts,
                    rec.LAST_UPDATED_BY_STR, l_last_update_ts,
                    SYSTIMESTAMP, 'SYNCED'
                );

                IF l_exists = 0 THEN
                    p_inserted := p_inserted + 1;
                ELSE
                    p_updated  := p_updated  + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    -- Capture SQLERRM into a variable before using it in SQL
                    l_err_msg := SUBSTR(SQLERRM, 1, 4000);
                    p_errors  := p_errors + 1;
                    l_err_log := SUBSTR(l_err_msg, 1, 200);
                    BEGIN
                        UPDATE RR_AR_CREDITMEMO_HEADERS
                        SET    SYNC_STATUS   = 'ERROR',
                               ERROR_MESSAGE = l_err_msg,
                               SYNC_DATE     = SYSTIMESTAMP
                        WHERE  CUSTOMER_TRANSACTION_ID = rec.CUSTOMER_TRANSACTION_ID;
                    EXCEPTION WHEN OTHERS THEN NULL;
                    END;
            END;
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Processed. Errors: ' || p_errors
                  || CASE WHEN l_err_log IS NOT NULL THEN ' Last: ' || l_err_log ELSE '' END;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
            p_errors  := NVL(p_errors, 0) + 1;
    END save_creditmemos_bulk;

    -- -------------------------------------------------------
    -- save_creditmemo_lines: {"items":[...]}
    -- Upserts lines for a single credit memo header.
    -- All dates pre-computed into PL/SQL vars before MERGE.
    -- -------------------------------------------------------
    PROCEDURE save_creditmemo_lines (
        p_transaction_id IN  NUMBER,
        p_lines_json     IN  CLOB,
        p_status         OUT VARCHAR2,
        p_message        OUT VARCHAR2
    ) IS
        l_inserted  NUMBER := 0;
        l_errors    NUMBER := 0;
        l_err_log   VARCHAR2(4000) := '';
        l_err_msg   VARCHAR2(4000);

        l_so_date       DATE;
        l_tax_inv_date  DATE;
        l_creation_ts   TIMESTAMP;
        l_last_upd_ts   TIMESTAMP;
    BEGIN
        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_lines_json, '$.items[*]' COLUMNS (
                CUSTOMER_TRANSACTION_LINE_ID    NUMBER          PATH '$.CustomerTransactionLineId',
                LINE_NUMBER                     NUMBER          PATH '$.LineNumber',
                LINE_DESCRIPTION                VARCHAR2(4000)  PATH '$.LineDescription',
                LINE_TRANSLATED_DESCRIPTION     VARCHAR2(4000)  PATH '$.LineTranslatedDescription',
                ITEM_NUMBER                     VARCHAR2(100)   PATH '$.ItemNumber',
                UNIT_OF_MEASURE                 VARCHAR2(50)    PATH '$.UnitOfMeasure',
                WAREHOUSE                       VARCHAR2(100)   PATH '$.Warehouse',
                MEMO_LINE                       VARCHAR2(240)   PATH '$.MemoLine',
                LINE_QUANTITY_CREDIT            NUMBER          PATH '$.LineQuantityCredit',
                UNIT_SELLING_PRICE              NUMBER          PATH '$.UnitSellingPrice',
                LINE_AMOUNT_CREDIT              NUMBER          PATH '$.LineAmountCredit',
                ASSESSABLE_VALUE                NUMBER          PATH '$.TransactionLineAssessableValue',
                LINE_FREIGHT_CREDIT_AMOUNT      NUMBER          PATH '$.LineFreightCreditAmount',
                LINE_CREDIT_REASON              VARCHAR2(240)   PATH '$.LineCreditReason',
                SALES_ORDER_NUMBER              VARCHAR2(50)    PATH '$.SalesOrderNumber',
                SALES_ORDER_DATE_STR            VARCHAR2(30)    PATH '$.SalesOrderDate',
                SALES_ORDER_LINE                VARCHAR2(50)    PATH '$.SalesOrderLine',
                SALES_ORDER_REVISION            VARCHAR2(50)    PATH '$.SalesOrderRevision',
                SALES_ORDER_CHANNEL             VARCHAR2(50)    PATH '$.SalesOrderChannel',
                TAX_INVOICE_NUMBER              VARCHAR2(50)    PATH '$.TaxInvoiceNumber',
                TAX_INVOICE_DATE_STR            VARCHAR2(30)    PATH '$.TaxInvoiceDate',
                TAX_CLASSIFICATION_CODE         VARCHAR2(100)   PATH '$.TaxClassificationCode',
                LINE_TAX_EXEMPTION_HANDLING     VARCHAR2(50)    PATH '$.LineTaxExemptionHandling',
                LINE_AMOUNT_INCLUDES_TAX        VARCHAR2(50)    PATH '$.LineAmountIncludesTax',
                TAX_EXEMPTION_REASON            VARCHAR2(100)   PATH '$.TaxExemptionReason',
                TAX_EXEMPTION_CERT_NUMBER       VARCHAR2(100)   PATH '$.TaxExemptionCertificateNumber',
                TRANSACTION_BUSINESS_CATEGORY   VARCHAR2(100)   PATH '$.TransactionBusinessCategory',
                PRODUCT_FISCAL_CLASSIFICATION   VARCHAR2(100)   PATH '$.ProductFiscalClassification',
                PRODUCT_CATEGORY                VARCHAR2(100)   PATH '$.LineProductCategory',
                PRODUCT_TYPE                    VARCHAR2(50)    PATH '$.LineProductType',
                LINE_INTENDED_USE               VARCHAR2(100)   PATH '$.LineIntendedUse',
                USER_DEFINED_FISCAL_CLASS       VARCHAR2(100)   PATH '$.UserDefinedFiscalClassification',
                FUSION_CREATED_BY               VARCHAR2(240)   PATH '$.CreatedBy',
                CREATION_DATE_STR               VARCHAR2(50)    PATH '$.CreationDate',
                FUSION_LAST_UPDATED_BY          VARCHAR2(240)   PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE_STR            VARCHAR2(50)    PATH '$.LastUpdateDate'
            )) j
        ) LOOP
            BEGIN
                l_so_date      := to_safe_date(rec.SALES_ORDER_DATE_STR);
                l_tax_inv_date := to_safe_date(rec.TAX_INVOICE_DATE_STR);
                l_creation_ts  := to_safe_ts(rec.CREATION_DATE_STR);
                l_last_upd_ts  := to_safe_ts(rec.LAST_UPDATE_DATE_STR);

                MERGE INTO RR_AR_CREDITMEMO_LINES t
                USING (SELECT rec.CUSTOMER_TRANSACTION_LINE_ID AS ID FROM DUAL) s
                ON (t.CUSTOMER_TRANSACTION_LINE_ID = s.ID)
                WHEN MATCHED THEN UPDATE SET
                    CUSTOMER_TRANSACTION_ID     = p_transaction_id,
                    LINE_NUMBER                 = rec.LINE_NUMBER,
                    LINE_DESCRIPTION            = rec.LINE_DESCRIPTION,
                    LINE_TRANSLATED_DESCRIPTION = rec.LINE_TRANSLATED_DESCRIPTION,
                    ITEM_NUMBER                 = rec.ITEM_NUMBER,
                    UNIT_OF_MEASURE             = rec.UNIT_OF_MEASURE,
                    WAREHOUSE                   = rec.WAREHOUSE,
                    MEMO_LINE                   = rec.MEMO_LINE,
                    LINE_QUANTITY_CREDIT        = rec.LINE_QUANTITY_CREDIT,
                    UNIT_SELLING_PRICE          = rec.UNIT_SELLING_PRICE,
                    LINE_AMOUNT_CREDIT          = rec.LINE_AMOUNT_CREDIT,
                    ASSESSABLE_VALUE            = rec.ASSESSABLE_VALUE,
                    LINE_FREIGHT_CREDIT_AMOUNT  = rec.LINE_FREIGHT_CREDIT_AMOUNT,
                    LINE_CREDIT_REASON          = rec.LINE_CREDIT_REASON,
                    SALES_ORDER_NUMBER          = rec.SALES_ORDER_NUMBER,
                    SALES_ORDER_DATE            = l_so_date,
                    SALES_ORDER_LINE            = rec.SALES_ORDER_LINE,
                    SALES_ORDER_REVISION        = rec.SALES_ORDER_REVISION,
                    SALES_ORDER_CHANNEL         = rec.SALES_ORDER_CHANNEL,
                    TAX_INVOICE_NUMBER          = rec.TAX_INVOICE_NUMBER,
                    TAX_INVOICE_DATE            = l_tax_inv_date,
                    TAX_CLASSIFICATION_CODE     = rec.TAX_CLASSIFICATION_CODE,
                    LINE_TAX_EXEMPTION_HANDLING = rec.LINE_TAX_EXEMPTION_HANDLING,
                    LINE_AMOUNT_INCLUDES_TAX    = rec.LINE_AMOUNT_INCLUDES_TAX,
                    TAX_EXEMPTION_REASON        = rec.TAX_EXEMPTION_REASON,
                    TAX_EXEMPTION_CERT_NUMBER   = rec.TAX_EXEMPTION_CERT_NUMBER,
                    TRANSACTION_BUSINESS_CATEGORY = rec.TRANSACTION_BUSINESS_CATEGORY,
                    PRODUCT_FISCAL_CLASSIFICATION = rec.PRODUCT_FISCAL_CLASSIFICATION,
                    PRODUCT_CATEGORY            = rec.PRODUCT_CATEGORY,
                    PRODUCT_TYPE                = rec.PRODUCT_TYPE,
                    LINE_INTENDED_USE           = rec.LINE_INTENDED_USE,
                    USER_DEFINED_FISCAL_CLASS   = rec.USER_DEFINED_FISCAL_CLASS,
                    FUSION_CREATED_BY           = rec.FUSION_CREATED_BY,
                    FUSION_CREATION_DATE        = l_creation_ts,
                    FUSION_LAST_UPDATED_BY      = rec.FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE     = l_last_upd_ts,
                    SYNC_DATE                   = SYSTIMESTAMP,
                    SYNC_STATUS                 = 'SYNCED',
                    ERROR_MESSAGE               = NULL
                WHEN NOT MATCHED THEN INSERT (
                    CUSTOMER_TRANSACTION_LINE_ID, CUSTOMER_TRANSACTION_ID,
                    LINE_NUMBER, LINE_DESCRIPTION, LINE_TRANSLATED_DESCRIPTION,
                    ITEM_NUMBER, UNIT_OF_MEASURE, WAREHOUSE, MEMO_LINE,
                    LINE_QUANTITY_CREDIT, UNIT_SELLING_PRICE, LINE_AMOUNT_CREDIT,
                    ASSESSABLE_VALUE, LINE_FREIGHT_CREDIT_AMOUNT, LINE_CREDIT_REASON,
                    SALES_ORDER_NUMBER, SALES_ORDER_DATE, SALES_ORDER_LINE,
                    SALES_ORDER_REVISION, SALES_ORDER_CHANNEL,
                    TAX_INVOICE_NUMBER, TAX_INVOICE_DATE,
                    TAX_CLASSIFICATION_CODE, LINE_TAX_EXEMPTION_HANDLING,
                    LINE_AMOUNT_INCLUDES_TAX, TAX_EXEMPTION_REASON, TAX_EXEMPTION_CERT_NUMBER,
                    TRANSACTION_BUSINESS_CATEGORY, PRODUCT_FISCAL_CLASSIFICATION,
                    PRODUCT_CATEGORY, PRODUCT_TYPE, LINE_INTENDED_USE,
                    USER_DEFINED_FISCAL_CLASS,
                    FUSION_CREATED_BY, FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY, FUSION_LAST_UPDATE_DATE,
                    SYNC_DATE, SYNC_STATUS
                ) VALUES (
                    rec.CUSTOMER_TRANSACTION_LINE_ID, p_transaction_id,
                    rec.LINE_NUMBER, rec.LINE_DESCRIPTION, rec.LINE_TRANSLATED_DESCRIPTION,
                    rec.ITEM_NUMBER, rec.UNIT_OF_MEASURE, rec.WAREHOUSE, rec.MEMO_LINE,
                    rec.LINE_QUANTITY_CREDIT, rec.UNIT_SELLING_PRICE, rec.LINE_AMOUNT_CREDIT,
                    rec.ASSESSABLE_VALUE, rec.LINE_FREIGHT_CREDIT_AMOUNT, rec.LINE_CREDIT_REASON,
                    rec.SALES_ORDER_NUMBER, l_so_date, rec.SALES_ORDER_LINE,
                    rec.SALES_ORDER_REVISION, rec.SALES_ORDER_CHANNEL,
                    rec.TAX_INVOICE_NUMBER, l_tax_inv_date,
                    rec.TAX_CLASSIFICATION_CODE, rec.LINE_TAX_EXEMPTION_HANDLING,
                    rec.LINE_AMOUNT_INCLUDES_TAX, rec.TAX_EXEMPTION_REASON, rec.TAX_EXEMPTION_CERT_NUMBER,
                    rec.TRANSACTION_BUSINESS_CATEGORY, rec.PRODUCT_FISCAL_CLASSIFICATION,
                    rec.PRODUCT_CATEGORY, rec.PRODUCT_TYPE, rec.LINE_INTENDED_USE,
                    rec.USER_DEFINED_FISCAL_CLASS,
                    rec.FUSION_CREATED_BY, l_creation_ts,
                    rec.FUSION_LAST_UPDATED_BY, l_last_upd_ts,
                    SYSTIMESTAMP, 'SYNCED'
                );

                l_inserted := l_inserted + 1;

            EXCEPTION
                WHEN OTHERS THEN
                    l_err_msg := SUBSTR(SQLERRM, 1, 4000);
                    l_errors  := l_errors + 1;
                    l_err_log := SUBSTR(l_err_msg, 1, 200);
            END;
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := l_inserted || ' lines processed. Errors: ' || l_errors
                  || CASE WHEN l_err_log IS NOT NULL THEN ' Last: ' || l_err_log ELSE '' END;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_creditmemo_lines;

    -- -------------------------------------------------------
    -- save_creditmemo_distributions: {"items":[...]}
    -- Upserts distributions for a single credit memo header.
    -- Timestamps pre-computed before MERGE (PLS-00231 fix).
    -- -------------------------------------------------------
    PROCEDURE save_creditmemo_distributions (
        p_transaction_id     IN  NUMBER,
        p_distributions_json IN  CLOB,
        p_status             OUT VARCHAR2,
        p_message            OUT VARCHAR2
    ) IS
        l_inserted    NUMBER := 0;
        l_errors      NUMBER := 0;
        l_err_log     VARCHAR2(4000) := '';
        l_err_msg     VARCHAR2(4000);
        l_creation_ts TIMESTAMP;
        l_last_upd_ts TIMESTAMP;
    BEGIN
        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_distributions_json, '$.items[*]' COLUMNS (
                DISTRIBUTION_ID             NUMBER          PATH '$.DistributionId',
                CREDIT_MEMO_LINE_NUMBER     NUMBER          PATH '$.CreditMemoLineNumber',
                DETAILED_TAX_LINE_NUMBER    NUMBER          PATH '$.DetailedTaxLineNumber',
                ACCOUNT_CLASS               VARCHAR2(100)   PATH '$.AccountClass',
                ACCOUNT_COMBINATION         VARCHAR2(240)   PATH '$.AccountCombination',
                AMOUNT                      NUMBER          PATH '$.Amount',
                ACCOUNTED_AMOUNT            NUMBER          PATH '$.AccountedAmount',
                PERCENT                     NUMBER          PATH '$.Percent',
                COMMENTS                    VARCHAR2(4000)  PATH '$.Comments',
                FUSION_CREATED_BY           VARCHAR2(240)   PATH '$.CreatedBy',
                CREATION_DATE_STR           VARCHAR2(50)    PATH '$.CreationDate',
                FUSION_LAST_UPDATED_BY      VARCHAR2(240)   PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE_STR        VARCHAR2(50)    PATH '$.LastUpdateDate'
            )) j
        ) LOOP
            BEGIN
                l_creation_ts := to_safe_ts(rec.CREATION_DATE_STR);
                l_last_upd_ts := to_safe_ts(rec.LAST_UPDATE_DATE_STR);

                MERGE INTO RR_AR_CREDITMEMO_DISTRIBUTIONS t
                USING (SELECT rec.DISTRIBUTION_ID AS ID FROM DUAL) s
                ON (t.DISTRIBUTION_ID = s.ID)
                WHEN MATCHED THEN UPDATE SET
                    CUSTOMER_TRANSACTION_ID     = p_transaction_id,
                    CREDIT_MEMO_LINE_NUMBER     = rec.CREDIT_MEMO_LINE_NUMBER,
                    DETAILED_TAX_LINE_NUMBER    = rec.DETAILED_TAX_LINE_NUMBER,
                    ACCOUNT_CLASS               = rec.ACCOUNT_CLASS,
                    ACCOUNT_COMBINATION         = rec.ACCOUNT_COMBINATION,
                    AMOUNT                      = rec.AMOUNT,
                    ACCOUNTED_AMOUNT            = rec.ACCOUNTED_AMOUNT,
                    PERCENT                     = rec.PERCENT,
                    COMMENTS                    = rec.COMMENTS,
                    FUSION_CREATED_BY           = rec.FUSION_CREATED_BY,
                    FUSION_CREATION_DATE        = l_creation_ts,
                    FUSION_LAST_UPDATED_BY      = rec.FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE     = l_last_upd_ts,
                    SYNC_DATE                   = SYSTIMESTAMP,
                    SYNC_STATUS                 = 'SYNCED',
                    ERROR_MESSAGE               = NULL
                WHEN NOT MATCHED THEN INSERT (
                    DISTRIBUTION_ID, CUSTOMER_TRANSACTION_ID,
                    CREDIT_MEMO_LINE_NUMBER, DETAILED_TAX_LINE_NUMBER,
                    ACCOUNT_CLASS, ACCOUNT_COMBINATION,
                    AMOUNT, ACCOUNTED_AMOUNT, PERCENT, COMMENTS,
                    FUSION_CREATED_BY, FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY, FUSION_LAST_UPDATE_DATE,
                    SYNC_DATE, SYNC_STATUS
                ) VALUES (
                    rec.DISTRIBUTION_ID, p_transaction_id,
                    rec.CREDIT_MEMO_LINE_NUMBER, rec.DETAILED_TAX_LINE_NUMBER,
                    rec.ACCOUNT_CLASS, rec.ACCOUNT_COMBINATION,
                    rec.AMOUNT, rec.ACCOUNTED_AMOUNT, rec.PERCENT, rec.COMMENTS,
                    rec.FUSION_CREATED_BY, l_creation_ts,
                    rec.FUSION_LAST_UPDATED_BY, l_last_upd_ts,
                    SYSTIMESTAMP, 'SYNCED'
                );

                l_inserted := l_inserted + 1;

            EXCEPTION
                WHEN OTHERS THEN
                    l_err_msg := SUBSTR(SQLERRM, 1, 4000);
                    l_errors  := l_errors + 1;
                    l_err_log := SUBSTR(l_err_msg, 1, 200);
            END;
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := l_inserted || ' distributions processed. Errors: ' || l_errors
                  || CASE WHEN l_err_log IS NOT NULL THEN ' Last: ' || l_err_log ELSE '' END;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_creditmemo_distributions;

END RR_AR_CREDITMEMO_PKG;
/
