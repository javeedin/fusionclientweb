-- =====================================================
-- AR Receipts Table
-- Source : Oracle Fusion standardReceipts REST API
-- Table  : RR_AR_RECEIPTS
-- =====================================================

-- DROP TABLE RR_AR_RECEIPTS CASCADE CONSTRAINTS;

CREATE TABLE RR_AR_RECEIPTS (
    -- Primary Key (Fusion StandardReceiptId)
    STANDARD_RECEIPT_ID                     NUMBER          NOT NULL,

    -- Receipt Identifiers
    RECEIPT_NUMBER                          VARCHAR2(50),
    DOCUMENT_NUMBER                         NUMBER,
    BUSINESS_UNIT                           VARCHAR2(240),
    RECEIPT_METHOD                          VARCHAR2(240),

    -- Dates
    RECEIPT_DATE                            DATE,
    ACCOUNTING_DATE                         DATE,
    MATURITY_DATE                           DATE,
    POSTMARK_DATE                           DATE,
    REMITTANCE_BANK_DEPOSIT_DATE            DATE,

    -- Amounts
    AMOUNT                                  NUMBER,
    UNAPPLIED_AMOUNT                        NUMBER,
    ACCOUNTED_AMOUNT                        NUMBER,

    -- Currency
    CURRENCY                                VARCHAR2(15),
    CONVERSION_RATE_TYPE                    VARCHAR2(30),
    CONVERSION_DATE                         DATE,
    CONVERSION_RATE                         NUMBER,

    -- State & Status
    STATE                                   VARCHAR2(30),
    STATUS                                  VARCHAR2(30),
    RECEIPT_AT_RISK                         VARCHAR2(1),

    -- Remittance Bank
    REMITTANCE_BANK_NAME                    VARCHAR2(240),
    REMITTANCE_BANK_BRANCH                  VARCHAR2(240),
    REMITTANCE_BANK_ACCOUNT_NUMBER          VARCHAR2(100),
    REMITTANCE_BANK_ALLOW_OVERRIDE          VARCHAR2(1),

    -- Customer
    CUSTOMER_NAME                           VARCHAR2(360),
    CUSTOMER_ACCOUNT_NUMBER                 VARCHAR2(30),
    CUSTOMER_SITE                           VARCHAR2(240),
    TAXPAYER_IDENTIFICATION_NUMBER          VARCHAR2(50),
    CUSTOMER_BANK                           VARCHAR2(240),
    CUSTOMER_BANK_BRANCH                    VARCHAR2(240),
    CUSTOMER_BANK_ACCOUNT_NUMBER            VARCHAR2(100),

    -- Credit Card
    CREDIT_CARD_TOKEN_NUMBER                VARCHAR2(80),
    CREDIT_CARD_AUTH_REQUEST_ID             VARCHAR2(50),
    CARD_HOLDER_FIRST_NAME                  VARCHAR2(60),
    CARD_HOLDER_LAST_NAME                   VARCHAR2(60),
    CREDIT_CARD_ISSUER_CODE                 VARCHAR2(80),
    CREDIT_CARD_EXPIRATION_DATE             DATE,
    VOICE_AUTHORIZATION_CODE                VARCHAR2(10),

    -- Reversal
    REVERSAL_CATEGORY                       VARCHAR2(20),
    REVERSAL_REASON                         VARCHAR2(240),
    REVERSAL_DATE                           DATE,
    REVERSAL_COMMENTS                       VARCHAR2(4000),

    -- Batch
    RECEIPT_BATCH_NAME                      VARCHAR2(20),
    RECEIPT_BATCH_DATE                      DATE,

    -- Other
    RECEIVABLES_SPECIALIST                  VARCHAR2(30),
    COMMENTS                                VARCHAR2(4000),
    STRUCTURED_PAYMENT_REFERENCE            VARCHAR2(100),

    -- Fusion Audit
    FUSION_CREATED_BY                       VARCHAR2(240),
    FUSION_CREATION_DATE                    TIMESTAMP,
    FUSION_LAST_UPDATED_BY                  VARCHAR2(240),
    FUSION_LAST_UPDATE_DATE                 TIMESTAMP,

    -- Sync Tracking
    SYNC_STATUS                             VARCHAR2(20)   DEFAULT 'NEW',
    SYNC_DATE                               TIMESTAMP,
    LAST_UPDATED_BY                         VARCHAR2(240),
    LAST_UPDATE_DATE                        TIMESTAMP,
    ERROR_MESSAGE                           VARCHAR2(4000),

    CONSTRAINT RR_AR_RECEIPTS_PK PRIMARY KEY (STANDARD_RECEIPT_ID)
);

-- Indexes for common search filters
CREATE INDEX RR_AR_RECEIPTS_IX1 ON RR_AR_RECEIPTS (RECEIPT_DATE);
CREATE INDEX RR_AR_RECEIPTS_IX2 ON RR_AR_RECEIPTS (CUSTOMER_ACCOUNT_NUMBER);
CREATE INDEX RR_AR_RECEIPTS_IX3 ON RR_AR_RECEIPTS (BUSINESS_UNIT);
CREATE INDEX RR_AR_RECEIPTS_IX4 ON RR_AR_RECEIPTS (STATE, STATUS);
CREATE INDEX RR_AR_RECEIPTS_IX5 ON RR_AR_RECEIPTS (RECEIPT_NUMBER);

COMMENT ON TABLE  RR_AR_RECEIPTS IS 'AR Standard Receipts synced from Oracle Fusion standardReceipts API';

-- =====================================================
-- Additional columns (added manually on existing DBs)
-- =====================================================
-- ALTER TABLE RR_AR_RECEIPTS ADD (
--     RECEIPT_TYPE          VARCHAR2(10),   -- 'CASH' or 'MISC'
--     RECEIVABLES_TRX_ID    NUMBER,         -- activity for misc receipts
--     MISC_PAYMENT_SOURCE   VARCHAR2(50)
-- );
-- CREATE INDEX RR_AR_RECEIPTS_IX6 ON RR_AR_RECEIPTS (RECEIPT_TYPE);

-- DR / CR account code combinations (run once on existing DBs)
ALTER TABLE RR_AR_RECEIPTS ADD (
    DR_ACCOUNT   VARCHAR2(100),
    CR_ACCOUNT   VARCHAR2(100)
);

-- Receipt Method ID (run once on existing DBs)
ALTER TABLE RR_AR_RECEIPTS ADD (
    RECEIPT_METHOD_ID   NUMBER
);

-- Accounting Status (run once on existing DBs)
ALTER TABLE RR_AR_RECEIPTS ADD (
    ACCOUNTING_STATUS   VARCHAR2(20)
);

-- =====================================================
-- Sequence for locally created receipts
-- Run once on each DB. Start value (9000000000) is well
-- above any Oracle Fusion StandardReceiptId range so
-- locally-created rows are always distinguishable.
-- =====================================================
CREATE SEQUENCE RR_AR_RECEIPTS_LOCAL_SEQ
    START WITH  9000000000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;
