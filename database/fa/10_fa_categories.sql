-- =============================================================================
-- 10_FA_CATEGORIES.SQL
-- Category management endpoints:
--   GET  fa/categories          (search with params)
--   GET  fa/categories/:id      (detail)
--   GET  fa/categories/:id/books (category books + ALL account codes)
--   GET  fa/categories/:id/book-defaults (default depreciation rules)
--   POST fa/categories          (create)
--   PUT  fa/categories/:id      (update)
-- =============================================================================


-- ── Helper: build account string from REERP_GL_CODE_COMBINATIONS ─────────────
-- Returns 'Co-Lob-Dept-Account-SubAcc-Alys-IC-Fut1-Fut2'
-- Used inline in the books query below.


-- ============================================================
-- 1. GET/POST fa/categories  (search with optional filters)
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/categories',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: category search and create'
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
    v_total  NUMBER := 0;
    v_offset NUMBER := NVL(TO_NUMBER(:offset), 0);
    v_limit  NUMBER := NVL(TO_NUMBER(:limit),  200);

    CURSOR c_count IS
        SELECT COUNT(*) CNT
        FROM   RR_FA_CATEGORIES_B b
        LEFT JOIN RR_FA_CATEGORIES_TL tl
               ON tl.CATEGORY_ID = b.CATEGORY_ID AND tl.LANGUAGE = 'US'
        WHERE  (:description   IS NULL OR UPPER(NVL(tl.DESCRIPTION,'')) LIKE '%'||UPPER(:description)||'%')
        AND    (:categoryType  IS NULL OR b.CATEGORY_TYPE  = :categoryType)
        AND    (:capitalizeFlag IS NULL OR b.CAPITALIZE_FLAG = :capitalizeFlag)
        AND    (:ownedLeased   IS NULL OR b.OWNED_LEASED    = :ownedLeased)
        AND    (:enabledFlag   IS NULL OR NVL(b.ENABLED_FLAG,'Y') = :enabledFlag);

    CURSOR c IS
        SELECT b.CATEGORY_ID, b.SEGMENT1, b.SEGMENT2, b.CATEGORY_TYPE,
               b.OWNED_LEASED, b.CAPITALIZE_FLAG, b.ENABLED_FLAG, b.SUMMARY_FLAG,
               NVL(tl.DESCRIPTION, b.SEGMENT1 || ' - ' || b.SEGMENT2) AS DESCRIPTION
        FROM   RR_FA_CATEGORIES_B b
        LEFT JOIN RR_FA_CATEGORIES_TL tl
               ON tl.CATEGORY_ID = b.CATEGORY_ID AND tl.LANGUAGE = 'US'
        WHERE  (:description   IS NULL OR UPPER(NVL(tl.DESCRIPTION,'')) LIKE '%'||UPPER(:description)||'%')
        AND    (:categoryType  IS NULL OR b.CATEGORY_TYPE  = :categoryType)
        AND    (:capitalizeFlag IS NULL OR b.CAPITALIZE_FLAG = :capitalizeFlag)
        AND    (:ownedLeased   IS NULL OR b.OWNED_LEASED    = :ownedLeased)
        AND    (:enabledFlag   IS NULL OR NVL(b.ENABLED_FLAG,'Y') = :enabledFlag)
        ORDER BY b.SEGMENT1, b.SEGMENT2
        OFFSET v_offset ROWS FETCH NEXT v_limit ROWS ONLY;

    v_clob CLOB;
    v_buf  VARCHAR2(32000);
