-- =====================================================
-- ORDS REST Handler: GET /ar/customers
-- Source table : RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP
-- Usage        : LOV for customer search in AR module
-- NOTE: :q is referenced via CTE (ORDS requires each
--       bind variable to appear exactly once in source)
-- =====================================================

-- Drop existing template/handler first to allow re-run
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'customers');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Template (module 'ar' already exists)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'customers',
        p_comments    => 'AR Customers LOV'
    );
    COMMIT;
END;
/

-- GET /ar/customers?q=<search_term>
-- Returns up to 200 matching customers ordered by name
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'customers',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'Search AR customers by name or account number',
        p_source         => '
WITH params AS (
    SELECT TRIM(:q) AS q FROM DUAL
)
SELECT
    c.CUST_ACCOUNT_ID,
    c.ACCOUNT_NUMBER,
    c.ACCOUNT_NAME
FROM RR_RAW_AR_HZ_CUST_ACCOUNTS_BIP c, params p
WHERE (
    p.q IS NULL
    OR UPPER(c.ACCOUNT_NAME)   LIKE UPPER(''%'' || p.q || ''%'')
    OR UPPER(c.ACCOUNT_NUMBER) LIKE UPPER(''%'' || p.q || ''%'')
)
ORDER BY c.ACCOUNT_NAME'
    );
    COMMIT;
END;
/
