-- =============================================================================
-- ORDS Handler — GET /reerp/ap/reports/payables-ledger-recon
-- Payables to Ledger Reconciliation Summary
--
-- Module  : reerp   (base path /reerp/)
-- Pattern : ap/reports/payables-ledger-recon
-- Full URL: .../ords/bcldifc/reerp/ap/reports/payables-ledger-recon
--
-- Parameters (all optional):
--   P_BUSINESS_UNIT  – AP business unit  (e.g. 'BUIMERC CORP_DIFC_INVST')
--   P_COMPANY        – GL company segment (e.g. '01')
--   P_ACCOUNT        – GL account segment (e.g. '21100')
--   P_PERIOD         – GL period name    (e.g. 'Mar-26')
--
-- Tables used:
--   RR_AP_INVOICES_ALL              – AP invoice headers
--   RR_AP_PAYMENTS_ALL              – AP payments
--   RR_AP_PAYMENTS_RELATED_INVOICES – payment ↔ invoice link
--   RR_AP_APPLIED_PREPAYMENTS       – prepayment applications
--   RR_GL_BALANCES                  – GL opening/closing balances
--   RR_GL_JE_LINES_ALL              – GL journal lines
--   RR_GL_JE_HEADERS                – GL journal headers
--
-- Period dates are derived by parsing P_PERIOD ('Mon-YY' format) — no
-- RR_GL_FISCAL_PERIODS dependency.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop existing template (idempotent re-run)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/reports/payables-ledger-recon'
    );
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
        p_pattern     => 'ap/reports/payables-ledger-recon',
        p_comments    => 'Payables to Ledger Reconciliation — period summary'
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
        p_pattern        => 'ap/reports/payables-ledger-recon',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns payables + GL reconciliation amounts for the period',
        p_source         => q'[
DECLARE
  l_period_start DATE;
  l_period_end   DATE;

  -- Payables (AP subledger) amounts
  l_p_begin    NUMBER := 0;
  l_p_invoices NUMBER := 0;
  l_p_payments NUMBER := 0;
  l_p_prepay   NUMBER := 0;
  l_p_end      NUMBER := 0;

  -- GL (accounting) amounts
  l_gl_opening      NUMBER := 0;
  l_gl_closing      NUMBER := 0;
  l_gl_activity     NUMBER := 0;
  l_gl_ap_inv       NUMBER := 0;
  l_gl_ap_pay       NUMBER := 0;
  l_gl_non_ap       NUMBER := 0;
  l_gl_not_trans    NUMBER := 0;
  l_gl_not_posted   NUMBER := 0;
  l_gl_acc_variance NUMBER := 0;

  FUNCTION jn(p IN NUMBER) RETURN VARCHAR2 IS
    v VARCHAR2(100);
  BEGIN
    IF p IS NULL THEN RETURN '0'; END IF;
    v := TO_CHAR(p, 'TM9');
    IF v LIKE  '.%' THEN v := '0'  || v;  END IF;
    IF v LIKE '-.%' THEN v := '-0.' || SUBSTR(v, 3); END IF;
    RETURN v;
  END;

