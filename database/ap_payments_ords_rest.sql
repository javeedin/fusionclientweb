-- ============================================
-- ORDS REST API Handlers for AP Payments
-- Endpoint: /reerp/ap/payments
-- ============================================

-- Enable ORDS for schema (if not already enabled)
BEGIN
    ORDS.ENABLE_SCHEMA(
        p_enabled => TRUE,
        p_schema => USER,
        p_url_mapping_type => 'BASE_PATH',
        p_url_mapping_pattern => 'reerp',
        p_auto_rest_auth => FALSE
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Schema may already be enabled
END;
/

-- Create or update the 'ap' module
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name => 'ap',
        p_base_path => '/ap/',
        p_items_per_page => 100,
        p_status => 'PUBLISHED',
        p_comments => 'Accounts Payable REST APIs'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Module may already exist
END;
/

-- Clean up existing templates (to allow re-running)
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern => 'payments'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern => 'payments/:check_id'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END;
/

-- ============================================
-- Template: /ap/payments
-- Handles: GET (list), POST (save)
-- ============================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_priority => 0,
        p_etag_type => 'HASH',
        p_etag_query => NULL,
        p_comments => 'AP Payments collection endpoint'
    );
    COMMIT;
END;
/

-- GET Handler - List payments with optional filters
-- Query params: payment_number, payment_status, payee, supplier_number,
--               business_unit, date_from, date_to, limit, offset
-- Note: Uses chunked CLOB output to avoid ORA-06502 (HTP.P 32K limit)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_source_type => 'plsql/block',
        p_source => '
DECLARE
    v_result CLOB;
    v_date_from DATE := NULL;
    v_date_to DATE := NULL;
    v_offset NUMBER := 1;
    v_chunk_size NUMBER := 30000;
    v_length NUMBER;
BEGIN
    -- Parse date parameters if provided
    IF :date_from IS NOT NULL THEN
        BEGIN
            v_date_from := TO_DATE(:date_from, ''YYYY-MM-DD'');
        EXCEPTION
            WHEN OTHERS THEN v_date_from := NULL;
        END;
    END IF;

    IF :date_to IS NOT NULL THEN
        BEGIN
            v_date_to := TO_DATE(:date_to, ''YYYY-MM-DD'');
        EXCEPTION
            WHEN OTHERS THEN v_date_to := NULL;
        END;
    END IF;

    v_result := XXAP_PAYMENTS_PKG.get_payments(
        p_payment_number => :payment_number,
        p_payment_status => :payment_status,
        p_payee => :payee,
        p_supplier_number => :supplier_number,
        p_business_unit => :business_unit,
        p_date_from => v_date_from,
        p_date_to => v_date_to,
        p_limit => NVL(TO_NUMBER(:limit DEFAULT 100 ON CONVERSION ERROR), 100),
        p_offset => NVL(TO_NUMBER(:offset DEFAULT 0 ON CONVERSION ERROR), 0)
    );

    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);

    -- Write CLOB in chunks to avoid ORA-06502 (VARCHAR2 32K limit)
    v_length := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
    WHILE v_offset <= v_length LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_chunk_size, v_offset));
        v_offset := v_offset + v_chunk_size;
    END LOOP;
END;
',
        p_items_per_page => 0,
        p_comments => 'Get list of AP payments with optional filters'
    );
    COMMIT;
END;
/

-- POST Handler - Save payments (single or bulk)
-- Accepts: { items: [...] } or single payment object or array of payments
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'POST',
        p_source_type => 'plsql/block',
        p_source => '
DECLARE
    v_body CLOB := :body_text;
    v_result VARCHAR2(4000);
    v_has_items NUMBER;
    v_is_array NUMBER;
BEGIN
    -- Check if body contains "items" array
    SELECT COUNT(*)
    INTO v_has_items
    FROM DUAL
    WHERE JSON_EXISTS(v_body, ''$.items'');

    -- Check if body is a JSON array
    SELECT COUNT(*)
    INTO v_is_array
    FROM DUAL
    WHERE JSON_EXISTS(v_body, ''$[0]'');

    IF v_has_items > 0 THEN
        -- Format: { "items": [...] }
        XXAP_PAYMENTS_PKG.save_payments_from_items(v_body, v_result);
    ELSIF v_is_array > 0 THEN
        -- Format: [ {...}, {...} ]
        XXAP_PAYMENTS_PKG.save_payments_bulk(v_body, v_result);
    ELSE
        -- Format: { single payment }
        XXAP_PAYMENTS_PKG.save_payment(v_body, v_result);
    END IF;

    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
    HTP.P(v_result);
