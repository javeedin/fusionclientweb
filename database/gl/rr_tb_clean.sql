-- ============================================================
-- TRIAL BALANCE — Clean Standalone SQL
-- ============================================================
-- Calculates: Opening | Debit | Credit | Closing
-- for any ledger + period directly from journal lines.
--
-- Parameters (set before running):
--   :ledger_name   REQUIRED  e.g.  'BUIMERC LEDGER'
--   :period_name   optional  e.g.  'Sep-23'  (Mon-YY) — NULL = all periods
--   :period_year   optional  e.g.  '2024'    (fiscal year as text) — NULL = all years
--   :company       optional  e.g.  '100'     (segment 1)   — NULL = all companies
--   :currency_code optional  e.g.  'AED'                  — NULL = all currencies
--
-- KEY DESIGN:
--   The account list is driven from RR_VALUE_SET_VALUES (the master).
--   Every account that ever had activity is shown in EVERY period —
--   even if that period has zero PTD — so the opening balance carries
--   forward correctly:
--     Jul-23  closing = 100
--     Aug-23  opening = 100 , debit = 0 , credit = 0 , closing = 100
--
-- How opening balance works:
--   Balance Sheet (A / L / O): carries forward across fiscal years
--   P&L         (R / E):       resets to zero each fiscal year
-- ============================================================

WITH

-- ────────────────────────────────────────────────────────────
-- Step 1 — Account master
-- Source of ACCOUNT_TYPE (A/L/O/R/E) and ACCOUNT_DESC.
-- Only accounts listed here will appear in the trial balance.
-- ────────────────────────────────────────────────────────────
accounts AS (
    SELECT
        VALUE           AS ACCOUNT,
        ACCOUNT_TYPE,
        DESCRIPTION     AS ACCOUNT_DESC
    FROM RR_VALUE_SET_VALUES
    WHERE VALUE_SET_CODE = 'BUIMERC_FIN_GLB_COA_ACCOUNT'
),

-- ────────────────────────────────────────────────────────────
-- Step 2 — All distinct account combinations ever used
--          (the "account spine")
--
-- INNER JOIN to accounts master ensures only valid combinations
-- (whose segment-4 exists in RR_VALUE_SET_VALUES) are included.
-- ────────────────────────────────────────────────────────────
all_combos AS (
    SELECT DISTINCT
        hdr.LEDGER_NAME,
        lin.ACCOUNT_COMBINATION,
        NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)  AS CURRENCY_CODE
    FROM RR_GL_JE_LINES_ALL  lin
    JOIN RR_GL_JE_HEADERS    hdr
      ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
    JOIN accounts            acc
      ON acc.ACCOUNT = TRIM(REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,4))
    WHERE hdr.LEDGER_NAME         = :ledger_name
      AND lin.ACCOUNT_COMBINATION IS NOT NULL
      AND (:company IS NULL OR
           TRIM(REGEXP_SUBSTR(lin.ACCOUNT_COMBINATION,'[^-]+',1,1)) = :company)
      AND (:currency_code IS NULL OR
           NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE) = :currency_code)
),

-- ────────────────────────────────────────────────────────────
-- Step 3 — All distinct periods for this ledger
-- ────────────────────────────────────────────────────────────
all_periods AS (
    SELECT DISTINCT PERIOD_NAME
    FROM RR_GL_JE_HEADERS
    WHERE LEDGER_NAME = :ledger_name
      AND PERIOD_NAME IS NOT NULL
),

-- ────────────────────────────────────────────────────────────
-- Step 4 — Actual PTD activity per (combination, period)
-- ────────────────────────────────────────────────────────────
ptd_actual AS (
    SELECT
        hdr.LEDGER_NAME,
        hdr.PERIOD_NAME,
        NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)  AS CURRENCY_CODE,
        lin.ACCOUNT_COMBINATION,
        SUM(NVL(lin.ACCOUNTED_DR, 0))                     AS PTD_DR,
        SUM(NVL(lin.ACCOUNTED_CR, 0))                     AS PTD_CR
    FROM RR_GL_JE_LINES_ALL  lin
    JOIN RR_GL_JE_HEADERS    hdr
      ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
    WHERE hdr.LEDGER_NAME         = :ledger_name
      AND hdr.PERIOD_NAME         IS NOT NULL
      AND lin.ACCOUNT_COMBINATION IS NOT NULL
    GROUP BY
        hdr.LEDGER_NAME,
        hdr.PERIOD_NAME,
        NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE),
        lin.ACCOUNT_COMBINATION
),

-- ────────────────────────────────────────────────────────────
-- Step 5 — Dense PTD: every combination × every period
--
-- CROSS JOIN creates one row for every (combination, period).
-- LEFT JOIN fills in actual PTD where activity exists.
-- NVL gives 0 for periods with no activity.
--
-- This is the key step that lets an account appear in Aug-23
-- with opening=100, debit=0, credit=0, closing=100 even when
-- there are no Aug-23 journal lines for it.
-- ────────────────────────────────────────────────────────────
ptd AS (
    SELECT
        ac.LEDGER_NAME,
        ap.PERIOD_NAME,
        ac.CURRENCY_CODE,
        ac.ACCOUNT_COMBINATION,
        NVL(pa.PTD_DR, 0)  AS PTD_DR,
        NVL(pa.PTD_CR, 0)  AS PTD_CR
    FROM       all_combos  ac
    CROSS JOIN all_periods ap
    LEFT JOIN  ptd_actual  pa
           ON pa.LEDGER_NAME         = ac.LEDGER_NAME
          AND pa.ACCOUNT_COMBINATION = ac.ACCOUNT_COMBINATION
          AND pa.CURRENCY_CODE       = ac.CURRENCY_CODE
          AND pa.PERIOD_NAME         = ap.PERIOD_NAME
),

