-- =============================================================================
-- 07_FA_GET_DEPRN_WORKBENCH.SQL
-- GET reerp/fa/deprn-workbench
-- Aggregated depreciation view across all assets for a given book + period
-- Query params: bookTypeCode (required), periodCounter (optional),
--               assetNumber (optional), offset, limit
-- =============================================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-workbench',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: depreciation workbench — assets x periods'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-workbench',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_offset     NUMBER := NVL(:offset, 0);
    v_limit      NUMBER := NVL(:limit,  50);
    v_total      NUMBER := 0;

    v_where      VARCHAR2(2000) := ' WHERE 1=1 ';
    v_sql_count  VARCHAR2(4000);
    v_sql_main   VARCHAR2(4000);

    TYPE t_cur IS REF CURSOR;
    v_cur        t_cur;

    v_asset_id          VARCHAR2(100);
    v_asset_number      VARCHAR2(200);
    v_description       VARCHAR2(4000);
    v_book_type_code    VARCHAR2(100);
    v_period_counter    VARCHAR2(50);
    v_period_name       VARCHAR2(100);
    v_fiscal_year       VARCHAR2(50);
    v_deprn_amount      VARCHAR2(100);
    v_ytd_deprn         VARCHAR2(100);
    v_deprn_reserve     VARCHAR2(100);
    v_adjusted_cost     VARCHAR2(100);
    v_nbv               VARCHAR2(100);
    v_deprn_run_date    VARCHAR2(100);
    v_salvage_value     VARCHAR2(100);

    -- Summary accumulators (using VARCHAR2 for dynamic SQL output)
    v_total_cost        NUMBER := 0;
    v_total_reserve     NUMBER := 0;
    v_total_nbv         NUMBER := 0;
    v_total_deprn       NUMBER := 0;
