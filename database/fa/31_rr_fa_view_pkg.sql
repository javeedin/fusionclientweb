-- =============================================================================
-- 31_RR_FA_VIEW_PKG.SQL
--
-- Standalone package for the "View Depreciation" report and the depreciation
-- adjustment. Kept SEPARATE from RR_FA_PKG so these features can never
-- invalidate the core read package (GET_DEPRN_BY_PERIOD / GET_ASSETS / ...).
--
--   GET_DEPRN_VIEW  — read straight from RR_FA_DEPRN_DETAIL (by period / year)
--   ADJUST_DEPRN    — apply a manual adjustment to one posted period
--
-- Handlers 28_fa_deprn_view_get.sql and 29_fa_deprn_adjust_post.sql call this
-- package. Deploy this file AFTER the tables exist; it does not depend on
-- RR_FA_PKG.
-- =============================================================================

CREATE OR REPLACE PACKAGE RR_FA_VIEW_PKG AS

    PROCEDURE GET_DEPRN_VIEW (
        p_book_type      IN  VARCHAR2,
        p_period_name    IN  VARCHAR2,
        p_fiscal_year    IN  VARCHAR2,
        p_asset_number   IN  VARCHAR2,
        p_offset         IN  NUMBER,
        p_limit          IN  NUMBER,
        p_http_status    OUT NUMBER,
        p_result         OUT CLOB
    );

    PROCEDURE ADJUST_DEPRN (
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_period_counter  IN  VARCHAR2,
        p_distribution_id IN  VARCHAR2,
        p_adjustment      IN  NUMBER,
        p_updated_by      IN  VARCHAR2,
        p_http_status     OUT NUMBER,
        p_result          OUT CLOB
    );

    -- Adjust the asset COST by p_adjustment (may be negative), effective from
    -- period p_period_counter forward. Bumps RR_FA_BOOKS.COST/ADJUSTED_COST and,
    -- for period_counter >= p_period_counter, COST and DEPRN_RESERVE on both
    -- RR_FA_DEPRN_DETAIL and RR_FA_DEPRN_SUMMARY (NBV stays unchanged).
    PROCEDURE ADJUST_COST (
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_period_counter  IN  VARCHAR2,
        p_adjustment      IN  NUMBER,
        p_adjust_date     IN  VARCHAR2,
        p_updated_by      IN  VARCHAR2,
        p_http_status     OUT NUMBER,
        p_result          OUT CLOB
    );

