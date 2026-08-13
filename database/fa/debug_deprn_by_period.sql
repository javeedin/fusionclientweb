-- =============================================================================
-- DEBUG: why does GET fa/deprn-by-period?periodName=Mar-26 return nothing?
-- Set the two values below, then run each query and read the notes.
-- =============================================================================
--   BOOK   = 'BUIMERC ASSET BOOK'
--   PERIOD = 'Mar-26'
-- =============================================================================

-- 1) EXACTLY what the API runs to turn the name into a period counter.
--    If this is NULL, the API returns "provide ... a valid periodName".
SELECT MAX(PERIOD_COUNTER) AS resolved_counter
FROM   RR_FA_DEPRN_PERIODS
WHERE  BOOK_TYPE_CODE = 'BUIMERC ASSET BOOK'
AND    UPPER(PERIOD_NAME) = UPPER('Mar-26');


-- 2) Every period name that exists for this book. The brackets + length expose
--    trailing/leading spaces or a different format ('MAR-26', 'Mar-2026', 'March-26').
SELECT PERIOD_COUNTER,
       PERIOD_NAME,
       '[' || PERIOD_NAME || ']'          AS name_bracketed,
       LENGTH(PERIOD_NAME)                AS name_len,
       FISCAL_YEAR
FROM   RR_FA_DEPRN_PERIODS
WHERE  BOOK_TYPE_CODE = 'BUIMERC ASSET BOOK'
ORDER  BY PERIOD_COUNTER;


-- 3) Anything that looks like March (independent of exact spelling).
SELECT PERIOD_COUNTER, PERIOD_NAME, FISCAL_YEAR
FROM   RR_FA_DEPRN_PERIODS
WHERE  BOOK_TYPE_CODE = 'BUIMERC ASSET BOOK'
AND    UPPER(PERIOD_NAME) LIKE 'MAR%';


-- 4) Where the ACTUAL March depreciation lives (detail table) and under which
--    period counter. This is the "data is there" you are seeing.
SELECT dd.PERIOD_COUNTER,
       COUNT(*)                    AS detail_rows,
       COUNT(DISTINCT dd.ASSET_ID) AS assets,
       SUM(dd.DEPRN_AMOUNT)        AS total_deprn
FROM   RR_FA_DEPRN_DETAIL dd
WHERE  dd.BOOK_TYPE_CODE = 'BUIMERC ASSET BOOK'
GROUP  BY dd.PERIOD_COUNTER
ORDER  BY dd.PERIOD_COUNTER;


-- 5) THE SMOKING GUN: for each counter that HAS detail data, does a matching
--    row exist in RR_FA_DEPRN_PERIODS?  A NULL period_name_in_calendar means the
--    detail data exists but the calendar row is missing -> name lookup fails.
SELECT dd.PERIOD_COUNTER,
       COUNT(*) AS detail_rows,
       (SELECT MIN(p.PERIOD_NAME)
          FROM RR_FA_DEPRN_PERIODS p
         WHERE p.BOOK_TYPE_CODE = dd.BOOK_TYPE_CODE
           AND p.PERIOD_COUNTER = dd.PERIOD_COUNTER) AS period_name_in_calendar
FROM   RR_FA_DEPRN_DETAIL dd
WHERE  dd.BOOK_TYPE_CODE = 'BUIMERC ASSET BOOK'
GROUP  BY dd.PERIOD_COUNTER, dd.BOOK_TYPE_CODE
ORDER  BY dd.PERIOD_COUNTER;


-- 6) WORKAROUND / PROOF: call the report logic by COUNTER instead of name.
--    Put the March counter from query 4/5 here (example uses 446).
--    If rows come back, the ONLY problem is the name->counter lookup in step 1.
--    (You can also hit the API directly:
--       GET fa/deprn-by-period?bookTypeCode=BUIMERC ASSET BOOK&periodCounter=446 )
SELECT a.ASSET_NUMBER, a.DESCRIPTION,
       SUM(dd.DEPRN_AMOUNT) AS deprn_amount
FROM   RR_FA_DEPRN_DETAIL dd
JOIN   RR_FA_ADDITIONS a ON a.ASSET_ID = dd.ASSET_ID
WHERE  dd.BOOK_TYPE_CODE = 'BUIMERC ASSET BOOK'
AND    dd.PERIOD_COUNTER = 446            -- <-- replace with March counter
GROUP  BY a.ASSET_NUMBER, a.DESCRIPTION
ORDER  BY a.ASSET_NUMBER;
