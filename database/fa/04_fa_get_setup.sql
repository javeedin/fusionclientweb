-- =============================================================================
-- 04_FA_GET_SETUP.SQL
-- GET reerp/fa/categories
-- GET reerp/fa/methods
-- GET reerp/fa/locations
-- GET reerp/fa/book-controls
-- GET reerp/fa/deprn-periods
-- GET reerp/fa/retirements
-- =============================================================================


-- ============================================================
-- 1. GET fa/categories
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/categories',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: asset categories list'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/categories',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT b.CATEGORY_ID, b.SEGMENT1, b.SEGMENT2,
               b.SUMMARY_FLAG, b.ENABLED_FLAG,
               b.OWNED_LEASED, b.CATEGORY_TYPE, b.CAPITALIZE_FLAG,
               NVL(tl.DESCRIPTION, b.SEGMENT1 || ' - ' || b.SEGMENT2) AS DESCRIPTION
        FROM   RR_FA_CATEGORIES_B b
        LEFT JOIN RR_FA_CATEGORIES_TL tl
               ON tl.CATEGORY_ID = b.CATEGORY_ID AND tl.LANGUAGE = 'US'
        WHERE  NVL(b.ENABLED_FLAG,'Y') = 'Y'
        ORDER BY b.SEGMENT1, b.SEGMENT2;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('categoryId',     r.CATEGORY_ID);
        APEX_JSON.WRITE('segment1',       r.SEGMENT1);
        APEX_JSON.WRITE('segment2',       r.SEGMENT2);
        APEX_JSON.WRITE('description',    r.DESCRIPTION);
        APEX_JSON.WRITE('categoryType',   r.CATEGORY_TYPE);
        APEX_JSON.WRITE('ownedLeased',    r.OWNED_LEASED);
        APEX_JSON.WRITE('capitalizeFlag', r.CAPITALIZE_FLAG);
        APEX_JSON.WRITE('summaryFlag',    r.SUMMARY_FLAG);
        APEX_JSON.WRITE('enabledFlag',    r.ENABLED_FLAG);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
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


-- ============================================================
-- 2. GET fa/methods
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/methods',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: depreciation methods'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/methods',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT METHOD_ID, METHOD_CODE, NAME, LIFE_IN_MONTHS,
               STL_METHOD_FLAG, RATE_SOURCE_RULE, DEPRN_BASIS_RULE,
               DEPRECIATE_LASTYEAR_FLAG, EXCLUDE_SALVAGE_VALUE_FLAG, SET_ID
        FROM   RR_FA_METHODS
        ORDER BY METHOD_CODE, LPAD(NVL(LIFE_IN_MONTHS,'0'), 10, '0');
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('methodId',                r.METHOD_ID);
        APEX_JSON.WRITE('methodCode',              r.METHOD_CODE);
        APEX_JSON.WRITE('name',                    r.NAME);
        APEX_JSON.WRITE('lifeInMonths',            r.LIFE_IN_MONTHS);
        APEX_JSON.WRITE('stlMethodFlag',           r.STL_METHOD_FLAG);
        APEX_JSON.WRITE('rateSourceRule',          r.RATE_SOURCE_RULE);
        APEX_JSON.WRITE('deprnBasisRule',          r.DEPRN_BASIS_RULE);
        APEX_JSON.WRITE('depreciateLastyearFlag',  r.DEPRECIATE_LASTYEAR_FLAG);
        APEX_JSON.WRITE('excludeSalvageValueFlag', r.EXCLUDE_SALVAGE_VALUE_FLAG);
        APEX_JSON.WRITE('setId',                   r.SET_ID);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
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


