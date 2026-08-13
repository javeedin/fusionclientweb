-- =====================================================
-- ORDS REST Handler: GET /ar/receiptmethods
-- Source table : RR_AR_RECEIPT_METHODS
-- Usage        : LOV for Receipt Method field in AR module
-- NOTE: bind variables referenced exactly once via CTE
-- =====================================================

-- Drop existing template/handler first to allow re-run
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receiptmethods');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Template (module 'ar' already exists)
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'receiptmethods',
        p_comments    => 'AR Receipt Methods LOV'
    );
    COMMIT;
END;
/

-- GET /ar/receiptmethods
--   ?q=<search>              filter by name (partial, case-insensitive)
--   ?receipt_class=<class>   filter by receipt class (exact, case-insensitive)
-- Returns up to 300 rows ordered by name
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receiptmethods',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 300,
        p_comments       => 'List AR receipt methods with optional name / class filter',
        p_source         => '
WITH fp AS (
    SELECT TRIM(:q)             AS q,
           TRIM(:receipt_class) AS rclass
    FROM DUAL
)
SELECT
    m.ID,
    m.RECEIPTMETHODID,
    m.NAME,
    m.RECEIPTCLASS,
    m.CREATEDBY,
    m.CREATIONDATE,
    m.LASTUPDATEDBY,
    m.LASTUPDATEDATE
FROM RR_AR_RECEIPT_METHODS m
CROSS JOIN fp
WHERE (fp.q      IS NULL OR fp.q      = '''' OR UPPER(m.NAME)         LIKE ''%'' || UPPER(fp.q)      || ''%'')
  AND (fp.rclass IS NULL OR fp.rclass = '''' OR UPPER(m.RECEIPTCLASS) =             UPPER(fp.rclass))
ORDER BY m.NAME'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINT SUMMARY
-- =====================================================
-- GET  {base}/ar/receiptmethods
--   ?q=             partial name search
--   ?receipt_class= exact class filter (e.g. CHECK, CASH, DIRECT_DEBIT)
-- =====================================================
