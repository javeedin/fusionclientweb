-- =====================================================
-- GET Handler for /ap/createinvoice
-- =====================================================
-- Purpose: Search AP Invoices from RR_AP_INVOICES_ALL
--          Returns accounting_status (live from RR_SLA_ACCOUNTING_HEADERS)
--          and applied_prepayments
-- Filters:  supplier_number, business_unit, invoice_number, supplier, invoice_date_from/to, invoice_amount, supplier_site, invoice_group, invoice_type
-- =====================================================

-- =====================================================
-- 1. Ensure template exists
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'createinvoice');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'createinvoice',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'AP Invoice search — GET list, POST creates via createinvoicefull'
    );
    COMMIT;
END;
/

-- =====================================================
-- 2. GET Handler
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'createinvoice',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_comments       => 'Search AP Invoices with accounting status and applied prepayments',
        p_source         => q'[
SELECT
    i.invoice_id,
    i.invoice_number,
    i.invoice_currency,
    i.payment_currency,
    i.invoice_amount,
    TO_CHAR(i.invoice_date, 'YYYY-MM-DD')        AS invoice_date,
    TO_CHAR(i.creation_date, 'YYYY-MM-DD')       AS creation_date,
    i.business_unit,
    i.legal_entity,
    i.supplier,
    i.supplier_number,
    i.supplier_site,
    i.invoice_group,
    i.invoice_source,
    i.invoice_type,
    i.description,
    TO_CHAR(i.accounting_date, 'YYYY-MM-DD')     AS accounting_date,
    TO_CHAR(i.terms_date, 'YYYY-MM-DD')          AS terms_date,
    TO_CHAR(i.goods_received_date, 'YYYY-MM-DD') AS goods_received_date,
    i.pay_group,
    i.payment_terms,
    i.payment_method,
    -- amount_paid = cash payments + applied prepayments
    NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0)  AS amount_paid,
    -- unpaid = invoice minus (cash payments + applied prepayments)
    -- Credit notes (invoice_amount < 0) keep their negative balance; GREATEST(0) is only
    -- applied to positive invoices to prevent negative unpaid on overpayment.
    CASE
        WHEN NVL(i.invoice_amount, 0) < 0 THEN
            NVL(i.invoice_amount, 0)
            - NVL(pay.total_paid, NVL(i.amount_paid, 0))
            - NVL(prep.total_prep, 0)
        ELSE
            GREATEST(0,
                NVL(i.invoice_amount, 0)
                - NVL(pay.total_paid, NVL(i.amount_paid, 0))
                - NVL(prep.total_prep, 0)
            )
    END AS unpaid_amount,
    -- paid status: cancelled takes priority, then computed from payments
    -- Credit notes use reversed comparison (amount is negative, payments reduce toward 0)
    CASE
        WHEN NVL(i.canceled_flag, 'N') = 'Y'     THEN 'Cancelled'
        WHEN NVL(i.invoice_amount, 0) = 0         THEN NVL(i.paid_status, 'Unpaid')
        WHEN NVL(i.invoice_amount, 0) < 0         THEN
            -- Credit note: "paid" means credit has been applied or refunded
            CASE
                WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
                     <= NVL(i.invoice_amount, 0)                             THEN 'Fully Paid'
                WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
                     < 0                                                      THEN 'Partially Paid'
                ELSE NVL(i.paid_status, 'Unpaid')
            END
        WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
             >= NVL(i.invoice_amount, 0)                                     THEN 'Fully Paid'
        WHEN (NVL(pay.total_paid, NVL(i.amount_paid, 0)) + NVL(prep.total_prep, 0))
             > 0                                                              THEN 'Partially Paid'
        ELSE NVL(i.paid_status, 'Unpaid')
    END AS paid_status,
    i.canceled_flag,
    TO_CHAR(NVL(i.canceled_date, i.cancellation_date), 'YYYY-MM-DD') AS canceled_date,
    NVL(i.canceled_by, i.cancelled_by)                               AS canceled_by,
    i.validation_status,
    i.approval_status,
    (SELECT h.accounting_status
     FROM   RR_SLA_ACCOUNTING_HEADERS h
     WHERE  h.source_table = 'AP_INVOICES'
       AND  h.source_id    = i.invoice_id
     ORDER BY h.header_id DESC
     FETCH FIRST 1 ROWS ONLY)                      AS accounting_status,
    TO_CHAR(i.apply_after_date, 'YYYY-MM-DD')    AS apply_after_date,
    NVL(prep.total_prep, 0)                       AS applied_prepayments,
    i.liability_distribution,
    CASE WHEN EXISTS (
        SELECT 1 FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE m
        WHERE m.invoice_id = i.invoice_id
    ) THEN 'Y' ELSE 'N' END                        AS has_mpa
FROM  RR_AP_INVOICES_ALL i
-- Cash payments + discount taken rolled up per invoice
LEFT JOIN (
    SELECT INVOICE_ID,
           SUM(NVL(AMOUNT_PAID_PAYMENT_CURRENCY, 0) + NVL(DISCOUNT_TAKEN, 0)) AS total_paid
    FROM   RR_AP_PAYMENTS_RELATED_INVOICES
    GROUP BY INVOICE_ID
) pay  ON pay.INVOICE_ID  = i.invoice_id
-- Prepayment applications rolled up per invoice
LEFT JOIN (
    SELECT INVOICE_ID,
           SUM(NVL(applied_amount, 0)) AS total_prep
    FROM   RR_AP_APPLIED_PREPAYMENTS
    WHERE  status = 'Applied'
    GROUP BY INVOICE_ID
) prep ON prep.INVOICE_ID = i.invoice_id
WHERE (i.supplier_number  = :supplier_number  OR :supplier_number  IS NULL)
  AND (i.business_unit    = :business_unit    OR :business_unit    IS NULL)
  AND (UPPER(i.invoice_number) LIKE '%' || UPPER(:invoice_number) || '%'
       OR :invoice_number IS NULL)
  AND (UPPER(i.supplier)  LIKE '%' || UPPER(:supplier) || '%'
       OR :supplier IS NULL)
  AND (TRUNC(i.invoice_date) >= TO_DATE(:invoice_date_from, 'YYYY-MM-DD') OR :invoice_date_from IS NULL)
  AND (TRUNC(i.invoice_date) <= TO_DATE(:invoice_date_to,   'YYYY-MM-DD') OR :invoice_date_to   IS NULL)
  AND (i.invoice_amount   = :invoice_amount   OR :invoice_amount   IS NULL)
  AND (i.supplier_site    = :supplier_site    OR :supplier_site    IS NULL)
  AND (UPPER(i.invoice_group) LIKE '%' || UPPER(:invoice_group) || '%'
       OR :invoice_group IS NULL)
  AND (i.invoice_id       = :invoice_id       OR :invoice_id       IS NULL)
  AND (i.invoice_type     = :invoice_type     OR :invoice_type     IS NULL)
ORDER BY i.invoice_date DESC, i.invoice_id DESC
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. Verify
-- =====================================================
SELECT module_name, uri_template, method, source_type
FROM   user_ords_handlers
WHERE  module_name   = 'ap'
  AND  uri_template  = 'createinvoice'
ORDER BY method;
