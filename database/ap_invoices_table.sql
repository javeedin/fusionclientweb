-- =====================================================
-- AP Invoices Table for Oracle Fusion Data
-- =====================================================

-- Drop existing table if exists
-- DROP TABLE XXAP_INVOICES_STG CASCADE CONSTRAINTS;

CREATE TABLE XXAP_INVOICES_STG (
    -- Primary Key
    INVOICE_ID                          NUMBER NOT NULL,

    -- Invoice Header Information
    INVOICE_NUMBER                      VARCHAR2(50),
    INVOICE_CURRENCY                    VARCHAR2(15),
    PAYMENT_CURRENCY                    VARCHAR2(15),
    INVOICE_AMOUNT                      NUMBER,
    INVOICE_DATE                        DATE,

    -- Business Unit & Legal Entity
    BUSINESS_UNIT                       VARCHAR2(240),
    LEGAL_ENTITY                        VARCHAR2(240),
    LEGAL_ENTITY_IDENTIFIER             VARCHAR2(30),

    -- Supplier Information
    SUPPLIER                            VARCHAR2(360),
    SUPPLIER_NUMBER                     VARCHAR2(30),
    SUPPLIER_SITE                       VARCHAR2(240),
    SUPPLIER_TAX_REGISTRATION_NUMBER    VARCHAR2(50),
    SUPPLIER_IBAN                       VARCHAR2(100),

    -- Party Information
    PARTY                               VARCHAR2(360),
    PARTY_SITE                          VARCHAR2(240),

    -- Procurement
    PROCUREMENT_BU                      VARCHAR2(240),
    PURCHASE_ORDER_NUMBER               VARCHAR2(50),

    -- Requester
    REQUESTER_ID                        NUMBER,
    REQUESTER                           VARCHAR2(240),

    -- Invoice Details
    INVOICE_GROUP                       VARCHAR2(80),
    INVOICE_SOURCE_CODE                 VARCHAR2(30),
    INVOICE_SOURCE                      VARCHAR2(80),
    INVOICE_TYPE                        VARCHAR2(30),
    DESCRIPTION                         VARCHAR2(4000),

    -- Conversion Information
    CONVERSION_RATE_TYPE                VARCHAR2(30),
    CONVERSION_DATE                     DATE,
    CONVERSION_RATE                     NUMBER,
    BASE_AMOUNT                         NUMBER,

    -- Dates
    ACCOUNTING_DATE                     DATE,
    TERMS_DATE                          DATE,
    GOODS_RECEIVED_DATE                 DATE,
    INVOICE_RECEIVED_DATE               DATE,
    APPLY_AFTER_DATE                    DATE,
    BUDGET_DATE                         DATE,

    -- Payment Information
    PAY_GROUP                           VARCHAR2(80),
    PAYMENT_TERMS                       VARCHAR2(50),
    PAYMENT_METHOD_CODE                 VARCHAR2(30),
    PAYMENT_METHOD                      VARCHAR2(80),
    PAY_ALONE_FLAG                      VARCHAR2(1) DEFAULT 'N',
    AMOUNT_PAID                         NUMBER,
    CONTROL_AMOUNT                      NUMBER,

    -- Payment Reason
    PAYMENT_REASON_CODE                 VARCHAR2(30),
    PAYMENT_REASON                      VARCHAR2(240),
    PAYMENT_REASON_COMMENTS             VARCHAR2(240),

    -- Remittance
    REMITTANCE_MESSAGE_ONE              VARCHAR2(150),
    REMITTANCE_MESSAGE_TWO              VARCHAR2(150),
    REMITTANCE_MESSAGE_THREE            VARCHAR2(150),
    UNIQUE_REMITTANCE_IDENTIFIER        VARCHAR2(50),
    UNIQUE_REMITTANCE_ID_CHECK_DIGIT    VARCHAR2(10),

    -- Delivery
    DELIVERY_CHANNEL_CODE               VARCHAR2(30),
    DELIVERY_CHANNEL                    VARCHAR2(80),

    -- Tax Information
    FIRST_PARTY_TAX_REGISTRATION_ID     NUMBER,
    FIRST_PARTY_TAX_REGISTRATION_NUM    VARCHAR2(50),
    TAXATION_COUNTRY                    VARCHAR2(80),
    DOC_FISCAL_CLASSIFICATION_CODE_PATH VARCHAR2(500),

    -- Distribution & Accounting
    LIABILITY_DISTRIBUTION              VARCHAR2(250),
    DOCUMENT_CATEGORY                   VARCHAR2(80),
    DOCUMENT_SEQUENCE                   NUMBER,
    VOUCHER_NUMBER                      VARCHAR2(50),

    -- Status Fields
    VALIDATION_STATUS                   VARCHAR2(30),
    APPROVAL_STATUS                     VARCHAR2(30),
    PAID_STATUS                         VARCHAR2(30),
    ACCOUNTING_STATUS                   VARCHAR2(30),
    ACCOUNT_CODING_STATUS               VARCHAR2(30),
    FUNDS_STATUS                        VARCHAR2(30),

    -- Cancellation
    CANCELED_FLAG                       VARCHAR2(1) DEFAULT 'N',
    CANCELED_DATE                       DATE,
    CANCELED_BY                         VARCHAR2(100),

    -- Bank Information
    BANK_ACCOUNT                        VARCHAR2(100),
    EXTERNAL_BANK_ACCOUNT_ID            NUMBER,
    BANK_CHARGE_BEARER                  VARCHAR2(30),
    SETTLEMENT_PRIORITY                 VARCHAR2(30),
    DIGITAL_PAYMENT_ACCOUNT             VARCHAR2(100),

    -- Routing Attributes
    ROUTING_ATTRIBUTE1                  VARCHAR2(150),
    ROUTING_ATTRIBUTE2                  VARCHAR2(150),
    ROUTING_ATTRIBUTE3                  VARCHAR2(150),
    ROUTING_ATTRIBUTE4                  VARCHAR2(150),
    ROUTING_ATTRIBUTE5                  VARCHAR2(150),

    -- Reference Keys
    REFERENCE_KEY_ONE                   VARCHAR2(150),
    REFERENCE_KEY_TWO                   VARCHAR2(150),
    REFERENCE_KEY_THREE                 VARCHAR2(150),
    REFERENCE_KEY_FOUR                  VARCHAR2(150),
    REFERENCE_KEY_FIVE                  VARCHAR2(150),

    -- Other
    PRODUCT_TABLE                       VARCHAR2(30),
    IMAGE_DOCUMENT_NUMBER               VARCHAR2(100),

    -- Audit Columns from Fusion
    FUSION_CREATED_BY                   VARCHAR2(100),
    FUSION_CREATION_DATE                TIMESTAMP,
    FUSION_LAST_UPDATED_BY              VARCHAR2(100),
    FUSION_LAST_UPDATE_DATE             TIMESTAMP,
    FUSION_LAST_UPDATE_LOGIN            VARCHAR2(50),

    -- Local Audit Columns
    CREATED_BY                          VARCHAR2(100) DEFAULT USER,
    CREATION_DATE                       TIMESTAMP DEFAULT SYSTIMESTAMP,
    LAST_UPDATED_BY                     VARCHAR2(100),
    LAST_UPDATE_DATE                    TIMESTAMP,
    SYNC_STATUS                         VARCHAR2(20) DEFAULT 'NEW',
    SYNC_DATE                           TIMESTAMP,
    ERROR_MESSAGE                       VARCHAR2(4000),

    -- Constraints
    CONSTRAINT XXAP_INVOICES_STG_PK PRIMARY KEY (INVOICE_ID)
);

