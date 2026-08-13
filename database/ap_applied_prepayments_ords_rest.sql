-- ============================================================
-- ORDS REST API for AP Applied Prepayments
-- Endpoint: /reerp/ap/applied-prepayments
-- ============================================================

-- Clean up existing templates
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'applied-prepayments');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'applied-prepayments/by-invoice/:invoice_id');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'applied-prepayments/by-prepayment/:prepayment_id');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ============================================================
-- Template: /ap/applied-prepayments
-- POST  - Save one or many prepayment applications
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'applied-prepayments',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'AP Applied Prepayments - POST endpoint'
    );
    COMMIT;
END;
/

-- POST Handler
-- Accepts three formats:
--   1. Single object:   { "InvoiceId": ..., "AppliedAmount": ..., ... }
--   2. JSON array:      [ { ... }, { ... } ]
--   3. Items wrapper:   { "items": [ { ... }, { ... } ] }
-- NOTE: q'#...#' delimiter used intentionally — '$[0]' inside q'[...]' would
--       terminate the q-quote early because ']' followed by ' is the closing
--       sequence, corrupting the stored PL/SQL block (ORA-06550 at runtime).
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'applied-prepayments',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_source         => q'#
DECLARE
    v_body       CLOB := :body_text;
    v_result     VARCHAR2(4000);
    v_has_items  NUMBER := 0;
    v_is_array   NUMBER := 0;
BEGIN
    -- Check for items wrapper: { "items": [...] }
    BEGIN
        SELECT 1 INTO v_has_items FROM DUAL WHERE JSON_EXISTS(v_body, '$.items');
    EXCEPTION WHEN NO_DATA_FOUND THEN v_has_items := 0;
    END;

    -- Check for bare array: starts with '['.
    -- DBMS_LOB.SUBSTR handles CLOB directly — avoids LTRIM/SUBSTR SQL datatype error.
    IF DBMS_LOB.SUBSTR(v_body, 1, 1) = '[' THEN
        v_is_array := 1;
    END IF;

    IF v_has_items = 1 THEN
        RR_AP_APPLIED_PREPAYMENTS_PKG.save_from_items(v_body, v_result);
    ELSIF v_is_array = 1 THEN
        RR_AP_APPLIED_PREPAYMENTS_PKG.save_bulk(v_body, v_result);
    ELSE
        RR_AP_APPLIED_PREPAYMENTS_PKG.save_application(v_body, v_result);
    END IF;

    :status_code := 200;
    HTP.P(v_result);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
#',
        p_items_per_page => 0,
        p_comments       => 'Save AP prepayment application(s) — single, array, or items wrapper'
    );
    COMMIT;
END;
/

-- ============================================================
-- Template: /ap/applied-prepayments/by-invoice/:invoice_id
-- GET - All prepayment applications for a target invoice
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'applied-prepayments/by-invoice/:invoice_id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Get prepayment applications by target invoice ID'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'applied-prepayments/by-invoice/:invoice_id',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_result    CLOB;
    v_offset    NUMBER := 1;
    v_chunk     NUMBER := 30000;
    v_length    NUMBER;
BEGIN
    v_result := RR_AP_APPLIED_PREPAYMENTS_PKG.get_by_invoice_id(
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
        p_comments       => 'Get all prepayment applications for a target invoice'
    );
    COMMIT;
END;
/

-- ============================================================
-- Template: /ap/applied-prepayments/by-prepayment/:prepayment_id
-- GET - All applications where a prepayment was used
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'applied-prepayments/by-prepayment/:prepayment_id',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Get applications by source prepayment invoice ID'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'applied-prepayments/by-prepayment/:prepayment_id',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_result    CLOB;
    v_offset    NUMBER := 1;
    v_chunk     NUMBER := 30000;
    v_length    NUMBER;
BEGIN
    v_result := RR_AP_APPLIED_PREPAYMENTS_PKG.get_by_prepayment_id(
        p_prepayment_invoice_id => TO_NUMBER(:prepayment_id)
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
        p_comments       => 'Get all invoice applications that used a given prepayment'
    );
    COMMIT;
END;
/

-- ============================================================
-- Template: /ap/applied-prepayments/balances
-- GET - Prepayment available balances
-- Query params: prepayment_invoice_id, supplier_number
-- ============================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'applied-prepayments/balances');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'applied-prepayments/balances',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Get prepayment available balances'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'applied-prepayments/balances',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_result    CLOB;
    v_offset    NUMBER := 1;
    v_chunk     NUMBER := 30000;
    v_length    NUMBER;
