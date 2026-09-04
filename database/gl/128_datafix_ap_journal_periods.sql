-- =============================================================================
-- PATCH 128 (DATA FIX): Align journal PERIOD_NAME with DEFAULT_EFFECTIVE_DATE
--
-- SCOPE (no source-document joins):
--   Every RR_GL_JE_HEADERS row where PERIOD_NAME differs from the month of
--   DEFAULT_EFFECTIVE_DATE, i.e.
--       PERIOD_NAME <> TO_CHAR(DEFAULT_EFFECTIVE_DATE,'Mon-YY')
--   plus the matching RR_GL_JOURNAL_BATCHES.DEFAULT_PERIOD_NAME.
--
-- DIRECTION (default): the ACCOUNTING DATE is the truth — PERIOD_NAME is
--   rewritten to the date's month (Oracle convention: GL date drives the
--   period). An ALTERNATIVE block at the bottom does the opposite (keep the
--   period, snap the date to the period's first day) for journals where the
--   period is the trusted side — run it only for reviewed je_header_ids.
--
-- PREREQUISITES:
--   Patch-106 triggers disabled while this runs:
--     ALTER TRIGGER trg_upd_audit_je_headers  DISABLE;
--     ALTER TRIGGER trg_upd_audit_je_batches  DISABLE;
--   *** RE-ENABLE THEM at the end (Step 5) — do not skip. ***
--
-- RUN ORDER: each step separately in APEX SQL Workshop; review between steps.
-- =============================================================================


-- =============================================================================
-- STEP 0 — Backup the rows this fix will touch (run once; errors if rerun)
-- =============================================================================
CREATE TABLE rr_gl_je_headers_bk128 AS
SELECT h.* FROM rr_gl_je_headers h
WHERE  h.default_effective_date IS NOT NULL
AND    h.period_name IS NOT NULL
AND    h.period_name <> TO_CHAR(h.default_effective_date,'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH');

CREATE TABLE rr_gl_batches_bk128 AS
SELECT b.* FROM rr_gl_journal_batches b
WHERE  b.je_batch_id IN (SELECT je_batch_id FROM rr_gl_je_headers_bk128);


-- =============================================================================
-- STEP 1 — DRY RUN: what will change (review before updating!)
-- =============================================================================
SELECT h.je_batch_id,
       b.batch_name,
       h.je_header_id,
       h.journal_name,
       h.period_name                                    AS old_period,
       TO_CHAR(h.default_effective_date,'YYYY-MM-DD')   AS effective_date,
       TO_CHAR(h.default_effective_date,'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH') AS new_period
FROM   rr_gl_je_headers h
LEFT JOIN rr_gl_journal_batches b ON b.je_batch_id = h.je_batch_id
WHERE  h.default_effective_date IS NOT NULL
AND    h.period_name IS NOT NULL
AND    h.period_name <> TO_CHAR(h.default_effective_date,'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH')
ORDER  BY h.default_effective_date, h.je_batch_id;


-- =============================================================================
-- STEP 2 — UPDATE HEADERS: period := month of the accounting date
-- =============================================================================
UPDATE rr_gl_je_headers h
SET    h.period_name = TO_CHAR(h.default_effective_date,'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH')
WHERE  h.default_effective_date IS NOT NULL
AND    h.period_name IS NOT NULL
AND    h.period_name <> TO_CHAR(h.default_effective_date,'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH');
-- row count must equal the STEP 1 dry-run count


-- =============================================================================
-- STEP 3 — UPDATE BATCHES: DEFAULT_PERIOD_NAME follows the (fixed) headers
--   (only batches whose headers were in the backup, i.e. actually touched)
-- =============================================================================
UPDATE rr_gl_journal_batches b
SET    b.default_period_name = (
           SELECT MAX(h.period_name)
           FROM   rr_gl_je_headers h
           WHERE  h.je_batch_id = b.je_batch_id
       )
WHERE  b.je_batch_id IN (SELECT je_batch_id FROM rr_gl_je_headers_bk128)
AND    NVL(b.default_period_name,'~') <> (
           SELECT MAX(h.period_name)
           FROM   rr_gl_je_headers h
           WHERE  h.je_batch_id = b.je_batch_id
       );

COMMIT;


-- =============================================================================
-- STEP 4 — VERIFY: both queries must return ZERO rows
-- =============================================================================
-- 4a. remaining period/date mismatches:
SELECT COUNT(*) AS remaining_mismatches
FROM   rr_gl_je_headers h
WHERE  h.default_effective_date IS NOT NULL
AND    h.period_name IS NOT NULL
AND    h.period_name <> TO_CHAR(h.default_effective_date,'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH');

-- 4b. headers vs batches out of sync (touched batches only):
SELECT h.je_batch_id, h.period_name, b.default_period_name
FROM   rr_gl_je_headers h
JOIN   rr_gl_journal_batches b ON b.je_batch_id = h.je_batch_id
WHERE  b.je_batch_id IN (SELECT je_batch_id FROM rr_gl_je_headers_bk128)
AND    h.period_name <> NVL(b.default_period_name,'~');


-- =============================================================================
-- STEP 5 — RE-ENABLE THE TRIGGERS (mandatory)
-- =============================================================================
-- ALTER TRIGGER trg_upd_audit_je_headers  ENABLE;
-- ALTER TRIGGER trg_upd_audit_je_batches  ENABLE;


-- =============================================================================
-- ALTERNATIVE DIRECTION (per-journal, after review): the PERIOD is the truth
-- and the DATE is wrong — snap the date to the period's first day instead.
-- Run ONLY for explicitly listed je_header_ids:
-- =============================================================================
-- UPDATE rr_gl_je_headers h
-- SET    h.default_effective_date = TO_DATE('01-'||h.period_name,'DD-Mon-RR','NLS_DATE_LANGUAGE=ENGLISH')
-- WHERE  h.je_header_id IN ( /* reviewed ids */ );
-- COMMIT;


-- =============================================================================
-- ROLLBACK (if ever needed): restore from the STEP 0 backups
--   UPDATE rr_gl_je_headers h SET (period_name, default_effective_date) =
--     (SELECT period_name, default_effective_date FROM rr_gl_je_headers_bk128 k
--       WHERE k.je_header_id = h.je_header_id)
--   WHERE h.je_header_id IN (SELECT je_header_id FROM rr_gl_je_headers_bk128);
--   UPDATE rr_gl_journal_batches b SET b.default_period_name =
--     (SELECT k.default_period_name FROM rr_gl_batches_bk128 k
--       WHERE k.je_batch_id = b.je_batch_id)
--   WHERE b.je_batch_id IN (SELECT je_batch_id FROM rr_gl_batches_bk128);
--   COMMIT;
-- =============================================================================