END RR_FA_VIEW_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_FA_VIEW_PKG AS

    PROCEDURE write_error (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB,
        p_code        IN  NUMBER,
        p_msg         IN  VARCHAR2
    ) IS
    BEGIN
        p_http_status := p_code;
        p_result      := '{"success":false,"error":"' || REPLACE(p_msg, '"', '\"') || '"}';
    END write_error;

    -- ── Depreciation VIEW — read straight from RR_FA_DEPRN_DETAIL ──────────────
    PROCEDURE GET_DEPRN_VIEW (
        p_book_type      IN  VARCHAR2,
        p_period_name    IN  VARCHAR2,
        p_fiscal_year    IN  VARCHAR2,
        p_asset_number   IN  VARCHAR2,
        p_offset         IN  NUMBER,
        p_limit          IN  NUMBER,
        p_http_status    OUT NUMBER,
        p_result         OUT CLOB
    ) IS
        v_offset    NUMBER := NVL(p_offset, 0);
        v_limit     NUMBER := NVL(p_limit, 5000);
        v_total     NUMBER := 0;
        v_tot_cost  NUMBER := 0;
        v_tot_deprn NUMBER := 0;
    BEGIN
        IF p_book_type IS NULL THEN
            write_error(p_http_status, p_result, 400, 'bookTypeCode is required');
            RETURN;
        END IF;

        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',      TRUE);
        APEX_JSON.WRITE('bookTypeCode', p_book_type);
        APEX_JSON.WRITE('periodName',   p_period_name);
        APEX_JSON.WRITE('fiscalYear',   p_fiscal_year);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r IN (
            SELECT a.ASSET_ID, a.ASSET_NUMBER, a.DESCRIPTION,
                   p.PERIOD_NAME, p.PERIOD_COUNTER, p.FISCAL_YEAR,
                   b.COST                                          AS COST,
                   b.SALVAGE_VALUE                                 AS SALVAGE_VALUE,
                   b.DATE_PLACED_IN_SERVICE                        AS DATE_PLACED_IN_SERVICE,
                   b.DEPRN_START_DATE                              AS DEPRN_START_DATE,
                   m.LIFE_IN_MONTHS                                AS LIFE_IN_MONTHS,
                   m.METHOD_CODE                                   AS METHOD_CODE,
                   SUM(NVL(dd.DEPRN_AMOUNT, 0))                    AS DEPRN_AMOUNT,
                   SUM(NVL(dd.YTD_DEPRN, 0))                       AS YTD_DEPRN,
                   SUM(NVL(dd.DEPRN_RESERVE, 0))                   AS DEPRN_RESERVE,
                   MAX(dd.DEPRN_RUN_DATE)                          AS DEPRN_RUN_DATE,
                   MAX(dd.DISTRIBUTION_ID)                         AS DISTRIBUTION_ID,
                   MAX(NVL(dd.ACCOUNTED_STATUS, 'UNACCOUNTED'))    AS ACCOUNTED_STATUS
              FROM RR_FA_DEPRN_DETAIL dd
              JOIN RR_FA_DEPRN_PERIODS p
                    ON p.BOOK_TYPE_CODE = dd.BOOK_TYPE_CODE
                   AND p.PERIOD_COUNTER = dd.PERIOD_COUNTER
              JOIN RR_FA_ADDITIONS a ON a.ASSET_ID = dd.ASSET_ID
              JOIN RR_FA_BOOKS b
                    ON b.ASSET_ID = dd.ASSET_ID
                   AND b.BOOK_TYPE_CODE = dd.BOOK_TYPE_CODE
                   AND b.DATE_INEFFECTIVE IS NULL
              LEFT JOIN RR_FA_METHODS m ON m.METHOD_ID = b.METHOD_ID
             WHERE dd.BOOK_TYPE_CODE = p_book_type
               AND (p_period_name IS NULL OR UPPER(TRIM(p.PERIOD_NAME)) = UPPER(TRIM(p_period_name)))
               AND (p_fiscal_year IS NULL OR TO_CHAR(p.FISCAL_YEAR) = TO_CHAR(p_fiscal_year))
               AND (p_asset_number IS NULL OR UPPER(a.ASSET_NUMBER) LIKE UPPER('%' || p_asset_number || '%'))
             GROUP BY a.ASSET_ID, a.ASSET_NUMBER, a.DESCRIPTION,
                      p.PERIOD_NAME, p.PERIOD_COUNTER, p.FISCAL_YEAR,
                      b.COST, b.SALVAGE_VALUE, b.DATE_PLACED_IN_SERVICE, b.DEPRN_START_DATE,
                      m.LIFE_IN_MONTHS, m.METHOD_CODE
             ORDER BY a.ASSET_NUMBER, p.PERIOD_COUNTER
             OFFSET v_offset ROWS FETCH NEXT v_limit ROWS ONLY
        ) LOOP
            v_total     := v_total + 1;
            v_tot_cost  := v_tot_cost  + NVL(r.COST, 0);
            v_tot_deprn := v_tot_deprn + NVL(r.DEPRN_AMOUNT, 0);

            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('assetId',              r.ASSET_ID);
            APEX_JSON.WRITE('assetNumber',          r.ASSET_NUMBER);
            APEX_JSON.WRITE('description',          r.DESCRIPTION);
            APEX_JSON.WRITE('periodName',           r.PERIOD_NAME);
            APEX_JSON.WRITE('periodCounter',        r.PERIOD_COUNTER);
            APEX_JSON.WRITE('fiscalYear',           r.FISCAL_YEAR);
            APEX_JSON.WRITE('cost',                 r.COST);
            APEX_JSON.WRITE('salvageValue',         r.SALVAGE_VALUE);
            APEX_JSON.WRITE('lifeInMonths',         r.LIFE_IN_MONTHS);
            APEX_JSON.WRITE('methodCode',           r.METHOD_CODE);
            APEX_JSON.WRITE('datePlacedInService',  r.DATE_PLACED_IN_SERVICE);
            APEX_JSON.WRITE('deprnStartDate',       r.DEPRN_START_DATE);
            APEX_JSON.WRITE('deprnAmount',          r.DEPRN_AMOUNT);
            APEX_JSON.WRITE('ytdDeprn',             r.YTD_DEPRN);
            APEX_JSON.WRITE('deprnReserve',         r.DEPRN_RESERVE);
            APEX_JSON.WRITE('nbv',                  NVL(r.COST, 0) - NVL(r.DEPRN_RESERVE, 0));
            APEX_JSON.WRITE('deprnRunDate',         r.DEPRN_RUN_DATE);
            APEX_JSON.WRITE('distributionId',       r.DISTRIBUTION_ID);
            APEX_JSON.WRITE('accountedStatus',      r.ACCOUNTED_STATUS);
            APEX_JSON.WRITE('status',               'Posted');
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.WRITE('totalCount', v_total);
        APEX_JSON.OPEN_OBJECT('summary');
        APEX_JSON.WRITE('totalCost',        v_tot_cost);
        APEX_JSON.WRITE('totalDeprnAmount', v_tot_deprn);
        APEX_JSON.CLOSE_OBJECT;
        APEX_JSON.CLOSE_OBJECT;

        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_DEPRN_VIEW;

    -- ── Depreciation Adjustment ───────────────────────────────────────────────
    -- Identify the target line by ASSET_ID + BOOK + PERIOD_COUNTER (+ the
    -- distribution when supplied). Adds the amount to YTD_DEPRN + DEPRN_RESERVE,
    -- stores it in DEPRN_ADJUSTMENT_AMOUNT, marks the period ACCOUNTED — on both
    -- RR_FA_DEPRN_DETAIL and RR_FA_DEPRN_SUMMARY.
    PROCEDURE ADJUST_DEPRN (
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_period_counter  IN  VARCHAR2,
        p_distribution_id IN  VARCHAR2,
        p_adjustment      IN  NUMBER,
        p_updated_by      IN  VARCHAR2,
        p_http_status     OUT NUMBER,
        p_result          OUT CLOB
    ) IS
        v_adj      NUMBER := NVL(p_adjustment, 0);
        v_pc       NUMBER;
        v_rows_d   NUMBER := 0;
        v_rows_s   NUMBER := 0;
        v_new_ytd  NUMBER;
        v_new_res  NUMBER;
        v_new_adj  NUMBER;
        v_by       VARCHAR2(100) := NVL(p_updated_by, 'REACTERP');
    BEGIN
        IF p_asset_id IS NULL OR p_book IS NULL OR p_period_counter IS NULL THEN
            write_error(p_http_status, p_result, 400, 'assetId, bookTypeCode and periodCounter are required');
            RETURN;
        END IF;
        IF v_adj = 0 THEN
            write_error(p_http_status, p_result, 400, 'deprnAdjustmentAmount must be a non-zero number');
            RETURN;
        END IF;
        v_pc := TO_NUMBER(p_period_counter);

        UPDATE RR_FA_DEPRN_DETAIL
        SET    DEPRN_ADJUSTMENT_AMOUNT = NVL(DEPRN_ADJUSTMENT_AMOUNT, 0) + v_adj,
               YTD_DEPRN               = NVL(YTD_DEPRN, 0)               + v_adj,
               DEPRN_RESERVE           = NVL(DEPRN_RESERVE, 0)           + v_adj,
               ACCOUNTED_STATUS        = 'ACCOUNTED',
               ACCOUNTED_DATE          = SYSDATE,
               LAST_UPDATE_DATE        = SYSDATE,
               LAST_UPDATED_BY         = v_by
        WHERE  ASSET_ID       = TO_NUMBER(p_asset_id)
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER = v_pc
        AND    (p_distribution_id IS NULL
                OR p_distribution_id = '0'
                OR DISTRIBUTION_ID = TO_NUMBER(p_distribution_id));
        v_rows_d := SQL%ROWCOUNT;

        UPDATE RR_FA_DEPRN_SUMMARY
        SET    YTD_DEPRN        = NVL(YTD_DEPRN, 0)     + v_adj,
               DEPRN_RESERVE    = NVL(DEPRN_RESERVE, 0) + v_adj,
               ACCOUNTED_STATUS = 'ACCOUNTED',
               ACCOUNTED_DATE   = SYSDATE,
               LAST_UPDATE_DATE = SYSDATE,
               LAST_UPDATED_BY  = v_by
        WHERE  ASSET_ID       = TO_NUMBER(p_asset_id)
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER = v_pc;
        v_rows_s := SQL%ROWCOUNT;

        IF v_rows_d = 0 AND v_rows_s = 0 THEN
            ROLLBACK;
            write_error(p_http_status, p_result, 404, 'No depreciation row found for asset/book/period');
            RETURN;
        END IF;

        COMMIT;

        BEGIN
            SELECT YTD_DEPRN, DEPRN_RESERVE
              INTO v_new_ytd, v_new_res
              FROM RR_FA_DEPRN_SUMMARY
             WHERE ASSET_ID = TO_NUMBER(p_asset_id)
               AND BOOK_TYPE_CODE = p_book
               AND PERIOD_COUNTER = v_pc
               AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_new_ytd := NULL; v_new_res := NULL;
        END;
        BEGIN
            SELECT SUM(NVL(DEPRN_ADJUSTMENT_AMOUNT, 0))
              INTO v_new_adj
              FROM RR_FA_DEPRN_DETAIL
             WHERE ASSET_ID = TO_NUMBER(p_asset_id)
               AND BOOK_TYPE_CODE = p_book
               AND PERIOD_COUNTER = v_pc;
        EXCEPTION WHEN OTHERS THEN v_new_adj := NULL; END;

        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',               TRUE);
        APEX_JSON.WRITE('assetId',               p_asset_id);
        APEX_JSON.WRITE('bookTypeCode',          p_book);
        APEX_JSON.WRITE('periodCounter',         v_pc);
        APEX_JSON.WRITE('adjustment',            v_adj);
        APEX_JSON.WRITE('detailRowsUpdated',     v_rows_d);
        APEX_JSON.WRITE('summaryRowsUpdated',    v_rows_s);
        APEX_JSON.WRITE('deprnAdjustmentAmount', v_new_adj);
        APEX_JSON.WRITE('ytdDeprn',              v_new_ytd);
        APEX_JSON.WRITE('deprnReserve',          v_new_res);
        APEX_JSON.WRITE('accountedStatus',       'ACCOUNTED');
        APEX_JSON.CLOSE_OBJECT;

        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            write_error(p_http_status, p_result, 500, SQLERRM);
    END ADJUST_DEPRN;

    -- ── Cost Adjustment ───────────────────────────────────────────────────────
    -- Increase/decrease the asset cost by p_adjustment, effective from
    -- p_period_counter forward. Bumps RR_FA_BOOKS.COST + ADJUSTED_COST, and for
    -- period_counter >= p_period_counter bumps COST (detail) / ADJUSTED_COST
    -- (summary) and DEPRN_RESERVE by the same amount (so NBV is unchanged).
    PROCEDURE ADJUST_COST (
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_period_counter  IN  VARCHAR2,
        p_adjustment      IN  NUMBER,
        p_adjust_date     IN  VARCHAR2,
        p_updated_by      IN  VARCHAR2,
        p_http_status     OUT NUMBER,
        p_result          OUT CLOB
    ) IS
        v_adj      NUMBER := NVL(p_adjustment, 0);
        v_pc       NUMBER := NVL(TO_NUMBER(p_period_counter), 0);
        v_by       VARCHAR2(100) := NVL(p_updated_by, 'REACTERP');
        v_rows_b   NUMBER := 0;
        v_rows_d   NUMBER := 0;
        v_rows_s   NUMBER := 0;
        v_new_cost NUMBER;
        v_new_res  NUMBER;
    BEGIN
        IF p_asset_id IS NULL OR p_book IS NULL THEN
            write_error(p_http_status, p_result, 400, 'assetId and bookTypeCode are required');
            RETURN;
        END IF;
        IF v_adj = 0 THEN
            write_error(p_http_status, p_result, 400, 'adjustmentAmount must be a non-zero number');
            RETURN;
        END IF;

        -- 1) Asset book cost
        UPDATE RR_FA_BOOKS
        SET    COST          = NVL(COST, 0)          + v_adj,
               ADJUSTED_COST = NVL(ADJUSTED_COST, 0) + v_adj
        WHERE  ASSET_ID       = TO_NUMBER(p_asset_id)
        AND    BOOK_TYPE_CODE = p_book
        AND    DATE_INEFFECTIVE IS NULL;
        v_rows_b := SQL%ROWCOUNT;

        -- 2) Depreciation detail — from the effective period forward
        UPDATE RR_FA_DEPRN_DETAIL
        SET    COST             = NVL(COST, 0)          + v_adj,
               DEPRN_RESERVE    = NVL(DEPRN_RESERVE, 0) + v_adj,
               LAST_UPDATE_DATE = SYSDATE,
               LAST_UPDATED_BY  = v_by
        WHERE  ASSET_ID       = TO_NUMBER(p_asset_id)
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER >= v_pc;
        v_rows_d := SQL%ROWCOUNT;

        -- 3) Depreciation summary — from the effective period forward
        UPDATE RR_FA_DEPRN_SUMMARY
        SET    ADJUSTED_COST    = NVL(ADJUSTED_COST, 0) + v_adj,
               DEPRN_RESERVE    = NVL(DEPRN_RESERVE, 0) + v_adj,
               LAST_UPDATE_DATE = SYSDATE,
               LAST_UPDATED_BY  = v_by
        WHERE  ASSET_ID       = TO_NUMBER(p_asset_id)
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER >= v_pc;
        v_rows_s := SQL%ROWCOUNT;

        IF v_rows_b = 0 AND v_rows_d = 0 AND v_rows_s = 0 THEN
            ROLLBACK;
            write_error(p_http_status, p_result, 404, 'No asset / book / period rows found to adjust');
            RETURN;
        END IF;

        COMMIT;

        BEGIN
            SELECT COST INTO v_new_cost
              FROM RR_FA_BOOKS
             WHERE ASSET_ID = TO_NUMBER(p_asset_id) AND BOOK_TYPE_CODE = p_book
               AND DATE_INEFFECTIVE IS NULL AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_new_cost := NULL; END;
        BEGIN
            SELECT DEPRN_RESERVE INTO v_new_res
              FROM RR_FA_DEPRN_SUMMARY
             WHERE ASSET_ID = TO_NUMBER(p_asset_id) AND BOOK_TYPE_CODE = p_book
               AND PERIOD_COUNTER = (SELECT MAX(PERIOD_COUNTER) FROM RR_FA_DEPRN_SUMMARY
                                      WHERE ASSET_ID = TO_NUMBER(p_asset_id) AND BOOK_TYPE_CODE = p_book)
               AND ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN v_new_res := NULL; END;

        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',                 TRUE);
        APEX_JSON.WRITE('assetId',                 p_asset_id);
        APEX_JSON.WRITE('bookTypeCode',            p_book);
        APEX_JSON.WRITE('adjustment',              v_adj);
        APEX_JSON.WRITE('adjustDate',              p_adjust_date);
        APEX_JSON.WRITE('effectiveFromPeriod',     v_pc);
        APEX_JSON.WRITE('booksRowsUpdated',        v_rows_b);
        APEX_JSON.WRITE('detailRowsUpdated',       v_rows_d);
        APEX_JSON.WRITE('summaryRowsUpdated',      v_rows_s);
        APEX_JSON.WRITE('newCost',                 v_new_cost);
        APEX_JSON.WRITE('newDeprnReserve',         v_new_res);
        APEX_JSON.WRITE('newNbv',                  NVL(v_new_cost, 0) - NVL(v_new_res, 0));
        APEX_JSON.CLOSE_OBJECT;

        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            write_error(p_http_status, p_result, 500, SQLERRM);
    END ADJUST_COST;

END RR_FA_VIEW_PKG;
/
