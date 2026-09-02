-- =============================================================================
-- PATCH 101: RR_V_STANDARD_TB — include local journals (RR_GL_LINES_ALL)
--
-- Based on the deployed view DDL (FORCE EDITIONABLE, captured 02-Sep-2026).
-- ONLY three CTEs change — everything else is byte-identical to production:
--   Step 2 all_combos  : + UNION branch reading local RR_GL_LINES_ALL/RR_GL_HEADERS
--   Step 3 all_periods : ledger list also drawn from local RR_GL_HEADERS
--   Step 4 ptd_actual  : raw lines from BOTH sources UNION ALL'd, then
--                        aggregated ONCE (a duplicate key here would fan out
--                        the dense grid in Step 5)
--
-- WHY:
--   V_GL_JOURNAL_LINES_SEGMENTS (patch 92) shows Fusion-synced AND locally
--   created journals; this TB view read only the Fusion-synced tables, so a
--   local journal moved the Account Analysis listing but not the TB opening.
--   Symptom: Jul-26 opening for account 1242137 was 30,378,924.56 instead of
--   Jun-26 closing 30,379,013.56 — 89.00 of local June journals.
--
--   NOTE: like patch 92 there is no de-dup guard. If a local journal is later
--   also imported into Fusion and synced back, both reports count it twice
--   (consistently). The sync should remove/flag the local copy in that case.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands → run the CREATE OR REPLACE block,
--   then the verification query at the bottom.
-- =============================================================================

CREATE OR REPLACE FORCE EDITIONABLE VIEW "RR_V_STANDARD_TB" ("LEDGER_NAME", "PERIOD_NAME", "FISCAL_YEAR", "FISCAL_PERIOD", "CURRENCY_CODE", "ACCOUNT_COMBINATION", "COMPANY", "ACCOUNT", "ACCOUNT_TYPE", "ACCOUNT_DESC", "OPENING", "DEBIT", "CREDIT", "CLOSING", "ENTERED_OPENING", "ENTERED_DEBIT", "ENTERED_CREDIT", "ENTERED_CLOSING", "YTD_OPENING", "YTD_DEBIT", "YTD_CREDIT", "YTD_ENTERED_OPENING", "YTD_ENTERED_DEBIT", "YTD_ENTERED_CREDIT") AS
  WITH

-- ────────────────────────────────────────────────────────────
-- Step 1 — Account master (ACCOUNT_TYPE + ACCOUNT_DESC)
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
-- PATCH 101: union of Fusion-synced AND local journals
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
    UNION
    SELECT DISTINCT
        hdr.LEDGER_NAME,
        lin.ACCOUNT_COMBINATION,
        NVL(lin.CURRENCY_CODE, 'AED')                     AS CURRENCY_CODE
    FROM RR_GL_LINES_ALL     lin
    JOIN RR_GL_HEADERS       hdr
      ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
    WHERE lin.ACCOUNT_COMBINATION IS NOT NULL
),

