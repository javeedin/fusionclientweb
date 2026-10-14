-- =============================================================================
-- PATCH 23: Fix ORA-06502 on Approval Engine → Requests & History (and the other lists)
--
-- PROBLEM:
--   The GET list handlers build their JSON in a CLOB and then send it with HTP.P(v_clob).
--   HTP.P takes a VARCHAR2, so once the JSON passes 32,767 characters the implicit
--   CLOB → VARCHAR2 conversion fails with
--       ORA-06502: PL/SQL: numeric or value error
--   Requests & History hit it first: purchase-order, AP and cash approvals each add a request
--   (roughly 450 characters), so somewhere around 70 requests the whole list stops loading —
--   and with it every screen that looks up pending requests.
--   Approval tokens (200 rows) and email replies (100 rows, with bodies) are past it already;
--   their handlers answer 200 with an empty list, so the failure goes unnoticed there.
--
--   A second, quieter problem: numbers were written with TO_CHAR, which gives ".5" for 0.5 —
--   not valid JSON, so a single amount below 1 breaks the whole response in the browser.
--
-- FIX:
--   1. RR_APPROVAL_PRINT_CLOB — sends a CLOB in 8,000-character chunks (HTP.PRN), like
--      RR_PO_PRINT_CLOB / RR_AI_PRINT_CLOB.
--   2. RR_APPROVAL_JNUM — a number as a JSON literal ("0.5", "null" for null).
--   3. Redeploy GET approvals/requests, /users, /rules, /tokens, /email-replies with both.
--      Same fields as before; requests also gain ruleName.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Scripts — upload and run this file (re-runnable).
--   Or SQL Commands — run each block (CREATE … / and BEGIN … END; /) separately.
-- =============================================================================

-- ── Step 1: helpers ──────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE RR_APPROVAL_PRINT_CLOB (p_clob IN CLOB) AS
    v_len NUMBER := NVL(DBMS_LOB.GETLENGTH(p_clob), 0);
    v_pos NUMBER := 1;
BEGIN
    WHILE v_pos <= v_len LOOP
        HTP.PRN(DBMS_LOB.SUBSTR(p_clob, 8000, v_pos));
        v_pos := v_pos + 8000;
    END LOOP;
END RR_APPROVAL_PRINT_CLOB;
/

CREATE OR REPLACE FUNCTION RR_APPROVAL_JNUM (p IN NUMBER) RETURN VARCHAR2 DETERMINISTIC AS
BEGIN
    IF p IS NULL THEN RETURN 'null'; END IF;
    -- FM drops the unused decimals ("100." → "100" after the RTRIM); the leading 0 keeps "0.5" valid
    RETURN RTRIM(TO_CHAR(p, 'FM99999999999999999990.9999999999', 'NLS_NUMERIC_CHARACTERS=''.,'''), '.');
END RR_APPROVAL_JNUM;
/

-- ── Step 2: GET approvals/requests ───────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'approvals/requests', p_method => 'GET');
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
        SELECT rq.REQUEST_ID,
               rq.MODULE,
               rq.TRANSACTION_TYPE,
               rq.TRANSACTION_ID,
               rq.TRANSACTION_REF,
               rq.AMOUNT,
               rq.CURRENCY,
               rq.DESCRIPTION,
               rq.REQUESTED_BY_NAME,
               rq.STATUS,
               rq.RULE_ID,
               ru.RULE_NAME,
               TO_CHAR(rq.REQUESTED_DATE,   'YYYY-MM-DD"T"HH24:MI:SS') AS REQUESTED_DATE,
               TO_CHAR(rq.LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS LAST_UPDATE_DATE,
               u.FULL_NAME AS APPROVER_NAME,
               u.EMAIL     AS APPROVER_EMAIL
        FROM   RR_APPROVAL_REQUESTS rq
        LEFT   JOIN RR_APPROVAL_USERS u  ON u.USER_ID  = rq.CURRENT_APPROVER_ID
        LEFT   JOIN RR_APPROVAL_RULES ru ON ru.RULE_ID = rq.RULE_ID
        WHERE  (v_module IS NULL OR rq.MODULE = v_module)
        AND    (v_status IS NULL OR rq.STATUS = v_status)
        ORDER  BY rq.REQUESTED_DATE DESC, rq.REQUEST_ID DESC
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"requestId":'              || r.REQUEST_ID ||
            ',"module":'                 || APEX_JSON.STRINGIFY(NVL(r.MODULE,''))           ||
            ',"transactionType":'        || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_TYPE,'')) ||
            ',"transactionId":'          || RR_APPROVAL_JNUM(r.TRANSACTION_ID)              ||
            ',"transactionRef":'         || APEX_JSON.STRINGIFY(NVL(r.TRANSACTION_REF,''))  ||
            ',"amount":'                 || RR_APPROVAL_JNUM(r.AMOUNT)                      ||
            ',"currency":'               || APEX_JSON.STRINGIFY(NVL(r.CURRENCY,'AED'))      ||
            ',"description":'            || APEX_JSON.STRINGIFY(NVL(r.DESCRIPTION,''))      ||
            ',"requestedByName":'        || APEX_JSON.STRINGIFY(NVL(r.REQUESTED_BY_NAME,''))||
            ',"status":'                 || APEX_JSON.STRINGIFY(NVL(r.STATUS,'PENDING'))    ||
            ',"ruleId":'                 || RR_APPROVAL_JNUM(r.RULE_ID)                     ||
            ',"ruleName":'               || APEX_JSON.STRINGIFY(NVL(r.RULE_NAME,''))        ||
            ',"requestedDate":'          || APEX_JSON.STRINGIFY(NVL(r.REQUESTED_DATE,''))   ||
            ',"lastUpdateDate":'         || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATE_DATE,'')) ||
            ',"currentApproverName":'    || APEX_JSON.STRINGIFY(NVL(r.APPROVER_NAME,''))    ||
            ',"currentApproverEmail":'   || APEX_JSON.STRINGIFY(NVL(r.APPROVER_EMAIL,''))   ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    :status_code := 200;
    RR_APPROVAL_PRINT_CLOB(v_clob);
    DBMS_LOB.FREETEMPORARY(v_clob);
