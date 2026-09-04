-- =============================================================================
-- PATCH 128 (DATA FIX): Repair AP invoice journals booked to the wrong period
--
-- BACKGROUND:
--   The AP accounting flows derived the GL period from the click moment
--   (today) instead of the invoice's accounting date, producing journals in
--   e.g. Aug-26 for invoices dated in July (code fixed in commit 4a9d7d8).
--   This script repairs the existing journals.
--
-- SCOPE:
--   Journals created by the app's AP invoice flow — identified by lines with
--   REFERENCE5 = 'AP-INVOICE-CREATION' and REFERENCE2 = invoice id — whose
--   header PERIOD_NAME or DEFAULT_EFFECTIVE_DATE differs from the invoice's
--   true accounting date: NVL(GL_DATE, INVOICE_DATE) from
--   RR_RAW_AP_INVOICES_ALL. Batches whose lines reference more than one
--   invoice are EXCLUDED (must be reviewed manually).
--
-- PREREQUISITES:
--   The patch-106 update-block triggers must be DISABLED while this runs:
--     ALTER TRIGGER trg_upd_audit_je_headers  DISABLE;
--     ALTER TRIGGER trg_upd_audit_je_batches  DISABLE;
--   *** RE-ENABLE THEM at the end (Step 5) — do not skip. ***
--
-- RUN ORDER: each step separately in APEX SQL Workshop, review between steps.
-- =============================================================================


-- =============================================================================
-- STEP 0 — Backup the rows this fix will touch (run once; errors if rerun)
-- =============================================================================
CREATE TABLE rr_gl_je_headers_bk128 AS
SELECT h.* FROM rr_gl_je_headers h
WHERE  h.je_header_id IN (
    SELECT l.je_header_id
    FROM   rr_gl_je_lines_all l
    JOIN   rr_raw_ap_invoices_all inv
      ON   TO_CHAR(inv.invoice_id) = l.reference2
    WHERE  l.reference5 = 'AP-INVOICE-CREATION'
);

CREATE TABLE rr_gl_batches_bk128 AS
SELECT b.* FROM rr_gl_journal_batches b
WHERE  b.je_batch_id IN (
    SELECT h.je_batch_id FROM rr_gl_je_headers_bk128 h
);


-- =============================================================================
-- STEP 1 — DRY RUN: exactly what will change (review this before updating!)
--   truth = NVL(invoice GL_DATE, INVOICE_DATE)
-- =============================================================================
WITH batch_invoice AS (
    -- one invoice per batch; multi-invoice batches are excluded
    SELECT l.batch_id,
           MAX(l.reference2)                    AS invoice_ref,
           COUNT(DISTINCT l.reference2)         AS inv_count
    FROM   rr_gl_je_lines_all l
    WHERE  l.reference5 = 'AP-INVOICE-CREATION'
    GROUP  BY l.batch_id
    HAVING COUNT(DISTINCT l.reference2) = 1
)
SELECT b.je_batch_id,
       b.batch_name,
       inv.invoice_num                                       AS invoice_number,
       h.je_header_id,
       h.period_name                                         AS old_period,
       TO_CHAR(h.default_effective_date,'YYYY-MM-DD')        AS old_date,
       TO_CHAR(NVL(inv.gl_date, inv.invoice_date),'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH') AS new_period,
       TO_CHAR(NVL(inv.gl_date, inv.invoice_date),'YYYY-MM-DD')                          AS new_date
FROM   batch_invoice bi
JOIN   rr_gl_journal_batches b   ON b.je_batch_id = bi.batch_id
JOIN   rr_gl_je_headers h        ON h.je_batch_id = bi.batch_id
JOIN   rr_raw_ap_invoices_all inv ON TO_CHAR(inv.invoice_id) = bi.invoice_ref
WHERE  NVL(inv.gl_date, inv.invoice_date) IS NOT NULL
AND (  h.period_name <> TO_CHAR(NVL(inv.gl_date, inv.invoice_date),'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH')
    OR TRUNC(h.default_effective_date) <> TRUNC(NVL(inv.gl_date, inv.invoice_date)) )
ORDER  BY b.je_batch_id;


