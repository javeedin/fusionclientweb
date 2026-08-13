-- ============================================================
-- PUT /ar/invoices/:id/installments/:installmentId
-- Updates AMOUNT_PAID and INSTALLMENT_AMOUNT_ADJUSTED on
-- RR_AR_INVOICE_INSTALLMENTS for a specific installment.
--
-- JSON Body:
-- {
--   "AmountPaid":                <number>,
--   "InstallmentAmountAdjusted": <number>,   -- can be negative
--   "LastUpdatedBy":             <string>
-- }
-- ============================================================

-- Step 1: Register child template
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/installments/:installmentId',
        p_comments       => 'Single AR invoice installment — update paid/adjusted amounts'
    );
    COMMIT;
END;
/

-- Step 2: GET handler — fetch single installment with current balance
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/installments/:installmentId',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_comments       => 'Get single installment with balance fields',
        p_source         => q'[
DECLARE
    l_txn_id       NUMBER := :id;
    l_inst_id      NUMBER := :installmentId;
    l_paid         NUMBER;
    l_adj          NUMBER;
    l_orig         NUMBER;
    l_calc_balance NUMBER;
    l_calc_status  VARCHAR2(30);
    l_closed_date  DATE;
BEGIN
    APEX_JSON.open_object;
    FOR r IN (
        SELECT INSTALLMENT_ID,
               CUSTOMER_TRX_ID,
               INSTALLMENT_SEQUENCE_NUMBER,
               INSTALLMENT_DUE_DATE,
               INSTALLMENT_LINE_AMOUNT_ORIGINAL,
               INSTALLMENT_BALANCE_DUE,
               AMOUNT_PAID,
               INSTALLMENT_AMOUNT_ADJUSTED,
               INSTALLMENT_STATUS,
               INSTALLMENT_CLOSED_DATE,
               INSTALLMENT_GL_CLOSED_DATE,
               ORIGINAL_AMOUNT,
               LAST_UPDATE_DATE,
               LAST_UPDATED_BY
        FROM   RR_AR_INVOICE_INSTALLMENTS
        WHERE  INSTALLMENT_ID   = l_inst_id
          AND  CUSTOMER_TRX_ID = l_txn_id
    ) LOOP
        l_paid  := NVL(r.AMOUNT_PAID, 0);
        l_adj   := NVL(r.INSTALLMENT_AMOUNT_ADJUSTED, 0);
        l_orig  := NVL(r.INSTALLMENT_LINE_AMOUNT_ORIGINAL, NVL(r.ORIGINAL_AMOUNT, 0));

        -- Calculate live balance
        l_calc_balance := l_orig - l_paid - ABS(l_adj);

        -- Derive status using same rule as PUT
        IF (l_paid + ABS(l_adj)) >= l_orig THEN
            l_calc_status := 'Closed';
            l_closed_date := NVL(r.INSTALLMENT_CLOSED_DATE, SYSDATE);
        ELSE
            l_calc_status := 'Open';
            l_closed_date := NULL;
        END IF;

        APEX_JSON.write('installmentId',         r.INSTALLMENT_ID);
        APEX_JSON.write('customerTrxId',         r.CUSTOMER_TRX_ID);
        APEX_JSON.write('sequenceNumber',        r.INSTALLMENT_SEQUENCE_NUMBER);
        APEX_JSON.write('dueDate',               r.INSTALLMENT_DUE_DATE);
        APEX_JSON.write('originalAmount',        l_orig);
        APEX_JSON.write('amountPaid',            l_paid);
        APEX_JSON.write('amountAdjusted',        l_adj);
        APEX_JSON.write('calculatedBalance',     l_calc_balance);
        APEX_JSON.write('storedBalanceDue',      r.INSTALLMENT_BALANCE_DUE);
        APEX_JSON.write('installmentStatus',     l_calc_status);
        APEX_JSON.write('storedStatus',          r.INSTALLMENT_STATUS);
        APEX_JSON.write('closedDate',            l_closed_date);
        APEX_JSON.write('glClosedDate',          r.INSTALLMENT_GL_CLOSED_DATE);
        APEX_JSON.write('lastUpdateDate',        r.LAST_UPDATE_DATE);
        APEX_JSON.write('lastUpdatedBy',         r.LAST_UPDATED_BY);
    END LOOP;
    APEX_JSON.close_object;
END;
]'
    );
    COMMIT;
END;
/

-- Step 3: PUT handler
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:id/installments/:installmentId',
        p_method         => 'PUT',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Update AMOUNT_PAID and INSTALLMENT_AMOUNT_ADJUSTED for a specific installment',
        p_source         => q'[
