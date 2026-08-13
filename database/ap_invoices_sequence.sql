-- =====================================================
-- AP Invoices Document Sequence
-- Run once before deploying ap_invoices_pkg.sql
-- =====================================================

CREATE SEQUENCE seq_ap_document_seq
    START WITH 1000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;
/
