-- =====================================================
-- AP Invoice Lines Package
-- =====================================================
-- Created: 2024
-- Description: Package to save AP Invoice Lines from JSON
-- =====================================================

CREATE OR REPLACE PACKAGE XXAP_INVOICE_LINES_PKG AS

    -- Save a single invoice line from JSON
    PROCEDURE save_invoice_line(
        p_invoice_id    IN NUMBER,
        p_line_json     IN CLOB,
        p_line_id       OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_error_message OUT VARCHAR2
    );

    -- Save multiple invoice lines from JSON array
    PROCEDURE save_invoice_lines_bulk(
        p_invoice_id    IN NUMBER,
        p_lines_json    IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

    -- Save lines from items array format
    PROCEDURE save_lines_from_items(
        p_json          IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    );

END XXAP_INVOICE_LINES_PKG;
/

CREATE OR REPLACE PACKAGE BODY XXAP_INVOICE_LINES_PKG AS

    -- =========================================
    -- Save a single invoice line from JSON
    -- =========================================
    PROCEDURE save_invoice_line(
        p_invoice_id    IN NUMBER,
        p_line_json     IN CLOB,
        p_line_id       OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_error_message OUT VARCHAR2
    ) IS
        l_line_number                   NUMBER;
        l_fusion_creation_date          TIMESTAMP;
        l_fusion_last_update_date       TIMESTAMP;
        l_existing_line_id              NUMBER;
    BEGIN
        p_status := 'SUCCESS';
        p_error_message := NULL;

        -- Extract line number for duplicate check
        l_line_number := JSON_VALUE(p_line_json, '$.LineNumber' RETURNING NUMBER);

        -- Parse timestamps (strip timezone)
        BEGIN
            l_fusion_creation_date := TO_TIMESTAMP(
                REGEXP_REPLACE(JSON_VALUE(p_line_json, '$.CreationDate'), '[+-]\d{2}:\d{2}$', ''),
                'YYYY-MM-DD"T"HH24:MI:SS'
            );
        EXCEPTION
            WHEN OTHERS THEN l_fusion_creation_date := NULL;
        END;

        BEGIN
            l_fusion_last_update_date := TO_TIMESTAMP(
                REGEXP_REPLACE(JSON_VALUE(p_line_json, '$.LastUpdateDate'), '[+-]\d{2}:\d{2}$', ''),
                'YYYY-MM-DD"T"HH24:MI:SS'
            );
        EXCEPTION
            WHEN OTHERS THEN l_fusion_last_update_date := NULL;
        END;

        -- Check if line already exists
        BEGIN
            SELECT LINE_ID INTO l_existing_line_id
            FROM XXAP_INVOICE_LINES_STG
            WHERE INVOICE_ID = p_invoice_id
              AND LINE_NUMBER = l_line_number;

            -- Update existing line
            UPDATE XXAP_INVOICE_LINES_STG SET
                INVOICE_NUMBER                  = JSON_VALUE(p_line_json, '$.InvoiceNumber'),
                LINE_TYPE                       = JSON_VALUE(p_line_json, '$.LineType'),
                LINE_SOURCE                     = JSON_VALUE(p_line_json, '$.LineSource'),
                LINE_AMOUNT                     = JSON_VALUE(p_line_json, '$.LineAmount' RETURNING NUMBER),
                BASE_AMOUNT                     = JSON_VALUE(p_line_json, '$.BaseAmount' RETURNING NUMBER),
                UNIT_PRICE                      = JSON_VALUE(p_line_json, '$.UnitPrice' RETURNING NUMBER),
                QUANTITY                        = JSON_VALUE(p_line_json, '$.Quantity' RETURNING NUMBER),
                ASSESSABLE_VALUE                = JSON_VALUE(p_line_json, '$.AssessableValue' RETURNING NUMBER),
                TAX_CONTROL_AMOUNT              = JSON_VALUE(p_line_json, '$.TaxControlAmount' RETURNING NUMBER),
                ACCOUNTING_DATE                 = TO_DATE(JSON_VALUE(p_line_json, '$.AccountingDate'), 'YYYY-MM-DD'),
                BUDGET_DATE                     = TO_DATE(JSON_VALUE(p_line_json, '$.BudgetDate'), 'YYYY-MM-DD'),
                MULTIPERIOD_START_DATE          = TO_DATE(JSON_VALUE(p_line_json, '$.MultiperiodAccountingStartDate'), 'YYYY-MM-DD'),
                MULTIPERIOD_END_DATE            = TO_DATE(JSON_VALUE(p_line_json, '$.MultiperiodAccountingEndDate'), 'YYYY-MM-DD'),
                DESCRIPTION                     = JSON_VALUE(p_line_json, '$.Description' RETURNING VARCHAR2(4000)),
                ITEM                            = JSON_VALUE(p_line_json, '$.Item'),
                ITEM_DESCRIPTION                = JSON_VALUE(p_line_json, '$.ItemDescription' RETURNING VARCHAR2(4000)),
                UOM                             = JSON_VALUE(p_line_json, '$.UOM'),
                DISTRIBUTION_COMBINATION        = JSON_VALUE(p_line_json, '$.DistributionCombination'),
                DISTRIBUTION_SET                = JSON_VALUE(p_line_json, '$.DistributionSet'),
                GENERATE_DISTRIBUTIONS          = JSON_VALUE(p_line_json, '$.GenerateDistributions'),
                TAX_RATE_NAME                   = JSON_VALUE(p_line_json, '$.TaxRateName'),
                TAX_RATE_CODE                   = JSON_VALUE(p_line_json, '$.TaxRateCode'),
                TAX_RATE                        = JSON_VALUE(p_line_json, '$.TaxRate' RETURNING NUMBER),
                TAX_CLASSIFICATION              = JSON_VALUE(p_line_json, '$.TaxClassification'),
                INCOME_TAX_TYPE                 = JSON_VALUE(p_line_json, '$.IncomeTaxType'),
                INCOME_TAX_REGION               = JSON_VALUE(p_line_json, '$.IncomeTaxRegion'),
                ASSET_BOOK                      = JSON_VALUE(p_line_json, '$.AssetBook'),
                ASSET_CATEGORY                  = JSON_VALUE(p_line_json, '$.AssetCategory'),
                TRACK_AS_ASSET_FLAG             = CASE WHEN JSON_VALUE(p_line_json, '$.TrackAsAssetFlag') = 'true' THEN 'Y' ELSE 'N' END,
                PRORATE_ACROSS_ALL_ITEMS_FLAG   = CASE WHEN JSON_VALUE(p_line_json, '$.ProrateAcrossAllItemsFlag') = 'true' THEN 'Y' ELSE 'N' END,
                LANDED_COST_ENABLED             = JSON_VALUE(p_line_json, '$.LandedCostEnabled'),
                DISCARDED_FLAG                  = CASE WHEN JSON_VALUE(p_line_json, '$.DiscardedFlag') = 'true' THEN 'Y' ELSE 'N' END,
                CANCELED_FLAG                   = CASE WHEN JSON_VALUE(p_line_json, '$.CanceledFlag') = 'true' THEN 'Y' ELSE 'N' END,
                FINAL_MATCH_FLAG                = CASE WHEN JSON_VALUE(p_line_json, '$.FinalMatchFlag') = 'true' THEN 'Y' ELSE 'N' END,
                PREPAYMENT_INCLUDED_FLAG        = JSON_VALUE(p_line_json, '$.PrepaymentIncludedonInvoiceFlag'),
                APPROVAL_STATUS                 = JSON_VALUE(p_line_json, '$.ApprovalStatus'),
                FUNDS_STATUS                    = JSON_VALUE(p_line_json, '$.FundsStatus'),
                MATCH_TYPE                      = JSON_VALUE(p_line_json, '$.MatchType'),
                MATCH_OPTION                    = JSON_VALUE(p_line_json, '$.MatchOption'),
                MATCH_BASIS                     = JSON_VALUE(p_line_json, '$.MatchBasis'),
                PURCHASE_ORDER_NUMBER           = JSON_VALUE(p_line_json, '$.PurchaseOrderNumber'),
                PURCHASE_ORDER_LINE_NUMBER      = JSON_VALUE(p_line_json, '$.PurchaseOrderLineNumber' RETURNING NUMBER),
                PURCHASE_ORDER_SCHEDULE_LINE_NUMBER = JSON_VALUE(p_line_json, '$.PurchaseOrderScheduleLineNumber' RETURNING NUMBER),
                RECEIPT_NUMBER                  = JSON_VALUE(p_line_json, '$.ReceiptNumber'),
                RECEIPT_LINE_NUMBER             = JSON_VALUE(p_line_json, '$.ReceiptLineNumber' RETURNING NUMBER),
                CONSUMPTION_ADVICE_NUMBER       = JSON_VALUE(p_line_json, '$.ConsumptionAdviceNumber'),
                CONSUMPTION_ADVICE_LINE_NUMBER  = JSON_VALUE(p_line_json, '$.ConsumptionAdviceLineNumber' RETURNING NUMBER),
                PREPAYMENT_NUMBER               = JSON_VALUE(p_line_json, '$.PrepaymentNumber'),
                PREPAYMENT_LINE_NUMBER          = JSON_VALUE(p_line_json, '$.PrepaymentLineNumber' RETURNING NUMBER),
                SHIP_TO_LOCATION_CODE           = JSON_VALUE(p_line_json, '$.ShipToLocationCode'),
                SHIP_TO_LOCATION                = JSON_VALUE(p_line_json, '$.ShipToLocation'),
                SHIP_TO_CUSTOMER_LOCATION       = JSON_VALUE(p_line_json, '$.ShipToCustomerLocation'),
                WITHHOLDING                     = JSON_VALUE(p_line_json, '$.Withholding'),
                PRODUCT_TYPE                    = JSON_VALUE(p_line_json, '$.ProductType'),
                PRODUCT_CATEGORY                = JSON_VALUE(p_line_json, '$.ProductCategory'),
                PRODUCT_CATEGORY_CODE_PATH      = JSON_VALUE(p_line_json, '$.ProductCategoryCodePath'),
                PRODUCT_TABLE                   = JSON_VALUE(p_line_json, '$.ProductTable'),
                USER_DEFINED_FISCAL_CLASS       = JSON_VALUE(p_line_json, '$.UserDefinedFiscalClassification'),
                USER_DEFINED_FISCAL_CLASS_CODE  = JSON_VALUE(p_line_json, '$.UserDefinedFiscalClassificationCode'),
                PRODUCT_FISCAL_CLASS            = JSON_VALUE(p_line_json, '$.ProductFiscalClassification'),
                PRODUCT_FISCAL_CLASS_CODE       = JSON_VALUE(p_line_json, '$.ProductFiscalClassificationCode'),
                PRODUCT_FISCAL_CLASS_TYPE       = JSON_VALUE(p_line_json, '$.ProductFiscalClassificationType'),
                TRANSACTION_BUSINESS_CATEGORY   = JSON_VALUE(p_line_json, '$.TransactionBusinessCategory'),
                TRANSACTION_BUSINESS_CAT_CODE_PATH = JSON_VALUE(p_line_json, '$.TransactionBusinessCategoryCodePath'),
                INTENDED_USE                    = JSON_VALUE(p_line_json, '$.IntendedUse'),
                INTENDED_USE_CODE               = JSON_VALUE(p_line_json, '$.IntendedUseCode'),
                REQUESTER                       = JSON_VALUE(p_line_json, '$.Requester'),
                REQUESTER_ID                    = JSON_VALUE(p_line_json, '$.RequesterId' RETURNING NUMBER),
                PURCHASING_CATEGORY             = JSON_VALUE(p_line_json, '$.PurchasingCategory'),
                MULTIPERIOD_ACCRUAL_ACCOUNT     = JSON_VALUE(p_line_json, '$.MultiperiodAccountingAccrualAccount'),
                REFERENCE_KEY_TWO               = JSON_VALUE(p_line_json, '$.ReferenceKeyTwo'),
                FUSION_CREATED_BY               = JSON_VALUE(p_line_json, '$.CreatedBy'),
                FUSION_CREATION_DATE            = l_fusion_creation_date,
                FUSION_LAST_UPDATED_BY          = JSON_VALUE(p_line_json, '$.LastUpdatedBy'),
                FUSION_LAST_UPDATE_DATE         = l_fusion_last_update_date,
                FUSION_LAST_UPDATE_LOGIN        = JSON_VALUE(p_line_json, '$.LastUpdateLogin'),
                LAST_UPDATED_BY                 = USER,
                LAST_UPDATE_DATE                = SYSTIMESTAMP,
                PROCESS_STATUS                  = 'UPDATED'
            WHERE LINE_ID = l_existing_line_id;

            p_line_id := l_existing_line_id;

        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                -- Insert new line
                INSERT INTO XXAP_INVOICE_LINES_STG (
                    INVOICE_ID,
                    INVOICE_NUMBER,
                    LINE_NUMBER,
                    LINE_TYPE,
                    LINE_SOURCE,
                    LINE_AMOUNT,
                    BASE_AMOUNT,
                    UNIT_PRICE,
                    QUANTITY,
                    ASSESSABLE_VALUE,
                    TAX_CONTROL_AMOUNT,
                    ACCOUNTING_DATE,
                    BUDGET_DATE,
                    MULTIPERIOD_START_DATE,
                    MULTIPERIOD_END_DATE,
                    DESCRIPTION,
                    ITEM,
                    ITEM_DESCRIPTION,
                    UOM,
                    DISTRIBUTION_COMBINATION,
                    DISTRIBUTION_SET,
                    GENERATE_DISTRIBUTIONS,
                    TAX_RATE_NAME,
                    TAX_RATE_CODE,
                    TAX_RATE,
                    TAX_CLASSIFICATION,
                    INCOME_TAX_TYPE,
                    INCOME_TAX_REGION,
                    ASSET_BOOK,
                    ASSET_CATEGORY,
                    TRACK_AS_ASSET_FLAG,
                    PRORATE_ACROSS_ALL_ITEMS_FLAG,
                    LANDED_COST_ENABLED,
                    DISCARDED_FLAG,
                    CANCELED_FLAG,
                    FINAL_MATCH_FLAG,
                    PREPAYMENT_INCLUDED_FLAG,
                    APPROVAL_STATUS,
                    FUNDS_STATUS,
                    MATCH_TYPE,
                    MATCH_OPTION,
                    MATCH_BASIS,
                    PURCHASE_ORDER_NUMBER,
                    PURCHASE_ORDER_LINE_NUMBER,
                    PURCHASE_ORDER_SCHEDULE_LINE_NUMBER,
                    RECEIPT_NUMBER,
                    RECEIPT_LINE_NUMBER,
                    CONSUMPTION_ADVICE_NUMBER,
                    CONSUMPTION_ADVICE_LINE_NUMBER,
                    PREPAYMENT_NUMBER,
                    PREPAYMENT_LINE_NUMBER,
                    SHIP_TO_LOCATION_CODE,
                    SHIP_TO_LOCATION,
                    SHIP_TO_CUSTOMER_LOCATION,
                    WITHHOLDING,
                    PRODUCT_TYPE,
                    PRODUCT_CATEGORY,
                    PRODUCT_CATEGORY_CODE_PATH,
                    PRODUCT_TABLE,
                    USER_DEFINED_FISCAL_CLASS,
                    USER_DEFINED_FISCAL_CLASS_CODE,
                    PRODUCT_FISCAL_CLASS,
                    PRODUCT_FISCAL_CLASS_CODE,
                    PRODUCT_FISCAL_CLASS_TYPE,
                    TRANSACTION_BUSINESS_CATEGORY,
                    TRANSACTION_BUSINESS_CAT_CODE_PATH,
                    INTENDED_USE,
                    INTENDED_USE_CODE,
                    REQUESTER,
                    REQUESTER_ID,
                    PURCHASING_CATEGORY,
                    MULTIPERIOD_ACCRUAL_ACCOUNT,
                    REFERENCE_KEY_TWO,
                    FUSION_CREATED_BY,
                    FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE,
                    FUSION_LAST_UPDATE_LOGIN,
                    PROCESS_STATUS
                ) VALUES (
                    p_invoice_id,
                    JSON_VALUE(p_line_json, '$.InvoiceNumber'),
                    l_line_number,
                    JSON_VALUE(p_line_json, '$.LineType'),
                    JSON_VALUE(p_line_json, '$.LineSource'),
                    JSON_VALUE(p_line_json, '$.LineAmount' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.BaseAmount' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.UnitPrice' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.Quantity' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.AssessableValue' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.TaxControlAmount' RETURNING NUMBER),
                    TO_DATE(JSON_VALUE(p_line_json, '$.AccountingDate'), 'YYYY-MM-DD'),
                    TO_DATE(JSON_VALUE(p_line_json, '$.BudgetDate'), 'YYYY-MM-DD'),
                    TO_DATE(JSON_VALUE(p_line_json, '$.MultiperiodAccountingStartDate'), 'YYYY-MM-DD'),
                    TO_DATE(JSON_VALUE(p_line_json, '$.MultiperiodAccountingEndDate'), 'YYYY-MM-DD'),
                    JSON_VALUE(p_line_json, '$.Description' RETURNING VARCHAR2(4000)),
                    JSON_VALUE(p_line_json, '$.Item'),
                    JSON_VALUE(p_line_json, '$.ItemDescription' RETURNING VARCHAR2(4000)),
                    JSON_VALUE(p_line_json, '$.UOM'),
                    JSON_VALUE(p_line_json, '$.DistributionCombination'),
                    JSON_VALUE(p_line_json, '$.DistributionSet'),
                    JSON_VALUE(p_line_json, '$.GenerateDistributions'),
                    JSON_VALUE(p_line_json, '$.TaxRateName'),
                    JSON_VALUE(p_line_json, '$.TaxRateCode'),
                    JSON_VALUE(p_line_json, '$.TaxRate' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.TaxClassification'),
                    JSON_VALUE(p_line_json, '$.IncomeTaxType'),
                    JSON_VALUE(p_line_json, '$.IncomeTaxRegion'),
                    JSON_VALUE(p_line_json, '$.AssetBook'),
                    JSON_VALUE(p_line_json, '$.AssetCategory'),
                    CASE WHEN JSON_VALUE(p_line_json, '$.TrackAsAssetFlag') = 'true' THEN 'Y' ELSE 'N' END,
                    CASE WHEN JSON_VALUE(p_line_json, '$.ProrateAcrossAllItemsFlag') = 'true' THEN 'Y' ELSE 'N' END,
                    JSON_VALUE(p_line_json, '$.LandedCostEnabled'),
                    CASE WHEN JSON_VALUE(p_line_json, '$.DiscardedFlag') = 'true' THEN 'Y' ELSE 'N' END,
                    CASE WHEN JSON_VALUE(p_line_json, '$.CanceledFlag') = 'true' THEN 'Y' ELSE 'N' END,
                    CASE WHEN JSON_VALUE(p_line_json, '$.FinalMatchFlag') = 'true' THEN 'Y' ELSE 'N' END,
                    JSON_VALUE(p_line_json, '$.PrepaymentIncludedonInvoiceFlag'),
                    JSON_VALUE(p_line_json, '$.ApprovalStatus'),
                    JSON_VALUE(p_line_json, '$.FundsStatus'),
                    JSON_VALUE(p_line_json, '$.MatchType'),
                    JSON_VALUE(p_line_json, '$.MatchOption'),
                    JSON_VALUE(p_line_json, '$.MatchBasis'),
                    JSON_VALUE(p_line_json, '$.PurchaseOrderNumber'),
                    JSON_VALUE(p_line_json, '$.PurchaseOrderLineNumber' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.PurchaseOrderScheduleLineNumber' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.ReceiptNumber'),
                    JSON_VALUE(p_line_json, '$.ReceiptLineNumber' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.ConsumptionAdviceNumber'),
                    JSON_VALUE(p_line_json, '$.ConsumptionAdviceLineNumber' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.PrepaymentNumber'),
                    JSON_VALUE(p_line_json, '$.PrepaymentLineNumber' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.ShipToLocationCode'),
                    JSON_VALUE(p_line_json, '$.ShipToLocation'),
                    JSON_VALUE(p_line_json, '$.ShipToCustomerLocation'),
                    JSON_VALUE(p_line_json, '$.Withholding'),
                    JSON_VALUE(p_line_json, '$.ProductType'),
                    JSON_VALUE(p_line_json, '$.ProductCategory'),
                    JSON_VALUE(p_line_json, '$.ProductCategoryCodePath'),
                    JSON_VALUE(p_line_json, '$.ProductTable'),
                    JSON_VALUE(p_line_json, '$.UserDefinedFiscalClassification'),
                    JSON_VALUE(p_line_json, '$.UserDefinedFiscalClassificationCode'),
                    JSON_VALUE(p_line_json, '$.ProductFiscalClassification'),
                    JSON_VALUE(p_line_json, '$.ProductFiscalClassificationCode'),
                    JSON_VALUE(p_line_json, '$.ProductFiscalClassificationType'),
                    JSON_VALUE(p_line_json, '$.TransactionBusinessCategory'),
                    JSON_VALUE(p_line_json, '$.TransactionBusinessCategoryCodePath'),
                    JSON_VALUE(p_line_json, '$.IntendedUse'),
                    JSON_VALUE(p_line_json, '$.IntendedUseCode'),
                    JSON_VALUE(p_line_json, '$.Requester'),
                    JSON_VALUE(p_line_json, '$.RequesterId' RETURNING NUMBER),
                    JSON_VALUE(p_line_json, '$.PurchasingCategory'),
                    JSON_VALUE(p_line_json, '$.MultiperiodAccountingAccrualAccount'),
                    JSON_VALUE(p_line_json, '$.ReferenceKeyTwo'),
                    JSON_VALUE(p_line_json, '$.CreatedBy'),
                    l_fusion_creation_date,
                    JSON_VALUE(p_line_json, '$.LastUpdatedBy'),
                    l_fusion_last_update_date,
                    JSON_VALUE(p_line_json, '$.LastUpdateLogin'),
                    'NEW'
                ) RETURNING LINE_ID INTO p_line_id;
        END;

        COMMIT;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_error_message := SQLERRM;
            ROLLBACK;
    END save_invoice_line;

    -- =========================================
    -- Save multiple invoice lines from JSON array
    -- =========================================
    PROCEDURE save_invoice_lines_bulk(
        p_invoice_id    IN NUMBER,
        p_lines_json    IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) IS
        l_line_json     CLOB;
        l_line_id       NUMBER;
        l_line_status   VARCHAR2(20);
        l_line_error    VARCHAR2(4000);
        l_count         NUMBER;
    BEGIN
        p_success_count := 0;
        p_error_count := 0;

        -- Count items in array
        SELECT COUNT(*) INTO l_count
        FROM JSON_TABLE(p_lines_json, '$[*]' COLUMNS (dummy VARCHAR2(1) PATH '$.LineNumber'));

        -- Process each line
        FOR rec IN (
            SELECT jt.line_json
            FROM JSON_TABLE(p_lines_json, '$[*]'
                COLUMNS (line_json CLOB FORMAT JSON PATH '$')
            ) jt
        ) LOOP
            save_invoice_line(
                p_invoice_id    => p_invoice_id,
                p_line_json     => rec.line_json,
                p_line_id       => l_line_id,
                p_status        => l_line_status,
                p_error_message => l_line_error
            );

            IF l_line_status = 'SUCCESS' THEN
                p_success_count := p_success_count + 1;
            ELSE
                p_error_count := p_error_count + 1;
            END IF;
        END LOOP;

        -- Set overall status
        IF p_error_count = 0 THEN
            p_status := 'SUCCESS';
            p_message := 'All ' || p_success_count || ' lines saved successfully';
        ELSIF p_success_count = 0 THEN
            p_status := 'ERROR';
            p_message := 'All ' || p_error_count || ' lines failed';
        ELSE
            p_status := 'PARTIAL';
            p_message := p_success_count || ' lines saved, ' || p_error_count || ' failed';
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := SQLERRM;
    END save_invoice_lines_bulk;

    -- =========================================
    -- Save lines from items array format
    -- =========================================
    PROCEDURE save_lines_from_items(
        p_json          IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_status        OUT VARCHAR2,
        p_message       OUT VARCHAR2
    ) IS
        l_invoice_id    NUMBER;
        l_line_json     CLOB;
        l_line_id       NUMBER;
        l_line_status   VARCHAR2(20);
        l_line_error    VARCHAR2(4000);
        l_last_error    VARCHAR2(4000);
        l_line_number   NUMBER;
    BEGIN
        p_success_count := 0;
        p_error_count := 0;
        l_last_error := NULL;

        -- Process each item in the items array
        FOR rec IN (
            SELECT jt.invoice_id, jt.line_number, jt.line_json
            FROM JSON_TABLE(p_json, '$.items[*]'
                COLUMNS (
                    invoice_id NUMBER PATH '$.InvoiceId',
                    line_number NUMBER PATH '$.LineNumber',
                    line_json CLOB FORMAT JSON PATH '$'
                )
            ) jt
        ) LOOP
            -- Check if InvoiceId is present
            IF rec.invoice_id IS NULL THEN
                p_error_count := p_error_count + 1;
                l_last_error := 'Line ' || NVL(rec.line_number, 0) || ': InvoiceId is required but missing';
            ELSE
                save_invoice_line(
                    p_invoice_id    => rec.invoice_id,
                    p_line_json     => rec.line_json,
                    p_line_id       => l_line_id,
                    p_status        => l_line_status,
                    p_error_message => l_line_error
                );

                IF l_line_status = 'SUCCESS' THEN
                    p_success_count := p_success_count + 1;
                ELSE
                    p_error_count := p_error_count + 1;
                    l_last_error := 'Line ' || NVL(rec.line_number, 0) || ': ' || l_line_error;
                END IF;
            END IF;
        END LOOP;

        -- Set overall status
        IF p_error_count = 0 THEN
            p_status := 'SUCCESS';
            p_message := 'All ' || p_success_count || ' lines saved successfully';
        ELSIF p_success_count = 0 THEN
            p_status := 'ERROR';
            p_message := 'All ' || p_error_count || ' lines failed. Last error: ' || NVL(l_last_error, 'Unknown');
        ELSE
            p_status := 'PARTIAL';
            p_message := p_success_count || ' lines saved, ' || p_error_count || ' failed. Last error: ' || NVL(l_last_error, 'Unknown');
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := 'Exception: ' || SQLERRM;
    END save_lines_from_items;

END XXAP_INVOICE_LINES_PKG;
/
