-- =====================================================
-- AP Invoice Installments Table
-- =====================================================
-- Created: 2024
-- Description: Stores AP Invoice Installments from Oracle Fusion
-- Table: RR_AP_INVOICE_INSTALLMENTS
-- =====================================================

-- Drop existing table (if needed for recreation)
-- DROP TABLE RR_AP_INVOICE_INSTALLMENTS CASCADE CONSTRAINTS;

CREATE TABLE RR_AP_INVOICE_INSTALLMENTS (
    -- Primary Key
    INSTALLMENT_ID                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Foreign Key to Invoice Header
    INVOICE_ID                          NUMBER NOT NULL,

    -- Installment Information
    INSTALLMENT_NUMBER                  NUMBER NOT NULL,
    DUE_DATE                            DATE,
    GROSS_AMOUNT                        NUMBER,
    UNPAID_AMOUNT                       NUMBER,

    -- Discount Information
    FIRST_DISCOUNT_AMOUNT               NUMBER,
    FIRST_DISCOUNT_DATE                 DATE,
    SECOND_DISCOUNT_AMOUNT              NUMBER,
    SECOND_DISCOUNT_DATE                DATE,
    THIRD_DISCOUNT_AMOUNT               NUMBER,
    THIRD_DISCOUNT_DATE                 DATE,

    -- Net Amounts
    NET_AMOUNT_ONE                      NUMBER,
    NET_AMOUNT_TWO                      NUMBER,
    NET_AMOUNT_THREE                    NUMBER,

    -- Payment Information
    PAYMENT_PRIORITY                    NUMBER,
    PAYMENT_METHOD                      VARCHAR2(80),
    PAYMENT_METHOD_CODE                 VARCHAR2(30),

    -- Hold Information
    HOLD_FLAG                           VARCHAR2(1) DEFAULT 'N',
    HOLD_REASON                         VARCHAR2(240),
    HOLD_TYPE                           VARCHAR2(80),
    HOLD_DATE                           DATE,
    HELD_BY                             VARCHAR2(240),

    -- Bank Information
    BANK_ACCOUNT                        VARCHAR2(100),
    EXTERNAL_BANK_ACCOUNT_ID            NUMBER,
    DIGITAL_PAYMENT_ACCOUNT             VARCHAR2(100),

    -- Remittance Information
    REMIT_TO_ADDRESS_NAME               VARCHAR2(240),
    REMIT_TO_SUPPLIER                   VARCHAR2(360),
    REMITTANCE_MESSAGE_ONE              VARCHAR2(150),
    REMITTANCE_MESSAGE_TWO              VARCHAR2(150),
    REMITTANCE_MESSAGE_THREE            VARCHAR2(150),

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

    -- Payment Status (updated when invoice is paid)
    PAYMENT_STATUS                      VARCHAR2(50) DEFAULT 'Unpaid',

    -- Processing Status
    PROCESS_STATUS                      VARCHAR2(20) DEFAULT 'NEW',
    ERROR_MESSAGE                       VARCHAR2(4000),

    -- Constraint for unique installment per invoice
    CONSTRAINT RR_AP_INV_INST_UK UNIQUE (INVOICE_ID, INSTALLMENT_NUMBER)
);

-- Create indexes for performance
CREATE INDEX RR_AP_INV_INST_INV_ID_IDX ON RR_AP_INVOICE_INSTALLMENTS(INVOICE_ID);
CREATE INDEX RR_AP_INV_INST_DUE_DATE_IDX ON RR_AP_INVOICE_INSTALLMENTS(DUE_DATE);
CREATE INDEX RR_AP_INV_INST_STATUS_IDX ON RR_AP_INVOICE_INSTALLMENTS(PROCESS_STATUS);
CREATE INDEX RR_AP_INV_INST_HOLD_IDX ON RR_AP_INVOICE_INSTALLMENTS(HOLD_FLAG);

-- Add comments
COMMENT ON TABLE RR_AP_INVOICE_INSTALLMENTS IS 'Staging table for AP Invoice Installments from Oracle Fusion';
COMMENT ON COLUMN RR_AP_INVOICE_INSTALLMENTS.INVOICE_ID IS 'Foreign key to XXAP_INVOICES_STG.INVOICE_ID';
COMMENT ON COLUMN RR_AP_INVOICE_INSTALLMENTS.INSTALLMENT_NUMBER IS 'Installment number within the invoice';
COMMENT ON COLUMN RR_AP_INVOICE_INSTALLMENTS.PROCESS_STATUS IS 'NEW, PROCESSED, ERROR';
COMMENT ON COLUMN RR_AP_INVOICE_INSTALLMENTS.HOLD_FLAG IS 'Y if installment is on hold, N otherwise';

-- Grant permissions (adjust schema as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON RR_AP_INVOICE_INSTALLMENTS TO your_app_user;

-- ============================================================
-- Migration: add PAYMENT_STATUS column to existing table
-- Run in APEX SQL Workshop if table already exists
-- ============================================================
ALTER TABLE RR_AP_INVOICE_INSTALLMENTS ADD (PAYMENT_STATUS VARCHAR2(50) DEFAULT 'Unpaid');
COMMIT;

COMMIT;
