-- ============================================================================
-- 159_banks_local_get_endpoints.sql
-- GET endpoints over the locally synced bank master tables so the Banks page
-- (Payables > Banks) can read from APEX instead of calling Oracle Fusion live.
--
-- Data source tables (populated by the Sync Data page):
--   RR_BANKS          -> POST banks/createnewbank   (already exists)
--   RR_BANK_BRANCHES  -> POST banks/brankbranches   (already exists)
--   RR_BANK_ACCOUNTS  -> POST/GET banks/bankaccounts (already exists; GET is a
--                        slim LOV feed used by Bank Recon / Statements — left
--                        untouched)
--
-- This script adds three read-only collection feeds (no parameters, no binds —
-- filtering is done client-side, volumes are small master data):
--   GET banks/list           -> all rows from RR_BANKS
--   GET banks/brankbranches  -> all rows from RR_BANK_BRANCHES
--                               (new GET handler on the existing template)
--   GET banks/accounts/list  -> full-column feed from RR_BANK_ACCOUNTS
--
-- Run ALL blocks in APEX SQL Workshop -> SQL Scripts (not SQL Commands).
-- ============================================================================

-- ── Block 1: GET banks/list ─────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'banks/list',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Local banks list (RR_BANKS)'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'banks/list',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'All banks from the locally synced RR_BANKS table',
        p_source         => q'[
SELECT BANK_PARTY_ID,
       BANK_NAME,
       BANK_NAME_ALT,
       BANK_NUMBER,
       DESCRIPTION,
       BANK_PARTY_NUMBER,
       COUNTRY_NAME,
       CREATED_BY,
       CREATION_DATE,
       LAST_UPDATE_DATE,
       LAST_UPDATED_BY,
       SYNC_DATE
  FROM RR_BANKS
 ORDER BY BANK_NAME
]'
    );

    COMMIT;
END;
/

-- ── Block 2: GET banks/brankbranches (new handler on the existing template) ─
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'banks/brankbranches',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Bank branches sync endpoint'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'banks/brankbranches',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'All bank branches from the locally synced RR_BANK_BRANCHES table',
        p_source         => q'[
SELECT BRANCH_PARTY_ID,
       BANK_NAME,
       BANK_NAME_ALT,
       BANK_NUMBER,
       BANK_BRANCH_NAME,
       BANK_BRANCH_NAME_ALT,
       BRANCH_NUMBER,
       DESCRIPTION,
       EFT_SWIFT_CODE,
       BANK_PARTY_NUMBER,
       BRANCH_PARTY_NUMBER,
       COUNTRY_NAME,
       BANK_BRANCH_TYPE,
       CREATED_BY,
       CREATION_DATE,
       LAST_UPDATE_DATE,
       SYNC_DATE
  FROM RR_BANK_BRANCHES
 ORDER BY BANK_NAME, BANK_BRANCH_NAME
]'
    );

    COMMIT;
END;
/

-- ── Block 3: GET banks/accounts/list (full columns for the Banks page) ──────
-- Distinct literal path — deliberately NOT banks/bankaccounts/... to avoid any
-- template-shape collision with banks/bankaccounts/:bank_account_id.
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'banks/accounts/list',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'Local bank accounts full list (RR_BANK_ACCOUNTS)'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'banks/accounts/list',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_collection_feed,
        p_items_per_page => 0,
        p_mimes_allowed  => '',
        p_comments       => 'All bank accounts (full columns) from RR_BANK_ACCOUNTS',
        p_source         => q'[
SELECT BANK_ACCOUNT_ID,
       BANK_ACCOUNT_NAME,
       BANK_ACCOUNT_NUMBER,
       BANK_ACCOUNT_NUMBER_ELECTRONIC,
       MASKED_ACCOUNT_NUMBER,
       IBAN_NUMBER,
       ACCOUNT_TYPE,
       CURRENCY_CODE,
       DESCRIPTION,
       BANK_NAME,
       BANK_BRANCH_NAME,
       BANK_NUMBER,
       BRANCH_NUMBER,
       COUNTRY_NAME,
       LEGAL_ENTITY_NAME,
       AP_USE_ALLOWED_FLAG,
       AR_USE_ALLOWED_FLAG,
       CASH_ACCOUNT_COMBINATION,
       CASH_CLEARING_ACCOUNT_COMBINATION,
       RECON_DIFFERENCE_ACCOUNT_COMBINATION,
       PDC_ACCOUNT_COMBINATION,
       RECON_START_DATE,
       END_DATE,
       CREATED_BY,
       CREATION_DATE,
       LAST_UPDATE_DATE,
       SYNC_DATE
  FROM RR_BANK_ACCOUNTS
 ORDER BY BANK_ACCOUNT_NAME
]'
    );

    COMMIT;
END;
/

-- ── Verification ────────────────────────────────────────────────────────────
-- SELECT uh.method, ut.uri_template
--   FROM user_ords_handlers uh
--   JOIN user_ords_templates ut ON ut.id = uh.template_id
--  WHERE ut.uri_template IN ('banks/list', 'banks/brankbranches', 'banks/accounts/list')
--  ORDER BY ut.uri_template, uh.method;
-- Expect: GET banks/accounts/list, GET+POST banks/brankbranches, GET banks/list
