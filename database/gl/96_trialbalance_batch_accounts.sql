-- ============================================================
-- Trial Balance — batch accounts support
-- Adds an ORDS handler that accepts a comma-separated list of
-- accounts via the "accounts" parameter so the frontend can
-- fetch opening balances for up to 30 accounts in one call
-- instead of N individual calls.
--
-- URL: /rr-trialbalance/standard?ledger_name=X&period_name=X&accounts=1001,1002,1003
-- ============================================================

-- The existing ORDS handler for /rr-trialbalance/standard should
-- be modified to also handle the "accounts" (plural) parameter.
--
-- In the ORDS PL/SQL source, replace the WHERE clause filter for
-- the account segment from:
--
--   AND (:account IS NULL OR t.account = :account)
--
-- With:
--
--   AND (
--     (:account IS NULL AND :accounts IS NULL)
--     OR (:account IS NOT NULL AND t.account = :account)
--     OR (:accounts IS NOT NULL AND t.account IN (
--           SELECT TRIM(REGEXP_SUBSTR(:accounts, '[^,]+', 1, LEVEL))
--           FROM DUAL
--           CONNECT BY LEVEL <= REGEXP_COUNT(:accounts, ',') + 1
--       ))
--   )
--
-- Register the new bind variable "accounts" in the ORDS handler
-- with source type "URI" and data type VARCHAR2.
--
-- Example full WHERE clause (adapt to your view/table names):
/*
WHERE 1=1
  AND t.ledger_name     = :ledger_name
  AND t.period_name     = :period_name
  AND (:company         IS NULL OR t.company      = :company)
  AND (:lob             IS NULL OR t.lob          = :lob)
  AND (:department      IS NULL OR t.department   = :department)
  AND (
    (:account  IS NULL AND :accounts IS NULL)
    OR (:account  IS NOT NULL AND t.account = :account)
    OR (:accounts IS NOT NULL AND t.account IN (
          SELECT TRIM(REGEXP_SUBSTR(:accounts, '[^,]+', 1, LEVEL))
          FROM DUAL
          CONNECT BY LEVEL <= REGEXP_COUNT(:accounts, ',') + 1
        ))
  )
*/

-- ── Alternative: create a helper function for cleaner SQL ────────────────────
CREATE OR REPLACE FUNCTION rr_split_csv (p_csv IN VARCHAR2)
  RETURN SYS.ODCIVARCHAR2LIST PIPELINED
AS
  l_str VARCHAR2(32767) := p_csv || ',';
  l_pos PLS_INTEGER;
BEGIN
  LOOP
    l_pos := INSTR(l_str, ',');
    EXIT WHEN l_pos = 0;
    PIPE ROW(TRIM(SUBSTR(l_str, 1, l_pos - 1)));
    l_str := SUBSTR(l_str, l_pos + 1);
  END LOOP;
END rr_split_csv;
/

-- Then use in WHERE:
-- AND (:accounts IS NULL OR t.account IN (SELECT * FROM TABLE(rr_split_csv(:accounts))))
