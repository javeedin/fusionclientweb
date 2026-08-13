-- =============================================================================
-- PATCH 11: Replace ALL remaining broken write handlers from 01_setup.sql
--
-- Broken pattern in 01_setup.sql:
--   - p_source_type => 'plsql/block'         (invalid — must be ORDS.source_type_plsql)
--   - JSON_OBJECT_T / JSON_ARRAY_T / TREAT    (ORA-40573 — not available here)
--   - :body / :status bind vars              (PLS-00382 — no longer writable)
--
-- This patch redeploys all six write handlers using:
--   - JSON_VALUE  for scalar field extraction (safe on CLOB, no type issues)
--   - JSON_TABLE  only for nested arrays (approvers)
--   - HTP.P() + :status_code for output
--
-- Run in APEX SQL Workshop → SQL Commands — one BEGIN...END; block at a time
-- =============================================================================

-- ── 1. POST approvals/users ───────────────────────────────────────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp','approvals/users','POST'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp', p_pattern => 'approvals/users', p_method => 'POST',
        p_source_type => ORDS.source_type_plsql, p_items_per_page => 0,
        p_source => q'[
DECLARE
    v_body  CLOB := :body_text;
    v_modules VARCHAR2(500);
    v_id    NUMBER;
BEGIN
    BEGIN
        SELECT LISTAGG(jt.val, ',') WITHIN GROUP (ORDER BY jt.ord)
        INTO   v_modules
        FROM   JSON_TABLE(v_body, '$.modules[*]'
                 COLUMNS (ord FOR ORDINALITY, val VARCHAR2(50) PATH '$')) jt;
    EXCEPTION WHEN OTHERS THEN v_modules := NULL; END;

    INSERT INTO RR_APPROVAL_USERS (
        FULL_NAME, EMAIL, PHONE_NUMBER, DEPARTMENT, JOB_TITLE,
        MAX_APPROVAL_AMT, CURRENCY, MODULES, ACTIVE,
        CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE
    ) VALUES (
        JSON_VALUE(v_body, '$.fullName'),
        JSON_VALUE(v_body, '$.email'),
        JSON_VALUE(v_body, '$.phoneNumber'),
        JSON_VALUE(v_body, '$.department'),
        JSON_VALUE(v_body, '$.jobTitle'),
        CASE WHEN JSON_VALUE(v_body, '$.maxApprovalAmount') IS NULL THEN NULL
             ELSE TO_NUMBER(JSON_VALUE(v_body, '$.maxApprovalAmount')) END,
        NVL(JSON_VALUE(v_body, '$.currency'), 'AED'),
        v_modules,
        NVL(JSON_VALUE(v_body, '$.active'), 'Y'),
        SYS_CONTEXT('APEX$SESSION','APP_USER'), SYSDATE, SYSDATE
    ) RETURNING USER_ID INTO v_id;

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","userId":' || v_id || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── 2. PUT approvals/users/:id ────────────────────────────────────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp','approvals/users/:id','PUT'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp', p_pattern => 'approvals/users/:id', p_method => 'PUT',
        p_source_type => ORDS.source_type_plsql, p_items_per_page => 0,
        p_source => q'[
DECLARE
    v_body    CLOB := :body_text;
    v_modules VARCHAR2(500);
    v_cnt     NUMBER;
BEGIN
    BEGIN
        SELECT LISTAGG(jt.val, ',') WITHIN GROUP (ORDER BY jt.ord)
        INTO   v_modules
        FROM   JSON_TABLE(v_body, '$.modules[*]'
                 COLUMNS (ord FOR ORDINALITY, val VARCHAR2(50) PATH '$')) jt;
    EXCEPTION WHEN OTHERS THEN v_modules := NULL; END;

    UPDATE RR_APPROVAL_USERS SET
        FULL_NAME        = NVL(JSON_VALUE(v_body,'$.fullName'),   FULL_NAME),
        EMAIL            = NVL(JSON_VALUE(v_body,'$.email'),      EMAIL),
        PHONE_NUMBER     = JSON_VALUE(v_body,'$.phoneNumber'),
        DEPARTMENT       = JSON_VALUE(v_body,'$.department'),
        JOB_TITLE        = JSON_VALUE(v_body,'$.jobTitle'),
        MAX_APPROVAL_AMT = CASE WHEN JSON_VALUE(v_body,'$.maxApprovalAmount') IS NULL THEN NULL
                                ELSE TO_NUMBER(JSON_VALUE(v_body,'$.maxApprovalAmount')) END,
        CURRENCY         = NVL(JSON_VALUE(v_body,'$.currency'),   CURRENCY),
        MODULES          = NVL(v_modules,                         MODULES),
        ACTIVE           = NVL(JSON_VALUE(v_body,'$.active'),     ACTIVE),
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
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── 3. DELETE approvals/users/:id ────────────────────────────────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp','approvals/users/:id','DELETE'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp', p_pattern => 'approvals/users/:id', p_method => 'DELETE',
        p_source_type => ORDS.source_type_plsql, p_items_per_page => 0,
        p_source => q'[
BEGIN
    DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE USER_ID = :id;
    DELETE FROM RR_APPROVAL_USERS           WHERE USER_ID = :id;
    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"SUCCESS","message":"Approver deleted"}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── 4. POST approvals/rules ───────────────────────────────────────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp','approvals/rules','POST'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp', p_pattern => 'approvals/rules', p_method => 'POST',
        p_source_type => ORDS.source_type_plsql, p_items_per_page => 0,
        p_source => q'[
DECLARE
    v_body    CLOB := :body_text;
    v_rule_id NUMBER;
