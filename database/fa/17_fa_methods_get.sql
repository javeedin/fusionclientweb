-- =============================================================================
-- 17_FA_METHODS_GET.SQL
-- GET reerp/fa/methods
-- Returns depreciation methods from RR_FA_METHODS
-- Key columns: METHOD_CODE, LIFE_IN_MONTHS, NAME, METHOD_ID
-- =============================================================================

-- ── Template ─────────────────────────────────────────────────────────────────
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/methods',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: depreciation methods list'
    );
    COMMIT;
END;
/

-- ── Handler ───────────────────────────────────────────────────────────────────
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
        SELECT METHOD_ID,
               METHOD_CODE,
               NAME,
               LIFE_IN_MONTHS,
               STL_METHOD_FLAG,
               RATE_SOURCE_RULE,
               DEPRN_BASIS_RULE,
               DEPRECIATE_LASTYEAR_FLAG,
               EXCLUDE_SALVAGE_VALUE_FLAG,
               SET_ID
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
        HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
        ]'
    );
    COMMIT;
END;
/
