-- =============================================================================
-- Drill-down ORDS handlers for Payables-to-Ledger Reconciliation
--
-- Module  : reerp
-- Patterns (all new — no existing endpoints overwritten):
--
--   aprecon/ap-invoices  – AP invoice rows  (P_DATE_FILTER: before / in / end)
--   aprecon/ap-payments  – AP payment rows in the period
--   aprecon/gl-lines     – GL journal lines (P_CAT_TYPE: ap-inv / ap-pay / non-ap)
--   aprecon/gl-balances  – GL balance rows by account/company
--
-- All handlers:
--   • Parse P_PERIOD ('Mon-YY') to real dates in PL/SQL — no table lookup
--   • Return {"items":[...]} JSON
--   • Cap at 1000 rows
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ap-invoices
--    P_DATE_FILTER: 'before' = before period start (begin balance)
--                  'in'     = within the period   (period invoices)
--                  'end'    = on or before period end (end balance)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp',
                         p_pattern     => 'aprecon/ap-invoices');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'aprecon/ap-invoices',
        p_comments    => 'Drill-down: AP invoices (before / in / end period)'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'aprecon/ap-invoices',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns AP invoices for a period filter',
        p_source         => q'[
DECLARE
  l_period_start DATE;
  l_period_end   DATE;
  l_sep          VARCHAR2(1) := '';
  l_filter       VARCHAR2(10) := NVL(:P_DATE_FILTER, 'in');

  FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REPLACE(REPLACE(NVL(p, ''), '\', '\\'), '"', '\"');
  END;
  FUNCTION jn(p IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE TO_CHAR(ROUND(p, 2), 'TM9') END;
  END;

BEGIN
  BEGIN
    l_period_start := TRUNC(TO_DATE('01-' || :P_PERIOD, 'DD-Mon-RR'), 'MM');
    l_period_end   := LAST_DAY(l_period_start);
  EXCEPTION WHEN OTHERS THEN
    l_period_start := TRUNC(SYSDATE, 'MM');
    l_period_end   := LAST_DAY(SYSDATE);
  END;

  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"items":[');

  FOR r IN (
    SELECT
      i.INVOICE_NUMBER,
      TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD')                       AS invoice_date,
      i.SUPPLIER,
      i.INVOICE_TYPE,
      NVL(i.INVOICE_AMOUNT, 0)                                     AS invoice_amount,
      NVL(pay.total_paid, 0)                                       AS amount_paid,
      NVL(i.INVOICE_AMOUNT, 0) - NVL(pay.total_paid, 0)           AS outstanding,
      i.VALIDATION_STATUS,
      i.BUSINESS_UNIT
    FROM RR_AP_INVOICES_ALL i
    LEFT JOIN (
      SELECT INVOICE_ID,
             SUM(NVL(AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(DISCOUNT_TAKEN, 0)) AS total_paid
      FROM   RR_AP_PAYMENTS_RELATED_INVOICES
      GROUP BY INVOICE_ID
    ) pay ON pay.INVOICE_ID = i.INVOICE_ID
    WHERE NVL(i.CANCELED_FLAG, 'N')       != 'Y'
      AND NVL(i.INVOICE_TYPE, 'Standard') != 'Prepayment'
      AND (:P_BUSINESS_UNIT IS NULL OR i.BUSINESS_UNIT = :P_BUSINESS_UNIT)
      AND (
            (l_filter = 'before' AND i.INVOICE_DATE <  l_period_start)
         OR (l_filter = 'in'     AND i.INVOICE_DATE >= l_period_start
                                 AND i.INVOICE_DATE <= l_period_end)
         OR (l_filter = 'end'    AND i.INVOICE_DATE <= l_period_end)
          )
    ORDER BY i.INVOICE_DATE DESC
    FETCH FIRST 1000 ROWS ONLY
  ) LOOP
    HTP.PRN(l_sep ||
      '{"invoice_number":"'  || esc(r.INVOICE_NUMBER)    || '",' ||
      '"invoice_date":"'     || esc(r.invoice_date)       || '",' ||
      '"supplier":"'         || esc(r.SUPPLIER)           || '",' ||
      '"invoice_type":"'     || esc(r.INVOICE_TYPE)       || '",' ||
      '"invoice_amount":'    || jn(r.invoice_amount)      ||  ',' ||
      '"amount_paid":'       || jn(r.amount_paid)         ||  ',' ||
      '"outstanding":'       || jn(r.outstanding)         ||  ',' ||
      '"validation_status":"'|| esc(r.VALIDATION_STATUS)  || '",' ||
      '"business_unit":"'    || esc(r.BUSINESS_UNIT)      || '"}');
    l_sep := ',';
  END LOOP;

  HTP.PRN(']}');
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ap-payments
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp',
                         p_pattern     => 'aprecon/ap-payments');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'aprecon/ap-payments',
        p_comments    => 'Drill-down: AP payments in period'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'aprecon/ap-payments',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns AP payments for the period',
        p_source         => q'[
DECLARE
  l_period_start DATE;
  l_period_end   DATE;
  l_sep          VARCHAR2(1) := '';

  FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REPLACE(REPLACE(NVL(p, ''), '\', '\\'), '"', '\"');
  END;
  FUNCTION jn(p IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE TO_CHAR(ROUND(p, 2), 'TM9') END;
  END;

BEGIN
  BEGIN
    l_period_start := TRUNC(TO_DATE('01-' || :P_PERIOD, 'DD-Mon-RR'), 'MM');
    l_period_end   := LAST_DAY(l_period_start);
  EXCEPTION WHEN OTHERS THEN
    l_period_start := TRUNC(SYSDATE, 'MM');
    l_period_end   := LAST_DAY(SYSDATE);
  END;

  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"items":[');

  FOR r IN (
    SELECT
      p.CHECK_ID,
      TO_CHAR(p.PAYMENT_DATE, 'YYYY-MM-DD')         AS payment_date,
      p.THIRD_PARTY_SUPPLIER                         AS supplier,
      ri.INVOICE_NUMBER,
      NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)        AS amount_paid,
      NVL(ri.DISCOUNT_TAKEN, 0)                      AS discount_taken,
      NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0)
        + NVL(ri.DISCOUNT_TAKEN, 0)                  AS total_applied,
      p.PAYMENT_STATUS,
      p.PAYMENT_CURRENCY                             AS currency,
      p.BUSINESS_UNIT
    FROM RR_AP_PAYMENTS_ALL p
    JOIN RR_AP_PAYMENTS_RELATED_INVOICES ri ON ri.CHECK_ID = p.CHECK_ID
    WHERE p.PAYMENT_DATE >= l_period_start
      AND p.PAYMENT_DATE <= l_period_end
      AND NVL(p.PAYMENT_STATUS,          'X') != 'Voided'
      AND NVL(ri.INVOICE_PAYMENT_STATUS, 'X') != 'Voided'
      AND (:P_BUSINESS_UNIT IS NULL OR p.BUSINESS_UNIT = :P_BUSINESS_UNIT)
    ORDER BY p.PAYMENT_DATE DESC, p.CHECK_ID
    FETCH FIRST 1000 ROWS ONLY
  ) LOOP
    HTP.PRN(l_sep ||
      '{"check_id":'       || TO_CHAR(r.CHECK_ID)      ||  ',' ||
      '"payment_date":"'   || esc(r.payment_date)        || '",' ||
      '"supplier":"'       || esc(r.supplier)            || '",' ||
      '"invoice_number":"' || esc(r.INVOICE_NUMBER)      || '",' ||
      '"amount_paid":'     || jn(r.amount_paid)          ||  ',' ||
      '"discount_taken":'  || jn(r.discount_taken)       ||  ',' ||
      '"total_applied":'   || jn(r.total_applied)        ||  ',' ||
      '"payment_status":"' || esc(r.PAYMENT_STATUS)      || '",' ||
      '"currency":"'       || esc(r.currency)            || '",' ||
      '"business_unit":"'  || esc(r.BUSINESS_UNIT)       || '"}');
    l_sep := ',';
  END LOOP;

  HTP.PRN(']}');
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. gl-lines
--    P_CAT_TYPE: 'ap-inv'  = AP invoice journal categories
--                'ap-pay'  = AP payment journal categories
--                'non-ap'  = everything else
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp',
                         p_pattern     => 'aprecon/gl-lines');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'aprecon/gl-lines',
        p_comments    => 'Drill-down: GL journal lines for the period'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'aprecon/gl-lines',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns GL journal lines filtered by category type',
        p_source         => q'[
DECLARE
  l_cat_type VARCHAR2(10) := NVL(:P_CAT_TYPE, 'all');
  l_sep      VARCHAR2(1)  := '';

  FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REPLACE(REPLACE(NVL(p, ''), '\', '\\'), '"', '\"');
  END;
  FUNCTION jn(p IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE TO_CHAR(ROUND(p, 2), 'TM9') END;
  END;

  FUNCTION cat_matches(p_cat IN VARCHAR2) RETURN NUMBER IS
    l_up VARCHAR2(100) := UPPER(p_cat);
  BEGIN
    IF l_cat_type = 'ap-inv' THEN
      RETURN CASE WHEN l_up IN ('PURCHASE INVOICES','PAYABLES INVOICES','PAYABLES','INVOICES') THEN 1 ELSE 0 END;
    ELSIF l_cat_type = 'ap-pay' THEN
      RETURN CASE WHEN l_up IN ('PAYMENTS','AP PAYMENTS','CASH PAYMENTS','SUPPLIER PAYMENTS') THEN 1 ELSE 0 END;
    ELSIF l_cat_type = 'non-ap' THEN
      RETURN CASE WHEN l_up NOT IN ('PURCHASE INVOICES','PAYABLES INVOICES','PAYABLES','INVOICES',
                                    'PAYMENTS','AP PAYMENTS','CASH PAYMENTS','SUPPLIER PAYMENTS') THEN 1 ELSE 0 END;
    ELSE
      RETURN 1;
    END IF;
  END;

BEGIN
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"items":[');

  FOR r IN (
    SELECT
      h.JE_HEADER_ID,
      h.JOURNAL_NAME,
      h.USER_JE_CATEGORY_NAME                                AS category,
      h.LEDGER_NAME                                          AS ledger,
      l.ACCOUNT_COMBINATION,
      NVL(l.ACCOUNTED_DR, 0)                                 AS accounted_dr,
      NVL(l.ACCOUNTED_CR, 0)                                 AS accounted_cr,
      NVL(l.ACCOUNTED_DR, 0) - NVL(l.ACCOUNTED_CR, 0)       AS net_amount,
      l.DESCRIPTION
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE UPPER(h.PERIOD_NAME) = UPPER(:P_PERIOD)
      AND (:P_ACCOUNT IS NULL OR
           REGEXP_LIKE(l.ACCOUNT_COMBINATION, '(^|[-.])'||:P_ACCOUNT||'([-.]|$)'))
      AND (:P_COMPANY IS NULL OR
           REGEXP_LIKE(l.ACCOUNT_COMBINATION, '(^|[-.])'||:P_COMPANY||'([-.]|$)'))
    ORDER BY h.JE_HEADER_ID, l.JE_LINE_NUMBER
    FETCH FIRST 1000 ROWS ONLY
  ) LOOP
    -- Apply category filter in PL/SQL (avoids complex SQL OR conditions)
    IF cat_matches(r.category) = 1 THEN
      HTP.PRN(l_sep ||
        '{"je_header_id":'        || TO_CHAR(r.JE_HEADER_ID)    ||  ',' ||
        '"journal_name":"'        || esc(r.JOURNAL_NAME)          || '",' ||
        '"category":"'            || esc(r.category)              || '",' ||
        '"ledger":"'              || esc(r.ledger)                || '",' ||
        '"account_combination":"' || esc(r.ACCOUNT_COMBINATION)   || '",' ||
        '"accounted_dr":'         || jn(r.accounted_dr)           ||  ',' ||
        '"accounted_cr":'         || jn(r.accounted_cr)           ||  ',' ||
        '"net_amount":'           || jn(r.net_amount)             ||  ',' ||
        '"description":"'         || esc(r.DESCRIPTION)           || '"}');
      l_sep := ',';
    END IF;
  END LOOP;

  HTP.PRN(']}');
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. gl-balances
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp',
                         p_pattern     => 'aprecon/gl-balances');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'aprecon/gl-balances',
        p_comments    => 'Drill-down: GL balance breakdown by account'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'aprecon/gl-balances',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Returns GL balance rows for the period by account/company',
        p_source         => q'[
DECLARE
  l_sep VARCHAR2(1) := '';

  FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REPLACE(REPLACE(NVL(p, ''), '\', '\\'), '"', '\"');
  END;
  FUNCTION jn(p IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE TO_CHAR(ROUND(p, 2), 'TM9') END;
  END;

BEGIN
  OWA_UTIL.MIME_HEADER('application/json', TRUE);
  HTP.PRN('{"items":[');

  FOR r IN (
    SELECT
      b.COMPANY,
      b.ACCOUNT,
      b.ACCOUNT_DESC,
      b.DEPARTMENT,
      b.PERIOD_NAME,
      b.CURRENCY,
      b.ACCOUNT_TYPE,
      NVL(b.OPENING_BALANCE, 0)  AS opening_balance,
      NVL(b.PERIOD_ACTIVITY, 0)  AS period_activity,
      NVL(b.CLOSING_BALANCE, 0)  AS closing_balance,
      NVL(b.DEBIT,  0)           AS debit,
      NVL(b.CREDIT, 0)           AS credit
    FROM RR_GL_BALANCES b
    WHERE UPPER(b.PERIOD_NAME) = UPPER(:P_PERIOD)
      AND b.ACTUAL_FLAG = 'A'
      AND (:P_ACCOUNT IS NULL OR b.ACCOUNT = :P_ACCOUNT)
      AND (:P_COMPANY IS NULL OR b.COMPANY = :P_COMPANY)
    ORDER BY b.COMPANY, b.ACCOUNT
  ) LOOP
    HTP.PRN(l_sep ||
      '{"company":"'          || esc(r.COMPANY)           || '",' ||
      '"account":"'           || esc(r.ACCOUNT)           || '",' ||
      '"account_desc":"'      || esc(r.ACCOUNT_DESC)      || '",' ||
      '"department":"'        || esc(r.DEPARTMENT)        || '",' ||
      '"period_name":"'       || esc(r.PERIOD_NAME)       || '",' ||
      '"currency":"'          || esc(r.CURRENCY)          || '",' ||
      '"account_type":"'      || esc(r.ACCOUNT_TYPE)      || '",' ||
      '"opening_balance":'    || jn(r.opening_balance)    ||  ',' ||
      '"period_activity":'    || jn(r.period_activity)    ||  ',' ||
      '"closing_balance":'    || jn(r.closing_balance)    ||  ',' ||
      '"debit":'              || jn(r.debit)              ||  ',' ||
      '"credit":'             || jn(r.credit)             || '}');
    l_sep := ',';
  END LOOP;

  HTP.PRN(']}');
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify all 4 drill-down templates registered
-- ─────────────────────────────────────────────────────────────────────────────
SELECT t.uri_template, h.method, h.source_type
FROM   user_ords_modules   m
JOIN   user_ords_templates t ON m.id = t.module_id
JOIN   user_ords_handlers  h ON t.id = h.template_id
WHERE  m.name = 'reerp'
AND    t.uri_template LIKE 'ap/reports/payables-ledger-recon/%'
ORDER  BY t.uri_template;
