-- =====================================================
-- AR Adjustments Table
-- Table  : RR_AR_ADJUSTMENTS
-- Source : Oracle Fusion receivablesAdjustments
-- =====================================================

DROP TABLE RR_AR_ADJUSTMENTS CASCADE CONSTRAINTS;

CREATE TABLE RR_AR_ADJUSTMENTS (
    -- Primary Key (Fusion AdjustmentId)
    ADJUSTMENT_ID               NUMBER          NOT NULL,

    -- Core adjustment fields
    ADJUSTMENT_NUMBER           VARCHAR2(30),
    ADJUSTMENT_TYPE             VARCHAR2(100),
    ADJUSTMENT_AMOUNT           NUMBER(18,2),
    ADJUSTMENT_DATE             DATE,
    ACCOUNTING_DATE             DATE,
    STATUS                      VARCHAR2(30),
    RECEIVABLES_ACTIVITY        VARCHAR2(240),

    -- Transaction linkage
    BUSINESS_UNIT               VARCHAR2(240),
    CUSTOMER_TRANSACTION_ID     NUMBER,
    TRANSACTION_NUMBER          VARCHAR2(50),
    TRANSACTION_CLASS           VARCHAR2(30),
    ACCOUNTED_AMOUNT            NUMBER(18,2),
    CURRENCY                    VARCHAR2(15),
    INSTALLMENT_NUMBER          NUMBER,
    INSTALLMENT_BALANCE         NUMBER(18,2),

    -- Approval / reason
    ADJUSTMENT_REASON           VARCHAR2(240),
    APPROVED_BY                 VARCHAR2(240),
    BILL_TO_SITE_USE_ID         NUMBER,
    COMMENTS                    VARCHAR2(4000),
    ACCOUNT_COMBINATION         VARCHAR2(500),

    -- Audit from Fusion
    FUSION_CREATED_BY           VARCHAR2(240),
    FUSION_CREATION_DATE        TIMESTAMP,
    FUSION_LAST_UPDATED_BY      VARCHAR2(240),
    FUSION_LAST_UPDATE_DATE     TIMESTAMP,

    -- Sync tracking
    SYNC_STATUS                 VARCHAR2(20)    DEFAULT 'NEW',
    SYNC_DATE                   TIMESTAMP,
    ERROR_MESSAGE               VARCHAR2(4000),

    CONSTRAINT PK_RR_AR_ADJUSTMENTS PRIMARY KEY (ADJUSTMENT_ID)
);

-- Indexes
CREATE INDEX IDX_AR_ADJ_TXN_ID  ON RR_AR_ADJUSTMENTS (CUSTOMER_TRANSACTION_ID);
CREATE INDEX IDX_AR_ADJ_TXN_NUM ON RR_AR_ADJUSTMENTS (TRANSACTION_NUMBER);
CREATE INDEX IDX_AR_ADJ_DATE    ON RR_AR_ADJUSTMENTS (ADJUSTMENT_DATE);
CREATE INDEX IDX_AR_ADJ_STATUS  ON RR_AR_ADJUSTMENTS (STATUS);
CREATE INDEX IDX_AR_ADJ_BU      ON RR_AR_ADJUSTMENTS (BUSINESS_UNIT);

COMMENT ON TABLE  RR_AR_ADJUSTMENTS IS 'AR Adjustments synced from Oracle Fusion receivablesAdjustments';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.ADJUSTMENT_ID           IS 'Fusion AdjustmentId — Primary Key';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.ADJUSTMENT_TYPE         IS 'e.g. Line Adjustments, Invoice Adjustments';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.STATUS                  IS 'Approved / More Research Required / Rejected';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.RECEIVABLES_ACTIVITY    IS 'AR Activity name e.g. PMGT Fee';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.ACCOUNT_COMBINATION     IS 'GL account combination string';
COMMENT ON COLUMN RR_AR_ADJUSTMENTS.SYNC_STATUS             IS 'NEW | UPDATED | ERROR';
