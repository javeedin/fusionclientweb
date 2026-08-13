-- =====================================================
-- APEX REST Call to Fetch AP Invoices from Oracle Fusion
-- =====================================================

-- =====================================================
-- 1. Create Web Credentials for Oracle Fusion
-- =====================================================
-- Run this in APEX SQL Workshop or as APEX Admin

BEGIN
    APEX_CREDENTIAL.CREATE_CREDENTIAL (
        p_credential_name       => 'FUSION_AP_CREDENTIALS',
        p_credential_static_id  => 'fusion_ap_credentials',
        p_authentication_type   => APEX_CREDENTIAL.C_TYPE_HTTP_BASIC,
        p_username              => 'your_fusion_username',  -- Replace with actual username
        p_password              => 'your_fusion_password'   -- Replace with actual password
    );
END;
/

-- =====================================================
-- 2. Procedure to Fetch and Save AP Invoices
-- =====================================================
CREATE OR REPLACE PROCEDURE XXAP_FETCH_INVOICES (
    p_business_unit     IN VARCHAR2 DEFAULT NULL,
    p_from_date         IN DATE DEFAULT NULL,
    p_to_date           IN DATE DEFAULT NULL,
    p_limit             IN NUMBER DEFAULT 500,
    p_offset            IN NUMBER DEFAULT 0,
    p_success_count     OUT NUMBER,
    p_error_count       OUT NUMBER,
    p_status            OUT VARCHAR2,
    p_message           OUT VARCHAR2
) AS
    l_rest_url          VARCHAR2(4000);
    l_response          CLOB;
    l_base_url          VARCHAR2(500) := 'https://your-fusion-instance.oraclecloud.com';  -- Replace with actual URL
    l_query_params      VARCHAR2(2000);
    l_has_more          BOOLEAN := TRUE;
    l_current_offset    NUMBER := p_offset;
    l_total_success     NUMBER := 0;
    l_total_error       NUMBER := 0;
    l_batch_success     NUMBER;
    l_batch_error       NUMBER;
    l_batch_status      VARCHAR2(20);
    l_batch_message     VARCHAR2(4000);
BEGIN
    -- Build query parameters
    l_query_params := '?limit=' || p_limit || '&offset=' || l_current_offset;

    IF p_business_unit IS NOT NULL THEN
        l_query_params := l_query_params || '&q=BusinessUnit=' || UTL_URL.ESCAPE(p_business_unit);
    END IF;

    IF p_from_date IS NOT NULL THEN
        l_query_params := l_query_params || '&q=InvoiceDate>=' || TO_CHAR(p_from_date, 'YYYY-MM-DD');
    END IF;

    IF p_to_date IS NOT NULL THEN
        l_query_params := l_query_params || '&q=InvoiceDate<=' || TO_CHAR(p_to_date, 'YYYY-MM-DD');
    END IF;

    -- Build full REST URL
    l_rest_url := l_base_url || '/fscmRestApi/resources/11.13.18.05/invoices' || l_query_params;

    -- Make REST API Call
    l_response := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
        p_url               => l_rest_url,
        p_http_method       => 'GET',
        p_credential_static_id => 'fusion_ap_credentials'
    );

    -- Check HTTP Status
    IF APEX_WEB_SERVICE.G_STATUS_CODE = 200 THEN
        -- Save invoices using bulk procedure
        XXAP_INVOICES_PKG.save_invoices_bulk(
            p_invoices_json => l_response,
            p_success_count => l_batch_success,
            p_error_count   => l_batch_error,
            p_status        => l_batch_status,
            p_message       => l_batch_message
        );

        l_total_success := l_total_success + NVL(l_batch_success, 0);
        l_total_error := l_total_error + NVL(l_batch_error, 0);

        p_success_count := l_total_success;
        p_error_count := l_total_error;
        p_status := 'SUCCESS';
        p_message := 'Fetched and saved ' || l_total_success || ' invoices';
    ELSE
        p_success_count := 0;
        p_error_count := 0;
        p_status := 'ERROR';
        p_message := 'REST API call failed with status: ' || APEX_WEB_SERVICE.G_STATUS_CODE;
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        p_success_count := l_total_success;
        p_error_count := l_total_error;
        p_status := 'ERROR';
        p_message := 'Error fetching invoices: ' || SQLERRM;
END XXAP_FETCH_INVOICES;
/

