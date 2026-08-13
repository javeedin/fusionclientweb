-- =============================================================================
-- 02_FA_GET_ASSETS.SQL
-- GET reerp/fa/assets          — search / list assets
-- GET reerp/fa/assets/:assetId — single asset detail
-- Business logic lives in RR_FA_PKG (09_rr_fa_pkg_body.sql).
-- =============================================================================


-- ============================================================
-- TEMPLATE: fa/assets
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: search / list assets'
    );
    COMMIT;
END;
/


-- ============================================================
-- GET fa/assets
-- Query params: description, bookTypeCode,
--               offset (default 0), limit (default 25)
--               assetStatus (ACTIVE|RETIRED)
-- ============================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
    v_offset NUMBER := 0;
    v_limit  NUMBER := 25;
    v_pos    PLS_INTEGER := 1;
    v_buf    VARCHAR2(32767);
BEGIN
    IF :offset IS NOT NULL THEN v_offset := TO_NUMBER(:offset); END IF;
    IF :limit  IS NOT NULL THEN v_limit  := TO_NUMBER(:limit);  END IF;

    RR_FA_PKG.GET_ASSETS(
        p_asset_number => :assetNumber,
        p_description  => :description,
        p_category     => :category,
        p_book_type    => :bookTypeCode,
        p_asset_type   => :assetType,
        p_status       => :assetStatus,
        p_offset       => v_offset,
        p_limit        => v_limit,
        p_http_status  => v_status,
        p_result       => v_result
    );

    :status := NVL(v_status, 200);
    LOOP
        v_buf := DBMS_LOB.SUBSTR(v_result, 32767, v_pos);
        EXIT WHEN v_buf IS NULL;
        HTP.PRN(v_buf);
        v_pos := v_pos + 32767;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- TEMPLATE: fa/assets/:assetId
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: single asset detail'
    );
    COMMIT;
END;
/


-- ============================================================
-- GET fa/assets/:assetId
-- ============================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
    v_pos    PLS_INTEGER := 1;
    v_buf    VARCHAR2(32767);
BEGIN
    RR_FA_PKG.GET_ASSET_DETAIL(
        p_asset_id    => :assetId,
        p_http_status => v_status,
        p_result      => v_result
    );
    :status := NVL(v_status, 200);
    LOOP
        v_buf := DBMS_LOB.SUBSTR(v_result, 32767, v_pos);
        EXIT WHEN v_buf IS NULL;
        HTP.PRN(v_buf);
        v_pos := v_pos + 32767;
    END LOOP;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/
