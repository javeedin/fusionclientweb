-- =============================================================================
-- 26_FA_DISTRIBUTION_SEQ.SQL
-- Sequence for RR_FA_DISTRIBUTION_HISTORY.DISTRIBUTION_ID
--
-- Run this ONCE to create the sequence.
-- After creating, both 05_fa_create_asset_handler.sql and
-- 22_fa_deprn_pkg.sql use RR_FA_DISTRIBUTION_ID_SEQ.NEXTVAL
-- instead of MAX(DISTRIBUTION_ID)+1.
--
-- Start value: set to MAX(DISTRIBUTION_ID)+1 from existing data,
-- or 1 if the table is empty.
-- =============================================================================

-- Drop if already exists (safe re-run)
BEGIN
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_FA_DISTRIBUTION_ID_SEQ';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Create sequence starting after the current max to avoid gaps/conflicts
DECLARE
    v_start NUMBER;
BEGIN
    SELECT NVL(MAX(TO_NUMBER(DISTRIBUTION_ID)), 0) + 1
    INTO   v_start
    FROM   RR_FA_DISTRIBUTION_HISTORY;

    EXECUTE IMMEDIATE
        'CREATE SEQUENCE RR_FA_DISTRIBUTION_ID_SEQ '
     || 'START WITH '  || v_start || ' '
     || 'INCREMENT BY 1 '
     || 'NOCACHE '
     || 'NOCYCLE';
END;
/
