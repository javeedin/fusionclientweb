-- =====================================================
-- AP Invoice Lines Table
-- =====================================================
-- Created: 2024
-- Description: Stores AP Invoice Lines from Oracle Fusion
-- =====================================================

-- Drop existing table (if needed for recreation)
-- DROP TABLE XXAP_INVOICE_LINES_STG CASCADE CONSTRAINTS;

CREATE TABLE XXAP_INVOICE_LINES_STG (
    -- Primary Key
    LINE_ID                             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Foreign Key to Invoice Header
    INVOICE_ID                          NUMBER NOT NULL,
    INVOICE_NUMBER                      VARCHAR2(50),

    -- Line Identification
    LINE_NUMBER                         NUMBER,
    LINE_TYPE                           VARCHAR2(50),
    LINE_SOURCE                         VARCHAR2(100),

    -- Amounts
    LINE_AMOUNT                         NUMBER,
    BASE_AMOUNT                         NUMBER,
    UNIT_PRICE                          NUMBER,
    QUANTITY                            NUMBER,
    ASSESSABLE_VALUE                    NUMBER,
    TAX_CONTROL_AMOUNT                  NUMBER,

    -- Dates
    ACCOUNTING_DATE                     DATE,
    BUDGET_DATE                         DATE,
    MULTIPERIOD_START_DATE              DATE,
    MULTIPERIOD_END_DATE                DATE,

    -- Description
    DESCRIPTION                         VARCHAR2(4000),
    ITEM                                VARCHAR2(240),
    ITEM_DESCRIPTION                    VARCHAR2(4000),

    -- Unit of Measure
    UOM                                 VARCHAR2(25),

    -- Distribution
    DISTRIBUTION_COMBINATION            VARCHAR2(500),
    DISTRIBUTION_SET                    VARCHAR2(240),
    GENERATE_DISTRIBUTIONS              VARCHAR2(10),

    -- Tax Information
    TAX_RATE_NAME                       VARCHAR2(240),
    TAX_RATE_CODE                       VARCHAR2(50),
    TAX_RATE                            NUMBER,
    TAX_CLASSIFICATION                  VARCHAR2(240),
    INCOME_TAX_TYPE                     VARCHAR2(100),
    INCOME_TAX_REGION                   VARCHAR2(100),

    -- Asset Information
    ASSET_BOOK                          VARCHAR2(30),
    ASSET_CATEGORY                      VARCHAR2(240),
    TRACK_AS_ASSET_FLAG                 VARCHAR2(1) DEFAULT 'N',

    -- Flags
    PRORATE_ACROSS_ALL_ITEMS_FLAG       VARCHAR2(1) DEFAULT 'N',
    LANDED_COST_ENABLED                 VARCHAR2(1) DEFAULT 'N',
    DISCARDED_FLAG                      VARCHAR2(1) DEFAULT 'N',
    CANCELED_FLAG                       VARCHAR2(1) DEFAULT 'N',
    FINAL_MATCH_FLAG                    VARCHAR2(1) DEFAULT 'N',
    PREPAYMENT_INCLUDED_FLAG            VARCHAR2(1),

    -- Status
    APPROVAL_STATUS                     VARCHAR2(50),
    FUNDS_STATUS                        VARCHAR2(50),

    -- Matching Information
    MATCH_TYPE                          VARCHAR2(50),
    MATCH_OPTION                        VARCHAR2(50),
    MATCH_BASIS                         VARCHAR2(50),

    -- PO Reference
    PURCHASE_ORDER_NUMBER               VARCHAR2(50),
    PURCHASE_ORDER_LINE_NUMBER          NUMBER,
    PURCHASE_ORDER_SCHEDULE_LINE_NUMBER NUMBER,

    -- Receipt Reference
    RECEIPT_NUMBER                      VARCHAR2(50),
    RECEIPT_LINE_NUMBER                 NUMBER,

    -- Consumption Advice Reference
    CONSUMPTION_ADVICE_NUMBER           VARCHAR2(50),
    CONSUMPTION_ADVICE_LINE_NUMBER      NUMBER,

    -- Prepayment Reference
    PREPAYMENT_NUMBER                   VARCHAR2(50),
    PREPAYMENT_LINE_NUMBER              NUMBER,

    -- Shipping Information
    SHIP_TO_LOCATION_CODE               VARCHAR2(60),
    SHIP_TO_LOCATION                    VARCHAR2(240),
    SHIP_TO_CUSTOMER_LOCATION           VARCHAR2(240),

    -- Withholding
    WITHHOLDING                         VARCHAR2(240),

    -- Product Information
    PRODUCT_TYPE                        VARCHAR2(100),
    PRODUCT_CATEGORY                    VARCHAR2(240),
    PRODUCT_CATEGORY_CODE_PATH          VARCHAR2(500),
    PRODUCT_TABLE                       VARCHAR2(100),

    -- Fiscal Classification
    USER_DEFINED_FISCAL_CLASS           VARCHAR2(240),
    USER_DEFINED_FISCAL_CLASS_CODE      VARCHAR2(50),
    PRODUCT_FISCAL_CLASS                VARCHAR2(240),
    PRODUCT_FISCAL_CLASS_CODE           VARCHAR2(50),
    PRODUCT_FISCAL_CLASS_TYPE           VARCHAR2(100),

    -- Transaction Category
    TRANSACTION_BUSINESS_CATEGORY       VARCHAR2(240),
    TRANSACTION_BUSINESS_CAT_CODE_PATH  VARCHAR2(500),

    -- Intended Use
    INTENDED_USE                        VARCHAR2(240),
    INTENDED_USE_CODE                   VARCHAR2(50),

    -- Requester
    REQUESTER                           VARCHAR2(240),
    REQUESTER_ID                        NUMBER,

    -- Purchasing Category
    PURCHASING_CATEGORY                 VARCHAR2(240),

    -- Multiperiod Accounting
    MULTIPERIOD_ACCRUAL_ACCOUNT         VARCHAR2(500),

    -- Reference Fields
    REFERENCE_KEY_TWO                   VARCHAR2(150),

    -- Audit Columns from Fusion
    FUSION_CREATED_BY                   VARCHAR2(240),
    FUSION_CREATION_DATE                TIMESTAMP,
    FUSION_LAST_UPDATED_BY              VARCHAR2(240),
    FUSION_LAST_UPDATE_DATE             TIMESTAMP,
    FUSION_LAST_UPDATE_LOGIN            VARCHAR2(50),

    -- Local Audit Columns
    CREATED_BY                          VARCHAR2(100) DEFAULT USER,
    CREATION_DATE                       TIMESTAMP DEFAULT SYSTIMESTAMP,
    LAST_UPDATED_BY                     VARCHAR2(100) DEFAULT USER,
    LAST_UPDATE_DATE                    TIMESTAMP DEFAULT SYSTIMESTAMP,

    -- Processing Status
    PROCESS_STATUS                      VARCHAR2(20) DEFAULT 'NEW',
    ERROR_MESSAGE                       VARCHAR2(4000),

    -- Constraint for unique line per invoice
    CONSTRAINT XXAP_INV_LINES_UK UNIQUE (INVOICE_ID, LINE_NUMBER)
);

