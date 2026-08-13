-- ============================================================
-- 18_FA_DEPRN_BY_PERIOD_GET.SQL
--
-- New webservice: GET reerp/fa/deprn-by-period
--   Delegates to RR_FA_PKG.GET_DEPRN_BY_PERIOD (same pattern as
--   GET /fa/assets/:assetId/deprn -> RR_FA_PKG.GET_ASSET_DEPRN).
--   ** Deploy 08_rr_fa_pkg_spec.sql and 09_rr_fa_pkg_body.sql FIRST. **
--
--   Same source as GET /fa/assets/:assetId/deprn (RR_FA_DEPRN_DETAIL) but
--   for ALL assets of a book in ONE period — pass the period, get each
--   asset's depreciation amount.
--
--   All ACTIVE assets are returned (LEFT JOIN to the deprn detail), so an
--   asset with no depreciation for the period shows status 'Not Posted' with
--   a null amount; one that has it shows 'Posted' with the amount.
--
--   Params (query string):
--     bookTypeCode   (required) — FA book
--     periodName     (one of)   — e.g. 'May-26'  (resolved to period counter)
--     periodCounter  (one of)   — the period counter directly
--     assetNumber    (optional) — LIKE filter
--     limit/offset   (optional) — paging (default 2000 / 0)
--
--   Response: { success, periodCounter, periodName, totalCount, postedCount,
--               notPostedCount, summary:{ totalCost, totalDeprnAmount, totalNbv },
--               items:[ { assetId, assetNumber, description, cost, deprnAmount,
--                         ytdDeprn, deprnReserve, nbv, deprnRunDate,
--                         accountedStatus, status } ] }
--
-- HOW TO RUN: APEX SQL Workshop -> SQL Commands -> run the whole block.
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'fa/deprn-by-period', p_method => 'GET');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'reerp', p_pattern => 'fa/deprn-by-period');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-by-period',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: per-asset depreciation for a period (from RR_FA_DEPRN_DETAIL)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-by-period',
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
    RR_FA_PKG.GET_DEPRN_BY_PERIOD(
        p_book_type      => :bookTypeCode,
        p_period_name    => :periodName,
        p_period_counter => :periodCounter,
        p_asset_number   => :assetNumber,
        p_offset         => :offset,
        p_limit          => :limit,
        p_http_status    => v_status,
        p_result         => v_result
    );
    :status := v_status;
    -- Stream the CLOB in <32K chunks: HTP.P cannot emit a CLOB larger than
    -- 32767 chars (ORA-06502), and this response can exceed that for many assets.
    v_len := DBMS_LOB.GETLENGTH(v_result);
    WHILE v_pos <= v_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(v_result, v_amt, v_pos));
        v_pos := v_pos + v_amt;
    END LOOP;
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET fa/deprn-by-period registered OK');
END;
/
