-- ============================================================
-- FIX: PUT /ar/invoices/:id/installments/:installmentId
--
-- Problem:
--   The handler OVERWROTE the installment instead of applying the incoming
--   payment on top of prior payments:
--     AMOUNT_PAID              = :AmountPaid          -- (overwrite)
--     INSTALLMENT_BALANCE_DUE  = ORIGINAL - :AmountPaid
--   The UI sends the amount applied by THIS receipt (row.applyAmount), i.e. an
--   INCREMENTAL amount. So a 2nd/partial payment replaced the prior AMOUNT_PAID
--   and the balance never reached 0 (it was recomputed from ORIGINAL - one payment).
--
-- Fix (accumulate):
--     AMOUNT_PAID                 = prior AMOUNT_PAID                 + :AmountPaid
--     INSTALLMENT_AMOUNT_ADJUSTED = prior INSTALLMENT_AMOUNT_ADJUSTED + :InstallmentAmountAdjusted
--     INSTALLMENT_BALANCE_DUE     = ORIGINAL - (total paid) - ABS(total adjusted)   [floor 0 -> Closed]
--   The installment is only ever updated by this endpoint (the receipt-application
--   POST does not touch it), so accumulating here does not double-count.
--
--   Reverse of this is DELETE /ar/receipt-applications/:appId, which subtracts the
--   application amount back off AMOUNT_PAID and restores the balance.
--
-- Run in APEX SQL Workshop -> SQL Commands.
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(p_module_name => 'ar', p_pattern => 'invoices/:id/installments/:installmentId', p_method => 'PUT');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoices/:id/installments/:installmentId');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name   => 'ar',
        p_pattern       => 'invoices/:id/installments/:installmentId',
        p_method        => 'PUT',
        p_source_type   => 'plsql/block',
        p_mimes_allowed => 'application/json',
        p_comments      => 'Apply payment/adjustment to an installment — accumulates, reduces balance to 0',
        p_source        => q'[
DECLARE
    l_body        CLOB   := :body_text;
    l_txn_id      NUMBER := :id;
    l_inst_id     NUMBER := :installmentId;
    l_pay_in      NUMBER;
    l_adj_in      NUMBER;
    l_updated_by  VARCHAR2(240);
    l_rows        NUMBER;
    l_orig        NUMBER;
    l_prev_paid   NUMBER;
    l_prev_adj    NUMBER;
    l_new_paid    NUMBER;
    l_new_adj     NUMBER;
    l_balance     NUMBER;
    l_status      VARCHAR2(30);
    l_closed      DATE;
BEGIN
    APEX_JSON.parse(l_body);
    l_pay_in     := NVL(APEX_JSON.get_number(p_path => 'AmountPaid'), 0);
    l_adj_in     := NVL(APEX_JSON.get_number(p_path => 'InstallmentAmountAdjusted'), 0);
    l_updated_by := NVL(APEX_JSON.get_varchar2(p_path => 'LastUpdatedBy'), 'REERP');

    -- Current running totals + original line amount
    SELECT NVL(INSTALLMENT_LINE_AMOUNT_ORIGINAL, 0),
           NVL(AMOUNT_PAID, 0),
           NVL(INSTALLMENT_AMOUNT_ADJUSTED, 0)
      INTO l_orig, l_prev_paid, l_prev_adj
      FROM RR_AR_INVOICE_INSTALLMENTS
     WHERE INSTALLMENT_ID = l_inst_id
       AND CUSTOMER_TRANSACTION_ID = l_txn_id;

    -- Apply THIS receipt's amounts on top of what was already paid/adjusted
    l_new_paid := l_prev_paid + l_pay_in;
    l_new_adj  := l_prev_adj  + l_adj_in;

    -- Balance walks down toward 0 as payments/adjustments accumulate
    l_balance := l_orig - l_new_paid - ABS(l_new_adj);
    IF l_balance <= 0 THEN
        l_status  := 'Closed';
        l_closed  := SYSDATE;
        l_balance := 0;
    ELSE
        l_status  := 'Open';
        l_closed  := NULL;
    END IF;

    UPDATE RR_AR_INVOICE_INSTALLMENTS
       SET AMOUNT_PAID                    = l_new_paid,
           INSTALLMENT_AMOUNT_ADJUSTED    = l_new_adj,
           INSTALLMENT_BALANCE_DUE        = l_balance,
           ACCOUNTED_BALANCE_DUE          = l_balance,
           INSTALLMENT_LINE_AMOUNT_DUE    = l_balance,
           INSTALLMENT_FREIGHT_AMOUNT_DUE = CASE WHEN l_status = 'Closed' THEN 0 ELSE INSTALLMENT_FREIGHT_AMOUNT_DUE END,
           INSTALLMENT_TAX_AMOUNT_DUE     = CASE WHEN l_status = 'Closed' THEN 0 ELSE INSTALLMENT_TAX_AMOUNT_DUE END,
           INSTALLMENT_STATUS             = l_status,
           INSTALLMENT_CLOSED_DATE        = l_closed,
           INSTALLMENT_GL_CLOSED_DATE     = l_closed,
           LAST_UPDATED_BY                = l_updated_by,
           LAST_UPDATE_DATE               = SYSDATE
     WHERE INSTALLMENT_ID = l_inst_id
       AND CUSTOMER_TRANSACTION_ID = l_txn_id;

    l_rows := SQL%ROWCOUNT;

    IF l_rows = 0 THEN
        :status := 404;
        APEX_JSON.open_object;
        APEX_JSON.write('status',  'error');
        APEX_JSON.write('message', 'Installment not found: id=' || l_inst_id || ' txn_id=' || l_txn_id);
        APEX_JSON.close_object;
    ELSE
        COMMIT;
        :status := 200;
        APEX_JSON.open_object;
        APEX_JSON.write('status',           'success');
        APEX_JSON.write('installmentId',     l_inst_id);
        APEX_JSON.write('txnId',             l_txn_id);
        APEX_JSON.write('paymentApplied',    l_pay_in);
        APEX_JSON.write('previousPaid',      l_prev_paid);
        APEX_JSON.write('amountPaid',        l_new_paid);
        APEX_JSON.write('amountAdjusted',    l_new_adj);
        APEX_JSON.write('remainingBalance',  l_balance);
        APEX_JSON.write('installmentStatus', l_status);
        APEX_JSON.write('closedDate',        l_closed);
        APEX_JSON.write('rowsUpdated',       l_rows);
        APEX_JSON.close_object;
    END IF;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        :status := 404;
        APEX_JSON.open_object;
        APEX_JSON.write('status',  'error');
        APEX_JSON.write('message', 'Installment not found: id=' || l_inst_id || ' txn_id=' || l_txn_id);
        APEX_JSON.close_object;
    WHEN OTHERS THEN
        ROLLBACK;
        :status := 500;
        APEX_JSON.open_object;
        APEX_JSON.write('status',  'error');
        APEX_JSON.write('message', SQLERRM);
        APEX_JSON.close_object;
END;]'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- PUT {base}/ar/invoices/{txnId}/installments/{installmentId}
--   Body: { "AmountPaid": n, "InstallmentAmountAdjusted": n, "LastUpdatedBy": "..." }
--   Adds the amounts onto the running totals and recomputes the balance
--   (ORIGINAL - total paid - |total adjusted|), closing the installment at 0.
-- =====================================================
