-- =====================================================
-- ORDS REST Handler: DELETE /ar/receipt-applications/:appId
--
-- Delete a single receipt application AND reverse the installment it paid, so the
-- open balance reflects that the allocated amount is no longer applied. The
-- balance is RECOMPUTED from the original line amount (same as the accumulate PUT
-- and the receipt-delete handler), and all three balance columns are set:
--   • RR_AR_INVOICE_INSTALLMENTS (the app's REFERENCE_INSTALLMENT_ID):
--       AMOUNT_PAID                 -= APPLICATION_AMOUNT           (floor 0)
--       INSTALLMENT_AMOUNT_ADJUSTED += ABS(ADJUSTMENT_AMOUNT)       (undo the adjustment)
--       balance = ORIGINAL - new_paid - ABS(new_adj)   [floor 0 -> Closed]
--       INSTALLMENT_BALANCE_DUE     = balance
--       ACCOUNTED_BALANCE_DUE       = balance
--       INSTALLMENT_LINE_AMOUNT_DUE = balance
--       INSTALLMENT_STATUS          = Open/Closed, close dates accordingly
--   • RR_AR_ADJUSTMENTS: delete rows for this APPLICATION_ID
--   • RR_AR_RECEIPT_APPLICATIONS: delete the application row
--
-- This is the exact reverse of the PUT /ar/receipt-applications/:appId apply.
-- Call: DELETE {base}/ar/receipt-applications/{applicationId}   (no body)
--
-- Run in APEX SQL Workshop -> SQL Commands.
-- =====================================================

BEGIN
    ORDS.DELETE_HANDLER(p_module_name => 'ar', p_pattern => 'receipt-applications/:appId', p_method => 'DELETE');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receipt-applications/:appId');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipt-applications/:appId',
        p_method         => 'DELETE',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Delete a receipt application and restore its installment balance',
        p_source         => q'[
DECLARE
  v_app_id     NUMBER := TO_NUMBER(:appId);
  v_app_amt    NUMBER;
  v_adj_amt    NUMBER;
  v_inst_id    NUMBER;
  v_adjs       NUMBER := 0;
  l_orig       NUMBER; l_paid NUMBER; l_adj NUMBER;
  l_new_paid   NUMBER; l_new_adj NUMBER; l_bal NUMBER;
  l_status     VARCHAR2(30); l_closed DATE;
  l_restored   NUMBER := 0;
BEGIN
  -- 1. Load the application (404 if missing)
  BEGIN
    SELECT NVL(APPLICATION_AMOUNT, 0), NVL(ADJUSTMENT_AMOUNT, 0), REFERENCE_INSTALLMENT_ID
      INTO v_app_amt, v_adj_amt, v_inst_id
      FROM RR_AR_RECEIPT_APPLICATIONS
     WHERE APPLICATION_ID = v_app_id;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    :status_code := 404;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"Receipt application not found for ID ' || v_app_id || '"}');
    RETURN;
  END;

  -- 2. Reverse the installment — back out this application, then recompute the
  --    balance from the original line amount and set all three balance columns.
  IF v_inst_id IS NOT NULL THEN
    SELECT NVL(INSTALLMENT_LINE_AMOUNT_ORIGINAL, 0), NVL(AMOUNT_PAID, 0), NVL(INSTALLMENT_AMOUNT_ADJUSTED, 0)
      INTO l_orig, l_paid, l_adj
      FROM RR_AR_INVOICE_INSTALLMENTS WHERE INSTALLMENT_ID = v_inst_id;

    l_new_paid := GREATEST(l_paid - v_app_amt, 0);
    l_new_adj  := l_adj + ABS(v_adj_amt);              -- undo the negative adjustment
    l_bal      := l_orig - l_new_paid - ABS(l_new_adj);
    IF l_bal <= 0 THEN l_status := 'Closed'; l_closed := SYSDATE; l_bal := 0;
    ELSE               l_status := 'Open';   l_closed := NULL; END IF;

    l_restored := GREATEST(l_bal - NVL((SELECT INSTALLMENT_BALANCE_DUE FROM RR_AR_INVOICE_INSTALLMENTS WHERE INSTALLMENT_ID = v_inst_id), 0), 0);

    UPDATE RR_AR_INVOICE_INSTALLMENTS
       SET AMOUNT_PAID                    = l_new_paid,
           INSTALLMENT_AMOUNT_ADJUSTED    = l_new_adj,
           INSTALLMENT_BALANCE_DUE        = l_bal,
           ACCOUNTED_BALANCE_DUE          = l_bal,
           INSTALLMENT_LINE_AMOUNT_DUE    = l_bal,
           INSTALLMENT_FREIGHT_AMOUNT_DUE = CASE WHEN l_status = 'Closed' THEN 0 ELSE INSTALLMENT_FREIGHT_AMOUNT_DUE END,
           INSTALLMENT_TAX_AMOUNT_DUE     = CASE WHEN l_status = 'Closed' THEN 0 ELSE INSTALLMENT_TAX_AMOUNT_DUE END,
           INSTALLMENT_STATUS             = l_status,
           INSTALLMENT_CLOSED_DATE        = l_closed,
           INSTALLMENT_GL_CLOSED_DATE     = l_closed,
           LAST_UPDATED_BY                = USER,
           LAST_UPDATE_DATE               = SYSTIMESTAMP
     WHERE INSTALLMENT_ID = v_inst_id;
  END IF;

  -- 3. Delete this application's adjustments
  DELETE FROM RR_AR_ADJUSTMENTS WHERE APPLICATION_ID = v_app_id;
  v_adjs := SQL%ROWCOUNT;

  -- 4. Delete the application row
  DELETE FROM RR_AR_RECEIPT_APPLICATIONS WHERE APPLICATION_ID = v_app_id;

  COMMIT;
  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"success":true,"applicationId":' || v_app_id ||
          ',"installmentId":' || NVL(TO_CHAR(v_inst_id), 'null') ||
          ',"amountRestored":' || l_restored ||
          ',"installmentStatus":"' || NVL(l_status, 'n/a') || '"' ||
          ',"adjustmentsDeleted":' || v_adjs || '}');
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- DELETE {base}/ar/receipt-applications/{applicationId}   (no request body)
--   Deletes the application, recomputes the installment balance from the original
--   line amount (setting INSTALLMENT_BALANCE_DUE / ACCOUNTED_BALANCE_DUE /
--   INSTALLMENT_LINE_AMOUNT_DUE), reverses AMOUNT_PAID / INSTALLMENT_AMOUNT_ADJUSTED
--   and status, and deletes its adjustments.
-- =====================================================
