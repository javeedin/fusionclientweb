-- =============================================================================
-- 19_FA_CATEGORIES_WITH_CCID.SQL
-- Replaces GET reerp/fa/categories handler
-- Now joins RR_FA_CATEGORY_BOOKS + reerp_gl_code_combinations
-- to return assetCostAccountCcid and its segment breakdown
-- =============================================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/categories',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_total  NUMBER := 0;
    v_offset NUMBER := NVL(TO_NUMBER(:offset), 0);
    v_limit  NUMBER := NVL(TO_NUMBER(:limit),  200);

    CURSOR c_count IS
        SELECT COUNT(*) CNT
        FROM   RR_FA_CATEGORIES_B b
        LEFT JOIN RR_FA_CATEGORIES_TL tl
               ON tl.CATEGORY_ID = b.CATEGORY_ID AND tl.LANGUAGE = ''US''
        WHERE  (:description    IS NULL OR UPPER(NVL(tl.DESCRIPTION,'''')) LIKE ''%''||UPPER(:description)||''%'')
        AND    (:categoryType   IS NULL OR b.CATEGORY_TYPE   = :categoryType)
        AND    (:capitalizeFlag IS NULL OR b.CAPITALIZE_FLAG = :capitalizeFlag)
        AND    (:ownedLeased    IS NULL OR b.OWNED_LEASED    = :ownedLeased)
        AND    (:enabledFlag    IS NULL OR NVL(b.ENABLED_FLAG,''Y'') = :enabledFlag);

    CURSOR c IS
        SELECT
            b.CATEGORY_ID, b.SEGMENT1, b.SEGMENT2, b.CATEGORY_TYPE,
            b.OWNED_LEASED, b.CAPITALIZE_FLAG, b.ENABLED_FLAG, b.SUMMARY_FLAG,
            NVL(tl.DESCRIPTION, b.SEGMENT1 || '' - '' || b.SEGMENT2) AS DESCRIPTION,
            -- Asset cost CCID from first category book
            cb.ASSET_COST_ACCOUNT_CCID,
            -- GL segments from code combinations
            gl."buimercFinGlbCoaCo"         AS seg_co,
            gl."buimercFinGlbCoaLob"        AS seg_lob,
            gl."buimercFinGlbCoaDepartment" AS seg_dept,
            gl."buimercFinGlbCoaAccount"    AS seg_account,
            gl."buimercFinGlbCoaSubAcc"     AS seg_sub_acc,
            gl."buimercFinGlbCoaAlys"       AS seg_alys,
            gl."buimercFinGlbCoaIc"         AS seg_ic,
            gl."buimercFinGlbCoaFut1"       AS seg_fut1,
            gl."buimercFinGlbCoaFut2"       AS seg_fut2
        FROM   RR_FA_CATEGORIES_B b
        LEFT JOIN RR_FA_CATEGORIES_TL tl
               ON tl.CATEGORY_ID = b.CATEGORY_ID AND tl.LANGUAGE = ''US''
        -- Pick first book per category for its ASSET_COST_ACCOUNT_CCID
        LEFT JOIN (
            SELECT CATEGORY_ID, ASSET_COST_ACCOUNT_CCID,
                   ROW_NUMBER() OVER (PARTITION BY CATEGORY_ID ORDER BY BOOK_TYPE_CODE) AS rn
            FROM   RR_FA_CATEGORY_BOOKS
        ) cb ON cb.CATEGORY_ID = b.CATEGORY_ID AND cb.rn = 1
        -- Join GL code combinations to resolve segments
        LEFT JOIN reerp_gl_code_combinations gl
               ON gl."_CODE_COMBINATION_ID" = cb.ASSET_COST_ACCOUNT_CCID
        WHERE  (:description    IS NULL OR UPPER(NVL(tl.DESCRIPTION,'''')) LIKE ''%''||UPPER(:description)||''%'')
        AND    (:categoryType   IS NULL OR b.CATEGORY_TYPE   = :categoryType)
        AND    (:capitalizeFlag IS NULL OR b.CAPITALIZE_FLAG = :capitalizeFlag)
        AND    (:ownedLeased    IS NULL OR b.OWNED_LEASED    = :ownedLeased)
        AND    (:enabledFlag    IS NULL OR NVL(b.ENABLED_FLAG,''Y'') = :enabledFlag)
        ORDER BY b.SEGMENT1, b.SEGMENT2
        OFFSET v_offset ROWS FETCH NEXT v_limit ROWS ONLY;

    v_clob   CLOB;
    v_buf    VARCHAR2(32000);
    v_concat VARCHAR2(400);
BEGIN
    FOR r IN c_count LOOP v_total := r.CNT; END LOOP;

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE(''success'',    TRUE);
    APEX_JSON.WRITE(''totalCount'', v_total);
    APEX_JSON.OPEN_ARRAY(''items'');
    FOR r IN c LOOP
        -- Build concatenated account string from segments
        v_concat :=
            NVL(r.seg_co,      '''') || ''-'' ||
            NVL(r.seg_lob,     '''') || ''-'' ||
            NVL(r.seg_dept,    '''') || ''-'' ||
            NVL(r.seg_account, '''') || ''-'' ||
            NVL(r.seg_sub_acc, '''') || ''-'' ||
            NVL(r.seg_alys,    '''') || ''-'' ||
            NVL(r.seg_ic,      '''') || ''-'' ||
            NVL(r.seg_fut1,    '''') || ''-'' ||
            NVL(r.seg_fut2,    '''');

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE(''categoryId'',           r.CATEGORY_ID);
        APEX_JSON.WRITE(''segment1'',             r.SEGMENT1);
        APEX_JSON.WRITE(''segment2'',             r.SEGMENT2);
        APEX_JSON.WRITE(''description'',          r.DESCRIPTION);
        APEX_JSON.WRITE(''categoryType'',         r.CATEGORY_TYPE);
        APEX_JSON.WRITE(''ownedLeased'',          r.OWNED_LEASED);
        APEX_JSON.WRITE(''capitalizeFlag'',       r.CAPITALIZE_FLAG);
        APEX_JSON.WRITE(''summaryFlag'',          r.SUMMARY_FLAG);
        APEX_JSON.WRITE(''enabledFlag'',          r.ENABLED_FLAG);
        -- CCID and segments
        APEX_JSON.WRITE(''assetCostAccountCcid'', r.ASSET_COST_ACCOUNT_CCID);
        APEX_JSON.WRITE(''assetCostAccount'',     v_concat);
        APEX_JSON.WRITE(''segCo'',                r.seg_co);
        APEX_JSON.WRITE(''segLob'',               r.seg_lob);
        APEX_JSON.WRITE(''segDept'',              r.seg_dept);
        APEX_JSON.WRITE(''segAccount'',           r.seg_account);
        APEX_JSON.WRITE(''segSubAcc'',            r.seg_sub_acc);
        APEX_JSON.WRITE(''segAlys'',              r.seg_alys);
        APEX_JSON.WRITE(''segIc'',                r.seg_ic);
        APEX_JSON.WRITE(''segFut1'',              r.seg_fut1);
        APEX_JSON.WRITE(''segFut2'',              r.seg_fut2);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    :status := 200;
    v_clob := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
    DECLARE
        v_len PLS_INTEGER := DBMS_LOB.GETLENGTH(v_clob);
        v_pos PLS_INTEGER := 1;
    BEGIN
        WHILE v_pos <= v_len LOOP
            v_buf := DBMS_LOB.SUBSTR(v_clob, 8000, v_pos);
            HTP.PRN(v_buf);
            v_pos := v_pos + 8000;
        END LOOP;
    END;
EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.PRN(''{"success":false,"error":"''||REPLACE(SQLERRM,''"'',''\\"'')||''"}'' );
END;
        ]'
    );
    COMMIT;
END;
/