-- ============================================================
-- 3. GET fa/locations
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/locations',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: locations list'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/locations',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT LOCATION_ID, SEGMENT1, SEGMENT2, SEGMENT3, SEGMENT4,
               SUMMARY_FLAG, ENABLED_FLAG,
               SEGMENT1 || CASE WHEN SEGMENT2 IS NOT NULL THEN ' / '||SEGMENT2 ELSE '' END
               || CASE WHEN SEGMENT3 IS NOT NULL THEN ' / '||SEGMENT3 ELSE '' END
               AS FULL_LOCATION
        FROM   RR_FA_LOCATIONS
        WHERE  NVL(ENABLED_FLAG,'Y') = 'Y'
        AND    NVL(SUMMARY_FLAG,'N') = 'N'
        ORDER BY SEGMENT1, SEGMENT2, SEGMENT3;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('locationId',    r.LOCATION_ID);
        APEX_JSON.WRITE('segment1',      r.SEGMENT1);
        APEX_JSON.WRITE('segment2',      r.SEGMENT2);
        APEX_JSON.WRITE('segment3',      r.SEGMENT3);
        APEX_JSON.WRITE('segment4',      r.SEGMENT4);
        APEX_JSON.WRITE('fullLocation',  r.FULL_LOCATION);
        APEX_JSON.WRITE('summaryFlag',   r.SUMMARY_FLAG);
        APEX_JSON.WRITE('enabledFlag',   r.ENABLED_FLAG);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
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


-- ============================================================
-- 4. GET fa/book-controls
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/book-controls',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: book controls (book definitions)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/book-controls',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT BOOK_TYPE_CODE, BOOK_TYPE_NAME, SET_OF_BOOKS_ID,
               BOOK_CLASS, DEPRN_CALENDAR, FISCAL_YEAR_NAME,
               CURRENT_FISCAL_YEAR, GL_POSTING_ALLOWED_FLAG,
               AMORTIZE_FLAG, ALLOW_MASS_CHANGES, ALLOW_REVAL_FLAG,
               ALLOW_CIP_ASSETS_FLAG, LAST_DEPRN_RUN_DATE,
               PRORATE_CALENDAR, DEPRN_STATUS, BOOK_CONTROL_ID
        FROM   RR_FA_BOOK_CONTROLS
        ORDER BY BOOK_TYPE_CODE;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('bookTypeCode',          r.BOOK_TYPE_CODE);
        APEX_JSON.WRITE('bookTypeName',          r.BOOK_TYPE_NAME);
        APEX_JSON.WRITE('setOfBooksId',          r.SET_OF_BOOKS_ID);
        APEX_JSON.WRITE('bookClass',             r.BOOK_CLASS);
        APEX_JSON.WRITE('deprnCalendar',         r.DEPRN_CALENDAR);
        APEX_JSON.WRITE('fiscalYearName',        r.FISCAL_YEAR_NAME);
        APEX_JSON.WRITE('currentFiscalYear',     r.CURRENT_FISCAL_YEAR);
        APEX_JSON.WRITE('glPostingAllowedFlag',  r.GL_POSTING_ALLOWED_FLAG);
        APEX_JSON.WRITE('amortizeFlag',          r.AMORTIZE_FLAG);
        APEX_JSON.WRITE('allowMassChanges',      r.ALLOW_MASS_CHANGES);
        APEX_JSON.WRITE('allowRevalFlag',        r.ALLOW_REVAL_FLAG);
        APEX_JSON.WRITE('allowCipAssetsFlag',    r.ALLOW_CIP_ASSETS_FLAG);
        APEX_JSON.WRITE('lastDeprnRunDate',      r.LAST_DEPRN_RUN_DATE);
        APEX_JSON.WRITE('prorateCalendar',       r.PRORATE_CALENDAR);
        APEX_JSON.WRITE('deprnStatus',           r.DEPRN_STATUS);
        APEX_JSON.WRITE('bookControlId',         r.BOOK_CONTROL_ID);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
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


