-- =====================================================
-- GET Handler for /ap/suppliers
-- Purpose: Returns distinct supplier list for dropdowns
-- =====================================================

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ap', p_pattern => 'suppliers');
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ap',
        p_pattern     => 'suppliers',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'AP Supplier list for dropdowns'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ap',
        p_pattern        => 'suppliers',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_comments       => 'Return all active suppliers ordered by name',
        p_source         => q'[
SELECT DISTINCT
    s.supplier_number,
    s.supplier AS supplier_name,
    s.status
FROM RR_SUPPLIER_MASTER s
WHERE NVL(s.status, 'Active') = 'Active'
  AND (
    :business_unit IS NULL
    OR EXISTS (
        SELECT 1
        FROM RR_SUPPLIER_SITES ss
        WHERE ss.SUPPLIER_ID = s.SUPPLIER_ID
          AND ss.PROCUREMENT_BU = :business_unit
    )
  )
ORDER BY s.supplier
]'
    );
    COMMIT;
END;
/

SELECT module_name, uri_template, method, source_type
FROM   user_ords_handlers
WHERE  module_name = 'ap'
  AND  uri_template = 'suppliers'
ORDER BY method;
