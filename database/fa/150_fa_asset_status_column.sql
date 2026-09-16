-- ============================================================
-- Patch 150: STATUS column on RR_FA_ADDITIONS ('Active' / 'Retired')
--
-- The retire handlers (06_fa_retire_adjust_handlers.sql and
-- 33_fa_retirement.sql) set RETIRED_FLAG = 'YES' but the asset row
-- had no readable STATUS. This patch:
--   1. Adds RR_FA_ADDITIONS.STATUS (default 'Active').
--   2. Backfills it from RETIRED_FLAG for existing rows.
--   3. Adds a trigger that derives STATUS from RETIRED_FLAG on every
--      insert/update — so BOTH retire handlers (and any future one)
--      stamp STATUS = 'Retired' automatically, with no handler changes.
--   4. Comments the column for the AI schema catalog.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each statement separately
--   (SQL Commands executes one statement at a time), or the whole file
--   via SQL Workshop → SQL Scripts.
-- ============================================================

-- 1. Column (ignore ORA-01430 if it already exists)
BEGIN
  EXECUTE IMMEDIATE q'[ALTER TABLE RR_FA_ADDITIONS ADD (STATUS VARCHAR2(30) DEFAULT 'Active')]';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF;
END;
/

-- 2. Backfill existing rows
UPDATE RR_FA_ADDITIONS
   SET STATUS = CASE WHEN NVL(RETIRED_FLAG, 'NO') = 'YES' THEN 'Retired' ELSE 'Active' END;
COMMIT;

-- 3. Keep STATUS in sync with RETIRED_FLAG from now on
CREATE OR REPLACE TRIGGER RR_FA_ADDITIONS_STATUS_TRG
BEFORE INSERT OR UPDATE ON RR_FA_ADDITIONS
FOR EACH ROW
BEGIN
    :NEW.STATUS := CASE WHEN NVL(:NEW.RETIRED_FLAG, 'NO') = 'YES' THEN 'Retired' ELSE 'Active' END;
END;
/

-- 4. AI catalog comment
COMMENT ON COLUMN RR_FA_ADDITIONS.STATUS IS
  'Asset status: Active or Retired. Derived from RETIRED_FLAG by trigger RR_FA_ADDITIONS_STATUS_TRG.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT STATUS, COUNT(*) FROM RR_FA_ADDITIONS GROUP BY STATUS;
-- Retire an asset, then:
-- SELECT ASSET_NUMBER, RETIRED_FLAG, STATUS FROM RR_FA_ADDITIONS WHERE RETIRED_FLAG = 'YES';
