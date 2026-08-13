-- =============================================================================
-- 22_FA_DEPRN_PKG.SQL
-- Package RR_FA_DEPRN_PKG
--
-- Procedures:
--   CREATE_DEPRECIATION  — post depreciation for one asset / one period
--   DELETE_DEPRECIATION  — reverse/delete depreciation if NOT yet posted to GL
--
--   POST_ASSET_DEPRECIATION — check-then-post for one asset (PL/SQL-callable)
--
-- Run this file BEFORE 21_fa_deprn_post_asset.sql (handlers reference the pkg).
-- =============================================================================


-- ── Package Spec ──────────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE RR_FA_DEPRN_PKG AS

    -- -------------------------------------------------------------------------
    -- CREATE_DEPRECIATION
    -- Posts STL depreciation for a single asset for one named period.
    -- p_deprn_amount   client-supplied pre-calculated amount (0 = recalculate).
    -- p_http_status    200 = posted, 409 = already exists, 400/500 = error.
    -- p_result         JSON response CLOB.
    -- -------------------------------------------------------------------------
    PROCEDURE CREATE_DEPRECIATION (
        p_asset_id     IN  VARCHAR2,
        p_book         IN  VARCHAR2,
        p_period_name  IN  VARCHAR2,
        p_deprn_amount IN  NUMBER   DEFAULT 0,
        p_created_by   IN  VARCHAR2 DEFAULT 'REACTERP',
        p_http_status  OUT NUMBER,
        p_result       OUT CLOB
    );

    -- -------------------------------------------------------------------------
    -- DELETE_DEPRECIATION
    -- Removes a depreciation record for one asset / one period.
    -- Blocked when PERIOD_CLOSE_DATE is set on RR_FA_DEPRN_PERIODS
    -- (closed period cannot be reversed).
    -- p_http_status    200 = deleted, 404 = not found, 409 = period closed, 500 = error.
    -- -------------------------------------------------------------------------
    PROCEDURE DELETE_DEPRECIATION (
        p_asset_id     IN  VARCHAR2,
        p_book         IN  VARCHAR2,
        p_period_name  IN  VARCHAR2,
        p_deleted_by   IN  VARCHAR2 DEFAULT 'REACTERP',
        p_http_status  OUT NUMBER,
        p_result       OUT CLOB
    );

    -- -------------------------------------------------------------------------
    -- POST_ASSET_DEPRECIATION
    -- Check-then-post for a single asset.  Pure PL/SQL — no HTTP codes.
    --
    -- p_deprn_amount   0 = recalculate server-side (STL)
    -- p_status    OUT  'POSTED'         — inserted successfully
    --                  'ALREADY_EXISTS' — record found, skipped
    --                  'ERROR'          — unexpected failure (see p_message)
    -- p_message   OUT  human-readable detail
    -- -------------------------------------------------------------------------
    PROCEDURE POST_ASSET_DEPRECIATION (
        p_asset_id        IN  VARCHAR2,
        p_book            IN  VARCHAR2,
        p_period_name     IN  VARCHAR2,
        p_deprn_amount    IN  NUMBER   DEFAULT 0,
        p_created_by      IN  VARCHAR2 DEFAULT 'REACTERP',
        p_status          OUT VARCHAR2,
        p_message         OUT VARCHAR2,
        p_distribution_id OUT NUMBER
    );

END RR_FA_DEPRN_PKG;
/


