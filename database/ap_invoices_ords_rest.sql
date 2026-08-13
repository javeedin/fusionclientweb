-- =====================================================
-- APEX/ORDS REST POST Handler for AP Invoices
-- Called from React after fetching data from Fusion
-- =====================================================

-- =====================================================
-- 1. Enable ORDS for the Schema
-- =====================================================
BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled             => TRUE,
        p_schema              => 'YOUR_SCHEMA',  -- Replace with your schema name
        p_url_mapping_type    => 'BASE_PATH',
        p_url_mapping_pattern => 'api',
        p_auto_rest_auth      => FALSE
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. Create REST Module for AP
-- =====================================================
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'ap',
        p_base_path      => '/ap/',
        p_items_per_page => 100,
        p_status         => 'PUBLISHED',
        p_comments       => 'AP Invoices REST API'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. Create REST Template for Invoices
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices',
        p_comments       => 'AP Invoices endpoint'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. POST Handler - Save Single Invoice
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Save single invoice from JSON',
        p_source         => '
DECLARE
    l_status            VARCHAR2(20);
    l_message           VARCHAR2(4000);
    l_invoice_number    VARCHAR2(50);
    l_invoice_id        NUMBER;
    l_document_sequence NUMBER;
BEGIN
    XXAP_INVOICES_PKG.save_invoice(
        p_invoice_json => :body_text,
        p_status       => l_status,
        p_message      => l_message
    );

    IF l_status = ''SUCCESS'' THEN
        l_invoice_number := JSON_VALUE(:body_text, ''$.InvoiceNumber'');
        BEGIN
            SELECT invoice_id, document_sequence
              INTO l_invoice_id, l_document_sequence
              FROM (SELECT invoice_id, document_sequence
                      FROM RR_AP_INVOICES_ALL
                     WHERE invoice_number = l_invoice_number
                     ORDER BY creation_date DESC)
             WHERE ROWNUM = 1;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    :status_code := CASE WHEN l_status = ''SUCCESS'' THEN 201 ELSE 400 END;

    HTP.P(''{"status":"'' || l_status ||
          ''","message":"'' || REPLACE(l_message, ''"'', ''\"'') ||
          ''","invoiceId":'' || NVL(TO_CHAR(l_invoice_id), ''null'') ||
          '',"documentSequence":'' || NVL(TO_CHAR(l_document_sequence), ''null'') ||
          ''}'');
END;
'
    );
    COMMIT;
END;
/

-- =====================================================
-- POST Handler for ap/createinvoicefull (APEX handler)
-- Paste this PL/SQL block directly into the APEX handler source
-- =====================================================
/*
DECLARE
    l_status            VARCHAR2(20);
    l_message           VARCHAR2(4000);
    l_invoice_number    VARCHAR2(50);
    l_invoice_id        NUMBER;
    l_document_sequence NUMBER;
BEGIN
    XXAP_INVOICES_PKG.save_invoice(
        p_invoice_json => :body_text,
        p_status       => l_status,
        p_message      => l_message
    );

    IF l_status = 'SUCCESS' THEN
        l_invoice_number := JSON_VALUE(:body_text, '$.InvoiceNumber');
        BEGIN
            SELECT invoice_id, document_sequence
              INTO l_invoice_id, l_document_sequence
              FROM (SELECT invoice_id, document_sequence
                      FROM RR_AP_INVOICES_ALL
                     WHERE invoice_number = l_invoice_number
                     ORDER BY creation_date DESC)
             WHERE ROWNUM = 1;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 201 ELSE 400 END;

    HTP.P('{"status":"' || l_status ||
          '","message":"' || REPLACE(l_message, '"', '\"') ||
          '","invoiceId":' || NVL(TO_CHAR(l_invoice_id), 'null') ||
          ',"documentSequence":' || NVL(TO_CHAR(l_document_sequence), 'null') ||
          '}');
END;
*/

