-- ============================================================
-- 29_FA_DEPRN_ADJUST_POST.SQL
--
-- New webservice: POST reerp/fa/deprn-adjust
--   Delegates to RR_FA_VIEW_PKG.ADJUST_DEPRN.
--   ** Deploy 31_rr_fa_view_pkg.sql FIRST. **
--
--   Applies a manual depreciation adjustment to ONE posted period. The
--   adjustment amount is ADDED to YTD_DEPRN and DEPRN_RESERVE, stored in
--   DEPRN_ADJUSTMENT_AMOUNT, and the period is marked ACCOUNTED — on both
--   RR_FA_DEPRN_DETAIL and RR_FA_DEPRN_SUMMARY. Keyed by asset + book +
--   period counter (and a specific distribution when supplied).
--
--   Request body:
--   {
--     "assetId":               "100001",
--     "bookTypeCode":          "BUIMERC ASSET BOOK",
--     "periodCounter":         447,
--     "distributionId":        12345,      -- optional; targets one detail row
--     "deprnAdjustmentAmount": 500.00,     -- delta to add (may be negative)
--     "updatedBy":             "JSMITH"    -- optional; defaults to REACTERP
--   }
--
--   Returns 200 { success, detailRowsUpdated, summaryRowsUpdated,
--                 deprnAdjustmentAmount, ytdDeprn, deprnReserve,
--                 accountedStatus } or 400/404/500 { success:false, error }.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/deprn-adjust', p_method => 'POST');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/deprn-adjust');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-adjust',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: apply a depreciation adjustment (updates DETAIL + SUMMARY)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-adjust',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body   CLOB := :body_text;
    v_status NUMBER;
    v_result CLOB;
BEGIN
    RR_FA_VIEW_PKG.ADJUST_DEPRN(
        p_asset_id        => JSON_VALUE(v_body, '$.assetId'),
        p_book            => JSON_VALUE(v_body, '$.bookTypeCode'),
        p_period_counter  => JSON_VALUE(v_body, '$.periodCounter'),
        p_distribution_id => JSON_VALUE(v_body, '$.distributionId'),
        p_adjustment      => TO_NUMBER(JSON_VALUE(v_body, '$.deprnAdjustmentAmount')),
        p_updated_by      => NVL(JSON_VALUE(v_body, '$.updatedBy'), 'REACTERP'),
        p_http_status     => v_status,
        p_result          => v_result
    );
    :status := v_status;
    HTP.P(v_result);
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST fa/deprn-adjust registered OK');
END;
/
