-- =====================================================
-- AR Credit Memo Applications PL/SQL Package
-- Package : RR_AR_CM_APPLICATIONS_PKG
-- Table   : RR_AR_CM_APPLICATIONS
-- =====================================================

CREATE OR REPLACE PACKAGE RR_AR_CM_APPLICATIONS_PKG AS

    PROCEDURE save_applications_bulk (
        p_json      IN  CLOB,
        p_status    OUT VARCHAR2,
        p_message   OUT VARCHAR2,
        p_inserted  OUT NUMBER,
        p_updated   OUT NUMBER,
        p_errors    OUT NUMBER
    );

END RR_AR_CM_APPLICATIONS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_AR_CM_APPLICATIONS_PKG AS

    FUNCTION to_safe_date (p_str IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_DATE(SUBSTR(TRIM(p_str), 1, 10), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_date;

    FUNCTION to_safe_ts (p_str IN VARCHAR2) RETURN TIMESTAMP IS
    BEGIN
        IF p_str IS NULL OR TRIM(p_str) IS NULL THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP(
            SUBSTR(REPLACE(TRIM(p_str), 'T', ' '), 1, 19),
            'YYYY-MM-DD HH24:MI:SS'
        );
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_safe_ts;

    -- -------------------------------------------------------
    -- save_applications_bulk  {"items":[...]}
    -- CustAccountId is injected by the sync service.
    -- -------------------------------------------------------
    PROCEDURE save_applications_bulk (
        p_json      IN  CLOB,
        p_status    OUT VARCHAR2,
        p_message   OUT VARCHAR2,
        p_inserted  OUT NUMBER,
        p_updated   OUT NUMBER,
        p_errors    OUT NUMBER
    ) IS
        l_errors   NUMBER       := 0;
        l_err_log  VARCHAR2(4000) := '';
        l_err_msg  VARCHAR2(4000);

        -- pre-computed date/timestamp variables (avoids PLS-00231)
        l_app_date     DATE;
        l_acct_date    DATE;
        l_created_ts   TIMESTAMP;
        l_updated_ts   TIMESTAMP;
        l_exists       NUMBER;
    BEGIN
        p_inserted := 0;
        p_updated  := 0;
        p_errors   := 0;

        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_json, '$.items[*]' COLUMNS (
                APPLICATION_ID               NUMBER         PATH '$.ApplicationId',
                APPLICATION_DATE_STR         VARCHAR2(50)   PATH '$.ApplicationDate',
                APPLICATION_AMOUNT           NUMBER         PATH '$.ApplicationAmount',
                APPLICATION_STATUS           VARCHAR2(50)   PATH '$.ApplicationStatus',
                ACCOUNTING_DATE_STR          VARCHAR2(50)   PATH '$.AccountingDate',
                REFERENCE_INSTALLMENT_ID     NUMBER         PATH '$.ReferenceInstallmentId',
                REFERENCE_TRANSACTION_NUMBER VARCHAR2(50)   PATH '$.ReferenceTransactionNumber',
                REFERENCE_TRANSACTION_ID     NUMBER         PATH '$.ReferenceTransactionId',
                REFERENCE_TRANSACTION_STATUS VARCHAR2(50)   PATH '$.ReferenceTransactionStatus',
                CREDIT_MEMO_ID               NUMBER         PATH '$.CreditMemoId',
                CREDIT_MEMO_NUMBER           VARCHAR2(50)   PATH '$.CreditMemoNumber',
                CREDIT_MEMO_STATUS           VARCHAR2(50)   PATH '$.CreditMemoStatus',
                ENTERED_CURRENCY             VARCHAR2(15)   PATH '$.EnteredCurrency',
                TRANSACTION_TYPE             VARCHAR2(50)   PATH '$.TransactionType',
                ACTIVITY_NAME                VARCHAR2(240)  PATH '$.ActivityName',
                IS_LATEST_APPLICATION        VARCHAR2(1)    PATH '$.IsLatestApplication',
                BILL_TO_SITE_NUMBER          VARCHAR2(50)   PATH '$.BillToSiteNumber',
                CUST_ACCOUNT_ID              NUMBER         PATH '$.CustAccountId',
                FUSION_CREATED_BY            VARCHAR2(240)  PATH '$.CreatedBy',
                FUSION_CREATION_DATE_STR     VARCHAR2(50)   PATH '$.CreationDate',
                FUSION_LAST_UPDATED_BY       VARCHAR2(240)  PATH '$.LastUpdatedBy',
                FUSION_LAST_UPDATE_DATE_STR  VARCHAR2(50)   PATH '$.LastUpdateDate'
            )) j
        ) LOOP
            BEGIN
                -- Pre-compute dates to avoid PLS-00231
                l_app_date   := to_safe_date(rec.APPLICATION_DATE_STR);
                l_acct_date  := to_safe_date(rec.ACCOUNTING_DATE_STR);
                l_created_ts := to_safe_ts(rec.FUSION_CREATION_DATE_STR);
                l_updated_ts := to_safe_ts(rec.FUSION_LAST_UPDATE_DATE_STR);

                SELECT COUNT(1) INTO l_exists
                FROM RR_AR_CM_APPLICATIONS
                WHERE APPLICATION_ID = rec.APPLICATION_ID;

                MERGE INTO RR_AR_CM_APPLICATIONS t
                USING DUAL
                ON (t.APPLICATION_ID = rec.APPLICATION_ID)
                WHEN MATCHED THEN UPDATE SET
                    t.APPLICATION_DATE             = l_app_date,
                    t.APPLICATION_AMOUNT           = rec.APPLICATION_AMOUNT,
                    t.APPLICATION_STATUS           = rec.APPLICATION_STATUS,
                    t.ACCOUNTING_DATE              = l_acct_date,
                    t.REFERENCE_INSTALLMENT_ID     = rec.REFERENCE_INSTALLMENT_ID,
                    t.REFERENCE_TRANSACTION_NUMBER = rec.REFERENCE_TRANSACTION_NUMBER,
                    t.REFERENCE_TRANSACTION_ID     = rec.REFERENCE_TRANSACTION_ID,
                    t.REFERENCE_TRANSACTION_STATUS = rec.REFERENCE_TRANSACTION_STATUS,
                    t.CREDIT_MEMO_ID               = rec.CREDIT_MEMO_ID,
                    t.CREDIT_MEMO_NUMBER           = rec.CREDIT_MEMO_NUMBER,
                    t.CREDIT_MEMO_STATUS           = rec.CREDIT_MEMO_STATUS,
                    t.ENTERED_CURRENCY             = rec.ENTERED_CURRENCY,
                    t.TRANSACTION_TYPE             = rec.TRANSACTION_TYPE,
                    t.ACTIVITY_NAME                = rec.ACTIVITY_NAME,
                    t.IS_LATEST_APPLICATION        = rec.IS_LATEST_APPLICATION,
                    t.BILL_TO_SITE_NUMBER          = rec.BILL_TO_SITE_NUMBER,
                    t.CUST_ACCOUNT_ID              = rec.CUST_ACCOUNT_ID,
                    t.FUSION_CREATED_BY            = rec.FUSION_CREATED_BY,
                    t.FUSION_CREATION_DATE         = l_created_ts,
                    t.FUSION_LAST_UPDATED_BY       = rec.FUSION_LAST_UPDATED_BY,
                    t.FUSION_LAST_UPDATE_DATE      = l_updated_ts,
                    t.SYNC_STATUS                  = 'SYNCED',
                    t.SYNC_DATE                    = SYSTIMESTAMP,
                    t.ERROR_MESSAGE                = NULL
                WHEN NOT MATCHED THEN INSERT (
                    APPLICATION_ID, APPLICATION_DATE, APPLICATION_AMOUNT,
                    APPLICATION_STATUS, ACCOUNTING_DATE,
                    REFERENCE_INSTALLMENT_ID, REFERENCE_TRANSACTION_NUMBER,
                    REFERENCE_TRANSACTION_ID, REFERENCE_TRANSACTION_STATUS,
                    CREDIT_MEMO_ID, CREDIT_MEMO_NUMBER, CREDIT_MEMO_STATUS,
                    ENTERED_CURRENCY, TRANSACTION_TYPE, ACTIVITY_NAME,
                    IS_LATEST_APPLICATION, BILL_TO_SITE_NUMBER,
                    CUST_ACCOUNT_ID,
                    FUSION_CREATED_BY, FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATED_BY, FUSION_LAST_UPDATE_DATE,
                    SYNC_STATUS, SYNC_DATE, ERROR_MESSAGE
                ) VALUES (
                    rec.APPLICATION_ID, l_app_date, rec.APPLICATION_AMOUNT,
                    rec.APPLICATION_STATUS, l_acct_date,
                    rec.REFERENCE_INSTALLMENT_ID, rec.REFERENCE_TRANSACTION_NUMBER,
                    rec.REFERENCE_TRANSACTION_ID, rec.REFERENCE_TRANSACTION_STATUS,
                    rec.CREDIT_MEMO_ID, rec.CREDIT_MEMO_NUMBER, rec.CREDIT_MEMO_STATUS,
                    rec.ENTERED_CURRENCY, rec.TRANSACTION_TYPE, rec.ACTIVITY_NAME,
                    rec.IS_LATEST_APPLICATION, rec.BILL_TO_SITE_NUMBER,
                    rec.CUST_ACCOUNT_ID,
                    rec.FUSION_CREATED_BY, l_created_ts,
                    rec.FUSION_LAST_UPDATED_BY, l_updated_ts,
                    'SYNCED', SYSTIMESTAMP, NULL
                );

                IF l_exists > 0 THEN
                    p_updated  := p_updated  + 1;
                ELSE
                    p_inserted := p_inserted + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    l_errors  := l_errors + 1;
                    l_err_msg := SUBSTR(SQLERRM, 1, 4000);
                    IF LENGTH(l_err_log) < 3500 THEN
                        l_err_log := l_err_log
                            || 'AppId=' || NVL(TO_CHAR(rec.APPLICATION_ID), '?')
                            || ': ' || l_err_msg || '; ';
                    END IF;
                    BEGIN
                        UPDATE RR_AR_CM_APPLICATIONS
                        SET SYNC_STATUS = 'ERROR', ERROR_MESSAGE = l_err_msg,
                            SYNC_DATE   = SYSTIMESTAMP
                        WHERE APPLICATION_ID = rec.APPLICATION_ID;
                    EXCEPTION WHEN OTHERS THEN NULL;
                    END;
            END;
        END LOOP;

        COMMIT;
        p_errors := l_errors;

        IF l_errors = 0 THEN
            p_status  := 'SUCCESS';
            p_message := 'Inserted: ' || p_inserted || ', Updated: ' || p_updated;
        ELSE
            p_status  := 'PARTIAL';
            p_message := 'Errors: ' || l_errors || '. ' || SUBSTR(l_err_log, 1, 3800);
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SUBSTR(SQLERRM, 1, 4000);
            p_errors  := p_errors + 1;
    END save_applications_bulk;

END RR_AR_CM_APPLICATIONS_PKG;
/