EXCEPTION
    WHEN OTHERS THEN
        OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
        HTP.P(''{"status": "error", "message": "'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;
',
        p_items_per_page => 0,
        p_comments => 'Save AP payments - accepts single, array, or items format'
    );
    COMMIT;
END;
/

-- ============================================
-- Template: /ap/payments/:check_id
-- Handles: GET (single payment)
-- ============================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern => 'payments/:check_id',
        p_priority => 0,
        p_etag_type => 'HASH',
        p_etag_query => NULL,
        p_comments => 'AP Payment single item endpoint'
    );
    COMMIT;
END;
/

-- GET Handler - Get single payment by Check ID
-- Note: Uses chunked CLOB output to avoid ORA-06502 (HTP.P 32K limit)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern => 'payments/:check_id',
        p_method => 'GET',
        p_source_type => 'plsql/block',
        p_source => '
DECLARE
    v_result CLOB;
    v_check_id NUMBER;
    v_offset NUMBER := 1;
    v_chunk_size NUMBER := 30000;
    v_length NUMBER;
BEGIN
    v_check_id := TO_NUMBER(:check_id);
    v_result := XXAP_PAYMENTS_PKG.get_payment_by_check_id(v_check_id);

    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);

    -- Write CLOB in chunks to avoid ORA-06502 (VARCHAR2 32K limit)
    v_length := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
    WHILE v_offset <= v_length LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_chunk_size, v_offset));
        v_offset := v_offset + v_chunk_size;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
        HTP.PRN(''{"status": "error", "message": "'' || REPLACE(SQLERRM, ''"'', ''\"'') || ''"}'');
END;
',
        p_items_per_page => 0,
        p_comments => 'Get single AP payment by Check ID'
    );
    COMMIT;
END;
/

-- Create parameters for GET handler
BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'payment_number',
        p_bind_variable_name => 'payment_number',
        p_source_type => 'URI',
        p_param_type => 'STRING',
        p_access_method => 'IN',
        p_comments => 'Filter by payment number'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'payment_status',
        p_bind_variable_name => 'payment_status',
        p_source_type => 'URI',
        p_param_type => 'STRING',
        p_access_method => 'IN',
        p_comments => 'Filter by payment status'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'payee',
        p_bind_variable_name => 'payee',
        p_source_type => 'URI',
        p_param_type => 'STRING',
        p_access_method => 'IN',
        p_comments => 'Filter by payee name (partial match)'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'supplier_number',
        p_bind_variable_name => 'supplier_number',
        p_source_type => 'URI',
        p_param_type => 'STRING',
        p_access_method => 'IN',
        p_comments => 'Filter by supplier number'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'business_unit',
        p_bind_variable_name => 'business_unit',
        p_source_type => 'URI',
        p_param_type => 'STRING',
        p_access_method => 'IN',
        p_comments => 'Filter by business unit'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'date_from',
        p_bind_variable_name => 'date_from',
        p_source_type => 'URI',
        p_param_type => 'STRING',
        p_access_method => 'IN',
        p_comments => 'Filter by payment date from (YYYY-MM-DD)'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'date_to',
        p_bind_variable_name => 'date_to',
        p_source_type => 'URI',
        p_param_type => 'STRING',
        p_access_method => 'IN',
        p_comments => 'Filter by payment date to (YYYY-MM-DD)'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'limit',
        p_bind_variable_name => 'limit',
        p_source_type => 'URI',
        p_param_type => 'INT',
        p_access_method => 'IN',
        p_comments => 'Number of records to return (default 100)'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name => 'ap',
        p_pattern => 'payments',
        p_method => 'GET',
        p_name => 'offset',
        p_bind_variable_name => 'offset',
        p_source_type => 'URI',
        p_param_type => 'INT',
        p_access_method => 'IN',
        p_comments => 'Number of records to skip (default 0)'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Verify setup
SELECT 'Module: ' || name AS info FROM user_ords_modules WHERE name = 'ap'
UNION ALL
SELECT 'Template: ' || uri_template FROM user_ords_templates WHERE module_name = 'ap' AND uri_template LIKE '%payment%'
UNION ALL
SELECT 'Handler: ' || method || ' ' || uri_template FROM user_ords_handlers h
JOIN user_ords_templates t ON h.template_id = t.id
WHERE t.module_name = 'ap' AND t.uri_template LIKE '%payment%';
