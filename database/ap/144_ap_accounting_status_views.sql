-- ============================================================
-- 144: AP accounting-status views
--
--   RR_V_AP_INVOICE_ACCT_STATUS — one row per AP invoice
--   RR_V_AP_PAYMENT_ACCT_STATUS — one row per AP payment
--
-- Linkage (as written by the app's Create Accounting flows):
--   GL line REFERENCE2 = TO_CHAR(invoice_id / check_id)
--   GL line REFERENCE5 identifies the event:
--     Invoices : AP-INVOICE-CREATION, AP-INVOICE-CANCELLATION,
--                AP-PREPAYMENT-APPLICATION
--     Payments : AP-PAYMENT, AP-PAYMENT-VOID,
--                AP-PAYMENT-MATURITY, AP-PDC-CLEARING
--
-- Run the whole file in APEX SQL Workshop (SQL Scripts).
-- ============================================================


-- ------------------------------------------------------------
-- 1. Invoice accounting status
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW RR_V_AP_INVOICE_ACCT_STATUS AS
WITH gl AS (
    SELECT
        l.REFERENCE2                                   AS INVOICE_ID_CHAR,
        COUNT(DISTINCT l.JE_HEADER_ID)                 AS JOURNAL_COUNT,
        MAX(l.JE_HEADER_ID)                            AS LAST_JE_HEADER_ID,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_GL_PERIOD,
        MAX(h.POSTING_STATUS)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_POSTING_STATUS,
        SUM(CASE WHEN l.REFERENCE5 = 'AP-INVOICE-CREATION'       THEN 1 ELSE 0 END) AS CREATION_LINES,
        SUM(CASE WHEN l.REFERENCE5 = 'AP-INVOICE-CANCELLATION'   THEN 1 ELSE 0 END) AS CANCELLATION_LINES,
        SUM(CASE WHEN l.REFERENCE5 = 'AP-PREPAYMENT-APPLICATION' THEN 1 ELSE 0 END) AS PREPAY_APPLIED_LINES,
        SUM(NVL(l.ACCOUNTED_DR, 0))                    AS GL_ACCOUNTED_DR,
        SUM(NVL(l.ACCOUNTED_CR, 0))                    AS GL_ACCOUNTED_CR
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE l.REFERENCE2 IS NOT NULL
      AND l.REFERENCE5 IN ('AP-INVOICE-CREATION',
                           'AP-INVOICE-CANCELLATION',
                           'AP-PREPAYMENT-APPLICATION')
    GROUP BY l.REFERENCE2
)
SELECT
    i.INVOICE_ID,
    i.INVOICE_NUMBER,
    i.INVOICE_TYPE,
    i.SUPPLIER,
    i.SUPPLIER_NUMBER,
    i.BUSINESS_UNIT,
    i.INVOICE_CURRENCY,
    i.INVOICE_AMOUNT,
    NVL(i.AMOUNT_PAID, 0)                              AS AMOUNT_PAID,
    i.INVOICE_DATE,
    i.ACCOUNTING_DATE,
    i.VALIDATION_STATUS,
    i.PAID_STATUS,
    -- accounting status derived from the matched GL lines
    CASE
        WHEN NVL(g.CANCELLATION_LINES, 0) > 0 THEN 'CANCEL ACCOUNTED'
        WHEN NVL(g.CREATION_LINES, 0)     > 0 THEN 'ACCOUNTED'
        ELSE 'NOT ACCOUNTED'
    END                                                AS GL_STATUS,
    CASE WHEN NVL(g.PREPAY_APPLIED_LINES, 0) > 0 THEN 'Y' ELSE 'N' END AS PREPAY_APPLIED,
    NVL(g.JOURNAL_COUNT, 0)                            AS JOURNAL_COUNT,
    g.LAST_JE_HEADER_ID,
    g.LAST_GL_PERIOD,
    g.LAST_POSTING_STATUS,
    NVL(g.GL_ACCOUNTED_DR, 0)                          AS GL_ACCOUNTED_DR,
    NVL(g.GL_ACCOUNTED_CR, 0)                          AS GL_ACCOUNTED_CR
FROM RR_AP_INVOICES_ALL i
LEFT JOIN gl g ON g.INVOICE_ID_CHAR = TO_CHAR(i.INVOICE_ID)
;

COMMENT ON TABLE  RR_V_AP_INVOICE_ACCT_STATUS IS 'Accounting status per AP invoice: GL lines matched on REFERENCE2 = invoice_id with REFERENCE5 = AP-INVOICE-* / AP-PREPAYMENT-APPLICATION. GL_STATUS: ACCOUNTED / CANCEL ACCOUNTED / NOT ACCOUNTED';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.GL_STATUS           IS 'ACCOUNTED = creation journal exists; CANCEL ACCOUNTED = cancellation journal exists; NOT ACCOUNTED = no GL lines';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.PREPAY_APPLIED      IS 'Y when AP-PREPAYMENT-APPLICATION journal lines exist for this invoice';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.JOURNAL_COUNT       IS 'Distinct GL journal headers referencing this invoice';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.LAST_JE_HEADER_ID   IS 'Latest GL journal header id for this invoice';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.LAST_POSTING_STATUS IS 'POSTING_STATUS of the latest journal header (P = posted)';


-- ------------------------------------------------------------
-- 2. Payment accounting status
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW RR_V_AP_PAYMENT_ACCT_STATUS AS
WITH gl AS (
    SELECT
        l.REFERENCE2                                   AS CHECK_ID_CHAR,
        COUNT(DISTINCT l.JE_HEADER_ID)                 AS JOURNAL_COUNT,
        MAX(l.JE_HEADER_ID)                            AS LAST_JE_HEADER_ID,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_GL_PERIOD,
        MAX(h.POSTING_STATUS)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_POSTING_STATUS,
        SUM(CASE WHEN l.REFERENCE5 = 'AP-PAYMENT'          THEN 1 ELSE 0 END) AS CREATION_LINES,
        SUM(CASE WHEN l.REFERENCE5 = 'AP-PAYMENT-VOID'     THEN 1 ELSE 0 END) AS VOID_LINES,
        SUM(CASE WHEN l.REFERENCE5 = 'AP-PAYMENT-MATURITY' THEN 1 ELSE 0 END) AS MATURITY_LINES,
        SUM(CASE WHEN l.REFERENCE5 = 'AP-PDC-CLEARING'     THEN 1 ELSE 0 END) AS PDC_CLEARING_LINES,
        SUM(NVL(l.ACCOUNTED_DR, 0))                    AS GL_ACCOUNTED_DR,
        SUM(NVL(l.ACCOUNTED_CR, 0))                    AS GL_ACCOUNTED_CR
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE l.REFERENCE2 IS NOT NULL
      AND l.REFERENCE5 IN ('AP-PAYMENT',
                           'AP-PAYMENT-VOID',
                           'AP-PAYMENT-MATURITY',
                           'AP-PDC-CLEARING')
    GROUP BY l.REFERENCE2
)
SELECT
    p.CHECK_ID,
    p.PAYMENT_ID,
    p.PAYMENT_NUMBER,
    p.PAYMENT_REFERENCE,
    p.PAYEE,
    p.SUPPLIER_NUMBER,
    p.BUSINESS_UNIT,
    p.PAYMENT_CURRENCY,
    p.PAYMENT_AMOUNT,
    p.PAYMENT_DATE,
    p.ACCOUNTING_DATE,
    p.MATURITY_DATE,
    p.PAYMENT_STATUS,
    -- accounting status derived from the matched GL lines
    CASE
        WHEN NVL(g.VOID_LINES, 0)     > 0 THEN 'VOID ACCOUNTED'
        WHEN NVL(g.CREATION_LINES, 0) > 0 THEN 'ACCOUNTED'
        ELSE 'NOT ACCOUNTED'
    END                                                AS GL_STATUS,
    CASE WHEN NVL(g.MATURITY_LINES, 0)     > 0 THEN 'Y' ELSE 'N' END AS MATURITY_ACCOUNTED,
    CASE WHEN NVL(g.PDC_CLEARING_LINES, 0) > 0 THEN 'Y' ELSE 'N' END AS PDC_CLEARED,
    NVL(g.JOURNAL_COUNT, 0)                            AS JOURNAL_COUNT,
    g.LAST_JE_HEADER_ID,
    g.LAST_GL_PERIOD,
    g.LAST_POSTING_STATUS,
    NVL(g.GL_ACCOUNTED_DR, 0)                          AS GL_ACCOUNTED_DR,
    NVL(g.GL_ACCOUNTED_CR, 0)                          AS GL_ACCOUNTED_CR
FROM RR_AP_PAYMENTS_ALL p
LEFT JOIN gl g ON g.CHECK_ID_CHAR = TO_CHAR(p.CHECK_ID)
;

COMMENT ON TABLE  RR_V_AP_PAYMENT_ACCT_STATUS IS 'Accounting status per AP payment: GL lines matched on REFERENCE2 = check_id with REFERENCE5 = AP-PAYMENT / AP-PAYMENT-VOID / AP-PAYMENT-MATURITY / AP-PDC-CLEARING. GL_STATUS: ACCOUNTED / VOID ACCOUNTED / NOT ACCOUNTED';
COMMENT ON COLUMN RR_V_AP_PAYMENT_ACCT_STATUS.GL_STATUS           IS 'ACCOUNTED = payment journal exists; VOID ACCOUNTED = void journal exists; NOT ACCOUNTED = no GL lines';
COMMENT ON COLUMN RR_V_AP_PAYMENT_ACCT_STATUS.MATURITY_ACCOUNTED  IS 'Y when an AP-PAYMENT-MATURITY journal exists (PDC matured)';
COMMENT ON COLUMN RR_V_AP_PAYMENT_ACCT_STATUS.PDC_CLEARED         IS 'Y when an AP-PDC-CLEARING journal exists';
COMMENT ON COLUMN RR_V_AP_PAYMENT_ACCT_STATUS.JOURNAL_COUNT       IS 'Distinct GL journal headers referencing this payment';
COMMENT ON COLUMN RR_V_AP_PAYMENT_ACCT_STATUS.LAST_POSTING_STATUS IS 'POSTING_STATUS of the latest journal header (P = posted)';


-- ------------------------------------------------------------
-- 3. Verify
-- ------------------------------------------------------------

-- 3a. Views compiled?
SELECT view_name, 'OK' AS status
FROM   user_views
WHERE  view_name IN ('RR_V_AP_INVOICE_ACCT_STATUS', 'RR_V_AP_PAYMENT_ACCT_STATUS');

-- 3b. Invoice status distribution
SELECT gl_status, COUNT(*) AS invoices
FROM   rr_v_ap_invoice_acct_status
GROUP  BY gl_status;

-- 3c. Payment status distribution
SELECT gl_status, COUNT(*) AS payments
FROM   rr_v_ap_payment_acct_status
GROUP  BY gl_status;

-- 3d. Spot-check one invoice (replace the id)
-- SELECT * FROM rr_v_ap_invoice_acct_status WHERE invoice_id = 12345;
