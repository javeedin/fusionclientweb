-- ============================================================
-- Patch 151: keep the asset row in sync when a retirement is created
--
-- Symptom: asset 100006 was retired (row in RR_FA_RETIREMENTS) but
-- Manage Assets still showed it Active. The assets list derives
-- Retired from RR_FA_ADDITIONS.RETIRED_FLAG / the active RR_FA_BOOKS
-- row, and the deployed retirement flow updated only RR_FA_RETIREMENTS.
--
-- This patch makes the sync independent of any handler version:
--   1. Trigger on RR_FA_RETIREMENTS: every new retirement immediately
--      sets RR_FA_ADDITIONS.RETIRED_FLAG = 'YES' and end-dates the
--      asset's RR_FA_BOOKS row. (The STATUS column from patch 150 is
--      then stamped 'Retired' by its own trigger.)
--   2. One-time repair: applies the same updates for assets that were
--      already retired but never flagged.
--
-- RUN ORDER: run 150_fa_asset_status_column.sql first, then this file.
--   APEX SQL Workshop → SQL Commands — run each statement separately,
--   or the whole file via SQL Workshop → SQL Scripts.
-- ============================================================

-- 1. Sync trigger: retirement row -> asset flags
--    (ASSET_ID columns are compared via TO_CHAR because some FA tables
--     store ids as VARCHAR2)
CREATE OR REPLACE TRIGGER RR_FA_RETIREMENTS_FLAG_TRG
AFTER INSERT ON RR_FA_RETIREMENTS
FOR EACH ROW
BEGIN
    UPDATE RR_FA_ADDITIONS
       SET RETIRED_FLAG     = 'YES',
           LAST_UPDATED_BY  = NVL(:NEW.CREATED_BY, 'RETIRE_TRG'),
           LAST_UPDATE_DATE = SYSTIMESTAMP
     WHERE TO_CHAR(ASSET_ID) = TO_CHAR(:NEW.ASSET_ID)
       AND NVL(RETIRED_FLAG, 'NO') <> 'YES';

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

-- 2a. Repair: flag assets that already have a retirement but were left Active
UPDATE RR_FA_ADDITIONS a
   SET a.RETIRED_FLAG     = 'YES',
       a.LAST_UPDATED_BY  = 'RETIRE_FIX_151',
       a.LAST_UPDATE_DATE = SYSTIMESTAMP
 WHERE NVL(a.RETIRED_FLAG, 'NO') <> 'YES'
   AND EXISTS (SELECT 1 FROM RR_FA_RETIREMENTS r
                WHERE TO_CHAR(r.ASSET_ID) = TO_CHAR(a.ASSET_ID));

-- 2b. Repair: end-date the book rows of those retired assets
UPDATE RR_FA_BOOKS b
   SET b.DATE_INEFFECTIVE = SYSDATE,
       b.LAST_UPDATED_BY  = 'RETIRE_FIX_151',
       b.LAST_UPDATE_DATE = SYSTIMESTAMP
 WHERE b.DATE_INEFFECTIVE IS NULL
   AND EXISTS (SELECT 1 FROM RR_FA_RETIREMENTS r
                WHERE TO_CHAR(r.ASSET_ID) = TO_CHAR(b.ASSET_ID)
                  AND r.BOOK_TYPE_CODE    = b.BOOK_TYPE_CODE);

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT a.ASSET_NUMBER, a.RETIRED_FLAG, a.STATUS
--   FROM RR_FA_ADDITIONS a
--  WHERE EXISTS (SELECT 1 FROM RR_FA_RETIREMENTS r
--                 WHERE TO_CHAR(r.ASSET_ID) = TO_CHAR(a.ASSET_ID));
-- Expect RETIRED_FLAG = YES and STATUS = Retired for all rows (incl. 100006).
