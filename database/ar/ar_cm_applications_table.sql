-- =====================================================
-- AR Credit Memo Applications Table
-- Table   : RR_AR_CM_APPLICATIONS
-- Source  : Oracle Fusion creditMemoApplications
--           (child of receivablesCustomerAccountActivities)
-- =====================================================

-- DROP TABLE RR_AR_CM_APPLICATIONS CASCADE CONSTRAINTS;

CREATE TABLE RR_AR_CM_APPLICATIONS (

    -- Primary Key (Fusion ApplicationId)
    APPLICATION_ID                  NUMBER          NOT NULL,

    -- Application core fields
    APPLICATION_DATE                DATE,
    APPLICATION_AMOUNT              NUMBER(18,2),
    APPLICATION_STATUS              VARCHAR2(50),
    ACCOUNTING_DATE                 DATE,

    -- Reference (applied-to) transaction
    REFERENCE_INSTALLMENT_ID        NUMBER,
    REFERENCE_TRANSACTION_NUMBER    VARCHAR2(50),
    REFERENCE_TRANSACTION_ID        NUMBER,
    REFERENCE_TRANSACTION_STATUS    VARCHAR2(50),

    -- Credit Memo (source)
    CREDIT_MEMO_ID                  NUMBER,
    CREDIT_MEMO_NUMBER              VARCHAR2(50),
    CREDIT_MEMO_STATUS              VARCHAR2(50),

    -- Other
    ENTERED_CURRENCY                VARCHAR2(15),
    TRANSACTION_TYPE                VARCHAR2(50),
    ACTIVITY_NAME                   VARCHAR2(240),
    IS_LATEST_APPLICATION           VARCHAR2(1),
    BILL_TO_SITE_NUMBER             VARCHAR2(50),

    -- Customer linkage (injected by sync service)
    CUST_ACCOUNT_ID                 NUMBER,

    -- Fusion Audit
    FUSION_CREATED_BY               VARCHAR2(240),
    FUSION_CREATION_DATE            TIMESTAMP,
    FUSION_LAST_UPDATED_BY          VARCHAR2(240),
    FUSION_LAST_UPDATE_DATE         TIMESTAMP,

    -- Sync tracking
    SYNC_STATUS                     VARCHAR2(20)    DEFAULT 'NEW',
    SYNC_DATE                       TIMESTAMP       DEFAULT SYSTIMESTAMP,
    ERROR_MESSAGE                   VARCHAR2(4000),

    CONSTRAINT PK_RR_AR_CM_APPS PRIMARY KEY (APPLICATION_ID)
);

CREATE INDEX IDX_CM_APPS_CUST        ON RR_AR_CM_APPLICATIONS (CUST_ACCOUNT_ID);
CREATE INDEX IDX_CM_APPS_CM_ID       ON RR_AR_CM_APPLICATIONS (CREDIT_MEMO_ID);
CREATE INDEX IDX_CM_APPS_CM_NUM      ON RR_AR_CM_APPLICATIONS (CREDIT_MEMO_NUMBER);
CREATE INDEX IDX_CM_APPS_APP_DATE    ON RR_AR_CM_APPLICATIONS (APPLICATION_DATE);
CREATE INDEX IDX_CM_APPS_STATUS      ON RR_AR_CM_APPLICATIONS (APPLICATION_STATUS);
CREATE INDEX IDX_CM_APPS_REF_TXN     ON RR_AR_CM_APPLICATIONS (REFERENCE_TRANSACTION_NUMBER);

COMMENT ON TABLE  RR_AR_CM_APPLICATIONS IS 'AR Credit Memo Applications synced from Oracle Fusion creditMemoApplications';
COMMENT ON COLUMN RR_AR_CM_APPLICATIONS.APPLICATION_ID    IS 'Oracle Fusion ApplicationId (PK)';
COMMENT ON COLUMN RR_AR_CM_APPLICATIONS.CUST_ACCOUNT_ID   IS 'Oracle Fusion CustAccountId — injected by sync service';

COMMIT;
