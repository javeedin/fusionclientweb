-- ============================================================
-- 32_FA_COST_ADJUST_POST.SQL
--
-- New webservice: POST reerp/fa/cost-adjust
--   Delegates to RR_FA_VIEW_PKG.ADJUST_COST.
--   ** Deploy 31_rr_fa_view_pkg.sql FIRST. **
--
--   Increase/decrease an asset's cost, effective from a period forward. Bumps
--   RR_FA_BOOKS.COST + ADJUSTED_COST and, for period_counter >= periodCounter,
--   COST/ADJUSTED_COST and DEPRN_RESERVE on RR_FA_DEPRN_DETAIL / _SUMMARY by the
--   same amount (NBV unchanged).
--
--   Request body:
--   {
--     "assetId":          "100001",
--     "bookTypeCode":     "BUIMERC ASSET BOOK",
--     "periodCounter":    447,          -- effective-from period (>= this)
--     "adjustmentAmount": 50000,        -- +increase / -decrease
--     "adjustDate":       "2026-04-30", -- reference / value date
--     "updatedBy":        "JSMITH"
--   }
--
--   Returns 200 { success, booksRowsUpdated, detailRowsUpdated,
--                 summaryRowsUpdated, newCost, newDeprnReserve, newNbv }
--   or 400/404/500 { success:false, error }.
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/cost-adjust', p_method => 'POST');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/cost-adjust');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/cost-adjust',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: adjust asset cost (+ reserve) from a period forward'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/cost-adjust',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body   CLOB := :body_text;
    v_status NUMBER;
    v_result CLOB;
BEGIN
    RR_FA_VIEW_PKG.ADJUST_COST(
        p_asset_id       => JSON_VALUE(v_body, '$.assetId'),
        p_book           => JSON_VALUE(v_body, '$.bookTypeCode'),
        p_period_counter => JSON_VALUE(v_body, '$.periodCounter'),
        p_adjustment     => TO_NUMBER(JSON_VALUE(v_body, '$.adjustmentAmount')),
        p_adjust_date    => JSON_VALUE(v_body, '$.adjustDate'),
        p_updated_by     => NVL(JSON_VALUE(v_body, '$.updatedBy'), 'REACTERP'),
        p_http_status    => v_status,
        p_result         => v_result
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
    DBMS_OUTPUT.PUT_LINE('POST fa/cost-adjust registered OK');
END;
/
