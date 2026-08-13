-- ============================================================
-- 122_available_installments_include_credit_memos.sql
-- Show credit memos (negative amounts) in the "Select Invoices to Pay" list.
--
-- Problem:
--   GET ap/payments/available-installments excluded credit memos because it was
--   written for positive invoices only:
--     1. unpaid_amount = GREATEST(0, gross - paid)  → clamps a credit's negative
--        remaining to 0.
--     2. WHERE INVOICE_AMOUNT > paid                → false for a negative amount.
--     3. WHERE GREATEST(0, gross - paid) > 0        → 0 for a negative gross.
--
-- Fix (sign-aware — works for both invoices and credit memos):
--   • unpaid_amount keeps its sign: gross - paid (positive for invoices, negative
--     for credit memos).
--   • "still open" test becomes (amount - paid) * SIGN(amount) > 0, i.e. the
--     remaining still has the same sign as the original amount (not fully applied).
--   Positive-invoice behaviour is unchanged (SIGN = +1 reduces to the old test).
--
-- Run in SQL Developer / APEX SQL Commands against the BCLDIFC schema.
-- ============================================================

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
    p_comments       => 'Available invoice installments for payment — includes credit memos (patch 122)',
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
    -- unpaid = installment gross minus active (non-voided) payments on this
    -- installment; keeps its sign so credit memos show a negative available amount.
    (
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
  AND (i.PAYMENT_CURRENCY = :payment_currency OR :payment_currency IS NULL)
  -- invoice still has an open balance in its own sign direction
  -- (positive invoice not fully paid, OR credit memo not fully applied):
  AND (
        NVL(i.INVOICE_AMOUNT, 0) - (
          SELECT NVL(SUM(NVL(rel.AMOUNT_PAID_INVOICE_CURRENCY, 0)
                         + NVL(rel.DISCOUNT_TAKEN, 0)), 0)
          FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
          JOIN   RR_AP_PAYMENTS_ALL              pmt ON pmt.CHECK_ID = rel.CHECK_ID
          WHERE  rel.INVOICE_ID = i.INVOICE_ID
            AND  NVL(pmt.PAYMENT_STATUS,          'Active') NOT IN ('Voided', 'Void')
            AND  NVL(rel.INVOICE_PAYMENT_STATUS,  'Active') NOT IN ('Voided', 'Void')
        )
      ) * SIGN(NVL(i.INVOICE_AMOUNT, 0)) > 0
  -- installment still has a remaining balance in its own sign direction
  AND (
        NVL(inst.GROSS_AMOUNT, 0) -
        NVL((
            SELECT SUM(NVL(rel.AMOUNT_PAID_PAYMENT_CURRENCY, 0))
            FROM   RR_AP_PAYMENTS_RELATED_INVOICES rel
            JOIN   RR_AP_PAYMENTS_ALL              pmt ON pmt.CHECK_ID = rel.CHECK_ID
            WHERE  rel.INVOICE_ID         = inst.INVOICE_ID
              AND  rel.INSTALLMENT_NUMBER = inst.INSTALLMENT_NUMBER
              AND  NVL(pmt.PAYMENT_STATUS, 'Active') NOT IN ('Voided', 'Void')
        ), 0)
      ) * SIGN(NVL(inst.GROSS_AMOUNT, 0)) > 0
ORDER BY i.INVOICE_DATE DESC, inst.INVOICE_ID, inst.INSTALLMENT_NUMBER
]'
  );
  COMMIT;
END;
/
