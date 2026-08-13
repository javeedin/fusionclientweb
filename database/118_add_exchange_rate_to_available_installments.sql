-- ============================================================
-- 118_add_exchange_rate_to_available_installments.sql
-- Adds EXCHANGE_RATE to the ap/payments/available-installments
-- ORDS handler so the UI can compute FX gain/loss per invoice.
-- ============================================================
-- Run in SQL Developer against the BCLDIFC schema.

BEGIN
  ORDS.DELETE_HANDLER(
    p_module_name => 'ap',
    p_pattern     => 'payments/available-installments',
    p_method      => 'GET'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'ap',
    p_pattern        => 'payments/available-installments',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_items_per_page => 0,
    p_comments       => 'Available invoice installments for payment, including invoice exchange rate',
    p_source         => q'[
SELECT
    inst.INSTALLMENT_ID            AS installment_id,
    inst.INVOICE_ID                AS invoice_id,
    inst.INSTALLMENT_NUMBER        AS installment_number,
    i.INVOICE_NUMBER               AS invoice_number,
    TO_CHAR(i.INVOICE_DATE,  'YYYY-MM-DD') AS invoice_date,
    TO_CHAR(inst.DUE_DATE,   'YYYY-MM-DD') AS due_date,
    i.INVOICE_AMOUNT               AS invoice_amount,
    inst.GROSS_AMOUNT              AS installment_amount,
    -- unpaid = installment gross minus active (non-voided) payments on this installment
    GREATEST(0,
        NVL(inst.GROSS_AMOUNT, 0) -
        NVL((
            SELECT SUM(NVL(rel.AMOUNT_PAID_PAYMENT_CURRENCY, 0))
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
            JOIN   RR_AP_PAYMENTS_ALL              pmt ON pmt.CHECK_ID = rel.CHECK_ID
            WHERE  rel.INVOICE_ID         = inst.INVOICE_ID
              AND  rel.INSTALLMENT_NUMBER = inst.INSTALLMENT_NUMBER
              AND  NVL(pmt.PAYMENT_STATUS, 'Active') NOT IN ('Voided', 'Void')
        ), 0)
    )                              AS unpaid_amount,
    i.INVOICE_CURRENCY             AS invoice_currency,
    i.PAYMENT_CURRENCY             AS payment_currency,
    i.CONVERSION_RATE              AS exchange_rate,
    i.DESCRIPTION                  AS description,
    i.SUPPLIER_NUMBER              AS supplier_number,
    i.SUPPLIER                     AS supplier,
    i.SUPPLIER_SITE                AS supplier_site,
    i.BUSINESS_UNIT                AS business_unit,
    i.LIABILITY_DISTRIBUTION       AS liability_distribution,
    inst.PAYMENT_METHOD            AS payment_method,
    TO_CHAR(inst.DUE_DATE, 'YYYY-MM-DD') AS due_date_fmt
FROM  RR_AP_INVOICE_INSTALLMENTS inst
JOIN  RR_AP_INVOICES_ALL         i   ON i.INVOICE_ID = inst.INVOICE_ID
WHERE NVL(i.CANCELED_FLAG, 'N') != 'Y'
  AND (i.SUPPLIER_NUMBER = :supplier_number  OR :supplier_number  IS NULL)
  AND i.BUSINESS_UNIT   = :business_unit
  AND (UPPER(i.INVOICE_NUMBER) LIKE '%' || UPPER(:invoice_number) || '%'
       OR :invoice_number IS NULL)
  AND (i.INVOICE_ID      = :invoice_id       OR :invoice_id       IS NULL)
  -- exclude invoices whose overall balance is zero:
  AND NVL(i.INVOICE_AMOUNT, 0) > (
        SELECT NVL(SUM(NVL(rel.AMOUNT_PAID_INVOICE_CURRENCY, 0)
                       + NVL(rel.DISCOUNT_TAKEN, 0)), 0)
        FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
        JOIN   RR_AP_PAYMENTS_ALL              pmt ON pmt.CHECK_ID = rel.CHECK_ID
        WHERE  rel.INVOICE_ID = i.INVOICE_ID
          AND  NVL(pmt.PAYMENT_STATUS,          'Active') NOT IN ('Voided', 'Void')
          AND  NVL(rel.INVOICE_PAYMENT_STATUS,  'Active') NOT IN ('Voided', 'Void')
      )
  -- only installments with remaining balance
  AND GREATEST(0,
        NVL(inst.GROSS_AMOUNT, 0) -
        NVL((
            SELECT SUM(NVL(rel.AMOUNT_PAID_PAYMENT_CURRENCY, 0))
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
            JOIN   RR_AP_PAYMENTS_ALL              pmt ON pmt.CHECK_ID = rel.CHECK_ID
            WHERE  rel.INVOICE_ID         = inst.INVOICE_ID
              AND  rel.INSTALLMENT_NUMBER = inst.INSTALLMENT_NUMBER
              AND  NVL(pmt.PAYMENT_STATUS, 'Active') NOT IN ('Voided', 'Void')
        ), 0)
      ) > 0
ORDER BY i.INVOICE_DATE DESC, inst.INVOICE_ID, inst.INSTALLMENT_NUMBER
]'
  );
  COMMIT;
END;
/