-- Create indexes for performance
CREATE INDEX XXAP_INV_LINES_INV_ID_IDX ON XXAP_INVOICE_LINES_STG(INVOICE_ID);
CREATE INDEX XXAP_INV_LINES_STATUS_IDX ON XXAP_INVOICE_LINES_STG(PROCESS_STATUS);
CREATE INDEX XXAP_INV_LINES_ACCT_DATE_IDX ON XXAP_INVOICE_LINES_STG(ACCOUNTING_DATE);
CREATE INDEX XXAP_INV_LINES_PO_IDX ON XXAP_INVOICE_LINES_STG(PURCHASE_ORDER_NUMBER);

-- Add comments
COMMENT ON TABLE XXAP_INVOICE_LINES_STG IS 'Staging table for AP Invoice Lines from Oracle Fusion';
COMMENT ON COLUMN XXAP_INVOICE_LINES_STG.INVOICE_ID IS 'Foreign key to XXAP_INVOICES_STG.INVOICE_ID';
COMMENT ON COLUMN XXAP_INVOICE_LINES_STG.LINE_NUMBER IS 'Line number within the invoice';
COMMENT ON COLUMN XXAP_INVOICE_LINES_STG.PROCESS_STATUS IS 'NEW, PROCESSED, ERROR';

-- Grant permissions (adjust schema as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON XXAP_INVOICE_LINES_STG TO your_app_user;

COMMIT;