DECLARE
    l_body                      CLOB         := :body_text;
    l_txn_id                    NUMBER       := :id;
    l_inst_id                   NUMBER       := :installmentId;
    l_amount_paid               NUMBER;
    l_amount_adj                NUMBER;
    l_updated_by                VARCHAR2(240);
    l_rows_updated              NUMBER;
    l_orig_amount               NUMBER;
    l_new_status                VARCHAR2(30);
    l_closed_date               DATE;
    l_remaining_balance         NUMBER;
BEGIN
    APEX_JSON.parse(l_body);

    l_amount_paid := APEX_JSON.get_number(p_path => 'AmountPaid');
    l_amount_adj  := NVL(APEX_JSON.get_number(p_path => 'InstallmentAmountAdjusted'), 0);
    l_updated_by  := NVL(APEX_JSON.get_varchar2(p_path => 'LastUpdatedBy'), 'REERP');

    -- Fetch original line amount
    SELECT NVL(INSTALLMENT_LINE_AMOUNT_ORIGINAL, 0)
    INTO   l_orig_amount
    FROM   RR_AR_INVOICE_INSTALLMENTS
    WHERE  INSTALLMENT_ID  = l_inst_id
      AND  CUSTOMER_TRX_ID = l_txn_id;

    -- Remaining balance = Original - Paid - ABS(Adjusted)
    l_remaining_balance := l_orig_amount - l_amount_paid - ABS(l_amount_adj);

    -- Determine status: Closed when fully paid/adjusted
    IF (l_amount_paid + ABS(l_amount_adj)) >= l_orig_amount THEN
        l_new_status        := 'Closed';
        l_closed_date       := SYSDATE;
        l_remaining_balance := 0;
    ELSE
        l_new_status  := 'Open';
        l_closed_date := NULL;
    END IF;

    UPDATE RR_AR_INVOICE_INSTALLMENTS
    SET    AMOUNT_PAID                    = l_amount_paid,
           INSTALLMENT_AMOUNT_ADJUSTED    = l_amount_adj,
           -- Balance columns: 0 when closed, remaining balance when open
           INSTALLMENT_BALANCE_DUE        = l_remaining_balance,
           ACCOUNTED_BALANCE_DUE          = l_remaining_balance,
           INSTALLMENT_LINE_AMOUNT_DUE    = l_remaining_balance,
           -- Freight and Tax go to 0 when closed, unchanged when open
           INSTALLMENT_FREIGHT_AMOUNT_DUE = CASE WHEN l_new_status = 'Closed' THEN 0 ELSE INSTALLMENT_FREIGHT_AMOUNT_DUE END,
           INSTALLMENT_TAX_AMOUNT_DUE     = CASE WHEN l_new_status = 'Closed' THEN 0 ELSE INSTALLMENT_TAX_AMOUNT_DUE END,
           -- Status and close dates
           INSTALLMENT_STATUS             = l_new_status,
           INSTALLMENT_CLOSED_DATE        = l_closed_date,
           INSTALLMENT_GL_CLOSED_DATE     = l_closed_date,
           LAST_UPDATED_BY                = l_updated_by,
           LAST_UPDATE_DATE               = SYSDATE
    WHERE  INSTALLMENT_ID                = l_inst_id
      AND  CUSTOMER_TRX_ID              = l_txn_id;

    l_rows_updated := SQL%ROWCOUNT;

    IF l_rows_updated = 0 THEN
        :status := 404;
        APEX_JSON.open_object;
        APEX_JSON.write('status',  'error');
        APEX_JSON.write('message', 'Installment not found: id=' || l_inst_id || ' txn_id=' || l_txn_id);
        APEX_JSON.close_object;
    ELSE
        COMMIT;
        :status := 200;
        APEX_JSON.open_object;
        APEX_JSON.write('status',              'success');
        APEX_JSON.write('installmentId',        l_inst_id);
        APEX_JSON.write('txnId',                l_txn_id);
        APEX_JSON.write('amountPaid',           l_amount_paid);
        APEX_JSON.write('amountAdjusted',       l_amount_adj);
        APEX_JSON.write('remainingBalance',     l_remaining_balance);
        APEX_JSON.write('installmentStatus',    l_new_status);
        APEX_JSON.write('closedDate',           l_closed_date);
        APEX_JSON.write('rowsUpdated',          l_rows_updated);
        APEX_JSON.close_object;
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status := 500;
        APEX_JSON.open_object;
        APEX_JSON.write('status',  'error');
        APEX_JSON.write('message', SQLERRM);
        APEX_JSON.close_object;
END;
]'
    );
    COMMIT;
END;
/
