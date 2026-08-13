-- ============================================================
-- New endpoint: reerp/ap/invoices/search (GET)
--
-- Uses RR_AP_INVOICES_ALL (the actual invoices table).
-- Filters: from_date, to_date (maps to invoice_date_from/to),
--          business_unit, supplier, invoice_number, limit
--
-- Run in APEX SQL Workshop
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'ap/invoices/search',
        p_method      => 'GET'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/invoices/search'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'ap/invoices/search',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_etag_query  => NULL,
        p_comments    => 'AP Invoices search with date/BU filters'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'ap/invoices/search',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Search AP invoices from RR_AP_INVOICES_ALL',
        p_source         => q'[
SELECT
    i.invoice_id,
    i.invoice_number,
    i.invoice_currency,
    TO_CHAR(i.invoice_amount,  'TM9') AS invoice_amount,
    TO_CHAR(i.invoice_date,    'YYYY-MM-DD') AS invoice_date,
    TO_CHAR(i.accounting_date, 'YYYY-MM-DD') AS accounting_date,
    i.business_unit,
    i.legal_entity,
    i.supplier,
    i.supplier_number,
    i.supplier_site,
    i.invoice_type,
    i.description,
    i.validation_status,
    i.approval_status,
    i.paid_status,
    NVL(i.amount_paid, 0) AS amount_paid,
    i.sync_status
FROM RR_AP_INVOICES_ALL i
WHERE (TRUNC(i.invoice_date) >= TO_DATE(:from_date, 'YYYY-MM-DD') OR :from_date IS NULL)
  AND (TRUNC(i.invoice_date) <= TO_DATE(:to_date,   'YYYY-MM-DD') OR :to_date   IS NULL)
  AND (:business_unit  IS NULL OR i.business_unit   = :business_unit)
  AND (:supplier       IS NULL OR UPPER(i.supplier)  LIKE '%' || UPPER(:supplier) || '%')
  AND (:invoice_number IS NULL OR UPPER(i.invoice_number) LIKE '%' || UPPER(:invoice_number) || '%')
  AND (:validation_status IS NULL OR i.validation_status = :validation_status)
  AND (:paid_status    IS NULL OR i.paid_status      = :paid_status)
ORDER BY i.invoice_date DESC, i.invoice_id DESC
FETCH FIRST NVL(:limit, 1000) ROWS ONLY
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('reerp/ap/invoices/search created successfully');
END;
/
