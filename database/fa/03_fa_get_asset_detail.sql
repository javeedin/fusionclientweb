-- =============================================================================
-- 03_FA_GET_ASSET_DETAIL.SQL
-- GET reerp/fa/assets/:assetId/books
-- GET reerp/fa/assets/:assetId/deprn
-- GET reerp/fa/assets/:assetId/distributions
-- GET reerp/fa/assets/:assetId/invoices
-- GET reerp/fa/assets/:assetId/transactions
-- Business logic lives in RR_FA_PKG (09_rr_fa_pkg_body.sql).
-- =============================================================================


-- ============================================================
-- 1. GET fa/assets/:assetId/books
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/books',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: book details for an asset'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/books',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
BEGIN
    RR_FA_PKG.GET_ASSET_BOOKS(
        p_asset_id    => :assetId,
        p_http_status => v_status,
        p_result      => v_result
    );
    :status := v_status;
    HTP.P(v_result);
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 2. GET fa/assets/:assetId/deprn
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/deprn',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: depreciation history for an asset'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/deprn',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
BEGIN
    RR_FA_PKG.GET_ASSET_DEPRN(
        p_asset_id    => :assetId,
        p_http_status => v_status,
        p_result      => v_result
    );
    :status := v_status;
    HTP.P(v_result);
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 3. GET fa/assets/:assetId/distributions
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/distributions',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: distribution history for an asset'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/distributions',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
BEGIN
    RR_FA_PKG.GET_ASSET_DISTRIBUTIONS(
        p_asset_id    => :assetId,
        p_http_status => v_status,
        p_result      => v_result
    );
    :status := v_status;
    HTP.P(v_result);
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 4. GET fa/assets/:assetId/invoices
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/invoices',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: source invoice lines for an asset'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/invoices',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
BEGIN
    RR_FA_PKG.GET_ASSET_INVOICES(
        p_asset_id    => :assetId,
        p_http_status => v_status,
        p_result      => v_result
    );
    :status := v_status;
    HTP.P(v_result);
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 5. GET fa/assets/:assetId/transactions
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/transactions',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: transaction history for an asset'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/transactions',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
BEGIN
    RR_FA_PKG.GET_ASSET_TRANSACTIONS(
        p_asset_id    => :assetId,
        p_http_status => v_status,
        p_result      => v_result
    );
    :status := v_status;
    HTP.P(v_result);
END;
        ]'
    );
    COMMIT;
END;
/
