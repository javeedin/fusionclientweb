-- =============================================================================
-- PATCH 81: Single-value create and update endpoints for COA segment values
--
-- NEW ENDPOINTS:
--   POST valuesets/values
--     Body: { "valueSetCode": "...", "value": "...", "description": "...",
--             "enabledFlag": "Y", "accountType": "...",
--             "startDateActive": "YYYY-MM-DD", "endDateActive": "YYYY-MM-DD",
--             "summaryFlag": "N", "detailPostingAllowed": "Y",
--             "detailBudgetingAllowed": "Y" }
--
--   PUT valuesets/values/:id
--     Body: { "description": "...", "enabledFlag": "Y", "accountType": "...",
--             "startDateActive": "YYYY-MM-DD", "endDateActive": "YYYY-MM-DD",
--             "summaryFlag": "N", "detailPostingAllowed": "Y",
--             "detailBudgetingAllowed": "Y" }
--     NOTE: Value and ValueSetCode are immutable — not updated.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── POST valuesets/values (create a single new segment value) ────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'valuesets/values',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'valuesets/values'
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
    v_vset_code     VARCHAR2(150):= JSON_VALUE(v_body, '$.valueSetCode');
    v_value         VARCHAR2(150):= JSON_VALUE(v_body, '$.value');
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
    -- Required fields
    IF v_vset_code IS NULL OR v_value IS NULL THEN
        :status_code := 400;
        HTP.P('{"status":"ERROR","message":"valueSetCode and value are required."}');
        RETURN;
    END IF;

    -- Check for duplicate
    SELECT COUNT(*) INTO v_exists
    FROM RR_VALUE_SET_VALUES
    WHERE VALUE_SET_CODE = v_vset_code
      AND VALUE          = v_value;

    IF v_exists > 0 THEN
        :status_code := 409;
        HTP.P('{"status":"ERROR","message":"Value already exists in this value set."}');
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
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('POST valuesets/values registered.');
END;
/

-- ── PUT valuesets/values/:id (update description + flags; value is immutable) ─
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'valuesets/values/:id',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
        ORDS.DEFINE_TEMPLATE(
            p_module_name => 'reerp',
            p_pattern     => 'valuesets/values/:id'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'valuesets/values/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_id          NUMBER       := TO_NUMBER(:id);
    v_body        CLOB         := :body_text;
    v_description VARCHAR2(500):= JSON_VALUE(v_body, '$.description');
    v_enabled     VARCHAR2(1)  := JSON_VALUE(v_body, '$.enabledFlag');
    v_acct_type   VARCHAR2(50) := JSON_VALUE(v_body, '$.accountType');
    v_start_date  VARCHAR2(30) := JSON_VALUE(v_body, '$.startDateActive');
    v_end_date    VARCHAR2(30) := JSON_VALUE(v_body, '$.endDateActive');
    v_summary     VARCHAR2(1)  := JSON_VALUE(v_body, '$.summaryFlag');
    v_posting     VARCHAR2(1)  := JSON_VALUE(v_body, '$.detailPostingAllowed');
    v_budgeting   VARCHAR2(1)  := JSON_VALUE(v_body, '$.detailBudgetingAllowed');
    v_rows        NUMBER;
BEGIN
    UPDATE RR_VALUE_SET_VALUES
    SET    DESCRIPTION              = NVL(v_description, DESCRIPTION),
           ENABLED_FLAG             = NVL(v_enabled,     ENABLED_FLAG),
           ACCOUNT_TYPE             = v_acct_type,
           START_DATE_ACTIVE        = CASE WHEN v_start_date IS NOT NULL
                                          THEN TO_DATE(v_start_date, 'YYYY-MM-DD')
                                          ELSE START_DATE_ACTIVE
                                     END,
           END_DATE_ACTIVE          = CASE WHEN v_end_date IS NOT NULL
                                          THEN TO_DATE(v_end_date, 'YYYY-MM-DD')
                                          ELSE END_DATE_ACTIVE
                                     END,
           SUMMARY_FLAG             = NVL(v_summary,   SUMMARY_FLAG),
           DETAIL_POSTING_ALLOWED   = NVL(v_posting,   DETAIL_POSTING_ALLOWED),
           DETAIL_BUDGETING_ALLOWED = NVL(v_budgeting, DETAIL_BUDGETING_ALLOWED)
    WHERE  VALUE_ID = v_id;

    v_rows := SQL%ROWCOUNT;

    IF v_rows = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Value not found."}');
        RETURN;
    END IF;

    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"SUCCESS","valueId":' || v_id || ',"rowsUpdated":' || v_rows || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('PUT valuesets/values/:id registered.');
END;
/
