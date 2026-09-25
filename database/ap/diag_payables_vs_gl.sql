-- =============================================================================
-- DIAGNOSTIC (read-only): where is the Payables Balance vs GL difference?
-- Run in SQL Developer (schema bcldifc) as a script (F5). Nothing is changed.
--
-- Same rules as the Payables Trial Balance report:
--   Payables = total outstanding (Payables dashboard formula: every non-cancelled
--              invoice − every non-voided payment − prepayments), AED at the
--              invoice rate, invoices on natural account 2313101
--   GL       = ledger BUIMERC LEDGER, company 01, natural account 2313101, lines
--              by GL period (valid non-adjusting periods) up to Sep-26
-- Change the values in the "params" CTE of each query if needed.
-- =============================================================================

-- 1) Per supplier: outstanding vs GL — the rows with a GAP carry the difference.
--    Σ gap of all rows (incl. '(not linked)') = the report's Difference.
WITH params AS (
    SELECT 'BUIMERC CORP_DIFC_INVST' AS bu, 'BUIMERC LEDGER' AS ledger,
           '01' AS company, '2313101' AS natural_acct, DATE '2026-09-01' AS last_period
    FROM dual
),
periods AS (
    SELECT DISTINCT PERIOD_NAME FROM RR_V_GL_FISCAL_PERIODS
    WHERE  TO_CHAR(APPLICATION) = 'GL' AND TO_CHAR(ADJ_FLAG) = 'N'
),
gl AS (
    SELECT l.JE_HEADER_ID, l.REFERENCE1, l.REFERENCE2, l.REFERENCE5,
           NVL(l.ACCOUNTED_CR, 0) - NVL(l.ACCOUNTED_DR, 0) AS net
    FROM   RR_GL_JE_LINES_ALL l
    JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    CROSS JOIN params pr
    WHERE  REGEXP_SUBSTR(l.ACCOUNT_COMBINATION, '[^-]+', 1, 4) = pr.natural_acct
    AND    REGEXP_SUBSTR(l.ACCOUNT_COMBINATION, '[^-]+', 1, 1) = pr.company
    AND    h.LEDGER_NAME = pr.ledger
    AND    h.PERIOD_NAME IN (SELECT PERIOD_NAME FROM periods)
    AND    TO_DATE('01-' || h.PERIOD_NAME DEFAULT NULL ON CONVERSION ERROR,
                   'DD-Mon-RR', 'NLS_DATE_LANGUAGE=ENGLISH') <= pr.last_period
),
gl_s AS (
    SELECT g.net,
           COALESCE(
             CASE WHEN g.REFERENCE5 IN ('AP-INVOICE-CREATION','AP-INVOICE-CANCELLATION') THEN
                       (SELECT MAX(i.SUPPLIER_NUMBER) FROM RR_AP_INVOICES_ALL i WHERE TO_CHAR(i.INVOICE_ID) = g.REFERENCE2)
                  WHEN g.REFERENCE5 IN ('AP-PAYMENT','AP-PAYMENT-VOID') THEN
                       (SELECT MAX(p.SUPPLIER_NUMBER) FROM RR_AP_PAYMENTS_ALL p WHERE TO_CHAR(p.CHECK_ID) = g.REFERENCE2)
                  WHEN g.REFERENCE5 = 'AP-PREPAYMENT-APPLICATION' THEN
                       (SELECT MAX(i.SUPPLIER_NUMBER) FROM RR_AP_APPLIED_PREPAYMENTS ap
                        JOIN RR_AP_INVOICES_ALL i ON i.INVOICE_ID = ap.INVOICE_ID
                        WHERE TO_CHAR(ap.APPLICATION_ID) = g.REFERENCE2) END,
             (SELECT MAX(i.SUPPLIER_NUMBER) FROM RR_AP_INVOICES_ALL i, params pr
               WHERE i.INVOICE_NUMBER = g.REFERENCE1 AND i.BUSINESS_UNIT = pr.bu),
             (SELECT MAX(p.SUPPLIER_NUMBER) FROM RR_AP_PAYMENTS_ALL p, params pr
               WHERE p.PAYMENT_NUMBER = g.REFERENCE1 AND p.BUSINESS_UNIT = pr.bu),
             '(not linked)') AS supp
    FROM gl g
),
gl_sum AS (SELECT supp, SUM(net) AS gl, COUNT(*) AS gl_lines FROM gl_s GROUP BY supp),
pay_sum AS (
    SELECT ri.INVOICE_ID, SUM(NVL(ri.AMOUNT_PAID_INVOICE_CURRENCY, 0) + NVL(ri.DISCOUNT_TAKEN, 0)) AS paid
    FROM   RR_AP_PAYMENTS_RELATED_INVOICES ri
    JOIN   RR_AP_PAYMENTS_ALL p ON p.CHECK_ID = ri.CHECK_ID
    WHERE  NVL(p.PAYMENT_STATUS, 'Active') != 'Voided'
    AND    NVL(ri.INVOICE_PAYMENT_STATUS, 'Active') != 'Voided'
    GROUP BY ri.INVOICE_ID
),
prep_in AS (
    SELECT COALESCE(ap.INVOICE_ID, r.INVOICE_ID) AS INVOICE_ID, SUM(ap.APPLIED_AMOUNT) AS applied
    FROM   RR_AP_APPLIED_PREPAYMENTS ap
    LEFT JOIN RR_AP_INVOICES_ALL r ON ap.INVOICE_ID IS NULL AND r.INVOICE_NUMBER = ap.INVOICE_NUMBER
    WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
    GROUP BY COALESCE(ap.INVOICE_ID, r.INVOICE_ID)
),
prep_out AS (
    SELECT COALESCE(ap.PREPAYMENT_INVOICE_ID, r.INVOICE_ID) AS INVOICE_ID, SUM(ap.APPLIED_AMOUNT) AS applied_out
    FROM   RR_AP_APPLIED_PREPAYMENTS ap
    LEFT JOIN RR_AP_INVOICES_ALL r ON ap.PREPAYMENT_INVOICE_ID IS NULL AND r.INVOICE_NUMBER = ap.PREPAYMENT_NUMBER
    WHERE  NVL(ap.STATUS, 'Applied') != 'Cancelled'
    GROUP BY COALESCE(ap.PREPAYMENT_INVOICE_ID, r.INVOICE_ID)
),
outst AS (
    SELECT i.SUPPLIER_NUMBER AS supp, MAX(i.SUPPLIER) AS supplier_name,
           SUM(ROUND(
             CASE WHEN NVL(i.INVOICE_AMOUNT, 0) < 0
                  THEN NVL(i.INVOICE_AMOUNT, 0) - NVL(ps.paid, 0) - NVL(pi.applied, 0) - NVL(po.applied_out, 0)
                  ELSE GREATEST(0, NVL(i.INVOICE_AMOUNT, 0) - NVL(ps.paid, 0) - NVL(pi.applied, 0) - NVL(po.applied_out, 0))
             END
             * CASE WHEN NVL(i.INVOICE_CURRENCY, 'AED') = 'AED' THEN 1 ELSE NVL(NULLIF(i.CONVERSION_RATE, 0), 1) END, 2)) AS outstanding
    FROM   RR_AP_INVOICES_ALL i
    CROSS JOIN params pr
    LEFT JOIN pay_sum  ps ON ps.INVOICE_ID = i.INVOICE_ID
    LEFT JOIN prep_in  pi ON pi.INVOICE_ID = i.INVOICE_ID
    LEFT JOIN prep_out po ON po.INVOICE_ID = i.INVOICE_ID
    WHERE  NVL(i.CANCELED_FLAG, 'N') != 'Y'
    AND    i.BUSINESS_UNIT = pr.bu
    AND    REGEXP_SUBSTR(i.LIABILITY_DISTRIBUTION, '[^-]+', 1, 4) = pr.natural_acct
    GROUP BY i.SUPPLIER_NUMBER
)
SELECT NVL(o.supp, g.supp)                       AS supplier_number,
       o.supplier_name,
       NVL(o.outstanding, 0)                     AS outstanding,
       NVL(g.gl, 0)                              AS gl,
       NVL(g.gl_lines, 0)                        AS gl_lines,
       NVL(o.outstanding, 0) - NVL(g.gl, 0)      AS gap,
       SUM(NVL(o.outstanding, 0) - NVL(g.gl, 0)) OVER () AS total_gap
