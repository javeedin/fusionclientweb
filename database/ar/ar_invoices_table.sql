-- =====================================================
-- AR Invoice Tables for Oracle Fusion Data
-- RR_AR_INVOICE_HEADERS : receivablesInvoices
-- RR_AR_INVOICE_LINES   : receivablesInvoiceLines
-- =====================================================

-- DROP TABLE RR_AR_INVOICE_LINES   CASCADE CONSTRAINTS;
-- DROP TABLE RR_AR_INVOICE_HEADERS CASCADE CONSTRAINTS;

-- =====================================================
-- SEQUENCE
-- =====================================================
-- CREATE SEQUENCE RR_AR_INVOICE_HEADERS_S START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;
-- CREATE SEQUENCE RR_AR_INVOICE_LINES_S   START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;

-- =====================================================
-- 1. HEADERS TABLE
-- =====================================================
CREATE TABLE RR_AR_INVOICE_HEADERS (
    -- Primary Key (Fusion CustomerTransactionId)
    CUSTOMER_TRANSACTION_ID         NUMBER          NOT NULL,

    -- Transaction Identifiers
    TRANSACTION_NUMBER              VARCHAR2(50),
    DOCUMENT_NUMBER                 NUMBER,
    CROSS_REFERENCE                 VARCHAR2(150),

    -- Dates
    TRANSACTION_DATE                DATE,
    ACCOUNTING_DATE                 DATE,
    DUE_DATE                        DATE,
    BILLING_DATE                    DATE,
    SHIP_DATE                       DATE,

    -- Type & Status
    TRANSACTION_TYPE                VARCHAR2(50),
    TRANSACTION_SOURCE              VARCHAR2(240),
    INVOICE_STATUS                  VARCHAR2(30),

    -- Currency
    INVOICE_CURRENCY_CODE           VARCHAR2(15),
    CONVERSION_RATE_TYPE            VARCHAR2(30),
    CONVERSION_DATE                 DATE,
    CONVERSION_RATE                 NUMBER,

    -- Amounts
    ENTERED_AMOUNT                  NUMBER,
    INVOICE_BALANCE_AMOUNT          NUMBER,
    FREIGHT_AMOUNT                  NUMBER,

    -- Bill-To Customer
    BILL_TO_CUSTOMER_NUMBER         VARCHAR2(50),
    BILL_TO_CUSTOMER_NAME           VARCHAR2(360),
    BILL_TO_SITE                    VARCHAR2(50),
    BILL_TO_CONTACT                 VARCHAR2(360),
    BILL_TO_PARTY_ID                NUMBER,

    -- Ship-To Customer
    SHIP_TO_CUSTOMER_NUMBER         VARCHAR2(50),
    SHIP_TO_CUSTOMER_NAME           VARCHAR2(360),
    SHIP_TO_SITE                    VARCHAR2(50),
    SHIP_TO_CONTACT                 VARCHAR2(360),

    -- Paying Customer
    PAYING_CUSTOMER_NAME            VARCHAR2(360),
    PAYING_CUSTOMER_SITE            VARCHAR2(50),
    PAYING_CUSTOMER_ACCOUNT         VARCHAR2(100),

    -- Business Unit & Legal Entity
    BUSINESS_UNIT                   VARCHAR2(240),
    LEGAL_ENTITY_IDENTIFIER         VARCHAR2(30),

    -- Payment
    PAYMENT_TERMS                   VARCHAR2(100),
    RECEIPT_METHOD                  VARCHAR2(100),

    -- References
    PURCHASE_ORDER                  VARCHAR2(150),
    PURCHASE_ORDER_DATE             DATE,
    PURCHASE_ORDER_REVISION         VARCHAR2(50),

    -- Shipping
    CARRIER                         VARCHAR2(100),
    SHIPPING_REFERENCE              VARCHAR2(150),

    -- Tax
    DEFAULT_TAXATION_COUNTRY        VARCHAR2(10),
    FIRST_PARTY_REG_NUMBER          VARCHAR2(100),
    THIRD_PARTY_REG_NUMBER          VARCHAR2(100),

    -- Flags
    PREPAYMENT                      VARCHAR2(10),
    INTERCOMPANY                    VARCHAR2(10),
    PRINT_OPTION                    VARCHAR2(10),

    -- Other
    SOLD_TO_PARTY_NUMBER            VARCHAR2(50),
    REMIT_TO_ADDRESS                VARCHAR2(500),
    SALESPERSON_NUMBER              VARCHAR2(50),
    DELIVERY_METHOD                 VARCHAR2(50),
    EMAIL                           VARCHAR2(240),
    SPECIAL_INSTRUCTIONS            VARCHAR2(4000),
    COMMENTS                        VARCHAR2(4000),
    INTERNAL_NOTES                  VARCHAR2(4000),
    INVOICING_RULE                  VARCHAR2(100),

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

    CONSTRAINT RR_AR_INV_HDR_PK PRIMARY KEY (CUSTOMER_TRANSACTION_ID)
);

