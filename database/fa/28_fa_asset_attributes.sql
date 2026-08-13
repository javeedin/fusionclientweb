-- =============================================================================
-- 28_FA_ASSET_ATTRIBUTES.SQL
--
-- 1. Add ATTRIBUTE1–10 columns to RR_FA_ADDITIONS (safe re-run)
-- 2. ORDS handler: PUT fa/assets/:assetId/attributes
--
-- NOTE: GET_ASSET_DETAIL is updated in 09_rr_fa_pkg_body.sql — run that file
--       (or just run 09_rr_fa_pkg_body.sql) to pick up the attribute columns
--       in the GET response.
-- =============================================================================

-- ── 1. Add attribute columns ──────────────────────────────────────────────────
DECLARE
    PROCEDURE add_col (p_col VARCHAR2) IS
        v_exists NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_exists FROM USER_TAB_COLUMNS
        WHERE  TABLE_NAME = 'RR_FA_ADDITIONS' AND COLUMN_NAME = UPPER(p_col);
        IF v_exists = 0 THEN
            EXECUTE IMMEDIATE 'ALTER TABLE RR_FA_ADDITIONS ADD (' || p_col || ' VARCHAR2(150))';
        END IF;
    END;
BEGIN
    add_col('ATTRIBUTE1');
    add_col('ATTRIBUTE2');
    add_col('ATTRIBUTE3');
    add_col('ATTRIBUTE4');
    add_col('ATTRIBUTE5');
    add_col('ATTRIBUTE6');
    add_col('ATTRIBUTE7');
    add_col('ATTRIBUTE8');
    add_col('ATTRIBUTE9');
    add_col('ATTRIBUTE10');
END;
/

-- ── 2. ORDS: PUT fa/assets/:assetId/attributes ───────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/assets/:assetId/attributes',p_method=>'PUT');  COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/assets/:assetId/attributes'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/assets/:assetId/attributes',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: update flexfield attributes for an asset'
    );
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/assets/:assetId/attributes',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body       CLOB := :body_text;
    v_asset_id   VARCHAR2(400) := :assetId;
    v_rows       NUMBER;
    v_updated_by VARCHAR2(400);
BEGIN
    APEX_JSON.PARSE(v_body);
    v_updated_by := NVL(APEX_JSON.GET_VARCHAR2(p_path=>'updatedBy'), 'REACTERP');

    UPDATE RR_FA_ADDITIONS SET
        ATTRIBUTE1       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute1'),
        ATTRIBUTE2       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute2'),
        ATTRIBUTE3       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute3'),
        ATTRIBUTE4       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute4'),
        ATTRIBUTE5       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute5'),
        ATTRIBUTE6       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute6'),
        ATTRIBUTE7       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute7'),
        ATTRIBUTE8       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute8'),
        ATTRIBUTE9       = APEX_JSON.GET_VARCHAR2(p_path=>'attribute9'),
        ATTRIBUTE10      = APEX_JSON.GET_VARCHAR2(p_path=>'attribute10'),
        LAST_UPDATED_BY  = v_updated_by,
        LAST_UPDATE_DATE = SYSTIMESTAMP
    WHERE ASSET_ID = v_asset_id;

    v_rows := SQL%ROWCOUNT;

    IF v_rows = 0 THEN
        :status := 404;
        HTP.PRN('{"success":false,"error":"Asset not found: ' || v_asset_id || '"}');
        RETURN;
    END IF;

    COMMIT;
    :status := 200;
    HTP.PRN('{"success":true,"assetId":"' || v_asset_id || '","rowsUpdated":' || v_rows || ',"message":"Attributes saved"}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status := 500;
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/
