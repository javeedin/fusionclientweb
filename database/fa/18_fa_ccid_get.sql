-- =============================================================================
-- 18_FA_CCID_GET.SQL
-- GET reerp/fa/ccid
-- Returns GL Code Combinations for asset assignment
-- Optional filter: ?search=  (searches concatenated segments)
-- =============================================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/ccid',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: GL code combinations for asset CCID assignment'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/ccid',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_search VARCHAR2(400) := LOWER(:search);
    CURSOR c IS
        SELECT
            "_CODE_COMBINATION_ID"       AS ccid,
            "buimercFinGlbCoaCo"         AS co,
            "buimercFinGlbCoaLob"        AS lob,
            "buimercFinGlbCoaDepartment" AS dept,
            "buimercFinGlbCoaAccount"    AS account,
            "buimercFinGlbCoaSubAcc"     AS sub_acc,
            "buimercFinGlbCoaAlys"       AS alys,
            "buimercFinGlbCoaIc"         AS ic,
            "buimercFinGlbCoaFut1"       AS fut1,
            "buimercFinGlbCoaFut2"       AS fut2,
            "AccountType"                AS account_type,
            "EnabledFlag"                AS enabled_flag
        FROM   reerp_gl_code_combinations
        WHERE  NVL("EnabledFlag", 'Y') = 'Y'
        AND    (
            v_search IS NULL
            OR LOWER(
                NVL("buimercFinGlbCoaCo", '')         || '-' ||
                NVL("buimercFinGlbCoaLob", '')        || '-' ||
                NVL("buimercFinGlbCoaDepartment", '') || '-' ||
                NVL("buimercFinGlbCoaAccount", '')    || '-' ||
                NVL("buimercFinGlbCoaSubAcc", '')     || '-' ||
                NVL("buimercFinGlbCoaAlys", '')
            ) LIKE '%' || v_search || '%'
            OR TO_CHAR("_CODE_COMBINATION_ID") LIKE '%' || v_search || '%'
        )
        ORDER BY
            "buimercFinGlbCoaCo",
            "buimercFinGlbCoaAccount",
            "buimercFinGlbCoaDepartment"
        FETCH FIRST 200 ROWS ONLY;
    v_concat VARCHAR2(400);
BEGIN
    APEX_JSON.INITIALIZE_CLOB_OUTPUT;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.OPEN_ARRAY('items');
    FOR r IN c LOOP
        v_concat :=
            NVL(r.co, '')   || '-' || NVL(r.lob, '')  || '-' ||
            NVL(r.dept, '') || '-' || NVL(r.account, '')|| '-' ||
            NVL(r.sub_acc, '')|| '-' || NVL(r.alys, '') || '-' ||
            NVL(r.ic, '')   || '-' || NVL(r.fut1, '') || '-' || NVL(r.fut2, '');
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('ccid',        r.ccid);
        APEX_JSON.WRITE('label',       v_concat);
        APEX_JSON.WRITE('co',          r.co);
        APEX_JSON.WRITE('lob',         r.lob);
        APEX_JSON.WRITE('dept',        r.dept);
        APEX_JSON.WRITE('account',     r.account);
        APEX_JSON.WRITE('subAcc',      r.sub_acc);
        APEX_JSON.WRITE('alys',        r.alys);
        APEX_JSON.WRITE('ic',          r.ic);
        APEX_JSON.WRITE('accountType', r.account_type);
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