-- =====================================================
-- 3. Procedure to Fetch All Invoices with Pagination
-- =====================================================
CREATE OR REPLACE PROCEDURE XXAP_FETCH_ALL_INVOICES (
    p_business_unit     IN VARCHAR2 DEFAULT NULL,
    p_from_date         IN DATE DEFAULT NULL,
    p_to_date           IN DATE DEFAULT NULL,
    p_batch_size        IN NUMBER DEFAULT 500,
    p_total_fetched     OUT NUMBER,
    p_total_errors      OUT NUMBER,
    p_status            OUT VARCHAR2,
    p_message           OUT VARCHAR2
) AS
    l_rest_url          VARCHAR2(4000);
    l_response          CLOB;
    l_base_url          VARCHAR2(500) := 'https://your-fusion-instance.oraclecloud.com';  -- Replace
    l_query_params      VARCHAR2(2000);
    l_has_more          BOOLEAN := TRUE;
    l_current_offset    NUMBER := 0;
    l_batch_success     NUMBER;
    l_batch_error       NUMBER;
    l_batch_status      VARCHAR2(20);
    l_batch_message     VARCHAR2(4000);
    l_items_count       NUMBER;
BEGIN
    p_total_fetched := 0;
    p_total_errors := 0;

    -- Loop through all pages
    WHILE l_has_more LOOP
        -- Build query parameters
        l_query_params := '?limit=' || p_batch_size || '&offset=' || l_current_offset;
        l_query_params := l_query_params || '&onlyData=true';
        l_query_params := l_query_params || '&fields=InvoiceId,InvoiceNumber,InvoiceCurrency,PaymentCurrency,InvoiceAmount,InvoiceDate,BusinessUnit,Supplier,SupplierNumber,SupplierSite,Party,PartySite,InvoiceGroup,InvoiceSourceCode,InvoiceSource,InvoiceType,Description,ConversionRateType,ConversionDate,ConversionRate,BaseAmount,AccountingDate,TermsDate,PayGroup,PaymentTerms,PaymentMethodCode,PaymentMethod,PayAloneFlag,AmountPaid,ControlAmount,DeliveryChannelCode,DeliveryChannel,TaxationCountry,LiabilityDistribution,DocumentCategory,DocumentSequence,VoucherNumber,ValidationStatus,ApprovalStatus,PaidStatus,AccountingStatus,AccountCodingStatus,FundsStatus,CanceledFlag,CanceledDate,CanceledBy,BudgetDate,LegalEntity,LegalEntityIdentifier,PurchaseOrderNumber,CreatedBy,CreationDate,LastUpdatedBy,LastUpdateDate,LastUpdateLogin';

        IF p_business_unit IS NOT NULL THEN
            l_query_params := l_query_params || '&q=BusinessUnit=' || UTL_URL.ESCAPE(p_business_unit);
        END IF;

        IF p_from_date IS NOT NULL AND p_to_date IS NOT NULL THEN
            l_query_params := l_query_params || '&q=InvoiceDate>=' || TO_CHAR(p_from_date, 'YYYY-MM-DD')
                           || ';InvoiceDate<=' || TO_CHAR(p_to_date, 'YYYY-MM-DD');
        END IF;

        -- Build full REST URL
        l_rest_url := l_base_url || '/fscmRestApi/resources/11.13.18.05/invoices' || l_query_params;

        -- Log the request (optional)
        DBMS_OUTPUT.PUT_LINE('Fetching offset: ' || l_current_offset);

        -- Make REST API Call
        l_response := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
            p_url               => l_rest_url,
            p_http_method       => 'GET',
            p_credential_static_id => 'fusion_ap_credentials'
        );

        -- Check HTTP Status
        IF APEX_WEB_SERVICE.G_STATUS_CODE = 200 THEN
            -- Get count of items in response
            SELECT COUNT(*)
            INTO l_items_count
            FROM JSON_TABLE(l_response, '$.items[*]' COLUMNS (dummy VARCHAR2(1) PATH '$'));

            IF l_items_count > 0 THEN
                -- Save invoices
                XXAP_INVOICES_PKG.save_invoices_bulk(
                    p_invoices_json => l_response,
                    p_success_count => l_batch_success,
                    p_error_count   => l_batch_error,
                    p_status        => l_batch_status,
                    p_message       => l_batch_message
                );

                p_total_fetched := p_total_fetched + NVL(l_batch_success, 0);
                p_total_errors := p_total_errors + NVL(l_batch_error, 0);

                -- Check if there are more records
                IF l_items_count < p_batch_size THEN
                    l_has_more := FALSE;
                ELSE
                    l_current_offset := l_current_offset + p_batch_size;
                END IF;
            ELSE
                l_has_more := FALSE;
            END IF;
        ELSE
            p_status := 'ERROR';
            p_message := 'REST API failed at offset ' || l_current_offset || ' with status: ' || APEX_WEB_SERVICE.G_STATUS_CODE;
            RETURN;
        END IF;

        -- Add delay to avoid rate limiting (optional)
        DBMS_LOCK.SLEEP(0.5);
    END LOOP;

    p_status := 'SUCCESS';
    p_message := 'Completed. Fetched: ' || p_total_fetched || ', Errors: ' || p_total_errors;

