-- ============================================================
-- AP Invoices & Payments Delete Audit + Block Direct SQL
--
-- Tables covered:
--   RR_RAW_AP_INVOICES_ALL   → RR_RAW_AP_INVOICES_ALL_DEL
--   RR_AP_INVOICE_LINES_ALL  → RR_AP_INVOICE_LINES_ALL_DEL
--   RR_AP_PAYMENTS_ALL       → RR_AP_PAYMENTS_ALL_DEL
--
-- Run order:
--   1. Run this file (creates archive tables + triggers)
--   2. reerp_security package must already exist (from 103_block_direct_delete_journals.sql)
--      If not, run the package section from that file first.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. ARCHIVE TABLES (CTAS from live — always in sync)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE rr_raw_ap_invoices_all_del AS
  SELECT i.*,
    CAST(NULL AS VARCHAR2(100)) AS deleted_by,
    CAST(NULL AS TIMESTAMP)     AS deleted_date,
    CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_raw_ap_invoices_all i WHERE 1=0;

CREATE INDEX idx_ap_inv_del_invoice_id  ON rr_raw_ap_invoices_all_del(INVOICE_ID);
CREATE INDEX idx_ap_inv_del_del_date    ON rr_raw_ap_invoices_all_del(DELETED_DATE);
CREATE INDEX idx_ap_inv_del_del_by      ON rr_raw_ap_invoices_all_del(DELETED_BY);

COMMENT ON TABLE rr_raw_ap_invoices_all_del IS 'Audit archive of deleted AP invoices';


CREATE TABLE rr_ap_invoice_lines_all_del AS
  SELECT l.*,
    CAST(NULL AS VARCHAR2(100)) AS deleted_by,
    CAST(NULL AS TIMESTAMP)     AS deleted_date,
    CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_invoice_lines_all l WHERE 1=0;

CREATE INDEX idx_ap_invl_del_invoice_id ON rr_ap_invoice_lines_all_del(INVOICE_ID);
CREATE INDEX idx_ap_invl_del_del_date   ON rr_ap_invoice_lines_all_del(DELETED_DATE);
CREATE INDEX idx_ap_invl_del_del_by     ON rr_ap_invoice_lines_all_del(DELETED_BY);

COMMENT ON TABLE rr_ap_invoice_lines_all_del IS 'Audit archive of deleted AP invoice lines';


CREATE TABLE rr_ap_payments_all_del AS
  SELECT p.*,
    CAST(NULL AS VARCHAR2(100)) AS deleted_by,
    CAST(NULL AS TIMESTAMP)     AS deleted_date,
    CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_payments_all p WHERE 1=0;

CREATE INDEX idx_ap_pay_del_check_id  ON rr_ap_payments_all_del(CHECK_ID);
CREATE INDEX idx_ap_pay_del_del_date  ON rr_ap_payments_all_del(DELETED_DATE);
CREATE INDEX idx_ap_pay_del_del_by    ON rr_ap_payments_all_del(DELETED_BY);

COMMENT ON TABLE rr_ap_payments_all_del IS 'Audit archive of deleted AP payments';


-- ─────────────────────────────────────────────────────────────
-- 2. VERIFY reerp_security package exists
--    If this errors, run the package from 103_block_direct_delete_journals.sql first
-- ─────────────────────────────────────────────────────────────
-- SELECT object_name, status FROM user_objects
-- WHERE object_name = 'REERP_SECURITY' AND object_type = 'PACKAGE BODY';


-- ─────────────────────────────────────────────────────────────
-- 3. TRIGGERS
-- Run this query to get exact column names if trigger errors:
--   SELECT column_name, column_id FROM all_tab_columns
--   WHERE owner='BCLDIFC'
--   AND table_name IN ('RR_RAW_AP_INVOICES_ALL','RR_AP_INVOICE_LINES_ALL','RR_AP_PAYMENTS_ALL')
--   ORDER BY table_name, column_id;
-- ─────────────────────────────────────────────────────────────

-- ── AP INVOICES ───────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_del_audit_ap_invoices
BEFORE DELETE ON rr_raw_ap_invoices_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_raw_ap_invoices_all_del
    SELECT src.*,
           SYS_CONTEXT('USERENV','SESSION_USER'),
           SYSTIMESTAMP,
           SYS_CONTEXT('USERENV','MODULE')
    FROM   rr_raw_ap_invoices_all src
    WHERE  src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001,
      'Direct DELETE on RR_RAW_AP_INVOICES_ALL is not permitted. Use the ReERP UI. '
      || '(Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ── AP INVOICE LINES ──────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_del_audit_ap_inv_lines
BEFORE DELETE ON rr_ap_invoice_lines_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_invoice_lines_all_del
    SELECT src.*,
           SYS_CONTEXT('USERENV','SESSION_USER'),
           SYSTIMESTAMP,
           SYS_CONTEXT('USERENV','MODULE')
    FROM   rr_ap_invoice_lines_all src
    WHERE  src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001,
      'Direct DELETE on RR_AP_INVOICE_LINES_ALL is not permitted. Use the ReERP UI. '
      || '(Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ── AP PAYMENTS ───────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_del_audit_ap_payments
BEFORE DELETE ON rr_ap_payments_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_payments_all_del
    SELECT src.*,
           SYS_CONTEXT('USERENV','SESSION_USER'),
           SYSTIMESTAMP,
           SYS_CONTEXT('USERENV','MODULE')
    FROM   rr_ap_payments_all src
    WHERE  src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001,
      'Direct DELETE on RR_AP_PAYMENTS_ALL is not permitted. Use the ReERP UI. '
      || '(Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ─────────────────────────────────────────────────────────────
-- 4. VERIFY
-- ─────────────────────────────────────────────────────────────
-- SELECT trigger_name, status, table_name
-- FROM user_triggers
-- WHERE trigger_name IN (
--   'TRG_DEL_AUDIT_AP_INVOICES',
--   'TRG_DEL_AUDIT_AP_INV_LINES',
--   'TRG_DEL_AUDIT_AP_PAYMENTS'
-- );

-- ─────────────────────────────────────────────────────────────
-- 5. RECOVERY QUERIES
-- ─────────────────────────────────────────────────────────────
-- Deleted invoices:
--   SELECT invoice_id, invoice_num, deleted_by, deleted_date, deleted_from_module
--   FROM rr_raw_ap_invoices_all_del ORDER BY deleted_date DESC;
--
-- Deleted payments:
--   SELECT check_id, payment_reference, deleted_by, deleted_date
--   FROM rr_ap_payments_all_del ORDER BY deleted_date DESC;
-- ─────────────────────────────────────────────────────────────