-- ────────────────────────────────────────────────────────────
-- Step 3 — All distinct periods per ledger
-- PATCH 101: ledger list drawn from both header tables
-- ────────────────────────────────────────────────────────────
all_periods AS (
    SELECT DISTINCT
        l.LEDGER_NAME,
        fp.PERIOD_NAME
    FROM (
        SELECT DISTINCT LEDGER_NAME
        FROM RR_GL_JE_HEADERS
        WHERE LEDGER_NAME IS NOT NULL
        UNION
        SELECT DISTINCT LEDGER_NAME
        FROM RR_GL_HEADERS
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
-- PATCH 101: raw lines from BOTH sources unioned first, then
-- aggregated once so each key yields exactly one row.
-- ────────────────────────────────────────────────────────────
ptd_actual AS (
    SELECT
        LEDGER_NAME,
        PERIOD_NAME,
        CURRENCY_CODE,
        ACCOUNT_COMBINATION,
        SUM(ACCOUNTED_DR)  AS PTD_DR,
        SUM(ACCOUNTED_CR)  AS PTD_CR,
        SUM(ENTERED_DR)    AS PTD_ENTERED_DR,
        SUM(ENTERED_CR)    AS PTD_ENTERED_CR
    FROM (
        -- Branch 1: Fusion-synced journals (unchanged behaviour)
        SELECT
            hdr.LEDGER_NAME,
            hdr.PERIOD_NAME,
            NVL(lin.CURRENCY_CODE, hdr.LEDGER_CURRENCY_CODE)  AS CURRENCY_CODE,
            lin.ACCOUNT_COMBINATION,
            NVL(lin.ACCOUNTED_DR, 0)  AS ACCOUNTED_DR,
            NVL(lin.ACCOUNTED_CR, 0)  AS ACCOUNTED_CR,
            NVL(lin.ENTERED_DR,   0)  AS ENTERED_DR,
            NVL(lin.ENTERED_CR,   0)  AS ENTERED_CR
        FROM RR_GL_JE_LINES_ALL  lin
        JOIN RR_GL_JE_HEADERS    hdr
          ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
        WHERE hdr.PERIOD_NAME         IS NOT NULL
          AND lin.ACCOUNT_COMBINATION IS NOT NULL
        UNION ALL
        -- Branch 2: local journals created by the app (patch-92 parity)
        SELECT
            hdr.LEDGER_NAME,
            hdr.PERIOD_NAME,
            NVL(lin.CURRENCY_CODE, 'AED')                     AS CURRENCY_CODE,
            lin.ACCOUNT_COMBINATION,
            NVL(lin.ACCOUNTED_DR, 0),
            NVL(lin.ACCOUNTED_CR, 0),
            NVL(lin.ENTERED_DR,   0),
            NVL(lin.ENTERED_CR,   0)
        FROM RR_GL_LINES_ALL     lin
        JOIN RR_GL_HEADERS       hdr
          ON hdr.JE_HEADER_ID = lin.JE_HEADER_ID
        WHERE hdr.PERIOD_NAME         IS NOT NULL
          AND lin.ACCOUNT_COMBINATION IS NOT NULL
    )
    GROUP BY
        LEDGER_NAME,
        PERIOD_NAME,
        CURRENCY_CODE,
        ACCOUNT_COMBINATION
),

-- ────────────────────────────────────────────────────────────
-- Step 5 — Dense PTD: every combination × every period
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

        CASE
            WHEN fp.FISCAL_YEAR IS NOT NULL
            THEN TO_NUMBER(fp.FISCAL_YEAR)
            ELSE EXTRACT(YEAR  FROM TO_DATE('01-'||p.PERIOD_NAME,'DD-Mon-RR'))
        END  AS FISCAL_YEAR,

        CASE
            WHEN fp.FISCAL_PERIOD IS NOT NULL
            THEN TO_NUMBER(fp.FISCAL_PERIOD)
            ELSE EXTRACT(MONTH FROM TO_DATE('01-'||p.PERIOD_NAME,'DD-Mon-RR'))
        END  AS FISCAL_PERIOD,

        p.PTD_DR,
        p.PTD_CR,
        p.PTD_DR - p.PTD_CR                      AS PTD_NET,
        p.PTD_ENTERED_DR,
        p.PTD_ENTERED_CR,
        p.PTD_ENTERED_DR - p.PTD_ENTERED_CR      AS PTD_ENTERED_NET

    FROM ptd p
    LEFT JOIN accounts acc
      ON acc.ACCOUNT = TRIM(REGEXP_SUBSTR(p.ACCOUNT_COMBINATION,'[^-]+',1,4))
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
        NVL(SUM(e.PTD_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE
            ORDER BY (e.FISCAL_YEAR * 100 + e.FISCAL_PERIOD)
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS BS_OPENING,
        NVL(SUM(e.PTD_NET) OVER (
            PARTITION BY e.LEDGER_NAME, e.ACCOUNT_COMBINATION, e.CURRENCY_CODE,
                         e.FISCAL_YEAR
            ORDER BY e.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)  AS PL_OPENING,
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
-- ────────────────────────────────────────────────────────────
ytd AS (
    SELECT
        c.*,
        CASE WHEN c.ACCOUNT_TYPE IN ('A','L','O')
             THEN FIRST_VALUE(c.BS_OPENING) OVER (
                     PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                                  c.FISCAL_YEAR
                     ORDER BY c.FISCAL_PERIOD
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                  )
             ELSE 0
        END  AS YTD_OPENING,
        SUM(c.PTD_DR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_DR,
        SUM(c.PTD_CR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_CR,
        CASE WHEN c.ACCOUNT_TYPE IN ('A','L','O')
             THEN FIRST_VALUE(c.BS_ENTERED_OPENING) OVER (
                     PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                                  c.FISCAL_YEAR
                     ORDER BY c.FISCAL_PERIOD
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                  )
             ELSE 0
        END  AS YTD_ENTERED_OPENING,
        SUM(c.PTD_ENTERED_DR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_ENTERED_DR,
        SUM(c.PTD_ENTERED_CR) OVER (
            PARTITION BY c.LEDGER_NAME, c.ACCOUNT_COMBINATION, c.CURRENCY_CODE,
                         c.FISCAL_YEAR
            ORDER BY c.FISCAL_PERIOD
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )  AS YTD_ENTERED_CR
    FROM calc c
)

-- ────────────────────────────────────────────────────────────
-- Final — Output rows
--
-- Zero suppression extended to retain rows that have YTD activity
-- or a YTD carry-in balance, so that a combination whose PTD
-- balance nets to zero mid-year is not silently dropped for the
-- remaining periods of the fiscal year.  Without this retention
-- the summed YTD_OPENING / YTD_DR / YTD_CR varies by period.
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

    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_OPENING ELSE y.PL_OPENING END                    AS OPENING,

    y.PTD_DR                                                        AS DEBIT,
    y.PTD_CR                                                        AS CREDIT,

    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_OPENING + y.PTD_NET
         ELSE y.PL_OPENING + y.PTD_NET END                          AS CLOSING,

    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_ENTERED_OPENING ELSE y.PL_ENTERED_OPENING END    AS ENTERED_OPENING,

    y.PTD_ENTERED_DR                                                AS ENTERED_DEBIT,
    y.PTD_ENTERED_CR                                                AS ENTERED_CREDIT,

    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O')
         THEN y.BS_ENTERED_OPENING + y.PTD_ENTERED_NET
         ELSE y.PL_ENTERED_OPENING + y.PTD_ENTERED_NET END          AS ENTERED_CLOSING,

    y.YTD_OPENING                                                   AS YTD_OPENING,
    y.YTD_DR                                                        AS YTD_DEBIT,
    y.YTD_CR                                                        AS YTD_CREDIT,

    y.YTD_ENTERED_OPENING                                           AS YTD_ENTERED_OPENING,
    y.YTD_ENTERED_DR                                                AS YTD_ENTERED_DEBIT,
    y.YTD_ENTERED_CR                                                AS YTD_ENTERED_CREDIT

FROM ytd y
WHERE (
    -- PTD-level: keep rows with a non-zero PTD opening or activity
    CASE WHEN y.ACCOUNT_TYPE IN ('A','L','O') THEN y.BS_OPENING ELSE y.PL_OPENING END <> 0
    OR y.PTD_DR <> 0
    OR y.PTD_CR <> 0
    -- YTD-level retention (the fix): keep rows alive for the entire fiscal year
    -- once they have a carry-in balance or any cumulative Dr/Cr within the year.
    -- This prevents a combination that nets to zero mid-year from disappearing
    -- and causing the summed YTD_OPENING / YTD_DR / YTD_CR to drop inconsistently.
    OR y.YTD_OPENING <> 0
    OR y.YTD_DR      <> 0
    OR y.YTD_CR      <> 0
);

-- =============================================================================
-- VERIFICATION (account 1242137, the case that surfaced the bug)
-- Expected after the patch:
--   Jun-26 CLOSING = Jul-26 OPENING = 30,379,013.56
--   (previously Jul-26 OPENING showed 30,378,924.56 — 89.00 short)
-- =============================================================================
-- SELECT period_name, SUM(opening) opening, SUM(debit) debit,
--        SUM(credit) credit, SUM(closing) closing
-- FROM   rr_v_standard_tb
-- WHERE  ledger_name = 'BUIMERC LEDGER'
-- AND    account     = '1242137'
-- AND    period_name IN ('Jun-26','Jul-26')
-- GROUP BY period_name;