EXCEPTION
    WHEN OTHERS THEN
        p_status := 'ERROR';
        p_message := 'Error at offset ' || l_current_offset || ': ' || SQLERRM;
END XXAP_FETCH_ALL_INVOICES;
/

-- =====================================================
-- 4. APEX Process for Page Button (PL/SQL)
-- =====================================================
/*
Use this code in APEX Page Process when user clicks "Sync Invoices" button:

DECLARE
    l_success_count NUMBER;
    l_error_count   NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
BEGIN
    XXAP_FETCH_ALL_INVOICES(
        p_business_unit => :P_BUSINESS_UNIT,
        p_from_date     => :P_FROM_DATE,
        p_to_date       => :P_TO_DATE,
        p_batch_size    => 500,
        p_total_fetched => l_success_count,
        p_total_errors  => l_error_count,
        p_status        => l_status,
        p_message       => l_message
    );

    :P_SYNC_STATUS := l_status;
    :P_SYNC_MESSAGE := l_message;
    :P_SUCCESS_COUNT := l_success_count;
    :P_ERROR_COUNT := l_error_count;
END;
*/

-- =====================================================
-- 5. APEX REST Data Source Definition (for APEX)
-- =====================================================
/*
To create REST Data Source in APEX:

1. Go to Shared Components > REST Data Sources
2. Click "Create"
3. Select "From Scratch"
4. Configure:
   - Name: Fusion AP Invoices
   - URL Endpoint: https://your-fusion-instance.oraclecloud.com/fscmRestApi/resources/11.13.18.05/invoices
   - Authentication: Credentials (select FUSION_AP_CREDENTIALS)
   - Method: GET

5. Add Parameters:
   - limit (Query String, default 500)
   - offset (Query String, default 0)
   - q (Query String, optional for filtering)
   - onlyData (Query String, default true)

6. Discover and map columns from response
*/

-- =====================================================
-- 6. Alternative: Using APEX_EXEC for REST Call
-- =====================================================
CREATE OR REPLACE PROCEDURE XXAP_FETCH_INVOICES_APEX_EXEC (
    p_from_date         IN DATE DEFAULT NULL,
    p_to_date           IN DATE DEFAULT NULL,
    p_success_count     OUT NUMBER,
    p_status            OUT VARCHAR2,
    p_message           OUT VARCHAR2
) AS
    l_context           APEX_EXEC.T_CONTEXT;
    l_filters           APEX_EXEC.T_FILTERS;
    l_columns           APEX_EXEC.T_COLUMNS;
    l_invoice_json      CLOB;
    l_inv_status        VARCHAR2(20);
    l_inv_message       VARCHAR2(4000);
BEGIN
    p_success_count := 0;

    -- Add date filter if provided
    IF p_from_date IS NOT NULL THEN
        APEX_EXEC.ADD_FILTER(
            p_filters   => l_filters,
            p_filter_type => APEX_EXEC.c_filter_gte,
            p_column_name => 'INVOICE_DATE',
            p_value     => p_from_date
        );
    END IF;

    -- Open REST Source context
    l_context := APEX_EXEC.OPEN_REST_SOURCE_QUERY(
        p_static_id         => 'fusion_ap_invoices',  -- REST Data Source static ID
        p_max_rows          => 10000,
        p_filters           => l_filters
    );

    -- Loop through results
    WHILE APEX_EXEC.NEXT_ROW(l_context) LOOP
        -- Build JSON for each row
        l_invoice_json := '{' ||
            '"InvoiceId":' || APEX_EXEC.GET_NUMBER(l_context, 'INVOICE_ID') || ',' ||
            '"InvoiceNumber":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'INVOICE_NUMBER') || '",' ||
            '"InvoiceCurrency":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'INVOICE_CURRENCY') || '",' ||
            '"InvoiceAmount":' || NVL(TO_CHAR(APEX_EXEC.GET_NUMBER(l_context, 'INVOICE_AMOUNT')), 'null') || ',' ||
            '"InvoiceDate":"' || TO_CHAR(APEX_EXEC.GET_DATE(l_context, 'INVOICE_DATE'), 'YYYY-MM-DD') || '",' ||
            '"BusinessUnit":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'BUSINESS_UNIT') || '",' ||
            '"Supplier":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'SUPPLIER') || '",' ||
            '"SupplierNumber":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'SUPPLIER_NUMBER') || '",' ||
            '"ValidationStatus":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'VALIDATION_STATUS') || '",' ||
            '"ApprovalStatus":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'APPROVAL_STATUS') || '",' ||
            '"PaidStatus":"' || APEX_EXEC.GET_VARCHAR2(l_context, 'PAID_STATUS') || '"' ||
        '}';

        -- Save invoice
        XXAP_INVOICES_PKG.save_invoice(
            p_invoice_json => l_invoice_json,
            p_status       => l_inv_status,
            p_message      => l_inv_message
        );

        IF l_inv_status = 'SUCCESS' THEN
            p_success_count := p_success_count + 1;
        END IF;
    END LOOP;

    -- Close context
    APEX_EXEC.CLOSE(l_context);

    p_status := 'SUCCESS';
    p_message := 'Fetched and saved ' || p_success_count || ' invoices';

