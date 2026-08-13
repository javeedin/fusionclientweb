-- =====================================================
-- AR Receipt Applications Table
-- Table   : RR_AR_RECEIPT_APPLICATIONS
-- Source  : Oracle Fusion standardReceiptApplications
--           (child of receivablesCustomerAccountActivities)
-- =====================================================

DROP TABLE RR_AR_RECEIPT_APPLICATIONS CASCADE CONSTRAINTS;

CREATE TABLE RR_AR_RECEIPT_APPLICATIONS (
    -- Primary Key (Fusion ApplicationId)
    APPLICATION_ID                  NUMBER          NOT NULL,

    -- Application fields
    APPLICATION_DATE                DATE,
    APPLICATION_AMOUNT              NUMBER(18,2),
    APPLICATION_STATUS              VARCHAR2(50),
    ACCOUNTING_DATE                 DATE,

    -- Reference transaction
    REFERENCE_INSTALLMENT_ID        NUMBER,
    REFERENCE_TRANSACTION_NUMBER    VARCHAR2(50),
    REFERENCE_TRANSACTION_ID        NUMBER,
    REFERENCE_TRANSACTION_STATUS    VARCHAR2(50),

    -- Activity / Receipt
    ACTIVITY_NAME                   VARCHAR2(240),
    STANDARD_RECEIPT_ID             NUMBER,
    RECEIPT_NUMBER                  VARCHAR2(50),
    ENTERED_CURRENCY                VARCHAR2(15),
    RECEIPT_METHOD                  VARCHAR2(240),
    PROCESS_STATUS                  VARCHAR2(50),
    IS_LATEST_APPLICATION           VARCHAR2(1),

    -- Customer linkage (from APEX ar/customers loop)
    CUST_ACCOUNT_ID                 NUMBER,
    CUSTOMER_SITE                   VARCHAR2(240),

    -- Audit from Fusion
    FUSION_CREATED_BY               VARCHAR2(240),
    FUSION_CREATION_DATE            TIMESTAMP,
    FUSION_LAST_UPDATED_BY          VARCHAR2(240),
    FUSION_LAST_UPDATE_DATE         TIMESTAMP,

    -- Sync tracking
    SYNC_STATUS                     VARCHAR2(20)    DEFAULT 'NEW',
    SYNC_DATE                       TIMESTAMP,
    LAST_UPDATED_BY                 VARCHAR2(100),
    LAST_UPDATE_DATE                TIMESTAMP,
    ERROR_MESSAGE                   VARCHAR2(4000),

    CONSTRAINT PK_RR_AR_RCPT_APPS PRIMARY KEY (APPLICATION_ID)
);

-- Indexes
CREATE INDEX IDX_RCPT_APPS_RCPT_ID    ON RR_AR_RECEIPT_APPLICATIONS (STANDARD_RECEIPT_ID);
CREATE INDEX IDX_RCPT_APPS_CUST       ON RR_AR_RECEIPT_APPLICATIONS (CUST_ACCOUNT_ID);
CREATE INDEX IDX_RCPT_APPS_APP_DATE   ON RR_AR_RECEIPT_APPLICATIONS (APPLICATION_DATE);
CREATE INDEX IDX_RCPT_APPS_STATUS     ON RR_AR_RECEIPT_APPLICATIONS (APPLICATION_STATUS, PROCESS_STATUS);
CREATE INDEX IDX_RCPT_APPS_REF_TXN    ON RR_AR_RECEIPT_APPLICATIONS (REFERENCE_TRANSACTION_NUMBER);

COMMENT ON TABLE RR_AR_RECEIPT_APPLICATIONS IS 'AR Standard Receipt Applications synced from Oracle Fusion';