-- =====================================================
-- 5. POST Handler - Save Multiple Invoices (Bulk)
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/bulk',
        p_comments       => 'Bulk AP Invoices endpoint'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/bulk',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Save multiple invoices from JSON array',
        p_source         => '
DECLARE
    l_success_count NUMBER;
    l_error_count   NUMBER;
    l_status        VARCHAR2(20);
    l_message       VARCHAR2(4000);
BEGIN
    XXAP_INVOICES_PKG.save_invoices_bulk(
        p_invoices_json => :body_text,
        p_success_count => l_success_count,
        p_error_count   => l_error_count,
        p_status        => l_status,
        p_message       => l_message
    );

    :status_code := CASE
        WHEN l_status = ''SUCCESS'' THEN 201
        WHEN l_status = ''PARTIAL'' THEN 207
        ELSE 400
    END;

    HTP.P(''{'');
    HTP.P(''"status": "'' || l_status || ''",'' );
    HTP.P(''"message": "'' || l_message || ''",'' );
    HTP.P(''"successCount": '' || NVL(l_success_count, 0) || '','' );
    HTP.P(''"errorCount": '' || NVL(l_error_count, 0));
    HTP.P(''}'');
END;
'
    );
    COMMIT;
END;
/

-- =====================================================
-- 6. GET Handler - Retrieve Invoices
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_comments       => 'Get all invoices',
        p_source         => '
SELECT
    invoice_id,
    invoice_number,
    invoice_currency,
    payment_currency,
    invoice_amount,
    TO_CHAR(invoice_date, ''YYYY-MM-DD'') as invoice_date,
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
    TO_CHAR(accounting_date, ''YYYY-MM-DD'') as accounting_date,
    pay_group,
    payment_terms,
    payment_method,
    amount_paid,
    validation_status,
    approval_status,
    paid_status,
    accounting_status,
    canceled_flag,
    sync_status,
    TO_CHAR(sync_date, ''YYYY-MM-DD HH24:MI:SS'') as sync_date
FROM XXAP_INVOICES_STG
ORDER BY invoice_date DESC, invoice_id DESC
'
    );
    COMMIT;
END;
/

-- =====================================================
-- 7. GET Handler - Retrieve Single Invoice by ID
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/:id',
        p_comments       => 'Single invoice by ID'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/:id',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_comments       => 'Get invoice by ID',
        p_source         => '
SELECT
    invoice_id,
    invoice_number,
    invoice_currency,
    payment_currency,
    invoice_amount,
    TO_CHAR(invoice_date, ''YYYY-MM-DD'') as invoice_date,
    business_unit,
    legal_entity,
    legal_entity_identifier,
    supplier,
    supplier_number,
    supplier_site,
    party,
    party_site,
    procurement_bu,
    purchase_order_number,
    requester_id,
    requester,
    invoice_group,
    invoice_source_code,
    invoice_source,
    invoice_type,
    description,
    conversion_rate_type,
    TO_CHAR(conversion_date, ''YYYY-MM-DD'') as conversion_date,
    conversion_rate,
    base_amount,
    TO_CHAR(accounting_date, ''YYYY-MM-DD'') as accounting_date,
    TO_CHAR(terms_date, ''YYYY-MM-DD'') as terms_date,
    pay_group,
    payment_terms,
    payment_method_code,
    payment_method,
    pay_alone_flag,
    amount_paid,
    control_amount,
    delivery_channel_code,
    delivery_channel,
    taxation_country,
    liability_distribution,
    document_category,
    document_sequence,
    voucher_number,
    validation_status,
    approval_status,
    paid_status,
    accounting_status,
    account_coding_status,
    funds_status,
    canceled_flag,
    TO_CHAR(canceled_date, ''YYYY-MM-DD'') as canceled_date,
    canceled_by,
    TO_CHAR(budget_date, ''YYYY-MM-DD'') as budget_date,
    fusion_created_by,
    TO_CHAR(fusion_creation_date, ''YYYY-MM-DD HH24:MI:SS'') as fusion_creation_date,
    fusion_last_updated_by,
    TO_CHAR(fusion_last_update_date, ''YYYY-MM-DD HH24:MI:SS'') as fusion_last_update_date,
    sync_status,
    TO_CHAR(sync_date, ''YYYY-MM-DD HH24:MI:SS'') as sync_date
