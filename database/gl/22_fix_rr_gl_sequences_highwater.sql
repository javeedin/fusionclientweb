-- =============================================================================
-- 22_FIX_RR_GL_SEQUENCES_HIGHWATER.SQL
--
-- Problem
-- -------
-- RR_INSERT_GL_JOURNALS_POST uses three sequences:
--   RR_GL_BATCH_SEQ  → l_batch_id  → inserted as JE_BATCH_ID + BATCH_SYNC_ID
--   RR_GL_HEADER_SEQ → l_header_id → inserted as JE_HEADER_ID in RR_GL_JE_HEADERS
--   RR_GL_LINE_SEQ   → l_line_id   → consumed (not used in INSERT, but advance anyway)
--
-- These sequences started at 1 and have been incrementing.  Oracle Fusion sync
-- also inserts rows into the SAME tables (RR_GL_JE_HEADERS, RR_GL_JOURNAL_BATCHES)
-- using its own Fusion IDs (e.g. 500102).  When the sequences reach those values
-- the locally-created journal gets the SAME JE_HEADER_ID as a Fusion-synced one →
-- the /gl/journals/:id/lines drill-down returns lines from both journals.
--
-- Fix
-- ---
-- DROP and RECREATE each sequence starting at:
--   GREATEST(current max ID in the target table, 1,000,000,000) + 1
--
-- 1,000,000,000 is the hard floor — well above the sub-million Fusion IDs
-- visible in this environment.  New local journals will have IDs ≥ 1,000,000,001.
--
-- DO NOT change RR_INSERT_GL_JOURNALS_POST — it is correct as-is.
--
-- Run in: APEX SQL Workshop > SQL Commands (as schema owner)
-- Run each block separately; check DBMS_OUTPUT for confirmation.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. RR_GL_HEADER_SEQ  (most critical — JE_HEADER_ID collision)
-- ---------------------------------------------------------------------------
DECLARE
  v_max NUMBER;
BEGIN
  SELECT GREATEST(NVL(MAX(JE_HEADER_ID), 0), 1000000000) + 1
    INTO v_max
    FROM RR_GL_JE_HEADERS;

  BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_GL_HEADER_SEQ';
    DBMS_OUTPUT.PUT_LINE('Dropped RR_GL_HEADER_SEQ');
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('RR_GL_HEADER_SEQ did not exist — creating fresh');
  END;

  EXECUTE IMMEDIATE
    'CREATE SEQUENCE RR_GL_HEADER_SEQ'
    || ' START WITH '  || v_max
    || ' INCREMENT BY 1'
    || ' NOCACHE NOCYCLE NOORDER';

  DBMS_OUTPUT.PUT_LINE('RR_GL_HEADER_SEQ created. Next JE_HEADER_ID = ' || v_max);
END;
/


-- ---------------------------------------------------------------------------
-- 2. RR_GL_BATCH_SEQ  (JE_BATCH_ID / BATCH_SYNC_ID collision)
-- ---------------------------------------------------------------------------
DECLARE
  v_max NUMBER;
BEGIN
  -- Check both column names the batch table uses
  SELECT GREATEST(
           NVL(MAX(JE_BATCH_ID),    0),
           NVL(MAX(BATCH_SYNC_ID),  0),
           1000000000
         ) + 1
    INTO v_max
    FROM RR_GL_JOURNAL_BATCHES;

  BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_GL_BATCH_SEQ';
    DBMS_OUTPUT.PUT_LINE('Dropped RR_GL_BATCH_SEQ');
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('RR_GL_BATCH_SEQ did not exist — creating fresh');
  END;

  EXECUTE IMMEDIATE
    'CREATE SEQUENCE RR_GL_BATCH_SEQ'
    || ' START WITH '  || v_max
    || ' INCREMENT BY 1'
    || ' NOCACHE NOCYCLE NOORDER';

  DBMS_OUTPUT.PUT_LINE('RR_GL_BATCH_SEQ created. Next JE_BATCH_ID = ' || v_max);
END;
/


-- ---------------------------------------------------------------------------
-- 3. RR_GL_LINE_SEQ  (advance past existing lines for completeness)
--    Note: l_line_id from this sequence is fetched in the procedure but
--    JE_LINE_NUMBER is actually l_line_count (sequential per header).
--    Still advance the sequence to avoid any future confusion.
-- ---------------------------------------------------------------------------
DECLARE
  v_max NUMBER;
BEGIN
  SELECT GREATEST(
           NVL((SELECT MAX(JE_LINE_NUMBER) FROM RR_GL_JE_LINES_ALL), 0),
           1000000000
         ) + 1
    INTO v_max
    FROM DUAL;

  BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_GL_LINE_SEQ';
    DBMS_OUTPUT.PUT_LINE('Dropped RR_GL_LINE_SEQ');
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('RR_GL_LINE_SEQ did not exist — creating fresh');
  END;

  EXECUTE IMMEDIATE
    'CREATE SEQUENCE RR_GL_LINE_SEQ'
    || ' START WITH '  || v_max
    || ' INCREMENT BY 1'
    || ' NOCACHE NOCYCLE NOORDER';

  DBMS_OUTPUT.PUT_LINE('RR_GL_LINE_SEQ created. Next value = ' || v_max);
END;
/


-- ---------------------------------------------------------------------------
-- 4. Verify — run after all three blocks above
-- ---------------------------------------------------------------------------
SELECT
  s.sequence_name,
  s.last_number                     AS next_value,
  s.increment_by,
  s.cache_size,
  s.cycle_flag
FROM user_sequences s
WHERE s.sequence_name IN ('RR_GL_HEADER_SEQ', 'RR_GL_BATCH_SEQ', 'RR_GL_LINE_SEQ')
ORDER BY s.sequence_name;


-- ---------------------------------------------------------------------------
-- 5. Current high-water marks (compare with next_value above)
-- ---------------------------------------------------------------------------
SELECT 'RR_GL_JE_HEADERS   MAX(JE_HEADER_ID)'  AS item, MAX(JE_HEADER_ID) AS value FROM RR_GL_JE_HEADERS
UNION ALL
SELECT 'RR_GL_JOURNAL_BATCHES MAX(JE_BATCH_ID)',   MAX(JE_BATCH_ID)   FROM RR_GL_JOURNAL_BATCHES
UNION ALL
SELECT 'RR_GL_JOURNAL_BATCHES MAX(BATCH_SYNC_ID)', MAX(BATCH_SYNC_ID) FROM RR_GL_JOURNAL_BATCHES
UNION ALL
SELECT 'RR_GL_JE_LINES_ALL MAX(JE_LINE_NUMBER)',   MAX(JE_LINE_NUMBER) FROM RR_GL_JE_LINES_ALL;
