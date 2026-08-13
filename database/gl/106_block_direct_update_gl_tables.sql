-- ============================================================
-- Block Direct SQL UPDATE on GL Tables + Before-Update Archive
-- Only ORDS (ReERP UI) is allowed to update these tables.
-- Direct updates from APEX SQL Workshop, SQL Developer, etc.
-- are blocked with ORA-20001.
--
-- Old row values are archived to _UPD tables before each update
-- so you have a full change history.
--
-- Tables covered:
--   RR_GL_JOURNAL_BATCHES
--   RR_GL_JE_HEADERS
--   RR_GL_JE_LINES_ALL
--
-- Prerequisite: reerp_security package (103_block_direct_delete_journals.sql)
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. UPDATE ARCHIVE TABLES (old values before change)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE rr_gl_journal_batches_upd AS
  SELECT t.*,
    CAST(NULL AS VARCHAR2(100)) AS changed_by,
    CAST(NULL AS TIMESTAMP)     AS changed_date,
    CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_gl_journal_batches t WHERE 1=0;

CREATE INDEX idx_je_batches_upd_batch_id ON rr_gl_journal_batches_upd(JE_BATCH_ID);
CREATE INDEX idx_je_batches_upd_chg_date ON rr_gl_journal_batches_upd(CHANGED_DATE);
COMMENT ON TABLE rr_gl_journal_batches_upd IS 'Pre-update snapshot of GL journal batches (change history)';


CREATE TABLE rr_gl_je_headers_upd AS
  SELECT t.*,
    CAST(NULL AS VARCHAR2(100)) AS changed_by,
    CAST(NULL AS TIMESTAMP)     AS changed_date,
    CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_gl_je_headers t WHERE 1=0;

CREATE INDEX idx_je_headers_upd_hdr_id  ON rr_gl_je_headers_upd(JE_HEADER_ID);
CREATE INDEX idx_je_headers_upd_chg_date ON rr_gl_je_headers_upd(CHANGED_DATE);
COMMENT ON TABLE rr_gl_je_headers_upd IS 'Pre-update snapshot of GL journal headers (change history)';


CREATE TABLE rr_gl_je_lines_all_upd AS
  SELECT t.*,
    CAST(NULL AS VARCHAR2(100)) AS changed_by,
    CAST(NULL AS TIMESTAMP)     AS changed_date,
    CAST(NULL AS VARCHAR2(200)) AS changed_from_module
  FROM rr_gl_je_lines_all t WHERE 1=0;

CREATE INDEX idx_je_lines_upd_header_id ON rr_gl_je_lines_all_upd(JE_HEADER_ID);
CREATE INDEX idx_je_lines_upd_batch_id  ON rr_gl_je_lines_all_upd(BATCH_ID);
CREATE INDEX idx_je_lines_upd_chg_date  ON rr_gl_je_lines_all_upd(CHANGED_DATE);
COMMENT ON TABLE rr_gl_je_lines_all_upd IS 'Pre-update snapshot of GL journal lines (change history)';


-- ─────────────────────────────────────────────────────────────
-- 2. BEFORE UPDATE TRIGGERS
-- ─────────────────────────────────────────────────────────────

-- ── BATCHES ──────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_upd_audit_je_batches
BEFORE UPDATE ON rr_gl_journal_batches
FOR EACH ROW
BEGIN
  -- Archive old values before overwriting
  BEGIN
    INSERT INTO rr_gl_journal_batches_upd
    SELECT src.*,
           SYS_CONTEXT('USERENV','SESSION_USER'),
           SYSTIMESTAMP,
           SYS_CONTEXT('USERENV','MODULE')
    FROM   rr_gl_journal_batches src
    WHERE  src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Block if not from ORDS/UI
  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001,
      'Direct UPDATE on RR_GL_JOURNAL_BATCHES is not permitted. Use the ReERP UI. '
      || '(Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ── HEADERS ──────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_upd_audit_je_headers
BEFORE UPDATE ON rr_gl_je_headers
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_gl_je_headers_upd
    SELECT src.*,
           SYS_CONTEXT('USERENV','SESSION_USER'),
           SYSTIMESTAMP,
           SYS_CONTEXT('USERENV','MODULE')
    FROM   rr_gl_je_headers src
    WHERE  src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001,
      'Direct UPDATE on RR_GL_JE_HEADERS is not permitted. Use the ReERP UI. '
      || '(Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ── LINES ─────────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_upd_audit_je_lines
BEFORE UPDATE ON rr_gl_je_lines_all
FOR EACH ROW
BEGIN
  BEGIN
    INSERT INTO rr_gl_je_lines_all_upd
    SELECT src.*,
           SYS_CONTEXT('USERENV','SESSION_USER'),
           SYSTIMESTAMP,
           SYS_CONTEXT('USERENV','MODULE')
    FROM   rr_gl_je_lines_all src
    WHERE  src.ROWID = :OLD.ROWID;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF NOT reerp_security.is_ords_call() THEN
    RAISE_APPLICATION_ERROR(-20001,
      'Direct UPDATE on RR_GL_JE_LINES_ALL is not permitted. Use the ReERP UI. '
      || '(Module=' || NVL(SYS_CONTEXT('USERENV','MODULE'),'NULL') || ')');
  END IF;
END;
/


-- ─────────────────────────────────────────────────────────────
-- 3. VERIFY
-- ─────────────────────────────────────────────────────────────
-- SELECT trigger_name, status, table_name
-- FROM user_triggers
-- WHERE trigger_name IN (
--   'TRG_UPD_AUDIT_JE_BATCHES',
--   'TRG_UPD_AUDIT_JE_HEADERS',
--   'TRG_UPD_AUDIT_JE_LINES'
-- );

-- ─────────────────────────────────────────────────────────────
-- 4. AUDIT QUERIES
-- ─────────────────────────────────────────────────────────────
-- Who changed what today:
--   SELECT je_batch_id, batch_name, status, changed_by, changed_date, changed_from_module
--   FROM rr_gl_journal_batches_upd
--   WHERE TRUNC(changed_date) = TRUNC(SYSDATE)
--   ORDER BY changed_date DESC;
--
-- Full change history for a specific batch:
--   SELECT * FROM rr_gl_journal_batches_upd
--   WHERE je_batch_id = 12345
--   ORDER BY changed_date DESC;
--
-- Restore a batch to a previous state:
--   UPDATE rr_gl_journal_batches SET
--     status = (SELECT status FROM rr_gl_journal_batches_upd
--               WHERE je_batch_id = 12345
--               AND changed_date = (SELECT MAX(changed_date)
--                                   FROM rr_gl_journal_batches_upd
--                                   WHERE je_batch_id = 12345))
--   WHERE je_batch_id = 12345;
-- ─────────────────────────────────────────────────────────────