-- ── Package Body ──────────────────────────────────────────────────────────────
CREATE OR REPLACE PACKAGE BODY RR_FA_DEPRN_PKG AS

    -- ── Private: JSON string helper ───────────────────────────────────────────
    FUNCTION jstr (p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN 'null'; END IF;
        RETURN '"' || REPLACE(REPLACE(p_val, '\', '\\'), '"', '\"') || '"';
    END jstr;

    -- ── Private: resolve period_counter from period_name + book ──────────────
    -- Search order:
    --   1. RR_FA_DEPRN_PERIODS (PERIOD_COUNTER, FISCAL_YEAR, PERIOD_NUM exist)
    --   2. Auto-generate: max existing counter + 1, derive FY/num from name
    -- NOTE: RR_FA_CALENDAR_PERIODS has no PERIOD_COUNTER column — not used.
    PROCEDURE resolve_period (
        p_book         IN  VARCHAR2,
        p_period_name  IN  VARCHAR2,
        p_counter      OUT NUMBER,
        p_fiscal_year  OUT NUMBER,
        p_period_num   OUT NUMBER
    ) IS
    BEGIN
        -- 1. Look up in RR_FA_DEPRN_PERIODS
        BEGIN
            SELECT TO_NUMBER(PERIOD_COUNTER),
                   TO_NUMBER(FISCAL_YEAR),
                   TO_NUMBER(PERIOD_NUM)
            INTO   p_counter, p_fiscal_year, p_period_num
            FROM   RR_FA_DEPRN_PERIODS
            WHERE  BOOK_TYPE_CODE = p_book
            AND    UPPER(PERIOD_NAME) = UPPER(p_period_name)
            AND    ROWNUM = 1;
            RETURN;
        EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
        END;

        -- 2. Auto-generate counter; derive FY and period_num from name (MMM-YYYY)
        SELECT NVL(MAX(TO_NUMBER(PERIOD_COUNTER)), 0) + 1
        INTO   p_counter
        FROM   RR_FA_DEPRN_PERIODS
        WHERE  BOOK_TYPE_CODE = p_book;

        p_fiscal_year := TO_NUMBER(SUBSTR(p_period_name,
                             INSTR(p_period_name, '-') + 1));

        p_period_num  := CASE UPPER(SUBSTR(p_period_name, 1, 3))
            WHEN 'JAN' THEN 1   WHEN 'FEB' THEN 2   WHEN 'MAR' THEN 3
            WHEN 'APR' THEN 4   WHEN 'MAY' THEN 5   WHEN 'JUN' THEN 6
            WHEN 'JUL' THEN 7   WHEN 'AUG' THEN 8   WHEN 'SEP' THEN 9
            WHEN 'OCT' THEN 10  WHEN 'NOV' THEN 11  WHEN 'DEC' THEN 12
            ELSE 1
        END;
    END resolve_period;

    -- ── Private: ensure period row exists in RR_FA_DEPRN_PERIODS ─────────────
    PROCEDURE ensure_period_row (
        p_book         IN VARCHAR2,
        p_period_name  IN VARCHAR2,
        p_counter      IN NUMBER,
        p_fiscal_year  IN NUMBER,
        p_period_num   IN NUMBER
    ) IS
        v_exists NUMBER := 0;
    BEGIN
        SELECT COUNT(*) INTO v_exists
        FROM   RR_FA_DEPRN_PERIODS
        WHERE  BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER = p_counter;

        IF v_exists = 0 THEN
            INSERT INTO RR_FA_DEPRN_PERIODS (
                BOOK_TYPE_CODE, PERIOD_COUNTER, PERIOD_NAME,
                FISCAL_YEAR, PERIOD_NUM, PERIOD_OPEN_DATE, DEPRN_RUN
            ) VALUES (
                p_book, p_counter, p_period_name,
                p_fiscal_year, p_period_num,
                TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS".000+00:00"'),
                'Y'
            );
        ELSE
            UPDATE RR_FA_DEPRN_PERIODS
            SET    DEPRN_RUN = 'Y'
            WHERE  BOOK_TYPE_CODE = p_book
            AND    PERIOD_COUNTER = p_counter;
        END IF;
    END ensure_period_row;

    -- ── Private: insert one row into DEPRN_SUMMARY + DEPRN_DETAIL ────────────
    -- Called by both CREATE_DEPRECIATION and POST_ASSET_DEPRECIATION.
    -- Always generates a NEW DISTRIBUTION_ID per deprn detail row (unique per period).
    PROCEDURE post_deprn_rows (
        p_asset_id         IN  VARCHAR2,
        p_book             IN  VARCHAR2,
        p_period_ctr       IN  NUMBER,
        p_period_name      IN  VARCHAR2,
        p_deprn_amount     IN  NUMBER,
        p_new_ytd          IN  NUMBER,
        p_new_reserve      IN  NUMBER,
        p_adj_cost         IN  NUMBER,
        p_created_by       IN  VARCHAR2,
        p_distribution_id  OUT NUMBER          -- returns the distribution_id used
    ) IS
        v_dist_id   NUMBER;
        v_now       VARCHAR2(50) := TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS".000+00:00"');
    BEGIN
        -- Always generate a unique DISTRIBUTION_ID per deprn detail row
        SELECT RR_FA_DISTRIBUTION_ID_SEQ.NEXTVAL
        INTO   v_dist_id
        FROM   DUAL;

        INSERT INTO RR_FA_DISTRIBUTION_HISTORY (
            DISTRIBUTION_ID, BOOK_TYPE_CODE, ASSET_ID,
            UNITS_ASSIGNED, TRANSACTION_UNITS,
            DATE_EFFECTIVE,
            OBJECT_VERSION_NUMBER,
            CREATION_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
        ) VALUES (
            v_dist_id, p_book, p_asset_id,
            1, 1,
            SYSTIMESTAMP,
            1,
            SYSTIMESTAMP, p_created_by, SYSTIMESTAMP, p_created_by
        );

        p_distribution_id := v_dist_id;

        -- ── RR_FA_DEPRN_SUMMARY ──────────────────────────────────────────────
        INSERT INTO RR_FA_DEPRN_SUMMARY (
            ASSET_ID,      BOOK_TYPE_CODE, PERIOD_COUNTER, PERIOD_NAME,
            DEPRN_AMOUNT,  YTD_DEPRN,     DEPRN_RESERVE,
            ADJUSTED_COST, DEPRN_RUN_DATE,
            CREATION_DATE,    CREATED_BY,
            LAST_UPDATE_DATE, LAST_UPDATED_BY
        ) VALUES (
            p_asset_id,     p_book,        p_period_ctr, p_period_name,
            p_deprn_amount, p_new_ytd,     p_new_reserve,
            p_adj_cost,     SYSDATE,
            v_now,          p_created_by,
            v_now,          p_created_by
        );

        -- ── RR_FA_DEPRN_DETAIL ───────────────────────────────────────────────
        INSERT INTO RR_FA_DEPRN_DETAIL (
            ASSET_ID,        BOOK_TYPE_CODE,   PERIOD_COUNTER, PERIOD_NAME,
            DISTRIBUTION_ID, DEPRN_SOURCE_CODE,
            DEPRN_AMOUNT,    YTD_DEPRN,        DEPRN_RESERVE,
            DEPRN_ADJUSTMENT_AMOUNT,
            COST,
            CREATION_DATE,    CREATED_BY,
            LAST_UPDATE_DATE, LAST_UPDATED_BY
        ) VALUES (
            p_asset_id,      p_book,          p_period_ctr, p_period_name,
            v_dist_id,       'DEPRECIATION',
            p_deprn_amount,  p_new_ytd,       p_new_reserve,
            0,
            p_adj_cost,
            v_now,           p_created_by,
            v_now,           p_created_by
        );
    END post_deprn_rows;


    -- =========================================================================
    -- CREATE_DEPRECIATION
    -- =========================================================================
    PROCEDURE CREATE_DEPRECIATION (
        p_asset_id     IN  VARCHAR2,
        p_book         IN  VARCHAR2,
        p_period_name  IN  VARCHAR2,
        p_deprn_amount IN  NUMBER   DEFAULT 0,
        p_created_by   IN  VARCHAR2 DEFAULT 'REACTERP',
        p_http_status  OUT NUMBER,
        p_result       OUT CLOB
    ) IS
        v_period_ctr    NUMBER;
        v_fiscal_year   NUMBER;
        v_period_num    NUMBER;
        v_prior_reserve NUMBER := 0;
        v_prior_ytd     NUMBER := 0;
        v_adj_cost      NUMBER := 0;
        v_salvage       NUMBER := 0;
        v_life_months   NUMBER := 0;
        v_calc_amount   NUMBER := 0;
        v_final_amount  NUMBER;
        v_new_reserve   NUMBER;
        v_new_ytd       NUMBER;
        v_exists        NUMBER;
        v_distribution_id NUMBER;
    BEGIN
        -- Validate required inputs
        IF p_asset_id IS NULL OR p_book IS NULL OR p_period_name IS NULL THEN
            p_http_status := 400;
            p_result := '{"success":false,"error":"assetId, bookTypeCode and periodName are required"}';
            RETURN;
        END IF;

        -- Resolve period_counter
        resolve_period(p_book, p_period_name, v_period_ctr, v_fiscal_year, v_period_num);

        -- Duplicate guard: already posted for this asset + book + period
        SELECT COUNT(*) INTO v_exists
        FROM   RR_FA_DEPRN_SUMMARY
        WHERE  ASSET_ID       = p_asset_id
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER = v_period_ctr;

        IF v_exists > 0 THEN
            p_http_status := 409;
            p_result := '{"success":false,"status":"ALREADY_EXISTS"'
                || ',"assetId":'       || jstr(p_asset_id)
                || ',"bookTypeCode":'  || jstr(p_book)
                || ',"periodName":'    || jstr(p_period_name)
                || ',"periodCounter":' || v_period_ctr
                || ',"error":"Depreciation already posted for this period"}';
            RETURN;
        END IF;

        -- Prior reserve / YTD from last posted period for this asset + book
        BEGIN
            SELECT NVL(DEPRN_RESERVE, 0), NVL(YTD_DEPRN, 0)
            INTO   v_prior_reserve, v_prior_ytd
            FROM   RR_FA_DEPRN_SUMMARY
            WHERE  ASSET_ID       = p_asset_id
            AND    BOOK_TYPE_CODE = p_book
            AND    PERIOD_COUNTER = (
                SELECT MAX(TO_NUMBER(PERIOD_COUNTER))
                FROM   RR_FA_DEPRN_SUMMARY
                WHERE  ASSET_ID       = p_asset_id
                AND    BOOK_TYPE_CODE = p_book
            );
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_prior_reserve := 0;
            v_prior_ytd     := 0;
        END;

        -- Server-side STL calculation (used when client supplies 0)
        BEGIN
            SELECT NVL(b.ADJUSTED_COST, 0),
                   NVL(b.SALVAGE_VALUE,  0),
                   NVL(m.LIFE_IN_MONTHS, 0)
            INTO   v_adj_cost, v_salvage, v_life_months
            FROM   RR_FA_BOOKS b
            LEFT JOIN RR_FA_METHODS m ON m.METHOD_ID = b.METHOD_ID
            WHERE  b.ASSET_ID       = p_asset_id
            AND    b.BOOK_TYPE_CODE = p_book
            AND    b.DATE_INEFFECTIVE IS NULL
            AND    ROWNUM = 1;

            IF v_life_months > 0 THEN
                v_calc_amount := ROUND(
                    (v_adj_cost - v_salvage) / v_life_months, 2);
            END IF;
        EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
        END;

        -- Prefer client-supplied amount; fall back to server-calculated; round to 2dp
        v_final_amount := ROUND(CASE
            WHEN NVL(p_deprn_amount, 0) > 0 THEN p_deprn_amount
            ELSE v_calc_amount
        END, 2);

        -- Cap: cannot depreciate beyond remaining NBV (cost - salvage - prior reserve)
        v_final_amount := ROUND(LEAST(
            v_final_amount,
            GREATEST(0, (v_adj_cost - v_salvage) - v_prior_reserve)
        ), 2);

        -- Block if nothing left to depreciate (asset fully reserved)
        IF v_final_amount <= 0 THEN
            p_http_status := 400;
            p_result      := '{"success":false,"error":"Asset ' || p_asset_id || ' is fully depreciated — no remaining NBV to post."}';
            RETURN;
        END IF;

        v_new_reserve := ROUND(v_prior_reserve + v_final_amount, 2);
        v_new_ytd     := ROUND(v_prior_ytd    + v_final_amount, 2);

        -- Insert into RR_FA_DEPRN_SUMMARY + RR_FA_DEPRN_DETAIL
        post_deprn_rows(
            p_asset_id        => p_asset_id,
            p_book            => p_book,
            p_period_ctr      => v_period_ctr,
            p_period_name     => p_period_name,
            p_deprn_amount    => v_final_amount,
            p_new_ytd         => v_new_ytd,
            p_new_reserve     => v_new_reserve,
            p_adj_cost        => v_adj_cost,
            p_created_by      => p_created_by,
            p_distribution_id => v_distribution_id
        );

        -- Ensure period exists in RR_FA_DEPRN_PERIODS
        ensure_period_row(p_book, p_period_name, v_period_ctr, v_fiscal_year, v_period_num);

        COMMIT;

        p_http_status := 200;
        p_result := '{"success":true,"status":"POSTED"'
            || ',"assetId":'          || jstr(p_asset_id)
            || ',"bookTypeCode":'     || jstr(p_book)
            || ',"periodName":'       || jstr(p_period_name)
            || ',"periodCounter":'    || v_period_ctr
            || ',"distributionId":'   || NVL(TO_CHAR(v_distribution_id), 'null')
            || ',"deprnAmount":'      || v_final_amount
            || ',"newReserve":'       || v_new_reserve
            || ',"newNbv":'           || ROUND(v_adj_cost - v_new_reserve, 2)
            || '}';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_http_status := 500;
            p_result := '{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END CREATE_DEPRECIATION;


    -- =========================================================================
    -- DELETE_DEPRECIATION
    -- Removes RR_FA_DEPRN_SUMMARY row for one asset + book + period.
    -- Blocked if RR_FA_DEPRN_PERIODS.GL_TRANSFER_RUN = 'Y' for that period
    -- (means the period has been transferred to GL — cannot reverse here).
    -- =========================================================================
    PROCEDURE DELETE_DEPRECIATION (
        p_asset_id     IN  VARCHAR2,
        p_book         IN  VARCHAR2,
        p_period_name  IN  VARCHAR2,
        p_deleted_by   IN  VARCHAR2 DEFAULT 'REACTERP',
        p_http_status  OUT NUMBER,
        p_result       OUT CLOB
    ) IS
        v_period_ctr    NUMBER;
        v_fiscal_year   NUMBER;
        v_period_num    NUMBER;
        v_gl_transfer   VARCHAR2(400);
        v_exists        NUMBER;
        v_deprn_amount  NUMBER;
    BEGIN
        IF p_asset_id IS NULL OR p_book IS NULL OR p_period_name IS NULL THEN
            p_http_status := 400;
            p_result := '{"success":false,"error":"assetId, bookTypeCode and periodName are required"}';
            RETURN;
        END IF;

        -- Resolve period_counter
        resolve_period(p_book, p_period_name, v_period_ctr, v_fiscal_year, v_period_num);

        -- Guard: block delete if the period is already closed
        -- (RR_FA_DEPRN_PERIODS has no GL_TRANSFER_RUN; use PERIOD_CLOSE_DATE instead)
        BEGIN
            SELECT NVL(PERIOD_CLOSE_DATE, 'OPEN')
            INTO   v_gl_transfer
            FROM   RR_FA_DEPRN_PERIODS
            WHERE  BOOK_TYPE_CODE = p_book
            AND    PERIOD_COUNTER = v_period_ctr
            AND    ROWNUM = 1;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_gl_transfer := 'OPEN';
        END;

        IF v_gl_transfer <> 'OPEN' THEN
            p_http_status := 409;
            p_result := '{"success":false,"status":"PERIOD_CLOSED"'
                || ',"assetId":'      || jstr(p_asset_id)
                || ',"bookTypeCode":' || jstr(p_book)
                || ',"periodName":'   || jstr(p_period_name)
                || ',"error":"Cannot delete — period is closed"}';
            RETURN;
        END IF;

        -- Check the depreciation record exists
        SELECT COUNT(*), NVL(MAX(DEPRN_AMOUNT), 0)
        INTO   v_exists, v_deprn_amount
        FROM   RR_FA_DEPRN_SUMMARY
        WHERE  ASSET_ID       = p_asset_id
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER = v_period_ctr;

        IF v_exists = 0 THEN
            p_http_status := 404;
            p_result := '{"success":false,"status":"NOT_FOUND"'
                || ',"assetId":'      || jstr(p_asset_id)
                || ',"bookTypeCode":' || jstr(p_book)
                || ',"periodName":'   || jstr(p_period_name)
                || ',"error":"No depreciation record found for this period"}';
            RETURN;
        END IF;

        -- Delete the summary row
        DELETE FROM RR_FA_DEPRN_SUMMARY
        WHERE  ASSET_ID       = p_asset_id
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER = v_period_ctr;

        -- If no other assets have depreciation for this period, mark period as not run
        DECLARE
            v_other_assets NUMBER;
        BEGIN
            SELECT COUNT(*) INTO v_other_assets
            FROM   RR_FA_DEPRN_SUMMARY
            WHERE  BOOK_TYPE_CODE = p_book
            AND    PERIOD_COUNTER = v_period_ctr;

            IF v_other_assets = 0 THEN
                UPDATE RR_FA_DEPRN_PERIODS
                SET    DEPRN_RUN = 'N'
                WHERE  BOOK_TYPE_CODE = p_book
                AND    PERIOD_COUNTER = v_period_ctr;
            END IF;
        END;

        COMMIT;

        p_http_status := 200;
        p_result := '{"success":true,"status":"DELETED"'
            || ',"assetId":'        || jstr(p_asset_id)
            || ',"bookTypeCode":'   || jstr(p_book)
            || ',"periodName":'     || jstr(p_period_name)
            || ',"periodCounter":'  || v_period_ctr
            || ',"deprnAmount":'    || v_deprn_amount
            || '}';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_http_status := 500;
            p_result := '{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END DELETE_DEPRECIATION;


    -- =========================================================================
    -- POST_ASSET_DEPRECIATION
    -- Check-then-post for a single asset.  Pure PL/SQL — no HTTP codes.
    -- Callers: batch jobs, other packages, APEX processes.
    -- =========================================================================
    PROCEDURE POST_ASSET_DEPRECIATION (
        p_asset_id     IN  VARCHAR2,
        p_book         IN  VARCHAR2,
        p_period_name  IN  VARCHAR2,
        p_deprn_amount IN  NUMBER   DEFAULT 0,
        p_created_by   IN  VARCHAR2 DEFAULT 'REACTERP',
        p_status       OUT VARCHAR2,
        p_message      OUT VARCHAR2,
        p_distribution_id OUT NUMBER
    ) IS
        v_period_ctr    NUMBER;
        v_fiscal_year   NUMBER;
        v_period_num    NUMBER;
        v_exists        NUMBER;
        v_prior_reserve NUMBER := 0;
        v_prior_ytd     NUMBER := 0;
        v_adj_cost      NUMBER := 0;
        v_salvage       NUMBER := 0;
        v_life_months   NUMBER := 0;
        v_calc_amount   NUMBER := 0;
        v_final_amount  NUMBER;
        v_new_reserve   NUMBER;
        v_new_ytd       NUMBER;
    BEGIN
        -- ── 1. Validate ──────────────────────────────────────────────────────
        IF p_asset_id IS NULL OR p_book IS NULL OR p_period_name IS NULL THEN
            p_status  := 'ERROR';
            p_message := 'assetId, bookTypeCode and periodName are required';
            RETURN;
        END IF;

        -- ── 2. Resolve period_counter ────────────────────────────────────────
        resolve_period(p_book, p_period_name, v_period_ctr, v_fiscal_year, v_period_num);

        -- ── 3. Check if depreciation already exists for this asset / period ──
        SELECT COUNT(*) INTO v_exists
        FROM   RR_FA_DEPRN_SUMMARY
        WHERE  ASSET_ID       = p_asset_id
        AND    BOOK_TYPE_CODE = p_book
        AND    PERIOD_COUNTER = v_period_ctr;

        IF v_exists > 0 THEN
            p_status  := 'ALREADY_EXISTS';
            p_message := 'Depreciation already posted for asset ' || p_asset_id
                      || ' period ' || p_period_name || ' — skipped';
            RETURN;
        END IF;

        -- ── 4. Get prior reserve / YTD from last posted period ───────────────
        BEGIN
            SELECT NVL(DEPRN_RESERVE, 0), NVL(YTD_DEPRN, 0)
            INTO   v_prior_reserve, v_prior_ytd
            FROM   RR_FA_DEPRN_SUMMARY
            WHERE  ASSET_ID       = p_asset_id
            AND    BOOK_TYPE_CODE = p_book
            AND    PERIOD_COUNTER = (
                SELECT MAX(TO_NUMBER(PERIOD_COUNTER))
                FROM   RR_FA_DEPRN_SUMMARY
                WHERE  ASSET_ID       = p_asset_id
                AND    BOOK_TYPE_CODE = p_book
            );
        EXCEPTION WHEN NO_DATA_FOUND THEN
            v_prior_reserve := 0;
            v_prior_ytd     := 0;
        END;

        -- ── 5. Server-side STL calculation ───────────────────────────────────
        BEGIN
            SELECT NVL(b.ADJUSTED_COST, 0),
                   NVL(b.SALVAGE_VALUE,  0),
                   NVL(m.LIFE_IN_MONTHS, 0)
            INTO   v_adj_cost, v_salvage, v_life_months
            FROM   RR_FA_BOOKS b
            LEFT JOIN RR_FA_METHODS m ON m.METHOD_ID = b.METHOD_ID
            WHERE  b.ASSET_ID       = p_asset_id
            AND    b.BOOK_TYPE_CODE = p_book
            AND    b.DATE_INEFFECTIVE IS NULL
            AND    ROWNUM = 1;

            IF v_life_months > 0 THEN
                v_calc_amount := ROUND((v_adj_cost - v_salvage) / v_life_months, 2);
            END IF;
        EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
        END;

        -- Prefer caller-supplied amount; fall back to STL; round to 2dp
        v_final_amount := ROUND(CASE
            WHEN NVL(p_deprn_amount, 0) > 0 THEN p_deprn_amount
            ELSE v_calc_amount
        END, 2);

        -- Cap: cannot depreciate beyond remaining NBV (cost - salvage - prior reserve)
        v_final_amount := ROUND(LEAST(
            v_final_amount,
            GREATEST(0, (v_adj_cost - v_salvage) - v_prior_reserve)
        ), 2);

        -- Block if nothing left to depreciate (asset fully reserved)
        IF v_final_amount <= 0 THEN
            p_status  := 'ERROR';
            p_message := 'Asset ' || p_asset_id || ' is fully depreciated — no remaining NBV to post.';
            RETURN;
        END IF;

        v_new_reserve := ROUND(v_prior_reserve + v_final_amount, 2);
        v_new_ytd     := ROUND(v_prior_ytd    + v_final_amount, 2);

        -- ── 6. Insert into RR_FA_DEPRN_SUMMARY + RR_FA_DEPRN_DETAIL ────────
        post_deprn_rows(
            p_asset_id        => p_asset_id,
            p_book            => p_book,
            p_period_ctr      => v_period_ctr,
            p_period_name     => p_period_name,
            p_deprn_amount    => v_final_amount,
            p_new_ytd         => v_new_ytd,
            p_new_reserve     => v_new_reserve,
            p_adj_cost        => v_adj_cost,
            p_created_by      => p_created_by,
            p_distribution_id => p_distribution_id
        );

        -- ── 7. Ensure period row exists in RR_FA_DEPRN_PERIODS ──────────────
        ensure_period_row(p_book, p_period_name, v_period_ctr, v_fiscal_year, v_period_num);

        COMMIT;

        p_status  := 'POSTED';
        p_message := 'Depreciation posted for asset ' || p_asset_id
                  || ' period '         || p_period_name
                  || ' amount '         || TO_CHAR(v_final_amount)
                  || ' distributionId ' || TO_CHAR(p_distribution_id)
                  || ' new reserve '    || TO_CHAR(v_new_reserve);

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END POST_ASSET_DEPRECIATION;

END RR_FA_DEPRN_PKG;
/
