-- ============================================================
-- 146: ALL accounting-status views — one combined script
--
-- Creates (CREATE OR REPLACE — safe to re-run):
--   RR_V_AP_INVOICE_ACCT_STATUS  — AP invoices  (+ payment status)
--   RR_V_AP_PAYMENT_ACCT_STATUS  — AP payments
--   RR_V_EXT_TXN_ACCT_STATUS     — external cash transactions
--   RR_V_FA_ASSET_ACCT_STATUS    — fixed assets (addition/deprn/retirement)
--   RR_V_AR_INVOICE_ACCT_STATUS  — AR invoices  (+ payment status)
--   RR_V_AR_RECEIPT_ACCT_STATUS  — AR receipts  (+ application status)
--
-- Each view matches GL journal lines (RR_GL_JE_LINES_ALL) to the source
-- document via REFERENCE2 (or REFERENCE1 for depreciation), constrained
-- by the module's REFERENCE5 marker so ids never cross-match:
--   AP invoice   : ref2 = invoice_id      ref5 = AP-INVOICE-* / AP-PREPAYMENT-APPLICATION
--   AP payment   : ref2 = check_id        ref5 = AP-PAYMENT / -VOID / -MATURITY / AP-PDC-CLEARING
--   External txn : ref2 = external_txn_id ref5 = BANK_EXTERNAL_TRANSACTIONS
--   FA addition  : ref2 = asset_id        ref5 = FA_ADDITIONS
--   FA deprn     : ref1 = asset_number    ref5 = FA_DEPRECIATION
--   FA retirement: ref2 = retirement_id   ref5 = FA_RETIREMENT
--   AR invoice   : ref2 = customer_trx_id ref5 = AR_INVOICES variants
--   AR receipt   : ref2 = std_receipt_id  ref5 = AR_RECEIPTS / AR_ADJUSTMENTS
--
-- Run the WHOLE file in APEX SQL Workshop -> SQL Scripts.
-- Then press "Refresh metadata" in the AI Assistant so the chatbot
-- picks up the new views, and open Home -> Check Accounting.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Invoice accounting status  (+ derived payment status)
--    Payment status sources:
--      RR_AP_PAYMENTS_RELATED_INVOICES — payments applied to the
--        invoice (amount in invoice currency + discount taken)
--      RR_AP_APPLIED_PREPAYMENTS        — applied prepayments
--    PAYMENT_STATUS_CALC compares the settled total against the
--    invoice amount: UNPAID / PARTIALLY PAID / FULLY PAID.
--    The stored PAID_STATUS / AMOUNT_PAID columns are kept too.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW RR_V_AP_INVOICE_ACCT_STATUS AS
WITH pay AS (
    SELECT
        INVOICE_ID,
        COUNT(DISTINCT CHECK_ID)                       AS PAYMENTS_APPLIED,
        MAX(CHECK_ID)                                  AS LAST_CHECK_ID,
        SUM(NVL(AMOUNT_PAID_INVOICE_CURRENCY, 0)
          + NVL(DISCOUNT_TAKEN, 0))                    AS AMOUNT_PAID_CALC
    FROM RR_AP_PAYMENTS_RELATED_INVOICES
    GROUP BY INVOICE_ID
),
prep AS (
    SELECT
        INVOICE_ID,
        SUM(NVL(APPLIED_AMOUNT, 0))                    AS PREPAY_APPLIED_AMOUNT
    FROM RR_AP_APPLIED_PREPAYMENTS
    WHERE STATUS = 'Applied'
    GROUP BY INVOICE_ID
),
gl AS (
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
    -- ── payment status ────────────────────────────────────────
    NVL(pp.PAYMENTS_APPLIED, 0)                        AS PAYMENTS_APPLIED,
    pp.LAST_CHECK_ID,
    NVL(pp.AMOUNT_PAID_CALC, 0)                        AS AMOUNT_PAID_CALC,
    NVL(pr.PREPAY_APPLIED_AMOUNT, 0)                   AS PREPAY_APPLIED_AMOUNT,
    NVL(pp.AMOUNT_PAID_CALC, 0)
      + NVL(pr.PREPAY_APPLIED_AMOUNT, 0)               AS TOTAL_SETTLED,
    CASE
        WHEN NVL(pp.AMOUNT_PAID_CALC, 0) + NVL(pr.PREPAY_APPLIED_AMOUNT, 0) = 0
             THEN 'UNPAID'
        WHEN ABS(NVL(pp.AMOUNT_PAID_CALC, 0) + NVL(pr.PREPAY_APPLIED_AMOUNT, 0))
             >= ABS(NVL(i.INVOICE_AMOUNT, 0)) - 0.01
             THEN 'FULLY PAID'
        ELSE 'PARTIALLY PAID'
    END                                                AS PAYMENT_STATUS_CALC,
    -- ── accounting status derived from the matched GL lines ──
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
LEFT JOIN pay pp ON pp.INVOICE_ID = i.INVOICE_ID
LEFT JOIN prep pr ON pr.INVOICE_ID = i.INVOICE_ID
LEFT JOIN gl g ON g.INVOICE_ID_CHAR = TO_CHAR(i.INVOICE_ID)
;

COMMENT ON TABLE  RR_V_AP_INVOICE_ACCT_STATUS IS 'Accounting + payment status per AP invoice: GL lines matched on REFERENCE2 = invoice_id with REFERENCE5 = AP-INVOICE-* / AP-PREPAYMENT-APPLICATION. GL_STATUS: ACCOUNTED / CANCEL ACCOUNTED / NOT ACCOUNTED. PAYMENT_STATUS_CALC (live, from payment applications + applied prepayments): UNPAID / PARTIALLY PAID / FULLY PAID';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.PAYMENT_STATUS_CALC   IS 'Derived live: UNPAID (nothing settled), PARTIALLY PAID, FULLY PAID (settled >= invoice amount, 1 cent tolerance). Settled = payment applications in invoice currency + discount taken + applied prepayments';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.AMOUNT_PAID_CALC      IS 'Sum of payment applications from RR_AP_PAYMENTS_RELATED_INVOICES (invoice currency, incl. discount taken)';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.PREPAY_APPLIED_AMOUNT IS 'Sum of applied prepayments from RR_AP_APPLIED_PREPAYMENTS (status Applied)';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.TOTAL_SETTLED         IS 'AMOUNT_PAID_CALC + PREPAY_APPLIED_AMOUNT — compare with INVOICE_AMOUNT';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.PAYMENTS_APPLIED      IS 'Distinct payments (CHECK_ID) applied to this invoice';
COMMENT ON COLUMN RR_V_AP_INVOICE_ACCT_STATUS.PAID_STATUS           IS 'Stored status from the invoices table (sync-driven) — PAYMENT_STATUS_CALC is the live derivation';
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
-- 1. External cash transactions
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW RR_V_EXT_TXN_ACCT_STATUS AS
WITH gl AS (
    SELECT
        l.REFERENCE2                                   AS EXT_TXN_ID_CHAR,
        COUNT(DISTINCT l.JE_HEADER_ID)                 AS JOURNAL_COUNT,
        MAX(l.JE_HEADER_ID)                            AS LAST_JE_HEADER_ID,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_GL_PERIOD,
        MAX(h.POSTING_STATUS)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_POSTING_STATUS,
        SUM(NVL(l.ACCOUNTED_DR, 0))                    AS GL_ACCOUNTED_DR,
        SUM(NVL(l.ACCOUNTED_CR, 0))                    AS GL_ACCOUNTED_CR
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE l.REFERENCE2 IS NOT NULL
      AND l.REFERENCE5 = 'BANK_EXTERNAL_TRANSACTIONS'
    GROUP BY l.REFERENCE2
)
SELECT
    x.EXTERNAL_TRANSACTION_ID,
    x.TRANSACTION_ID,
    x.TRANSACTION_DATE,
    x.AMOUNT,
    x.CURRENCY_CODE,
    x.TRANSACTION_TYPE,
    x.DESCRIPTION,
    x.BANK_ACCOUNT_NAME,
    x.BUSINESS_UNIT_NAME,
    x.SOURCE,
    x.STATUS,
    x.ACCOUNTING_FLAG,
    CASE WHEN NVL(g.JOURNAL_COUNT, 0) > 0 THEN 'ACCOUNTED' ELSE 'NOT ACCOUNTED' END AS GL_STATUS,
    NVL(g.JOURNAL_COUNT, 0)                            AS JOURNAL_COUNT,
    g.LAST_JE_HEADER_ID,
    g.LAST_GL_PERIOD,
    g.LAST_POSTING_STATUS,
    NVL(g.GL_ACCOUNTED_DR, 0)                          AS GL_ACCOUNTED_DR,
    NVL(g.GL_ACCOUNTED_CR, 0)                          AS GL_ACCOUNTED_CR
FROM RR_EXTERNAL_CASH_TRANSACTIONS x
LEFT JOIN gl g ON g.EXT_TXN_ID_CHAR = TO_CHAR(x.EXTERNAL_TRANSACTION_ID)
;

COMMENT ON TABLE  RR_V_EXT_TXN_ACCT_STATUS IS 'Accounting status per external cash transaction: GL lines matched on REFERENCE2 = external_transaction_id with REFERENCE5 = BANK_EXTERNAL_TRANSACTIONS. GL_STATUS: ACCOUNTED / NOT ACCOUNTED';
COMMENT ON COLUMN RR_V_EXT_TXN_ACCT_STATUS.GL_STATUS       IS 'ACCOUNTED = GL journal exists for this transaction; NOT ACCOUNTED = none';
COMMENT ON COLUMN RR_V_EXT_TXN_ACCT_STATUS.ACCOUNTING_FLAG IS 'Stored flag on the transaction row — GL_STATUS is the live derivation from journal lines';


-- ------------------------------------------------------------
-- 2. Fixed assets: addition + depreciation + retirement
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW RR_V_FA_ASSET_ACCT_STATUS AS
WITH gl_add AS (
    SELECT
        l.REFERENCE2                                   AS ASSET_ID_CHAR,
        COUNT(DISTINCT l.JE_HEADER_ID)                 AS ADD_JOURNALS,
        MAX(l.JE_HEADER_ID)                            AS ADD_LAST_JE_HEADER_ID,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS ADD_GL_PERIOD
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE l.REFERENCE2 IS NOT NULL
      AND l.REFERENCE5 = 'FA_ADDITIONS'
    GROUP BY l.REFERENCE2
),
-- Depreciation lines carry distribution_id in REFERENCE2, so the asset
-- linkage is REFERENCE1 = asset_number
gl_dep AS (
    SELECT
        l.REFERENCE1                                   AS ASSET_NUMBER_CHAR,
        COUNT(DISTINCT h.PERIOD_NAME)                  AS DEPRN_PERIODS_ACCOUNTED,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_DEPRN_PERIOD,
        SUM(NVL(l.ACCOUNTED_DR, 0))                    AS DEPRN_ACCOUNTED_DR
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE l.REFERENCE1 IS NOT NULL
      AND l.REFERENCE5 = 'FA_DEPRECIATION'
    GROUP BY l.REFERENCE1
),
gl_ret AS (
    SELECT
        r.ASSET_ID,
        COUNT(DISTINCT l.JE_HEADER_ID)                 AS RET_JOURNALS,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS RET_GL_PERIOD
    FROM RR_FA_RETIREMENTS r
    JOIN RR_GL_JE_LINES_ALL l
      ON l.REFERENCE2 = TO_CHAR(r.RETIREMENT_ID)
     AND l.REFERENCE5 = 'FA_RETIREMENT'
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    GROUP BY r.ASSET_ID
)
SELECT
    a.ASSET_ID,
    a.ASSET_NUMBER,
    a.DESCRIPTION,
    a.ASSET_TYPE,
    CASE WHEN NVL(ga.ADD_JOURNALS, 0) > 0 THEN 'ACCOUNTED' ELSE 'NOT ACCOUNTED' END AS ADDITION_STATUS,
    ga.ADD_GL_PERIOD,
    ga.ADD_LAST_JE_HEADER_ID,
    CASE WHEN NVL(gd.DEPRN_PERIODS_ACCOUNTED, 0) > 0 THEN 'ACCOUNTED' ELSE 'NOT ACCOUNTED' END AS DEPRN_STATUS,
    NVL(gd.DEPRN_PERIODS_ACCOUNTED, 0)                 AS DEPRN_PERIODS_ACCOUNTED,
    gd.LAST_DEPRN_PERIOD,
    NVL(gd.DEPRN_ACCOUNTED_DR, 0)                      AS DEPRN_ACCOUNTED_TOTAL,
    CASE WHEN NVL(gr.RET_JOURNALS, 0) > 0 THEN 'ACCOUNTED' ELSE 'NOT ACCOUNTED' END AS RETIREMENT_STATUS,
    gr.RET_GL_PERIOD
FROM RR_FA_ADDITIONS a
LEFT JOIN gl_add ga ON ga.ASSET_ID_CHAR     = TO_CHAR(a.ASSET_ID)
LEFT JOIN gl_dep gd ON gd.ASSET_NUMBER_CHAR = TO_CHAR(a.ASSET_NUMBER)
LEFT JOIN gl_ret gr ON gr.ASSET_ID          = a.ASSET_ID
;

COMMENT ON TABLE  RR_V_FA_ASSET_ACCT_STATUS IS 'Accounting status per fixed asset: addition (REFERENCE2=asset_id, REFERENCE5=FA_ADDITIONS), depreciation (REFERENCE1=asset_number, REFERENCE5=FA_DEPRECIATION), retirement (REFERENCE2=retirement_id, REFERENCE5=FA_RETIREMENT). Each status: ACCOUNTED / NOT ACCOUNTED';
COMMENT ON COLUMN RR_V_FA_ASSET_ACCT_STATUS.DEPRN_PERIODS_ACCOUNTED IS 'How many GL periods have depreciation journals for this asset';
COMMENT ON COLUMN RR_V_FA_ASSET_ACCT_STATUS.LAST_DEPRN_PERIOD       IS 'Latest GL period with a depreciation journal for this asset';
COMMENT ON COLUMN RR_V_FA_ASSET_ACCT_STATUS.DEPRN_ACCOUNTED_TOTAL   IS 'Total accounted Dr of depreciation journal lines (expense side) for this asset';


-- ------------------------------------------------------------
-- 3. AR invoices
--    NOTE: the app does not yet create AR-invoice journals; the
--    ref5 list below covers the expected naming so the view
--    lights up as soon as that flow ships.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW RR_V_AR_INVOICE_ACCT_STATUS AS
WITH gl AS (
    SELECT
        l.REFERENCE2                                   AS TRX_ID_CHAR,
        COUNT(DISTINCT l.JE_HEADER_ID)                 AS JOURNAL_COUNT,
        MAX(l.JE_HEADER_ID)                            AS LAST_JE_HEADER_ID,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_GL_PERIOD,
        MAX(h.POSTING_STATUS)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_POSTING_STATUS,
        SUM(NVL(l.ACCOUNTED_DR, 0))                    AS GL_ACCOUNTED_DR,
        SUM(NVL(l.ACCOUNTED_CR, 0))                    AS GL_ACCOUNTED_CR
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE l.REFERENCE2 IS NOT NULL
      AND l.REFERENCE5 IN ('AR_INVOICES', 'AR-INVOICE-CREATION', 'AR_INVOICE_CREATION')
    GROUP BY l.REFERENCE2
)
SELECT
    i.CUSTOMER_TRANSACTION_ID,
    i.TRANSACTION_NUMBER,
    i.TRANSACTION_TYPE,
    i.TRANSACTION_DATE,
    i.ACCOUNTING_DATE,
    i.DUE_DATE,
    i.BILL_TO_CUSTOMER_NAME,
    i.BILL_TO_CUSTOMER_NUMBER,
    i.BUSINESS_UNIT,
    i.INVOICE_CURRENCY_CODE,
    i.ENTERED_AMOUNT,
    i.INVOICE_BALANCE_AMOUNT,
    i.INVOICE_STATUS,
    -- payment status derived from the open balance
    CASE
        WHEN NVL(i.INVOICE_BALANCE_AMOUNT, NVL(i.ENTERED_AMOUNT, 0)) = 0
             AND NVL(i.ENTERED_AMOUNT, 0) <> 0                        THEN 'FULLY PAID'
        WHEN NVL(i.INVOICE_BALANCE_AMOUNT, 0) <> 0
             AND NVL(i.INVOICE_BALANCE_AMOUNT, 0) <> NVL(i.ENTERED_AMOUNT, 0) THEN 'PARTIALLY PAID'
        ELSE 'UNPAID'
    END                                                AS PAYMENT_STATUS_CALC,
    CASE WHEN NVL(g.JOURNAL_COUNT, 0) > 0 THEN 'ACCOUNTED' ELSE 'NOT ACCOUNTED' END AS GL_STATUS,
    NVL(g.JOURNAL_COUNT, 0)                            AS JOURNAL_COUNT,
    g.LAST_JE_HEADER_ID,
    g.LAST_GL_PERIOD,
    g.LAST_POSTING_STATUS
FROM RR_AR_INVOICE_HEADERS i
LEFT JOIN gl g ON g.TRX_ID_CHAR = TO_CHAR(i.CUSTOMER_TRANSACTION_ID)
;

COMMENT ON TABLE  RR_V_AR_INVOICE_ACCT_STATUS IS 'Accounting + payment status per AR invoice: GL lines matched on REFERENCE2 = customer_transaction_id (REFERENCE5 = AR_INVOICES variants). PAYMENT_STATUS_CALC from the invoice open balance: UNPAID / PARTIALLY PAID / FULLY PAID';
COMMENT ON COLUMN RR_V_AR_INVOICE_ACCT_STATUS.PAYMENT_STATUS_CALC IS 'FULLY PAID = balance 0 on a non-zero invoice; PARTIALLY PAID = balance differs from entered amount; else UNPAID';
COMMENT ON COLUMN RR_V_AR_INVOICE_ACCT_STATUS.GL_STATUS           IS 'ACCOUNTED = GL journal exists referencing this invoice; NOT ACCOUNTED = none';


-- ------------------------------------------------------------
-- 4. AR receipts
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW RR_V_AR_RECEIPT_ACCT_STATUS AS
WITH gl AS (
    SELECT
        l.REFERENCE2                                   AS RECEIPT_ID_CHAR,
        COUNT(DISTINCT l.JE_HEADER_ID)                 AS JOURNAL_COUNT,
        MAX(l.JE_HEADER_ID)                            AS LAST_JE_HEADER_ID,
        MAX(h.PERIOD_NAME)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_GL_PERIOD,
        MAX(h.POSTING_STATUS)
            KEEP (DENSE_RANK LAST ORDER BY l.JE_HEADER_ID) AS LAST_POSTING_STATUS,
        SUM(CASE WHEN l.REFERENCE5 = 'AR_RECEIPTS'    THEN 1 ELSE 0 END) AS RECEIPT_LINES,
        SUM(CASE WHEN l.REFERENCE5 = 'AR_ADJUSTMENTS' THEN 1 ELSE 0 END) AS ADJUSTMENT_LINES,
        SUM(NVL(l.ACCOUNTED_DR, 0))                    AS GL_ACCOUNTED_DR,
        SUM(NVL(l.ACCOUNTED_CR, 0))                    AS GL_ACCOUNTED_CR
    FROM RR_GL_JE_LINES_ALL l
    JOIN RR_GL_JE_HEADERS   h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    WHERE l.REFERENCE2 IS NOT NULL
      AND l.REFERENCE5 IN ('AR_RECEIPTS', 'AR_ADJUSTMENTS')
    GROUP BY l.REFERENCE2
)
SELECT
    r.STANDARD_RECEIPT_ID,
    r.RECEIPT_NUMBER,
    r.RECEIPT_TYPE,
    r.CUSTOMER_NAME,
    r.CUSTOMER_ACCOUNT_NUMBER,
    r.BUSINESS_UNIT,
    r.RECEIPT_DATE,
    r.ACCOUNTING_DATE,
    r.AMOUNT,
    NVL(r.UNAPPLIED_AMOUNT, 0)                         AS UNAPPLIED_AMOUNT,
    r.CURRENCY,
    r.STATUS,
    -- application status from the receipt's own unapplied amount
    CASE
        WHEN NVL(r.UNAPPLIED_AMOUNT, 0) = 0                 THEN 'FULLY APPLIED'
        WHEN NVL(r.UNAPPLIED_AMOUNT, 0) = NVL(r.AMOUNT, 0)  THEN 'UNAPPLIED'
        ELSE 'PARTIALLY APPLIED'
    END                                                AS APPLICATION_STATUS,
    CASE WHEN NVL(g.RECEIPT_LINES, 0) > 0 THEN 'ACCOUNTED' ELSE 'NOT ACCOUNTED' END AS GL_STATUS,
    CASE WHEN NVL(g.ADJUSTMENT_LINES, 0) > 0 THEN 'Y' ELSE 'N' END AS ADJUSTMENT_ACCOUNTED,
    NVL(g.JOURNAL_COUNT, 0)                            AS JOURNAL_COUNT,
    g.LAST_JE_HEADER_ID,
    g.LAST_GL_PERIOD,
    g.LAST_POSTING_STATUS,
    NVL(g.GL_ACCOUNTED_DR, 0)                          AS GL_ACCOUNTED_DR,
    NVL(g.GL_ACCOUNTED_CR, 0)                          AS GL_ACCOUNTED_CR
FROM RR_AR_RECEIPTS r
LEFT JOIN gl g ON g.RECEIPT_ID_CHAR = TO_CHAR(r.STANDARD_RECEIPT_ID)
;

COMMENT ON TABLE  RR_V_AR_RECEIPT_ACCT_STATUS IS 'Accounting status per AR receipt: GL lines matched on REFERENCE2 = standard_receipt_id with REFERENCE5 = AR_RECEIPTS (adjustments flagged separately via AR_ADJUSTMENTS). GL_STATUS: ACCOUNTED / NOT ACCOUNTED; APPLICATION_STATUS: UNAPPLIED / PARTIALLY APPLIED / FULLY APPLIED';
COMMENT ON COLUMN RR_V_AR_RECEIPT_ACCT_STATUS.APPLICATION_STATUS   IS 'From the receipt unapplied amount: FULLY APPLIED (0 left), UNAPPLIED (all left), else PARTIALLY APPLIED';
COMMENT ON COLUMN RR_V_AR_RECEIPT_ACCT_STATUS.ADJUSTMENT_ACCOUNTED IS 'Y when AR_ADJUSTMENTS journal lines exist for this receipt';


-- ------------------------------------------------------------
-- Verify — all six views compiled + status distributions
-- ------------------------------------------------------------
SELECT view_name, 'OK' AS status
FROM   user_views
WHERE  view_name IN ('RR_V_AP_INVOICE_ACCT_STATUS', 'RR_V_AP_PAYMENT_ACCT_STATUS',
                     'RR_V_EXT_TXN_ACCT_STATUS',    'RR_V_FA_ASSET_ACCT_STATUS',
                     'RR_V_AR_INVOICE_ACCT_STATUS', 'RR_V_AR_RECEIPT_ACCT_STATUS')
ORDER  BY view_name;

SELECT 'AP_INVOICES' AS src, gl_status, COUNT(*) AS cnt FROM rr_v_ap_invoice_acct_status GROUP BY gl_status
UNION ALL SELECT 'AP_PAYMENTS', gl_status, COUNT(*) FROM rr_v_ap_payment_acct_status GROUP BY gl_status
UNION ALL SELECT 'EXT_TXNS',    gl_status, COUNT(*) FROM rr_v_ext_txn_acct_status    GROUP BY gl_status
UNION ALL SELECT 'AR_INVOICES', gl_status, COUNT(*) FROM rr_v_ar_invoice_acct_status GROUP BY gl_status
UNION ALL SELECT 'AR_RECEIPTS', gl_status, COUNT(*) FROM rr_v_ar_receipt_acct_status GROUP BY gl_status
UNION ALL SELECT 'FA_ADDITIONS', addition_status, COUNT(*) FROM rr_v_fa_asset_acct_status GROUP BY addition_status
ORDER BY 1, 2;
