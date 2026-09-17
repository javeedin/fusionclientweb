-- ============================================================
-- Patch 153: RR_V_RM_CUSTOMER_ACCT_SITES
--            Customers + Fusion AR accounts + account sites in one view
--
-- Sources:
--   RR_RM_CUSTOMERS                        (local customers; PK CUSTOMER_ID)
--   RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP         (Fusion accounts; all VARCHAR2)
--   RR_RAW_AR_HZ_CUST_ACCT_SITES_ALL_BIP   (Fusion account sites; all VARCHAR2)
--
-- Join logic:
--   * account -> site is a hard key: s.CUST_ACCOUNT_ID = a.CUST_ACCOUNT_ID
--   * customer -> account has NO foreign key in these tables, so the view
--     matches on business keys, first rule that hits wins (see MATCHED_BY):
--       NAME    — account name equals the customer's company/full name
--       NUMBER  — account number equals the customer number
--       OSR     — account ORIG_SYSTEM_REFERENCE equals the customer id/number
--   * LEFT JOINs: every customer appears even with no matched account,
--     and every matched account appears even with no sites.
--
-- Check unmatched links with:
--   SELECT customer_number, full_name FROM rr_v_rm_customer_acct_sites
--    WHERE cust_account_id IS NULL;
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands (each statement separately)
--             or SQL Workshop → SQL Scripts for the whole file.
-- ============================================================

CREATE OR REPLACE VIEW RR_V_RM_CUSTOMER_ACCT_SITES AS
SELECT
    -- ── customer (RR_RM_CUSTOMERS) ──
    c.CUSTOMER_ID,
    c.CUSTOMER_NUMBER,
    c.CUSTOMER_TYPE,
    c.FULL_NAME,
    c.COMPANY_NAME,
    c.EMAIL,
    c.PHONE,
    c.MOBILE,
    c.NATIONALITY,
    c.EMIRATES_ID,
    c.TRADE_LICENSE_NO,
    c.ADDRESS_LINE1,
    c.CITY,
    c.EMIRATE,
    c.COUNTRY,
    c.STATUS                          AS CUSTOMER_STATUS,
    -- ── account (RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP) ──
    a.CUST_ACCOUNT_ID,
    a.PARTY_ID,
    a.ACCOUNT_NUMBER,
    a.ACCOUNT_NAME,
    a.STATUS                          AS ACCOUNT_STATUS,
    a.CUSTOMER_TYPE                   AS ACCOUNT_CUSTOMER_TYPE,
    a.ACCOUNT_ESTABLISHED_DATE,
    a.ORIG_SYSTEM_REFERENCE           AS ACCOUNT_OSR,
    CASE
        WHEN a.CUST_ACCOUNT_ID IS NULL THEN NULL
        WHEN UPPER(TRIM(a.ACCOUNT_NAME)) = UPPER(TRIM(NVL(c.COMPANY_NAME, c.FULL_NAME)))
             THEN 'NAME'
        WHEN TRIM(a.ACCOUNT_NUMBER) = TRIM(c.CUSTOMER_NUMBER)
             THEN 'NUMBER'
        ELSE 'OSR'
    END                               AS MATCHED_BY,
    -- ── site (RR_RAW_AR_HZ_CUST_ACCT_SITES_ALL_BIP) ──
    s.CUST_ACCT_SITE_ID,
    s.PARTY_SITE_ID,
    s.STATUS                          AS SITE_STATUS,
    s.BILL_TO_FLAG,
    s.SHIP_TO_FLAG,
    s.START_DATE                      AS SITE_START_DATE,
    s.END_DATE                        AS SITE_END_DATE,
    s.ORIG_SYSTEM_REFERENCE           AS SITE_OSR
FROM RR_RM_CUSTOMERS c
LEFT JOIN RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP a
       ON UPPER(TRIM(a.ACCOUNT_NAME)) = UPPER(TRIM(NVL(c.COMPANY_NAME, c.FULL_NAME)))
       OR TRIM(a.ACCOUNT_NUMBER)      = TRIM(c.CUSTOMER_NUMBER)
       OR TRIM(a.ORIG_SYSTEM_REFERENCE) IN (TO_CHAR(c.CUSTOMER_ID), TRIM(c.CUSTOMER_NUMBER))
LEFT JOIN RR_RAW_AR_HZ_CUST_ACCT_SITES_ALL_BIP s
       ON s.CUST_ACCOUNT_ID = a.CUST_ACCOUNT_ID;

COMMENT ON TABLE RR_V_RM_CUSTOMER_ACCT_SITES IS
  'Customers (RR_RM_CUSTOMERS) with their Fusion AR customer accounts and account sites. One row per customer/account/site combination; customers with no matched account have NULL account columns. MATCHED_BY shows which business key linked the account (NAME/NUMBER/OSR) since the raw tables carry no foreign key to RR_RM_CUSTOMERS.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Overall shape:
--   SELECT COUNT(*) rows_total,
--          COUNT(DISTINCT customer_id) customers,
--          COUNT(DISTINCT cust_account_id) accounts,
--          COUNT(DISTINCT cust_acct_site_id) sites
--     FROM rr_v_rm_customer_acct_sites;
-- Match quality:
--   SELECT matched_by, COUNT(*) FROM rr_v_rm_customer_acct_sites GROUP BY matched_by;
-- Fusion accounts not linked to any RM customer (not in the view by design):
--   SELECT a.account_number, a.account_name
--     FROM rr_raw_ar_hz_cust_accounts_bip a
--    WHERE NOT EXISTS (SELECT 1 FROM rr_v_rm_customer_acct_sites v
--                       WHERE v.cust_account_id = a.cust_account_id);
