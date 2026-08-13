-- ============================================
-- ORDS REST Handlers for Void Payment
--
-- GET  /ap/payments/:check_id/void-eligibility
--      Pre-check before showing the Void popup.
--      Response: { eligible, errors, paymentNumber,
--                  paymentStatus, reconciledFlag,
--                  clearingDate, clearingAmount }
--
-- OPTIONS /ap/payments/void
--      CORS preflight handler (browser sends this before PUT).
--
-- PUT  /ap/payments/void
--      Execute the void.
--      Body:     { CheckId, VoidDate?, VoidedBy?,
--                  StopReason?, StopReference? }
--      Response: { status, message, checkId,
--                  paymentNumber, invoiceId, newBalance }
--
-- NOTE: HTTP_HEADER_CLOSE must NOT be used in GET/PUT handlers.
--       In ORDS plsql/block, calling it flushes/commits the response
--       before HTP.PRN runs, producing an empty body.
--       Pattern: MIME_HEADER(type, FALSE) -> HTP.P(cors) -> HTP.PRN(body)
--       HTTP_HEADER_CLOSE is only safe in the OPTIONS handler (no body).
-- ============================================

-- ============================================================
-- Template: payments/:check_id/void-eligibility  (GET)
-- ============================================================
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'payments/:check_id/void-eligibility'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'payments/:check_id/void-eligibility',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Check whether a payment is eligible to be voided'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'payments/:check_id/void-eligibility',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns eligibility JSON for voiding a payment',
        p_source         => '
DECLARE
    v_result CLOB;
BEGIN
    v_result := XXAP_VOID_PAYMENT_PKG.is_eligible_for_void(
        p_check_id => TO_NUMBER(:check_id)
    );
    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.PRN(NVL(v_result, ''{"eligible":false,"errors":["Procedure returned no result"]}''));
EXCEPTION
    WHEN OTHERS THEN
        OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
        HTP.P(''Access-Control-Allow-Origin: *'');
        HTP.PRN(''{"eligible":false,"errors":["'' || REPLACE(SQLERRM,''"'',''\"'') || ''"]}'');
END;
'
    );
    COMMIT;
END;
/

-- ============================================================
-- Template: payments/void  (OPTIONS + PUT)
-- ============================================================
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'payments/void'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'payments/void',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Execute void on an AP payment'
    );
    COMMIT;
END;
/

-- OPTIONS handler — answers the browser CORS preflight before the PUT.
-- HTTP_HEADER_CLOSE is used here because OPTIONS has no body.
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'payments/void',
        p_method         => 'OPTIONS',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'CORS preflight for PUT /ap/payments/void',
        p_source         => '
BEGIN
    OWA_UTIL.MIME_HEADER(''text/plain'', FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.P(''Access-Control-Allow-Methods: PUT, OPTIONS'');
    HTP.P(''Access-Control-Allow-Headers: Content-Type, Accept'');
    HTP.P(''Access-Control-Max-Age: 86400'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;
'
    );
    COMMIT;
END;
/

-- PUT handler — executes the void.
-- Do NOT add HTTP_HEADER_CLOSE here; it would flush the response before the body.
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'payments/void',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Void payment — validates eligibility, marks voided, restores installment',
        p_source         => '
DECLARE
    v_body   CLOB := :body_text;
    v_result VARCHAR2(4000);
BEGIN
    XXAP_VOID_PAYMENT_PKG.void_payment(
        p_json_data => v_body,
        p_result    => v_result
    );
    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.PRN(NVL(v_result, ''{"status":"error","message":"void_payment returned no result — check package"}''));
EXCEPTION
    WHEN OTHERS THEN
        OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
        HTP.P(''Access-Control-Allow-Origin: *'');
        HTP.PRN(''{"status":"error","message":"'' || REPLACE(SQLERRM,''"'',''\"'') || ''"}'' );
END;
'
    );
    COMMIT;
END;
/

-- ============================================================
-- Verify all endpoints registered
-- ============================================================
SELECT t.uri_template, h.method, h.comments
FROM   user_ords_handlers  h
JOIN   user_ords_templates t ON h.template_id = t.id
WHERE  t.module_name = 'ap'
AND    t.uri_template IN ('payments/void', 'payments/:check_id/void-eligibility')
ORDER  BY t.uri_template, h.method;
