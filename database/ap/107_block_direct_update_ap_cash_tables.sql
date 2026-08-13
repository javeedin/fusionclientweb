-- ============================================================
-- Block Direct SQL UPDATE on AP and Cash Tables
-- + Pre-Update Archive (change history)
--
-- Tables covered:
--   AP:
--     RR_RAW_AP_INVOICES_ALL
--     RR_AP_INVOICE_LINES_ALL
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
-- Prerequisite: reerp_security package (103_block_direct_delete_journals.sql)
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. UPDATE ARCHIVE TABLES
-- ─────────────────────────────────────────────────────────────

CREATE TABLE rr_raw_ap_invoices_all_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_raw_ap_invoices_all t WHERE 1=0;
CREATE INDEX idx_ap_inv_upd_invoice_id ON rr_raw_ap_invoices_all_upd(INVOICE_ID);
CREATE INDEX idx_ap_inv_upd_chg_date   ON rr_raw_ap_invoices_all_upd(CHANGED_DATE);
COMMENT ON TABLE rr_raw_ap_invoices_all_upd IS 'Pre-update snapshot of AP invoices (change history)';


CREATE TABLE rr_ap_invoice_lines_all_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_ap_invoice_lines_all t WHERE 1=0;
CREATE INDEX idx_ap_invl_upd_inv_id   ON rr_ap_invoice_lines_all_upd(INVOICE_ID);
CREATE INDEX idx_ap_invl_upd_chg_date ON rr_ap_invoice_lines_all_upd(CHANGED_DATE);
COMMENT ON TABLE rr_ap_invoice_lines_all_upd IS 'Pre-update snapshot of AP invoice lines (change history)';


CREATE TABLE rr_ap_invoice_installments_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_ap_invoice_installments t WHERE 1=0;
CREATE INDEX idx_ap_inst_upd_inv_id   ON rr_ap_invoice_installments_upd(INVOICE_ID);
CREATE INDEX idx_ap_inst_upd_chg_date ON rr_ap_invoice_installments_upd(CHANGED_DATE);
COMMENT ON TABLE rr_ap_invoice_installments_upd IS 'Pre-update snapshot of AP invoice installments (change history)';


CREATE TABLE rr_ap_pay_rel_invoices_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_ap_payments_related_invoices t WHERE 1=0;
CREATE INDEX idx_ap_payrel_upd_chg_date ON rr_ap_pay_rel_invoices_upd(CHANGED_DATE);
COMMENT ON TABLE rr_ap_pay_rel_invoices_upd IS 'Pre-update snapshot of AP payment-invoice links (change history)';


CREATE TABLE rr_ap_applied_prepayments_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_ap_applied_prepayments t WHERE 1=0;
CREATE INDEX idx_ap_prepay_upd_chg_date ON rr_ap_applied_prepayments_upd(CHANGED_DATE);
COMMENT ON TABLE rr_ap_applied_prepayments_upd IS 'Pre-update snapshot of AP applied prepayments (change history)';


CREATE TABLE rr_ap_invoice_multiperiod_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_ap_invoice_multiperiod_schedule t WHERE 1=0;
CREATE INDEX idx_ap_multi_upd_chg_date ON rr_ap_invoice_multiperiod_upd(CHANGED_DATE);
COMMENT ON TABLE rr_ap_invoice_multiperiod_upd IS 'Pre-update snapshot of AP multiperiod schedules (change history)';


CREATE TABLE rr_ap_payments_all_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_ap_payments_all t WHERE 1=0;
CREATE INDEX idx_ap_pay_upd_check_id  ON rr_ap_payments_all_upd(CHECK_ID);
CREATE INDEX idx_ap_pay_upd_chg_date  ON rr_ap_payments_all_upd(CHANGED_DATE);
COMMENT ON TABLE rr_ap_payments_all_upd IS 'Pre-update snapshot of AP payments (change history)';


CREATE TABLE rr_external_cash_trx_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_external_cash_transactions t WHERE 1=0;
CREATE INDEX idx_ext_trx_upd_chg_date ON rr_external_cash_trx_upd(CHANGED_DATE);
COMMENT ON TABLE rr_external_cash_trx_upd IS 'Pre-update snapshot of external cash transactions (change history)';


