-- =============================================================================
-- GET /ap/reports/payables-ledger-recon
-- Payables to Ledger Reconciliation Summary
--
-- Returns one JSON object with the period-level summary matching the Oracle
-- "Payables to Ledger Reconciliation" standard report format:
--
--   Payables Side  : computed from AP invoice / payment / prepayment tables
--   Accounting Side: opening/closing from RR_GL_BALANCES;
--                    AP-sourced vs non-AP split from RR_GL_LINES_ALL + RR_GL_HEADERS
--
-- Parameters (all optional):
--   P_BUSINESS_UNIT  – AP business unit filter
--   P_COMPANY        – GL company segment (e.g. '01')
--   P_ACCOUNT        – GL account segment (e.g. '21100')
--   P_PERIOD         – GL period name    (e.g. 'Jan-2024')
-- =============================================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'reports/payables-ledger-recon');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'reports/payables-ledger-recon',
        p_comments    => 'Payables to Ledger Reconciliation Summary'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'ap',
        p_pattern     => 'reports/payables-ledger-recon',
        p_method      => 'GET',
        p_source_type => 'plsql/block',
        p_comments    => 'Returns one JSON object: payables amounts + GL amounts for the reconciliation report',
        p_source      => q'[
DECLARE
  l_period_start DATE;
  l_period_end   DATE;

  -- ── Payables (AP subledger) amounts ───────────────────────────────────
  l_p_begin    NUMBER := 0;   -- net AP balance before period start
  l_p_invoices NUMBER := 0;   -- new invoices in period  (positive)
  l_p_payments NUMBER := 0;   -- payments in period      (negative)
  l_p_prepay   NUMBER := 0;   -- prepayments applied     (negative, per period)
  l_p_end      NUMBER := 0;   -- = begin + invoices + payments + prepayments

  -- ── GL (accounting) amounts ───────────────────────────────────────────
  l_gl_opening      NUMBER := 0;
  l_gl_closing      NUMBER := 0;
  l_gl_activity     NUMBER := 0;   -- PERIOD_ACTIVITY = DEBIT - CREDIT (net)
  l_gl_ap_inv       NUMBER := 0;   -- AP-sourced: invoice postings  (ACCOUNTED_DR - ACCOUNTED_CR)
  l_gl_ap_pay       NUMBER := 0;   -- AP-sourced: payment postings
  l_gl_non_ap       NUMBER := 0;   -- non-AP journals in period
  l_gl_not_trans    NUMBER := 0;   -- AP amounts not yet transferred to GL
  l_gl_not_posted   NUMBER := 0;   -- (no STATUS column — always 0)
  l_gl_other        NUMBER := 0;
  l_gl_acc_variance NUMBER := 0;

  -- ── Number formatter ──────────────────────────────────────────────────
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
  -- ── 1. Period dates ────────────────────────────────────────────────────
  BEGIN
    SELECT NVL(START_DATE, TRUNC(SYSDATE,'MM')),
           NVL(END_DATE,   LAST_DAY(SYSDATE))
    INTO   l_period_start, l_period_end
    FROM   RR_GL_FISCAL_PERIODS
    WHERE  UPPER(PERIOD_NAME) = UPPER(:P_PERIOD)
    AND    ROWNUM = 1;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    -- If period not found, use current month
    l_period_start := TRUNC(SYSDATE, 'MM');
    l_period_end   := LAST_DAY(SYSDATE);
  END;

  -- ── 2. Payables Begin Balance ──────────────────────────────────────────
  -- Net AP liability as of (period_start − 1):
  --   Σ invoice_amount for non-cancelled, non-prepayment invoices dated before period_start
  --   MINUS Σ cash payments + discounts for payments dated before period_start
  --   MINUS Σ prepayment applications (no date column → use all non-cancelled)
  SELECT NVL(SUM(
      NVL(i.INVOICE_AMOUNT, 0)
    - NVL(pay_sub.total_paid,     0)
    - NVL(prep_sub.total_applied, 0)
  ), 0)
  INTO l_p_begin
  FROM RR_AP_INVOICES_ALL i
  LEFT JOIN (
    SELECT ri.INVOICE_ID,
           SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY,0) + NVL(ri.DISCOUNT_TAKEN,0)) AS total_paid
    FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
    JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
    WHERE  p.PAYMENT_DATE < l_period_start
    AND    NVL(p.PAYMENT_STATUS,          'Active') != 'Voided'
    AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided'
    AND    (:P_BUSINESS_UNIT IS NULL OR p.BUSINESS_UNIT = :P_BUSINESS_UNIT)
    GROUP BY ri.INVOICE_ID
  ) pay_sub  ON pay_sub.INVOICE_ID  = i.INVOICE_ID
  LEFT JOIN (
    SELECT ap.INVOICE_ID, SUM(ap.APPLIED_AMOUNT) AS total_applied
    FROM   RR_AP_APPLIED_PREPAYMENTS ap
    WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
    GROUP BY ap.INVOICE_ID
  ) prep_sub ON prep_sub.INVOICE_ID = i.INVOICE_ID
  WHERE i.INVOICE_DATE < l_period_start
  AND   NVL(i.CANCELED_FLAG, 'N')        != 'Y'
  AND   NVL(i.INVOICE_TYPE, 'Standard')  != 'Prepayment'
  AND   (:P_BUSINESS_UNIT IS NULL OR i.BUSINESS_UNIT = :P_BUSINESS_UNIT);

  -- ── 3. Period Invoices ─────────────────────────────────────────────────
  SELECT NVL(SUM(NVL(INVOICE_AMOUNT, 0)), 0)
  INTO   l_p_invoices
  FROM   RR_AP_INVOICES_ALL
  WHERE  INVOICE_DATE >= l_period_start
  AND    INVOICE_DATE <= l_period_end
  AND    NVL(CANCELED_FLAG, 'N')       != 'Y'
  AND    NVL(INVOICE_TYPE, 'Standard') != 'Prepayment'
  AND    (:P_BUSINESS_UNIT IS NULL OR BUSINESS_UNIT = :P_BUSINESS_UNIT);

  -- ── 4. Period Payments (negated — payments reduce liability) ───────────
  SELECT NVL(SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY,0) + NVL(ri.DISCOUNT_TAKEN,0)), 0)
  INTO   l_p_payments
  FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
  JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
  WHERE  p.PAYMENT_DATE >= l_period_start
  AND    p.PAYMENT_DATE <= l_period_end
  AND    NVL(p.PAYMENT_STATUS,          'Active') != 'Voided'
  AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided'
  AND    (:P_BUSINESS_UNIT IS NULL OR p.BUSINESS_UNIT = :P_BUSINESS_UNIT);
  l_p_payments := -l_p_payments;   -- payments reduce liability → show negative

  -- ── 5. Period Prepayments ──────────────────────────────────────────────
  -- RR_AP_APPLIED_PREPAYMENTS has no date column; approximated as 0 for period.
  -- (already deducted from begin-balance via prep_sub above)
  l_p_prepay := 0;

  -- ── 6. Payables End Balance ────────────────────────────────────────────
  l_p_end := l_p_begin + l_p_invoices + l_p_payments + l_p_prepay;

  -- ── 7. GL Opening / Closing / Activity ────────────────────────────────
  -- RR_GL_BALANCES stores credit-normal accounts with negative OPENING_BALANCE.
  -- PERIOD_ACTIVITY = DEBIT − CREDIT (net).
  BEGIN
    SELECT NVL(SUM(b.OPENING_BALANCE), 0),
           NVL(SUM(b.CLOSING_BALANCE), 0),
           NVL(SUM(b.PERIOD_ACTIVITY), 0)
    INTO   l_gl_opening, l_gl_closing, l_gl_activity
    FROM   RR_GL_BALANCES b
    WHERE  b.PERIOD_NAME = :P_PERIOD
    AND    b.ACTUAL_FLAG = 'A'
    AND    (:P_ACCOUNT IS NULL OR b.ACCOUNT = :P_ACCOUNT)
    AND    (:P_COMPANY IS NULL OR b.COMPANY = :P_COMPANY);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── 8. AP-sourced GL activity ──────────────────────────────────────────
  -- USER_JE_CATEGORY_NAME values that Oracle Fusion uses for AP journals:
  --   'Purchase Invoices' / 'Payables Invoices' for invoice postings (credits)
  --   'Payments' / 'AP Payments'               for payment postings  (debits)
  -- Filter lines by account segment using REGEXP on ACCOUNT_COMBINATION.
  -- Formula: ACCOUNTED_DR - ACCOUNTED_CR
  --   → negative = net credit  (invoice posting to AP liability account)
  --   → positive = net debit   (payment clears AP liability account)
  BEGIN
    SELECT
      NVL(SUM(CASE WHEN UPPER(h.USER_JE_CATEGORY_NAME)
                        IN ('PURCHASE INVOICES','PAYABLES INVOICES','PAYABLES','INVOICES')
               THEN NVL(l.ACCOUNTED_DR,0) - NVL(l.ACCOUNTED_CR,0) ELSE 0 END), 0),
      NVL(SUM(CASE WHEN UPPER(h.USER_JE_CATEGORY_NAME)
                        IN ('PAYMENTS','AP PAYMENTS','CASH PAYMENTS','SUPPLIER PAYMENTS')
               THEN NVL(l.ACCOUNTED_DR,0) - NVL(l.ACCOUNTED_CR,0) ELSE 0 END), 0)
    INTO l_gl_ap_inv, l_gl_ap_pay
    FROM RR_GL_LINES_ALL l
    JOIN RR_GL_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE h.PERIOD_NAME  = :P_PERIOD
    AND   UPPER(h.USER_JE_CATEGORY_NAME)
            IN ('PURCHASE INVOICES','PAYABLES INVOICES','PAYABLES','INVOICES',
                'PAYMENTS','AP PAYMENTS','CASH PAYMENTS','SUPPLIER PAYMENTS')
    -- Match account segment in COA combination  (e.g. '01-000-21100-...')
    AND   (:P_ACCOUNT IS NULL OR
           REGEXP_LIKE(l.ACCOUNT_COMBINATION, '(^|[-.])'||:P_ACCOUNT||'([-.]|$)'))
    AND   (:P_COMPANY IS NULL OR
           REGEXP_LIKE(l.ACCOUNT_COMBINATION, '(^|[-.])'||:P_COMPANY||'([-.]|$)'));
  EXCEPTION WHEN OTHERS THEN
    l_gl_ap_inv := 0; l_gl_ap_pay := 0;
  END;

  -- Non-AP journals = total GL activity − AP-sourced activity
  l_gl_non_ap := l_gl_activity - l_gl_ap_inv - l_gl_ap_pay;

  -- ── 9. Not Transferred to GL ───────────────────────────────────────────
  -- Expected GL AP credit  = -l_p_invoices  (AP liability increase)
  -- Expected GL AP debit   = -l_p_payments  (AP liability decrease, payments are negative)
  -- Expected total         = -(l_p_invoices + l_p_payments)
  -- Actual GL AP           = l_gl_ap_inv + l_gl_ap_pay
  -- Not-transferred        = expected - actual
  l_gl_not_trans := -(l_p_invoices + l_p_payments) - (l_gl_ap_inv + l_gl_ap_pay);

  -- ── 10. Accounting variance (GL self-check) ────────────────────────────
  -- Should be 0 if GL data is consistent: opening + activity = closing
  l_gl_acc_variance := l_gl_closing - (l_gl_opening + l_gl_activity);

  -- ── Output JSON ────────────────────────────────────────────────────────
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN(
    '{'                                                                      ||
    '"period":'            || '"' || NVL(:P_PERIOD,'')                || '",'||
    '"period_start":'      || '"' || TO_CHAR(l_period_start,'YYYY-MM-DD') || '",'||
    '"period_end":'        || '"' || TO_CHAR(l_period_end,  'YYYY-MM-DD') || '",'||
    '"currency":"AED",'                                                       ||
    '"payables_begin":'    || jn(l_p_begin)          || ','                  ||
    '"payables_invoices":' || jn(l_p_invoices)       || ','                  ||
    '"payables_payments":' || jn(l_p_payments)       || ','                  ||
    '"payables_prepay":'   || jn(l_p_prepay)         || ','                  ||
    '"payables_end":'      || jn(l_p_end)            || ','                  ||
    '"gl_opening":'        || jn(l_gl_opening)       || ','                  ||
    '"gl_closing":'        || jn(l_gl_closing)       || ','                  ||
    '"gl_ap_invoices":'    || jn(l_gl_ap_inv)        || ','                  ||
    '"gl_ap_payments":'    || jn(l_gl_ap_pay)        || ','                  ||
    '"gl_non_ap_journals":'|| jn(l_gl_non_ap)        || ','                  ||
    '"gl_not_transferred":'|| jn(l_gl_not_trans)     || ','                  ||
    '"gl_not_posted":'     || jn(l_gl_not_posted)    || ','                  ||
    '"payables_variance":' || jn(0)                  || ','                  ||
    '"accounting_variance":'|| jn(l_gl_acc_variance) ||
    '}'
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
