-- ============================================================
-- 27_FA_DEPRN_VIEW_GET.SQL
--
-- New webservice: GET reerp/fa/deprn-view
--   Delegates to RR_FA_VIEW_PKG.GET_DEPRN_VIEW.
--   ** Deploy 31_rr_fa_view_pkg.sql FIRST. **
--
--   Reads depreciation STRAIGHT from RR_FA_DEPRN_DETAIL (joined to
--   RR_FA_DEPRN_PERIODS only for the period name / fiscal year label).
--   No open/last/max period gating and no straight-line calculation — it
--   returns the actual posted depreciation that exists in the detail table.
--
--   Used by the "View Depreciation" report tab.
--
--   Params (query string, all optional except bookTypeCode):
--     bookTypeCode  (required) — FA book
--     periodName    (optional) — one period, e.g. 'Mar-26'
--     fiscalYear    (optional) — a full year, e.g. '26' / '2026'
--     assetNumber   (optional) — LIKE filter
--     limit/offset  (optional) — paging (default 5000 / 0)
--
--   Response: { success, bookTypeCode, periodName, fiscalYear, totalCount,
--               summary:{ totalCost, totalDeprnAmount },
--               items:[ { assetId, assetNumber, description, periodName,
--                         periodCounter, fiscalYear, cost, salvageValue,
--                         lifeInMonths, methodCode, datePlacedInService,
--                         deprnStartDate, deprnAmount, ytdDeprn, deprnReserve,
--                         nbv, deprnRunDate, distributionId, accountedStatus,
--                         status } ] }
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/deprn-view', p_method => 'GET');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/deprn-view');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-view',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: depreciation VIEW straight from RR_FA_DEPRN_DETAIL (by period/year)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-view',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_source         => q'[
DECLARE
    v_status NUMBER;
    v_result CLOB;
    v_len    NUMBER;
    v_pos    NUMBER := 1;
    v_amt    NUMBER := 8000;
BEGIN
    RR_FA_VIEW_PKG.GET_DEPRN_VIEW(
        p_book_type     => :bookTypeCode,
        p_period_name   => :periodName,
        p_fiscal_year   => :fiscalYear,
        p_asset_number  => :assetNumber,
        p_offset        => :offset,
        p_limit         => :limit,
        p_http_status   => v_status,
        p_result        => v_result
    );
    :status := v_status;
    -- Stream the CLOB in <32K chunks (HTP.P errors ORA-06502 on a CLOB > 32767).
    v_len := DBMS_LOB.GETLENGTH(v_result);
    WHILE v_pos <= v_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_amt, v_pos));
        v_pos := v_pos + v_amt;
    END LOOP;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET fa/deprn-view registered OK');
END;
/
