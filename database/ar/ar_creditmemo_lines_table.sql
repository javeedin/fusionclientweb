-- =====================================================
-- AR Credit Memo Lines Table
-- Table   : RR_AR_CREDITMEMO_LINES
-- Source  : Oracle Fusion receivablesCreditMemoLines
--           (child of receivablesCreditMemos)
-- =====================================================

-- DROP TABLE RR_AR_CREDITMEMO_LINES CASCADE CONSTRAINTS;

CREATE TABLE RR_AR_CREDITMEMO_LINES (

    -- Primary Key (Fusion CustomerTransactionLineId)
    CUSTOMER_TRANSACTION_LINE_ID    NUMBER          NOT NULL,

    -- Foreign Key to Header
    CUSTOMER_TRANSACTION_ID         NUMBER          NOT NULL,

    -- Line Identity
    LINE_NUMBER                     NUMBER,
    LINE_DESCRIPTION                VARCHAR2(4000),     -- LineDescription
    LINE_TRANSLATED_DESCRIPTION     VARCHAR2(4000),     -- CM-specific

    -- Item
    ITEM_NUMBER                     VARCHAR2(100),
    UNIT_OF_MEASURE                 VARCHAR2(50),
    WAREHOUSE                       VARCHAR2(100),
    MEMO_LINE                       VARCHAR2(240),

    -- Quantities & Amounts (CM-specific names)
    LINE_QUANTITY_CREDIT            NUMBER,             -- LineQuantityCredit
    UNIT_SELLING_PRICE              NUMBER,
    LINE_AMOUNT_CREDIT              NUMBER,             -- LineAmountCredit
    ASSESSABLE_VALUE                NUMBER,             -- TransactionLineAssessableValue
    LINE_FREIGHT_CREDIT_AMOUNT      NUMBER,             -- CM-specific

    -- Credit Reason (CM-specific)
    LINE_CREDIT_REASON              VARCHAR2(240),      -- LineCreditReason

    -- Sales Order
    SALES_ORDER_NUMBER              VARCHAR2(50),       -- SalesOrderNumber
    SALES_ORDER_DATE                DATE,
    SALES_ORDER_LINE                VARCHAR2(50),       -- CM-specific
    SALES_ORDER_REVISION            VARCHAR2(50),       -- CM-specific
    SALES_ORDER_CHANNEL             VARCHAR2(50),       -- CM-specific

    -- Tax
    TAX_INVOICE_NUMBER              VARCHAR2(50),       -- CM-specific
    TAX_INVOICE_DATE                DATE,               -- CM-specific
    TAX_CLASSIFICATION_CODE         VARCHAR2(100),
    LINE_TAX_EXEMPTION_HANDLING     VARCHAR2(50),       -- LineTaxExemptionHandling
    LINE_AMOUNT_INCLUDES_TAX        VARCHAR2(50),       -- CM-specific
    TAX_EXEMPTION_REASON            VARCHAR2(100),
    TAX_EXEMPTION_CERT_NUMBER       VARCHAR2(100),      -- TaxExemptionCertificateNumber

    -- Classification
    TRANSACTION_BUSINESS_CATEGORY   VARCHAR2(100),
    PRODUCT_FISCAL_CLASSIFICATION   VARCHAR2(100),
    PRODUCT_CATEGORY                VARCHAR2(100),      -- LineProductCategory
    PRODUCT_TYPE                    VARCHAR2(50),       -- LineProductType
    LINE_INTENDED_USE               VARCHAR2(100),
    USER_DEFINED_FISCAL_CLASS       VARCHAR2(100),      -- UserDefinedFiscalClassification

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

    CONSTRAINT RR_AR_CML_PK PRIMARY KEY (CUSTOMER_TRANSACTION_LINE_ID),
    CONSTRAINT RR_AR_CML_HDR_FK FOREIGN KEY (CUSTOMER_TRANSACTION_ID)
        REFERENCES RR_AR_CREDITMEMO_HEADERS (CUSTOMER_TRANSACTION_ID) ON DELETE CASCADE
);

CREATE INDEX RR_AR_CML_HDR_IX ON RR_AR_CREDITMEMO_LINES (CUSTOMER_TRANSACTION_ID);

COMMENT ON TABLE  RR_AR_CREDITMEMO_LINES IS 'AR Credit Memo Lines from Oracle Fusion receivablesCreditMemoLines';
COMMENT ON COLUMN RR_AR_CREDITMEMO_LINES.CUSTOMER_TRANSACTION_LINE_ID IS 'Oracle Fusion CustomerTransactionLineId (PK)';
COMMENT ON COLUMN RR_AR_CREDITMEMO_LINES.CUSTOMER_TRANSACTION_ID      IS 'FK to RR_AR_CREDITMEMO_HEADERS';
COMMENT ON COLUMN RR_AR_CREDITMEMO_LINES.LINE_AMOUNT_CREDIT            IS 'Fusion LineAmountCredit (typically negative)';

COMMIT;
