-- =============================================================================
-- 21_FA_DEPRN_POST_ASSET.SQL
-- POST  reerp/fa/deprn-post-asset  – create depreciation for one asset/period
-- DELETE reerp/fa/deprn-post-asset – delete depreciation (blocked if GL-posted)
--
-- Both handlers delegate all logic to RR_FA_DEPRN_PKG.
-- Deploy 22_fa_deprn_pkg.sql BEFORE this script.
-- =============================================================================

-- ── Clean up existing handlers / template ─────────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/deprn-post-asset',p_method=>'POST');   COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/deprn-post-asset',p_method=>'DELETE'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/deprn-post-asset'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- ── Template ──────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-post-asset',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: create / delete depreciation for a single asset/period'
    );
    COMMIT;
END;
/

-- ── POST fa/deprn-post-asset ──────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-post-asset',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body        CLOB := :body_text;
    v_http_status NUMBER;
    v_result      CLOB;
BEGIN
    RR_FA_DEPRN_PKG.CREATE_DEPRECIATION(
        p_asset_id     => JSON_VALUE(v_body, '$.assetId'),
        p_book         => JSON_VALUE(v_body, '$.bookTypeCode'),
        p_period_name  => JSON_VALUE(v_body, '$.periodName'),
        p_deprn_amount => TO_NUMBER(NVL(JSON_VALUE(v_body, '$.deprnAmount'), '0')),
        p_created_by   => NVL(JSON_VALUE(v_body, '$.createdBy'), 'REACTERP'),
        p_http_status  => v_http_status,
        p_result       => v_result
    );
    :status := v_http_status;
    HTP.P(v_result);
END;
        ]'
    );
    COMMIT;
END;
/

-- ── DELETE fa/deprn-post-asset ────────────────────────────────────────────────
-- Body: { "assetId": "...", "bookTypeCode": "...", "periodName": "MMM-YYYY" }
-- Returns 200 on success, 404 if not found, 409 if GL-transferred, 400/500 on error
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-post-asset',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body        CLOB := :body_text;
    v_http_status NUMBER;
    v_result      CLOB;
BEGIN
    RR_FA_DEPRN_PKG.DELETE_DEPRECIATION(
        p_asset_id    => JSON_VALUE(v_body, '$.assetId'),
        p_book        => JSON_VALUE(v_body, '$.bookTypeCode'),
        p_period_name => JSON_VALUE(v_body, '$.periodName'),
        p_deleted_by  => NVL(JSON_VALUE(v_body, '$.deletedBy'), 'REACTERP'),
        p_http_status => v_http_status,
        p_result      => v_result
    );
    :status := v_http_status;
    HTP.P(v_result);
END;
        ]'
    );
    COMMIT;
END;
/