FROM   outst o
FULL OUTER JOIN gl_sum g ON g.supp = o.supp
WHERE  ROUND(NVL(o.outstanding, 0) - NVL(g.gl, 0), 2) != 0
ORDER  BY ABS(NVL(o.outstanding, 0) - NVL(g.gl, 0)) DESC;


-- 2) AKBAR TRAVELS (10148): every invoice with its accounting status and
--    the GL it produced on 2313101 — the two credit memos (-400, -450) must show
--    a creation journal (gl_on_liability = -400 / -450 → a DEBIT on 2313101).
SELECT i.INVOICE_ID, i.INVOICE_NUMBER, i.INVOICE_TYPE, i.INVOICE_DATE, i.INVOICE_AMOUNT,
       i.SYNC_STATUS, i.CANCELED_FLAG,
       (SELECT COUNT(DISTINCT l.JE_HEADER_ID) FROM RR_GL_JE_LINES_ALL l
         WHERE l.REFERENCE5 = 'AP-INVOICE-CREATION' AND l.REFERENCE2 = TO_CHAR(i.INVOICE_ID)) AS creation_journals,
       (SELECT SUM(NVL(l.ACCOUNTED_CR, 0) - NVL(l.ACCOUNTED_DR, 0)) FROM RR_GL_JE_LINES_ALL l
         WHERE l.REFERENCE5 = 'AP-INVOICE-CREATION' AND l.REFERENCE2 = TO_CHAR(i.INVOICE_ID)
         AND   REGEXP_SUBSTR(l.ACCOUNT_COMBINATION, '[^-]+', 1, 4) = '2313101') AS gl_on_liability