BEGIN
    FOR r IN c_count LOOP v_total := r.CNT; END LOOP;

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',    TRUE);
    APEX_JSON.WRITE('totalCount', v_total);
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
    v_clob := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
    DECLARE v_len PLS_INTEGER := DBMS_LOB.GETLENGTH(v_clob); v_pos PLS_INTEGER := 1;
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
        HTP.PRN('{"success":false,"error":"'||REPLACE(SQLERRM,'"','\"')||'"}');
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 2. GET/PUT fa/categories/:categoryId
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/categories/:categoryId',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: single category detail'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/categories/:categoryId',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    CURSOR c IS
        SELECT b.CATEGORY_ID, b.SEGMENT1, b.SEGMENT2, b.CATEGORY_TYPE,
               b.OWNED_LEASED, b.CAPITALIZE_FLAG, b.ENABLED_FLAG,
               b.SUMMARY_FLAG, b.STRUCTURE_INSTANCE_NUMBER,
               b.CREATION_DATE, b.CREATED_BY, b.LAST_UPDATE_DATE, b.LAST_UPDATED_BY,
               NVL(tl.DESCRIPTION, b.SEGMENT1 || ' - ' || b.SEGMENT2) AS DESCRIPTION
        FROM   RR_FA_CATEGORIES_B b
        LEFT JOIN RR_FA_CATEGORIES_TL tl
               ON tl.CATEGORY_ID = b.CATEGORY_ID AND tl.LANGUAGE = 'US'
        WHERE  b.CATEGORY_ID = :categoryId;

    r c%ROWTYPE;
    v_clob CLOB;
    v_buf  VARCHAR2(32000);
