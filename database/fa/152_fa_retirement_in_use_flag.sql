-- ============================================================
-- Patch 152: retirement also sets IN_USE_FLAG = 'NO'
--
-- Extends patch 151: the RR_FA_RETIREMENTS sync trigger now also
-- turns off RR_FA_ADDITIONS.IN_USE_FLAG when an asset is retired,
-- and the repair updates already-retired assets the same way.
--
-- Safe to run whether or not 151 was executed — the trigger is
-- CREATE OR REPLACE (this version supersedes 151's) and the repair
-- statements are idempotent.
--
-- RUN ORDER: after 150 (STATUS column). Run each statement separately
-- in APEX SQL Commands, or the whole file via SQL Workshop → SQL Scripts.
-- ============================================================

-- 1. Sync trigger v2: retirement row -> asset flags (retired + not in use)
CREATE OR REPLACE TRIGGER RR_FA_RETIREMENTS_FLAG_TRG
AFTER INSERT ON RR_FA_RETIREMENTS
FOR EACH ROW
BEGIN
    UPDATE RR_FA_ADDITIONS
       SET RETIRED_FLAG     = 'YES',
           IN_USE_FLAG      = 'NO',
           LAST_UPDATED_BY  = NVL(:NEW.CREATED_BY, 'RETIRE_TRG'),
           LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE TO_CHAR(ASSET_ID) = TO_CHAR(:NEW.ASSET_ID)
       AND (NVL(RETIRED_FLAG, 'NO') <> 'YES' OR NVL(IN_USE_FLAG, 'YES') <> 'NO');

    UPDATE RR_FA_BOOKS
       SET DATE_INEFFECTIVE = SYSDATE,
           RETIREMENT_ID    = :NEW.RETIREMENT_ID,
           LAST_UPDATED_BY  = NVL(:NEW.CREATED_BY, 'RETIRE_TRG'),
           LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE TO_CHAR(ASSET_ID) = TO_CHAR(:NEW.ASSET_ID)
       AND BOOK_TYPE_CODE    = NVL(:NEW.BOOK_TYPE_CODE, BOOK_TYPE_CODE)
       AND DATE_INEFFECTIVE IS NULL;
END;
/

-- 2a. Repair: flag already-retired assets (retired + not in use + STATUS via 150's trigger)
UPDATE RR_FA_ADDITIONS a
   SET a.RETIRED_FLAG     = 'YES',
       a.IN_USE_FLAG      = 'NO',
       a.LAST_UPDATED_BY  = 'RETIRE_FIX_152',
       a.LAST_UPDATE_DATE = SYSTIMESTAMP
 WHERE (NVL(a.RETIRED_FLAG, 'NO') <> 'YES' OR NVL(a.IN_USE_FLAG, 'YES') <> 'NO')
   AND EXISTS (SELECT 1 FROM RR_FA_RETIREMENTS r
                WHERE TO_CHAR(r.ASSET_ID) = TO_CHAR(a.ASSET_ID));

-- 2b. Repair: end-date the book rows of retired assets (no-op if 151 already ran)
UPDATE RR_FA_BOOKS b
   SET b.DATE_INEFFECTIVE = SYSDATE,
       b.LAST_UPDATED_BY  = 'RETIRE_FIX_152',
       b.LAST_UPDATE_DATE = SYSTIMESTAMP
 WHERE b.DATE_INEFFECTIVE IS NULL
   AND EXISTS (SELECT 1 FROM RR_FA_RETIREMENTS r
                WHERE TO_CHAR(r.ASSET_ID) = TO_CHAR(b.ASSET_ID)
                  AND r.BOOK_TYPE_CODE    = b.BOOK_TYPE_CODE);

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT a.ASSET_NUMBER, a.RETIRED_FLAG, a.IN_USE_FLAG, a.STATUS
--   FROM RR_FA_ADDITIONS a
--  WHERE EXISTS (SELECT 1 FROM RR_FA_RETIREMENTS r
--                 WHERE TO_CHAR(r.ASSET_ID) = TO_CHAR(a.ASSET_ID));
-- Expect RETIRED_FLAG = YES, IN_USE_FLAG = NO, STATUS = Retired.
--
-- Retired assets also disappear from GET fa/deprn-by-period automatically:
-- its query keeps only active book rows (b.DATE_INEFFECTIVE IS NULL).