COMMENT ON TABLE  RR_AR_INVOICE_HEADERS                          IS 'AR Invoice Headers from Oracle Fusion receivablesInvoices';
COMMENT ON COLUMN RR_AR_INVOICE_HEADERS.CUSTOMER_TRANSACTION_ID IS 'Oracle Fusion CustomerTransactionId (PK)';
COMMENT ON COLUMN RR_AR_INVOICE_HEADERS.ENTERED_AMOUNT          IS 'Invoice entered amount in transaction currency';
COMMENT ON COLUMN RR_AR_INVOICE_HEADERS.INVOICE_BALANCE_AMOUNT  IS 'Outstanding balance amount';

-- =====================================================
-- 2. LINES TABLE
-- =====================================================
CREATE TABLE RR_AR_INVOICE_LINES (
    -- Primary Key (Fusion CustomerTransactionLineId)
    CUSTOMER_TRANSACTION_LINE_ID    NUMBER          NOT NULL,

    -- Foreign Key to Header
    CUSTOMER_TRANSACTION_ID         NUMBER          NOT NULL,

    -- Line Details
    LINE_NUMBER                     NUMBER,
    DESCRIPTION                     VARCHAR2(4000),

    -- Item
    ITEM_NUMBER                     VARCHAR2(100),
    UNIT_OF_MEASURE                 VARCHAR2(50),
    WAREHOUSE                       VARCHAR2(100),
    MEMO_LINE                       VARCHAR2(240),

    -- Quantities & Amounts
    QUANTITY                        NUMBER,
    UNIT_SELLING_PRICE              NUMBER,
    LINE_AMOUNT                     NUMBER,
    ASSESSABLE_VALUE                NUMBER,
    ALLOCATED_FREIGHT_AMOUNT        NUMBER,

    -- Sales Order
    SALES_ORDER                     VARCHAR2(50),
    SALES_ORDER_DATE                DATE,

    -- Tax
    TAX_CLASSIFICATION_CODE         VARCHAR2(100),
    TAX_EXEMPTION_HANDLING          VARCHAR2(50),
    TAX_EXEMPTION_CERT_NUMBER       VARCHAR2(100),
    TAX_EXEMPTION_REASON            VARCHAR2(100),

    -- Accounting Rule
    ACCOUNTING_RULE                 VARCHAR2(100),
    ACCOUNTING_RULE_DURATION        NUMBER,
    RULE_START_DATE                 DATE,
    RULE_END_DATE                   DATE,

    -- Classification
    TRANSACTION_BUSINESS_CATEGORY   VARCHAR2(100),
    PRODUCT_FISCAL_CLASSIFICATION   VARCHAR2(100),
    PRODUCT_CATEGORY                VARCHAR2(100),
    PRODUCT_TYPE                    VARCHAR2(50),
    LINE_INTENDED_USE               VARCHAR2(100),

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

    CONSTRAINT RR_AR_INV_LNS_PK PRIMARY KEY (CUSTOMER_TRANSACTION_LINE_ID),
    CONSTRAINT RR_AR_INV_LNS_HDR_FK FOREIGN KEY (CUSTOMER_TRANSACTION_ID)
        REFERENCES RR_AR_INVOICE_HEADERS (CUSTOMER_TRANSACTION_ID) ON DELETE CASCADE
);

CREATE INDEX RR_AR_INV_LNS_HDR_IX ON RR_AR_INVOICE_LINES (CUSTOMER_TRANSACTION_ID);

COMMENT ON TABLE  RR_AR_INVOICE_LINES                               IS 'AR Invoice Lines from Oracle Fusion receivablesInvoiceLines';
COMMENT ON COLUMN RR_AR_INVOICE_LINES.CUSTOMER_TRANSACTION_LINE_ID IS 'Oracle Fusion CustomerTransactionLineId (PK)';
COMMENT ON COLUMN RR_AR_INVOICE_LINES.CUSTOMER_TRANSACTION_ID      IS 'FK to RR_AR_INVOICE_HEADERS';
COMMENT ON COLUMN RR_AR_INVOICE_LINES.LINE_AMOUNT                   IS 'Line total = Quantity * UnitSellingPrice';

COMMIT;
