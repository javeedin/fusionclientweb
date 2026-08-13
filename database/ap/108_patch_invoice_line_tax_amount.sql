-- ============================================================
-- 108_patch_invoice_line_tax_amount.sql
-- PATCH /ap/invoices/:invoice_id/lines/:line_id/tax-amount
--
-- Data correction endpoint: updates TAX_CONTROL_AMOUNT on a
-- single invoice line when it was not saved during creation.
-- Called from the UI warning icon on Tax Amount column.
-- ============================================================

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'ap/invoices/:invoice_id/lines/:line_id/tax-amount',
    p_method         => 'PUT',
    p_source_type    => ORDS.source_type_plsql,
    p_source         => q'[
DECLARE
  v_body         CLOB          := :body_text;
  v_invoice_id   NUMBER        := :invoice_id;
  v_line_id      NUMBER        := :line_id;
  v_tax_amount   NUMBER;
  v_rows_updated NUMBER;
BEGIN
  -- Extract taxControlAmount from JSON body
  v_tax_amount := JSON_VALUE(v_body, '$.taxControlAmount' RETURNING NUMBER);

  IF v_tax_amount IS NULL OR v_tax_amount < 0 THEN
    HTP.P('{"success":false,"error":"taxControlAmount must be a positive number"}');
    RETURN;
  END IF;

  -- Validate line belongs to the invoice
  SELECT COUNT(*)
    INTO v_rows_updated
    FROM RR_AP_INVOICE_LINES_ALL
   WHERE INVOICE_ID = v_invoice_id
     AND LINE_ID    = v_line_id;

  IF v_rows_updated = 0 THEN
    HTP.P('{"success":false,"error":"Line ' || v_line_id || ' not found for invoice ' || v_invoice_id || '"}');
    RETURN;
  END IF;

  -- Apply the correction
  UPDATE RR_AP_INVOICE_LINES_ALL
     SET TAX_CONTROL_AMOUNT = v_tax_amount,
         LAST_UPDATE_DATE   = SYSTIMESTAMP,
         LAST_UPDATED_BY    = NVL(JSON_VALUE(v_body, '$.updatedBy'), USER)
   WHERE INVOICE_ID = v_invoice_id
     AND LINE_ID    = v_line_id;

  v_rows_updated := SQL%ROWCOUNT;
  COMMIT;

  HTP.P('{"success":true,"invoiceId":' || v_invoice_id ||
        ',"lineId":' || v_line_id ||
        ',"taxControlAmount":' || v_tax_amount ||
        ',"rowsUpdated":' || v_rows_updated || '}');

EXCEPTION WHEN OTHERS THEN
  ROLLBACK;
  HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]',
    p_items_per_page => 0
  );
  COMMIT;
END;
/
