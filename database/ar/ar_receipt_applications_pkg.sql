-- =====================================================
-- AR Receipt Applications PL/SQL Package
-- Package : RR_AR_RECEIPT_APPLICATIONS_PKG
-- Table   : RR_AR_RECEIPT_APPLICATIONS
-- =====================================================

CREATE OR REPLACE PACKAGE RR_AR_RECEIPT_APPLICATIONS_PKG AS

    PROCEDURE save_applications_bulk (
        p_json      IN  CLOB,
        p_status    OUT VARCHAR2,
        p_message   OUT VARCHAR2,
        p_inserted  OUT NUMBER,
        p_updated   OUT NUMBER,
        p_errors    OUT NUMBER
    );

END RR_AR_RECEIPT_APPLICATIONS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_AR_RECEIPT_APPLICATIONS_PKG AS

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
    -- save_applications_bulk: {"items":[...]}
    -- Each item carries CustAccountId injected by the sync
    -- service before posting.
    -- -------------------------------------------------------
    PROCEDURE save_applications_bulk (
        p_json      IN  CLOB,
        p_status    OUT VARCHAR2,
        p_message   OUT VARCHAR2,
        p_inserted  OUT NUMBER,
        p_updated   OUT NUMBER,
        p_errors    OUT NUMBER
    ) IS
        l_errors    NUMBER := 0;
        l_err_log   VARCHAR2(4000) := '';
    BEGIN
        p_inserted := 0;
        p_updated  := 0;
        p_errors   := 0;

        FOR rec IN (
            SELECT j.*
            FROM JSON_TABLE(p_json, '$.items[*]' COLUMNS (
                APPLICATION_ID                  NUMBER         PATH '$.ApplicationId',
                APPLICATION_DATE_STR            VARCHAR2(50)   PATH '$.ApplicationDate',
                APPLICATION_AMOUNT              NUMBER         PATH '$.ApplicationAmount',
                APPLICATION_STATUS              VARCHAR2(50)   PATH '$.ApplicationStatus',
                ACCOUNTING_DATE_STR             VARCHAR2(50)   PATH '$.AccountingDate',
                REFERENCE_INSTALLMENT_ID        NUMBER         PATH '$.ReferenceInstallmentId',
                REFERENCE_TRANSACTION_NUMBER    VARCHAR2(50)   PATH '$.ReferenceTransactionNumber',
                REFERENCE_TRANSACTION_ID        NUMBER         PATH '$.ReferenceTransactionId',
                REFERENCE_TRANSACTION_STATUS    VARCHAR2(50)   PATH '$.ReferenceTransactionStatus',
                ACTIVITY_NAME                   VARCHAR2(240)  PATH '$.ActivityName',
                STANDARD_RECEIPT_ID             NUMBER         PATH '$.StandardReceiptId',
                RECEIPT_NUMBER                  VARCHAR2(50)   PATH '$.ReceiptNumber',
                ENTERED_CURRENCY                VARCHAR2(15)   PATH '$.EnteredCurrency',
                RECEIPT_METHOD                  VARCHAR2(240)  PATH '$.ReceiptMethod',
                PROCESS_STATUS                  VARCHAR2(50)   PATH '$.ProcessStatus',
                IS_LATEST_APPLICATION           VARCHAR2(1)    PATH '$.IsLatestApplication',
                CUST_ACCOUNT_ID                 NUMBER         PATH '$.CustAccountId',
                CUSTOMER_SITE                   VARCHAR2(240)  PATH '$.CustomerSite',
                FUSION_CREATED_BY               VARCHAR2(240)  PATH '$.CreatedBy',
                CREATION_DATE_STR               VARCHAR2(50)   PATH '$.CreationDate',
                FUSION_LAST_UPDATED_BY          VARCHAR2(240)  PATH '$.LastUpdatedBy',
                LAST_UPDATE_DATE_STR            VARCHAR2(50)   PATH '$.LastUpdateDate'
            )) j
        ) LOOP
            DECLARE
                l_app_date   DATE;
                l_acct_date  DATE;
                l_cr_ts      TIMESTAMP;
                l_upd_ts     TIMESTAMP;
                l_exists     NUMBER;
            BEGIN
                l_app_date  := to_safe_date(rec.APPLICATION_DATE_STR);
                l_acct_date := to_safe_date(rec.ACCOUNTING_DATE_STR);
                l_cr_ts     := to_safe_ts(rec.CREATION_DATE_STR);
                l_upd_ts    := to_safe_ts(rec.LAST_UPDATE_DATE_STR);

                SELECT COUNT(*) INTO l_exists
                FROM RR_AR_RECEIPT_APPLICATIONS
                WHERE APPLICATION_ID = rec.APPLICATION_ID;

                MERGE INTO RR_AR_RECEIPT_APPLICATIONS a
                USING DUAL
                ON (a.APPLICATION_ID = rec.APPLICATION_ID)
                WHEN MATCHED THEN UPDATE SET
                    APPLICATION_DATE             = l_app_date,
                    APPLICATION_AMOUNT           = rec.APPLICATION_AMOUNT,
                    APPLICATION_STATUS           = rec.APPLICATION_STATUS,
                    ACCOUNTING_DATE              = l_acct_date,
                    REFERENCE_INSTALLMENT_ID     = rec.REFERENCE_INSTALLMENT_ID,
                    REFERENCE_TRANSACTION_NUMBER = rec.REFERENCE_TRANSACTION_NUMBER,
                    REFERENCE_TRANSACTION_ID     = rec.REFERENCE_TRANSACTION_ID,
                    REFERENCE_TRANSACTION_STATUS = rec.REFERENCE_TRANSACTION_STATUS,
                    ACTIVITY_NAME                = rec.ACTIVITY_NAME,
                    STANDARD_RECEIPT_ID          = rec.STANDARD_RECEIPT_ID,
                    RECEIPT_NUMBER               = rec.RECEIPT_NUMBER,
                    ENTERED_CURRENCY             = rec.ENTERED_CURRENCY,
                    RECEIPT_METHOD               = rec.RECEIPT_METHOD,
                    PROCESS_STATUS               = rec.PROCESS_STATUS,
                    IS_LATEST_APPLICATION        = rec.IS_LATEST_APPLICATION,
                    CUST_ACCOUNT_ID              = rec.CUST_ACCOUNT_ID,
                    CUSTOMER_SITE                = rec.CUSTOMER_SITE,
                    FUSION_CREATED_BY            = rec.FUSION_CREATED_BY,
                    FUSION_CREATION_DATE         = l_cr_ts,
                    FUSION_LAST_UPDATED_BY       = rec.FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE      = l_upd_ts,
                    LAST_UPDATED_BY              = USER,
                    LAST_UPDATE_DATE             = SYSTIMESTAMP,
                    SYNC_DATE                    = SYSTIMESTAMP,
                    SYNC_STATUS                  = 'UPDATED'
                WHEN NOT MATCHED THEN INSERT (
                    APPLICATION_ID,
                    APPLICATION_DATE,            APPLICATION_AMOUNT,
                    APPLICATION_STATUS,          ACCOUNTING_DATE,
                    REFERENCE_INSTALLMENT_ID,    REFERENCE_TRANSACTION_NUMBER,
                    REFERENCE_TRANSACTION_ID,    REFERENCE_TRANSACTION_STATUS,
                    ACTIVITY_NAME,               STANDARD_RECEIPT_ID,
                    RECEIPT_NUMBER,              ENTERED_CURRENCY,
                    RECEIPT_METHOD,              PROCESS_STATUS,
                    IS_LATEST_APPLICATION,       CUST_ACCOUNT_ID,
                    CUSTOMER_SITE,               FUSION_CREATED_BY,
                    FUSION_CREATION_DATE,        FUSION_LAST_UPDATED_BY,
                    FUSION_LAST_UPDATE_DATE,     SYNC_STATUS
                ) VALUES (
                    rec.APPLICATION_ID,
                    l_app_date,                  rec.APPLICATION_AMOUNT,
                    rec.APPLICATION_STATUS,      l_acct_date,
                    rec.REFERENCE_INSTALLMENT_ID, rec.REFERENCE_TRANSACTION_NUMBER,
                    rec.REFERENCE_TRANSACTION_ID, rec.REFERENCE_TRANSACTION_STATUS,
                    rec.ACTIVITY_NAME,           rec.STANDARD_RECEIPT_ID,
                    rec.RECEIPT_NUMBER,          rec.ENTERED_CURRENCY,
                    rec.RECEIPT_METHOD,          rec.PROCESS_STATUS,
                    rec.IS_LATEST_APPLICATION,   rec.CUST_ACCOUNT_ID,
                    rec.CUSTOMER_SITE,           rec.FUSION_CREATED_BY,
                    l_cr_ts,                     rec.FUSION_LAST_UPDATED_BY,
                    l_upd_ts,                    'NEW'
                );

                IF l_exists > 0 THEN
                    p_updated  := p_updated  + 1;
                ELSE
                    p_inserted := p_inserted + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    p_errors := p_errors + 1;
                    IF p_errors <= 3 THEN
                        l_err_log := l_err_log || ' | [' || p_errors || '] AppId=' ||
                            NVL(TO_CHAR(rec.APPLICATION_ID), '?') ||
                            ': ' || SUBSTR(SQLERRM, 1, 200);
                    END IF;
            END;
        END LOOP;

        COMMIT;
        p_status  := 'SUCCESS';
        p_message := 'Applications complete. Inserted: ' || p_inserted ||
                     ', Updated: ' || p_updated ||
                     ', Errors: '  || p_errors  ||
                     CASE WHEN l_err_log IS NOT NULL THEN ' -- ERRORS:' || l_err_log ELSE '' END;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END save_applications_bulk;

END RR_AR_RECEIPT_APPLICATIONS_PKG;
/
