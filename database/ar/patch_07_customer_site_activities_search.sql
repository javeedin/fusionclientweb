-- =====================================================
-- PATCH 07: Add search filter support to
--           GET /ar/customer-site-activities
--           Optional params: customer_name, account_number, tax_number
-- =====================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'ar/customer-site-activities');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ar/customer-site-activities',
        p_comments    => 'AR Customer Site Activities — search with optional filters'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ar/customer-site-activities',
        p_method         => 'GET',
        p_source_type    => ORDS.SOURCE_TYPE_COLLECTION_FEED,
        p_items_per_page => 500,
        p_comments       => 'Search customer site activities by name, account number or tax reg number',
        p_source         => q'[
WITH params AS (
    SELECT
        TRIM(:customer_name)   AS p_name,
        TRIM(:account_number)  AS p_acct,
        TRIM(:tax_number)      AS p_tax
    FROM DUAL
)
SELECT
    c.BILL_TO_SITE_USE_ID,
    c.BILL_TO_SITE_NUMBER,
    c.BILL_TO_SITE_ADDRESS,
    c.ACCOUNT_NUMBER,
    c.CUSTOMER_NAME,
    c.TAX_REGISTRATION_NUMBER,
    c.TOTAL_OPEN_RECEIVABLES_FOR_SITE,
    c.TOTAL_TRANSACTIONS_DUE_FOR_SITE,
    TO_CHAR(c.SYNC_DATE, ''DD-Mon-YYYY HH24:MI'') AS SYNC_DATE
FROM RR_RAW_CUSTOMER_SITE_ACTIVITIES c, params p
WHERE (
    p.p_name IS NULL OR p.p_name = ''''
    OR UPPER(c.CUSTOMER_NAME) LIKE ''%'' || UPPER(p.p_name) || ''%''
)
AND (
    p.p_acct IS NULL OR p.p_acct = ''''
    OR UPPER(c.ACCOUNT_NUMBER) LIKE ''%'' || UPPER(p.p_acct) || ''%''
)
AND (
    p.p_tax IS NULL OR p.p_tax = ''''
    OR UPPER(c.TAX_REGISTRATION_NUMBER) LIKE ''%'' || UPPER(p.p_tax) || ''%''
)
ORDER BY c.CUSTOMER_NAME, c.BILL_TO_SITE_NUMBER
]'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- GET {base}/ar/customer-site-activities
--   Optional params:
--     ?customer_name=<text>    — filter by customer name (LIKE)
--     ?account_number=<text>   — filter by account number (LIKE)
--     ?tax_number=<text>       — filter by tax registration number (LIKE)
--   Returns up to 500 rows ordered by customer name
-- =====================================================