FROM XXAP_INVOICES_STG
WHERE invoice_id = :id
'
    );
    COMMIT;
END;
/

-- =====================================================
-- 8. GET Handler - Search Invoices with Filters
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/search',
        p_comments       => 'Search invoices with filters'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/search',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_comments       => 'Search invoices with query parameters',
        p_source         => '
SELECT
    invoice_id,
    invoice_number,
    invoice_currency,
    invoice_amount,
    TO_CHAR(invoice_date, ''YYYY-MM-DD'') as invoice_date,
    business_unit,
    supplier,
    supplier_number,
    supplier_site,
    invoice_type,
    validation_status,
    approval_status,
    paid_status,
    amount_paid
FROM XXAP_INVOICES_STG
WHERE (invoice_number LIKE ''%'' || :invoice_number || ''%'' OR :invoice_number IS NULL)
  AND (supplier LIKE ''%'' || :supplier || ''%'' OR :supplier IS NULL)
  AND (supplier_site = :supplier_site OR :supplier_site IS NULL)
  AND (business_unit = :business_unit OR :business_unit IS NULL)
  AND (validation_status = :validation_status OR :validation_status IS NULL)
  AND (paid_status = :paid_status OR :paid_status IS NULL)
  AND (invoice_date >= TO_DATE(:from_date, ''YYYY-MM-DD'') OR :from_date IS NULL)
  AND (invoice_date <= TO_DATE(:to_date, ''YYYY-MM-DD'') OR :to_date IS NULL)
ORDER BY invoice_date DESC, invoice_id DESC
'
    );
    COMMIT;
END;
/

-- =====================================================
-- 9. GET Handler - Invoice Statistics/Summary
-- =====================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/stats',
        p_comments       => 'Invoice statistics'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/stats',
        p_method         => 'GET',
        p_source_type    => 'json/item',
        p_comments       => 'Get invoice statistics',
        p_source         => '
SELECT
    COUNT(*) as total_invoices,
    SUM(CASE WHEN validation_status = ''Validated'' THEN 1 ELSE 0 END) as validated_count,
    SUM(CASE WHEN approval_status = ''Approved'' THEN 1 ELSE 0 END) as approved_count,
    SUM(CASE WHEN paid_status = ''Paid'' THEN 1 ELSE 0 END) as paid_count,
    SUM(CASE WHEN paid_status = ''Unpaid'' THEN 1 ELSE 0 END) as unpaid_count,
    SUM(CASE WHEN canceled_flag = ''Y'' THEN 1 ELSE 0 END) as canceled_count,
    SUM(invoice_amount) as total_amount,
    SUM(amount_paid) as total_paid,
    SUM(invoice_amount - NVL(amount_paid, 0)) as total_outstanding,
    TO_CHAR(MAX(sync_date), ''YYYY-MM-DD HH24:MI:SS'') as last_sync_date
FROM XXAP_INVOICES_STG
'
    );
    COMMIT;
END;
/

-- =====================================================
-- 10. DELETE Handler - Delete Invoice by ID
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/:id',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_comments       => 'Delete invoice by ID',
        p_source         => '
DECLARE
    l_count NUMBER;
BEGIN
    DELETE FROM XXAP_INVOICES_STG WHERE invoice_id = :id;
    l_count := SQL%ROWCOUNT;
    COMMIT;

    IF l_count > 0 THEN
        :status_code := 200;
        HTP.P(''{"status": "SUCCESS", "message": "Invoice deleted successfully"}'');
    ELSE
        :status_code := 404;
        HTP.P(''{"status": "ERROR", "message": "Invoice not found"}'');
    END IF;
END;
'
    );
    COMMIT;
END;
/