EXCEPTION
    WHEN OTHERS THEN
        IF l_context IS NOT NULL THEN
            APEX_EXEC.CLOSE(l_context);
        END IF;
        p_status := 'ERROR';
        p_message := 'Error: ' || SQLERRM;
END XXAP_FETCH_INVOICES_APEX_EXEC;
/

-- =====================================================
-- 7. Scheduler Job to Auto-Sync Invoices
-- =====================================================
BEGIN
    DBMS_SCHEDULER.CREATE_JOB (
        job_name        => 'XXAP_INVOICE_SYNC_JOB',
        job_type        => 'PLSQL_BLOCK',
        job_action      => '
            DECLARE
                l_success NUMBER;
                l_errors  NUMBER;
                l_status  VARCHAR2(20);
                l_message VARCHAR2(4000);
            BEGIN
                XXAP_FETCH_ALL_INVOICES(
                    p_from_date     => TRUNC(SYSDATE) - 7,
                    p_to_date       => TRUNC(SYSDATE),
                    p_batch_size    => 500,
                    p_total_fetched => l_success,
                    p_total_errors  => l_errors,
                    p_status        => l_status,
                    p_message       => l_message
                );
            END;
        ',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=DAILY; BYHOUR=6; BYMINUTE=0',
        enabled         => FALSE,
        comments        => 'Daily sync of AP Invoices from Oracle Fusion'
    );
END;
/

-- Enable the job when ready
-- EXEC DBMS_SCHEDULER.ENABLE('XXAP_INVOICE_SYNC_JOB');

-- =====================================================
-- 8. View for React Frontend
-- =====================================================
CREATE OR REPLACE VIEW XXAP_INVOICES_V AS
SELECT
    invoice_id,
    invoice_number,
    invoice_currency,
    payment_currency,
    invoice_amount,
    invoice_date,
    business_unit,
    legal_entity,
    supplier,
    supplier_number,
    supplier_site,
    party,
    party_site,
    invoice_group,
    invoice_source,
    invoice_type,
    description,
    accounting_date,
    pay_group,
    payment_terms,
    payment_method,
    amount_paid,
    validation_status,
    approval_status,
    paid_status,
    accounting_status,
    canceled_flag,
    CASE
        WHEN canceled_flag = 'Y' THEN 'Canceled'
        WHEN paid_status = 'Paid' THEN 'Paid'
        WHEN validation_status = 'Validated' AND approval_status = 'Approved' THEN 'Ready to Pay'
        WHEN validation_status = 'Validated' THEN 'Validated'
        ELSE 'Pending'
    END AS display_status,
    sync_status,
    sync_date,
    creation_date
FROM XXAP_INVOICES_STG;

-- =====================================================
-- 9. ORDS REST API Endpoint for React
-- =====================================================
/*
To expose the data via ORDS for React frontend:

BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled             => TRUE,
        p_schema              => 'YOUR_SCHEMA',
        p_url_mapping_type    => 'BASE_PATH',
        p_url_mapping_pattern => 'api',
        p_auto_rest_auth      => FALSE
    );

    ORDS.DEFINE_MODULE(
        p_module_name    => 'ap',
        p_base_path      => '/ap/',
        p_items_per_page => 100
    );

    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_source         => 'SELECT * FROM XXAP_INVOICES_V ORDER BY invoice_date DESC'
    );

    COMMIT;
END;
/
*/
