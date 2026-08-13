-- =============================================================
-- PATCH 05 — RR_AR_ADJUSTMENTS
-- Add INSTALLMENT_ID column and update package to persist it.
-- Safe to re-run.
-- =============================================================

-- ── 1. Add column ────────────────────────────────────────────
BEGIN
    EXECUTE IMMEDIATE '
        ALTER TABLE RR_AR_ADJUSTMENTS
        ADD (INSTALLMENT_ID NUMBER)
    ';
    DBMS_OUTPUT.PUT_LINE('Column INSTALLMENT_ID added.');
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -01430 THEN
            DBMS_OUTPUT.PUT_LINE('Column INSTALLMENT_ID already exists — skipped.');
        ELSE RAISE;
        END IF;
END;
/

COMMENT ON COLUMN RR_AR_ADJUSTMENTS.INSTALLMENT_ID
    IS 'Links this adjustment to the specific installment in RR_AR_INVOICE_INSTALLMENTS.';

-- ── 2. Update package body ───────────────────────────────────
CREATE OR REPLACE PACKAGE BODY RR_AR_ADJUSTMENTS_PKG AS

    FUNCTION to_safe_date (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(SUBSTR(TRIM(p_str), 1, 10), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_date;

    FUNCTION to_safe_ts (p_str IN VARCHAR2) RETURN TIMESTAMP IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP_TZ(TRIM(p_str), 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            RETURN TO_TIMESTAMP(SUBSTR(TRIM(p_str), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS');
        EXCEPTION WHEN OTHERS THEN RETURN NULL;
        END;
    END to_safe_ts;

    PROCEDURE save_adjustments_bulk (
        p_json      IN  CLOB,
        p_status    OUT VARCHAR2,
        p_message   OUT VARCHAR2,
        p_inserted  OUT NUMBER,
        p_updated   OUT NUMBER,
        p_errors    OUT NUMBER
    ) IS
        l_errors    NUMBER        := 0;
        l_err_log   VARCHAR2(4000) := '';
    BEGIN
        p_inserted := 0;
        p_updated  := 0;
        p_errors   := 0;

        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_json, '$.items[*]' COLUMNS (
                ADJUSTMENT_ID               NUMBER         PATH '$.AdjustmentId',
                ADJUSTMENT_NUMBER           VARCHAR2(30)   PATH '$.AdjustmentNumber',
                ADJUSTMENT_TYPE             VARCHAR2(100)  PATH '$.AdjustmentType',
                ADJUSTMENT_AMOUNT           NUMBER         PATH '$.AdjustmentAmount',
                ADJUSTMENT_DATE_STR         VARCHAR2(30)   PATH '$.AdjustmentDate',
                ACCOUNTING_DATE_STR         VARCHAR2(30)   PATH '$.AccountingDate',
                STATUS                      VARCHAR2(30)   PATH '$.Status',
                RECEIVABLES_ACTIVITY        VARCHAR2(240)  PATH '$.ReceivablesActivity',
                BUSINESS_UNIT               VARCHAR2(240)  PATH '$.BusinessUnit',
                CUSTOMER_TRANSACTION_ID     NUMBER         PATH '$.CustomerTransactionId',
                TRANSACTION_NUMBER          VARCHAR2(50)   PATH '$.TransactionNumber',
                TRANSACTION_CLASS           VARCHAR2(30)   PATH '$.TransactionClass',
                ACCOUNTED_AMOUNT            NUMBER         PATH '$.AccountedAmount',
                CURRENCY                    VARCHAR2(15)   PATH '$.Currency',
                INSTALLMENT_NUMBER          NUMBER         PATH '$.InstallmentNumber',
                INSTALLMENT_ID              NUMBER         PATH '$.InstallmentId',
                INSTALLMENT_BALANCE         NUMBER         PATH '$.InstallmentBalance',
                ADJUSTMENT_REASON           VARCHAR2(240)  PATH '$.AdjustmentReason',
                APPROVED_BY                 VARCHAR2(240)  PATH '$.ApprovedBy',
                BILL_TO_SITE_USE_ID         NUMBER         PATH '$.BillToSiteUseId',
                COMMENTS                    VARCHAR2(4000) PATH '$.Comments',
                ACCOUNT_COMBINATION         VARCHAR2(500)  PATH '$.AccountCombination',
                APPLICATION_ID              NUMBER         PATH '$.ApplicationId',
                FUSION_CREATED_BY           VARCHAR2(240)  PATH '$.CreatedBy',
                CREATION_DATE_STR           VARCHAR2(50)   PATH '$.CreationDate',
                FUSION_LAST_UPDATED_BY      VARCHAR2(240)  PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE_STR        VARCHAR2(50)   PATH '$.LastUpdateDate'
            )) j
        ) LOOP
            DECLARE
                l_adj_date  DATE;
                l_acct_date DATE;
                l_cr_ts     TIMESTAMP;
                l_upd_ts    TIMESTAMP;
                l_exists    NUMBER;
                l_adj_id    NUMBER;
            BEGIN
                l_adj_date  := to_safe_date(rec.ADJUSTMENT_DATE_STR);
                l_acct_date := to_safe_date(rec.ACCOUNTING_DATE_STR);
                l_cr_ts     := to_safe_ts(rec.CREATION_DATE_STR);
                l_upd_ts    := to_safe_ts(rec.LAST_UPDATE_DATE_STR);

                -- Auto-generate ADJUSTMENT_ID if not supplied
                IF rec.ADJUSTMENT_ID IS NULL THEN
                    SELECT NVL(MAX(ADJUSTMENT_ID), 0) + 1 INTO l_adj_id FROM RR_AR_ADJUSTMENTS;
                ELSE
                    l_adj_id := rec.ADJUSTMENT_ID;
                END IF;

                SELECT COUNT(*) INTO l_exists
                FROM RR_AR_ADJUSTMENTS
                WHERE ADJUSTMENT_ID = l_adj_id;

                MERGE INTO RR_AR_ADJUSTMENTS t
                USING DUAL
                ON (t.ADJUSTMENT_ID = l_adj_id)
                WHEN MATCHED THEN UPDATE SET
                    t.ADJUSTMENT_NUMBER       = rec.ADJUSTMENT_NUMBER,
                    t.ADJUSTMENT_TYPE         = rec.ADJUSTMENT_TYPE,
                    t.ADJUSTMENT_AMOUNT       = rec.ADJUSTMENT_AMOUNT,
                    t.ADJUSTMENT_DATE         = l_adj_date,
                    t.ACCOUNTING_DATE         = l_acct_date,
                    t.STATUS                  = rec.STATUS,
                    t.RECEIVABLES_ACTIVITY    = rec.RECEIVABLES_ACTIVITY,
                    t.BUSINESS_UNIT           = rec.BUSINESS_UNIT,
                    t.CUSTOMER_TRANSACTION_ID = rec.CUSTOMER_TRANSACTION_ID,
                    t.TRANSACTION_NUMBER      = rec.TRANSACTION_NUMBER,
                    t.TRANSACTION_CLASS       = rec.TRANSACTION_CLASS,
                    t.ACCOUNTED_AMOUNT        = rec.ACCOUNTED_AMOUNT,
                    t.CURRENCY                = rec.CURRENCY,
                    t.INSTALLMENT_NUMBER      = rec.INSTALLMENT_NUMBER,
                    t.INSTALLMENT_ID          = rec.INSTALLMENT_ID,
                    t.INSTALLMENT_BALANCE     = rec.INSTALLMENT_BALANCE,
                    t.ADJUSTMENT_REASON       = rec.ADJUSTMENT_REASON,
                    t.APPROVED_BY             = rec.APPROVED_BY,
                    t.BILL_TO_SITE_USE_ID     = rec.BILL_TO_SITE_USE_ID,
                    t.COMMENTS                = rec.COMMENTS,
                    t.ACCOUNT_COMBINATION     = rec.ACCOUNT_COMBINATION,
                    t.APPLICATION_ID          = rec.APPLICATION_ID,
                    t.FUSION_CREATED_BY       = rec.FUSION_CREATED_BY,
                    t.FUSION_CREATION_DATE    = l_cr_ts,
                    t.FUSION_LAST_UPDATED_BY  = rec.FUSION_LAST_UPDATED_BY,
                    t.FUSION_LAST_UPDATE_DATE = l_upd_ts,
                    t.SYNC_STATUS             = 'UPDATED',
                    t.SYNC_DATE               = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (
                    ADJUSTMENT_ID,            ADJUSTMENT_NUMBER,
                    ADJUSTMENT_TYPE,          ADJUSTMENT_AMOUNT,
                    ADJUSTMENT_DATE,          ACCOUNTING_DATE,
                    STATUS,                   RECEIVABLES_ACTIVITY,
                    BUSINESS_UNIT,            CUSTOMER_TRANSACTION_ID,
                    TRANSACTION_NUMBER,       TRANSACTION_CLASS,
                    ACCOUNTED_AMOUNT,         CURRENCY,
                    INSTALLMENT_NUMBER,       INSTALLMENT_ID,
                    INSTALLMENT_BALANCE,      ADJUSTMENT_REASON,
                    APPROVED_BY,              BILL_TO_SITE_USE_ID,
                    COMMENTS,                 ACCOUNT_COMBINATION,
                    APPLICATION_ID,           FUSION_CREATED_BY,
                    FUSION_CREATION_DATE,     FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE,  SYNC_STATUS,
                    SYNC_DATE
                ) VALUES (
                    l_adj_id,                 rec.ADJUSTMENT_NUMBER,
                    rec.ADJUSTMENT_TYPE,      rec.ADJUSTMENT_AMOUNT,
                    l_adj_date,               l_acct_date,
                    rec.STATUS,               rec.RECEIVABLES_ACTIVITY,
                    rec.BUSINESS_UNIT,        rec.CUSTOMER_TRANSACTION_ID,
                    rec.TRANSACTION_NUMBER,   rec.TRANSACTION_CLASS,
                    rec.ACCOUNTED_AMOUNT,     rec.CURRENCY,
                    rec.INSTALLMENT_NUMBER,   rec.INSTALLMENT_ID,
                    rec.INSTALLMENT_BALANCE,  rec.ADJUSTMENT_REASON,
                    rec.APPROVED_BY,          rec.BILL_TO_SITE_USE_ID,
                    rec.COMMENTS,             rec.ACCOUNT_COMBINATION,
                    rec.APPLICATION_ID,       rec.FUSION_CREATED_BY,
                    l_cr_ts,                  rec.FUSION_LAST_UPDATED_BY,
                    l_upd_ts,                 'NEW',
                    SYSTIMESTAMP
                );

                IF l_exists > 0 THEN p_updated  := p_updated  + 1;
                ELSE                 p_inserted := p_inserted + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    p_errors := p_errors + 1;
                    IF p_errors <= 3 THEN
                        l_err_log := l_err_log
                            || ' | [' || p_errors || '] AdjId='
                            || NVL(TO_CHAR(rec.ADJUSTMENT_ID), '?')
                            || ': ' || SUBSTR(SQLERRM, 1, 200);
                    END IF;
            END;
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Adjustments complete. Inserted: ' || p_inserted
                  || ', Updated: '  || p_updated
                  || ', Errors: '   || p_errors
                  || CASE WHEN l_err_log IS NOT NULL
                          THEN ' -- ERRORS:' || l_err_log ELSE '' END;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_adjustments_bulk;

END RR_AR_ADJUSTMENTS_PKG;
/

SHOW ERRORS PACKAGE BODY RR_AR_ADJUSTMENTS_PKG;
