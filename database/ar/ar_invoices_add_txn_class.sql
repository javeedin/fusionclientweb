-- =====================================================
-- AR Invoices: Add TRANSACTION_CLASS column
-- Run once in SQL Workshop before rerunning the package
-- =====================================================
ALTER TABLE RR_AR_INVOICE_HEADERS
    ADD TRANSACTION_CLASS VARCHAR2(30);

COMMENT ON COLUMN RR_AR_INVOICE_HEADERS.TRANSACTION_CLASS
    IS 'Oracle Fusion TransactionClass (INV, CM, DM, CB)';

COMMIT;
