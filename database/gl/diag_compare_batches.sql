-- ============================================================
-- DIAGNOSTIC: Compare batches 1000000190 vs 1000000195
-- Run in APEX SQL Workshop → SQL Commands
-- ============================================================

-- 1. Check what's stored in RR_GL_JE_HEADERS for both batches
SELECT
    h.JE_HEADER_ID,
    h.JE_BATCH_ID,
    h.BATCH_ID,
    h.NAME         AS JOURNAL_NAME,
    h.LEDGER_NAME,
    h.PERIOD_NAME,
    h.STATUS,
    h.CREATION_DATE
FROM RR_GL_JE_HEADERS h
WHERE h.JE_BATCH_ID IN (1000000190, 1000000195)
   OR h.BATCH_ID   IN (1000000190, 1000000195)
ORDER BY h.JE_BATCH_ID, h.BATCH_ID;


-- 2. Check what's stored in RR_GL_JOURNAL_BATCHES for both batches
SELECT
    b.BATCH_SYNC_ID,
    b.JE_BATCH_ID,
    b.BATCH_NAME,
    b.LEDGER_NAME,
    b.ACCOUNTING_PERIOD,
    b.STATUS,
    b.STATUS_MEANING,
    b.CREATION_DATE
FROM RR_GL_JOURNAL_BATCHES b
WHERE b.JE_BATCH_ID IN (1000000190, 1000000195)
ORDER BY b.JE_BATCH_ID;


-- 3. Check the JOIN that the search query uses
--    (BATCH_ID on the header vs JE_BATCH_ID on the batch)
SELECT
    h.JE_HEADER_ID,
    h.JE_BATCH_ID,
    h.BATCH_ID           AS H_BATCH_ID,
    h.LEDGER_NAME        AS H_LEDGER_NAME,
    h.PERIOD_NAME,
    b.JE_BATCH_ID        AS B_JE_BATCH_ID,
    b.LEDGER_NAME        AS B_LEDGER_NAME,
    b.STATUS_MEANING
FROM RR_GL_JE_HEADERS h
LEFT JOIN RR_GL_JOURNAL_BATCHES b ON b.JE_BATCH_ID = h.BATCH_ID   -- current (potentially wrong) join
WHERE (h.JE_BATCH_ID IN (1000000190, 1000000195)
    OR h.BATCH_ID    IN (1000000190, 1000000195))
ORDER BY h.JE_BATCH_ID;


-- 4. Same but using the corrected join (h.JE_BATCH_ID instead of h.BATCH_ID)
SELECT
    h.JE_HEADER_ID,
    h.JE_BATCH_ID,
    h.LEDGER_NAME        AS H_LEDGER_NAME,
    h.PERIOD_NAME,
    b.JE_BATCH_ID        AS B_JE_BATCH_ID,
    b.LEDGER_NAME        AS B_LEDGER_NAME,
    b.STATUS_MEANING
FROM RR_GL_JE_HEADERS h
LEFT JOIN RR_GL_JOURNAL_BATCHES b ON b.JE_BATCH_ID = h.JE_BATCH_ID  -- corrected join
WHERE (h.JE_BATCH_ID IN (1000000190, 1000000195)
    OR h.BATCH_ID    IN (1000000190, 1000000195))
ORDER BY h.JE_BATCH_ID;