BEGIN
    IF :bookTypeCode IS NOT NULL THEN
        v_where := v_where || ' AND ds.BOOK_TYPE_CODE = ''' || :bookTypeCode || '''';
    END IF;
    IF :periodCounter IS NOT NULL THEN
        v_where := v_where || ' AND ds.PERIOD_COUNTER = ' || TO_NUMBER(:periodCounter);
    ELSE
        -- Default: latest period per asset+book
        v_where := v_where || ' AND ds.PERIOD_COUNTER = ('
            || ' SELECT MAX(ds2.PERIOD_COUNTER) FROM RR_FA_DEPRN_SUMMARY ds2'
            || ' WHERE ds2.ASSET_ID = ds.ASSET_ID AND ds2.BOOK_TYPE_CODE = ds.BOOK_TYPE_CODE)';
    END IF;
    IF :assetNumber IS NOT NULL THEN
        v_where := v_where || ' AND UPPER(a.ASSET_NUMBER) LIKE UPPER(''%' || :assetNumber || '%'')';
    END IF;

    v_sql_count :=
        'SELECT COUNT(*) '
     || 'FROM RR_FA_DEPRN_SUMMARY ds '
     || 'JOIN RR_FA_ADDITIONS a ON a.ASSET_ID = ds.ASSET_ID '
     || v_where;

    EXECUTE IMMEDIATE v_sql_count INTO v_total;

    v_sql_main :=
        'SELECT a.ASSET_ID, a.ASSET_NUMBER, a.DESCRIPTION, '
     || '       ds.BOOK_TYPE_CODE, ds.PERIOD_COUNTER, '
     || '       NVL(dp.PERIOD_NAME, TO_CHAR(ds.PERIOD_COUNTER)), '
     || '       NVL(dp.FISCAL_YEAR, ''--''), '
     || '       NVL(ds.DEPRN_AMOUNT,0), NVL(ds.YTD_DEPRN,0), '
     || '       NVL(ds.DEPRN_RESERVE,0), NVL(ds.ADJUSTED_COST,0), '
     || '       NVL(ds.ADJUSTED_COST,0) - NVL(ds.DEPRN_RESERVE,0), '
     || '       ds.DEPRN_RUN_DATE, '
     || '       NVL(b.SALVAGE_VALUE,0) '
     || 'FROM  RR_FA_DEPRN_SUMMARY ds '
     || 'JOIN  RR_FA_ADDITIONS a ON a.ASSET_ID = ds.ASSET_ID '
     || 'LEFT JOIN RR_FA_DEPRN_PERIODS dp '
     || '      ON dp.BOOK_TYPE_CODE = ds.BOOK_TYPE_CODE '
     || '     AND dp.PERIOD_COUNTER = ds.PERIOD_COUNTER '
     || 'LEFT JOIN (SELECT ASSET_ID, BOOK_TYPE_CODE, SALVAGE_VALUE '
     || '           FROM RR_FA_BOOKS WHERE DATE_INEFFECTIVE IS NULL) b '
     || '      ON b.ASSET_ID = ds.ASSET_ID AND b.BOOK_TYPE_CODE = ds.BOOK_TYPE_CODE '
     || v_where
     || ' ORDER BY a.ASSET_NUMBER '
     || ' OFFSET ' || v_offset || ' ROWS FETCH NEXT ' || v_limit || ' ROWS ONLY';

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',    TRUE);
    APEX_JSON.WRITE('totalCount', v_total);
    APEX_JSON.WRITE('offset',     v_offset);
    APEX_JSON.WRITE('limit',      v_limit);
    APEX_JSON.OPEN_ARRAY('items');

    OPEN v_cur FOR v_sql_main;
    LOOP
        FETCH v_cur INTO
            v_asset_id, v_asset_number, v_description,
            v_book_type_code, v_period_counter, v_period_name, v_fiscal_year,
            v_deprn_amount, v_ytd_deprn, v_deprn_reserve,
            v_adjusted_cost, v_nbv, v_deprn_run_date, v_salvage_value;
        EXIT WHEN v_cur%NOTFOUND;

        v_total_cost    := v_total_cost    + NVL(TO_NUMBER(v_adjusted_cost),0);
        v_total_reserve := v_total_reserve + NVL(TO_NUMBER(v_deprn_reserve),0);
        v_total_nbv     := v_total_nbv     + NVL(TO_NUMBER(v_nbv),0);
        v_total_deprn   := v_total_deprn   + NVL(TO_NUMBER(v_deprn_amount),0);

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('assetId',       v_asset_id);
        APEX_JSON.WRITE('assetNumber',   v_asset_number);
        APEX_JSON.WRITE('description',   v_description);
        APEX_JSON.WRITE('bookTypeCode',  v_book_type_code);
        APEX_JSON.WRITE('periodCounter', v_period_counter);
        APEX_JSON.WRITE('periodName',    v_period_name);
        APEX_JSON.WRITE('fiscalYear',    v_fiscal_year);
        APEX_JSON.WRITE('deprnAmount',   v_deprn_amount);
        APEX_JSON.WRITE('ytdDeprn',      v_ytd_deprn);
        APEX_JSON.WRITE('deprnReserve',  v_deprn_reserve);
        APEX_JSON.WRITE('adjustedCost',  v_adjusted_cost);
        APEX_JSON.WRITE('nbv',           v_nbv);
        APEX_JSON.WRITE('salvageValue',  v_salvage_value);
        APEX_JSON.WRITE('deprnRunDate',  v_deprn_run_date);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    CLOSE v_cur;

    APEX_JSON.CLOSE_ARRAY;

    -- Summary totals
    APEX_JSON.OPEN_OBJECT('summary');
    APEX_JSON.WRITE('totalCost',        v_total_cost);
    APEX_JSON.WRITE('totalDeprnReserve',v_total_reserve);
    APEX_JSON.WRITE('totalNbv',         v_total_nbv);
    APEX_JSON.WRITE('totalDeprnAmount', v_total_deprn);
    APEX_JSON.CLOSE_OBJECT;

    APEX_JSON.CLOSE_OBJECT;
    :status := 200;
    HTP.P(APEX_JSON.GET_CLOB_OUTPUT);
    APEX_JSON.FREE_OUTPUT;

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.P('{"success":false,"error":"'||REPLACE(SQLERRM,'"','\"')||'"}');
END;
        ]'
    );
    COMMIT;
END;
/
