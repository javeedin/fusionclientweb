-- =============================================================================
-- GET reerp/ap/invoices/aging-data
-- Returns all invoices with a non-zero outstanding balance for use by the
-- Supplier Aging reports.
--
-- Key design: reads directly from RR_AP_INVOICES_ALL (LEFT JOIN to
-- RR_SUPPLIER_MASTER).  Suppliers that exist in invoices but NOT in the
-- supplier master still appear — their supplier_number is used as the name.
-- This fixes the gap where the old two-step approach (suppliers list → per-
-- supplier invoice fetch) silently dropped suppliers missing from master.
--
-- Parameters (all optional):
--   P_BUSINESS_UNIT  – filter by AP business unit
--   supplier_number  – filter by a single supplier
--
-- Outstanding balance formula (credit-note aware):
--   positive invoices: GREATEST(0, invoice_amount - cash_paid - prepayments)
--   credit notes      : invoice_amount - cash_paid - prepayments  (can be < 0)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop existing template (idempotent)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ap/invoices/aging-data');
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
        p_pattern     => 'ap/invoices/aging-data',
        p_comments    => 'Outstanding AP invoices for aging report — reads from invoice data, not supplier master'
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
        p_pattern        => 'ap/invoices/aging-data',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_comments       => 'All invoices with non-zero outstanding balance for aging',
        p_source         => q'[
SELECT *
FROM (
    SELECT
        i.SUPPLIER_NUMBER                                                        AS supplier_number,
        NVL(NVL(sm.SUPPLIER, i.SUPPLIER), i.SUPPLIER_NUMBER)                   AS supplier_name,
        i.INVOICE_ID                                                             AS invoice_id,
        i.INVOICE_NUMBER                                                         AS invoice_number,
        TO_CHAR(i.INVOICE_DATE,  'YYYY-MM-DD')                                  AS invoice_date,
        TO_CHAR(NVL(i.TERMS_DATE, i.INVOICE_DATE), 'YYYY-MM-DD')               AS due_date,
        NVL(i.INVOICE_AMOUNT, 0)                                                AS invoice_amount,
        NVL(pay_sum.total_paid,   0) + NVL(prep_sum.total_applied, 0)          AS amount_paid,
        -- Credit notes keep their negative balance; positive invoices clamped at 0
        CASE
            WHEN NVL(i.INVOICE_AMOUNT, 0) < 0
            THEN NVL(i.INVOICE_AMOUNT, 0)
                 - NVL(pay_sum.total_paid,   0)
                 - NVL(prep_sum.total_applied, 0)
            ELSE GREATEST(0,
                     NVL(i.INVOICE_AMOUNT, 0)
                     - NVL(pay_sum.total_paid,   0)
                     - NVL(prep_sum.total_applied, 0))
        END                                                                      AS amount_remaining,
        i.INVOICE_CURRENCY                                                       AS invoice_currency,
        i.INVOICE_TYPE                                                           AS invoice_type,
        i.BUSINESS_UNIT                                                          AS business_unit,
        i.PAID_STATUS                                                            AS paid_status
    FROM RR_AP_INVOICES_ALL i
    LEFT JOIN RR_SUPPLIER_MASTER sm ON sm.SUPPLIER_NUMBER = i.SUPPLIER_NUMBER
    -- Cash payments + discount taken per invoice (non-voided)
    LEFT JOIN (
        SELECT ri.INVOICE_ID,
               SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)
                   + NVL(ri.DISCOUNT_TAKEN, 0))                                 AS total_paid
        FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
        JOIN   RR_AP_PAYMENTS_ALL              p  ON p.CHECK_ID = ri.CHECK_ID
        WHERE  NVL(p.PAYMENT_STATUS,          'Active') NOT IN ('Voided', 'Void')
        AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') NOT IN ('Voided', 'Void')
        GROUP BY ri.INVOICE_ID
    ) pay_sum  ON pay_sum.INVOICE_ID  = i.INVOICE_ID
    -- Prepayment applications per invoice (non-cancelled)
    LEFT JOIN (
        SELECT ap.INVOICE_ID,
               SUM(NVL(ap.APPLIED_AMOUNT, 0))                                   AS total_applied
        FROM   RR_AP_APPLIED_PREPAYMENTS ap
        WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
        GROUP BY ap.INVOICE_ID
    ) prep_sum ON prep_sum.INVOICE_ID = i.INVOICE_ID
    WHERE NVL(i.CANCELED_FLAG,  'N')      != 'Y'
    AND   NVL(i.INVOICE_TYPE, 'Standard') != 'Prepayment'
    AND   (:P_BUSINESS_UNIT IS NULL OR i.BUSINESS_UNIT    = :P_BUSINESS_UNIT)
    AND   (:supplier_number IS NULL OR i.SUPPLIER_NUMBER  = :supplier_number)
)
WHERE amount_remaining <> 0
ORDER BY supplier_number, invoice_date DESC
]'
    );
    COMMIT;
END;
/

-- ---------------------------------------------------------------------------
-- 4. Parameters
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'ap/invoices/aging-data',
        p_method             => 'GET',
        p_name               => 'P_BUSINESS_UNIT',
        p_bind_variable_name => 'P_BUSINESS_UNIT',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_PARAMETER(
        p_module_name        => 'reerp',
        p_pattern            => 'ap/invoices/aging-data',
        p_method             => 'GET',
        p_name               => 'supplier_number',
        p_bind_variable_name => 'supplier_number',
        p_source_type        => 'URI',
        p_param_type         => 'STRING',
        p_access_method      => 'IN'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ---------------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------------
SELECT t.uri_template, h.method, h.source_type, h.items_per_page
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id  = t.module_id
JOIN   user_ords_handlers  h ON t.id  = h.template_id
WHERE  m.name         = 'reerp'
AND    t.uri_template = 'ap/invoices/aging-data';
