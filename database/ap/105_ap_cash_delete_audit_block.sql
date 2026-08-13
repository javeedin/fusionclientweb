-- ============================================================
-- Delete Audit + Block Direct SQL
-- Covers AP and Cash tables listed below.
--
-- Tables:
--   AP:
--     RR_AP_INVOICE_INSTALLMENTS
--     RR_AP_PAYMENTS_RELATED_INVOICES
--     RR_AP_APPLIED_PREPAYMENTS
--     RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
--     RR_AP_PAYMENTS_ALL
--   Cash:
--     RR_EXTERNAL_CASH_TRANSACTIONS
--     RR_BANK_ACCOUNT_TRANSFERS
--     RR_BANK_STATEMENT_HEADER
--     RR_BANK_STATEMENT_LINES
--
-- Each table gets:
--   1. A _DEL archive table (CTAS from live table + 3 audit cols)
--   2. A BEFORE DELETE trigger that archives + blocks non-ORDS
--
-- Prerequisite: reerp_security package (103_block_direct_delete_journals.sql)
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. ARCHIVE TABLES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE rr_ap_invoice_installments_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_invoice_installments t WHERE 1=0;
CREATE INDEX idx_ap_inst_del_inv_id   ON rr_ap_invoice_installments_del(INVOICE_ID);
CREATE INDEX idx_ap_inst_del_del_date ON rr_ap_invoice_installments_del(DELETED_DATE);
COMMENT ON TABLE rr_ap_invoice_installments_del IS 'Audit archive of deleted AP invoice installments';


CREATE TABLE rr_ap_payments_related_invoices_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_payments_related_invoices t WHERE 1=0;
CREATE INDEX idx_ap_payrel_del_del_date ON rr_ap_payments_related_invoices_del(DELETED_DATE);
COMMENT ON TABLE rr_ap_payments_related_invoices_del IS 'Audit archive of deleted AP payment-invoice links';


CREATE TABLE rr_ap_applied_prepayments_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_applied_prepayments t WHERE 1=0;
CREATE INDEX idx_ap_prepay_del_del_date ON rr_ap_applied_prepayments_del(DELETED_DATE);
COMMENT ON TABLE rr_ap_applied_prepayments_del IS 'Audit archive of deleted AP applied prepayments';


CREATE TABLE rr_ap_invoice_multiperiod_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_invoice_multiperiod_schedule t WHERE 1=0;
CREATE INDEX idx_ap_multi_del_del_date ON rr_ap_invoice_multiperiod_del(DELETED_DATE);
COMMENT ON TABLE rr_ap_invoice_multiperiod_del IS 'Audit archive of deleted AP multiperiod schedules';


CREATE TABLE rr_ap_payments_all_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_payments_all t WHERE 1=0;
CREATE INDEX idx_ap_pay_del_check_id  ON rr_ap_payments_all_del(CHECK_ID);
CREATE INDEX idx_ap_pay_del_del_date  ON rr_ap_payments_all_del(DELETED_DATE);
COMMENT ON TABLE rr_ap_payments_all_del IS 'Audit archive of deleted AP payments';


CREATE TABLE rr_external_cash_transactions_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_external_cash_transactions t WHERE 1=0;
CREATE INDEX idx_ext_trx_del_del_date ON rr_external_cash_transactions_del(DELETED_DATE);
COMMENT ON TABLE rr_external_cash_transactions_del IS 'Audit archive of deleted external cash transactions';


CREATE TABLE rr_bank_account_transfers_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_bank_account_transfers t WHERE 1=0;
CREATE INDEX idx_bank_xfr_del_del_date ON rr_bank_account_transfers_del(DELETED_DATE);
COMMENT ON TABLE rr_bank_account_transfers_del IS 'Audit archive of deleted bank account transfers';


CREATE TABLE rr_bank_statement_header_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_bank_statement_header t WHERE 1=0;
CREATE INDEX idx_bstmt_hdr_del_del_date ON rr_bank_statement_header_del(DELETED_DATE);
COMMENT ON TABLE rr_bank_statement_header_del IS 'Audit archive of deleted bank statement headers';


CREATE TABLE rr_bank_statement_lines_del AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS deleted_by,
               CAST(NULL AS TIMESTAMP)     AS deleted_date,
               CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_bank_statement_lines t WHERE 1=0;
CREATE INDEX idx_bstmt_ln_del_del_date ON rr_bank_statement_lines_del(DELETED_DATE);
COMMENT ON TABLE rr_bank_statement_lines_del IS 'Audit archive of deleted bank statement lines';


-- ─────────────────────────────────────────────────────────────
-- 2. TRIGGERS
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_del_audit_ap_installments
BEFORE DELETE ON rr_ap_invoice_installments
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_invoice_installments_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_invoice_installments src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_AP_INVOICE_INSTALLMENTS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_ap_pay_rel_inv
BEFORE DELETE ON rr_ap_payments_related_invoices
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_payments_related_invoices_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_payments_related_invoices src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_AP_PAYMENTS_RELATED_INVOICES is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_ap_prepayments
BEFORE DELETE ON rr_ap_applied_prepayments
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_applied_prepayments_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_applied_prepayments src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_AP_APPLIED_PREPAYMENTS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_ap_multiperiod
BEFORE DELETE ON rr_ap_invoice_multiperiod_schedule
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_invoice_multiperiod_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_invoice_multiperiod_schedule src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_AP_INVOICE_MULTIPERIOD_SCHEDULE is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_ap_payments
BEFORE DELETE ON rr_ap_payments_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_payments_all_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_payments_all src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_AP_PAYMENTS_ALL is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_ext_cash_trx
BEFORE DELETE ON rr_external_cash_transactions
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_external_cash_transactions_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_external_cash_transactions src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_EXTERNAL_CASH_TRANSACTIONS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_bank_transfers
BEFORE DELETE ON rr_bank_account_transfers
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_bank_account_transfers_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_bank_account_transfers src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_BANK_ACCOUNT_TRANSFERS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_bank_stmt_hdr
BEFORE DELETE ON rr_bank_statement_header
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_bank_statement_header_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_bank_statement_header src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_BANK_STATEMENT_HEADER is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_bank_stmt_lines
BEFORE DELETE ON rr_bank_statement_lines
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_bank_statement_lines_del
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_bank_statement_lines src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct DELETE on RR_BANK_STATEMENT_LINES is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ─────────────────────────────────────────────────────────────
-- 3. VERIFY ALL TRIGGERS
-- ─────────────────────────────────────────────────────────────
-- SELECT trigger_name, status, table_name
-- FROM user_triggers
-- WHERE trigger_name IN (
--   'TRG_DEL_AUDIT_AP_INSTALLMENTS',
--   'TRG_DEL_AUDIT_AP_PAY_REL_INV',
--   'TRG_DEL_AUDIT_AP_PREPAYMENTS',
--   'TRG_DEL_AUDIT_AP_MULTIPERIOD',
--   'TRG_DEL_AUDIT_AP_PAYMENTS',
--   'TRG_DEL_AUDIT_EXT_CASH_TRX',
--   'TRG_DEL_AUDIT_BANK_TRANSFERS',
--   'TRG_DEL_AUDIT_BANK_STMT_HDR',
--   'TRG_DEL_AUDIT_BANK_STMT_LINES'
-- )
-- ORDER BY trigger_name;
