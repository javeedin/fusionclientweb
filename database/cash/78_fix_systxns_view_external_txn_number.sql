-- ============================================================
-- PATCH 78: Fix RR_V_BANK_RECON_SYSTXNS — EXTERNAL_TXN TXN_NUMBER
--
-- Problem:
--   The view uses NVL(e.CHECK_NUMBER, TO_CHAR(e.TRANSACTION_ID))
--   as TXN_NUMBER for external transactions. When both CHECK_NUMBER
--   and TRANSACTION_ID are NULL, TXN_NUMBER is also NULL, so the
--   "Txn #" column in the bank reconciliation page shows blank.
--
-- Fix:
--   Add a final fallback to TO_CHAR(e.EXTERNAL_TRANSACTION_ID) so
--   TXN_NUMBER is never NULL for external transaction rows.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run the single CREATE OR REPLACE VIEW statement below.
-- ============================================================

CREATE OR REPLACE VIEW RR_V_BANK_RECON_SYSTXNS AS

    -- ── AP Payments ──────────────────────────────────────────────────────────
    SELECT
        'AP_PAYMENT'                            AS SOURCE,
        TO_CHAR(p.CHECK_ID)                     AS TXN_ID,
        p.PAYMENT_NUMBER                        AS TXN_NUMBER,
        p.PAYMENT_REFERENCE                     AS REFERENCE,
        p.PAYMENT_DATE                          AS TXN_DATE,
        p.PAYMENT_AMOUNT                        AS AMOUNT,
        p.PAYMENT_CURRENCY                      AS CURRENCY_CODE,
        p.PAYMENT_STATUS                        AS STATUS,
        p.DISBURSEMENT_BANK_ACCOUNT_NAME        AS BANK_ACCOUNT_NAME,
        p.BUSINESS_UNIT                         AS BUSINESS_UNIT,
        p.PAYEE                                 AS COUNTERPARTY_NAME,
        p.SUPPLIER_NUMBER                       AS COUNTERPARTY_NUMBER,
        p.PAYMENT_MODE                          AS PAYMENT_METHOD,
        p.CLEARING_DATE                         AS CLEARING_DATE,
        NVL(p.RECONCILED_FLAG, 'N')             AS RECONCILED_FLAG,
        NULL                                    AS DESCRIPTION,
        NULL                                    AS ACCOUNTING_CLASS,
        NULL                                    AS JE_HEADER_ID,
        NULL                                    AS JE_LINE_NUMBER,
        NULL                                    AS ACCOUNT_COMBINATION,
        NULL                                    AS TRANSFER_ID,
        p.CREATED_BY,
        p.CREATION_DATE
    FROM RR_AP_PAYMENTS_ALL p

UNION ALL

    -- ── External Transactions ────────────────────────────────────────────────
    SELECT
        'EXTERNAL_TXN'                          AS SOURCE,
        TO_CHAR(e.EXTERNAL_TRANSACTION_ID)      AS TXN_ID,
        -- Fall back through CHECK_NUMBER → TRANSACTION_ID → EXTERNAL_TRANSACTION_ID
        NVL(NVL(e.CHECK_NUMBER, TO_CHAR(e.TRANSACTION_ID)),
            TO_CHAR(e.EXTERNAL_TRANSACTION_ID)) AS TXN_NUMBER,
        e.REFERENCE_TEXT                        AS REFERENCE,
        e.TRANSACTION_DATE                      AS TXN_DATE,
        e.AMOUNT                                AS AMOUNT,
        e.CURRENCY_CODE,
        e.STATUS,
        e.BANK_ACCOUNT_NAME,
        e.BUSINESS_UNIT_NAME                    AS BUSINESS_UNIT,
        e.PAYEE_NAME                            AS COUNTERPARTY_NAME,
        NULL                                    AS COUNTERPARTY_NUMBER,
        e.PAYMENT_METHOD,
        e.CLEARED_DATE                          AS CLEARING_DATE,
        NVL(e.RECONCILED_FLAG, 'N')             AS RECONCILED_FLAG,
        e.DESCRIPTION,
        NULL                                    AS ACCOUNTING_CLASS,
        NULL                                    AS JE_HEADER_ID,
        NULL                                    AS JE_LINE_NUMBER,
        e.ASSET_ACCOUNT_COMBINATION             AS ACCOUNT_COMBINATION,
        e.TRANSFER_ID,
        e.CREATED_BY,
        e.CREATION_DATE
    FROM RR_EXTERNAL_CASH_TRANSACTIONS e

UNION ALL

    -- ── Bank Transfers (GL Journal Lines — BANK_ASSET lines only) ────────────
    -- REFERENCE1 = bank_transfer_id  REFERENCE2 = transfer_number
    -- REFERENCE3 = accounting_class  (may be blank in existing data)
    -- REFERENCE4 = business_unit     REFERENCE5 = event_type (BANKTFR-DISBURSE|BANKTFR-RECEIPT)
    -- REFERENCE7 = bank_account_name (only set on the bank asset lines, not clearing lines)
    SELECT
        'BANK_TRANSFER'                                  AS SOURCE,
        TO_CHAR(l.JE_HEADER_ID) || '-' || TO_CHAR(l.JE_LINE_NUMBER)
                                                         AS TXN_ID,
        l.REFERENCE1                                     AS TXN_NUMBER,
        l.REFERENCE2                                     AS REFERENCE,
        TRUNC(NVL(h.DEFAULT_EFFECTIVE_DATE, b.CREATION_DATE))
                                                         AS TXN_DATE,
        NVL(l.ENTERED_DR, l.ENTERED_CR)                 AS AMOUNT,
        l.CURRENCY_CODE,
        b.STATUS,
        l.REFERENCE7                                     AS BANK_ACCOUNT_NAME,
        l.REFERENCE4                                     AS BUSINESS_UNIT,
        NULL                                             AS COUNTERPARTY_NAME,
        NULL                                             AS COUNTERPARTY_NUMBER,
        NULL                                             AS PAYMENT_METHOD,
        NULL                                             AS CLEARING_DATE,
        NVL(l.RECONCILED_FLAG, 'N')                     AS RECONCILED_FLAG,
        l.DESCRIPTION,
        l.REFERENCE3                                     AS ACCOUNTING_CLASS,
        l.JE_HEADER_ID,
        l.JE_LINE_NUMBER,
        l.ACCOUNT_COMBINATION,
        NULL                                             AS TRANSFER_ID,
        l.CREATED_BY,
        l.CREATION_DATE
    FROM RR_GL_JE_LINES_ALL    l
    JOIN RR_GL_JE_HEADERS      h ON h.JE_HEADER_ID = l.JE_HEADER_ID
    JOIN RR_GL_JOURNAL_BATCHES b ON b.JE_BATCH_ID  = l.BATCH_ID
    WHERE l.REFERENCE5 IN ('BANKTFR-DISBURSE', 'BANKTFR-RECEIPT')
      AND l.REFERENCE7 IS NOT NULL
/