EXCEPTION WHEN OTHERS THEN
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
    );
    COMMIT;
END;
/

-- ── Step 3: GET approvals/users ──────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'approvals/users', p_method => 'GET');
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
            ',"maxApprovalAmount":'  || RR_APPROVAL_JNUM(r.MAX_APPROVAL_AMT)         ||
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
    RR_APPROVAL_PRINT_CLOB(v_clob);
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

-- ── Step 4: GET approvals/rules ──────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'approvals/rules', p_method => 'GET');
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
    v_clob      CLOB;
    v_approvers VARCHAR2(32767);
    v_first     BOOLEAN := TRUE;
    v_afirst    BOOLEAN;
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
                '{"sequence":'   || RR_APPROVAL_JNUM(a.SEQUENCE) ||
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
            ',"minAmount":'        || RR_APPROVAL_JNUM(NVL(r.MIN_AMOUNT, 0))          ||
            ',"maxAmount":'        || RR_APPROVAL_JNUM(r.MAX_AMOUNT)                  ||
            ',"currency":'         || APEX_JSON.STRINGIFY(NVL(r.CURRENCY,'AED'))      ||
            ',"approvalType":'     || APEX_JSON.STRINGIFY(NVL(r.APPROVAL_TYPE,'SEQUENTIAL')) ||
            ',"priority":'         || RR_APPROVAL_JNUM(NVL(r.PRIORITY, 10))           ||
            ',"active":'           || APEX_JSON.STRINGIFY(NVL(r.ACTIVE,'Y'))          ||
            ',"approvers":'        || v_approvers                                     ||
            ',"createdBy":'        || APEX_JSON.STRINGIFY(NVL(r.CREATED_BY,''))       ||
            ',"creationDate":'     || APEX_JSON.STRINGIFY(NVL(r.CREATION_DATE,''))    ||
            ',"lastUpdateDate":'   || APEX_JSON.STRINGIFY(NVL(r.LAST_UPDATE_DATE,'')) ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    RR_APPROVAL_PRINT_CLOB(v_clob);
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

