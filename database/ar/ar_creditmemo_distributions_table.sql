-- =====================================================
-- AR Credit Memo Distributions Table
-- Table   : RR_AR_CREDITMEMO_DISTRIBUTIONS
-- Source  : Oracle Fusion receivablesCreditMemoDistributions
--           (child of receivablesCreditMemos)
-- =====================================================

-- DROP TABLE RR_AR_CREDITMEMO_DISTRIBUTIONS CASCADE CONSTRAINTS;

CREATE TABLE RR_AR_CREDITMEMO_DISTRIBUTIONS (

    -- Primary Key (Fusion DistributionId)
    DISTRIBUTION_ID                 NUMBER          NOT NULL,

    -- FK to Header
    CUSTOMER_TRANSACTION_ID         NUMBER          NOT NULL,

    -- Distribution Identity
    CREDIT_MEMO_LINE_NUMBER         NUMBER,             -- CreditMemoLineNumber (CM-specific)
    DETAILED_TAX_LINE_NUMBER        NUMBER,
    ACCOUNT_CLASS                   VARCHAR2(100),
    ACCOUNT_COMBINATION             VARCHAR2(240),

    -- Amounts
    AMOUNT                          NUMBER,
    ACCOUNTED_AMOUNT                NUMBER,
    PERCENT                         NUMBER,

    -- Other
    COMMENTS                        VARCHAR2(4000),

    -- Fusion Audit
    FUSION_CREATED_BY               VARCHAR2(240),
    FUSION_CREATION_DATE            TIMESTAMP,
    FUSION_LAST_UPDATED_BY          VARCHAR2(240),
    FUSION_LAST_UPDATE_DATE         TIMESTAMP,

    -- Local Audit
    CREATED_BY                      VARCHAR2(100)   DEFAULT USER,
    CREATION_DATE                   TIMESTAMP       DEFAULT SYSTIMESTAMP,
    LAST_UPDATED_BY                 VARCHAR2(100),
    LAST_UPDATE_DATE                TIMESTAMP,
    SYNC_DATE                       TIMESTAMP       DEFAULT SYSTIMESTAMP,
    SYNC_STATUS                     VARCHAR2(20)    DEFAULT 'NEW',
    ERROR_MESSAGE                   VARCHAR2(4000),

    CONSTRAINT RR_AR_CMD_PK PRIMARY KEY (DISTRIBUTION_ID),
    CONSTRAINT RR_AR_CMD_HDR_FK FOREIGN KEY (CUSTOMER_TRANSACTION_ID)
        REFERENCES RR_AR_CREDITMEMO_HEADERS (CUSTOMER_TRANSACTION_ID) ON DELETE CASCADE
);

CREATE INDEX RR_AR_CMD_HDR_IX   ON RR_AR_CREDITMEMO_DISTRIBUTIONS (CUSTOMER_TRANSACTION_ID);
CREATE INDEX RR_AR_CMD_CLASS_IX ON RR_AR_CREDITMEMO_DISTRIBUTIONS (ACCOUNT_CLASS);

COMMENT ON TABLE  RR_AR_CREDITMEMO_DISTRIBUTIONS IS 'AR Credit Memo Distributions from Oracle Fusion receivablesCreditMemoDistributions';
COMMENT ON COLUMN RR_AR_CREDITMEMO_DISTRIBUTIONS.DISTRIBUTION_ID         IS 'Oracle Fusion DistributionId (PK)';
COMMENT ON COLUMN RR_AR_CREDITMEMO_DISTRIBUTIONS.CUSTOMER_TRANSACTION_ID IS 'FK to RR_AR_CREDITMEMO_HEADERS';

COMMIT;