-- =============================================================================
-- STEP 2 — UPDATE HEADERS (triggers must be disabled)
-- =============================================================================
UPDATE rr_gl_je_headers h
SET    (h.period_name, h.default_effective_date) = (
           SELECT TO_CHAR(NVL(inv.gl_date, inv.invoice_date),'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH'),
                  TRUNC(NVL(inv.gl_date, inv.invoice_date))
           FROM   rr_gl_je_lines_all l
           JOIN   rr_raw_ap_invoices_all inv ON TO_CHAR(inv.invoice_id) = l.reference2
           WHERE  l.je_header_id = h.je_header_id
           AND    l.reference5   = 'AP-INVOICE-CREATION'
           AND    ROWNUM = 1
       )
WHERE  h.je_header_id IN (
    SELECT h2.je_header_id
    FROM   rr_gl_je_headers h2
    JOIN   ( SELECT l.batch_id, MAX(l.reference2) AS invoice_ref
             FROM   rr_gl_je_lines_all l
             WHERE  l.reference5 = 'AP-INVOICE-CREATION'
             GROUP  BY l.batch_id
             HAVING COUNT(DISTINCT l.reference2) = 1 ) bi
      ON   bi.batch_id = h2.je_batch_id
    JOIN   rr_raw_ap_invoices_all inv ON TO_CHAR(inv.invoice_id) = bi.invoice_ref
    WHERE  NVL(inv.gl_date, inv.invoice_date) IS NOT NULL
    AND (  h2.period_name <> TO_CHAR(NVL(inv.gl_date, inv.invoice_date),'Mon-YY','NLS_DATE_LANGUAGE=ENGLISH')
        OR TRUNC(h2.default_effective_date) <> TRUNC(NVL(inv.gl_date, inv.invoice_date)) )
);
-- note the row count and compare with the dry run before COMMIT

-- =============================================================================
-- STEP 3 — UPDATE BATCHES (align DEFAULT_PERIOD_NAME with the fixed headers)
-- =============================================================================
UPDATE rr_gl_journal_batches b
SET    b.default_period_name = (
           SELECT MAX(h.period_name)
           FROM   rr_gl_je_headers h
           WHERE  h.je_batch_id = b.je_batch_id
       )
WHERE  b.je_batch_id IN (
    SELECT DISTINCT h.je_batch_id
    FROM   rr_gl_je_headers h
    WHERE  h.je_batch_id = b.je_batch_id
    AND    h.period_name <> NVL(b.default_period_name,'~')
)
AND    b.je_batch_id IN (
    SELECT l.batch_id FROM rr_gl_je_lines_all l WHERE l.reference5 = 'AP-INVOICE-CREATION'
);

COMMIT;

-- =============================================================================
-- STEP 4 — VERIFY: both queries must return ZERO rows
-- =============================================================================
-- 4a. AP invoice journals still disagreeing with their invoice date:
--    (re-run the STEP 1 query — expect no rows)
-- 4b. headers vs batches out of sync for these journals:
SELECT h.je_batch_id, h.period_name, b.default_period_name
FROM   rr_gl_je_headers h
JOIN   rr_gl_journal_batches b ON b.je_batch_id = h.je_batch_id
WHERE  h.je_batch_id IN (SELECT l.batch_id FROM rr_gl_je_lines_all l WHERE l.reference5 = 'AP-INVOICE-CREATION')
AND    h.period_name <> NVL(b.default_period_name,'~');

-- =============================================================================
-- STEP 5 — RE-ENABLE THE TRIGGERS (mandatory)
-- =============================================================================
-- ALTER TRIGGER trg_upd_audit_je_headers  ENABLE;
-- ALTER TRIGGER trg_upd_audit_je_batches  ENABLE;

-- =============================================================================
-- ROLLBACK (if ever needed): restore from the STEP 0 backups
--   UPDATE rr_gl_je_headers h SET (period_name, default_effective_date) =
--     (SELECT period_name, default_effective_date FROM rr_gl_je_headers_bk128 k
--       WHERE k.je_header_id = h.je_header_id)
--   WHERE h.je_header_id IN (SELECT je_header_id FROM rr_gl_je_headers_bk128);
--   (same pattern for batches from rr_gl_batches_bk128), then COMMIT.
-- =============================================================================
