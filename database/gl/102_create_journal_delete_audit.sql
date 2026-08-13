-- ============================================================
-- Journal Delete Audit Tables + Triggers
-- When a journal batch/header/line is deleted through ReERP,
-- a copy is saved here before deletion for recovery/audit.
--
-- Source tables (actual names confirmed from delete handler):
--   RR_GL_JOURNAL_BATCHES
--   RR_GL_JE_HEADERS
--   RR_GL_JE_LINES_ALL
--
-- Archive tables created:
--   RR_GL_JOURNAL_BATCHES_DEL
--   RR_GL_JE_HEADERS_DEL
--   RR_GL_JE_LINES_ALL_DEL
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ARCHIVE TABLES
-- ─────────────────────────────────────────────────────────────

-- Batches archive (mirrors RR_GL_JOURNAL_BATCHES)
CREATE TABLE rr_gl_journal_batches_del AS
  SELECT b.*,
    CAST(NULL AS VARCHAR2(100))  AS deleted_by,
    CAST(NULL AS TIMESTAMP)      AS deleted_date,
    CAST(NULL AS VARCHAR2(200))  AS deleted_from_module
  FROM rr_gl_journal_batches b
  WHERE 1=0;

CREATE INDEX idx_je_batches_del_batch_id ON rr_gl_journal_batches_del(JE_BATCH_ID);
CREATE INDEX idx_je_batches_del_del_date ON rr_gl_journal_batches_del(DELETED_DATE);
CREATE INDEX idx_je_batches_del_del_by   ON rr_gl_journal_batches_del(DELETED_BY);

COMMENT ON TABLE  rr_gl_journal_batches_del                 IS 'Audit archive of deleted GL journal batches';
COMMENT ON COLUMN rr_gl_journal_batches_del.deleted_by      IS 'DB session user who ran the DELETE';
COMMENT ON COLUMN rr_gl_journal_batches_del.deleted_date    IS 'Timestamp when the row was deleted';
COMMENT ON COLUMN rr_gl_journal_batches_del.deleted_from_module IS 'Oracle MODULE (ORDS, SQL Developer, etc.)';


-- Headers archive (mirrors RR_GL_JE_HEADERS)
CREATE TABLE rr_gl_je_headers_del AS
  SELECT h.*,
    CAST(NULL AS VARCHAR2(100))  AS deleted_by,
    CAST(NULL AS TIMESTAMP)      AS deleted_date,
    CAST(NULL AS VARCHAR2(200))  AS deleted_from_module
  FROM rr_gl_je_headers h
  WHERE 1=0;

CREATE INDEX idx_je_headers_del_header_id ON rr_gl_je_headers_del(JE_HEADER_ID);
CREATE INDEX idx_je_headers_del_batch_id  ON rr_gl_je_headers_del(JE_BATCH_ID);
CREATE INDEX idx_je_headers_del_del_date  ON rr_gl_je_headers_del(DELETED_DATE);
CREATE INDEX idx_je_headers_del_del_by    ON rr_gl_je_headers_del(DELETED_BY);

COMMENT ON TABLE rr_gl_je_headers_del IS 'Audit archive of deleted GL journal headers';


-- Lines archive (mirrors RR_GL_JE_LINES_ALL)
CREATE TABLE rr_gl_je_lines_all_del AS
  SELECT l.*,
    CAST(NULL AS VARCHAR2(100))  AS deleted_by,
    CAST(NULL AS TIMESTAMP)      AS deleted_date,
    CAST(NULL AS VARCHAR2(200))  AS deleted_from_module
  FROM rr_gl_je_lines_all l
  WHERE 1=0;

CREATE INDEX idx_je_lines_del_header_id ON rr_gl_je_lines_all_del(JE_HEADER_ID);
CREATE INDEX idx_je_lines_del_batch_id  ON rr_gl_je_lines_all_del(BATCH_ID);
CREATE INDEX idx_je_lines_del_del_date  ON rr_gl_je_lines_all_del(DELETED_DATE);
CREATE INDEX idx_je_lines_del_del_by    ON rr_gl_je_lines_all_del(DELETED_BY);

COMMENT ON TABLE rr_gl_je_lines_all_del IS 'Audit archive of deleted GL journal lines';


-- ─────────────────────────────────────────────────────────────
-- 2. BEFORE DELETE TRIGGERS
-- Using CTAS above means column list is always in sync with
-- the source table — no manual column mapping needed.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_del_audit_je_batches
BEFORE DELETE ON rr_gl_journal_batches
FOR EACH ROW
DECLARE
  v_cols  SYS.ODCIVARCHAR2LIST;
BEGIN
  INSERT INTO rr_gl_journal_batches_del
  SELECT d.*,
    SYS_CONTEXT('USERENV','SESSION_USER'),
    SYSTIMESTAMP,
    SYS_CONTEXT('USERENV','MODULE')
  FROM rr_gl_journal_batches d
  WHERE d.ROWID = :OLD.ROWID;
EXCEPTION WHEN OTHERS THEN NULL; -- never block a delete due to audit failure
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_je_headers
BEFORE DELETE ON rr_gl_je_headers
FOR EACH ROW
BEGIN
  INSERT INTO rr_gl_je_headers_del
  SELECT d.*,
    SYS_CONTEXT('USERENV','SESSION_USER'),
    SYSTIMESTAMP,
    SYS_CONTEXT('USERENV','MODULE')
  FROM rr_gl_je_headers d
  WHERE d.ROWID = :OLD.ROWID;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


CREATE OR REPLACE TRIGGER trg_del_audit_je_lines
BEFORE DELETE ON rr_gl_je_lines_all
FOR EACH ROW
BEGIN
  INSERT INTO rr_gl_je_lines_all_del
  SELECT d.*,
    SYS_CONTEXT('USERENV','SESSION_USER'),
    SYSTIMESTAMP,
    SYS_CONTEXT('USERENV','MODULE')
  FROM rr_gl_je_lines_all d
  WHERE d.ROWID = :OLD.ROWID;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/


-- ─────────────────────────────────────────────────────────────
-- 3. VERIFY TRIGGERS ARE ENABLED
-- ─────────────────────────────────────────────────────────────
-- SELECT trigger_name, status, table_name
-- FROM user_triggers
-- WHERE trigger_name IN (
--   'TRG_DEL_AUDIT_JE_BATCHES',
--   'TRG_DEL_AUDIT_JE_HEADERS',
--   'TRG_DEL_AUDIT_JE_LINES'
-- );


-- ─────────────────────────────────────────────────────────────
-- 4. RECOVERY QUERIES (reference — do not run blindly)
-- ─────────────────────────────────────────────────────────────
--
-- All deleted batches:
--   SELECT je_batch_id, batch_name, deleted_by, deleted_date, deleted_from_module
--   FROM rr_gl_journal_batches_del
--   ORDER BY deleted_date DESC;
--
-- Deleted today:
--   SELECT * FROM rr_gl_journal_batches_del
--   WHERE TRUNC(deleted_date) = TRUNC(SYSDATE);
--
-- Restore a deleted batch (replace 12345 with actual je_batch_id):
--   INSERT INTO rr_gl_journal_batches
--   SELECT <all source columns — exclude deleted_by/deleted_date/deleted_from_module>
--   FROM rr_gl_journal_batches_del
--   WHERE je_batch_id = 12345
--     AND deleted_date = (
--       SELECT MAX(deleted_date) FROM rr_gl_journal_batches_del WHERE je_batch_id = 12345
--     );
-- ─────────────────────────────────────────────────────────────
