-- =============================================================================
-- 23_FIX_SEQUENCES_FINAL.SQL
--
-- Fixes RR_GL_HEADER_SEQ, RR_GL_BATCH_SEQ, RR_GL_LINE_SEQ so that
-- RR_INSERT_GL_JOURNALS_POST generates JE_HEADER_IDs above 1,000,000,000
-- and never collides with Fusion-synced IDs.
--
-- Run ALL blocks in APEX SQL Workshop > SQL Commands, one at a time.
-- Enable DBMS Output to see confirmation messages.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — Diagnostic: see current state before changing anything
-- Run this first and note the output.
-- ---------------------------------------------------------------------------
SELECT
  s.sequence_name,
  s.last_number        AS next_value_will_be,
  s.increment_by,
  s.min_value,
  s.max_value,
  s.cache_size,
  s.cycle_flag
FROM user_sequences s
WHERE s.sequence_name IN (
  'RR_GL_HEADER_SEQ',
  'RR_GL_BATCH_SEQ',
  'RR_GL_LINE_SEQ',
  'SEQ_RR_GL_JE_HEADER_ID'   -- created by earlier script (21) - can be ignored
)
ORDER BY s.sequence_name;


-- ---------------------------------------------------------------------------
-- STEP 2 — Diagnostic: current high-water marks in the tables
-- ---------------------------------------------------------------------------
SELECT 'RR_GL_JE_HEADERS  MAX(JE_HEADER_ID)' AS label,
       NVL(MAX(JE_HEADER_ID), 0)              AS max_id
  FROM RR_GL_JE_HEADERS
UNION ALL
SELECT 'RR_GL_JOURNAL_BATCHES MAX(JE_BATCH_ID)',
       NVL(MAX(JE_BATCH_ID), 0)
  FROM RR_GL_JOURNAL_BATCHES
UNION ALL
SELECT 'RR_GL_JE_LINES_ALL MAX(JE_HEADER_ID) in lines',
       NVL(MAX(JE_HEADER_ID), 0)
  FROM RR_GL_JE_LINES_ALL;


-- ---------------------------------------------------------------------------
-- STEP 3 — Fix RR_GL_HEADER_SEQ  ← the one used by RR_INSERT_GL_JOURNALS_POST
--
-- After running this block, EVERY new JE_HEADER_ID from the procedure
-- will be >= 1,000,000,001 and cannot collide with Fusion data.
-- ---------------------------------------------------------------------------
DECLARE
  v_max NUMBER;
BEGIN
  -- Highest JE_HEADER_ID already in the table (local + Fusion-synced)
  SELECT GREATEST(NVL(MAX(JE_HEADER_ID), 0), 1000000000) + 1
    INTO v_max
    FROM RR_GL_JE_HEADERS;

  -- Drop the old sequence (ignore error if it doesn't exist yet)
  BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_GL_HEADER_SEQ';
    DBMS_OUTPUT.PUT_LINE('Dropped RR_GL_HEADER_SEQ');
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('RR_GL_HEADER_SEQ not found — will create fresh');
  END;

  -- Recreate starting above all existing IDs
  EXECUTE IMMEDIATE
    'CREATE SEQUENCE RR_GL_HEADER_SEQ'
    || ' START WITH '  || TO_CHAR(v_max)
    || ' INCREMENT BY 1'
    || ' NOCACHE'
    || ' NOCYCLE'
    || ' NOORDER';

  DBMS_OUTPUT.PUT_LINE('SUCCESS: RR_GL_HEADER_SEQ created. First NEXTVAL = ' || v_max);
  DBMS_OUTPUT.PUT_LINE('All new JE_HEADER_IDs will be >= ' || v_max);
END;
/


-- ---------------------------------------------------------------------------
-- STEP 4 — Fix RR_GL_BATCH_SEQ
-- ---------------------------------------------------------------------------
DECLARE
  v_max NUMBER;
BEGIN
  SELECT GREATEST(
           NVL(MAX(JE_BATCH_ID),   0),
           NVL(MAX(BATCH_SYNC_ID), 0),
           1000000000
         ) + 1
    INTO v_max
    FROM RR_GL_JOURNAL_BATCHES;

  BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_GL_BATCH_SEQ';
    DBMS_OUTPUT.PUT_LINE('Dropped RR_GL_BATCH_SEQ');
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('RR_GL_BATCH_SEQ not found — will create fresh');
  END;

  EXECUTE IMMEDIATE
    'CREATE SEQUENCE RR_GL_BATCH_SEQ'
    || ' START WITH '  || TO_CHAR(v_max)
    || ' INCREMENT BY 1'
    || ' NOCACHE'
    || ' NOCYCLE'
    || ' NOORDER';

  DBMS_OUTPUT.PUT_LINE('SUCCESS: RR_GL_BATCH_SEQ created. First NEXTVAL = ' || v_max);
END;
/


-- ---------------------------------------------------------------------------
-- STEP 5 — Fix RR_GL_LINE_SEQ
-- Note: l_line_id is fetched in the procedure but JE_LINE_NUMBER in the
-- INSERT actually uses l_line_count (sequential counter per header).
-- Still advance this sequence to stay consistent.
-- ---------------------------------------------------------------------------
DECLARE
  v_max NUMBER;
BEGIN
  SELECT GREATEST(NVL(MAX(JE_HEADER_ID), 0), 1000000000) + 1
    INTO v_max
    FROM RR_GL_JE_LINES_ALL;

  BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_GL_LINE_SEQ';
    DBMS_OUTPUT.PUT_LINE('Dropped RR_GL_LINE_SEQ');
  EXCEPTION
    WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('RR_GL_LINE_SEQ not found — will create fresh');
  END;

  EXECUTE IMMEDIATE
    'CREATE SEQUENCE RR_GL_LINE_SEQ'
    || ' START WITH '  || TO_CHAR(v_max)
    || ' INCREMENT BY 1'
    || ' NOCACHE'
    || ' NOCYCLE'
    || ' NOORDER';

  DBMS_OUTPUT.PUT_LINE('SUCCESS: RR_GL_LINE_SEQ created. First NEXTVAL = ' || v_max);
END;
/


-- ---------------------------------------------------------------------------
-- STEP 6 — Verify: confirm the sequences now start at the right values
-- Run after all three fix blocks above.
-- The next_value_will_be column should be >= 1,000,000,001 for all three.
-- ---------------------------------------------------------------------------
SELECT
  s.sequence_name,
  s.last_number   AS next_value_will_be,
  CASE WHEN s.last_number >= 1000000001 THEN 'OK — safe range'
       ELSE '*** STILL TOO LOW — rerun fix block ***'
  END             AS status
FROM user_sequences s
WHERE s.sequence_name IN ('RR_GL_HEADER_SEQ', 'RR_GL_BATCH_SEQ', 'RR_GL_LINE_SEQ')
ORDER BY s.sequence_name;


-- ---------------------------------------------------------------------------
-- STEP 7 — Quick smoke-test: call NEXTVAL once and confirm the value
-- This consumes one value from each sequence.
-- ---------------------------------------------------------------------------
SELECT
  RR_GL_HEADER_SEQ.NEXTVAL AS header_seq_next,
  RR_GL_BATCH_SEQ.NEXTVAL  AS batch_seq_next
FROM DUAL;
