-- =============================================================================
-- GET reerp/ap/invoices/stats
-- Payables Dashboard KPI statistics
--
-- Module  : reerp   (base path /reerp/)
-- Pattern : ap/invoices/stats
-- Full URL: .../ords/bcldifc/reerp/ap/invoices/stats
--
-- Outstanding balance = invoice_amount
--                       - SUM(AMOUNT_PAID_INVOICE_CURRENCY + DISCOUNT_TAKEN)  ← cash + discount
--                       - SUM(prepayment applications)
--
-- Parameters (all optional):
--   P_BUSINESS_UNIT – filter by AP business unit
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop existing templates (idempotent — handles both old 'ap' and 'reerp')
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/invoices/stats');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'invoices/stats');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ---------------------------------------------------------------------------
-- 2. Define template
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/invoices/stats',
        p_comments    => 'Payables Dashboard KPI statistics'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 3. GET handler
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/invoices/stats',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Payables dashboard KPIs — actual balance from payment + discount + prepayment tables',
        p_source         => q'[
DECLARE
    v_pending_invoices  NUMBER := 0;
    v_approved_invoices NUMBER := 0;
    v_pending_payments  NUMBER := 0;
    v_overdue_payments  NUMBER := 0;
    v_total_outstanding NUMBER := 0;
    v_total_invoices    NUMBER := 0;
    v_last_sync_date    VARCHAR2(30) := 'N/A';
BEGIN
    -- outstanding = invoice_amount
    --               - SUM(AMOUNT_PAID_INVOICE_CURRENCY + DISCOUNT_TAKEN, excl. voided)
    --               - SUM(prepayment applications, excl. cancelled)
    SELECT
        NVL(SUM(CASE WHEN NVL(i.validation_status, 'Never Validated') NOT IN ('Validated')
                     THEN 1 ELSE 0 END), 0),
        NVL(SUM(CASE WHEN i.validation_status = 'Validated'
                       OR i.approval_status   = 'Approved'
                     THEN 1 ELSE 0 END), 0),
        NVL(SUM(CASE WHEN NVL(i.paid_status, 'Unpaid') NOT IN ('Paid', 'Cancelled')
                     THEN 1 ELSE 0 END), 0),
        NVL(SUM(CASE WHEN NVL(i.paid_status, 'Unpaid') NOT IN ('Paid', 'Cancelled')
                      AND i.terms_date IS NOT NULL
                      AND i.terms_date < TRUNC(SYSDATE)
                     THEN 1 ELSE 0 END), 0),
        NVL(SUM(CASE WHEN NVL(i.paid_status, 'Unpaid') NOT IN ('Paid', 'Cancelled')
                     THEN GREATEST(0,
                              NVL(i.invoice_amount,         0)
                            - NVL(pay_sum.total_paid,       0)
                            - NVL(prep_sum.total_applied,   0))
                     ELSE 0 END), 0),
        COUNT(i.invoice_id),
        NVL(TO_CHAR(MAX(i.creation_date), 'YYYY-MM-DD HH24:MI:SS'), 'N/A')
    INTO
        v_pending_invoices, v_approved_invoices, v_pending_payments,
        v_overdue_payments, v_total_outstanding, v_total_invoices, v_last_sync_date
    FROM RR_AP_INVOICES_ALL i
    -- cash payments per invoice: amount paid + discount taken (both reduce the liability)
    -- No filter on AMOUNT_PAID_INVOICE_CURRENCY > 0 — a row may have only DISCOUNT_TAKEN
    LEFT JOIN (
        SELECT ri.INVOICE_ID,
               SUM(  NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)
                   + NVL(ri.DISCOUNT_TAKEN, 0))              AS total_paid
        FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
        JOIN   RR_AP_PAYMENTS_ALL              p  ON p.CHECK_ID = ri.CHECK_ID
        WHERE  NVL(p.PAYMENT_STATUS,          'X') != 'Voided'
        AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'X') != 'Voided'
        GROUP BY ri.INVOICE_ID
    ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
    -- prepayment applications per invoice (exclude cancelled)
    LEFT JOIN (
        SELECT ap.INVOICE_ID,
               SUM(NVL(ap.APPLIED_AMOUNT, 0))                AS total_applied
        FROM   RR_AP_APPLIED_PREPAYMENTS ap
        WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
        GROUP BY ap.INVOICE_ID
    ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
    WHERE NVL(i.CANCELED_FLAG,  'N')      != 'Y'
    AND   NVL(i.INVOICE_TYPE, 'Standard') != 'Prepayment'
    AND   (:P_BUSINESS_UNIT IS NULL OR i.business_unit = :P_BUSINESS_UNIT);

    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN(
        JSON_OBJECT(
            'pending_invoices'  VALUE v_pending_invoices,
            'approved_invoices' VALUE v_approved_invoices,
            'pending_payments'  VALUE v_pending_payments,
            'overdue_payments'  VALUE v_overdue_payments,
            'total_outstanding' VALUE v_total_outstanding,
            'total_invoices'    VALUE v_total_invoices,
            'last_sync_date'    VALUE v_last_sync_date
        )
    );
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, SUBSTR(h.source, 1, 80) src
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id  = t.module_id
JOIN   user_ords_handlers  h ON t.id  = h.template_id
WHERE  m.name         = 'reerp'
AND    t.uri_template = 'ap/invoices/stats'
ORDER  BY h.method;
