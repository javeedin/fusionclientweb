-- =============================================================================
-- 09_RR_FA_PKG_BODY.SQL
-- Package body for RR_FA_PKG.
-- Run 08_rr_fa_pkg_spec.sql first.
-- =============================================================================

CREATE OR REPLACE PACKAGE BODY RR_FA_PKG AS

    -- ── Private helpers ───────────────────────────────────────────────────────
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

    -- JSON string helper — wraps a value in quotes, escapes special chars, or null
    FUNCTION jstr(p_val IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_val IS NULL THEN RETURN 'null'; END IF;
        RETURN '"' || REPLACE(REPLACE(p_val, '\', '\\'), '"', '\"') || '"';
    END jstr;

    -- Safe VARCHAR->NUMBER (null on non-numeric) — portable, no ON CONVERSION ERROR.
    FUNCTION to_num(p_val IN VARCHAR2) RETURN NUMBER IS
    BEGIN
        RETURN TO_NUMBER(p_val);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END to_num;

    -- Safe date parser — handles ISO strings ('YYYY-MM-DD...'), 'DD-MON-RR',
    -- and real DATE/TIMESTAMP values passed as text. Null when unparseable.
    FUNCTION to_dt(p_val IN VARCHAR2) RETURN DATE IS
    BEGIN
        IF p_val IS NULL OR TRIM(p_val) IS NULL THEN RETURN NULL; END IF;
        BEGIN RETURN TO_DATE(SUBSTR(p_val, 1, 10), 'YYYY-MM-DD'); EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN RETURN TO_DATE(SUBSTR(p_val, 1, 9),  'DD-MON-RR');  EXCEPTION WHEN OTHERS THEN NULL; END;
        RETURN NULL;
    END to_dt;

    -- CCID -> concatenated account combination string (from REERP_GL_CODE_COMBINATIONS).
    FUNCTION acct_str(p_ccid VARCHAR2) RETURN VARCHAR2 IS
        v_str VARCHAR2(200);
    BEGIN
        IF p_ccid IS NULL THEN RETURN NULL; END IF;
        BEGIN
            SELECT NVL("buimercFinGlbCoaCo",'')        || '-' ||
                   NVL("buimercFinGlbCoaLob",'')        || '-' ||
                   NVL("buimercFinGlbCoaDepartment",'') || '-' ||
                   NVL("buimercFinGlbCoaAccount",'')    || '-' ||
                   NVL("buimercFinGlbCoaSubAcc",'')     || '-' ||
                   NVL("buimercFinGlbCoaAlys",'')       || '-' ||
                   NVL("buimercFinGlbCoaIc",'')         || '-' ||
                   NVL("buimercFinGlbCoaFut1",'')       || '-' ||
                   NVL("buimercFinGlbCoaFut2",'')
            INTO   v_str
            FROM   REERP_GL_CODE_COMBINATIONS
            WHERE  "_CODE_COMBINATION_ID" = TO_NUMBER(p_ccid);
        EXCEPTION WHEN OTHERS THEN v_str := p_ccid; END;
        RETURN v_str;
    END acct_str;

    -- ── GET_ASSETS ────────────────────────────────────────────────────────────
    -- Sources: RR_FA_ADDITIONS_TL + RR_FA_BOOKS.
    -- Supported filters: p_description, p_book_type.
    -- Others (p_asset_number, p_category, p_asset_type, p_status) are ignored
    -- because those columns do not exist in these two tables.
    PROCEDURE GET_ASSETS (
        p_asset_number  IN  VARCHAR2,
        p_description   IN  VARCHAR2,
        p_category      IN  VARCHAR2,
        p_book_type     IN  VARCHAR2,
        p_asset_type    IN  VARCHAR2,
        p_status        IN  VARCHAR2,
        p_offset        IN  NUMBER,
        p_limit         IN  NUMBER,
        p_http_status   OUT NUMBER,
        p_result        OUT CLOB
    ) IS
        v_offset NUMBER  := NVL(p_offset, 0);
        v_limit  NUMBER  := NVL(p_limit, 25);
        v_total  NUMBER  := 0;
        v_first  BOOLEAN := TRUE;
    BEGIN
        -- Count
        SELECT COUNT(*)
        INTO   v_total
        FROM   RR_FA_ADDITIONS a
        LEFT JOIN (SELECT * FROM RR_FA_BOOKS WHERE DATE_INEFFECTIVE IS NULL) b
               ON b.ASSET_ID = a.ASSET_ID
        WHERE  (p_description  IS NULL OR UPPER(a.DESCRIPTION)  LIKE UPPER('%' || p_description  || '%'))
        AND    (p_book_type    IS NULL OR b.BOOK_TYPE_CODE       =    p_book_type)
        AND    (p_asset_number IS NULL OR a.ASSET_NUMBER         LIKE '%' || p_asset_number || '%');

        -- JSON header — no envelope, just totalCount + items
        p_result := '{"totalCount":' || v_total
                 || ',"items":[';

        -- Rows
        FOR r IN (
            SELECT a.ASSET_ID,
                   a.ASSET_NUMBER,
                   a.DESCRIPTION,
                   a.ASSET_CATEGORY_ID,
                   cat.SEGMENT1                               AS CATEGORY_SEGMENT1,
                   cat.SEGMENT2                               AS CATEGORY_SEGMENT2,
                   a.CREATION_DATE,
                   a.CREATED_BY,
                   a.LAST_UPDATE_DATE,
                   a.LAST_UPDATED_BY,
                   a.ATTRIBUTE1, a.ATTRIBUTE2, a.ATTRIBUTE3, a.ATTRIBUTE4, a.ATTRIBUTE5,
                   a.ATTRIBUTE6, a.ATTRIBUTE7, a.ATTRIBUTE8, a.ATTRIBUTE9, a.ATTRIBUTE10,
                   b.BOOK_TYPE_CODE,
                   b.DATE_PLACED_IN_SERVICE,
                   b.COST,
                   b.ORIGINAL_COST,
                   b.ADJUSTED_COST,
                   b.SALVAGE_VALUE,
                   b.CAPITALIZE_FLAG,
                   b.DEPRECIATE_FLAG,
                   b.DATE_INEFFECTIVE,
                   NVL(ds.DEPRN_RESERVE, 0)                    AS DEPRN_RESERVE,
                   NVL(ds.YTD_DEPRN, 0)                        AS YTD_DEPRN,
                   NVL(b.COST, 0) - NVL(ds.DEPRN_RESERVE, 0)  AS NBV,
                   CASE WHEN b.ASSET_ID IS NULL THEN 'YES' ELSE 'NO' END AS RETIRED_FLAG,
                   NVL(a.ACCOUNTED_STATUS, 'UNACCOUNTED')       AS ACCOUNTED_STATUS,
                   TO_CHAR(a.ACCOUNTED_DATE, 'YYYY-MM-DD')      AS ACCOUNTED_DATE
            FROM   RR_FA_ADDITIONS a
            LEFT JOIN RR_FA_CATEGORIES_B cat
                   ON cat.CATEGORY_ID = a.ASSET_CATEGORY_ID
            LEFT JOIN (SELECT * FROM RR_FA_BOOKS WHERE DATE_INEFFECTIVE IS NULL) b
                   ON b.ASSET_ID = a.ASSET_ID
            LEFT JOIN (
                SELECT ds1.ASSET_ID, ds1.BOOK_TYPE_CODE, ds1.DEPRN_RESERVE, ds1.YTD_DEPRN
                FROM   RR_FA_DEPRN_SUMMARY ds1
                WHERE  ds1.PERIOD_COUNTER = (
                    SELECT MAX(ds2.PERIOD_COUNTER) FROM RR_FA_DEPRN_SUMMARY ds2
                    WHERE  ds2.ASSET_ID      = ds1.ASSET_ID
                    AND    ds2.BOOK_TYPE_CODE = ds1.BOOK_TYPE_CODE)
            ) ds ON ds.ASSET_ID = a.ASSET_ID AND ds.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
            WHERE  (p_description  IS NULL OR UPPER(a.DESCRIPTION)  LIKE UPPER('%' || p_description  || '%'))
            AND    (p_book_type    IS NULL OR b.BOOK_TYPE_CODE       =    p_book_type)
            AND    (p_asset_number IS NULL OR a.ASSET_NUMBER         LIKE '%' || p_asset_number || '%')
            ORDER BY a.ASSET_ID
            OFFSET v_offset ROWS FETCH NEXT v_limit ROWS ONLY
        ) LOOP
            IF NOT v_first THEN p_result := p_result || ','; END IF;
            v_first := FALSE;

            p_result := p_result
                || '{'
                || '"assetId":'             || jstr(r.ASSET_ID)
                || ',"asset_number":'       || jstr(r.ASSET_NUMBER)
                || ',"description":'        || jstr(r.DESCRIPTION)
                || ',"assetCategoryId":'    || jstr(r.ASSET_CATEGORY_ID)
                || ',"categorySegment1":'   || jstr(r.CATEGORY_SEGMENT1)
                || ',"categorySegment2":'   || jstr(r.CATEGORY_SEGMENT2)
                || ',"assetCategory":'      || jstr(
                       CASE
                         WHEN r.CATEGORY_SEGMENT1 IS NOT NULL AND r.CATEGORY_SEGMENT2 IS NOT NULL
                              THEN r.CATEGORY_SEGMENT1 || ' - ' || r.CATEGORY_SEGMENT2
                         ELSE NVL(r.CATEGORY_SEGMENT1, r.CATEGORY_SEGMENT2)
                       END)
                || ',"creationDate":'       || jstr(r.CREATION_DATE)
                || ',"createdBy":'          || jstr(r.CREATED_BY)
                || ',"lastUpdateDate":'     || jstr(r.LAST_UPDATE_DATE)
                || ',"lastUpdatedBy":'      || jstr(r.LAST_UPDATED_BY)
                || ',"attribute1":'         || jstr(r.ATTRIBUTE1)
                || ',"attribute2":'         || jstr(r.ATTRIBUTE2)
                || ',"attribute3":'         || jstr(r.ATTRIBUTE3)
                || ',"attribute4":'         || jstr(r.ATTRIBUTE4)
                || ',"attribute5":'         || jstr(r.ATTRIBUTE5)
                || ',"attribute6":'         || jstr(r.ATTRIBUTE6)
                || ',"attribute7":'         || jstr(r.ATTRIBUTE7)
                || ',"attribute8":'         || jstr(r.ATTRIBUTE8)
                || ',"attribute9":'         || jstr(r.ATTRIBUTE9)
                || ',"attribute10":'        || jstr(r.ATTRIBUTE10)
                || ',"bookTypeCode":'       || jstr(r.BOOK_TYPE_CODE)
                || ',"datePlacedInService":'|| jstr(r.DATE_PLACED_IN_SERVICE)
                || ',"cost":'               || jstr(r.COST)
                || ',"originalCost":'       || jstr(r.ORIGINAL_COST)
                || ',"adjustedCost":'       || jstr(r.ADJUSTED_COST)
                || ',"salvageValue":'       || jstr(r.SALVAGE_VALUE)
                || ',"capitalizeFlag":'     || jstr(r.CAPITALIZE_FLAG)
                || ',"depreciateFlag":'     || jstr(r.DEPRECIATE_FLAG)
                || ',"dateIneffective":'    || jstr(r.DATE_INEFFECTIVE)
                || ',"deprnReserve":'       || TO_CHAR(r.DEPRN_RESERVE)
                || ',"ytdDeprn":'           || TO_CHAR(r.YTD_DEPRN)
                || ',"nbv":'               || TO_CHAR(r.NBV)
                || ',"retiredFlag":'        || jstr(r.RETIRED_FLAG)
                || ',"accountedStatus":'   || jstr(r.ACCOUNTED_STATUS)
                || ',"accountedDate":'     || NVL(jstr(r.ACCOUNTED_DATE), 'null')
                || '}';
        END LOOP;

        p_result      := p_result || ']}';
        p_http_status := 200;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_ASSETS;

    -- ── GET_ASSET_DETAIL ──────────────────────────────────────────────────────
    PROCEDURE GET_ASSET_DETAIL (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS
        v_asset_id           VARCHAR2(400);
        v_asset_number       VARCHAR2(400);
        v_description        VARCHAR2(400);
        v_asset_type         VARCHAR2(400);
        v_tag_number         VARCHAR2(400);
        v_serial_number      VARCHAR2(400);
        v_manufacturer       VARCHAR2(400);
        v_model_number       VARCHAR2(400);
        v_in_use_flag        VARCHAR2(400);
        v_owned_leased       VARCHAR2(400);
        v_new_used           VARCHAR2(400);
        v_units              VARCHAR2(400);
        v_property_type      VARCHAR2(400);
        v_feeder_system      VARCHAR2(400);
        v_asset_category_id  VARCHAR2(400);
        v_creation_date      VARCHAR2(400);
        v_created_by         VARCHAR2(400);
        v_last_update_date   VARCHAR2(400);
        v_last_updated_by    VARCHAR2(400);
        v_accounted_status   VARCHAR2(400);
        v_accounted_date     VARCHAR2(400);
        -- Flexfield attributes
        v_attribute1         VARCHAR2(400);
        v_attribute2         VARCHAR2(400);
        v_attribute3         VARCHAR2(400);
        v_attribute4         VARCHAR2(400);
        v_attribute5         VARCHAR2(400);
        v_attribute6         VARCHAR2(400);
        v_attribute7         VARCHAR2(400);
        v_attribute8         VARCHAR2(400);
        v_attribute9         VARCHAR2(400);
        v_attribute10        VARCHAR2(400);
        -- Book fields
        v_book_type_code     VARCHAR2(400);
        v_date_placed        VARCHAR2(400);
        v_date_effective     VARCHAR2(400);
        v_deprn_start_date   VARCHAR2(400);
        v_cost               VARCHAR2(400);
        v_original_cost      VARCHAR2(400);
        v_adjusted_cost      VARCHAR2(400);
        v_salvage_value      VARCHAR2(400);
        v_recoverable_cost   VARCHAR2(400);
        v_unrevalued_cost    VARCHAR2(400);
        v_capitalize_flag    VARCHAR2(400);
        v_depreciate_flag    VARCHAR2(400);
        v_date_ineffective   VARCHAR2(400);
        v_prorate_date       VARCHAR2(400);
        v_rate_adj_factor    VARCHAR2(400);
        v_salvage_type       VARCHAR2(400);
        v_deprn_limit_type   VARCHAR2(400);
        v_cip_cost           VARCHAR2(400);
        v_method_id          VARCHAR2(400);
        v_convention_type_id VARCHAR2(400);
        v_retirement_id      VARCHAR2(400);
    BEGIN
        SELECT a.ASSET_ID, a.ASSET_NUMBER, a.DESCRIPTION, a.ASSET_TYPE,
               a.TAG_NUMBER, a.SERIAL_NUMBER, a.MANUFACTURER_NAME, a.MODEL_NUMBER,
               a.IN_USE_FLAG, a.OWNED_LEASED, a.NEW_USED, a.UNITS,
               a.PROPERTY_TYPE_CODE, a.FEEDER_SYSTEM_NAME,
               a.ASSET_CATEGORY_ID,
               a.CREATION_DATE, a.CREATED_BY, a.LAST_UPDATE_DATE, a.LAST_UPDATED_BY,
               NVL(a.ACCOUNTED_STATUS, 'UNACCOUNTED'),
               TO_CHAR(a.ACCOUNTED_DATE, 'YYYY-MM-DD'),
               a.ATTRIBUTE1, a.ATTRIBUTE2, a.ATTRIBUTE3, a.ATTRIBUTE4, a.ATTRIBUTE5,
               a.ATTRIBUTE6, a.ATTRIBUTE7, a.ATTRIBUTE8, a.ATTRIBUTE9, a.ATTRIBUTE10,
               b.BOOK_TYPE_CODE, b.DATE_PLACED_IN_SERVICE, b.DATE_EFFECTIVE,
               b.DEPRN_START_DATE, b.COST, b.ORIGINAL_COST, b.ADJUSTED_COST,
               b.SALVAGE_VALUE, b.RECOVERABLE_COST, b.UNREVALUED_COST,
               b.CAPITALIZE_FLAG, b.DEPRECIATE_FLAG, b.DATE_INEFFECTIVE,
               b.PRORATE_DATE, b.RATE_ADJUSTMENT_FACTOR,
               b.SALVAGE_TYPE, b.DEPRN_LIMIT_TYPE, b.CIP_COST,
               b.METHOD_ID, b.CONVENTION_TYPE_ID, b.RETIREMENT_ID
        INTO   v_asset_id, v_asset_number, v_description, v_asset_type,
               v_tag_number, v_serial_number, v_manufacturer, v_model_number,
               v_in_use_flag, v_owned_leased, v_new_used, v_units,
               v_property_type, v_feeder_system,
               v_asset_category_id,
               v_creation_date, v_created_by, v_last_update_date, v_last_updated_by,
               v_accounted_status, v_accounted_date,
               v_attribute1, v_attribute2, v_attribute3, v_attribute4, v_attribute5,
               v_attribute6, v_attribute7, v_attribute8, v_attribute9, v_attribute10,
               v_book_type_code, v_date_placed, v_date_effective,
               v_deprn_start_date, v_cost, v_original_cost, v_adjusted_cost,
               v_salvage_value, v_recoverable_cost, v_unrevalued_cost,
               v_capitalize_flag, v_depreciate_flag, v_date_ineffective,
               v_prorate_date, v_rate_adj_factor,
               v_salvage_type, v_deprn_limit_type, v_cip_cost,
               v_method_id, v_convention_type_id, v_retirement_id
        FROM   RR_FA_ADDITIONS a
        LEFT JOIN RR_FA_BOOKS b
               ON b.ASSET_ID = a.ASSET_ID AND b.DATE_INEFFECTIVE IS NULL
        WHERE  a.ASSET_ID = p_asset_id
        AND    ROWNUM = 1;

        p_result := '{"success":true'
            || ',"assetId":'              || jstr(v_asset_id)
            || ',"asset_number":'         || jstr(v_asset_number)
            || ',"description":'          || jstr(v_description)
            || ',"assetType":'            || jstr(v_asset_type)
            || ',"tagNumber":'            || jstr(v_tag_number)
            || ',"serialNumber":'         || jstr(v_serial_number)
            || ',"manufacturerName":'     || jstr(v_manufacturer)
            || ',"modelNumber":'          || jstr(v_model_number)
            || ',"inUseFlag":'            || jstr(v_in_use_flag)
            || ',"ownedLeased":'          || jstr(v_owned_leased)
            || ',"newUsed":'              || jstr(v_new_used)
            || ',"units":'                || jstr(v_units)
            || ',"propertyTypeCode":'     || jstr(v_property_type)
            || ',"feederSystemName":'     || jstr(v_feeder_system)
            || ',"assetCategoryId":'      || jstr(v_asset_category_id)
            || ',"creationDate":'         || jstr(v_creation_date)
            || ',"createdBy":'            || jstr(v_created_by)
            || ',"lastUpdateDate":'       || jstr(v_last_update_date)
            || ',"lastUpdatedBy":'        || jstr(v_last_updated_by)
            || ',"accountedStatus":'      || jstr(v_accounted_status)
            || ',"accountedDate":'        || jstr(v_accounted_date)
            || ',"attribute1":'           || jstr(v_attribute1)
            || ',"attribute2":'           || jstr(v_attribute2)
            || ',"attribute3":'           || jstr(v_attribute3)
            || ',"attribute4":'           || jstr(v_attribute4)
            || ',"attribute5":'           || jstr(v_attribute5)
            || ',"attribute6":'           || jstr(v_attribute6)
            || ',"attribute7":'           || jstr(v_attribute7)
            || ',"attribute8":'           || jstr(v_attribute8)
            || ',"attribute9":'           || jstr(v_attribute9)
            || ',"attribute10":'          || jstr(v_attribute10)
            || ',"bookTypeCode":'         || jstr(v_book_type_code)
            || ',"datePlacedInService":'  || jstr(v_date_placed)
            || ',"dateEffective":'        || jstr(v_date_effective)
            || ',"deprnStartDate":'       || jstr(v_deprn_start_date)
            || ',"cost":'                 || jstr(v_cost)
            || ',"originalCost":'         || jstr(v_original_cost)
            || ',"adjustedCost":'         || jstr(v_adjusted_cost)
            || ',"salvageValue":'         || jstr(v_salvage_value)
            || ',"recoverableCost":'      || jstr(v_recoverable_cost)
            || ',"unrevaluedCost":'       || jstr(v_unrevalued_cost)
            || ',"capitalizeFlag":'       || jstr(v_capitalize_flag)
            || ',"depreciateFlag":'       || jstr(v_depreciate_flag)
            || ',"dateIneffective":'      || jstr(v_date_ineffective)
            || ',"prorateDate":'          || jstr(v_prorate_date)
            || ',"rateAdjustmentFactor":' || jstr(v_rate_adj_factor)
            || ',"salvageType":'          || jstr(v_salvage_type)
            || ',"deprnLimitType":'       || jstr(v_deprn_limit_type)
            || ',"cipCost":'              || jstr(v_cip_cost)
            || ',"methodId":'             || jstr(v_method_id)
            || ',"conventionTypeId":'     || jstr(v_convention_type_id)
            || ',"retirementId":'         || jstr(v_retirement_id)
            || '}';
        p_http_status := 200;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            write_error(p_http_status, p_result, 404, 'Asset ' || p_asset_id || ' not found');
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_ASSET_DETAIL;

    -- ── GET_ASSET_BOOKS ───────────────────────────────────────────────────────
    PROCEDURE GET_ASSET_BOOKS (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS
        CURSOR c_books IS
            SELECT b.BOOK_TYPE_CODE, bc.BOOK_TYPE_NAME, bc.COMPANY_CODE,
                   b.DATE_PLACED_IN_SERVICE, b.DATE_EFFECTIVE, b.DEPRN_START_DATE,
                   b.COST, b.ORIGINAL_COST, b.ADJUSTED_COST, b.SALVAGE_VALUE,
                   b.RECOVERABLE_COST, b.DEPRECIATE_FLAG, b.CAPITALIZE_FLAG,
                   b.DATE_INEFFECTIVE, b.RETIREMENT_ID, b.PRORATE_DATE,
                   b.METHOD_ID, m.METHOD_CODE, m.NAME AS METHOD_NAME, m.LIFE_IN_MONTHS,
                   b.CONVENTION_TYPE_ID, b.RATE_ADJUSTMENT_FACTOR,
                   b.SALVAGE_TYPE, b.DEPRN_LIMIT_TYPE, b.CIP_COST, b.UNREVALUED_COST,
                   NVL(ds.DEPRN_RESERVE, 0)                  AS DEPRN_RESERVE,
                   NVL(ds.YTD_DEPRN, 0)                      AS YTD_DEPRN,
                   NVL(b.COST, 0) - NVL(ds.DEPRN_RESERVE, 0) AS NBV
            FROM   RR_FA_BOOKS b
            LEFT JOIN RR_FA_BOOK_CONTROLS bc ON bc.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
            LEFT JOIN RR_FA_METHODS m        ON m.METHOD_ID       = b.METHOD_ID
            LEFT JOIN (
                SELECT ds1.ASSET_ID, ds1.BOOK_TYPE_CODE, ds1.DEPRN_RESERVE, ds1.YTD_DEPRN
                FROM   RR_FA_DEPRN_SUMMARY ds1
                WHERE  ds1.PERIOD_COUNTER = (
                    SELECT MAX(ds2.PERIOD_COUNTER) FROM RR_FA_DEPRN_SUMMARY ds2
                    WHERE  ds2.ASSET_ID      = ds1.ASSET_ID
                    AND    ds2.BOOK_TYPE_CODE = ds1.BOOK_TYPE_CODE)
            ) ds ON ds.ASSET_ID = b.ASSET_ID AND ds.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
            WHERE  b.ASSET_ID = p_asset_id
            ORDER BY b.DATE_EFFECTIVE DESC;
    BEGIN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.WRITE('assetId', p_asset_id);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r IN c_books LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('bookTypeCode',         r.BOOK_TYPE_CODE);
            APEX_JSON.WRITE('bookTypeName',         r.BOOK_TYPE_NAME);
            APEX_JSON.WRITE('companyCode',          r.COMPANY_CODE);
            APEX_JSON.WRITE('datePlacedInService',  r.DATE_PLACED_IN_SERVICE);
            APEX_JSON.WRITE('dateEffective',        r.DATE_EFFECTIVE);
            APEX_JSON.WRITE('deprnStartDate',       r.DEPRN_START_DATE);
            APEX_JSON.WRITE('cost',                 r.COST);
            APEX_JSON.WRITE('originalCost',         r.ORIGINAL_COST);
            APEX_JSON.WRITE('adjustedCost',         r.ADJUSTED_COST);
            APEX_JSON.WRITE('salvageValue',         r.SALVAGE_VALUE);
            APEX_JSON.WRITE('recoverableCost',      r.RECOVERABLE_COST);
            APEX_JSON.WRITE('depreciateFlag',       r.DEPRECIATE_FLAG);
            APEX_JSON.WRITE('capitalizeFlag',       r.CAPITALIZE_FLAG);
            APEX_JSON.WRITE('dateIneffective',      r.DATE_INEFFECTIVE);
            APEX_JSON.WRITE('retirementId',         r.RETIREMENT_ID);
            APEX_JSON.WRITE('prorateDate',          r.PRORATE_DATE);
            APEX_JSON.WRITE('methodId',             r.METHOD_ID);
            APEX_JSON.WRITE('methodCode',           r.METHOD_CODE);
            APEX_JSON.WRITE('methodName',           r.METHOD_NAME);
            APEX_JSON.WRITE('lifeInMonths',         r.LIFE_IN_MONTHS);
            APEX_JSON.WRITE('conventionTypeId',     r.CONVENTION_TYPE_ID);
            APEX_JSON.WRITE('rateAdjustmentFactor', r.RATE_ADJUSTMENT_FACTOR);
            APEX_JSON.WRITE('salvageType',          r.SALVAGE_TYPE);
            APEX_JSON.WRITE('deprnLimitType',       r.DEPRN_LIMIT_TYPE);
            APEX_JSON.WRITE('cipCost',              r.CIP_COST);
            APEX_JSON.WRITE('unrevaluedCost',       r.UNREVALUED_COST);
            APEX_JSON.WRITE('deprnReserve',         r.DEPRN_RESERVE);
            APEX_JSON.WRITE('ytdDeprn',             r.YTD_DEPRN);
            APEX_JSON.WRITE('nbv',                  r.NBV);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;
        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_ASSET_BOOKS;

    -- ── GET_ASSET_DEPRN ───────────────────────────────────────────────────────
    PROCEDURE GET_ASSET_DEPRN (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS
        CURSOR c_deprn IS
            SELECT dd.ASSET_ID, dd.BOOK_TYPE_CODE, dd.PERIOD_COUNTER,
                   dp.PERIOD_NAME, dp.FISCAL_YEAR, dp.PERIOD_NUM,
                   dd.DISTRIBUTION_ID, dd.DEPRN_RUN_ID, dd.DEPRN_SOURCE_CODE,
                   dd.DEPRN_RUN_DATE,
                   dd.DEPRN_AMOUNT, dd.YTD_DEPRN, dd.DEPRN_RESERVE,
                   dd.DEPRN_ADJUSTMENT_AMOUNT,
                   dd.COST,
                   NVL(dd.COST, 0) - NVL(dd.DEPRN_RESERVE, 0)   AS NBV,
                   NVL(dd.DEPRN_AMOUNT, 0) + NVL(dd.DEPRN_ADJUSTMENT_AMOUNT, 0) AS TOTAL_DEPRN_AMOUNT,
                   dd.BONUS_DEPRN_AMOUNT, dd.BONUS_YTD_DEPRN, dd.BONUS_DEPRN_RESERVE,
                   dd.BONUS_DEPRN_ADJUSTMENT_AMOUNT,
                   dd.REVAL_RESERVE, dd.REVAL_DEPRN_EXPENSE, dd.YTD_REVAL_DEPRN_EXPENSE,
                   dd.REVAL_AMORTIZATION, dd.REVAL_AMORT_BALANCE,
                   dd.IMPAIRMENT_AMOUNT, dd.IMPAIRMENT_RESERVE, dd.YTD_IMPAIRMENT,
                   dd.CAPITAL_ADJUSTMENT, dd.GENERAL_FUND,
                   dd.BACKLOG_DEPRN_RESERVE, dd.YTD_BACKLOG_DEPRN,
                   NVL(dd.ACCOUNTED_STATUS, 'UNACCOUNTED')  AS ACCOUNTED_STATUS,
                   TO_CHAR(dd.ACCOUNTED_DATE, 'YYYY-MM-DD') AS ACCOUNTED_DATE
            FROM   RR_FA_DEPRN_DETAIL dd
            LEFT JOIN RR_FA_DEPRN_PERIODS dp
                   ON dp.BOOK_TYPE_CODE = dd.BOOK_TYPE_CODE
                  AND dp.PERIOD_COUNTER = dd.PERIOD_COUNTER
            WHERE  dd.ASSET_ID = p_asset_id
            ORDER BY TO_NUMBER(dd.PERIOD_COUNTER) DESC, dd.DISTRIBUTION_ID;
    BEGIN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.WRITE('assetId', p_asset_id);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r IN c_deprn LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('assetId',                     r.ASSET_ID);
            APEX_JSON.WRITE('bookTypeCode',                r.BOOK_TYPE_CODE);
            APEX_JSON.WRITE('periodCounter',               r.PERIOD_COUNTER);
            APEX_JSON.WRITE('periodName',                  r.PERIOD_NAME);
            APEX_JSON.WRITE('fiscalYear',                  r.FISCAL_YEAR);
            APEX_JSON.WRITE('periodNum',                   r.PERIOD_NUM);
            APEX_JSON.WRITE('distributionId',              r.DISTRIBUTION_ID);
            APEX_JSON.WRITE('deprnRunId',                  r.DEPRN_RUN_ID);
            APEX_JSON.WRITE('deprnSourceCode',             r.DEPRN_SOURCE_CODE);
            APEX_JSON.WRITE('deprnRunDate',                r.DEPRN_RUN_DATE);
            APEX_JSON.WRITE('deprnAmount',                 r.DEPRN_AMOUNT);
            APEX_JSON.WRITE('ytdDeprn',                    r.YTD_DEPRN);
            APEX_JSON.WRITE('deprnReserve',                r.DEPRN_RESERVE);
            APEX_JSON.WRITE('deprnAdjustmentAmount',       r.DEPRN_ADJUSTMENT_AMOUNT);
            APEX_JSON.WRITE('totalDeprnAmount',            r.TOTAL_DEPRN_AMOUNT);
            APEX_JSON.WRITE('cost',                        r.COST);
            APEX_JSON.WRITE('nbv',                         r.NBV);
            APEX_JSON.WRITE('bonusDeprnAmount',            r.BONUS_DEPRN_AMOUNT);
            APEX_JSON.WRITE('bonusYtdDeprn',               r.BONUS_YTD_DEPRN);
            APEX_JSON.WRITE('bonusDeprnReserve',           r.BONUS_DEPRN_RESERVE);
            APEX_JSON.WRITE('bonusDeprnAdjustmentAmount',  r.BONUS_DEPRN_ADJUSTMENT_AMOUNT);
            APEX_JSON.WRITE('revalReserve',                r.REVAL_RESERVE);
            APEX_JSON.WRITE('revalDeprnExpense',           r.REVAL_DEPRN_EXPENSE);
            APEX_JSON.WRITE('ytdRevalDeprnExpense',        r.YTD_REVAL_DEPRN_EXPENSE);
            APEX_JSON.WRITE('revalAmortization',           r.REVAL_AMORTIZATION);
            APEX_JSON.WRITE('revalAmortBalance',           r.REVAL_AMORT_BALANCE);
            APEX_JSON.WRITE('impairmentAmount',            r.IMPAIRMENT_AMOUNT);
            APEX_JSON.WRITE('impairmentReserve',           r.IMPAIRMENT_RESERVE);
            APEX_JSON.WRITE('ytdImpairment',               r.YTD_IMPAIRMENT);
            APEX_JSON.WRITE('capitalAdjustment',           r.CAPITAL_ADJUSTMENT);
            APEX_JSON.WRITE('generalFund',                 r.GENERAL_FUND);
            APEX_JSON.WRITE('backlogDeprnReserve',         r.BACKLOG_DEPRN_RESERVE);
            APEX_JSON.WRITE('ytdBacklogDeprn',             r.YTD_BACKLOG_DEPRN);
            APEX_JSON.WRITE('accountedStatus',             r.ACCOUNTED_STATUS);
            APEX_JSON.WRITE('accountedDate',               r.ACCOUNTED_DATE);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;
        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_ASSET_DEPRN;

    -- ── GET_ASSET_DISTRIBUTIONS ───────────────────────────────────────────────
    PROCEDURE GET_ASSET_DISTRIBUTIONS (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS
        CURSOR c_dist IS
            SELECT d.DISTRIBUTION_ID, d.BOOK_TYPE_CODE,
                   d.UNITS_ASSIGNED, d.TRANSACTION_UNITS,
                   d.CODE_COMBINATION_ID, d.LOCATION_ID,
                   l.SEGMENT1 AS LOC_SEG1, l.SEGMENT2 AS LOC_SEG2, l.SEGMENT3 AS LOC_SEG3,
                   d.TRANSACTION_HEADER_ID_IN, d.TRANSACTION_HEADER_ID_OUT,
                   d.DATE_EFFECTIVE, d.DATE_INEFFECTIVE
            FROM   RR_FA_DISTRIBUTION_HISTORY d
            LEFT JOIN RR_FA_LOCATIONS l ON l.LOCATION_ID = d.LOCATION_ID
            WHERE  d.ASSET_ID = p_asset_id
            ORDER BY d.DATE_EFFECTIVE DESC;
    BEGIN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.WRITE('assetId', p_asset_id);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r IN c_dist LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('distributionId',        r.DISTRIBUTION_ID);
            APEX_JSON.WRITE('bookTypeCode',          r.BOOK_TYPE_CODE);
            APEX_JSON.WRITE('unitsAssigned',         r.UNITS_ASSIGNED);
            APEX_JSON.WRITE('transactionUnits',      r.TRANSACTION_UNITS);
            APEX_JSON.WRITE('codeCombinationId',     r.CODE_COMBINATION_ID);
            APEX_JSON.WRITE('locationId',            r.LOCATION_ID);
            APEX_JSON.WRITE('locationSeg1',          r.LOC_SEG1);
            APEX_JSON.WRITE('locationSeg2',          r.LOC_SEG2);
            APEX_JSON.WRITE('locationSeg3',          r.LOC_SEG3);
            APEX_JSON.WRITE('transactionHeaderIdIn', r.TRANSACTION_HEADER_ID_IN);
            APEX_JSON.WRITE('transactionHeaderIdOut',r.TRANSACTION_HEADER_ID_OUT);
            APEX_JSON.WRITE('dateEffective',         r.DATE_EFFECTIVE);
            APEX_JSON.WRITE('dateIneffective',       r.DATE_INEFFECTIVE);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;
        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_ASSET_DISTRIBUTIONS;

    -- ── GET_ASSET_INVOICES ────────────────────────────────────────────────────
    PROCEDURE GET_ASSET_INVOICES (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS
        CURSOR c_inv IS
            SELECT ASSET_INVOICE_ID, BOOK_TYPE_CODE, FIXED_ASSETS_COST,
                   DATE_EFFECTIVE, INVOICE_TRANSACTION_ID_IN, DELETED_FLAG,
                   PAYABLES_CODE_COMBINATION_ID, FEEDER_SYSTEM_NAME,
                   DESCRIPTION, SOURCE_LINE_ID, POST_BATCH_ID
            FROM   RR_FA_ASSET_INVOICES
            WHERE  ASSET_ID = p_asset_id
            AND    NVL(DELETED_FLAG, 'N') = 'N'
            ORDER BY DATE_EFFECTIVE DESC;
    BEGIN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.WRITE('assetId', p_asset_id);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r IN c_inv LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('assetInvoiceId',           r.ASSET_INVOICE_ID);
            APEX_JSON.WRITE('bookTypeCode',              r.BOOK_TYPE_CODE);
            APEX_JSON.WRITE('fixedAssetsCost',           r.FIXED_ASSETS_COST);
            APEX_JSON.WRITE('dateEffective',             r.DATE_EFFECTIVE);
            APEX_JSON.WRITE('invoiceTransactionIdIn',    r.INVOICE_TRANSACTION_ID_IN);
            APEX_JSON.WRITE('payablesCodeCombinationId', r.PAYABLES_CODE_COMBINATION_ID);
            APEX_JSON.WRITE('feederSystemName',          r.FEEDER_SYSTEM_NAME);
            APEX_JSON.WRITE('description',               r.DESCRIPTION);
            APEX_JSON.WRITE('sourceLineId',              r.SOURCE_LINE_ID);
            APEX_JSON.WRITE('postBatchId',               r.POST_BATCH_ID);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;
        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_ASSET_INVOICES;

    -- ── GET_ASSET_TRANSACTIONS ────────────────────────────────────────────────
    PROCEDURE GET_ASSET_TRANSACTIONS (
        p_asset_id    IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS
        CURSOR c_txn IS
            SELECT TRANSACTION_HEADER_ID, BOOK_TYPE_CODE,
                   TRANSACTION_TYPE_CODE, TRANSACTION_DATE_ENTERED,
                   DATE_EFFECTIVE, INVOICE_TRANSACTION_ID,
                   CALLING_INTERFACE, EVENT_ID, MASS_REFERENCE_ID,
                   CREATION_DATE, CREATED_BY
            FROM   RR_FA_TRANSACTION_HEADERS
            WHERE  ASSET_ID = p_asset_id
            ORDER BY DATE_EFFECTIVE DESC;
    BEGIN
        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', TRUE);
        APEX_JSON.WRITE('assetId', p_asset_id);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r IN c_txn LOOP
            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('transactionHeaderId',  r.TRANSACTION_HEADER_ID);
            APEX_JSON.WRITE('bookTypeCode',         r.BOOK_TYPE_CODE);
            APEX_JSON.WRITE('transactionTypeCode',  r.TRANSACTION_TYPE_CODE);
            APEX_JSON.WRITE('transactionDate',      r.TRANSACTION_DATE_ENTERED);
            APEX_JSON.WRITE('dateEffective',        r.DATE_EFFECTIVE);
            APEX_JSON.WRITE('invoiceTransactionId', r.INVOICE_TRANSACTION_ID);
            APEX_JSON.WRITE('callingInterface',     r.CALLING_INTERFACE);
            APEX_JSON.WRITE('eventId',              r.EVENT_ID);
            APEX_JSON.WRITE('massReferenceId',      r.MASS_REFERENCE_ID);
            APEX_JSON.WRITE('creationDate',         r.CREATION_DATE);
            APEX_JSON.WRITE('createdBy',            r.CREATED_BY);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.CLOSE_OBJECT;
        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_ASSET_TRANSACTIONS;

    -- ── Stubs: implemented in 04_fa_get_setup.sql / future body files ─────────

    PROCEDURE GET_CATEGORIES (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE GET_METHODS (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE GET_LOCATIONS (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE GET_BOOK_CONTROLS (
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE GET_DEPRN_PERIODS (
        p_book_type   IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE GET_RETIREMENTS (
        p_book_type   IN  VARCHAR2,
        p_ret_status  IN  VARCHAR2,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE GET_DEPRN_WORKBENCH (
        p_book_type      IN  VARCHAR2,
        p_period_counter IN  VARCHAR2,
        p_asset_number   IN  VARCHAR2,
        p_offset         IN  NUMBER,
        p_limit          IN  NUMBER,
        p_http_status    OUT NUMBER,
        p_result         OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE CREATE_ASSET (
        p_body        IN  CLOB,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE RETIRE_ASSET (
        p_asset_id    IN  NUMBER,
        p_body        IN  CLOB,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    PROCEDURE ADJUST_ASSET (
        p_asset_id    IN  NUMBER,
        p_body        IN  CLOB,
        p_http_status OUT NUMBER,
        p_result      OUT CLOB
    ) IS BEGIN write_error(p_http_status, p_result, 501, 'Not implemented in this body'); END;

    -- Straight-line schedule for ONE month (daily-rate, following-month
    -- convention) — mirrors the Manage Assets "Depreciation Preview" dialog.
    -- Returns days / daily-rate / opening NBV / depreciation / closing NBV for
    -- p_target_month (first day of the month). Amounts are null when the month
    -- is outside the depreciation window.
    PROCEDURE calc_period_sched (
        p_cost         IN  NUMBER,
        p_salvage      IN  NUMBER,
        p_life         IN  NUMBER,
        p_dpis         IN  DATE,
        p_target_month IN  DATE,
        p_days         OUT NUMBER,
        p_daily        OUT NUMBER,
        p_open_nbv     OUT NUMBER,
        p_deprn        OUT NUMBER,
        p_close_nbv    OUT NUMBER
    ) IS
        v_start   DATE;
        v_total   NUMBER := 0;
        v_nbv     NUMBER;
        v_cur     DATE;
        v_dim     NUMBER;
        v_depr    NUMBER;
    BEGIN
        p_days := NULL; p_daily := NULL; p_open_nbv := NULL; p_deprn := NULL; p_close_nbv := NULL;
        IF p_cost IS NULL OR p_cost <= 0 OR p_life IS NULL OR p_life <= 0
           OR p_dpis IS NULL OR p_target_month IS NULL THEN
            RETURN;
        END IF;
        v_start := ADD_MONTHS(TRUNC(p_dpis, 'MM'), 1);   -- month AFTER DPIS
        FOR i IN 0 .. p_life - 1 LOOP
            v_total := v_total + (LAST_DAY(ADD_MONTHS(v_start, i)) - TRUNC(ADD_MONTHS(v_start, i), 'MM') + 1);
        END LOOP;
        IF v_total <= 0 THEN RETURN; END IF;
        p_daily := ROUND((p_cost - NVL(p_salvage, 0)) / v_total, 2);
        v_nbv   := p_cost;
        FOR i IN 0 .. p_life + 2 LOOP
            v_cur := ADD_MONTHS(v_start, i);
            v_dim := LAST_DAY(v_cur) - TRUNC(v_cur, 'MM') + 1;
            v_depr := LEAST(((p_cost - NVL(p_salvage, 0)) / v_total) * v_dim, v_nbv - NVL(p_salvage, 0));
            IF v_depr <= 0 THEN CONTINUE; END IF;
            IF TRUNC(v_cur, 'MM') = TRUNC(p_target_month, 'MM') THEN
                p_days      := v_dim;
                p_open_nbv  := ROUND(v_nbv, 2);
                p_deprn     := ROUND(v_depr, 2);
                p_close_nbv := ROUND(v_nbv - v_depr, 2);
                RETURN;
            END IF;
            v_nbv := v_nbv - v_depr;
        END LOOP;
    END calc_period_sched;

    -- ── GET_DEPRN_BY_PERIOD ───────────────────────────────────────────────────
    -- All ACTIVE assets of a book for ONE period. Depreciation comes from
    -- RR_FA_DEPRN_DETAIL (same table as GET_ASSET_DEPRN) when posted; otherwise
    -- it is CALCULATED (straight-line) so every line carries an amount. Assets
    -- with no depreciation for the period are still returned with status
    -- 'Not Posted' (LEFT JOIN). Accepts period name OR counter.
    PROCEDURE GET_DEPRN_BY_PERIOD (
        p_book_type      IN  VARCHAR2,
        p_period_name    IN  VARCHAR2,
        p_period_counter IN  VARCHAR2,
        p_asset_number   IN  VARCHAR2,
        p_offset         IN  NUMBER,
        p_limit          IN  NUMBER,
        p_http_status    OUT NUMBER,
        p_result         OUT CLOB
    ) IS
        v_pc        NUMBER;
        v_pname     VARCHAR2(100);
        v_tgt_month DATE;
        v_offset    NUMBER := NVL(p_offset, 0);
        v_limit     NUMBER := NVL(p_limit, 2000);
        v_total     NUMBER := 0;
        v_posted    NUMBER := 0;
        v_tot_cost  NUMBER := 0;
        v_tot_deprn NUMBER := 0;
        v_tot_nbv   NUMBER := 0;
        -- per-line schedule outputs
        v_life_n    NUMBER; v_salv_n NUMBER;
        v_days      NUMBER; v_daily NUMBER; v_open NUMBER; v_deprn NUMBER; v_close NUMBER;
    BEGIN
        IF p_book_type IS NULL THEN
            write_error(p_http_status, p_result, 400, 'bookTypeCode is required');
            RETURN;
        END IF;

        -- Resolve the period counter from counter or name.
        IF p_period_counter IS NOT NULL THEN
            v_pc := TO_NUMBER(p_period_counter);
        ELSIF p_period_name IS NOT NULL THEN
            SELECT MAX(PERIOD_COUNTER) INTO v_pc
              FROM RR_FA_DEPRN_PERIODS
             WHERE BOOK_TYPE_CODE = p_book_type
               AND UPPER(PERIOD_NAME) = UPPER(p_period_name);
        END IF;

        -- Display name: from the periods table if the counter is known, else the
        -- name the caller passed (future/pending period not yet loaded).
        IF v_pc IS NOT NULL THEN
            SELECT MAX(PERIOD_NAME) INTO v_pname
              FROM RR_FA_DEPRN_PERIODS WHERE BOOK_TYPE_CODE = p_book_type AND PERIOD_COUNTER = v_pc;
        END IF;
        v_pname := NVL(v_pname, p_period_name);

        -- Derive the target month from the period name (e.g. 'Apr-26' / 'May-26').
        -- (The period date columns are stored as NUMBER, so we parse the name.)
        IF v_pname IS NOT NULL THEN
            BEGIN
                v_tgt_month := TRUNC(TO_DATE(v_pname, 'Mon-RR'), 'MM');
            EXCEPTION WHEN OTHERS THEN
                BEGIN
                    v_tgt_month := TRUNC(TO_DATE(v_pname, 'Mon-YYYY'), 'MM');
                EXCEPTION WHEN OTHERS THEN v_tgt_month := NULL;
                END;
            END;
        END IF;

        -- If the period name is valid (parses to a month) but the period isn't
        -- loaded yet in RR_FA_DEPRN_PERIODS, treat it as a future/pending period:
        -- use a non-matching counter so every asset shows as "Not Posted" and the
        -- per-asset straight-line schedule is still computed for that month.
        IF v_pc IS NULL AND v_tgt_month IS NOT NULL THEN
            v_pc := -1;
        END IF;

        IF v_pc IS NULL THEN
            write_error(p_http_status, p_result, 400, 'provide periodCounter or a valid periodName for the book');
            RETURN;
        END IF;

        SELECT COUNT(*),
               SUM(CASE WHEN dsum.ASSET_ID IS NOT NULL THEN 1 ELSE 0 END)
          INTO v_total, v_posted
          FROM RR_FA_BOOKS b
          JOIN RR_FA_ADDITIONS a ON a.ASSET_ID = b.ASSET_ID
          LEFT JOIN (
                SELECT dd.ASSET_ID, dd.BOOK_TYPE_CODE
                  FROM RR_FA_DEPRN_DETAIL dd
                 WHERE dd.PERIOD_COUNTER = v_pc
                 GROUP BY dd.ASSET_ID, dd.BOOK_TYPE_CODE
          ) dsum ON dsum.ASSET_ID = b.ASSET_ID AND dsum.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
         WHERE b.BOOK_TYPE_CODE = p_book_type
           AND b.DATE_INEFFECTIVE IS NULL
           AND (p_asset_number IS NULL OR UPPER(a.ASSET_NUMBER) LIKE UPPER('%' || p_asset_number || '%'));

        APEX_JSON.INITIALIZE_CLOB_OUTPUT;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success',        TRUE);
        APEX_JSON.WRITE('bookTypeCode',   p_book_type);
        APEX_JSON.WRITE('periodCounter',  v_pc);
        APEX_JSON.WRITE('periodName',     v_pname);
        APEX_JSON.WRITE('totalCount',     v_total);
        APEX_JSON.WRITE('postedCount',    v_posted);
        APEX_JSON.WRITE('notPostedCount', v_total - v_posted);
        APEX_JSON.OPEN_ARRAY('items');

        FOR r IN (
            SELECT a.ASSET_ID, a.ASSET_NUMBER, a.DESCRIPTION,
                   -- Cost is the authoritative book cost (same value the asset-edit
                   -- screen shows). Do NOT use the summed deprn-detail cost: an asset
                   -- with several distributions carries the full cost on each detail
                   -- row, so SUM(dd.COST) would multiply it.
                   b.COST                                              AS COST,
                   dsum.DEPRN_AMOUNT                                    AS DEPRN_AMOUNT,
                   dsum.YTD_DEPRN                                       AS YTD_DEPRN,
                   dsum.DEPRN_RESERVE                                   AS DEPRN_RESERVE,
                   b.COST - NVL(dsum.DEPRN_RESERVE, 0)                  AS NBV,
                   dsum.DEPRN_RUN_DATE                                  AS DEPRN_RUN_DATE,
                   dsum.DISTRIBUTION_ID                                 AS DISTRIBUTION_ID,
                   dsum.ACCOUNTED_STATUS                                AS ACCOUNTED_STATUS,
                   b.SALVAGE_VALUE                                      AS SALVAGE_VALUE,
                   m.METHOD_CODE                                        AS METHOD_CODE,
                   m.LIFE_IN_MONTHS                                     AS LIFE_IN_MONTHS,
                   b.DATE_PLACED_IN_SERVICE                             AS DATE_PLACED_IN_SERVICE,
                   b.DEPRN_START_DATE                                   AS DEPRN_START_DATE,
                   (SELECT MAX(cb.DEPRN_EXPENSE_ACCOUNT_CCID) FROM RR_FA_CATEGORY_BOOKS cb
                     WHERE cb.CATEGORY_ID = a.ASSET_CATEGORY_ID)        AS EXP_CCID,
                   (SELECT MAX(cb.RESERVE_ACCOUNT_CCID) FROM RR_FA_CATEGORY_BOOKS cb
                     WHERE cb.CATEGORY_ID = a.ASSET_CATEGORY_ID)        AS RES_CCID,
                   CASE WHEN dsum.ASSET_ID IS NOT NULL THEN 'Posted' ELSE 'Not Posted' END AS STATUS
              FROM RR_FA_BOOKS b
              JOIN RR_FA_ADDITIONS a ON a.ASSET_ID = b.ASSET_ID
              LEFT JOIN RR_FA_METHODS m ON m.METHOD_ID = b.METHOD_ID
              LEFT JOIN (
                    SELECT dd.ASSET_ID, dd.BOOK_TYPE_CODE,
                           SUM(NVL(dd.DEPRN_AMOUNT, 0))  AS DEPRN_AMOUNT,
                           SUM(NVL(dd.YTD_DEPRN, 0))     AS YTD_DEPRN,
                           SUM(NVL(dd.DEPRN_RESERVE, 0)) AS DEPRN_RESERVE,
                           SUM(NVL(dd.COST, 0))          AS COST,
                           MAX(dd.DEPRN_RUN_DATE)        AS DEPRN_RUN_DATE,
                           MAX(dd.DISTRIBUTION_ID)       AS DISTRIBUTION_ID,
                           MAX(NVL(dd.ACCOUNTED_STATUS, 'UNACCOUNTED')) AS ACCOUNTED_STATUS
                      FROM RR_FA_DEPRN_DETAIL dd
                     WHERE dd.PERIOD_COUNTER = v_pc
                     GROUP BY dd.ASSET_ID, dd.BOOK_TYPE_CODE
              ) dsum ON dsum.ASSET_ID = b.ASSET_ID AND dsum.BOOK_TYPE_CODE = b.BOOK_TYPE_CODE
             WHERE b.BOOK_TYPE_CODE = p_book_type
               AND b.DATE_INEFFECTIVE IS NULL
               AND (p_asset_number IS NULL OR UPPER(a.ASSET_NUMBER) LIKE UPPER('%' || p_asset_number || '%'))
             ORDER BY a.ASSET_NUMBER
             OFFSET v_offset ROWS FETCH NEXT v_limit ROWS ONLY
        ) LOOP
            -- Straight-line schedule for THIS asset in the target period (same
            -- daily-rate math as the Depreciation Preview dialog).
            v_life_n := to_num(r.LIFE_IN_MONTHS);
            v_salv_n := NVL(to_num(r.SALVAGE_VALUE), 0);
            calc_period_sched(
                p_cost => r.COST, p_salvage => v_salv_n, p_life => v_life_n,
                p_dpis => to_dt(r.DATE_PLACED_IN_SERVICE), p_target_month => v_tgt_month,
                p_days => v_days, p_daily => v_daily, p_open_nbv => v_open,
                p_deprn => v_deprn, p_close_nbv => v_close);

            v_tot_cost  := v_tot_cost  + NVL(r.COST, 0);
            v_tot_deprn := v_tot_deprn + NVL(v_deprn, 0);
            v_tot_nbv   := v_tot_nbv   + NVL(v_close, NVL(r.NBV, 0));

            APEX_JSON.OPEN_OBJECT;
            APEX_JSON.WRITE('assetId',              r.ASSET_ID);
            APEX_JSON.WRITE('assetNumber',          r.ASSET_NUMBER);
            APEX_JSON.WRITE('description',          r.DESCRIPTION);
            APEX_JSON.WRITE('periodName',           v_pname);
            APEX_JSON.WRITE('cost',                 r.COST);
            APEX_JSON.WRITE('salvageValue',         r.SALVAGE_VALUE);
            APEX_JSON.WRITE('methodCode',           r.METHOD_CODE);
            APEX_JSON.WRITE('lifeInMonths',         r.LIFE_IN_MONTHS);
            APEX_JSON.WRITE('datePlacedInService',  r.DATE_PLACED_IN_SERVICE);
            APEX_JSON.WRITE('deprnStartDate',       r.DEPRN_START_DATE);
            -- dialog-style schedule for the period
            APEX_JSON.WRITE('days',                 v_days);
            APEX_JSON.WRITE('dailyRate',            v_daily);
            APEX_JSON.WRITE('openingNbv',           v_open);
            APEX_JSON.WRITE('deprnAmount',          NVL(r.DEPRN_AMOUNT, v_deprn));
            APEX_JSON.WRITE('closingNbv',           v_close);
            -- current actuals (for reference)
            APEX_JSON.WRITE('nbv',                  r.NBV);
            APEX_JSON.WRITE('deprnReserve',         r.DEPRN_RESERVE);
            APEX_JSON.WRITE('deprnRunDate',         r.DEPRN_RUN_DATE);
            APEX_JSON.WRITE('distributionId',       r.DISTRIBUTION_ID);
            APEX_JSON.WRITE('accountedStatus',      r.ACCOUNTED_STATUS);
            -- Dr Depreciation Expense / Cr Accumulated Depreciation account combinations
            APEX_JSON.WRITE('deprnExpenseAccount',  acct_str(r.EXP_CCID));
            APEX_JSON.WRITE('deprnReserveAccount',  acct_str(r.RES_CCID));
            APEX_JSON.WRITE('status',               r.STATUS);
            APEX_JSON.CLOSE_OBJECT;
        END LOOP;

        APEX_JSON.CLOSE_ARRAY;
        APEX_JSON.OPEN_OBJECT('summary');
        APEX_JSON.WRITE('totalCost',        v_tot_cost);
        APEX_JSON.WRITE('totalDeprnAmount', v_tot_deprn);
        APEX_JSON.WRITE('totalNbv',         v_tot_nbv);
        APEX_JSON.CLOSE_OBJECT;
        APEX_JSON.CLOSE_OBJECT;

        p_http_status := 200;
        p_result      := APEX_JSON.GET_CLOB_OUTPUT;
        APEX_JSON.FREE_OUTPUT;
    EXCEPTION
        WHEN OTHERS THEN
            write_error(p_http_status, p_result, 500, SQLERRM);
    END GET_DEPRN_BY_PERIOD;

END RR_FA_PKG;
/
