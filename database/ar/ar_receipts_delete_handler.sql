-- =====================================================
-- ORDS REST Handler: POST /ar/receipts/:id/delete
--
-- Delete an UNACCOUNTED AR receipt and reverse everything it touched:
--   • Guard: refuse if RR_AR_RECEIPTS.ACCOUNTING_STATUS = 'Accounted'.
--   • For every application of the receipt:
--       - restore its installment: back out AMOUNT_PAID and the adjustment, then
--         recompute the balance from the original line amount and set all three
--         balance columns (INSTALLMENT_BALANCE_DUE / ACCOUNTED_BALANCE_DUE /
--         INSTALLMENT_LINE_AMOUNT_DUE) plus status/close dates
--       - delete its adjustments (RR_AR_ADJUSTMENTS by APPLICATION_ID)
--   • delete the applications (RR_AR_RECEIPT_APPLICATIONS)
--   • delete the receipt (RR_AR_RECEIPTS)
--
-- Call: POST {base}/ar/receipts/{standard_receipt_id}/delete   (no body)
--
-- Run in APEX SQL Workshop -> SQL Commands.
-- =====================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receipts/:id/delete');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'receipts/:id/delete',
        p_comments    => 'Delete an unaccounted AR receipt and reverse its applications'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name   => 'ar',
        p_pattern       => 'receipts/:id/delete',
        p_method        => 'POST',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments      => 'Delete unaccounted receipt + reverse installments, delete adjustments/applications',
        p_source        => q'[
DECLARE
  v_id     NUMBER := :id;
  v_acct   VARCHAR2(50);
  v_apps   NUMBER := 0;
  v_adjs   NUMBER := 0;
  v_insts  NUMBER := 0;
BEGIN
  -- Guard 1: receipt must exist
  BEGIN
    SELECT ACCOUNTING_STATUS INTO v_acct
      FROM RR_AR_RECEIPTS WHERE STANDARD_RECEIPT_ID = v_id;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    :status_code := 404;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"Receipt not found"}');
    RETURN;
  END;

  -- Guard 2: only unaccounted receipts can be deleted
  IF UPPER(NVL(v_acct, '')) = 'ACCOUNTED' THEN
    :status_code := 409;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"Receipt is accounted and cannot be deleted"}');
    RETURN;
  END IF;

  -- Reverse each application: restore installment + delete its adjustments
  FOR app IN (
    SELECT APPLICATION_ID, NVL(APPLICATION_AMOUNT, 0) AS APP_AMT,
           NVL(ADJUSTMENT_AMOUNT, 0) AS ADJ_AMT, REFERENCE_INSTALLMENT_ID
    FROM   RR_AR_RECEIPT_APPLICATIONS
    WHERE  STANDARD_RECEIPT_ID = v_id
  ) LOOP
    IF app.REFERENCE_INSTALLMENT_ID IS NOT NULL THEN
      DECLARE
        l_orig     NUMBER; l_paid NUMBER; l_adj NUMBER;
        l_new_paid NUMBER; l_new_adj NUMBER; l_bal NUMBER;
        l_status   VARCHAR2(30); l_closed DATE;
      BEGIN
        SELECT NVL(INSTALLMENT_LINE_AMOUNT_ORIGINAL, 0), NVL(AMOUNT_PAID, 0), NVL(INSTALLMENT_AMOUNT_ADJUSTED, 0)
          INTO l_orig, l_paid, l_adj
          FROM RR_AR_INVOICE_INSTALLMENTS WHERE INSTALLMENT_ID = app.REFERENCE_INSTALLMENT_ID;

        -- Back out this application's contribution, then recompute the balance
        l_new_paid := GREATEST(l_paid - app.APP_AMT, 0);
        l_new_adj  := l_adj + ABS(app.ADJ_AMT);            -- undo the negative adjustment
        l_bal      := l_orig - l_new_paid - ABS(l_new_adj);
        IF l_bal <= 0 THEN l_status := 'Closed'; l_closed := SYSDATE; l_bal := 0;
        ELSE               l_status := 'Open';   l_closed := NULL; END IF;

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
         WHERE INSTALLMENT_ID = app.REFERENCE_INSTALLMENT_ID;
        v_insts := v_insts + SQL%ROWCOUNT;
      END;
    END IF;

    DELETE FROM RR_AR_ADJUSTMENTS WHERE APPLICATION_ID = app.APPLICATION_ID;
    v_adjs := v_adjs + SQL%ROWCOUNT;
  END LOOP;

  DELETE FROM RR_AR_RECEIPT_APPLICATIONS WHERE STANDARD_RECEIPT_ID = v_id;
  v_apps := SQL%ROWCOUNT;

  DELETE FROM RR_AR_RECEIPTS WHERE STANDARD_RECEIPT_ID = v_id;

  COMMIT;
  :status_code := 200;
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"success":true,"receiptId":' || v_id ||
          ',"applicationsDeleted":' || v_apps ||
          ',"adjustmentsDeleted":'  || v_adjs ||
          ',"installmentsRestored":'|| v_insts || '}');
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
-- POST {base}/ar/receipts/{standard_receipt_id}/delete   (no request body)
--   Deletes an unaccounted receipt and reverses its applications/installments/adjustments.
--   Returns 409 if the receipt is Accounted, 404 if not found.
-- =====================================================
