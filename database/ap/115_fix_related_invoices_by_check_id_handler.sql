-- ============================================================
-- 115_fix_related_invoices_by_check_id_handler.sql
-- The GET /ap/payments/:check_id/related-invoices handler was
-- calling get_by_check_id() which is a minimal function that
-- does NOT return InvoiceBaseAmount, PaymentBaseAmount, or
-- InvoiceExchangeRate.
--
-- Fix: switch it to call get_related_invoices(p_check_id => ...)
-- which returns all fields including the new InvoiceExchangeRate
-- added in migration 114.
-- ============================================================

BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'ap',
    p_pattern     => 'payments/:check_id/related-invoices',
    p_method      => 'GET'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'payments/:check_id/related-invoices',
    p_method         => 'GET',
    p_source_type    => 'plsql/block',
    p_items_per_page => 0,
    p_comments       => 'Get related invoices by Check ID — full fields including base amounts and exchange rate',
    p_source         => q'[
DECLARE
    v_result     CLOB;
    v_check_id   NUMBER;
    v_offset     NUMBER := 1;
    v_chunk_size NUMBER := 30000;
    v_length     NUMBER;
BEGIN
    v_check_id := TO_NUMBER(:check_id);

    v_result := XXAP_PAYMENT_REL_INVOICES_PKG.get_related_invoices(
        p_check_id => v_check_id,
        p_limit    => 200,
        p_offset   => 0
    );

    OWA_UTIL.MIME_HEADER('application/json', FALSE);

    v_length := NVL(DBMS_LOB.GETLENGTH(v_result), 0);
    WHILE v_offset <= v_length LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_chunk_size, v_offset));
        v_offset := v_offset + v_chunk_size;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
  );
  COMMIT;
END;
/