BEGIN
    v_result := RR_AP_APPLIED_PREPAYMENTS_PKG.get_prepayment_balances(
        p_prepayment_invoice_id => TO_NUMBER(:prepayment_invoice_id DEFAULT NULL ON CONVERSION ERROR),
        p_supplier_number       => :supplier_number
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
        p_comments       => 'Get prepayment available balances (InvoiceAmount - TotalApplied)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'ap',
        p_pattern            => 'applied-prepayments/balances',
        p_method             => 'GET',
        p_name               => 'prepayment_invoice_id',
        p_bind_variable_name => 'prepayment_invoice_id',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by prepayment invoice ID'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'ap',
        p_pattern            => 'applied-prepayments/balances',
        p_method             => 'GET',
        p_name               => 'supplier_number',
        p_bind_variable_name => 'supplier_number',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Filter by supplier number (returns all prepayments for that supplier)'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ============================================================
-- Template: /ap/prepayments/available
-- GET  - Available prepayments for a supplier (by P_SUPPLIER_ID)
--        Used by the "Available" section of the Apply Prepayments modal
-- ============================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'prepayments/available');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'prepayments/available',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Get available prepayments for a supplier'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'prepayments/available',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_result    CLOB;
    v_offset    NUMBER := 1;
    v_chunk     NUMBER := 30000;
    v_length    NUMBER;
BEGIN
    v_result := RR_AP_APPLIED_PREPAYMENTS_PKG.get_available_by_supplier_id(
        p_supplier_id => TO_NUMBER(:P_SUPPLIER_ID DEFAULT NULL ON CONVERSION ERROR)
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
        p_comments       => 'GET available prepayments for supplier — calls get_available_by_supplier_id'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'ap',
        p_pattern            => 'prepayments/available',
        p_method             => 'GET',
        p_name               => 'P_SUPPLIER_ID',
        p_bind_variable_name => 'P_SUPPLIER_ID',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Supplier ID to filter available prepayments'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ============================================================
-- Template: /ap/invoices/appliedprepayments
-- GET  - Applied prepayments for a given invoice (P_INVOICE_ID)
-- POST - Save a new prepayment application
--        Both used by the Apply/Unapply Prepayments modal
-- ============================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'invoices/appliedprepayments');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'invoices/appliedprepayments',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'AP Applied Prepayments — GET by invoice / POST new application'
    );
    COMMIT;
END;
/

-- GET Handler — returns applied prepayments for a target invoice (snake_case)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/appliedprepayments',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_source         => q'[
DECLARE
    v_result    CLOB;
    v_offset    NUMBER := 1;
    v_chunk     NUMBER := 30000;
    v_length    NUMBER;
BEGIN
    v_result := RR_AP_APPLIED_PREPAYMENTS_PKG.get_applied_by_invoice_snake(
        p_invoice_id => TO_NUMBER(:P_INVOICE_ID DEFAULT NULL ON CONVERSION ERROR)
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
        p_comments       => 'GET applied prepayments for an invoice — calls get_applied_by_invoice_snake'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'ap',
        p_pattern            => 'invoices/appliedprepayments',
        p_method             => 'GET',
        p_name               => 'P_INVOICE_ID',
        p_bind_variable_name => 'P_INVOICE_ID',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN',
        p_comments           => 'Invoice ID to retrieve applied prepayments for'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- POST Handler — save a new prepayment application (delegates to save_application)
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'invoices/appliedprepayments',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_source         => q'#
DECLARE
    v_body       CLOB := :body_text;
    v_result     VARCHAR2(4000);
    v_has_items  NUMBER := 0;
    v_is_array   NUMBER := 0;
BEGIN
    -- Check for items wrapper: { "items": [...] }
    BEGIN
        SELECT 1 INTO v_has_items FROM DUAL WHERE JSON_EXISTS(v_body, '$.items');
    EXCEPTION WHEN NO_DATA_FOUND THEN v_has_items := 0;
    END;

    -- Check for bare array: starts with '['.
    -- DBMS_LOB.SUBSTR handles CLOB directly — avoids LTRIM/SUBSTR SQL datatype error.
    IF DBMS_LOB.SUBSTR(v_body, 1, 1) = '[' THEN
        v_is_array := 1;
    END IF;

    IF v_has_items = 1 THEN
        RR_AP_APPLIED_PREPAYMENTS_PKG.save_from_items(v_body, v_result);
    ELSIF v_is_array = 1 THEN
        RR_AP_APPLIED_PREPAYMENTS_PKG.save_bulk(v_body, v_result);
    ELSE
        RR_AP_APPLIED_PREPAYMENTS_PKG.save_application(v_body, v_result);
    END IF;

    :status_code := 200;
    HTP.P(v_result);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
#',
        p_items_per_page => 0,
        p_comments       => 'POST — save prepayment application(s); delegates to save_application / save_bulk'
    );
    COMMIT;
END;
/

-- ============================================================
-- Verify all prepayment templates & handlers
-- ============================================================
SELECT 'Template: ' || uri_template AS info
FROM   user_ords_templates
WHERE  module_name = 'ap'
  AND  (uri_template LIKE '%applied-prepayment%' OR uri_template LIKE '%prepayment%')
UNION ALL
SELECT 'Handler: ' || h.method || ' ' || t.uri_template
FROM   user_ords_handlers h
JOIN   user_ords_templates t ON h.template_id = t.id
WHERE  t.module_name = 'ap'
  AND  (t.uri_template LIKE '%applied-prepayment%' OR t.uri_template LIKE '%prepayment%')
ORDER BY 1;
