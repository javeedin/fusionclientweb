-- =============================================================================
-- RR_SUPPLIER_DETAIL_GET.SQL
-- GET endpoints to load a single supplier's Addresses and Sites for the
-- "Edit Supplier" screen (Manage Suppliers -> open a supplier).
--
-- New webservices:
--   GET reerp/suppliers/addresses/:supplier_id   -> { items: [ ...addresses ] }
--   GET reerp/suppliers/sitelist/:supplier_id    -> { items: [ ...sites ] }
--
-- (A plain "suppliers/sites" GET already exists for the assignment-sync job and
--  returns ALL sites, so we use a distinct "suppliers/sitelist/:id" pattern
--  scoped to one supplier here.)
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- =============================================================================

-- ── GET reerp/suppliers/addresses/:supplier_id ───────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'suppliers/addresses/:supplier_id', p_method => 'GET'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'suppliers/addresses/:supplier_id'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp',
    p_pattern     => 'suppliers/addresses/:supplier_id',
    p_priority    => 1,
    p_etag_type   => 'HASH',
    p_comments    => 'Addresses for one supplier'
  );
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'suppliers/addresses/:supplier_id',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Addresses for one supplier',
    p_source         => q'[
SELECT
    SUPPLIER_ADDRESS_ID   AS "supplierAddressId",
    ADDRESS_NAME          AS "addressName",
    ADDRESS_LINE1         AS "addressLine1",
    ADDRESS_LINE2         AS "addressLine2",
    CITY                  AS "city",
    STATE                 AS "state",
    POSTAL_CODE           AS "postalCode",
    COUNTRY               AS "country",
    PHONE_NUMBER          AS "phoneNumber",
    EMAIL                 AS "email",
    ADDR_PURPOSE_ORDERING AS "purposeOrdering",
    ADDR_PURPOSE_REMIT_TO AS "purposeRemitTo",
    STATUS                AS "status"
FROM RR_SUPPLIER_ADDRESS
WHERE SUPPLIER_ID = :supplier_id
ORDER BY ADDRESS_NAME
]'
  );
  COMMIT;
END;
/

-- ── GET reerp/suppliers/sitelist/:supplier_id ────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'suppliers/sitelist/:supplier_id', p_method => 'GET'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'suppliers/sitelist/:supplier_id'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'reerp',
    p_pattern     => 'suppliers/sitelist/:supplier_id',
    p_priority    => 1,
    p_etag_type   => 'HASH',
    p_comments    => 'Sites for one supplier'
  );
  COMMIT;
END;
/
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'suppliers/sitelist/:supplier_id',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_items_per_page => 0,
    p_mimes_allowed  => 'application/json',
    p_comments       => 'Sites for one supplier',
    p_source         => q'[
SELECT
    s.SUPPLIER_SITE_ID       AS "supplierSiteId",
    s.SUPPLIER_SITE          AS "supplierSite",
    s.SUPPLIER_SITE_CODE     AS "siteCode",
    s.PROCUREMENT_BU         AS "procurementBu",
    s.ADDRESS_NAME           AS "addressName",
    s.PURCHASING_FLAG        AS "purchasingFlag",
    s.PAY_FLAG               AS "payFlag",
    s.PAYMENT_TERMS          AS "paymentTerms",
    s.INVOICE_CURRENCY_CODE  AS "invoiceCurrency",
    s.STATUS                 AS "status",
    (SELECT LISTAGG(a.CLIENT_BU, ', ') WITHIN GROUP (ORDER BY a.CLIENT_BU)
       FROM RR_SUPPLIER_SITE_ASSIGNMENTS a
      WHERE a.SUPPLIER_SITE_ID = s.SUPPLIER_SITE_ID) AS "assignedBu"
FROM RR_SUPPLIER_SITES s
WHERE s.SUPPLIER_ID = :supplier_id
ORDER BY s.SUPPLIER_SITE_CODE
]'
  );
  COMMIT;
  DBMS_OUTPUT.PUT_LINE('GET suppliers/addresses/:id and suppliers/sitelist/:id registered OK');
END;
/
