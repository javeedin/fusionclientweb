-- =============================================================================
-- PATCH 82: Fix POST valuesets/values duplicate-key handling + diagnostic GET
--
-- PROBLEMS FIXED:
--   1. ORA-00001 on IDX_RR_VSV_UK bubbled as a raw 500 error instead of 409.
--   2. Duplicate check used exact VALUE match; could miss trimmed / case-differing
--      rows that the function-based index (if any) would still consider a dupe.
--   3. Race condition: two simultaneous POSTs could both pass COUNT(*) = 0
--      then collide on INSERT — now caught by DUP_VAL_ON_INDEX handler.
--
-- NEW ENDPOINT:
--   GET valuesets/values/constraint-info
--     Returns the columns of IDX_RR_VSV_UK to understand what makes a duplicate.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── 1. Redefine POST valuesets/values with robust error handling ─────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'valuesets/values',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'valuesets/values',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body          CLOB         := :body_text;
    v_vset_code     VARCHAR2(150):= TRIM(JSON_VALUE(v_body, '$.valueSetCode'));
    v_value         VARCHAR2(150):= TRIM(JSON_VALUE(v_body, '$.value'));
    v_description   VARCHAR2(500):= JSON_VALUE(v_body, '$.description');
    v_enabled       VARCHAR2(1)  := NVL(JSON_VALUE(v_body, '$.enabledFlag'), 'Y');
    v_acct_type     VARCHAR2(50) := JSON_VALUE(v_body, '$.accountType');
    v_start_date    VARCHAR2(30) := JSON_VALUE(v_body, '$.startDateActive');
    v_end_date      VARCHAR2(30) := JSON_VALUE(v_body, '$.endDateActive');
    v_summary       VARCHAR2(1)  := NVL(JSON_VALUE(v_body, '$.summaryFlag'), 'N');
    v_posting       VARCHAR2(1)  := NVL(JSON_VALUE(v_body, '$.detailPostingAllowed'), 'Y');
    v_budgeting     VARCHAR2(1)  := NVL(JSON_VALUE(v_body, '$.detailBudgetingAllowed'), 'Y');
    v_new_id        NUMBER;
    v_exists        NUMBER;
BEGIN
    IF v_vset_code IS NULL OR v_value IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"ERROR","message":"valueSetCode and value are required."}');
        RETURN;
    END IF;

    -- Duplicate check: TRIM both sides to catch whitespace variants
    SELECT COUNT(*) INTO v_exists
    FROM RR_VALUE_SET_VALUES
    WHERE TRIM(VALUE_SET_CODE) = v_vset_code
      AND TRIM(VALUE)          = v_value;

    IF v_exists > 0 THEN
        :status_code := 409;
        HTP.P('{"status":"ERROR","message":"Value ' || v_value || ' already exists in value set ' || v_vset_code || '."}');
        RETURN;
    END IF;

    INSERT INTO RR_VALUE_SET_VALUES (
        VALUE_SET_CODE, VALUE, DESCRIPTION,
        ENABLED_FLAG, ACCOUNT_TYPE,
        START_DATE_ACTIVE, END_DATE_ACTIVE,
        SUMMARY_FLAG, DETAIL_POSTING_ALLOWED, DETAIL_BUDGETING_ALLOWED
    ) VALUES (
        v_vset_code, v_value, v_description,
        v_enabled, v_acct_type,
        CASE WHEN v_start_date IS NOT NULL THEN TO_DATE(v_start_date, 'YYYY-MM-DD') ELSE NULL END,
        CASE WHEN v_end_date   IS NOT NULL THEN TO_DATE(v_end_date,   'YYYY-MM-DD') ELSE NULL END,
        v_summary, v_posting, v_budgeting
    )
    RETURNING VALUE_ID INTO v_new_id;

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","valueId":' || v_new_id || '}');

EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        -- Race condition: another session inserted the same row between our
        -- COUNT(*) check and this INSERT.
        ROLLBACK;
        :status_code := 409;
        HTP.P('{"status":"ERROR","message":"Value ' || v_value || ' already exists in value set ' || v_vset_code || ' (concurrent insert)."}');
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST valuesets/values updated with robust dup handling.');
END;
/

-- ── 2. Diagnostic GET: returns IDX_RR_VSV_UK column list ─────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'valuesets/values/constraint-info',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'valuesets/values/constraint-info'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'valuesets/values/constraint-info',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_json  CLOB := '[';
    v_first BOOLEAN := TRUE;
    v_total NUMBER;
BEGIN
    -- Constraint columns
    FOR r IN (
        SELECT c.index_name, c.column_name, c.column_position, c.descend,
               i.index_type, i.uniqueness
        FROM   USER_IND_COLUMNS c
        JOIN   USER_INDEXES     i ON i.index_name = c.index_name
        WHERE  c.index_name = 'IDX_RR_VSV_UK'
        ORDER  BY c.column_position
    ) LOOP
        IF NOT v_first THEN v_json := v_json || ','; END IF;
        v_json := v_json ||
            '{"index_name":"'    || r.index_name    || '",' ||
             '"column_name":"'   || r.column_name   || '",' ||
             '"position":'       || r.column_position || ',' ||
             '"descend":"'       || r.descend        || '",' ||
             '"index_type":"'    || r.index_type     || '",' ||
             '"uniqueness":"'    || r.uniqueness      || '"}';
        v_first := FALSE;
    END LOOP;
    v_json := v_json || ']';

    -- Row count in the table
    SELECT COUNT(*) INTO v_total FROM RR_VALUE_SET_VALUES;

    :status_code := 200;
    HTP.P('{"status":"SUCCESS","constraintColumns":' || v_json ||
          ',"totalRows":' || v_total || '}');
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('GET valuesets/values/constraint-info registered.');
END;
/
