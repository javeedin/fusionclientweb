-- ============================================================
-- 110_block_direct_delete_ap_installments.sql
-- Block direct SQL DELETE on RR_AP_INVOICE_INSTALLMENTS
-- + pre-delete archive (same pattern as 104 / 107).
--
-- Prerequisite: reerp_security package must exist
--   (from 103_block_direct_delete_journals.sql)
-- ============================================================


-- ── 1. Archive table (CTAS) ───────────────────────────────────
CREATE TABLE rr_ap_invoice_installments_del AS
  SELECT t.*,
    CAST(NULL AS VARCHAR2(100)) AS deleted_by,
    CAST(NULL AS TIMESTAMP)     AS deleted_date,
    CAST(NULL AS VARCHAR2(200)) AS deleted_from_module
  FROM rr_ap_invoice_installments t WHERE 1=0;

CREATE INDEX idx_ap_inst_del_inv_id   ON rr_ap_invoice_installments_del(INVOICE_ID);
CREATE INDEX idx_ap_inst_del_del_date ON rr_ap_invoice_installments_del(DELETED_DATE);
CREATE INDEX idx_ap_inst_del_del_by   ON rr_ap_invoice_installments_del(DELETED_BY);

COMMENT ON TABLE rr_ap_invoice_installments_del IS 'Audit archive of deleted AP invoice installments';


-- ── 2. BEFORE DELETE trigger ──────────────────────────────────
CREATE OR REPLACE TRIGGER trg_del_audit_ap_installments
BEFORE DELETE ON rr_ap_invoice_installments
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_ap_invoice_installments_del
    SELECT src.*,
           SYS_CONTEXT('USERENV','SESSION_USER'),
           SYSTIMESTAMP,
           SYS_CONTEXT('USERENV','MODULE')
    FROM   rr_ap_invoice_installments src
    WHERE  src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001,
      'Direct DELETE on RR_AP_INVOICE_INSTALLMENTS is not permitted. Use the ReERP UI. '
      || '(Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ── 3. Verify ─────────────────────────────────────────────────
-- SELECT trigger_name, status, table_name
-- FROM user_triggers
-- WHERE trigger_name = 'TRG_DEL_AUDIT_AP_INSTALLMENTS';

-- Recovery query:
-- SELECT invoice_id, deleted_by, deleted_date, deleted_from_module
-- FROM rr_ap_invoice_installments_del ORDER BY deleted_date DESC;