FROM   RR_AP_INVOICES_ALL i
WHERE  i.SUPPLIER_NUMBER = '10148'
AND    i.BUSINESS_UNIT = 'BUIMERC CORP_DIFC_INVST'
ORDER  BY i.INVOICE_DATE DESC, i.INVOICE_NUMBER
FETCH FIRST 40 ROWS ONLY;


-- 3) Every GL journal of payment 000176 (should be exactly ONE, balanced:
--    2313101 Dr 11,745 / Cr 850, net Dr 10,895).
SELECT h.JE_HEADER_ID, h.JOURNAL_NAME, TRUNC(h.DEFAULT_EFFECTIVE_DATE) AS gl_date, h.PERIOD_NAME,
       l.ACCOUNT_COMBINATION, l.REFERENCE1, l.REFERENCE5, l.ACCOUNTED_DR, l.ACCOUNTED_CR, l.DESCRIPTION
FROM   RR_GL_JE_LINES_ALL l
JOIN   RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
WHERE  l.REFERENCE2 = (SELECT TO_CHAR(MAX(p.CHECK_ID)) FROM RR_AP_PAYMENTS_ALL p
                        WHERE p.PAYMENT_NUMBER = '000176' AND p.BUSINESS_UNIT = 'BUIMERC CORP_DIFC_INVST')
AND    l.REFERENCE5 LIKE 'AP-PAYMENT%'
ORDER  BY h.JE_HEADER_ID, l.JE_LINE_NUMBER;