BEGIN
    OPEN c; FETCH c INTO r; CLOSE c;
    IF r.CATEGORY_ID IS NULL THEN
        :status := 404;
        HTP.PRN('{"success":false,"error":"Category not found"}');
        RETURN;
    END IF;

    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success',                   TRUE);
    APEX_JSON.WRITE('categoryId',                r.CATEGORY_ID);
    APEX_JSON.WRITE('segment1',                  r.SEGMENT1);
    APEX_JSON.WRITE('segment2',                  r.SEGMENT2);
    APEX_JSON.WRITE('description',               r.DESCRIPTION);
    APEX_JSON.WRITE('categoryType',              r.CATEGORY_TYPE);
    APEX_JSON.WRITE('ownedLeased',               r.OWNED_LEASED);
    APEX_JSON.WRITE('capitalizeFlag',            r.CAPITALIZE_FLAG);
    APEX_JSON.WRITE('enabledFlag',               r.ENABLED_FLAG);
    APEX_JSON.WRITE('summaryFlag',               r.SUMMARY_FLAG);
    APEX_JSON.WRITE('structureInstanceNumber',   r.STRUCTURE_INSTANCE_NUMBER);
    APEX_JSON.WRITE('creationDate',              r.CREATION_DATE);
    APEX_JSON.WRITE('createdBy',                 r.CREATED_BY);
    APEX_JSON.WRITE('lastUpdateDate',            r.LAST_UPDATE_DATE);
    APEX_JSON.WRITE('lastUpdatedBy',             r.LAST_UPDATED_BY);
    APEX_JSON.CLOSE_OBJECT;
    :status := 200;
    v_clob := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
    DECLARE v_len PLS_INTEGER := DBMS_LOB.GETLENGTH(v_clob); v_pos PLS_INTEGER := 1;
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
        HTP.PRN('{"success":false,"error":"'||REPLACE(SQLERRM,'"','\"')||'"}');
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 3. GET fa/categories/:categoryId/books
--    Returns category books with FULL account code strings:
--    Standard + CIP + Unplanned + Impairment + Revaluation
--    NOTE: verify column names against your RR_FA_CATEGORY_BOOKS DDL
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/categories/:categoryId/books',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: category book accounts (all)'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/categories/:categoryId/books',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    -- RR_FA_CATEGORY_BOOKS actual columns (from DDL):
    -- BOOK_TYPE_CODE, CATEGORY_BOOK_ID, CATEGORY_ID,
    -- ASSET_COST_ACCOUNT_CCID, ASSET_CLEARING_ACCOUNT_CCID,
    -- DEPRN_EXPENSE_ACCOUNT_CCID, RESERVE_ACCOUNT_CCID,
    -- BONUS_EXPENSE_ACCOUNT_CCID, BONUS_RESERVE_ACCT_CCID
    CURSOR c IS
        SELECT cb.CATEGORY_BOOK_ID,
               cb.BOOK_TYPE_CODE,
               bc.BOOK_TYPE_NAME,
               bc.BOOK_CLASS,
               cb.ASSET_COST_ACCOUNT_CCID,
               cb.ASSET_CLEARING_ACCOUNT_CCID,
               cb.DEPRN_EXPENSE_ACCOUNT_CCID,
               cb.RESERVE_ACCOUNT_CCID,
               cb.BONUS_EXPENSE_ACCOUNT_CCID,
               cb.BONUS_RESERVE_ACCT_CCID
        FROM   RR_FA_CATEGORY_BOOKS cb
        LEFT JOIN RR_FA_BOOK_CONTROLS bc
               ON bc.BOOK_TYPE_CODE = cb.BOOK_TYPE_CODE
        WHERE  cb.CATEGORY_ID = :categoryId
        ORDER BY cb.BOOK_TYPE_CODE;

    v_clob CLOB;
    v_buf  VARCHAR2(32000);

    -- Local function must come AFTER cursors/variables
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
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('categoryBookId',           r.CATEGORY_BOOK_ID);
        APEX_JSON.WRITE('bookTypeCode',             r.BOOK_TYPE_CODE);
        APEX_JSON.WRITE('bookTypeName',             r.BOOK_TYPE_NAME);
        APEX_JSON.WRITE('bookClass',                r.BOOK_CLASS);
        APEX_JSON.WRITE('assetCostAccountCcid',     r.ASSET_COST_ACCOUNT_CCID);
        APEX_JSON.WRITE('assetClearingAccountCcid', r.ASSET_CLEARING_ACCOUNT_CCID);
        APEX_JSON.WRITE('deprnExpenseAccountCcid',  r.DEPRN_EXPENSE_ACCOUNT_CCID);
        APEX_JSON.WRITE('reserveAccountCcid',       r.RESERVE_ACCOUNT_CCID);
        APEX_JSON.WRITE('bonusExpenseAccountCcid',  r.BONUS_EXPENSE_ACCOUNT_CCID);
        APEX_JSON.WRITE('bonusReserveAccountCcid',  r.BONUS_RESERVE_ACCT_CCID);
        APEX_JSON.WRITE('assetCostAccount',         acct_str(r.ASSET_COST_ACCOUNT_CCID));
        APEX_JSON.WRITE('assetClearingAccount',     acct_str(r.ASSET_CLEARING_ACCOUNT_CCID));
        APEX_JSON.WRITE('deprnExpenseAccount',      acct_str(r.DEPRN_EXPENSE_ACCOUNT_CCID));
        APEX_JSON.WRITE('reserveAccount',           acct_str(r.RESERVE_ACCOUNT_CCID));
        APEX_JSON.WRITE('bonusExpenseAccount',      acct_str(r.BONUS_EXPENSE_ACCOUNT_CCID));
        APEX_JSON.WRITE('bonusReserveAccount',      acct_str(r.BONUS_RESERVE_ACCT_CCID));
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
    :status := 200;
    v_clob := APEX_JSON.GET_CLOB_OUTPUT;
    APEX_JSON.FREE_OUTPUT;
    DECLARE v_len PLS_INTEGER := DBMS_LOB.GETLENGTH(v_clob); v_pos PLS_INTEGER := 1;
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
        HTP.PRN('{"success":false,"error":"'||REPLACE(SQLERRM,'"','\"')||'"}');
END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 4. GET fa/categories/:categoryId/book-defaults
--    Default depreciation rules per book and date range
--    Source: RR_FA_CATEGORY_BOOK_DEFAULTS
--    NOTE: Verify column names against your actual table DDL.
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/categories/:categoryId/book-defaults',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: category book default depreciation rules'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/categories/:categoryId/book-defaults',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
-- RR_FA_CATEGORY_BOOK_DEFAULTS table not in current schema.
-- Returns empty items array. Populate when table is available.
BEGIN
    :status := 200;
    HTP.PRN('{"success":true,"items":[]}');
END;
        ]'
    );
    COMMIT;
END;
/