-- ────────────────────────────────────────────────────────────
-- Step 6 — Enrich with fiscal calendar and account details
-- ────────────────────────────────────────────────────────────
enriched AS (
    SELECT
        p.LEDGER_NAME,
        p.PERIOD_NAME,
        p.CURRENCY_CODE,
        p.ACCOUNT_COMBINATION,
        TRIM(REGEXP_SUBSTR(p.ACCOUNT_COMBINATION,'[^-]+',1,1))  AS COMPANY,
        acc.ACCOUNT,
        acc.ACCOUNT_TYPE,
        acc.ACCOUNT_DESC,

        -- Fiscal year: from view (one row per period guaranteed by GROUP BY), else fallback
        CASE
            WHEN fp.FISCAL_YEAR IS NOT NULL
            THEN TO_NUMBER(fp.FISCAL_YEAR)
            ELSE EXTRACT(YEAR  FROM TO_DATE('01-'||p.PERIOD_NAME,'DD-Mon-RR'))
        END  AS FISCAL_YEAR,

        -- Fiscal period (1 = first month of fiscal year)
        CASE
            WHEN fp.FISCAL_PERIOD IS NOT NULL
            THEN TO_NUMBER(fp.FISCAL_PERIOD)
            ELSE EXTRACT(MONTH FROM TO_DATE('01-'||p.PERIOD_NAME,'DD-Mon-RR'))
        END  AS FISCAL_PERIOD,

        p.PTD_DR,
        p.PTD_CR,
        p.PTD_DR - p.PTD_CR  AS PTD_NET

    FROM ptd p
    JOIN accounts acc
      ON acc.ACCOUNT = TRIM(REGEXP_SUBSTR(p.ACCOUNT_COMBINATION,'[^-]+',1,4))
    -- Fiscal calendar collapsed to one row per period (prevents fan-out)
    LEFT JOIN (
        SELECT
            PERIOD_NAME,
            MAX(TO_NUMBER(FISCAL_YEAR))   AS FISCAL_YEAR,
            MAX(TO_NUMBER(FISCAL_PERIOD)) AS FISCAL_PERIOD
        FROM RR_V_GL_FISCAL_PERIODS
        WHERE TO_CHAR(APPLICATION) = 'GL'
          AND TO_CHAR(ADJ_FLAG)    = 'N'
        GROUP BY PERIOD_NAME
    ) fp ON fp.PERIOD_NAME = p.PERIOD_NAME
),

-- ────────────────────────────────────────────────────────────
-- Step 7 — Opening balance via window functions
-- ────────────────────────────────────────────────────────────
calc AS (
    SELECT
        e.*,
        -- B/S: cumulative net of ALL history before this period
        NVL(SUM(e.PTD_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE
            ORDER BY (e.FISCAL_YEAR * 100 + e.FISCAL_PERIOD)
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS BS_OPENING,
        -- P&L: cumulative net within the same fiscal year before this period
        NVL(SUM(e.PTD_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE,
                         e.FISCAL_YEAR
            ORDER BY e.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS PL_OPENING
    FROM enriched e
)

-- ────────────────────────────────────────────────────────────
-- Final — Filter and output
--
-- Rows are excluded only when opening AND closing AND PTD are
-- all zero (account had no historical balance and no current
-- activity — typically periods before the first ever entry).
-- ────────────────────────────────────────────────────────────
SELECT
    c.LEDGER_NAME,
    c.PERIOD_NAME,
    c.FISCAL_YEAR,
    c.FISCAL_PERIOD,
    c.CURRENCY_CODE,
    c.ACCOUNT_COMBINATION,
    c.COMPANY,
    c.ACCOUNT,
    c.ACCOUNT_TYPE,
    c.ACCOUNT_DESC,

    CASE WHEN c.ACCOUNT_TYPE IN ('A','L','O')
         THEN c.BS_OPENING ELSE c.PL_OPENING END        AS OPENING,

    c.PTD_DR                                            AS DEBIT,
    c.PTD_CR                                            AS CREDIT,

    CASE WHEN c.ACCOUNT_TYPE IN ('A','L','O')
         THEN c.BS_OPENING + c.PTD_NET
         ELSE c.PL_OPENING + c.PTD_NET END              AS CLOSING

FROM calc c
WHERE (:period_name    IS NULL OR c.PERIOD_NAME          = :period_name)
  AND (:period_year    IS NULL OR TO_CHAR(c.FISCAL_YEAR) = :period_year)
  AND (:company        IS NULL OR c.COMPANY              = :company)
  AND (:currency_code  IS NULL OR c.CURRENCY_CODE        = :currency_code)
  -- Suppress fully-zero rows (no opening, no activity)
  AND (
      CASE WHEN c.ACCOUNT_TYPE IN ('A','L','O') THEN c.BS_OPENING ELSE c.PL_OPENING END <> 0
      OR c.PTD_DR <> 0
      OR c.PTD_CR <> 0
  )
ORDER BY
    c.FISCAL_YEAR,
    c.FISCAL_PERIOD,
    CASE c.ACCOUNT_TYPE
        WHEN 'A' THEN 1 WHEN 'L' THEN 2 WHEN 'O' THEN 3
        WHEN 'R' THEN 4 WHEN 'E' THEN 5 ELSE 6
    END,
    c.ACCOUNT,
    c.ACCOUNT_COMBINATION,
    c.CURRENCY_CODE
;
