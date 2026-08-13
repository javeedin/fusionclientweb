-- =====================================================
-- ORDS REST API for AP Invoice Lines
-- =====================================================
-- Created: 2024
-- Description: REST endpoints for AP Invoice Lines
-- =====================================================

-- Ensure ORDS is enabled for the schema
BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled             => TRUE,
        p_schema              => USER,
        p_url_mapping_type    => 'BASE_PATH',
        p_url_mapping_pattern => LOWER(USER),
        p_auto_rest_auth      => FALSE
    );
    COMMIT;
END;
/

-- Define the module for AP Invoice Lines
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'ap',
        p_base_path      => '/ap/',
        p_items_per_page => 25,
        p_status         => 'PUBLISHED',
        p_comments       => 'AP Invoice Lines REST API'
    );
    COMMIT;
END;
/

-- =====================================================
-- POST /ap/invoicelines - Create/Update Invoice Lines (Bulk)
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoicelines',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'AP Invoice Lines endpoint'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoicelines',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create or update AP Invoice Lines in bulk',
        p_source         => q'[
DECLARE
    l_success_count NUMBER;
    l_error_count   NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
BEGIN
    -- Call the package to save lines from items array
    XXAP_INVOICE_LINES_PKG.save_lines_from_items(
        p_json          => :body_text,
        p_success_count => l_success_count,
        p_error_count   => l_error_count,
        p_status        => l_status,
        p_message       => l_message
    );

    -- Set HTTP status code
    :status_code := CASE
        WHEN l_status = 'SUCCESS' THEN 201
        WHEN l_status = 'PARTIAL' THEN 207
        ELSE 400
    END;

    -- Return JSON response
    HTP.P('{');
    HTP.P('"success": ' || CASE WHEN l_status = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.P('"status": "' || l_status || '",');
    HTP.P('"message": "' || l_message || '",');
    HTP.P('"successCount": ' || l_success_count || ',');
    HTP.P('"errorCount": ' || l_error_count);
    HTP.P('}');
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- POST /ap/invoicelines/:invoice_id - Create Lines for specific Invoice
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoicelines/:invoice_id',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'AP Invoice Lines for specific invoice'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoicelines/:invoice_id',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Create or update AP Invoice Lines for a specific invoice',
        p_source         => q'[
DECLARE
    l_success_count NUMBER;
    l_error_count   NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
    l_lines_json    CLOB;
BEGIN
    -- Extract lines array from items
    SELECT JSON_QUERY(:body_text, '$.items') INTO l_lines_json FROM DUAL;

    -- If no items array, try direct array
    IF l_lines_json IS NULL THEN
        l_lines_json := :body_text;
    END IF;

    -- Call the package to save lines
    XXAP_INVOICE_LINES_PKG.save_invoice_lines_bulk(
        p_invoice_id    => :invoice_id,
        p_lines_json    => l_lines_json,
        p_success_count => l_success_count,
        p_error_count   => l_error_count,
        p_status        => l_status,
        p_message       => l_message
    );

    -- Set HTTP status code
    :status_code := CASE
        WHEN l_status = 'SUCCESS' THEN 201
        WHEN l_status = 'PARTIAL' THEN 207
        ELSE 400
    END;

    -- Return JSON response
    HTP.P('{');
    HTP.P('"success": ' || CASE WHEN l_status = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.P('"status": "' || l_status || '",');
    HTP.P('"message": "' || l_message || '",');
    HTP.P('"invoiceId": ' || :invoice_id || ',');
    HTP.P('"successCount": ' || l_success_count || ',');
    HTP.P('"errorCount": ' || l_error_count);
    HTP.P('}');
END;
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- GET /ap/invoicelines/:invoice_id - Get Lines for Invoice
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoicelines/:invoice_id',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Get all lines for an invoice',
        p_source         => q'[
SELECT
    LINE_ID,
    INVOICE_ID,
    LINE_NUMBER,
    LINE_TYPE,
    LINE_SOURCE,
    LINE_AMOUNT,
    BASE_AMOUNT,
    UNIT_PRICE,
    QUANTITY,
    ASSESSABLE_VALUE,
    TAX_CONTROL_AMOUNT,
    TO_CHAR(ACCOUNTING_DATE, 'YYYY-MM-DD') AS ACCOUNTING_DATE,
    TO_CHAR(BUDGET_DATE, 'YYYY-MM-DD') AS BUDGET_DATE,
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
    ASSET_BOOK,
    ASSET_CATEGORY,
    TRACK_AS_ASSET_FLAG,
    APPROVAL_STATUS,
    FUNDS_STATUS,
    MATCH_TYPE,
    PURCHASE_ORDER_NUMBER,
    PURCHASE_ORDER_LINE_NUMBER,
    RECEIPT_NUMBER,
    RECEIPT_LINE_NUMBER,
    CANCELED_FLAG,
    DISCARDED_FLAG,
    PROCESS_STATUS,
    ERROR_MESSAGE,
    TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
    TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE
FROM XXAP_INVOICE_LINES_STG
WHERE INVOICE_ID = :invoice_id
ORDER BY LINE_NUMBER
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- GET /ap/invoicelines - Get All Lines (with pagination)
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoicelines',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_mimes_allowed  => NULL,
        p_comments       => 'Get all invoice lines with pagination',
        p_source         => q'[
SELECT
    LINE_ID,
    INVOICE_ID,
    LINE_NUMBER,
    LINE_TYPE,
    LINE_AMOUNT,
    TO_CHAR(ACCOUNTING_DATE, 'YYYY-MM-DD') AS ACCOUNTING_DATE,
    DESCRIPTION,
    DISTRIBUTION_COMBINATION,
    APPROVAL_STATUS,
    MATCH_TYPE,
    PURCHASE_ORDER_NUMBER,
    CANCELED_FLAG,
    PROCESS_STATUS,
    TO_CHAR(CREATION_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE
FROM XXAP_INVOICE_LINES_STG
ORDER BY INVOICE_ID, LINE_NUMBER
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- DELETE /ap/invoicelines/:invoice_id - Delete Lines for Invoice
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoicelines/:invoice_id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => NULL,
        p_comments       => 'Delete all lines for an invoice',
        p_source         => q'[
DECLARE
    l_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_count
    FROM XXAP_INVOICE_LINES_STG
    WHERE INVOICE_ID = :invoice_id;

    DELETE FROM XXAP_INVOICE_LINES_STG
    WHERE INVOICE_ID = :invoice_id;

    COMMIT;

    :status_code := 200;

    HTP.P('{');
    HTP.P('"success": true,');
    HTP.P('"message": "Deleted ' || l_count || ' lines for invoice ' || :invoice_id || '",');
    HTP.P('"deletedCount": ' || l_count);
    HTP.P('}');
END;
]'
    );
    COMMIT;
END;
/

-- Verify the endpoints
SELECT
    module_name,
    uri_template,
    method,
    source_type
FROM user_ords_handlers
WHERE module_name = 'ap'
  AND uri_template LIKE '%invoicelines%'
ORDER BY uri_template, method;
