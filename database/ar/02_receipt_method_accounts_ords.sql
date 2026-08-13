-- ============================================================
-- ORDS REST Handler: GET /reerp/ar/receipt-method-accounts
-- Serves view RR_V_RECEIPT_METHODS_BANK_ACCOUNTS
--
-- Query params (all optional):
--   receipt_method_id   — filter by receipt method ID
--   bank_account_id     — filter by bank account ID
--   business_unit_name  — filter by business unit name (partial match)
--   org_id              — filter by org/BU ID
-- ============================================================

BEGIN
  ORDS.DEFINE_MODULE(
    p_module_name    => 'reerp',
    p_base_path      => '/reerp/',
    p_items_per_page => 25,
    p_status         => 'PUBLISHED',
    p_comments       => 'ReERP REST API'
  );
EXCEPTION WHEN OTHERS THEN NULL; -- module already exists
END;
/

BEGIN
  ORDS.DEFINE_TEMPLATE(
    p_module_name    => 'reerp',
    p_pattern        => 'ar/receipt-method-accounts',
    p_priority       => 0,
    p_etag_type      => 'HASH',
    p_comments       => 'AR Receipt Method Bank Accounts with GL Combinations, BU and Bank details'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'ar/receipt-method-accounts',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_collection_feed,
    p_items_per_page => 200,
    p_mimes_allowed  => '',
    p_comments       => 'GET receipt method accounts filtered by BU, method, bank account',
    p_source         => q'[
      SELECT v.*
      FROM RR_V_RECEIPT_METHODS_BANK_ACCOUNTS v
      WHERE 1=1
        AND (:receipt_method_id  IS NULL OR v.RECEIPT_METHOD_ID  = :receipt_method_id)
        AND (:bank_account_id    IS NULL OR v.BANK_ACCOUNT_ID    = :bank_account_id)
        AND (:org_id             IS NULL OR v.ORG_ID             = :org_id)
        AND (:business_unit_name IS NULL OR UPPER(v.BUSINESS_UNIT_NAME) LIKE '%' || UPPER(:business_unit_name) || '%')
      ORDER BY v.BUSINESS_UNIT_NAME, v.PRIMARY_FLAG DESC, v.ID
    ]'
  );
END;
/

COMMIT;