CREATE TABLE rr_bank_account_transfers_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_bank_account_transfers t WHERE 1=0;
CREATE INDEX idx_bank_xfr_upd_chg_date ON rr_bank_account_transfers_upd(CHANGED_DATE);
COMMENT ON TABLE rr_bank_account_transfers_upd IS 'Pre-update snapshot of bank account transfers (change history)';


CREATE TABLE rr_bank_statement_header_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_bank_statement_header t WHERE 1=0;
CREATE INDEX idx_bstmt_hdr_upd_chg_date ON rr_bank_statement_header_upd(CHANGED_DATE);
COMMENT ON TABLE rr_bank_statement_header_upd IS 'Pre-update snapshot of bank statement headers (change history)';


CREATE TABLE rr_bank_statement_lines_upd AS
  SELECT t.*, CAST(NULL AS VARCHAR2(100)) AS changed_by,
               CAST(NULL AS TIMESTAMP)     AS changed_date,
               CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_bank_statement_lines t WHERE 1=0;
CREATE INDEX idx_bstmt_ln_upd_chg_date ON rr_bank_statement_lines_upd(CHANGED_DATE);
COMMENT ON TABLE rr_bank_statement_lines_upd IS 'Pre-update snapshot of bank statement lines (change history)';


-- ─────────────────────────────────────────────────────────────
-- 2. TRIGGERS
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_upd_audit_ap_invoices
BEFORE UPDATE ON rr_raw_ap_invoices_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_raw_ap_invoices_all_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_raw_ap_invoices_all src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_RAW_AP_INVOICES_ALL is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_ap_inv_lines
BEFORE UPDATE ON rr_ap_invoice_lines_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_invoice_lines_all_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_invoice_lines_all src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_AP_INVOICE_LINES_ALL is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_ap_installments
BEFORE UPDATE ON rr_ap_invoice_installments
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_invoice_installments_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_invoice_installments src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_AP_INVOICE_INSTALLMENTS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_ap_pay_rel_inv
BEFORE UPDATE ON rr_ap_payments_related_invoices
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_pay_rel_invoices_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_payments_related_invoices src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_AP_PAYMENTS_RELATED_INVOICES is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_ap_prepayments
BEFORE UPDATE ON rr_ap_applied_prepayments
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_applied_prepayments_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_applied_prepayments src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_AP_APPLIED_PREPAYMENTS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_ap_multiperiod
BEFORE UPDATE ON rr_ap_invoice_multiperiod_schedule
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_invoice_multiperiod_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_invoice_multiperiod_schedule src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_AP_INVOICE_MULTIPERIOD_SCHEDULE is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_ap_payments
BEFORE UPDATE ON rr_ap_payments_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_payments_all_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_ap_payments_all src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_AP_PAYMENTS_ALL is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_ext_cash_trx
BEFORE UPDATE ON rr_external_cash_transactions
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_external_cash_trx_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_external_cash_transactions src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_EXTERNAL_CASH_TRANSACTIONS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_bank_transfers
BEFORE UPDATE ON rr_bank_account_transfers
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_bank_account_transfers_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_bank_account_transfers src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_BANK_ACCOUNT_TRANSFERS is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_bank_stmt_hdr
BEFORE UPDATE ON rr_bank_statement_header
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_bank_statement_header_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_bank_statement_header src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_BANK_STATEMENT_HEADER is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


CREATE OR REPLACE TRIGGER trg_upd_audit_bank_stmt_lines
BEFORE UPDATE ON rr_bank_statement_lines
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_bank_statement_lines_upd
    SELECT src.*, SYS_CONTEXT('USERENV','SESSION_USER'), SYSTIMESTAMP, SYS_CONTEXT('USERENV','MODULE')
    FROM rr_bank_statement_lines src WHERE src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001, 'Direct UPDATE on RR_BANK_STATEMENT_LINES is not permitted. Use the ReERP UI. (Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ─────────────────────────────────────────────────────────────
-- 3. VERIFY ALL TRIGGERS
-- ─────────────────────────────────────────────────────────────
-- SELECT trigger_name, status, table_name
-- FROM user_triggers
-- WHERE trigger_name LIKE 'TRG_UPD_%'
-- ORDER BY table_name;
-- ─────────────────────────────────────────────────────────────
