-- ============================================================
-- RR_V_STANDARD_TB — Oracle view wrapper for the trial balance
-- ============================================================
-- Returns Opening | Debit | Credit | Closing for every
-- (ledger, period, account_combination, currency) in both
-- Accounted (functional) and Entered (transaction) currency.
--
-- No bind variables — filter on the view:
--   SELECT * FROM RR_V_STANDARD_TB
--   WHERE LEDGER_NAME    = 'BUIMERC LEDGER'
--     AND PERIOD_NAME    = 'Sep-23'       -- optional
--     AND FISCAL_YEAR    = 2024           -- optional
--     AND COMPANY        = '100'          -- optional
--     AND CURRENCY_CODE  = 'AED'          -- optional
--   ORDER BY FISCAL_YEAR, FISCAL_PERIOD, ACCOUNT;
--
-- KEY DIFFERENCES vs parameterized SQL:
--   1. Bind variables removed — filtering is the caller's job.
--   2. all_periods now SELECT DISTINCT LEDGER_NAME, PERIOD_NAME
--      (previously filtered to one ledger).
--   3. The CROSS JOIN becomes JOIN ON LEDGER_NAME so that each
--      ledger's combos are only paired with that same ledger's
--      periods — not with periods from every other ledger.
--   4. ORDER BY removed (invalid in a plain Oracle view;
--      callers can add their own ORDER BY).
-- ============================================================

CREATE OR REPLACE VIEW RR_V_STANDARD_TB AS

WITH

-- ────────────────────────────────────────────────────────────
-- Step 1 — Account master (ACCOUNT_TYPE + ACCOUNT_DESC)
-- Used for enrichment only; accounts NOT in this list still
-- appear in the TB (see all_combos LEFT JOIN below).
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
--          (the "account spine", per ledger)
--
-- LEFT JOIN to accounts master: ALL combinations from journal
-- lines appear, even if segment-4 is not yet in the value set.
-- account_type defaults to 'E' (Expense) for unknown accounts.
-- ────────────────────────────────────────────────────────────
all_combos AS (
    SELECT DISTINCT
        hdr.LEDGER_NAME,
        lin.ACCOUNT_COMBINATION,
        NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)  AS CURRENCY_CODE
    FROM RR_GL_JE_LINES_ALL  lin
    JOIN RR_GL_JE_HEADERS    hdr
      ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
    WHERE lin.ACCOUNT_COMBINATION IS NOT NULL
),

-- ────────────────────────────────────────────────────────────
-- Step 3 — All distinct periods per ledger
--
-- Pulled from the fiscal calendar (RR_V_GL_FISCAL_PERIODS) so
-- that periods with NO journal activity (e.g. May-26) are still
-- included in the dense grid. Each ledger is paired with every
-- calendar period via a CROSS JOIN on the distinct ledger list.
-- ────────────────────────────────────────────────────────────
all_periods AS (
    SELECT DISTINCT
        l.LEDGER_NAME,
        fp.PERIOD_NAME
    FROM (
        SELECT DISTINCT LEDGER_NAME
        FROM RR_GL_JE_HEADERS
        WHERE LEDGER_NAME IS NOT NULL
    ) l
    CROSS JOIN (
        SELECT DISTINCT PERIOD_NAME
        FROM RR_V_GL_FISCAL_PERIODS
        WHERE TO_CHAR(APPLICATION) = 'GL'
          AND TO_CHAR(ADJ_FLAG)    = 'N'
          AND PERIOD_NAME          IS NOT NULL
    ) fp
),

-- ────────────────────────────────────────────────────────────
-- Step 4 — Actual PTD activity per (ledger, combination, period)
--          Both Accounted (functional) and Entered (transaction)
-- ────────────────────────────────────────────────────────────
ptd_actual AS (
    SELECT
        hdr.LEDGER_NAME,
        hdr.PERIOD_NAME,
        NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)  AS CURRENCY_CODE,
        lin.ACCOUNT_COMBINATION,
        SUM(NVL(lin.ACCOUNTED_DR, 0))                     AS PTD_DR,
        SUM(NVL(lin.ACCOUNTED_CR, 0))                     AS PTD_CR,
        SUM(NVL(lin.ENTERED_DR,   0))                     AS PTD_ENTERED_DR,
        SUM(NVL(lin.ENTERED_CR,   0))                     AS PTD_ENTERED_CR
    FROM RR_GL_JE_LINES_ALL  lin
    JOIN RR_GL_JE_HEADERS    hdr
      ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
    WHERE hdr.PERIOD_NAME         IS NOT NULL
      AND lin.ACCOUNT_COMBINATION IS NOT NULL
    GROUP BY
        hdr.LEDGER_NAME,
        hdr.PERIOD_NAME,
        NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE),
        lin.ACCOUNT_COMBINATION
),

