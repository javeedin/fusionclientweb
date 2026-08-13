-- =============================================================================
-- PATCH 02: Rebuild Approval Engine GET handlers using source_type_plsql
--
-- Problem: 01_setup.sql used p_source_type => 'json/collection' which
--          may not register correctly in this ORDS version. All other
--          working endpoints in this project use ORDS.source_type_plsql.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands — run each BEGIN...END; block separately
-- =============================================================================

-- ── GET approvals/users ───────────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/users',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/users',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
    v_modules VARCHAR2(500);
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT USER_ID, FULL_NAME, EMAIL, PHONE_NUMBER, DEPARTMENT,
               JOB_TITLE, MAX_APPROVAL_AMT, CURRENCY, MODULES, ACTIVE,
               CREATED_BY,
               TO_CHAR(CREATION_DATE,   'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
               TO_CHAR(LAST_UPDATE_DATE,'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE
        FROM   RR_APPROVAL_USERS
        ORDER  BY FULL_NAME
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"userId":'             || r.USER_ID ||
            ',"fullName":'           || APEX_JSON.STRINGIFY(NVL(r.FULL_NAME,''))     ||
            ',"email":'              || APEX_JSON.STRINGIFY(NVL(r.EMAIL,''))          ||
            ',"phoneNumber":'        || APEX_JSON.STRINGIFY(NVL(r.PHONE_NUMBER,''))  ||
            ',"department":'         || APEX_JSON.STRINGIFY(NVL(r.DEPARTMENT,''))    ||
            ',"jobTitle":'           || APEX_JSON.STRINGIFY(NVL(r.JOB_TITLE,''))     ||
            ',"maxApprovalAmount":'  || NVL(TO_CHAR(r.MAX_APPROVAL_AMT),'null')      ||
            ',"currency":'           || APEX_JSON.STRINGIFY(NVL(r.CURRENCY,'AED'))   ||
            ',"modules":'            || APEX_JSON.STRINGIFY(NVL(r.MODULES,''))       ||
            ',"active":'             || APEX_JSON.STRINGIFY(NVL(r.ACTIVE,'Y'))       ||
            ',"createdBy":'          || APEX_JSON.STRINGIFY(NVL(r.CREATED_BY,''))    ||
            ',"creationDate":'       || APEX_JSON.STRINGIFY(NVL(r.CREATION_DATE,'')) ||
            ',"lastUpdateDate":'     || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATE_DATE,'')) ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    HTP.P(v_clob);
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"items":[],"error":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── GET approvals/rules ───────────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/rules',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/rules',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob    CLOB;
    v_approvers VARCHAR2(4000);
    v_first   BOOLEAN := TRUE;
    v_afirst  BOOLEAN;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT RULE_ID, RULE_NAME, MODULE, TRANSACTION_TYPE, DESCRIPTION,
               MIN_AMOUNT, MAX_AMOUNT, CURRENCY, APPROVAL_TYPE, PRIORITY, ACTIVE,
               CREATED_BY,
               TO_CHAR(CREATION_DATE,   'YYYY-MM-DD"T"HH24:MI:SS') AS CREATION_DATE,
               TO_CHAR(LAST_UPDATE_DATE,'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE
        FROM   RR_APPROVAL_RULES
        ORDER  BY PRIORITY, RULE_NAME
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;

        -- Build approvers array for this rule
        v_approvers := '[';
        v_afirst    := TRUE;
        FOR a IN (
            SELECT ra.SEQUENCE, u.USER_ID, u.FULL_NAME, u.EMAIL, u.DEPARTMENT
            FROM   RR_APPROVAL_RULE_APPROVERS ra
            JOIN   RR_APPROVAL_USERS u ON u.USER_ID = ra.USER_ID
            WHERE  ra.RULE_ID = r.RULE_ID
            ORDER  BY ra.SEQUENCE
        ) LOOP
            IF NOT v_afirst THEN v_approvers := v_approvers || ','; END IF;
            v_afirst := FALSE;
            v_approvers := v_approvers ||
                '{"sequence":'   || a.SEQUENCE  ||
                ',"userId":'     || a.USER_ID   ||
                ',"fullName":'   || APEX_JSON.STRINGIFY(NVL(a.FULL_NAME,''))  ||
                ',"email":'      || APEX_JSON.STRINGIFY(NVL(a.EMAIL,''))       ||
                ',"department":' || APEX_JSON.STRINGIFY(NVL(a.DEPARTMENT,'')) ||
                '}';
        END LOOP;
        v_approvers := v_approvers || ']';

        DBMS_LOB.APPEND(v_clob,
            '{"ruleId":'           || r.RULE_ID   ||
            ',"ruleName":'         || APEX_JSON.STRINGIFY(NVL(r.RULE_NAME,''))        ||
            ',"module":'           || APEX_JSON.STRINGIFY(NVL(r.MODULE,''))           ||
            ',"transactionType":'  || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_TYPE,'')) ||
            ',"description":'      || APEX_JSON.STRINGIFY(NVL(r.DESCRIPTION,''))      ||
            ',"minAmount":'        || NVL(TO_CHAR(r.MIN_AMOUNT),'0')                  ||
            ',"maxAmount":'        || NVL(TO_CHAR(r.MAX_AMOUNT),'null')               ||
            ',"currency":'         || APEX_JSON.STRINGIFY(NVL(r.CURRENCY,'AED'))      ||
            ',"approvalType":'     || APEX_JSON.STRINGIFY(NVL(r.APPROVAL_TYPE,'SEQUENTIAL')) ||
            ',"priority":'         || NVL(TO_CHAR(r.PRIORITY),'10')                   ||
            ',"active":'           || APEX_JSON.STRINGIFY(NVL(r.ACTIVE,'Y'))          ||
            ',"approvers":'        || v_approvers                                     ||
            ',"createdBy":'        || APEX_JSON.STRINGIFY(NVL(r.CREATED_BY,''))       ||
            ',"creationDate":'     || APEX_JSON.STRINGIFY(NVL(r.CREATION_DATE,''))    ||
            ',"lastUpdateDate":'   || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATE_DATE,'')) ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    HTP.P(v_clob);
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"items":[],"error":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── GET approvals/requests ────────────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'approvals/requests',
            p_method      => 'GET'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/requests',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob   CLOB;
    v_first  BOOLEAN := TRUE;
    v_module VARCHAR2(50)  := :module;
    v_status VARCHAR2(30)  := :status;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT rq.REQUEST_ID, rq.MODULE, rq.TRANSACTION_TYPE, rq.TRANSACTION_ID,
               rq.TRANSACTION_REF, rq.AMOUNT, rq.CURRENCY, rq.DESCRIPTION,
               rq.REQUESTED_BY_NAME, rq.STATUS, rq.RULE_ID,
               TO_CHAR(rq.REQUESTED_DATE,'YYYY-MM-DD"T"HH24:MI:SS')  AS REQUESTED_DATE,
               TO_CHAR(rq.LAST_UPDATE_DATE,'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
               u.FULL_NAME  AS APPROVER_NAME,
               u.EMAIL      AS APPROVER_EMAIL
        FROM   RR_APPROVAL_REQUESTS rq
        LEFT   JOIN RR_APPROVAL_USERS u ON u.USER_ID = rq.CURRENT_APPROVER_ID
        WHERE  (v_module IS NULL OR rq.MODULE = v_module)
        AND    (v_status IS NULL OR rq.STATUS = v_status)
        ORDER  BY rq.REQUESTED_DATE DESC
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"requestId":'         || r.REQUEST_ID   ||
            ',"module":'            || APEX_JSON.STRINGIFY(NVL(r.MODULE,''))            ||
            ',"transactionType":'   || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_TYPE,''))  ||
            ',"transactionId":'     || NVL(TO_CHAR(r.TRANSACTION_ID),'null')            ||
            ',"transactionRef":'    || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_REF,''))   ||
            ',"amount":'            || NVL(TO_CHAR(r.AMOUNT),'null')                    ||
            ',"currency":'          || APEX_JSON.STRINGIFY(NVL(r.CURRENCY,'AED'))       ||
            ',"description":'       || APEX_JSON.STRINGIFY(NVL(r.DESCRIPTION,''))       ||
            ',"requestedByName":'   || APEX_JSON.STRINGIFY(NVL(r.REQUESTED_BY_NAME,'')) ||
            ',"status":'            || APEX_JSON.STRINGIFY(NVL(r.STATUS,'PENDING'))     ||
            ',"ruleId":'            || NVL(TO_CHAR(r.RULE_ID),'null')                   ||
            ',"requestedDate":'     || APEX_JSON.STRINGIFY(NVL(r.REQUESTED_DATE,''))    ||
            ',"lastUpdateDate":'    || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATE_DATE,''))  ||
            ',"currentApproverName":'  || APEX_JSON.STRINGIFY(NVL(r.APPROVER_NAME,''))  ||
            ',"currentApproverEmail":' || APEX_JSON.STRINGIFY(NVL(r.APPROVER_EMAIL,'')) ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    HTP.P(v_clob);
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION
    WHEN OTHERS THEN
        HTP.P('{"items":[],"error":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/