-- Create indexes for frequently queried columns
CREATE INDEX XXAP_INV_STG_INV_NUM_IDX ON XXAP_INVOICES_STG (INVOICE_NUMBER);
CREATE INDEX XXAP_INV_STG_SUPPLIER_IDX ON XXAP_INVOICES_STG (SUPPLIER);
CREATE INDEX XXAP_INV_STG_BU_IDX ON XXAP_INVOICES_STG (BUSINESS_UNIT);
CREATE INDEX XXAP_INV_STG_INV_DATE_IDX ON XXAP_INVOICES_STG (INVOICE_DATE);
CREATE INDEX XXAP_INV_STG_STATUS_IDX ON XXAP_INVOICES_STG (VALIDATION_STATUS, APPROVAL_STATUS, PAID_STATUS);
CREATE INDEX XXAP_INV_STG_SYNC_IDX ON XXAP_INVOICES_STG (SYNC_STATUS);

-- Add comments
COMMENT ON TABLE XXAP_INVOICES_STG IS 'Staging table for AP Invoices synced from Oracle Fusion';
COMMENT ON COLUMN XXAP_INVOICES_STG.INVOICE_ID IS 'Unique Invoice ID from Oracle Fusion';
COMMENT ON COLUMN XXAP_INVOICES_STG.SYNC_STATUS IS 'NEW, SYNCED, ERROR, UPDATED';

-- Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON XXAP_INVOICES_STG TO APP_USER;