-- =====================================================
-- 11. Verify REST Endpoints
-- =====================================================
SELECT
    m.name as module_name,
    m.uri_prefix,
    t.uri_template,
    h.source_type,
    h.method
FROM user_ords_modules m
JOIN user_ords_templates t ON m.id = t.module_id
JOIN user_ords_handlers h ON t.id = h.template_id
WHERE m.name = 'ap'
ORDER BY t.uri_template, h.method;

-- =====================================================
-- REST API Endpoints Summary:
-- =====================================================
/*
Base URL: http://your-server:port/ords/api/ap/

ENDPOINTS:

1. POST /invoices
   - Save single invoice
   - Body: Single invoice JSON object
   - Example: { "InvoiceId": 1021, "InvoiceNumber": "1P-739131", ... }

2. POST /invoices/bulk
   - Save multiple invoices
   - Body: { "items": [ {...}, {...} ] }

3. GET /invoices
   - Get all invoices (paginated)

4. GET /invoices/:id
   - Get single invoice by ID

5. GET /invoices/search?invoice_number=&supplier=&from_date=&to_date=
   - Search invoices with filters

6. GET /invoices/stats
   - Get invoice statistics/summary

7. DELETE /invoices/:id
   - Delete invoice by ID

*/

-- =====================================================
-- GET Handler - Invoice Net Balance (includes prepayment applications)
-- GET /ap/invoices/:invoice_id/net-balance
-- Returns: invoiceAmount, totalPaid, totalPrepaymentApplied, netBalance
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'invoices/:invoice_id/net-balance');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/:invoice_id/net-balance',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Invoice net balance after cash payments and prepayment applications'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/:invoice_id/net-balance',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_result  CLOB;
    v_offset  NUMBER := 1;
    v_chunk   NUMBER := 30000;
    v_length  NUMBER;
BEGIN
    v_result := XXAP_INVOICE_BALANCE_PKG.get_invoice_net_balance(
        p_invoice_id => TO_NUMBER(:invoice_id)
    );

    OWA_UTIL.MIME_HEADER('application/json', FALSE);
    v_length := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
    WHILE v_offset <= v_length LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_chunk, v_offset));
        v_offset := v_offset + v_chunk;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]',
        p_items_per_page => 0,
        p_comments       => 'Net balance = invoiceAmount - cashPayments - prepaymentApplications'
    );
    COMMIT;
END;
/

-- =====================================================
-- Sample curl commands for testing:
-- =====================================================
/*

-- POST Single Invoice
curl -X POST "http://your-server:port/ords/api/ap/invoices" \
  -H "Content-Type: application/json" \
  -d '{
    "InvoiceId": 1021,
    "InvoiceNumber": "1P-739131",
    "InvoiceCurrency": "AED",
    "InvoiceAmount": 3590,
    "InvoiceDate": "2023-07-13",
    "BusinessUnit": "BUIMERC CORP_DIFC_INVST",
    "Supplier": "UNIVERSAL TRAVELS & TOURISM L.L.C.",
    "SupplierNumber": "U0009",
    "SupplierSite": "SHARJAH",
    "ValidationStatus": "Validated",
    "ApprovalStatus": "Not required",
    "PaidStatus": "Paid"
  }'

-- POST Bulk Invoices
curl -X POST "http://your-server:port/ords/api/ap/invoices/bulk" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "InvoiceId": 1021, "InvoiceNumber": "INV-001", ... },
      { "InvoiceId": 1022, "InvoiceNumber": "INV-002", ... }
    ]
  }'

-- GET All Invoices
curl "http://your-server:port/ords/api/ap/invoices"

-- GET Invoice by ID
curl "http://your-server:port/ords/api/ap/invoices/1021"

-- GET Search Invoices
curl "http://your-server:port/ords/api/ap/invoices/search?supplier=UNIVERSAL&from_date=2023-01-01"

-- GET Statistics
curl "http://your-server:port/ords/api/ap/invoices/stats"

*/