-- ============================================================
-- 5. GET fa/deprn-periods   (optional filter: ?bookTypeCode=)
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: depreciation periods per book'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-periods',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT BOOK_TYPE_CODE, PERIOD_COUNTER, PERIOD_NAME,
               FISCAL_YEAR, PERIOD_NUM,
               PERIOD_OPEN_DATE, PERIOD_CLOSE_DATE,
               CALENDAR_PERIOD_OPEN_DATE, CALENDAR_PERIOD_CLOSE_DATE,
               DEPRN_RUN
        FROM   RR_FA_DEPRN_PERIODS
        WHERE  (:bookTypeCode IS NULL OR BOOK_TYPE_CODE = :bookTypeCode)
        ORDER BY BOOK_TYPE_CODE, PERIOD_COUNTER DESC;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('bookTypeCode',             r.BOOK_TYPE_CODE);
        APEX_JSON.WRITE('periodCounter',            r.PERIOD_COUNTER);
        APEX_JSON.WRITE('periodName',               r.PERIOD_NAME);
        APEX_JSON.WRITE('fiscalYear',               r.FISCAL_YEAR);
        APEX_JSON.WRITE('periodNum',                r.PERIOD_NUM);
        APEX_JSON.WRITE('periodOpenDate',           r.PERIOD_OPEN_DATE);
        APEX_JSON.WRITE('periodCloseDate',          r.PERIOD_CLOSE_DATE);
        APEX_JSON.WRITE('calendarPeriodOpenDate',   r.CALENDAR_PERIOD_OPEN_DATE);
        APEX_JSON.WRITE('calendarPeriodCloseDate',  r.CALENDAR_PERIOD_CLOSE_DATE);
        APEX_JSON.WRITE('deprnRun',                 r.DEPRN_RUN);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
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


-- ============================================================
-- 6. GET fa/retirements   (optional filter: ?bookTypeCode=, ?status=)
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/retirements',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: retired assets list'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/retirements',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT r.RETIREMENT_ID, r.BOOK_TYPE_CODE, r.ASSET_ID,
               a.ASSET_NUMBER, a.DESCRIPTION,
               r.DATE_RETIRED, r.DATE_EFFECTIVE,
               r.COST_RETIRED, r.STATUS, r.UNITS,
               r.NBV_RETIRED, r.GAIN_LOSS_AMOUNT,
               r.PROCEEDS_OF_SALE, r.COST_OF_REMOVAL,
               r.RETIREMENT_TYPE_CODE, r.UNREVALUED_COST_RETIRED,
               r.SOLD_TO
        FROM   RR_FA_RETIREMENTS r
        JOIN   RR_FA_ADDITIONS   a ON a.ASSET_ID = r.ASSET_ID
        WHERE  (:bookTypeCode IS NULL OR r.BOOK_TYPE_CODE = :bookTypeCode)
        AND    (:status IS NULL OR r.STATUS = :status)
        ORDER BY r.DATE_RETIRED DESC;
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('retirementId',          r.RETIREMENT_ID);
        APEX_JSON.WRITE('bookTypeCode',          r.BOOK_TYPE_CODE);
        APEX_JSON.WRITE('assetId',               r.ASSET_ID);
        APEX_JSON.WRITE('assetNumber',           r.ASSET_NUMBER);
        APEX_JSON.WRITE('description',           r.DESCRIPTION);
        APEX_JSON.WRITE('dateRetired',           r.DATE_RETIRED);
        APEX_JSON.WRITE('dateEffective',         r.DATE_EFFECTIVE);
        APEX_JSON.WRITE('costRetired',           r.COST_RETIRED);
        APEX_JSON.WRITE('status',                r.STATUS);
        APEX_JSON.WRITE('units',                 r.UNITS);
        APEX_JSON.WRITE('nbvRetired',            r.NBV_RETIRED);
        APEX_JSON.WRITE('gainLossAmount',        r.GAIN_LOSS_AMOUNT);
        APEX_JSON.WRITE('proceedsOfSale',        r.PROCEEDS_OF_SALE);
        APEX_JSON.WRITE('costOfRemoval',         r.COST_OF_REMOVAL);
        APEX_JSON.WRITE('retirementTypeCode',    r.RETIREMENT_TYPE_CODE);
        APEX_JSON.WRITE('unrevaluedCostRetired', r.UNREVALUED_COST_RETIRED);
        APEX_JSON.WRITE('soldTo',                r.SOLD_TO);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
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
