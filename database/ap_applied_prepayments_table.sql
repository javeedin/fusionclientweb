-- ============================================================
-- RR_AP_APPLIED_PREPAYMENTS Table
-- Stores prepayment applications against AP invoices
-- ============================================================

-- DROP TABLE RR_AP_APPLIED_PREPAYMENTS CASCADE CONSTRAINTS;
-- DROP SEQUENCE RR_AP_APPLIED_PREP_SEQ;

CREATE TABLE RR_AP_APPLIED_PREPAYMENTS (
    -- Primary Key (auto-generated for local records)
    APPLICATION_ID                  NUMBER PRIMARY KEY,

    -- References
    INVOICE_ID                      NUMBER,           -- Target invoice (invoice being reduced)
    INVOICE_NUMBER                  VARCHAR2(100),    -- Target invoice number
    PREPAYMENT_INVOICE_ID           NUMBER,           -- Source prepayment invoice
    PREPAYMENT_NUMBER               VARCHAR2(100),    -- Source prepayment invoice number

    -- Line Info
    LINE_NUMBER                     NUMBER,
    PREPAYMENT_LINE_NUMBER          NUMBER,
    DESCRIPTION                     VARCHAR2(4000),

    -- Supplier / PO
    BUSINESS_UNIT                   VARCHAR2(240),
    SUPPLIER_SITE                   VARCHAR2(240),
    PURCHASE_ORDER                  VARCHAR2(100),

    -- Amounts
    CURRENCY                        VARCHAR2(15),
    APPLIED_AMOUNT                  NUMBER(18,2),
    INCLUDED_TAX                    NUMBER(18,2),
    INCLUDED_ON_INVOICE_FLAG        VARCHAR2(1)  DEFAULT 'N',

    -- Dates
    APPLICATION_ACCOUNTING_DATE     DATE,

    -- Status
    STATUS                          VARCHAR2(50)  DEFAULT 'Applied',

    -- Audit (Fusion sync)
    CREATED_BY                      VARCHAR2(100),
    CREATION_DATE                   TIMESTAMP WITH TIME ZONE,
    LAST_UPDATED_BY                 VARCHAR2(100),
    LAST_UPDATE_DATE                TIMESTAMP WITH TIME ZONE,
    LAST_UPDATE_LOGIN               VARCHAR2(100),

    -- Local audit
    LOCAL_CREATED_DATE              TIMESTAMP DEFAULT SYSTIMESTAMP,
    LOCAL_UPDATED_DATE              TIMESTAMP DEFAULT SYSTIMESTAMP,
    SYNC_STATUS                     VARCHAR2(20) DEFAULT 'NEW'
);

-- Sequence for APPLICATION_ID
CREATE SEQUENCE RR_AP_APPLIED_PREP_SEQ
    START WITH 100001
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

-- Indexes
CREATE INDEX RR_AP_APPL_PREP_N1 ON RR_AP_APPLIED_PREPAYMENTS (INVOICE_ID);
CREATE INDEX RR_AP_APPL_PREP_N2 ON RR_AP_APPLIED_PREPAYMENTS (INVOICE_NUMBER);
CREATE INDEX RR_AP_APPL_PREP_N3 ON RR_AP_APPLIED_PREPAYMENTS (PREPAYMENT_INVOICE_ID);
CREATE INDEX RR_AP_APPL_PREP_N4 ON RR_AP_APPLIED_PREPAYMENTS (PREPAYMENT_NUMBER);

-- Comments
COMMENT ON TABLE  RR_AP_APPLIED_PREPAYMENTS                              IS 'Prepayment applications against AP invoices';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.APPLICATION_ID               IS 'Unique application record ID';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.INVOICE_ID                   IS 'Target invoice ID (invoice being reduced)';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.PREPAYMENT_INVOICE_ID        IS 'Source prepayment invoice ID';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.APPLIED_AMOUNT               IS 'Amount of prepayment applied to the invoice';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.INCLUDED_ON_INVOICE_FLAG     IS 'Y = prepayment included on invoice, N = standalone application';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.APPLICATION_ACCOUNTING_DATE  IS 'Accounting date for the prepayment application';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.STATUS                       IS 'Application status: Applied, Unapplied, Cancelled';
COMMENT ON COLUMN RR_AP_APPLIED_PREPAYMENTS.SYNC_STATUS                  IS 'NEW = local only, SYNCED = confirmed in Fusion';