-- ────────────────────────────────────────────────────────────
-- Step 5 — Dense PTD: every combination × every period
--          (within the same ledger)
--
-- JOIN on LEDGER_NAME (not CROSS JOIN) ensures combos from
-- ledger A are only paired with ledger A's periods, not with
-- periods from ledger B or C.
-- LEFT JOIN fills in actual PTD where activity exists; NVL
-- gives 0 for periods with no activity — so an account with
-- Jul-23 closing=100 and no Aug-23 lines still appears in
-- Aug-23 as opening=100, debit=0, credit=0, closing=100.
-- ────────────────────────────────────────────────────────────
ptd AS (
    SELECT
        ac.LEDGER_NAME,
        ap.PERIOD_NAME,
        ac.CURRENCY_CODE,
        ac.ACCOUNT_COMBINATION,
        NVL(pa.PTD_DR,         0)  AS PTD_DR,
        NVL(pa.PTD_CR,         0)  AS PTD_CR,
        NVL(pa.PTD_ENTERED_DR, 0)  AS PTD_ENTERED_DR,
        NVL(pa.PTD_ENTERED_CR, 0)  AS PTD_ENTERED_CR
    FROM       all_combos  ac
    JOIN       all_periods ap  ON ap.LEDGER_NAME = ac.LEDGER_NAME
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
        TRIM(REGEXP_SUBSTR(p.ACCOUNT_COMBINATION,'[^-]+',1,1))      AS COMPANY,
        NVL(acc.ACCOUNT,      TRIM(REGEXP_SUBSTR(p.ACCOUNT_COMBINATION,'[^-]+',1,4)))  AS ACCOUNT,
        NVL(acc.ACCOUNT_TYPE, 'E')                                   AS ACCOUNT_TYPE,
        acc.ACCOUNT_DESC,

        -- Fiscal year: from fiscal calendar view (collapsed to 1 row per period), else fallback
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
        p.PTD_DR - p.PTD_CR          AS PTD_NET,
        p.PTD_ENTERED_DR,
        p.PTD_ENTERED_CR,
        p.PTD_ENTERED_DR - p.PTD_ENTERED_CR  AS PTD_ENTERED_NET

    FROM ptd p
    LEFT JOIN accounts acc
      ON acc.ACCOUNT = TRIM(REGEXP_SUBSTR(p.ACCOUNT_COMBINATION,'[^-]+',1,4))
    -- Collapse fiscal calendar to one row per PERIOD_NAME to prevent fan-out
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
-- Step 7 — PTD opening balance via window functions
-- ────────────────────────────────────────────────────────────
calc AS (
    SELECT
        e.*,
        -- B/S (A/L/O): cumulative net of ALL history before this period
        -- Carries forward across fiscal years — no FISCAL_YEAR in PARTITION
        NVL(SUM(e.PTD_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE
            ORDER BY (e.FISCAL_YEAR * 100 + e.FISCAL_PERIOD)
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS BS_OPENING,
        -- P&L (R/E): cumulative net within the SAME fiscal year before this period
        -- Resets to zero at the start of each fiscal year
        NVL(SUM(e.PTD_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE,
                         e.FISCAL_YEAR
            ORDER BY e.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS PL_OPENING,
        -- Entered currency equivalents (same partition logic)
        NVL(SUM(e.PTD_ENTERED_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE
            ORDER BY (e.FISCAL_YEAR * 100 + e.FISCAL_PERIOD)
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS BS_ENTERED_OPENING,
        NVL(SUM(e.PTD_ENTERED_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE,
                         e.FISCAL_YEAR
            ORDER BY e.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS PL_ENTERED_OPENING
    FROM enriched e
),

-- ────────────────────────────────────────────────────────────
-- Step 8 — YTD columns via window functions
--
-- YTD Opening:
--   B/S → BS_OPENING at the first period of the fiscal year
--         (balance carried in from prior fiscal year; fixed for the year)
--   P&L → always 0 (income-statement accounts reset each year)
--
-- YTD Debit / Credit:
--   Cumulative Dr / Cr from fiscal period 1 through the current period.
--
-- YTD Closing (not stored — identical to PTD Closing):
--   Proof B/S: YTD_OPENING + (YTD_DR − YTD_CR)
--            = BS_OPEN(p1) + cumulative_net_year
--            = BS_OPEN(current) + PTD_NET  ← same as PTD CLOSING ✓
--   Proof P&L: 0 + (YTD_DR − YTD_CR)
--            = PL_OPEN + PTD_NET           ← same as PTD CLOSING ✓
-- ────────────────────────────────────────────────────────────
ytd AS (
    SELECT
        c.*,
        -- YTD Opening (accounted)
        CASE WHEN c.ACCOUNT_TYPE IN ('A','L','O')
             THEN FIRST_VALUE(c.BS_OPENING) OVER (
                     PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                                  c.FISCAL_YEAR
                     ORDER BY c.FISCAL_PERIOD
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                  )
             ELSE 0
        END  AS YTD_OPENING,
        -- YTD Debit (accounted)
        SUM(c.PTD_DR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_DR,
        -- YTD Credit (accounted)
        SUM(c.PTD_CR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_CR,
        -- YTD Opening (entered)
        CASE WHEN c.ACCOUNT_TYPE IN ('A','L','O')
             THEN FIRST_VALUE(c.BS_ENTERED_OPENING) OVER (
                     PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                                  c.FISCAL_YEAR
                     ORDER BY c.FISCAL_PERIOD
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                  )
             ELSE 0
        END  AS YTD_ENTERED_OPENING,
        -- YTD Debit (entered)
        SUM(c.PTD_ENTERED_DR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_ENTERED_DR,
        -- YTD Credit (entered)
        SUM(c.PTD_ENTERED_CR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_ENTERED_CR
    FROM calc c
)

-- ────────────────────────────────────────────────────────────
-- Final — Output all non-zero rows
--
-- Zero suppression: exclude rows where opening AND closing AND
-- PTD are all zero (periods before the account's first entry).
--
-- Callers filter by LEDGER_NAME, PERIOD_NAME, FISCAL_YEAR,
-- COMPANY, CURRENCY_CODE with a WHERE clause on this view.
-- ORDER BY is left to the caller.
-- ────────────────────────────────────────────────────────────
SELECT
    y.LEDGER_NAME,
    y.PERIOD_NAME,
    y.FISCAL_YEAR,
    y.FISCAL_PERIOD,
    y.CURRENCY_CODE,
    y.ACCOUNT_COMBINATION,
    y.COMPANY,
    y.ACCOUNT,
    y.ACCOUNT_TYPE,
    y.ACCOUNT_DESC,

    -- ── PTD columns ──────────────────────────────────────────
    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_OPENING ELSE y.PL_OPENING END                    AS OPENING,

    y.PTD_DR                                                        AS DEBIT,
    y.PTD_CR                                                        AS CREDIT,

    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_OPENING + y.PTD_NET
         ELSE y.PL_OPENING + y.PTD_NET END                          AS CLOSING,

    -- ── PTD entered currency ──────────────────────────────────
    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_ENTERED_OPENING ELSE y.PL_ENTERED_OPENING END    AS ENTERED_OPENING,

    y.PTD_ENTERED_DR                                                AS ENTERED_DEBIT,
    y.PTD_ENTERED_CR                                                AS ENTERED_CREDIT,

    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_ENTERED_OPENING + y.PTD_ENTERED_NET
         ELSE y.PL_ENTERED_OPENING + y.PTD_ENTERED_NET END          AS ENTERED_CLOSING,

    -- ── YTD columns (accounted) ───────────────────────────────
    -- Opening = balance at start of fiscal year (B/S carried-in, P&L = 0)
    -- Debit / Credit = cumulative within fiscal year through this period
    -- Closing = same as PTD CLOSING (see proof in Step 8 comment)
    y.YTD_OPENING                                                   AS YTD_OPENING,
    y.YTD_DR                                                        AS YTD_DEBIT,
    y.YTD_CR                                                        AS YTD_CREDIT,

    -- ── YTD columns (entered currency) ───────────────────────
    y.YTD_ENTERED_OPENING                                           AS YTD_ENTERED_OPENING,
    y.YTD_ENTERED_DR                                                AS YTD_ENTERED_DEBIT,
    y.YTD_ENTERED_CR                                                AS YTD_ENTERED_CREDIT

FROM ytd y
WHERE (
    -- PTD-level suppression: exclude completely blank rows
    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O') THEN y.BS_OPENING ELSE y.PL_OPENING END <> 0
    OR y.PTD_DR <> 0
    OR y.PTD_CR <> 0
    -- YTD-level retention: keep rows alive for the full fiscal year if they had
    -- a carry-in balance or any Dr/Cr activity within the year.
    -- Without this, a combination whose running balance nets to zero mid-year
    -- gets zero-suppressed in later periods, causing the summed YTD_OPENING,
    -- YTD_DR, and YTD_CR to drop inconsistently when queried period by period.
    OR y.YTD_OPENING <> 0
    OR y.YTD_DR      <> 0
    OR y.YTD_CR      <> 0
)
;