BEGIN
  -- ── 1. Derive period dates from period name (Mon-YY format, e.g. Mar-26) ──
  -- No dependency on RR_GL_FISCAL_PERIODS.
  BEGIN
    l_period_start := TRUNC(TO_DATE('01-' || :P_PERIOD, 'DD-Mon-RR'), 'MM');
    l_period_end   := LAST_DAY(l_period_start);
  EXCEPTION WHEN OTHERS THEN
    l_period_start := TRUNC(SYSDATE, 'MM');
    l_period_end   := LAST_DAY(SYSDATE);
  END;

  -- ── 2. Payables Begin Balance ──────────────────────────────────────────────
  -- Net AP liability before period start:
  --   invoices dated before period  MINUS  payments before period
  --   MINUS prepayments applied (no date column — deducted from begin estimate)
  SELECT NVL(SUM(
      NVL(i.INVOICE_AMOUNT, 0)
    - NVL(pay_sub.total_paid,     0)
    - NVL(prep_sub.total_applied, 0)
  ), 0)
  INTO l_p_begin
  FROM RR_AP_INVOICES_ALL i
  LEFT JOIN (
    SELECT ri.INVOICE_ID,
           SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)
             + NVL(ri.DISCOUNT_TAKEN, 0)) AS total_paid
    FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
    JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
    WHERE  p.PAYMENT_DATE < l_period_start
    AND    NVL(p.PAYMENT_STATUS,          'X') != 'Voided'
    AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'X') != 'Voided'
    AND    (:P_BUSINESS_UNIT IS NULL OR p.BUSINESS_UNIT = :P_BUSINESS_UNIT)
    GROUP BY ri.INVOICE_ID
  ) pay_sub  ON pay_sub.INVOICE_ID  = i.INVOICE_ID
  LEFT JOIN (
    SELECT ap.INVOICE_ID,
           SUM(NVL(ap.APPLIED_AMOUNT, 0)) AS total_applied
    FROM   RR_AP_APPLIED_PREPAYMENTS ap
    WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
    GROUP BY ap.INVOICE_ID
  ) prep_sub ON prep_sub.INVOICE_ID = i.INVOICE_ID
  WHERE i.INVOICE_DATE < l_period_start
  AND   NVL(i.CANCELED_FLAG,  'N')        != 'Y'
  AND   NVL(i.INVOICE_TYPE,   'Standard') != 'Prepayment'
  AND   (:P_BUSINESS_UNIT IS NULL OR i.BUSINESS_UNIT = :P_BUSINESS_UNIT);

  -- ── 3. Period Invoices ─────────────────────────────────────────────────────
  SELECT NVL(SUM(NVL(INVOICE_AMOUNT, 0)), 0)
  INTO   l_p_invoices
  FROM   RR_AP_INVOICES_ALL
  WHERE  INVOICE_DATE >= l_period_start
  AND    INVOICE_DATE <= l_period_end
  AND    NVL(CANCELED_FLAG,  'N')        != 'Y'
  AND    NVL(INVOICE_TYPE,   'Standard') != 'Prepayment'
  AND    (:P_BUSINESS_UNIT IS NULL OR BUSINESS_UNIT = :P_BUSINESS_UNIT);

  -- ── 4. Period Payments (negated — payments reduce AP liability) ────────────
  SELECT NVL(SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)
                   + NVL(ri.DISCOUNT_TAKEN, 0)), 0)
  INTO   l_p_payments
  FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
  JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
  WHERE  p.PAYMENT_DATE >= l_period_start
  AND    p.PAYMENT_DATE <= l_period_end
  AND    NVL(p.PAYMENT_STATUS,          'X') != 'Voided'
  AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'X') != 'Voided'
  AND    (:P_BUSINESS_UNIT IS NULL OR p.BUSINESS_UNIT = :P_BUSINESS_UNIT);
  l_p_payments := -l_p_payments;

  -- ── 5. Prepayments — no date column, set to 0 ─────────────────────────────
  l_p_prepay := 0;

  -- ── 6. Payables End Balance ────────────────────────────────────────────────
  l_p_end := l_p_begin + l_p_invoices + l_p_payments + l_p_prepay;

  -- ── 7. GL Opening / Closing from RR_GL_BALANCES ───────────────────────────
  BEGIN
    SELECT NVL(SUM(b.OPENING_BALANCE), 0),
           NVL(SUM(b.CLOSING_BALANCE), 0),
           NVL(SUM(b.PERIOD_ACTIVITY), 0)
    INTO   l_gl_opening, l_gl_closing, l_gl_activity
    FROM   RR_GL_BALANCES b
    WHERE  UPPER(b.PERIOD_NAME) = UPPER(:P_PERIOD)
    AND    b.ACTUAL_FLAG = 'A'
    AND    (:P_ACCOUNT IS NULL OR b.ACCOUNT  = :P_ACCOUNT)
    AND    (:P_COMPANY IS NULL OR b.COMPANY  = :P_COMPANY);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── 8. AP vs non-AP GL activity from RR_GL_JE_LINES_ALL + RR_GL_JE_HEADERS ──
  -- AP invoice categories: 'Purchase Invoices', 'Payables Invoices', 'Payables', 'Invoices'
  -- AP payment categories: 'Payments', 'AP Payments', 'Cash Payments', 'Supplier Payments'
  BEGIN
    SELECT
      NVL(SUM(CASE
        WHEN UPPER(h.USER_JE_CATEGORY_NAME)
               IN ('PURCHASE INVOICES','PAYABLES INVOICES','PAYABLES','INVOICES')
        THEN NVL(l.ACCOUNTED_DR, 0) - NVL(l.ACCOUNTED_CR, 0)
        ELSE 0
      END), 0),
      NVL(SUM(CASE
        WHEN UPPER(h.USER_JE_CATEGORY_NAME)
               IN ('PAYMENTS','AP PAYMENTS','CASH PAYMENTS','SUPPLIER PAYMENTS')
        THEN NVL(l.ACCOUNTED_DR, 0) - NVL(l.ACCOUNTED_CR, 0)
        ELSE 0
      END), 0)
    INTO l_gl_ap_inv, l_gl_ap_pay
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE UPPER(h.PERIOD_NAME) = UPPER(:P_PERIOD)
    AND   UPPER(h.USER_JE_CATEGORY_NAME)
            IN ('PURCHASE INVOICES','PAYABLES INVOICES','PAYABLES','INVOICES',
                'PAYMENTS','AP PAYMENTS','CASH PAYMENTS','SUPPLIER PAYMENTS')
    AND   (:P_ACCOUNT IS NULL OR
           REGEXP_LIKE(l.ACCOUNT_COMBINATION,
                       '(^|[-.])'||:P_ACCOUNT||'([-.]|$)'))
    AND   (:P_COMPANY IS NULL OR
           REGEXP_LIKE(l.ACCOUNT_COMBINATION,
                       '(^|[-.])'||:P_COMPANY||'([-.]|$)'));
  EXCEPTION WHEN OTHERS THEN
    l_gl_ap_inv := 0;
    l_gl_ap_pay := 0;
  END;

  -- ── 9. Derived amounts ────────────────────────────────────────────────────
  l_gl_non_ap       := l_gl_activity - l_gl_ap_inv - l_gl_ap_pay;
  l_gl_not_trans    := -(l_p_invoices + l_p_payments) - (l_gl_ap_inv + l_gl_ap_pay);
  l_gl_acc_variance := l_gl_closing - (l_gl_opening + l_gl_activity);

  -- ── 10. Output JSON ───────────────────────────────────────────────────────
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(
    '{'                                                                           ||
    '"period":'             || '"' || NVL(:P_PERIOD, '')                || '",'  ||
    '"period_start":'       || '"' || TO_CHAR(l_period_start,'YYYY-MM-DD') || '",' ||
    '"period_end":'         || '"' || TO_CHAR(l_period_end,  'YYYY-MM-DD') || '",' ||
    '"currency":"AED",'                                                            ||
    '"payables_begin":'     || jn(l_p_begin)          || ','                      ||
    '"payables_invoices":'  || jn(l_p_invoices)       || ','                      ||
    '"payables_payments":'  || jn(l_p_payments)       || ','                      ||
    '"payables_prepay":'    || jn(l_p_prepay)         || ','                      ||
    '"payables_end":'       || jn(l_p_end)            || ','                      ||
    '"gl_opening":'         || jn(l_gl_opening)       || ','                      ||
    '"gl_closing":'         || jn(l_gl_closing)       || ','                      ||
    '"gl_ap_invoices":'     || jn(l_gl_ap_inv)        || ','                      ||
    '"gl_ap_payments":'     || jn(l_gl_ap_pay)        || ','                      ||
    '"gl_non_ap_journals":' || jn(l_gl_non_ap)        || ','                      ||
    '"gl_not_transferred":' || jn(l_gl_not_trans)     || ','                      ||
    '"gl_not_posted":'      || jn(l_gl_not_posted)    || ','                      ||
    '"payables_variance":'  || jn(0)                  || ','                      ||
    '"accounting_variance":'|| jn(l_gl_acc_variance)  ||
    '}'
  );

EXCEPTION WHEN OTHERS THEN
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  :status_code := 500;
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
AND    t.uri_template = 'ap/reports/payables-ledger-recon'
ORDER  BY h.method;
