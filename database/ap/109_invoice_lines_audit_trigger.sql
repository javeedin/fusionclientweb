-- ============================================================
-- 109_invoice_lines_audit_trigger.sql
-- Creates audit shadow table + BEFORE UPDATE trigger for
-- RR_AP_INVOICE_LINES_ALL, following the same CTAS + ROWID
-- pattern used in 102_create_journal_delete_audit.sql.
--
-- WHY trigger didn't fire before:
--   rr_ap_update_invoice_put.sql uses DELETE+INSERT strategy,
--   not a real UPDATE, so BEFORE UPDATE never fired.
--   The new PUT (108_patch_invoice_line_tax_amount.sql) does
--   a real UPDATE → trigger will fire correctly.
-- ============================================================

-- ── 1. Audit shadow table (CTAS — stays in sync with source) ─
CREATE TABLE RR_AP_INVOICE_LINES_ALL_UPD AS
  SELECT
    l.*,
    CAST(NULL AS NUMBER)       AS AUDIT_ID,
    CAST(NULL AS TIMESTAMP)    AS AUDIT_DATE,
    CAST(NULL AS VARCHAR2(100)) AS AUDIT_USER,
    CAST(NULL AS VARCHAR2(10)) AS OPERATION
  FROM RR_AP_INVOICE_LINES_ALL l
  WHERE 1=0;

-- Sequence for AUDIT_ID
CREATE SEQUENCE SEQ_AP_LINE_UPD_AUDIT_ID START WITH 1 INCREMENT BY 1 NOCACHE;

CREATE INDEX IDX_AP_LINE_UPD_INV_ID  ON RR_AP_INVOICE_LINES_ALL_UPD (INVOICE_ID);
CREATE INDEX IDX_AP_LINE_UPD_LINE_ID ON RR_AP_INVOICE_LINES_ALL_UPD (LINE_ID);
CREATE INDEX IDX_AP_LINE_UPD_DATE    ON RR_AP_INVOICE_LINES_ALL_UPD (AUDIT_DATE);

COMMENT ON TABLE  RR_AP_INVOICE_LINES_ALL_UPD            IS 'Audit trail of UPDATE operations on RR_AP_INVOICE_LINES_ALL';
COMMENT ON COLUMN RR_AP_INVOICE_LINES_ALL_UPD.AUDIT_ID   IS 'Unique audit record identifier';
COMMENT ON COLUMN RR_AP_INVOICE_LINES_ALL_UPD.AUDIT_DATE IS 'Timestamp when the UPDATE occurred';
COMMENT ON COLUMN RR_AP_INVOICE_LINES_ALL_UPD.AUDIT_USER IS 'DB session user who ran the UPDATE';
COMMENT ON COLUMN RR_AP_INVOICE_LINES_ALL_UPD.OPERATION  IS 'Always UPDATE for this table';


-- ── 2. BEFORE UPDATE trigger ──────────────────────────────────
-- Captures the BEFORE image (old row) using ROWID pattern,
-- same as the GL delete audit triggers.
CREATE OR REPLACE TRIGGER TRG_AP_INVOICE_LINES_BU
BEFORE UPDATE ON RR_AP_INVOICE_LINES_ALL
FOR EACH ROW
BEGIN
  INSERT INTO RR_AP_INVOICE_LINES_ALL_UPD
  SELECT
    d.*,
    SEQ_AP_LINE_UPD_AUDIT_ID.NEXTVAL,
    SYSTIMESTAMP,
    NVL(SYS_CONTEXT('USERENV','SESSION_USER'), USER),
    'UPDATE'
  FROM RR_AP_INVOICE_LINES_ALL d
  WHERE d.ROWID = :OLD.ROWID;
EXCEPTION WHEN OTHERS THEN NULL; -- never block an update due to audit failure
END;
/


-- ── 3. GET endpoint — audit rows for an invoice ───────────────
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'ap/invoices/:invoice_id/lines/audit',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_collection_feed,
    p_source         => q'[
SELECT
    u.AUDIT_ID         AS audit_id,
    TO_CHAR(u.AUDIT_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS audit_date,
    u.AUDIT_USER       AS audit_user,
    u.OPERATION        AS operation,
    u.LINE_ID          AS line_id,
    u.INVOICE_ID       AS invoice_id,
    u.LINE_NUMBER      AS line_number,
    u.LINE_TYPE        AS line_type,
    u.LINE_AMOUNT      AS line_amount,
    u.DESCRIPTION      AS description,
    TO_CHAR(u.ACCOUNTING_DATE, 'YYYY-MM-DD') AS accounting_date,
    u.DISTRIBUTION_COMBINATION AS distribution_combination,
    u.DISTRIBUTION_SET AS distribution_set,
    u.TAX_CLASSIFICATION   AS tax_classification,
    u.TAX_CONTROL_AMOUNT   AS tax_control_amount,
    u.QUANTITY         AS quantity,
    u.UNIT_PRICE       AS unit_price,
    u.PROCESS_STATUS   AS process_status,
    u.LAST_UPDATED_BY  AS last_updated_by
FROM RR_AP_INVOICE_LINES_ALL_UPD u
WHERE u.INVOICE_ID = :invoice_id
ORDER BY u.AUDIT_DATE DESC
]',
    p_items_per_page => 200
  );
  COMMIT;
END;
/


-- ── 4. Verify trigger ─────────────────────────────────────────
-- SELECT trigger_name, status, table_name
-- FROM user_triggers
-- WHERE trigger_name = 'TRG_AP_INVOICE_LINES_BU';
