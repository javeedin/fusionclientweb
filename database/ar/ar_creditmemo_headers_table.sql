-- =====================================================
-- AR Credit Memo Headers Table
-- Table   : RR_AR_CREDITMEMO_HEADERS
-- Source  : Oracle Fusion receivablesCreditMemos
-- =====================================================

-- DROP TABLE RR_AR_CREDITMEMO_HEADERS CASCADE CONSTRAINTS;

CREATE TABLE RR_AR_CREDITMEMO_HEADERS (

    -- Primary Key (Fusion CustomerTransactionId)
    CUSTOMER_TRANSACTION_ID         NUMBER          NOT NULL,

    -- Transaction Identifiers
    TRANSACTION_NUMBER              VARCHAR2(50),
    DOCUMENT_NUMBER                 NUMBER,
    CROSS_REFERENCE                 VARCHAR2(150),
    CUSTOMER_REFERENCE              VARCHAR2(150),      -- CM-specific: CustomerReference

    -- Dates
    TRANSACTION_DATE                DATE,
    ACCOUNTING_DATE                 DATE,
    BILLING_DATE                    DATE,
    CUSTOMER_REFERENCE_DATE         DATE,               -- CM-specific: CustomerReferenceDate
    FREIGHT_SHIP_DATE               DATE,
    PURCHASE_ORDER_DATE             DATE,
    PRINT_DATE                      DATE,               -- CM-specific: PrintDate

    -- Type & Status
    TRANSACTION_TYPE                VARCHAR2(50),
    TRANSACTION_SOURCE              VARCHAR2(240),
    CREDIT_MEMO_STATUS              VARCHAR2(30),       -- CM-specific (vs INVOICE_STATUS)

    -- Currency
    CREDIT_MEMO_CURRENCY            VARCHAR2(15),       -- CM-specific (vs INVOICE_CURRENCY_CODE)
    CONVERSION_RATE_TYPE            VARCHAR2(30),
    CONVERSION_DATE                 DATE,
    CONVERSION_RATE                 NUMBER,

    -- Amounts
    ENTERED_AMOUNT                  NUMBER,
    TRANSACTION_BALANCE_DUE         NUMBER,             -- CM-specific (vs INVOICE_BALANCE_AMOUNT)
    FREIGHT_CREDIT_AMOUNT           NUMBER,             -- CM-specific

    -- Credit Memo Reason (CM-specific)
    CREDIT_REASON                   VARCHAR2(240),

    -- Bill-To Customer
    BILL_TO_CUSTOMER_NUMBER         VARCHAR2(50),
    BILL_TO_CUSTOMER_NAME           VARCHAR2(360),
    BILL_TO_SITE                    VARCHAR2(50),
    BILL_TO_CONTACT                 VARCHAR2(360),

    -- Ship-To Customer
    SHIP_TO_CUSTOMER_NUMBER         VARCHAR2(50),
    SHIP_TO_CUSTOMER_NAME           VARCHAR2(360),
    SHIP_TO_CUSTOMER_SITE           VARCHAR2(50),       -- CM uses ShipToCustomerSite
    SHIP_TO_CONTACT                 VARCHAR2(360),

    -- Paying Customer
    PAYING_CUSTOMER_NAME            VARCHAR2(360),
    PAYING_CUSTOMER_SITE            VARCHAR2(50),
    PAYING_CUSTOMER_ACCOUNT         VARCHAR2(100),

    -- Sold-To
    SOLD_TO_PARTY_NUMBER            VARCHAR2(50),

    -- Business Unit & Legal Entity
    BUSINESS_UNIT                   VARCHAR2(240),
    LEGAL_ENTITY_IDENTIFIER         VARCHAR2(30),

    -- References
    PURCHASE_ORDER                  VARCHAR2(150),
    PURCHASE_ORDER_REVISION         VARCHAR2(50),

    -- Shipping
    CARRIER                         VARCHAR2(100),
    SHIPPING_REFERENCE              VARCHAR2(150),
    FREIGHT_FOB                     VARCHAR2(100),      -- CM-specific: FreightFOB

    -- Tax
    DEFAULT_TAXATION_COUNTRY        VARCHAR2(10),
    FIRST_PARTY_REG_NUMBER          VARCHAR2(100),
    THIRD_PARTY_REG_NUMBER          VARCHAR2(100),

    -- Flags (CM-specific)
    INTERCOMPANY                    VARCHAR2(10),
    GENERATE_BILL                   VARCHAR2(10),
    ALLOW_COMPLETION                VARCHAR2(10),
    CONTROL_COMPLETION_REASON       VARCHAR2(240),

    -- Document Classification (CM-specific)
    DOCUMENT_FISCAL_CLASSIFICATION  VARCHAR2(100),
    STRUCTURED_PAYMENT_REFERENCE    VARCHAR2(240),

    -- Print / Delivery
    PRINT_STATUS                    VARCHAR2(10),
    DELIVERY_METHOD                 VARCHAR2(50),

    -- Salesperson (string name in credit memos)
    PRIMARY_SALESPERSON             VARCHAR2(240),

    -- Free-text fields
    SPECIAL_INSTRUCTIONS            VARCHAR2(4000),
    CREDIT_MEMO_COMMENTS            VARCHAR2(4000),     -- CM-specific (vs COMMENTS)
    INTERNAL_NOTES                  VARCHAR2(4000),
    EMAIL                           VARCHAR2(240),      -- RecipientEmail

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

    CONSTRAINT RR_AR_CM_HDR_PK PRIMARY KEY (CUSTOMER_TRANSACTION_ID)
);

CREATE INDEX RR_AR_CM_HDR_TXNDATE_IX  ON RR_AR_CREDITMEMO_HEADERS (TRANSACTION_DATE);
CREATE INDEX RR_AR_CM_HDR_STATUS_IX   ON RR_AR_CREDITMEMO_HEADERS (CREDIT_MEMO_STATUS);
CREATE INDEX RR_AR_CM_HDR_CUST_IX     ON RR_AR_CREDITMEMO_HEADERS (BILL_TO_CUSTOMER_NUMBER);
CREATE INDEX RR_AR_CM_HDR_BU_IX       ON RR_AR_CREDITMEMO_HEADERS (BUSINESS_UNIT);
CREATE INDEX RR_AR_CM_HDR_TXNNUM_IX   ON RR_AR_CREDITMEMO_HEADERS (TRANSACTION_NUMBER);

COMMENT ON TABLE  RR_AR_CREDITMEMO_HEADERS IS 'AR Credit Memo Headers from Oracle Fusion receivablesCreditMemos';
COMMENT ON COLUMN RR_AR_CREDITMEMO_HEADERS.CUSTOMER_TRANSACTION_ID IS 'Oracle Fusion CustomerTransactionId (PK)';
COMMENT ON COLUMN RR_AR_CREDITMEMO_HEADERS.ENTERED_AMOUNT          IS 'Credit memo entered amount (typically negative)';
COMMENT ON COLUMN RR_AR_CREDITMEMO_HEADERS.TRANSACTION_BALANCE_DUE IS 'Outstanding balance (Fusion TransactionBalanceDue)';
COMMENT ON COLUMN RR_AR_CREDITMEMO_HEADERS.CREDIT_REASON           IS 'Reason for the credit memo (Fusion CreditReason)';

COMMIT;
