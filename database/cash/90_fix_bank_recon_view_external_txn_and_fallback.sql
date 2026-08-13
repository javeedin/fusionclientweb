-- ============================================================
-- PATCH 90: Fix RR_V_BANK_RECON_SYSTXNS
--
-- Problem 1: External-transaction GL lines were appearing in the
--   BANK_TRANSFER section because they had REFERENCE5 set to
--   'BANKTFR-DISBURSE'/'BANKTFR-RECEIPT' AND REFERENCE7 populated
--   with the bank account name.  The old filter (REFERENCE7 IS NOT NULL)
--   was not sufficient to exclude them.
--
-- Fix 1: Change the implicit cross-reference to an INNER JOIN on
--   RR_BANK_ACCOUNT_TRANSFERS using REFERENCE1 = BANK_ACCOUNT_TRANSFER_ID.
--   External-transaction GL lines whose REFERENCE1 is not a valid
--   bank-transfer ID will fail the join and be excluded automatically.
--
-- Problem 2: Genuine bank-transfer GL lines created before REFERENCE7
--   was consistently populated had REFERENCE7 = NULL, so they were
--   hidden from users and could not be queried for reconciliation.
--
-- Fix 2: COALESCE(REFERENCE7, FROM/TO_BANK_ACCOUNT_NAME from the
--   joined RR_BANK_ACCOUNT_TRANSFERS row) ensures the bank account
--   name is always resolved:
--     BANKTFR-DISBURSE -> FROM_BANK_ACCOUNT_NAME
--     BANKTFR-RECEIPT  -> TO_BANK_ACCOUNT_NAME
--   The old AND REFERENCE7 IS NOT NULL filter is removed.
--
-- HOW TO RUN:
--   APEX SQL Workshop -> SQL Commands
--   Run the single CREATE OR REPLACE VIEW statement below.
-- ============================================================

CREATE OR REPLACE VIEW RR_V_BANK_RECON_SYSTXNS AS

    -- AP Payments
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

    -- External Transactions
    SELECT
        'EXTERNAL_TXN'                          AS SOURCE,
        TO_CHAR(e.EXTERNAL_TRANSACTION_ID)      AS TXN_ID,
        NVL(NVL(e.CHECK_NUMBER, TO_CHAR(e.TRANSACTION_ID)),
            TO_CHAR(e.EXTERNAL_TRANSACTION_ID)) AS TXN_NUMBER,
        e.REFERENCE_TEXT                        AS REFERENCE,
        e.TRANSACTION_DATE                      AS TXN_DATE,
        ABS(e.AMOUNT)                           AS AMOUNT,
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

    -- Bank Transfers (GL Journal Lines -- BANK_ASSET lines only)
    -- REFERENCE1 = bank_transfer_id  REFERENCE2 = transfer_number
    -- REFERENCE3 = accounting_class  REFERENCE4 = business_unit
    -- REFERENCE5 = event_type (BANKTFR-DISBURSE|BANKTFR-RECEIPT)
    -- REFERENCE7 = bank_account_name (may be blank; resolved via RR_BANK_ACCOUNT_TRANSFERS)
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
        COALESCE(
            l.REFERENCE7,
            CASE l.REFERENCE5
                WHEN 'BANKTFR-DISBURSE' THEN bt.FROM_BANK_ACCOUNT_NAME
                WHEN 'BANKTFR-RECEIPT'  THEN bt.TO_BANK_ACCOUNT_NAME
            END
        )                                                AS BANK_ACCOUNT_NAME,
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
    JOIN RR_GL_JE_HEADERS      h  ON h.JE_HEADER_ID  = l.JE_HEADER_ID
    JOIN RR_GL_JOURNAL_BATCHES b  ON b.JE_BATCH_ID   = l.BATCH_ID
    JOIN RR_BANK_ACCOUNT_TRANSFERS bt
                                  ON TO_CHAR(bt.BANK_ACCOUNT_TRANSFER_ID) = l.REFERENCE1
    WHERE l.REFERENCE5 IN ('BANKTFR-DISBURSE', 'BANKTFR-RECEIPT')
/