BEGIN
    INSERT INTO RR_APPROVAL_RULES (
        RULE_NAME, MODULE, TRANSACTION_TYPE, DESCRIPTION,
        MIN_AMOUNT, MAX_AMOUNT, CURRENCY, APPROVAL_TYPE,
        PRIORITY, ACTIVE, CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE
    ) VALUES (
        JSON_VALUE(v_body,'$.ruleName'),
        JSON_VALUE(v_body,'$.module'),
        JSON_VALUE(v_body,'$.transactionType'),
        JSON_VALUE(v_body,'$.description'),
        NVL(TO_NUMBER(JSON_VALUE(v_body,'$.minAmount')), 0),
        CASE WHEN JSON_VALUE(v_body,'$.maxAmount') IS NULL THEN NULL
             ELSE TO_NUMBER(JSON_VALUE(v_body,'$.maxAmount')) END,
        NVL(JSON_VALUE(v_body,'$.currency'),     'AED'),
        NVL(JSON_VALUE(v_body,'$.approvalType'), 'SEQUENTIAL'),
        NVL(TO_NUMBER(JSON_VALUE(v_body,'$.priority')), 10),
        NVL(JSON_VALUE(v_body,'$.active'),       'Y'),
        SYS_CONTEXT('APEX$SESSION','APP_USER'), SYSDATE, SYSDATE
    ) RETURNING RULE_ID INTO v_rule_id;

    FOR a IN (
        SELECT jt.user_id, jt.seq
        FROM   JSON_TABLE(v_body, '$.approvers[*]'
                 COLUMNS (user_id NUMBER PATH '$.userId', seq NUMBER PATH '$.sequence')) jt
        WHERE  jt.user_id IS NOT NULL
    ) LOOP
        INSERT INTO RR_APPROVAL_RULE_APPROVERS (RULE_ID, USER_ID, SEQUENCE)
        VALUES (v_rule_id, a.user_id, a.seq);
    END LOOP;

    COMMIT;
    :status_code := 201;
    HTP.P('{"status":"SUCCESS","ruleId":' || v_rule_id || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── 5. PUT approvals/rules/:id ────────────────────────────────────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp','approvals/rules/:id','PUT'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp', p_pattern => 'approvals/rules/:id', p_method => 'PUT',
        p_source_type => ORDS.source_type_plsql, p_items_per_page => 0,
        p_source => q'[
DECLARE
    v_body CLOB := :body_text;
    v_cnt  NUMBER;
BEGIN
    UPDATE RR_APPROVAL_RULES SET
        RULE_NAME        = NVL(JSON_VALUE(v_body,'$.ruleName'),        RULE_NAME),
        MODULE           = NVL(JSON_VALUE(v_body,'$.module'),          MODULE),
        TRANSACTION_TYPE = NVL(JSON_VALUE(v_body,'$.transactionType'), TRANSACTION_TYPE),
        DESCRIPTION      = JSON_VALUE(v_body,'$.description'),
        MIN_AMOUNT       = NVL(TO_NUMBER(JSON_VALUE(v_body,'$.minAmount')), MIN_AMOUNT),
        MAX_AMOUNT       = CASE WHEN JSON_VALUE(v_body,'$.maxAmount') IS NULL THEN NULL
                                ELSE TO_NUMBER(JSON_VALUE(v_body,'$.maxAmount')) END,
        CURRENCY         = NVL(JSON_VALUE(v_body,'$.currency'),        CURRENCY),
        APPROVAL_TYPE    = NVL(JSON_VALUE(v_body,'$.approvalType'),    APPROVAL_TYPE),
        PRIORITY         = NVL(TO_NUMBER(JSON_VALUE(v_body,'$.priority')), PRIORITY),
        ACTIVE           = NVL(JSON_VALUE(v_body,'$.active'),          ACTIVE),
        LAST_UPDATE_DATE = SYSDATE
    WHERE RULE_ID = :id;

    v_cnt := SQL%ROWCOUNT;

    IF v_cnt > 0 THEN
        DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE RULE_ID = :id;
        FOR a IN (
            SELECT jt.user_id, jt.seq
            FROM   JSON_TABLE(v_body, '$.approvers[*]'
                     COLUMNS (user_id NUMBER PATH '$.userId', seq NUMBER PATH '$.sequence')) jt
            WHERE  jt.user_id IS NOT NULL
        ) LOOP
            INSERT INTO RR_APPROVAL_RULE_APPROVERS (RULE_ID, USER_ID, SEQUENCE)
            VALUES (:id, a.user_id, a.seq);
        END LOOP;
    END IF;

    COMMIT;

    IF v_cnt = 0 THEN
        :status_code := 404;
        HTP.P('{"status":"ERROR","message":"Rule not found"}');
    ELSE
        :status_code := 200;
        HTP.P('{"status":"SUCCESS","message":"Rule updated"}');
    END IF;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── 6. DELETE approvals/rules/:id ────────────────────────────────────────────
BEGIN
    BEGIN ORDS.DELETE_HANDLER('reerp','approvals/rules/:id','DELETE'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp', p_pattern => 'approvals/rules/:id', p_method => 'DELETE',
        p_source_type => ORDS.source_type_plsql, p_items_per_page => 0,
        p_source => q'[
BEGIN
    DELETE FROM RR_APPROVAL_RULE_APPROVERS WHERE RULE_ID = :id;
    DELETE FROM RR_APPROVAL_RULES           WHERE RULE_ID = :id;
    COMMIT;
    :status_code := 200;
    HTP.P('{"status":"SUCCESS","message":"Rule deleted"}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