-- ── Step 5: GET approvals/tokens ─────────────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'approvals/tokens', p_method => 'GET');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/tokens',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT TOKEN_ID, ACTION, REQUEST_REF, REQUEST_ID,
               TO_EMAIL, TO_NAME, STATUS,
               TO_CHAR(CREATED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS CREATED_DATE,
               TO_CHAR(EXPIRES_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS EXPIRES_DATE,
               TO_CHAR(USED_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS USED_DATE
        FROM   RR_APPROVAL_TOKENS
        ORDER  BY CREATED_DATE DESC
        FETCH  FIRST 200 ROWS ONLY
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"tokenId":'     || r.TOKEN_ID                                          ||
            ',"action":'      || APEX_JSON.STRINGIFY(NVL(r.ACTION,''))               ||
            ',"requestRef":'  || APEX_JSON.STRINGIFY(NVL(r.REQUEST_REF,''))          ||
            ',"requestId":'   || RR_APPROVAL_JNUM(r.REQUEST_ID)                      ||
            ',"toEmail":'     || APEX_JSON.STRINGIFY(NVL(r.TO_EMAIL,''))             ||
            ',"toName":'      || APEX_JSON.STRINGIFY(NVL(r.TO_NAME,''))              ||
            ',"status":'      || APEX_JSON.STRINGIFY(NVL(r.STATUS,'PENDING'))        ||
            ',"createdDate":' || APEX_JSON.STRINGIFY(NVL(r.CREATED_DATE,''))         ||
            ',"expiresDate":' || APEX_JSON.STRINGIFY(NVL(r.EXPIRES_DATE,''))         ||
            ',"usedDate":'    || APEX_JSON.STRINGIFY(NVL(r.USED_DATE,''))            ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    RR_APPROVAL_PRINT_CLOB(v_clob);
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

-- ── Step 6: GET approvals/email-replies ──────────────────────────────────────
BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(p_module_name => 'reerp', p_pattern => 'approvals/email-replies', p_method => 'GET');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'approvals/email-replies',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_clob  CLOB;
    v_first BOOLEAN := TRUE;
BEGIN
    DBMS_LOB.CREATETEMPORARY(v_clob, TRUE);
    DBMS_LOB.APPEND(v_clob, '{"items":[');

    FOR r IN (
        SELECT REPLY_ID, FROM_EMAIL, FROM_NAME, SUBJECT, BODY_TEXT,
               ACTION_DETECTED, REF_NUMBER, REQUEST_ID, STATUS,
               TO_CHAR(RECEIVED_DATE,  'YYYY-MM-DD"T"HH24:MI:SS') AS RECEIVED_DATE,
               TO_CHAR(PROCESSED_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS PROCESSED_DATE,
               PROCESSED_BY, NOTES
        FROM   RR_APPROVAL_EMAIL_REPLIES
        ORDER  BY RECEIVED_DATE DESC
        FETCH  FIRST 100 ROWS ONLY
    ) LOOP
        IF NOT v_first THEN DBMS_LOB.APPEND(v_clob, ','); END IF;
        v_first := FALSE;
        DBMS_LOB.APPEND(v_clob,
            '{"replyId":'          || r.REPLY_ID ||
            ',"fromEmail":'        || APEX_JSON.STRINGIFY(NVL(r.FROM_EMAIL,''))    ||
            ',"fromName":'         || APEX_JSON.STRINGIFY(NVL(r.FROM_NAME,''))     ||
            ',"subject":'          || APEX_JSON.STRINGIFY(NVL(r.SUBJECT,''))       ||
            ',"bodyText":'         || APEX_JSON.STRINGIFY(NVL(r.BODY_TEXT,''))     ||
            ',"actionDetected":'   || APEX_JSON.STRINGIFY(NVL(r.ACTION_DETECTED,'UNKNOWN')) ||
            ',"refNumber":'        || APEX_JSON.STRINGIFY(NVL(r.REF_NUMBER,''))    ||
            ',"requestId":'        || RR_APPROVAL_JNUM(r.REQUEST_ID)               ||
            ',"status":'           || APEX_JSON.STRINGIFY(NVL(r.STATUS,'PENDING')) ||
            ',"receivedDate":'     || APEX_JSON.STRINGIFY(NVL(r.RECEIVED_DATE,'')) ||
            ',"processedDate":'    || APEX_JSON.STRINGIFY(NVL(r.PROCESSED_DATE,'')) ||
            ',"processedBy":'      || APEX_JSON.STRINGIFY(NVL(r.PROCESSED_BY,''))  ||
            ',"notes":'            || APEX_JSON.STRINGIFY(NVL(r.NOTES,''))         ||
            '}'
        );
    END LOOP;

    DBMS_LOB.APPEND(v_clob, ']}');
    RR_APPROVAL_PRINT_CLOB(v_clob);
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

-- ── Check: how big the lists are now (Requests & History broke once this passed 32,767) ──
SELECT 'approvals/requests' AS endpoint, COUNT(*) AS rows_returned FROM RR_APPROVAL_REQUESTS
UNION ALL SELECT 'approvals/tokens (latest 200)', LEAST(COUNT(*), 200) FROM RR_APPROVAL_TOKENS
UNION ALL SELECT 'approvals/email-replies (latest 100)', LEAST(COUNT(*), 100) FROM RR_APPROVAL_EMAIL_REPLIES;
