-- =============================================================================
-- PATCH 03: Rebuild POST / PUT / DELETE for approvals/users
--
-- Problems in 01_setup.sql:
--   1. p_source_type => 'plsql/block'  (invalid — must be ORDS.source_type_plsql)
--   2. :status / :body bind vars       (invalid — must use :status_code + HTP.P)
--   3. JSON_OBJECT_T not supported     (ORA-40573 — use JSON_TABLE like all other handlers)
--   4. get_string('modules') on array  (frontend sends ["AP","PO"], not a string)
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── POST approvals/users ──────────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/users',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/users',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body      CLOB    := :body_text;
    v_full_name VARCHAR2(500);
    v_email     VARCHAR2(500);
    v_phone     VARCHAR2(100);
    v_dept      VARCHAR2(200);
    v_job       VARCHAR2(200);
    v_max_amt   VARCHAR2(50);
    v_currency  VARCHAR2(10);
    v_active    VARCHAR2(1);
    v_modules   VARCHAR2(500);
    v_id        NUMBER;
BEGIN
    -- Extract scalar fields
    SELECT jt.full_name, jt.email, jt.phone, jt.dept, jt.job,
           jt.max_amt, jt.currency, jt.active
    INTO   v_full_name, v_email, v_phone, v_dept, v_job,
           v_max_amt, v_currency, v_active
    FROM   JSON_TABLE(v_body, '$'
             COLUMNS (
               full_name VARCHAR2(500) PATH '$.fullName',
               email     VARCHAR2(500) PATH '$.email',
               phone     VARCHAR2(100) PATH '$.phoneNumber',
               dept      VARCHAR2(200) PATH '$.department',
               job       VARCHAR2(200) PATH '$.jobTitle',
               max_amt   VARCHAR2(50)  PATH '$.maxApprovalAmount',
               currency  VARCHAR2(10)  PATH '$.currency',
               active    VARCHAR2(1)   PATH '$.active'
             )
           ) jt;

    -- Convert ["AP","PO"] array → "AP,PO" string
    SELECT LISTAGG(jt.val, ',') WITHIN GROUP (ORDER BY jt.ord)
    INTO   v_modules
    FROM   JSON_TABLE(v_body, '$.modules[*]'
             COLUMNS (ord FOR ORDINALITY, val VARCHAR2(50) PATH '$')) jt;

    INSERT INTO RR_APPROVAL_USERS (
        FULL_NAME, EMAIL, PHONE_NUMBER, DEPARTMENT, JOB_TITLE,
        MAX_APPROVAL_AMT, CURRENCY, MODULES, ACTIVE,
        CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE
    ) VALUES (
        v_full_name,
        v_email,
        v_phone,
        v_dept,
        v_job,
        TO_NUMBER(v_max_amt),
        NVL(v_currency, 'AED'),
        v_modules,
        NVL(v_active, 'Y'),
        SYS_CONTEXT('APEX$SESSION', 'APP_USER'),
        SYSDATE, SYSDATE
    ) RETURNING USER_ID INTO v_id;

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","userId":' || v_id || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── PUT approvals/users/:id ───────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/users/:id',
            p_method      => 'PUT'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/users/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body      CLOB    := :body_text;
    v_full_name VARCHAR2(500);
    v_email     VARCHAR2(500);
    v_phone     VARCHAR2(100);
    v_dept      VARCHAR2(200);
    v_job       VARCHAR2(200);
    v_max_amt   VARCHAR2(50);
    v_currency  VARCHAR2(10);
    v_active    VARCHAR2(1);
    v_modules   VARCHAR2(500);
    v_cnt       NUMBER;
BEGIN
    SELECT jt.full_name, jt.email, jt.phone, jt.dept, jt.job,
           jt.max_amt, jt.currency, jt.active
    INTO   v_full_name, v_email, v_phone, v_dept, v_job,
           v_max_amt, v_currency, v_active
    FROM   JSON_TABLE(v_body, '$'
             COLUMNS (
               full_name VARCHAR2(500) PATH '$.fullName',
               email     VARCHAR2(500) PATH '$.email',
               phone     VARCHAR2(100) PATH '$.phoneNumber',
               dept      VARCHAR2(200) PATH '$.department',
               job       VARCHAR2(200) PATH '$.jobTitle',
               max_amt   VARCHAR2(50)  PATH '$.maxApprovalAmount',
               currency  VARCHAR2(10)  PATH '$.currency',
               active    VARCHAR2(1)   PATH '$.active'
             )
           ) jt;

    -- Convert ["AP","PO"] array → "AP,PO" string
    BEGIN
        SELECT LISTAGG(jt.val, ',') WITHIN GROUP (ORDER BY jt.ord)
        INTO   v_modules
        FROM   JSON_TABLE(v_body, '$.modules[*]'
                 COLUMNS (ord FOR ORDINALITY, val VARCHAR2(50) PATH '$')) jt;
    EXCEPTION WHEN OTHERS THEN
        v_modules := NULL;
    END;

    UPDATE RR_APPROVAL_USERS SET
        FULL_NAME        = NVL(v_full_name,  FULL_NAME),
        EMAIL            = NVL(v_email,      EMAIL),
        PHONE_NUMBER     = v_phone,
        DEPARTMENT       = v_dept,
        JOB_TITLE        = v_job,
        MAX_APPROVAL_AMT = TO_NUMBER(v_max_amt),
        CURRENCY         = NVL(v_currency,   CURRENCY),
        MODULES          = NVL(v_modules,    MODULES),
        ACTIVE           = NVL(v_active,     ACTIVE),
        LAST_UPDATE_DATE = SYSDATE
    WHERE USER_ID = :id;

    v_cnt := SQL%ROWCOUNT;
    COMMIT;

    IF v_cnt = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Approver not found"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","message":"Approver updated"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── DELETE approvals/users/:id ────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/users/:id',
            p_method      => 'DELETE'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/users/:id',
        p_method         => 'DELETE',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
BEGIN
    DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE USER_ID = :id;
    DELETE FROM RR_APPROVAL_USERS           WHERE USER_ID = :id;
    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"SUCCESS","message":"Approver deleted"}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
