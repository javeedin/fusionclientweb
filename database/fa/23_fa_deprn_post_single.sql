-- =============================================================================
-- 23_FA_DEPRN_POST_SINGLE.SQL
-- POST reerp/fa/deprn-post-single
--
-- Posts depreciation for ONE asset / ONE period.
-- Checks for an existing record first — skips silently if already posted
-- (no 409 error, returns ALREADY_EXISTS status instead).
-- Delegates all logic to RR_FA_DEPRN_PKG.POST_ASSET_DEPRECIATION.
--
-- Request body:
-- {
--   "assetId":      "100083",
--   "bookTypeCode": "SB ASSET BOOK",
--   "periodName":   "Apr-2025",
--   "deprnAmount":  23687.46,        -- optional; 0 or omit = server calculates STL
--   "createdBy":    "JSMITH"         -- optional; defaults to REACTERP
-- }
--
-- Returns:
--   200  { success:true,  status:"POSTED",         message:"..." }
--   200  { success:true,  status:"ALREADY_EXISTS", message:"..." }
--   400  { success:false, status:"ERROR",           message:"..." }
--   500  { success:false, status:"ERROR",           message:"..." }
--
-- Deploy 22_fa_deprn_pkg.sql BEFORE this script.
-- =============================================================================

-- ── Clean up ──────────────────────────────────────────────────────────────────
BEGIN ORDS.DELETE_HANDLER(p_module_name=>'reerp',p_pattern=>'fa/deprn-post-single',p_method=>'POST'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN ORDS.DELETE_TEMPLATE(p_module_name=>'reerp',p_pattern=>'fa/deprn-post-single'); COMMIT; EXCEPTION WHEN OTHERS THEN NULL; END;
/

-- ── Template ──────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-post-single',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: check-then-post depreciation for a single asset/period'
    );
    COMMIT;
END;
/

-- ── POST fa/deprn-post-single ─────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-post-single',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body            CLOB    := :body_text;
    v_status          VARCHAR2(30);
    v_message         VARCHAR2(500);
    v_distribution_id NUMBER;
BEGIN
    RR_FA_DEPRN_PKG.POST_ASSET_DEPRECIATION(
        p_asset_id        => JSON_VALUE(v_body, '$.assetId'),
        p_book            => JSON_VALUE(v_body, '$.bookTypeCode'),
        p_period_name     => JSON_VALUE(v_body, '$.periodName'),
        p_deprn_amount    => ROUND(TO_NUMBER(NVL(JSON_VALUE(v_body, '$.deprnAmount'), '0')), 2),
        p_created_by      => NVL(JSON_VALUE(v_body, '$.createdBy'), 'REACTERP'),
        p_status          => v_status,
        p_message         => v_message,
        p_distribution_id => v_distribution_id
    );

    :status := CASE v_status WHEN 'ERROR' THEN 400 ELSE 200 END;

    HTP.P('{"success":'       || CASE v_status WHEN 'ERROR' THEN 'false' ELSE 'true' END
       || ',"status":"'       || v_status  || '"'
       || ',"message":"'      || REPLACE(v_message, '"', '\"') || '"'
       || ',"distributionId":' || NVL(TO_CHAR(v_distribution_id), 'null')
       || '}');

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status := 500;
        HTP.P('{"success":false,"status":"ERROR","message":"'
           || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/
