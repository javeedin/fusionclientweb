-- ============================================================
-- Patch 153 (v2): RR_V_CUST_ACCOUNT_SITES
--                 Fusion AR customer accounts + their account sites
--
-- Sources:
--   RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP         (accounts; all columns VARCHAR2)
--   RR_RAW_AR_HZ_CUST_ACCT_SITES_ALL_BIP   (account sites; all VARCHAR2)
--
-- Join: s.CUST_ACCOUNT_ID = a.CUST_ACCOUNT_ID (LEFT JOIN — an account
-- with no sites still appears, with NULL site columns).
-- Grain: one row per account per site.
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands (each statement
-- separately) or SQL Workshop → SQL Scripts for the whole file.
-- ============================================================

CREATE OR REPLACE VIEW RR_V_CUST_ACCOUNT_SITES AS
SELECT
    -- ── account (RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP) ──
    a.CUST_ACCOUNT_ID,
    a.PARTY_ID,
    a.ACCOUNT_NUMBER,
    a.ACCOUNT_NAME,
    a.CUSTOMER_TYPE,
    a.STATUS                    AS ACCOUNT_STATUS,
    a.ACCOUNT_ESTABLISHED_DATE,
    a.ACCOUNT_TERMINATION_DATE,
    a.HOLD_BILL_FLAG,
    a.ORIG_SYSTEM_REFERENCE     AS ACCOUNT_OSR,
    a.CREATED_BY_MODULE         AS ACCOUNT_CREATED_BY_MODULE,
    a.CREATION_DATE             AS ACCOUNT_CREATION_DATE,
    -- ── site (RR_RAW_AR_HZ_CUST_ACCT_SITES_ALL_BIP) ──
    s.CUST_ACCT_SITE_ID,
    s.PARTY_SITE_ID,
    s.STATUS                    AS SITE_STATUS,
    s.BILL_TO_FLAG,
    s.SHIP_TO_FLAG,
    s.MARKET_FLAG,
    s.SET_ID,
    s.START_DATE                AS SITE_START_DATE,
    s.END_DATE                  AS SITE_END_DATE,
    s.ORIG_SYSTEM_REFERENCE     AS SITE_OSR,
    s.CREATION_DATE             AS SITE_CREATION_DATE
FROM RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP a
LEFT JOIN RR_RAW_AR_HZ_CUST_ACCT_SITES_ALL_BIP s
       ON s.CUST_ACCOUNT_ID = a.CUST_ACCOUNT_ID;

COMMENT ON TABLE RR_V_CUST_ACCOUNT_SITES IS
  'Fusion AR customer accounts (RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP) with their account sites (RR_RAW_AR_HZ_CUST_ACCT_SITES_ALL_BIP), joined on CUST_ACCOUNT_ID. One row per account/site; accounts with no sites have NULL site columns. All values are raw VARCHAR2 from BIP extracts.';

-- ── Verify ─────────────────────────────────────────────────────────────────
--   SELECT COUNT(*) rows_total,
--          COUNT(DISTINCT cust_account_id)   accounts,
--          COUNT(DISTINCT cust_acct_site_id) sites
--     FROM rr_v_cust_account_sites;
--   -- accounts without any site:
--   SELECT account_number, account_name FROM rr_v_cust_account_sites
--    WHERE cust_acct_site_id IS NULL;
